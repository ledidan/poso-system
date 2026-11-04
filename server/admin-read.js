const RAW = Symbol.for("poso.rawPlanDatabase");
const queryMethods = new Set(["orderByChild", "orderByKey", "startAt", "endAt", "equalTo", "limitToFirst", "limitToLast"]);
const writeMethods = new Set(["set", "update", "remove", "push", "transaction"]);
const snapshot = (value) => ({ val: () => value, exists: () => value !== null && value !== undefined });

export const mapLimited = async (items, fn, concurrency = 4) => {
  const result = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) { const index = next++; result[index] = await fn(items[index], index); }
  }));
  return result;
};

// Request-scoped only. No shared in-flight I/O or stale authorization data across
// Worker requests. Preloaded metadata also serves legacy relationship resolution.
export const createAdminReadContext = (database, options = {}) => {
  const raw = database[RAW] || database;
  const concurrency = Math.max(1, Math.min(32, Math.trunc(Number(options.concurrency) || 4)));
  const storeConcurrency = Math.max(1, Math.min(concurrency, Math.trunc(Number(options.storeConcurrency) || 2)));
  const cached = new Map(), loaded = new Map(), keyCache = new Map();
  let active = 0;
  const pending = [];
  // One request-wide bound also covers nested group/usage lookups. A failing
  // read releases its slot so unrelated queued reads can still finish.
  const drain = () => {
    while (active < concurrency && pending.length) {
      const { work, resolve, reject } = pending.shift(); active++;
      Promise.resolve().then(work).then((value) => {
        active--; resolve(value); drain();
      }, (error) => {
        active--; reject(error); drain();
      });
    }
  };
  const schedule = (work) => new Promise((resolve, reject) => { pending.push({ work, resolve, reject }); drain(); });
  const read = (path) => {
    if (loaded.has(path)) return Promise.resolve(snapshot(loaded.get(path)));
    const parts = path.split("/");
    for (let length = parts.length - 1; length > 0; length--) {
      const parent = parts.slice(0, length).join("/");
      if (loaded.has(parent)) {
        const value = parts.slice(length).reduce((node, key) => node?.[key], loaded.get(parent));
        return Promise.resolve(snapshot(value ?? null));
      }
    }
    if (!cached.has(path)) cached.set(path, schedule(() => raw.ref(path).once("value")).then((result) => { loaded.set(path, result.val()); return snapshot(loaded.get(path)); }));
    return cached.get(path);
  };
  const keys = (path) => {
    if (!keyCache.has(path)) keyCache.set(path, typeof raw.listKeys === "function"
      ? schedule(() => raw.listKeys(path))
      : read(path).then((result) => { const value = result.val(); return value && typeof value === "object" ? Object.keys(value) : []; }));
    return keyCache.get(path);
  };
  const wrap = (path, ref, query = "") => new Proxy(ref, { get(target, property) {
    if (property === "once") return (event, callback) => {
      if (event !== "value") throw new Error("Only value snapshots are supported.");
      const key = `${path}${query}`;
      if (query && !cached.has(key)) cached.set(key, schedule(() => target.once(event)));
      const promise = query ? cached.get(key) : read(path);
      return promise.then((result) => { callback?.(result); return result; });
    };
    if (writeMethods.has(property)) return () => { throw new Error("Admin read requests cannot mutate data."); };
    if (property === "child") return (child) => wrap(`${path}/${child}`, target.child(child));
    if (queryMethods.has(property) && typeof target[property] === "function") return (...args) => wrap(path, target[property](...args), `${query}|${String(property)}:${JSON.stringify(args)}`);
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const db = { ref: (path) => wrap(path || "", path === undefined ? raw.ref() : raw.ref(path)) };
  db[RAW] = db;

  const loadShopProfiles = async ({ directoryOnly = false } = {}) => {
    const ids = await keys("shops"), shops = Object.create(null);
    await mapLimited(ids, async (id) => { shops[id] = { isDeleted: (await read(`shops/${id}/isDeleted`)).val() === true }; }, concurrency);
    const alive = ids.filter((id) => !shops[id].isDeleted);
    await mapLimited(alive, async (id) => { shops[id].subscriptionRootID = (await read(`shops/${id}/subscriptionRootID`)).val(); }, concurrency);
    const visible = alive.filter((id) => shops[shops[id].subscriptionRootID]?.isDeleted !== true);
    const invalid = new Set();
    await mapLimited(visible, async (id) => {
      // These are small records; catalogs, order history and integration payloads
      // are never part of the subscription directory response.
      const fields = directoryOnly ? ["basicInfo"] : ["basicInfo", "license", "subscriptionInfo/packageInfo", "subscriptionBranches", "subscriptionUsageStartedAt"];
      await Promise.all(fields.map(async (field) => {
        const value = (await read(`shops/${id}/${field}`)).val();
        if (field.includes("/")) shops[id].subscriptionInfo = { packageInfo: value };
        else shops[id][field] = field === "basicInfo" ? value || {} : value;
      }));
      const shop = shops[id];
      if (!shop.subscriptionRootID && !shop.license && !shop.subscriptionInfo?.packageInfo && !shop.subscriptionBranches && !shop.subscriptionUsageStartedAt && !Object.keys(shop.basicInfo || {}).length && !(await keys(`shops/${id}`)).length) invalid.add(id);
    }, concurrency);
    const active = Object.fromEntries(visible.filter((id) => !invalid.has(id)).map((id) => [id, shops[id]]));
    return active;
  };
  return { db, read, keys, loadShopProfiles, concurrency, storeConcurrency, readUncached: (path) => schedule(() => raw.ref(path).once("value")) };
};
