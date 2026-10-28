import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createAuthRouter } from "../server/auth.js";
import ExcelJS from "exceljs";
import { createStoreExport, parseStoreExportOptions, XLSX_CONTENT_TYPE } from "../server/store-export.js";
import { createAdminRouter } from "../server/admin-router.js";
import { createMemoryDatabase } from "./FirebaseMemory.js";
import { createPlanDatabase } from "../server/subscriptions/PlanDatabase.js";
import { resolveSubscriptionGroup } from "../server/subscriptions/ResolveSubscriptionGroup.js";
import { activeshops } from "../server/store-summary.js";
import { filterStores } from "../shared/store-filters.js";

export const exportNow = Date.parse("2026-10-23T18:30:00.000Z");
const DAY = 86_400_000;
export const storeExportFixture = () => ({
  shops: {
    root: {
      subscriptionRootID: "root", subscriptionBranches: { root: true, branch: true, deleted: true },
      license: { plan: "plus", startAt: "2026-01-01T00:00:00Z", expiredAt: "2027-01-01T00:00:00Z", isActive: true },
      basicInfo: {
        name: "POSO Trung tâm", address: "Quận 1, TP.HCM", phoneNumber: "0582013297", businessCategory: "Bán lẻ",
        createdAt: "2026-01-01T18:30:00Z", membership: { status: "active" }, revenueAverage: "under_1b",
        packageInfo: { packageType: "free", expiresAt: "2099-01-01", secret: "private-package-secret" },
        integrationToken: "private-integration-token", invoice: { password: "private-invoice-password" }
      },
      personnelPins: {
        "0582013297": { personnelID: "owner-1", personnelName: "Chủ thử nghiệm", role: "owner", isActive: true, pin: "private-pin", password: "private-password" },
        employee: { personnelID: "staff-1", personnelName: "Nhân viên thử nghiệm", role: "Thu ngân", isActive: false, payrollEnabled: false, fcmToken: "private-device-token" }
      },
      pastOrders: {
        boundary: { total: "100000", closedAt: new Date(exportNow - 30 * DAY).toISOString() },
        completed: { total: "250000", closedAt: new Date(exportNow).toISOString(), createdAt: "2025-01-01T00:00:00Z" },
        numeric: { total: 50000, timeStamp: exportNow - DAY },
        old: { total: 900000, closedAt: new Date(exportNow - 30 * DAY - 1).toISOString() },
        future: { total: 900000, closedAt: new Date(exportNow + 1).toISOString() },
        unknown: { total: 900000 },
        invalid: { total: 900000, timeStamp: "bad-date" }
      },
      activeOrders: { pending: { total: 500 } },
      canceledOrders: { canceled: { total: 20000, timeStamp: exportNow - DAY } },
      returnedOrders: { refund: { total: 30000, timeStamp: exportNow - DAY } },
      customers: { customer: {} }, allItems: { product: {} },
      inventory: { low: { currentStock: 1, minimumStock: 3 }, ok: { quantity: 10, minQuantity: 2 } }
    },
    branch: {
      subscriptionRootID: "root", license: { plan: "pro", expiredAt: "2099-01-01" },
      basicInfo: { name: "POSO Chi nhánh", address: "Đà Nẵng", membership: { status: "suspended" } },
      personnelPins: { "0582013297": { personnelID: "owner-1", personnelName: "Chủ thử nghiệm", role: "owner" } }
    },
    standalone: { subscriptionRootID: "standalone", basicInfo: { name: "=1+1", membership: { status: "active" } } },
    deleted: { subscriptionRootID: "root", basicInfo: { name: "Đã xóa" }, isDeleted: true },
    deletedRoot: { basicInfo: { name: "Trung tâm đã xóa" }, isDeleted: true },
    orphan: { subscriptionRootID: "deletedRoot", basicInfo: { name: "Chi nhánh trung tâm đã xóa" } }
  },
  users: { owner: { password: "private-global-password", notificationTokens: { fcmToken: "private-global-token" } } }
});

const roundTrip = async (workbook) => {
  const buffer = await workbook.xlsx.writeBuffer();
  const result = new ExcelJS.Workbook();
  await result.xlsx.load(buffer);
  return result;
};
const rowValues = (sheet, id) => sheet.getRows(2, sheet.rowCount - 1).find((row) => row.getCell(1).value === id);

test("export options validate filters and reject malformed or out-of-range queries", () => {
  assert.deepEqual(parseStoreExportOptions(), { search: "", status: "all", days: 30 });
  assert.deepEqual(parseStoreExportOptions({ search: " POSO ", days: "7", status: "active" }), { search: "POSO", status: "active", days: 7 });
  for (const query of [{ days: "0" }, { days: "366" }, { days: "1.5" }, { days: "bad" }, { days: "" }, { days: ["30", "7"] }, { search: {} }, { search: "x".repeat(201) }, { status: "unknown" }]) {
    assert.throws(() => parseStoreExportOptions(query), { status: 400 });
  }
});

