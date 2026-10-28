import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createAdminRouter } from "../server/admin-router.js";
import { dailyRevenueSettings } from "../shared/daily-revenue-settings.js";
import { updateDailyRevenueSettings, reportRoleOptions } from "../server/daily-revenue-settings.js";
import { createMemoryDatabase } from "./FirebaseMemory.js";
import { buildDailyRevenueNotification } from "../shared/daily-revenue-content.js";

const roles = { manager: { roleName: "Quản lý", permissions: { checkout: true } }, cashier: { roleName: "Thu ngân", permissions: { checkout: true, viewReports: false } } };
test("defaults separate mobile access from opt-in push; role selections survive Firebase empty-array removal", () => {
  assert.deepEqual(dailyRevenueSettings().dailyRevenueRoles, ["owner"]);
  assert.equal(dailyRevenueSettings().dailyRevenueEnabled, false);
  assert.equal(dailyRevenueSettings().dailyRevenueMobileEnabled, true);
  const next = updateDailyRevenueSettings({ campaignEnabled: false, extraFutureSetting: true }, { dailyRevenueRoles: [] }, roles);
  assert.equal(next.campaignEnabled, false); assert.equal(next.extraFutureSetting, true);
  delete next.dailyRevenueRoles;
  assert.deepEqual(dailyRevenueSettings(next).dailyRevenueRoles, []);
});
test("interactive preview covers growth, decline, unchanged and unavailable comparison without a fictitious percentage", () => {
  const sample = { date: "2026-10-28", todayRevenue: 12500000, todayOrderCount: 42 };
  for (const [yesterdayRevenue, title] of [[12500000 / 1.08, "tăng 8%"], [12500000 / .92, "giảm 8%"], [12500000, "Báo cáo kinh doanh"], [0, "Tổng kết doanh thu"]]) {
    const message = buildDailyRevenueNotification({ ...sample, yesterdayRevenue });
    assert.ok(message.title.includes(title)); assert.ok(message.title.includes("28/10")); assert.ok(message.body.includes("12.500.000đ")); assert.ok(message.body.includes("Xem chi tiết →"));
    if (!yesterdayRevenue) assert.ok(!message.body.includes("%"));
  }
});
test("recipient options reflect stored roles and explicit financial permission revocation", () => {
  assert.deepEqual(reportRoleOptions(roles), [{ id: "owner", name: "Chủ cửa hàng", canReceive: true }, { id: "manager", name: "Quản lý", canReceive: true }, { id: "cashier", name: "Thu ngân", canReceive: false }]);
  const saved = updateDailyRevenueSettings({}, { dailyRevenueRoles: ["owner", "manager", "owner"], dailyRevenueSendMode: "shift_close", dailyRevenueEnabled: true }, roles);
  assert.deepEqual(saved.dailyRevenueRoles, ["owner", "manager"]);
});
test("rejects invalid times, modes, booleans and recipient grants", () => {
  for (const input of [null, [], { dailyRevenueTime: "24:00" }, { dailyRevenueTime: "7:30" }, { dailyRevenueEnabled: "true" }, { dailyRevenueMobileEnabled: 1 }, { dailyRevenueSendMode: "auto" }, { dailyRevenueSendMode: "day_close" }, { dailyRevenueRoles: ["missing"] }, { dailyRevenueRoles: ["cashier"] }, { dailyRevenueEnabled: true, dailyRevenueRoles: [] }]) assert.throws(() => updateDailyRevenueSettings({}, input, roles), { status: 400 });
});
test("settings and role metadata require system-admin authentication; partial writes retain existing switches", async t => {
  const db = createMemoryDatabase({ shops: { a: { basicInfo: { name: "Fixture", notificationSettings: { enabled: false, campaignEnabled: false, dailyRevenueTime: "21:30" } }, roles } } });
  const app = express(); app.use(express.json()); app.use("/api/admin", createAdminRouter({ db, authenticate: (req, res, next) => req.headers["x-test-admin"] === "yes" ? next() : res.sendStatus(401) }));
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/admin/stores/a`;
  const headers = { "Content-Type": "application/json", "x-test-admin": "yes" };
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notificationSettings: { dailyRevenueEnabled: true } }) })).status, 401);
  assert.deepEqual(db.writes, []);
  const detail = await (await fetch(url, { headers })).json(); assert.deepEqual(detail.reportRoles, reportRoleOptions(roles));
  const update = await fetch(url, { method: "PATCH", headers, body: JSON.stringify({ revenueAverage: "", notificationSettings: { dailyRevenueSendMode: "scheduled", dailyRevenueRoles: ["manager"] } }) });
  assert.equal(update.status, 200);
  const saved = db.read("shops/a/basicInfo/notificationSettings"); assert.equal(saved.enabled, false); assert.equal(saved.campaignEnabled, false); assert.equal(saved.dailyRevenueTime, "21:30");
  const writes = db.writes.length;
  assert.equal((await fetch(url, { method: "PATCH", headers, body: JSON.stringify({ notificationSettings: { dailyRevenueRoles: ["cashier"] } }) })).status, 400);
  assert.equal(db.writes.length, writes);
});
