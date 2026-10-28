import { resolveSubscriptionGroup } from "./ResolveSubscriptionGroup.js";
import { createHash } from "crypto";
import { PLANS, resolvePlan, monthPeriod, timestamp, planError } from "./PlanCatalog.js";
export const entityKey = (shopID, id) => createHash("sha256").update(`${shopID}/${id}`).digest("hex").slice(0, 32);
const validID = (id) => typeof id === "string" && id.length > 0 && !/[.#$\[\]/\u0000-\u001f]/.test(id);
export const loadSubscription = async ({ db, shopID, now = Date.now() }) => {
  if (!validID(shopID)) throw planError("PLAN_SHOP_INVALID", "Mã cửa hàng không hợp lệ.");
  const rawDB = db[Symbol.for("poso.rawPlanDatabase")] || db;
  const group = await resolveSubscriptionGroup({ db: rawDB, shopID });
  const rootShopID = group.rootShopID;
  if (!validID(rootShopID)) throw planError("PLAN_SHOP_INVALID", "Subscription không hợp lệ.");
  const [license, info, branches, deleted, usageStarted] = await Promise.all([
    db.ref(`shops/${rootShopID}/license`).once("value"), db.ref(`shops/${rootShopID}/subscriptionInfo/packageInfo`).once("value"),
    db.ref(`shops/${rootShopID}/subscriptionBranches`).once("value"), db.ref(`shops/${rootShopID}/isDeleted`).once("value"), db.ref(`shops/${rootShopID}/subscriptionUsageStartedAt`).once("value"),
  ]);
  if (deleted.val() === true) throw planError("PLAN_SHOP_UNAVAILABLE", "Cửa hàng trung tâm đã ngừng hoạt động.");
  const branchMap = { [rootShopID]: true, ...(branches.val() || {}), ...Object.fromEntries((group.branchIDs || []).map((id) => [id, true])) };
  if (rootShopID !== shopID && !branchMap[shopID]) throw planError("PLAN_BRANCH_NOT_AVAILABLE", "Gian hàng chưa thuộc subscription này.", { shopID, rootShopID });
  const subscription = resolvePlan(license.val(), info.val() || {}, now);
  const result = { ...subscription, rootShopID, shopID, branchIDs: Object.keys(branchMap).filter((key) => branchMap[key]), period: monthPeriod(now), usageStartedAt: usageStarted.val() };
  if (group.updates) {
    // Seed usage before publishing canonical links, retaining all previously consumed orders.
    for (const kind of ["orders", "products", "users", "shops", "payroll"]) {
      const entries = await baselineEntries({ db: rawDB, subscription: { ...result, usageStartedAt: null }, kind });
      for (const branchID of result.branchIDs) {
        if (["orders", "products"].includes(kind) && branchID !== rootShopID) {
          const previous = (await rawDB.ref(`subscriptionUsage/${branchID}/${kind}/${kind === "orders" ? result.period.key : "current"}/entries`).once("value")).val() || {};
          Object.assign(entries, previous);
        }
      }
      await rawDB.ref(meterPath(result, kind)).transaction((current) => ({ ...current, entries: { ...entries, ...current?.entries }, initializedAt: current?.initializedAt || Date.now() }));
    }
    result.usageStartedAt = Date.now();
    await rawDB.ref().update({ ...group.updates, [`shops/${rootShopID}/subscriptionUsageStartedAt`]: result.usageStartedAt });
  }
  return result;
};
export const assertFeature = async ({ db, shopID, feature }) => {
  const subscription = await loadSubscription({ db, shopID });
  if (!subscription.license.isUsable || !subscription.features[feature]) throw planError("PLAN_FEATURE_NOT_AVAILABLE", `Gói ${subscription.name} chưa hỗ trợ ${feature === "eInvoice" ? "Hóa đơn điện tử" : feature === "payroll" ? "chấm công tính lương" : feature === "staff" ? "nhân viên" : "Bán online"}.`, { shopID, subscription, feature });
  await assertSubscriptionAccess({ db, subscription, role: "owner" });
  return subscription;
};
export const assertSubscriptionAccess = async ({ db, subscription, mobileNumber, role }) => {
  const { shopID, rootShopID, limits } = subscription;
  const allowedBranches = [rootShopID, ...subscription.branchIDs.filter((id) => id !== rootShopID).sort()].slice(0, limits.shops);
  if (!allowedBranches.includes(shopID)) throw planError("PLAN_BRANCH_NOT_AVAILABLE", `Gói ${subscription.name} chỉ sử dụng được ${limits.shops} gian hàng. Vui lòng chuyển về cửa hàng trung tâm hoặc nâng gói.`, { shopID, rootShopID, subscription });
  if (role === "owner" || limits.users === null) return;
  const records = await Promise.all(allowedBranches.map((id) => db.ref(`shops/${id}/personnelPins`).once("value")));
  const people = new Map();
  records.forEach((record) => Object.entries(record.val() || {}).forEach(([id, person]) => { if (person.isActive !== false) people.set(id, person); }));
  const eligible = [...people].sort(([a, x], [b, y]) => Number(y.role === "owner") - Number(x.role === "owner") || a.localeCompare(b)).slice(0, limits.users).map(([id]) => id);
  if (!eligible.includes(mobileNumber)) throw planError("PLAN_USER_NOT_AVAILABLE", `Gói ${subscription.name} cho phép tối đa ${limits.users} tài khoản hoạt động. Vui lòng liên hệ chủ cửa hàng.`, { shopID, subscription });
};
const ORDER_BUCKETS = ["activeOrders", "pastOrders", "tableActiveOrders", "dineInOrders", "canceledOrders", "returnedOrders", "exchangedOrders"];
export const orderExists = async ({ db, shopID, id }) => (await Promise.all(ORDER_BUCKETS.map((bucket) => db.ref(`shops/${shopID}/${bucket}/${id}`).once("value")))).some((snapshot) => snapshot.exists());
export const meterPath = (subscription, kind) => `subscriptionUsage/${subscription.rootShopID}/${kind}/${kind === "orders" ? subscription.period.key : "current"}`;
const baselineEntries = async ({ db, subscription, kind }) => {
  const entries = {};
  if (kind === "orders" && subscription.usageStartedAt && subscription.usageStartedAt <= subscription.period.startAt) return entries;
  if (kind === "shops") { subscription.branchIDs.forEach((id) => { entries[entityKey(subscription.rootShopID, id)] = true; }); return entries; }
  for (const shopID of subscription.branchIDs) {
    if (kind === "orders") {
      for (const bucket of ORDER_BUCKETS) {
        const ref = db.ref(`shops/${shopID}/${bucket}`);
        // Old orders are indexed by timestamp; only the current Vietnam month is bootstrapped.
        const snapshots = typeof ref.orderByChild === "function" && typeof ref.startAt === "function"
          ? await Promise.all([ref.orderByChild("timeStamp").startAt(new Date(subscription.period.startAt).toISOString()).endAt(new Date(subscription.period.endAt - 1).toISOString()).once("value"), ref.orderByChild("timeStamp").startAt(subscription.period.startAt).endAt(subscription.period.endAt - 1).once("value")])
          : [await ref.once("value")];
        snapshots.forEach((snapshot) => Object.entries(snapshot.val() || {}).forEach(([id, order]) => {
          const created = timestamp(order.createdAt || order.timeStamp || order.created_at);
          if (created >= subscription.period.startAt && created < subscription.period.endAt) entries[entityKey(shopID, id)] = true;
        }));
      }
    } else {
      const snapshot = await db.ref(`shops/${shopID}/${kind === "products" ? "allItems" : "personnelPins"}`).once("value");
      Object.entries(snapshot.val() || {}).forEach(([id, value]) => {
        if (!value || (kind !== "products" && value.isActive === false)) return;
        if (kind === "payroll" && (value.role === "owner" || value.payrollEnabled === false)) return;
        entries[kind === "products" ? entityKey(shopID, id) : entityKey(subscription.rootShopID, id)] = true;
      });
    }
  }
  return entries;
};
export const ensureMeter = async ({ db, subscription, kind }) => {
  const path = meterPath(subscription, kind), ref = db.ref(path);
  const existing = (await ref.once("value")).val();
  if (existing) return { path, value: existing };
  const entries = await baselineEntries({ db, subscription, kind });
  const result = await ref.transaction((current) => current || { entries, initializedAt: Date.now() });
  return { path, value: result.snapshot.val() };
};
const allocated = (meter = {}) => Object.keys(meter.entries || {}).length + Object.values(meter.pending || {}).reduce((sum, operation) => sum + Math.max(0, operation.adds.length - operation.removes.length), 0);
export const reserveResources = async ({ db, subscription, kind, adds = [], removes = [], targets = [], token }) => {
  const meter = await ensureMeter({ db, subscription, kind });
  const limit = subscription.limits[{ orders: "monthlyOrders" }[kind] || kind];
  let failure;
  const result = await db.ref(meter.path).transaction((current) => {
    current = current || { entries: {} }; failure = null;
    const entries = current.entries || {}, pending = current.pending || {};
    const newKeys = [...new Set(adds)].filter((key) => !entries[key]);
    const deletedKeys = [...new Set(removes)].filter((key) => entries[key]);
    const busy = new Set(Object.values(pending).flatMap((operation) => [...operation.adds, ...operation.removes]));
    if ([...adds, ...removes].some((key) => busy.has(key))) { failure = planError("PLAN_OPERATION_IN_PROGRESS", "Dữ liệu đang được xử lý. Vui lòng thử lại sau."); return; }
    if (!newKeys.length && !deletedKeys.length) return current;
    const increase = Math.max(0, newKeys.length - deletedKeys.length);
    const used = allocated(current);
    if (limit !== null && increase > 0 && used + increase > limit) {
      const label = { orders: "đơn hàng trong tháng", products: "sản phẩm", users: "tài khoản hoạt động", shops: "gian hàng", payroll: "nhân viên chấm công tính lương" }[kind];
      failure = planError(`PLAN_${kind.toUpperCase()}_LIMIT`, `Gói ${subscription.name} cho phép tối đa ${limit} ${label}. Vui lòng nâng gói hoặc giảm số lượng trước khi tạo thêm.`, { shopID: subscription.shopID, subscription, resource: kind, limit, used, requested: increase }); return;
    }
    return { ...current, pending: { ...pending, [token]: { adds: newKeys, removes: deletedKeys, createdAt: Date.now(), targets } } };
  });
  if (!result.committed) throw failure || planError("PLAN_RESERVATION_FAILED", "Không thể kiểm tra hạn mức. Vui lòng thử lại.");
  return { path: meter.path, token, reserved: Boolean(result.snapshot.val()?.pending?.[token]) };
};
export const finishReservation = async ({ db, reservation, committed }) => {
  if (!reservation?.reserved) return;
  await db.ref(reservation.path).transaction((meter) => {
    const operation = meter?.pending?.[reservation.token];
    if (!operation) return meter;
    const entries = { ...meter.entries }, pending = { ...meter.pending };
    if (committed) { operation.adds.forEach((key) => { entries[key] = true; }); operation.removes.forEach((key) => { delete entries[key]; }); }
    delete pending[reservation.token];
    return { ...meter, entries, pending, updatedAt: Date.now() };
  });
};
export const subscriptionUsage = async ({ db, subscription }) => {
  const usage = {};
  for (const kind of ["orders", "products", "users", "shops", "payroll"]) {
    const meter = await ensureMeter({ db, subscription, kind });
    const limit = subscription.limits[kind === "orders" ? "monthlyOrders" : kind];
    const used = allocated(meter.value);
    usage[kind] = { used, limit, remaining: limit === null ? null : Math.max(0, limit - used) };
  }
  return usage;
};
export const getPlanDefinitions = () => Object.values(PLANS);
export const assertPayrollParticipant = async ({ db, shopID, personnelID }) => {
  const subscription = await assertFeature({ db, shopID, feature: "payroll" });
  const records = await Promise.all(subscription.branchIDs.map((id) => db.ref(`shops/${id}/personnelPins`).once("value")));
  const people = new Map(); let target;
  records.forEach((snapshot, index) => Object.entries(snapshot.val() || {}).forEach(([id, person]) => {
    if (subscription.branchIDs[index] === shopID && person.personnelID === personnelID) target = { id, ...person };
    if (person.isActive !== false && person.role !== "owner" && person.payrollEnabled !== false) people.set(id, person);
  }));
  if (!target || target.isActive === false || target.payrollEnabled === false || target.role === "owner") throw planError("PLAN_PAYROLL_NOT_ENABLED", "Nhân viên chưa được bật chấm công tính lương. Vui lòng cập nhật trong quản lý nhân viên.", { shopID, subscription });
  const eligible = [...people.keys()].sort().slice(0, subscription.limits.payroll);
  if (!eligible.includes(target.id)) throw planError("PLAN_PAYROLL_LIMIT", `Gói ${subscription.name} chỉ hỗ trợ ${subscription.limits.payroll} nhân viên chấm công tính lương.`, { shopID, subscription, resource: "payroll", used: people.size, limit: subscription.limits.payroll });
};