test("shared filters match case-insensitive names, addresses, IDs, and combined statuses", () => {
  const stores = [{ id: "abc", name: "POSO", address: "Đà Nẵng", status: "active" }, { id: "def", name: "Khác", address: "HCM", status: "suspended" }];
  assert.deepEqual(filterStores(stores, { search: " ĐÀ NẴNG ", status: "active" }), [stores[0]]);
  assert.deepEqual(filterStores(stores, { search: "ABC" }), [stores[0]]);
  assert.deepEqual(filterStores(stores, { search: "poso", status: "suspended" }), []);
  assert.deepEqual(Object.keys(activeshops(storeExportFixture().shops)).sort(), ["branch", "root", "standalone"]);
});

test("XLSX export has detailed typed data, inclusive periods, correct subscription roots, filters, and frozen headers", async () => {
  const { workbook: original, filename, count } = await createStoreExport({ ...storeExportFixture(), now: exportNow });
  const workbook = await roundTrip(original);
  assert.equal(filename, "poso-cua-hang-chi-tiet-2026-10-24.xlsx");
  assert.equal(count, 3);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Tổng quan", "Cửa hàng", "Subscription", "Nhân sự"]);
  const stores = workbook.getWorksheet("Cửa hàng");
  const root = rowValues(stores, "root");
  assert.equal(root.getCell(4).value, "0582013297");
  assert.equal(root.getCell(4).type, ExcelJS.ValueType.String);
  assert.equal(root.getCell(7).value.toISOString(), "2026-01-02T01:30:00.000Z");
  assert.equal(root.getCell(10).value, 400000);
  assert.equal(root.getCell(10).type, ExcelJS.ValueType.Number);
  assert.equal(root.getCell(11).value, 3);
  assert.equal(root.getCell(12).value, 1);
  assert.equal(root.getCell(13).value, 1);
  assert.equal(root.getCell(14).value, 1);
  assert.equal(root.getCell(15).value, 30000);
  assert.equal(root.getCell(18).value, 2);
  assert.equal(root.getCell(19).value, 1);
  const standalone = rowValues(stores, "standalone");
  assert.equal(standalone.getCell(2).value, "=1+1");
  assert.equal(standalone.getCell(2).type, ExcelJS.ValueType.String);
  const subscriptions = workbook.getWorksheet("Subscription");
  const branch = rowValues(subscriptions, "branch");
  assert.equal(branch.getCell(3).value, "root");
  assert.equal(branch.getCell(5).value, 2);
  assert.equal(branch.getCell(6).value, "Plus");
  assert.equal(branch.getCell(7).value, "Plus");
  assert.equal(branch.getCell(13).value, 1000);
  assert.equal(branch.getCell(15).value, "Không giới hạn");
  assert.equal(rowValues(subscriptions, "standalone").getCell(12).value, "Không giới hạn thời gian");
  const people = workbook.getWorksheet("Nhân sự");
  assert.equal(people.rowCount, 4);
  const inactive = people.getRows(2, 3).find((row) => row.getCell(3).value === "employee");
  assert.equal(inactive.getCell(7).value, "Đã khóa truy cập");
  const summary = workbook.getWorksheet("Tổng quan");
  assert.equal(summary.getCell("B11").result, 3);
  assert.equal(summary.getCell("B12").result, 400000);
  assert.equal(summary.getCell("B12").formula, "SUM('Cửa hàng'!J2:J4)");
  assert.equal(summary.getCell("B21").value, 2);
  assert.equal(summary.getCell("B22").value, 2);
  for (const name of ["Cửa hàng", "Subscription", "Nhân sự"]) {
    const sheet = workbook.getWorksheet(name);
    assert.ok(sheet.autoFilter);
    assert.equal(sheet.views[0].state, "frozen");
    assert.equal(sheet.views[0].xSplit, 2);
    assert.equal(sheet.views[0].ySplit, 1);
  }
  const exportedValues = JSON.stringify(workbook.worksheets.map((sheet) => sheet.getSheetValues()));
  assert.doesNotMatch(exportedValues, /private-/);
});

test("filtered export only includes matching stores in all detail sheets", async () => {
  const { workbook, count } = await createStoreExport({ ...storeExportFixture(), options: parseStoreExportOptions({ search: " POSO ", status: "suspended", days: "7" }), now: exportNow });
  assert.equal(count, 1);
  for (const name of ["Cửa hàng", "Subscription", "Nhân sự"]) {
    const sheet = workbook.getWorksheet(name);
    assert.equal(sheet.rowCount, 2);
    assert.equal(sheet.getCell("A2").value, "branch");
  }
  assert.equal(workbook.getWorksheet("Tổng quan").getCell("B8").value, "Tạm khóa");
});

