import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createAdminRouter } from "../server/admin-router.js";
import { createAuthRouter } from "../server/auth.js";
import { createPlanDatabase } from "../server/subscriptions/PlanDatabase.js";
import { createMemoryDatabase } from "./FirebaseMemory.js";
import { isoDate, readSubscription, buildSubscriptionUpdate, createTrial } from "../server/Subscription.js";
import { subscriptionDateInput, subscriptionDateISO, isExpiringSubscription } from "../src/SubscriptionDates.js";
const now = Date.parse("2026-10-16T06:30:20.123Z");
const record = () => ({ ...createTrial(now), basicInfo: { name: "Test shop" }, subscriptionRootID: "main", subscriptionBranches: { main: true }, personnelPins: { owner: { role: "owner" } } });
test("UTC date normalization and GMT+7 editing preserve the exact instant", () => {
  assert.equal(isoDate("2027-01-19"), "2027-01-19T00:00:00.000Z");
  assert.equal(isoDate("bad-date"), null);
  const iso = "2026-10-15T20:30:25.000Z";
  assert.equal(subscriptionDateInput(iso), "2026-10-16T03:30:25");
  assert.equal(subscriptionDateISO(subscriptionDateInput(iso)), iso);
});
test("registration grants Pro for 14 days then reports unlimited-time Free", () => {
  const shop = record();
  assert.equal(Date.parse(shop.license.expiredAt) - Date.parse(shop.license.startAt), 14 * 86400000);
  assert.equal(readSubscription(shop, now).effectivePlan, "pro");
  const expired = readSubscription(shop, now + 14 * 86400000);
  assert.equal(expired.effectivePlan, "free"); assert.equal(expired.isUnlimited, true);
  assert.equal(expired.limits.monthlyOrders, 300); assert.equal(expired.limits.products, 100);
});
test("canonical license wins over package hints and feature caps are fixed by the plan", () => {
  const shop = record(); shop.basicInfo.packageInfo = { packageType: "free", expiresAt: "2099-01-01" };
  const value = readSubscription(shop, now);
  assert.equal(value.effectivePlan, "pro"); assert.equal(value.expiresAt, shop.license.expiredAt);
  const lite = buildSubscriptionUpdate(shop, { packageType: "lite", status: "active", ordersLimit: 999999, expiresAt: "2027-01-01" }, now);
  assert.equal(lite.license.plan, "lite"); assert.equal(lite.packageInfo.ordersLimit, 600);
});
test("Free has no deadline, while paid plans require valid dates", () => {
  const shop = record();
  const free = buildSubscriptionUpdate(shop, { packageType: "free", status: "active", expiresAt: "" }, now);
  assert.equal(free.license.expiredAt, null); assert.equal(free.packageInfo.ordersLimit, 300);
  for (const input of [{ packageType: "plus", status: "active", expiresAt: "" }, { status: "other" }, { packageType: "unknown" }, { packageType: "lite", status: "trial" }]) assert.throws(() => buildSubscriptionUpdate(shop, input, now));
  const trial = buildSubscriptionUpdate(shop, { status: "trial", expiresAt: "2099-01-01" }, now);
  assert.equal(Date.parse(trial.license.expiredAt) - Date.parse(trial.license.startAt), 14 * 86400000);
});
test("Free never appears in the expiring-soon count", () => {
  assert.equal(isExpiringSubscription({ licenseStatus: "active", isUnlimited: true, expiresAt: new Date(now + 1000).toISOString() }, now), false);
  assert.equal(isExpiringSubscription({ licenseStatus: "trial", isUnlimited: false, expiresAt: new Date(now + 1000).toISOString() }, now), true);
});
const serverFor = async (t, raw) => {
  process.env.ADMIN_USERNAME = "subscription-admin"; process.env.ADMIN_PASSWORD = "subscription-test-password";
  process.env.ADMIN_SESSION_SECRET = "subscription-test-secret-over-32-characters";
  const app = express(); app.use(express.json()); app.use("/api/auth", createAuthRouter()); app.use("/api", createAdminRouter({ db: createPlanDatabase(raw) }));
  const server = app.listen(0); await new Promise((resolve) => server.once("listening", resolve)); t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD }) });
  const headers = { Cookie: login.headers.get("set-cookie").split(";")[0], "content-type": "application/json" };
  return { url, headers };
};
test("admin renewal synchronizes license and mirrors without resetting consumed usage", async (t) => {
  const raw = createMemoryDatabase({ shops: { main: record() }, subscriptionUsage: { main: { orders: { "2026-10": { entries: { used: true } } } } } });
  const { url, headers } = await serverFor(t, raw);
  const response = await fetch(`${url}/api/subscriptions/main`, { method: "PATCH", headers, body: JSON.stringify({ packageType: "plus", status: "active", expiresAt: "2027-01-01T09:30:00+07:00" }) });
  assert.equal(response.status, 200);
  assert.equal(raw.read("shops/main/license/plan"), "plus");
  assert.equal(raw.read("shops/main/license/expiredAt"), "2027-01-01T02:30:00.000Z");
  assert.equal(raw.read("shops/main/basicInfo/packageInfo/ordersLimit"), 1000);
  assert.deepEqual(raw.read("shops/main/basicInfo/packageInfo"), raw.read("shops/main/subscriptionInfo/packageInfo"));
  assert.equal(raw.read("subscriptionUsage/main/orders/2026-10/entries/used"), true);
});

