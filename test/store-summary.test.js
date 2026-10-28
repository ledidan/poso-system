import assert from "node:assert/strict";
import test from "node:test";
import { summarizeStore } from "../server/store-summary.js";

test("tổng hợp doanh thu trong kỳ và không trả cấu hình nhạy cảm", () => {
  const now = Date.parse("2026-07-20T00:00:00.000Z");
  const result = summarizeStore("shop-1", {
    basicInfo: {
      name: "POSO Center",
      membership: { status: "active" },
      revenueAverage: "under_1b",
      notificationSettings: { campaignEnabled: false },
      e_invoice: { password: "secret" }
    },
    activeOrders: { a: { total: 50_000 } },
    pastOrders: {
      recent: { total: 125_000, timeStamp: "2026-07-19T12:00:00.000Z" },
      old: { total: 999_000, timeStamp: "2026-05-01T12:00:00.000Z" }
    },
    customers: { a: {}, b: {} },
    allItems: { one: {}, two: {}, three: {} }
  }, 30, now);

  assert.equal(result.revenue, 125_000);
  assert.equal(result.orderCount, 1);
  assert.equal(result.activeOrderCount, 1);
  assert.equal(result.customerCount, 2);
  assert.equal(result.itemCount, 3);
  assert.equal(result.revenueAverage, "under_1b");
  assert.deepEqual(result.notificationSettings, {
    enabled: true,
    campaignEnabled: false,
    dailyRevenueEnabled: false,
    dailyRevenueMobileEnabled: true,
    dailyRevenueRoles: ["owner"],
    dailyRevenueRolesConfigured: false,
    dailyRevenueSendMode: "scheduled",
    dailyRevenueTime: "23:55"
  });
  assert.equal(result.e_invoice, undefined);
});

test("giữ quyền xem theo phân quyền và mặc định tắt push doanh thu cho cửa hàng cũ", () => {
  const result = summarizeStore("shop-legacy", { basicInfo: { name: "Cửa hàng cũ" } });
  assert.deepEqual(result.notificationSettings, {
    enabled: true,
    campaignEnabled: true,
    dailyRevenueEnabled: false,
    dailyRevenueMobileEnabled: true,
    dailyRevenueRoles: ["owner"],
    dailyRevenueRolesConfigured: false,
    dailyRevenueSendMode: "scheduled",
    dailyRevenueTime: "23:55"
  });
});

test("đếm cảnh báo tồn kho theo các biến thể schema hiện hữu", () => {
  const result = summarizeStore("shop-2", {
    inventory: {
      a: { currentStock: 2, minimumStock: 4 },
      b: { stockQuantity: 8, lowStockAlert: 8 },
      c: { quantity: 10, minQuantity: 3 }
    }
  });
  assert.equal(result.lowStockCount, 2);
});
