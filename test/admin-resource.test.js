import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createMemoryDatabase } from "./FirebaseMemory.js";
import { createAdminRouter } from "../server/admin-router.js";
import { createPlanDatabase } from "../server/subscriptions/PlanDatabase.js";
import { createAdminReadContext } from "../server/admin-read.js";
import { recentAdminOrders } from "../server/admin-overview.js";
import { summarizeStore, normalizeOrder } from "../server/store-summary.js";
import { monthPeriod } from "../server/subscriptions/PlanCatalog.js";

const now = Date.now(), iso = (offset) => new Date(now + offset).toISOString();
const fixture = () => ({
  shops: {
    root: {
      basicInfo: { name: "Trung tâm", address: "Địa chỉ thử", packageInfo: { packageType: "plus" } },
      license: { plan: "plus", isActive: true, startAt: "2026-01-01", expiredAt: "2099-01-01" },
      subscriptionRootID: "root", subscriptionBranches: { root: true, branch: true, deleted: true }, subscriptionUsageStartedAt: 1,
      personnelPins: { owner: { role: "owner", personnelName: "Chủ thử", isActive: true }, staff: { role: "cashier", isActive: false } },
      activeOrders: { pending: { total: 1, timeStamp: iso(0) } },
      pastOrders: { recent: { total: 3500, closedAt: iso(-86400000), orderItems: [{ quantity: 2 }] }, old: { total: 9e9, closedAt: iso(-90 * 86400000) } },
      canceledOrders: { canceled: { total: 100, timeStamp: iso(-1000) } }, returnedOrders: {},
      allItems: { productA: { image: "private-catalog-data".repeat(40_000) }, productB: {} }, customers: { one: {}, two: {} },
      inventory: { low: { quantity: 1, minQuantity: 3 }, ok: { quantity: 10, minQuantity: 1 } },
      integrations: { privateToken: "never-download-in-admin-lists".repeat(20_000) }
    },
    branch: { basicInfo: { name: "Chi nhánh" }, subscriptionRootID: "root", activeOrders: {}, pastOrders: { sale: { total: 200, closedAt: iso(-1000) } } },
    deleted: { isDeleted: true, subscriptionRootID: "root", basicInfo: { name: "Đã xóa" }, privateHistory: "large-deleted-data".repeat(50_000) },
    removedRoot: { isDeleted: true, basicInfo: { name: "Trung tâm đã xóa" } },
    orphan: { subscriptionRootID: "removedRoot", basicInfo: { name: "Chi nhánh không còn khả dụng" } }
  },
  users: { owner: { password: "never-read-global-password", notificationTokens: { token: "private-device-token" }, shops: { root: { role: "owner", personnelName: "Chủ thử" } } }, unassigned: {} },
  subscriptionUsage: { root: Object.fromEntries(["orders", "products", "users", "shops", "payroll"].map((kind) => [kind, {
    [kind === "orders" ? monthPeriod(now).key : "current"]: { entries: { first: true }, pending: kind === "orders" ? { reserved: { adds: ["second"], removes: [] } } : {} }
  }])) }
});
const boundedDatabase = (initial) => {
  const raw = createMemoryDatabase(initial), ref = raw.ref.bind(raw);
  raw.listKeys = async (path) => {
    raw.reads.push(`${path}?shallow=true`);
    const value = path.split("/").reduce((node, key) => node?.[key], raw.data);
    return value && typeof value === "object" ? Object.keys(value) : [];
  };
  raw.ref = (path) => {
    if (["shops", "users"].includes(path)) throw new Error(`Full tree reads are forbidden: ${path}`);
    return ref(path);
  };
  return raw;
};
const serve = async (t, raw, adminReadOptions) => {
  const app = express(); app.use(express.json());
  app.use("/api/admin", createAdminRouter({ db: createPlanDatabase(raw), adminReadOptions, authenticate(req, res, next) { req.adminUser = { username: "isolated-test-admin" }; next(); } }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  return `http://127.0.0.1:${server.address().port}/api/admin`;
};

test("overview keeps totals and recent orders while excluding full database trees, catalogs and credentials", async (t) => {
  const initial = fixture(), raw = boundedDatabase(initial), before = structuredClone(raw.data), url = await serve(t, raw);
  const response = await fetch(url + "/overview?days=30"); assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.totals.revenue, 3700); assert.equal(result.totals.orderCount, 2); assert.equal(result.totals.storeCount, 2); assert.equal(result.totals.userCount, 2);
  assert.deepEqual(result.stores.map((store) => store.id).sort(), ["branch", "root"]);
  for (const [id, original] of Object.entries(initial.shops).filter(([id]) => ["root", "branch"].includes(id))) assert.deepEqual(result.stores.find((store) => store.id === id), summarizeStore(id, original, 30));
  assert.equal(result.recentOrders.length, 4); assert.ok(!result.recentOrders.some((order) => order.id === "old"));
  assert.ok(raw.reads.includes("shops/root/allItems?shallow=true"));
  for (const forbidden of ["shops/root/allItems", "shops/root/integrations", "shops/deleted/privateHistory", "users/owner/password", "users/owner/notificationTokens"]) assert.ok(!raw.reads.includes(forbidden), forbidden);
  assert.deepEqual(raw.writes, []); assert.deepEqual(raw.data, before);
  assert.ok(JSON.stringify(result).length < 20_000);
});

test("subscription list uses existing meters including pending capacity and performs no catalog/history reads or writes", async (t) => {
  const raw = boundedDatabase(fixture()), before = structuredClone(raw.data), url = await serve(t, raw);
  const response = await fetch(url + "/subscriptions"); assert.equal(response.status, 200);
  const { subscriptions } = await response.json();
  assert.equal(subscriptions.length, 1); assert.equal(subscriptions[0].shopId, "root");
  assert.equal(subscriptions[0].usage.orders.used, 2);
  assert.deepEqual(subscriptions[0].branchIDs.sort(), ["branch", "root"]);
  assert.ok(!raw.reads.some((path) => /\/allItems|\/pastOrders|\/activeOrders|\/inventory/.test(path)));
  assert.deepEqual(raw.writes, []); assert.deepEqual(raw.data, before);
});

test("user list and picker read only memberships/store metadata without downloading password or device records", async (t) => {
  const raw = boundedDatabase(fixture()), url = await serve(t, raw);
  const users = await (await fetch(url + "/users")).json();
  assert.equal(users.users.length, 2); assert.equal(users.users[0].stores[0].shopName, "Trung tâm");
  assert.ok(raw.reads.includes("users/owner/shops"));
  assert.ok(!raw.reads.includes("users/owner")); assert.deepEqual(raw.writes, []);
  raw.reads.length = 0;
  const response = await fetch(url + "/store-options"); assert.equal(response.status, 200);
  const payload = await response.json(); assert.equal(payload.stores.length, 2);
  assert.deepEqual(Object.keys(payload.stores[0]).sort(), ["address", "id", "name", "status"]);
  assert.ok(!raw.reads.some((path) => /Orders|allItems|customers|subscriptionUsage/.test(path)));
});

test("legacy grouping and missing usage meters remain accurate without silently migrating data on GET", async (t) => {
  const raw = boundedDatabase({ shops: {
    root: { basicInfo: { name: "Legacy" }, license: { plan: "plus", isActive: true, expiredAt: "2099-01-01" }, personnelPins: { owner: { role: "owner" } }, allItems: { product: {} } },
    branch: { basicInfo: { branchInfo: { parentShopID: "root" } }, personnelPins: { owner: { role: "owner" } } }
  }, users: { owner: { shops: { root: { role: "owner" }, branch: { role: "owner" } } } } });
  const before = structuredClone(raw.data), url = await serve(t, raw);
  const response = await fetch(url + "/subscriptions"); assert.equal(response.status, 200);
  const payload = await response.json(); assert.equal(payload.subscriptions.length, 1);
  assert.deepEqual(payload.subscriptions[0].branchIDs.sort(), ["branch", "root"]);
  assert.equal(payload.subscriptions[0].usage.users.used, 1); assert.equal(payload.subscriptions[0].usage.products.used, 1); assert.equal(payload.subscriptions[0].usage.shops.used, 2);
  assert.deepEqual(raw.writes, []); assert.deepEqual(raw.data, before);
});

test("recent-order selection normalizes only the final 12 rows even with a large history", () => {
  let itemReads = 0;
  const pastOrders = Object.fromEntries(Array.from({ length: 5000 }, (_, index) => {
    const order = { closedAt: iso(-index * 1000), total: index, customerName: "Thử" };
    Object.defineProperty(order, "orderItems", { get() { itemReads++; return [{ quantity: 2 }]; } });
    return [`order-${index}`, order];
  }));
  const result = recentAdminOrders("root", { basicInfo: { name: "Thử" }, pastOrders }, { days: 30, now });
  assert.equal(result.length, 12); assert.equal(result[0].id, "order-0"); assert.equal(result[11].id, "order-11");
  assert.equal(itemReads, 24);
  assert.deepEqual(result, Object.entries(pastOrders).slice(0, 12).map(([id, order]) => normalizeOrder("root", "Thử", "pastOrders", id, order)));
});

test("request-scoped read context prevents accidental writes and does not reuse stale state across requests", async () => {
  const raw = boundedDatabase({ shops: { root: { basicInfo: { name: "Before" } } } });
  const first = createAdminReadContext(raw); assert.equal((await first.read("shops/root/basicInfo")).val().name, "Before");
  raw.write("shops/root/basicInfo/name", "After");
  assert.equal((await first.read("shops/root/basicInfo")).val().name, "Before");
  assert.equal((await createAdminReadContext(raw).read("shops/root/basicInfo")).val().name, "After");
  assert.throws(() => first.db.ref("shops/root").update({ value: true }), /cannot mutate/);
});

test("shallow store discovery excludes malformed primitive records while retaining legacy objects without basicInfo", async () => {
  const raw = boundedDatabase({ shops: { badFlag: false, badText: "invalid-record", legacy: { pastOrders: { one: { total: 1 } } } } });
  const profiles = await createAdminReadContext(raw).loadShopProfiles();
  assert.deepEqual(Object.keys(profiles), ["legacy"]);
});

test("nested, shallow and uncached reads share a concurrency bound, deduplicate requests and recover slots after failure", async () => {
  let active = 0, peak = 0;
  const calls = new Map();
  const io = async (key, value) => {
    calls.set(key, (calls.get(key) || 0) + 1); active++; peak = Math.max(peak, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 2));
      if (key === "error") throw new Error("isolated-read-failure");
      return value;
    } finally { active--; }
  };
  const raw = {
    listKeys: (path) => io(`keys:${path}`, ["one", "two"]),
    ref(path) {
      const ref = { once: () => io(path, { val: () => ({ path }), exists: () => true }), orderByChild: () => ref, endAt: () => ref };
      return ref;
    }
  };
  const context = createAdminReadContext(raw, { concurrency: 3 });
  const results = await Promise.allSettled([
    ...Array.from({ length: 20 }, (_, index) => context.read(`row-${index}`)),
    context.read("same"), context.read("same"), context.keys("directory"), context.keys("directory"),
    context.readUncached("large-bucket"), context.db.ref("query").orderByChild("createdAt").endAt(10).once("value"), context.read("error")
  ]);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(peak, 3); assert.equal(active, 0);
  assert.equal(calls.get("same"), 1); assert.equal(calls.get("keys:directory"), 1);
  assert.equal((await context.read("after-error")).val().path, "after-error");
});