test("suspending the reported Pro trial accepts the full form payload with SDK-compatible root references", async (t) => {
  const shopId = "0baf2fe05e377cf3";
  const license = { plan: "pro", isTrial: true, isActive: true, startAt: "2026-10-22T05:28:43.644Z", expiredAt: "2026-11-05T05:28:43.644Z" };
  const raw = createMemoryDatabase({ shops: { [shopId]: {
    license, basicInfo: { name: "GHTK" }, subscriptionRootID: shopId,
    subscriptionBranches: { [shopId]: true }, personnelPins: { owner: { role: "owner" } }
  } }, subscriptionUsage: { [shopId]: { users: { current: { entries: { owner: true } } } } } });
  const reference = raw.ref.bind(raw);
  raw.ref = (path) => {
    // Like the real SDK, an omitted path is valid while an explicit empty path is not.
    if (path === "") throw new Error('child failed: path argument was an invalid path = ""');
    return reference(path);
  };
  const before = structuredClone(raw.data);
  const { url, headers } = await serverFor(t, raw);
  const response = await fetch(`${url}/api/subscriptions/${shopId}`, {
    method: "PATCH", headers,
    body: JSON.stringify({
      shopId, shopName: "GHTK", packageName: "Pro", packageType: "pro", effectivePlan: "pro", effectivePlanName: "Pro",
      status: "suspended", ordersLimit: null, remainingOrders: null,
      startAt: license.startAt, expiresAt: license.expiredAt, licenseStatus: "trial", licenseSource: "license",
      remainingDays: 12, isUnlimited: false, downgraded: false,
      limits: { monthlyOrders: null, products: null, users: null, shops: 3, payroll: 30 },
      features: { onlineSales: true, eInvoice: true, staff: true, payroll: true },
      usage: { orders: { used: 0, limit: null, remaining: null }, products: { used: 0, limit: null, remaining: null },
        users: { used: 1, limit: null, remaining: null }, shops: { used: 1, limit: 3, remaining: 2 }, payroll: { used: 0, limit: 30, remaining: 30 } },
      branchIDs: [shopId]
    })
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.message);
  assert.equal(body.subscription.status, "suspended");
  assert.equal(body.subscription.licenseStatus, "suspended");
  assert.equal(raw.read(`shops/${shopId}/license/isActive`), false);
  assert.equal(raw.read(`shops/${shopId}/license/startAt`), license.startAt);
  assert.equal(raw.read(`shops/${shopId}/license/expiredAt`), license.expiredAt);
  assert.equal(raw.read(`shops/${shopId}/basicInfo/packageInfo/status`), "suspended");
  assert.deepEqual(raw.read(`shops/${shopId}/basicInfo/packageInfo`), raw.read(`shops/${shopId}/subscriptionInfo/packageInfo`));
  assert.equal(raw.read(`shops/${shopId}/subscriptionInfo/startAt`), license.startAt);
  assert.equal(raw.read(`shops/${shopId}/subscriptionInfo/expiresAt`), license.expiredAt);
  assert.deepEqual(raw.data.subscriptionUsage, before.subscriptionUsage);
  assert.deepEqual(raw.read(`shops/${shopId}/personnelPins`), before.shops[shopId].personnelPins);
  assert.equal(raw.writes.length, 6);
});
test("admin cannot bypass Lite's three-user limit", async (t) => {
  const shop = record(); shop.license = { plan: "lite", expiredAt: "2099-01-01", isActive: true };
  const raw = createMemoryDatabase({ shops: { main: shop }, users: { owner: { shops: { main: { role: "owner" } } } } });
  const { url, headers } = await serverFor(t, raw);
  for (const username of ["staff01", "staff02"]) {
    const response = await fetch(`${url}/api/users`, { method: "POST", headers, body: JSON.stringify({ username, password: "test-password", role: "cashier", storeIds: ["main"] }) });
    assert.equal(response.status, 201);
  }
  const excess = await fetch(`${url}/api/users`, { method: "POST", headers, body: JSON.stringify({ username: "staff03", password: "test-password", role: "cashier", storeIds: ["main"] }) });
  assert.equal(excess.status, 403); assert.equal((await excess.json()).code, "PLAN_USERS_LIMIT");
  assert.equal(raw.read("users/staff03"), null);
});

test("overview and subscription lists ignore deleted shops and deleted branches", async (t) => {
  const raw = createMemoryDatabase({ shops: {
    main: { ...record(), subscriptionBranches: { main: true, branch: true, removedBranch: true } },
    branch: { subscriptionRootID: "main", basicInfo: { name: "Branch" } },
    removedBranch: { subscriptionRootID: "main", basicInfo: { name: "Deleted branch" }, isDeleted: true },
    removedRoot: { ...record(), subscriptionRootID: "removedRoot", subscriptionBranches: { removedRoot: true }, isDeleted: true },
    orphanedBranch: { subscriptionRootID: "removedRoot", basicInfo: { name: "Branch of a deleted root" } },
  } });
  const { url, headers } = await serverFor(t, raw);
  const overview = await fetch(`${url}/api/overview`, { headers });
  assert.equal(overview.status, 200, JSON.stringify(await overview.clone().json()));
  const data = await overview.json();
  assert.equal(data.totals.storeCount, 2);
  assert.deepEqual(data.stores.map((shop) => shop.id).sort(), ["branch", "main"]);
  const response = await fetch(`${url}/api/subscriptions`, { headers });
  assert.equal(response.status, 200);
  const { subscriptions } = await response.json();
  assert.deepEqual(subscriptions.map((row) => row.shopId), ["main"]);
  assert.deepEqual(subscriptions[0].branchIDs.sort(), ["branch", "main"]);
});