test("empty personnel is exported with headers and expired subscriptions show the actual Free limits", async () => {
  const shops = { expired: {
    subscriptionRootID: "expired", basicInfo: { name: "Expired" },
    license: { plan: "pro", startAt: "2025-01-01", expiredAt: "2026-01-01" }
  } };
  const { workbook: original } = await createStoreExport({ shops, now: exportNow });
  const workbook = await roundTrip(original);
  const subscription = workbook.getWorksheet("Subscription");
  assert.equal(subscription.getCell("F2").value, "Pro");
  assert.equal(subscription.getCell("G2").value, "Free");
  assert.equal(subscription.getCell("H2").value, "Đã về Free");
  assert.equal(subscription.getCell("M2").value, 300);
  assert.equal(workbook.getWorksheet("Nhân sự").rowCount, 1);
});

test("empty scopes reject instead of downloading a misleading empty report", async () => {
  await assert.rejects(createStoreExport({ shops: {}, now: exportNow }), { status: 404 });
  await assert.rejects(createStoreExport({ ...storeExportFixture(), options: parseStoreExportOptions({ search: "missing-store" }) }), { status: 404 });
});

const startServer = async (t, raw) => {
  process.env.ADMIN_SESSION_SECRET = "store-export-test-secret-over-32-characters";
  process.env.ADMIN_USERNAME = "export-test-admin";
  process.env.ADMIN_PASSWORD = "export-test-password";
  const app = express();
  app.use(express.json());
  app.use("/api/auth", createAuthRouter());
  app.use("/api/admin", createAdminRouter({ db: createPlanDatabase(raw) }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const login = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD })
  });
  assert.equal(login.status, 200);
  return { url: `http://127.0.0.1:${server.address().port}/api/admin/stores/export.xlsx`, headers: { Cookie: login.headers.get("set-cookie").split(";")[0] } };
};

test("export API requires admin auth, returns downloadable XLSX and never writes to Firebase", async (t) => {
  const raw = createMemoryDatabase(storeExportFixture());
  const before = structuredClone(raw.data);
  const { url, headers } = await startServer(t, raw);
  assert.equal((await fetch(url)).status, 401);
  assert.equal(raw.reads.length, 0);
  assert.equal((await fetch(`${url}?days=366`, { headers })).status, 400);
  assert.equal(raw.reads.length, 0);
  const response = await fetch(`${url}?search=Trung%20t%C3%A2m&status=active&days=30`, { headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), XLSX_CONTENT_TYPE);
  assert.match(response.headers.get("content-disposition"), /attachment; filename="poso-cua-hang-chi-tiet-\d{4}-\d{2}-\d{2}\.xlsx"/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-export-count"), "1");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  assert.equal(workbook.getWorksheet("Cửa hàng").getCell("A2").value, "root");
  assert.deepEqual(raw.writes, []);
  assert.deepEqual(raw.data, before);
  assert.equal((await fetch(`${url}?search=no-such-store`, { headers })).status, 404);
});

test("legacy branch links resolve read-only without initializing subscriptions or usage", async () => {
  const raw = createMemoryDatabase({ shops: {
    legacyRoot: { basicInfo: { name: "Root" }, license: { plan: "plus", expiredAt: "2099-01-01" }, personnelPins: { owner: { role: "owner" } } },
    legacyBranch: { basicInfo: { name: "Branch", branchInfo: { parentShopID: "legacyRoot" } }, personnelPins: { owner: { role: "owner" } } }
  }, users: { owner: { shops: { legacyRoot: { role: "owner" }, legacyBranch: { role: "owner" } } } } });
  const { workbook } = await createStoreExport({ shops: raw.data.shops, now: exportNow, resolveGroup: (shopID) => resolveSubscriptionGroup({ db: raw, shopID }) });
  const branch = rowValues(workbook.getWorksheet("Subscription"), "legacyBranch");
  assert.equal(branch.getCell(3).value, "legacyRoot");
  assert.equal(branch.getCell(7).value, "Plus");
  assert.deepEqual(raw.writes, []);
});

test("export failures return a readable error without leaking database details", async (t) => {
  const raw = { ref() { return { once: async () => { throw new Error("private-database-detail"); } }; } };
  const { url, headers } = await startServer(t, raw);
  const response = await fetch(url, { headers });
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.match(body.message, /Không thể xuất Excel/);
  assert.doesNotMatch(JSON.stringify(body), /private-database-detail/);
});