test("Vercel parallel reads preserve complete admin responses and never initialize business data", async (t) => {
  const raw = boundedDatabase(fixture()), before = structuredClone(raw.data);
  const conservative = await serve(t, raw, { concurrency: 4, storeConcurrency: 2 });
  const parallel = await serve(t, raw, { concurrency: 16, storeConcurrency: 8 });
  for (const path of ["/overview?days=30", "/subscriptions", "/users", "/store-options"]) {
    const original = await fetch(conservative + path), optimized = await fetch(parallel + path);
    assert.equal(original.status, 200); assert.equal(optimized.status, 200);
    assert.deepEqual(await optimized.json(), await original.json(), path);
  }
  assert.deepEqual(raw.writes, []); assert.deepEqual(raw.data, before);
});

test("subscription reporting tolerates empty pending arrays omitted by the database without changing reservations", async (t) => {
  const initial = fixture();
  initial.subscriptionUsage.root.users.current = { entries: { owner: true }, pending: {
    adding: { adds: ["new-user"], createdAt: now },
    removing: { removes: ["old-user"], createdAt: now },
    empty: { createdAt: now }
  } };
  const raw = boundedDatabase(initial), before = structuredClone(raw.data), url = await serve(t, raw);
  const response = await fetch(url + "/subscriptions");
  assert.equal(response.status, 200);
  const { subscriptions } = await response.json();
  assert.equal(subscriptions.find((item) => item.shopId === "root").usage.users.used, 2);
  assert.deepEqual(raw.data, before);
  assert.deepEqual(raw.writes, []);
});
