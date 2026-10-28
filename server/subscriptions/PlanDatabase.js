import { randomUUID } from "crypto";
import { AsyncLocalStorage } from "async_hooks";
import { entityKey, loadSubscription, reserveResources, finishReservation, orderExists, assertSubscriptionAccess } from "./SubscriptionService.js";
import { planError } from "./PlanCatalog.js";

export const planRequestContext = new AsyncLocalStorage();
const RAW = Symbol.for("poso.rawPlanDatabase");
const clean = (path = "") => String(path).split("/").filter(Boolean).join("/");
const hasData = (value) => value !== null && value !== undefined && (typeof value !== "object" || Object.values(value).some(hasData));
const clone = (value) => value === undefined ? null : JSON.parse(JSON.stringify(value));
const setAt = (value, keys, next) => {
  if (!keys.length) return clone(next);
  const result = value && typeof value === "object" ? clone(value) : {};
  let parent = result;
  keys.slice(0, -1).forEach((key) => { parent = parent[key] ||= {}; });
  if (next === null) delete parent[keys.at(-1)]; else parent[keys.at(-1)] = clone(next);
  return result;
};
const describePath = (path) => {
  const [collection, shopID, bucket, id, ...fields] = clean(path).split("/");
  if (collection !== "shops" || !shopID || !id) return null;
  const kind = bucket === "allItems" ? "products" : bucket === "personnelPins" ? "users" : /^[a-zA-Z]+Orders$/.test(bucket) ? "orders" : null;
  return kind ? { kind, shopID, id, fields, path: `shops/${shopID}/${bucket}/${id}` } : null;
};
const flatten = async (db, updates) => {
  const entities = new Map();
  const collect = async (path, value) => {
    const parts = clean(path).split("/");
    if (parts[0] === "shops" && parts.length === 2 && value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) await collect(`${path}/${key}`, entry);
      return;
    }
    if (parts[0] === "shops" && parts.length === 3 && ["allItems", "personnelPins", "activeOrders", "pastOrders", "tableActiveOrders", "dineInOrders", "canceledOrders", "returnedOrders", "exchangedOrders"].includes(parts[2])) {
      const previous = (await db.ref(path).once("value")).val() || {};
      for (const id of new Set([...Object.keys(previous), ...Object.keys(value || {})])) await collect(`${path}/${id}`, value?.[id] ?? null);
      return;
    }
    if (parts[0] === "shops" && parts.length === 3 && parts[2] === "isDeleted" && value === true) {
      for (const bucket of ["allItems", "personnelPins"]) {
        const previous = (await db.ref(`shops/${parts[1]}/${bucket}`).once("value")).val() || {};
        for (const id of Object.keys(previous)) await collect(`shops/${parts[1]}/${bucket}/${id}`, null);
      }
      return;
    }
    const descriptor = describePath(path);
    if (!descriptor) return;
    if (!entities.has(descriptor.path)) {
      const before = (await db.ref(descriptor.path).once("value")).val();
      entities.set(descriptor.path, { ...descriptor, before, after: clone(before) });
    }
    const entity = entities.get(descriptor.path);
    entity.after = setAt(entity.after, descriptor.fields, value);
  };
  for (const [path, value] of Object.entries(updates)) await collect(path, value);
  return [...entities.values()];
};
export const createPlanDatabase = (database) => {
  if (database[RAW]) return database;
  const db = database;
  const settle = async (reservations, committed) => {
    const results = await Promise.allSettled(reservations.map((reservation) => finishReservation({ db, reservation, committed })));
    if (results.some((result) => result.status === "rejected")) {
      // Keep the operation marker and pending capacity: the next write can recover it.
      return false;
    }
    return true;
  };
  const prepare = async (updates, token) => {
    const entities = await flatten(db, updates), groups = new Map(), subscriptions = new Map();
    const contextFor = async (shopID) => {
      if (!subscriptions.has(shopID)) subscriptions.set(shopID, await loadSubscription({ db, shopID }));
      return subscriptions.get(shopID);
    };
    const change = (subscription, kind, key, before, after) => {
      const groupKey = `${subscription.rootShopID}/${kind}`;
      if (!groups.has(groupKey)) groups.set(groupKey, { subscription, kind, adds: [], removes: [], targets: Object.keys(updates) });
      const group = groups.get(groupKey);
      if (after) group.adds.push(key);
      else if (before) group.removes.push(key);
    };
    for (const entity of entities) {
      let subscription;
      try { const root = updates[`shops/${entity.shopID}`]?.subscriptionRootID; subscription = await contextFor(root && !entity.before ? root : entity.shopID); }
      catch (error) {
        // A newly reserved branch has not been linked to the account yet.
        const root = updates[`shops/${entity.shopID}`]?.subscriptionRootID;
        if (!root || entity.before) throw error;
        subscription = await contextFor(root);
      }
      if (!subscription.license.isUsable) throw planError("LICENSE_DISABLED", "Subscription đang bị tạm khóa.", { shopID: entity.shopID, subscription, license: subscription.license });
      await assertSubscriptionAccess({ db, subscription, role: "owner" });
      const actor = planRequestContext.getStore()?.req?.user;
      if (actor?.shopID === entity.shopID) await assertSubscriptionAccess({ db, subscription, mobileNumber: actor.mobileNumber, role: actor.role });
      if (entity.kind === "orders") {
        if (hasData(entity.after) && !hasData(entity.before) && !await orderExists({ db, shopID: entity.shopID, id: entity.id })) change(subscription, "orders", entityKey(entity.shopID, entity.id), false, true);
        const source = String(entity.after?.source || entity.after?.platform || entity.after?.marketplace || "").toLowerCase();
        if (/shopee|tiktok|customer|online/.test(source) && !subscription.features.onlineSales) throw planError("PLAN_FEATURE_NOT_AVAILABLE", "Gói Free chưa hỗ trợ Bán online.", { shopID: entity.shopID, subscription, feature: "onlineSales" });
      } else if (entity.kind === "products") {
        change(subscription, "products", entityKey(entity.shopID, entity.id), hasData(entity.before), hasData(entity.after));
      } else {
        if (!hasData(entity.before) && hasData(entity.after) && entity.after?.role !== "owner" && !subscription.features.staff) throw planError("PLAN_FEATURE_NOT_AVAILABLE", "Gói Free không được tạo nhân viên.", { shopID: entity.shopID, subscription, feature: "staff" });
        const othershops = subscription.branchIDs.filter((id) => id !== entity.shopID);
        const other = await Promise.all(othershops.map(async (id) => { const changed = entities.find((entry) => entry.kind === "users" && entry.shopID === id && entry.id === entity.id); return changed ? { val: () => changed.after } : db.ref(`shops/${id}/personnelPins/${entity.id}`).once("value"); }));
        const activeElsewhere = other.some((snapshot) => snapshot.val() && snapshot.val().isActive !== false);
        const active = Boolean(entity.after && entity.after.isActive !== false);
        const key = entityKey(subscription.rootShopID, entity.id);
        change(subscription, "users", key, Boolean(entity.before), active || activeElsewhere);
        const payrollElsewhere = other.some((snapshot) => snapshot.val() && snapshot.val().isActive !== false && snapshot.val().role !== "owner" && snapshot.val().payrollEnabled !== false);
        const payroll = active && entity.after.role !== "owner" && entity.after.payrollEnabled !== false;
        change(subscription, "payroll", key, Boolean(entity.before), payroll || payrollElsewhere);
      }
    }
    for (const [path, value] of Object.entries(updates)) {
      const match = /^shops\/([^/]+)\/subscriptionBranches\/([^/]+)$/.exec(path);
      if (match) {
        const subscription = await contextFor(match[1]);
        const before = (await db.ref(path).once("value")).val();
        change(subscription, "shops", entityKey(subscription.rootShopID, match[2]), Boolean(before), Boolean(value));
      }
    }
    // New shops belong to the same subscription and reserve one of its branch slots.
    for (const [path, value] of Object.entries(updates)) {
      if (/^shops\/[^/]+$/.test(path) && value?.subscriptionRootID && value.subscriptionRootID !== path.split("/")[1]) {
        const shopID = path.split("/")[1];
        if (!(await db.ref(path).once("value")).exists()) {
          const subscription = await contextFor(value.subscriptionRootID);
          change(subscription, "shops", entityKey(subscription.rootShopID, shopID), false, true);
        }
      }
    }
    const reservations = [];
    try {
      for (const group of groups.values()) {
        // Finish writes that committed to Firebase before a previous process stopped.
        const path = `subscriptionUsage/${group.subscription.rootShopID}/${group.kind}/${group.kind === "orders" ? group.subscription.period.key : "current"}`;
        const pending = (await db.ref(`${path}/pending`).once("value")).val() || {};
        for (const pendingToken of Object.keys(pending)) {
          const marker = (await db.ref(`subscriptionOperations/${group.subscription.rootShopID}/${pendingToken}`).once("value")).val();
          const targets = pending[pendingToken].targets || [];
          const snapshots = !marker && targets.length ? await Promise.all(targets.map((target) => db.ref(target).once("value"))) : [];
          if (marker || snapshots.some((snapshot) => snapshot.val()?._subscriptionMutationID === pendingToken)) await finishReservation({ db, reservation: { path, token: pendingToken, reserved: true }, committed: true });
        }
        reservations.push(await reserveResources({ db, ...group, token }));
      }
      return reservations;
    } catch (error) { await settle(reservations, false); throw error; }
  };
  const write = async (updates) => {
    const token = randomUUID(), reservations = await prepare(updates, token);
    const markers = {};
    reservations.filter((item) => item.reserved).forEach((item) => { markers[`subscriptionOperations/${item.path.split("/")[1]}/${token}`] = { committedAt: Date.now() }; });
    try {
      await db.ref().update({ ...updates, ...markers });
    } catch (error) { await settle(reservations, false); throw error; }
    if (await settle(reservations, true)) await Promise.all(Object.keys(markers).map((path) => db.ref(path).remove().catch(() => {})));
  };
  const noteError = (error) => { if (error.code?.startsWith("PLAN_") || error.code?.startsWith("LICENSE_")) { const context = planRequestContext.getStore(); if (context) context.error = error; } throw error; };
  const callbackPromise = (promise, callback) => { if (typeof callback === "function") promise.then(() => callback(null), (error) => callback(error)); return promise; };
  const wrap = (ref, path, pushedPromise) => new Proxy(ref, { get(target, property) {
    if (property === "child") return (child) => wrap(target.child(child), clean(`${path}/${child}`));
    if (property === "set") return (value, callback) => callbackPromise(write({ [path]: value }).catch(noteError), callback);
    if (property === "update") return (values, callback) => callbackPromise(write(Object.fromEntries(Object.entries(values).map(([key, value]) => [clean(`${path}/${key}`), value]))).catch(noteError), callback);
    if (property === "remove") return (callback) => callbackPromise(write({ [path]: null }).catch(noteError), callback);
    if (property === "push") return (...args) => {
      const child = target.push(), childPath = clean(`${path}/${child.key}`);
      if (!args.length || args[0] === undefined) return wrap(child, childPath);
      const promise = write({ [childPath]: args[0] }).catch(noteError);
      callbackPromise(promise, args[1]);
      return wrap(child, childPath, promise);
    };
    if (pushedPromise && property === "then") return (resolve, reject) => pushedPromise.then(() => target).then(resolve, reject);
    if (pushedPromise && property === "catch") return (reject) => pushedPromise.catch(reject);
    if (property === "transaction") return (updater, onComplete, applyLocally) => {
      const promise = (async () => {
        const current = (await target.once("value")).val();
        const described = describePath(path);
        const newShop = /^shops\/[^/]+$/.test(path) && current === null;
        if (!described && !newShop) return target.transaction(updater, undefined, applyLocally);
        const prospective = updater(clone(current));
        if (prospective === undefined) return target.transaction(updater, undefined, applyLocally);
        const token = randomUUID(), reservations = await prepare({ [path]: prospective }, token);
        let result;
        try {
          result = await target.transaction((value) => {
            const next = updater(value);
            if (hasData(next) && typeof next === "object" && value === null) return { ...next, _subscriptionMutationID: token };
            return next;
          }, undefined, applyLocally);
        } catch (error) { await settle(reservations, false); throw error; }
        if (result.committed) {
          const roots = new Set(reservations.filter((item) => item.reserved).map((item) => item.path.split("/")[1]));
          await Promise.all([...roots].map((root) => db.ref(`subscriptionOperations/${root}/${token}`).set({ committedAt: Date.now() })));
        }
        if (await settle(reservations, result.committed)) {
          const roots = new Set(reservations.filter((item) => item.reserved).map((item) => item.path.split("/")[1]));
          await Promise.all([...roots].map((root) => db.ref(`subscriptionOperations/${root}/${token}`).remove().catch(() => {})));
        }
        return result;
      })().catch(noteError);
      if (typeof onComplete === "function") promise.then((result) => onComplete(null, result.committed, result.snapshot), (error) => onComplete(error, false, null));
      return promise;
    };
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  return new Proxy(database, { get(target, property) {
    if (property === RAW) return db;
    if (property === "ref") return (path) => wrap(db.ref(path), clean(path));
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
};
