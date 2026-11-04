import { registerStoreAccount, deliverStoreAccountEmail } from "./StoreRegistration.js";
import { createAccountMailer } from "./AccountEmail.js";
import { reportRoleOptions, updateDailyRevenueSettings } from "./daily-revenue-settings.js";
import { loadSubscription, subscriptionUsage } from "./subscriptions/SubscriptionService.js";
import { PLANS } from "./subscriptions/PlanCatalog.js";
import express from "express";
import bcrypt from "bcryptjs";
import { customAlphabet } from "nanoid";
import { requireAdmin } from "./auth.js";
import { createMaintenanceRouter } from "./maintenance.js";
import { createAdminReadContext, mapLimited } from "./admin-read.js";
import { readAdminStores } from "./admin-overview.js";
import { asNumber, normalizeOrder, safeBasicInfo, summarizeStore } from "./store-summary.js";
import { resolveSubscriptionGroup } from "./subscriptions/ResolveSubscriptionGroup.js";
import {
  REVENUE_AVERAGE_OPTIONS,
  sendCampaign
} from "./notification-campaign.js";

import { isoDate, readSubscription, buildSubscriptionUpdate, createTrial } from "./Subscription.js";
export { isoDate } from "./Subscription.js";

const createId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 7);
const entries = (value) => Object.entries(value || {});
const validFirebaseKey = (value) => typeof value === "string" && /^[^.#$\[\]\/\u0000-\u001f\u007f]{1,128}$/.test(value) && !["__proto__", "prototype", "constructor"].includes(value);
const publicCampaign = (campaign) => ({
  ...Object.fromEntries([
    "id", "title", "body", "imageUrl", "target", "status", "createdBy", "createdAt", "scheduledAt", "recipientCount",
    "successCount", "failureCount", "matchedShopIds", "startedAt", "sentAt", "failedAt", "canceledAt", "canceledBy"
  ].filter((key) => campaign[key] !== undefined).map((key) => [key, campaign[key]])),
  errors: (Array.isArray(campaign.errors) ? campaign.errors : []).map((error) => ({
    code: error.code || "campaign/send-error", message: "Không thể gửi thông báo đến thiết bị. Vui lòng kiểm tra cấu hình hoặc thử lại sau."
  }))
});

const buildOrders = (shops, shopFilter = "") => {
  const orders = [];
  entries(shops).forEach(([shopId, shop]) => {
    if (shopFilter && shopFilter !== shopId) return;
    const shopName = safeBasicInfo(shopId, shop.basicInfo).name;
    ["activeOrders", "pastOrders", "canceledOrders", "returnedOrders"].forEach((bucket) => {
      entries(shop[bucket]).forEach(([orderId, order]) => {
        orders.push(normalizeOrder(shopId, shopName, bucket, orderId, order));
      });
    });
  });
  return orders.sort((a, b) => Date.parse(b.timeStamp || 0) - Date.parse(a.timeStamp || 0));
};

const buildOrderDetails = (shopId, shop = {}) => {
  const shopName = safeBasicInfo(shopId, shop.basicInfo).name;
  const orders = [];
  ["activeOrders", "pastOrders", "canceledOrders", "returnedOrders"].forEach((bucket) => {
    entries(shop[bucket]).forEach(([orderId, order]) => {
      orders.push({
        ...normalizeOrder(shopId, shopName, bucket, orderId, order),
        phone: order.phoneNumber || order.customerInfo?.phone || "",
        address: order.address || order.deliveryInfo?.address || "",
        paymentMethod: order.paymentMethod || "",
        note: order.note || order.customerInstruction || "",
        items: (Array.isArray(order.orderItems) ? order.orderItems : Object.values(order.orderItems || {})).map((item) => ({
          id: item.itemID || "",
          name: item.itemSimpleDescription?.itemName || item.itemName || "Sản phẩm",
          quantity: asNumber(item.quantity || 1),
          price: asNumber(item.itemSimpleDescription?.itemPrice ?? item.itemPrice)
        }))
      });
    });
  });
  return orders.sort((a, b) => Date.parse(b.timeStamp || 0) - Date.parse(a.timeStamp || 0));
};

export const createAdminRouter = ({ db, messaging, messagingProjectId = "", authenticate = requireAdmin, adminReadOptions = {}, accountMailer = createAccountMailer() }) => {
  const router = express.Router();

  router.use(authenticate);
  router.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  router.use("/maintenance", createMaintenanceRouter({ db }));
  for (const parameter of ["shopId", "username", "campaignId", "id"]) {
    router.param(parameter, (req, res, next, value) => validFirebaseKey(value) ? next() : res.status(400).json({ message: "Mã định danh không hợp lệ." }));
  }

  router.get("/me", (req, res) => res.json({
    username: req.adminUser.username,
    name: req.adminUser.name || "Quản trị viên"
  }));

  router.get("/overview", async (req, res) => {
    try {
      const days = Math.min(Math.max(asNumber(req.query.days) || 30, 1), 365);
      const context = createAdminReadContext(db, adminReadOptions);
      const shops = await context.loadShopProfiles();
      const userCount = (await context.keys("users")).length;
      const { stores, recentOrders } = await readAdminStores(context, shops, { days, includeRecent: true });
      const totals = stores.reduce((result, store) => ({
        revenue: result.revenue + store.revenue,
        orderCount: result.orderCount + store.orderCount,
        activeOrderCount: result.activeOrderCount + store.activeOrderCount,
        customerCount: result.customerCount + store.customerCount
      }), { revenue: 0, orderCount: 0, activeOrderCount: 0, customerCount: 0 });

      const packages = (await mapLimited(entries(shops).filter(([id, shop]) => !shop.subscriptionRootID || shop.subscriptionRootID === id), async ([id, shop]) => { const subscription = await loadSubscription({ db: context.db, shopID: id, initialize: false }); return subscription.rootShopID === id ? readSubscription(shop) : null; }, context.concurrency)).filter(Boolean);
      const expiringSoon = packages.filter((item) => ["active", "trial"].includes(item.licenseStatus) && item.expiresAt && Date.parse(item.expiresAt) >= Date.now() && Date.parse(item.expiresAt) < Date.now() + 14 * 86400000).length;
      res.json({
        days,
        totals: {
          ...totals,
          storeCount: stores.length,
          userCount,
          subscriptionActiveCount: packages.filter((item) => ["active", "downgraded"].includes(item.licenseStatus)).length,
          subscriptionTrialCount: packages.filter((item) => item.licenseStatus === "trial").length,
          subscriptionSuspendedCount: packages.filter((item) => ["suspended", "inactive", "expired", "invalid", "notStarted"].includes(item.licenseStatus)).length,
          subscriptionExpiringCount: expiringSoon
        },
        stores,
        recentOrders
      });
    } catch (error) {
      res.status(500).json({ message: "Không thể tải dữ liệu tổng quan." });
    }
  });

  router.get("/stores", async (req, res) => {
    try {
      const days = Math.min(Math.max(asNumber(req.query.days) || 30, 1), 365);
      const context = createAdminReadContext(db, adminReadOptions), shops = await context.loadShopProfiles();
      const { stores } = await readAdminStores(context, shops, { days });
      res.json({ stores });
    } catch {
      res.status(500).json({ message: "Không thể tải danh sách cửa hàng." });
    }
  });

  router.get("/store-options", async (req, res) => {
    try {
      const context = createAdminReadContext(db, adminReadOptions), shops = await context.loadShopProfiles({ directoryOnly: true });
      res.json({ stores: entries(shops).map(([id, shop]) => {
        const basic = safeBasicInfo(id, shop.basicInfo);
        return { id, name: basic.name, address: basic.address, status: basic.membership.status || "active" };
      }) });
    } catch { res.status(500).json({ message: "Không thể tải danh mục cửa hàng." }); }
  });

  router.get("/stores/export.xlsx", async (req, res) => {
    try {
      const { createStoreExport, parseStoreExportOptions, XLSX_CONTENT_TYPE } = await import("./store-export.js");
      const options = parseStoreExportOptions(req.query);
      const snapshot = await db.ref("shops").once("value");
      const { workbook, filename, count } = await createStoreExport({
        shops: snapshot.val() || {}, options,
        // Resolve legacy relationships without running subscription migrations or seeding usage meters.
        resolveGroup: (shopID) => resolveSubscriptionGroup({ db, shopID })
      });
      const buffer = await workbook.xlsx.writeBuffer();
      res.set("Cache-Control", "no-store");
      res.set("X-Export-Count", String(count));
      res.type(XLSX_CONTENT_TYPE).attachment(filename).send(Buffer.from(buffer));
    } catch (error) {
      res.status(error.status || 500).json({ message: error.status ? error.message : "Không thể xuất Excel cửa hàng. Vui lòng thử lại." });
    }
  });

  router.post("/stores", async (req, res) => {
    try {
      const registration = await registerStoreAccount({ database: db, input: req.body, createdBy: req.adminUser.username });
      const emailDelivery = registration.created
        ? await deliverStoreAccountEmail({ database: db, registration, mailer: accountMailer })
        : registration.emailDelivery;
      const basicInfo = registration.basicInfo || (await db.ref(`shops/${registration.shopId}/basicInfo`).once("value")).val();
      res.status(201).json({ store: summarizeStore(registration.shopId, { basicInfo }), account: { username: registration.username }, emailDelivery });
    } catch (error) {
      res.status(error.status || 500).json({ code: error.status ? error.code : "STORE_REGISTRATION_FAILED", message: error.status ? error.message : "Không thể tạo cửa hàng và tài khoản. Vui lòng thử lại." });
    }
  });

  router.post("/stores/:shopId/account-email", async (req, res) => {
    try {
      const registrationId = req.body?.registrationId;
      if (typeof registrationId !== "string" || !/^[a-f0-9-]{36}$/i.test(registrationId)) return res.status(400).json({ message: "Mã yêu cầu không hợp lệ." });
      const record = (await db.ref(`systemAdmin/storeRegistrations/${registrationId}`).once("value")).val();
      if (!record || record.shopId !== req.params.shopId) return res.status(404).json({ message: "Không tìm thấy yêu cầu cấp tài khoản." });
      const [userSnap, basicSnap] = await Promise.all([db.ref(`users/${record.username}`).once("value"), db.ref(`shops/${record.shopId}/basicInfo`).once("value")]);
      const user = userSnap.val(), basic = basicSnap.val();
      if (!basic || user?.shops?.[record.shopId]?.role !== "owner" || user.isActive === false || typeof req.body.password !== "string" || req.body.password.length < 8 || new TextEncoder().encode(req.body.password).length > 72 || /[\x00-\x1f\x7f]/.test(req.body.password) || !await bcrypt.compare(req.body.password, user.password || "")) return res.status(400).json({ message: "Thông tin tài khoản không hợp lệ để gửi lại email." });
      const emailDelivery = await deliverStoreAccountEmail({ database: db, registration: { ...record, info: { ...record.customer, registrationId, username: record.username, password: req.body.password } }, mailer: accountMailer });
      res.json({ emailDelivery });
    } catch { res.status(503).json({ message: "Chưa thể gửi lại email cấp tài khoản." }); }
  });

  router.get("/stores/:shopId", async (req, res) => {
    try {
      const snapshot = await db.ref(`shops/${req.params.shopId}`).once("value");
      if (!snapshot.exists()) return res.status(404).json({ message: "Không tìm thấy cửa hàng." });
      const shop = snapshot.val() || {};
      const store = summarizeStore(req.params.shopId, shop, 30);
      const personnel = entries(shop.personnelPins).map(([id, person]) => ({
        id,
        name: person.personnelName || person.name || id,
        role: person.role || person.roleName || "Nhân viên",
        isActive: person.isActive !== false
      }));
      res.json({ store, reportRoles: reportRoleOptions(shop.roles), recentOrders: buildOrderDetails(req.params.shopId, shop).slice(0, 20), personnel });
    } catch {
      res.status(500).json({ message: "Không thể tải chi tiết cửa hàng." });
    }
  });

  router.patch("/stores/:shopId", async (req, res) => {
    const updates = {};
    ["name", "address", "phoneNumber", "businessCategory"].forEach((key) => {
      if (req.body?.[key] !== undefined) updates[key] = String(req.body[key]).trim();
    });
    if (req.body?.status !== undefined) updates["membership/status"] = String(req.body.status);
    if (req.body?.revenueAverage !== undefined) {
      const validRevenueAverage = req.body.revenueAverage === "" || REVENUE_AVERAGE_OPTIONS.some(
        (option) => option.value === req.body.revenueAverage
      );
      if (!validRevenueAverage) {
        return res.status(400).json({ message: "Mức doanh thu trung bình không hợp lệ." });
      }
      updates.revenueAverage = String(req.body.revenueAverage);
    }
    const requestedSettings = req.body?.notificationSettings;
    if (requestedSettings !== undefined) updates.notificationSettings = requestedSettings;
    if (!Object.keys(updates).length) return res.status(400).json({ message: "Không có thông tin hợp lệ để cập nhật." });

    try {
      const ref = db.ref(`shops/${req.params.shopId}/basicInfo`);
      const before = await ref.once("value");
      if (!before.exists()) return res.status(404).json({ message: "Không tìm thấy cửa hàng." });
      if (requestedSettings !== undefined) {
        const roles = (await db.ref(`shops/${req.params.shopId}/roles`).once("value")).val() || {};
        updates.notificationSettings = updateDailyRevenueSettings(before.val().notificationSettings, requestedSettings, roles);
      }
      await ref.update(updates);
      const snapshot = await db.ref(`shops/${req.params.shopId}`).once("value");
      res.json({ store: summarizeStore(req.params.shopId, snapshot.val()) });
    } catch (error) {
      res.status(error.status || 500).json({ message: error.status ? error.message : "Không thể cập nhật cửa hàng." });
    }
  });

  router.get("/campaigns", async (req, res) => {
    try {
      const snapshot = await db.ref("systemAdmin/notificationCampaigns").once("value");
      const campaigns = entries(snapshot.val())
        .map(([id, campaign]) => publicCampaign({ id, ...campaign }))
        .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
      res.json({ campaigns: campaigns.slice(0, 100), revenueAverageOptions: REVENUE_AVERAGE_OPTIONS });
    } catch {
      res.status(500).json({ message: "Không thể tải lịch sử chiến dịch." });
    }
  });

  router.post("/campaigns", async (req, res) => {
    const title = String(req.body?.title || "").trim();
    const body = String(req.body?.body || "").trim();
    const imageUrl = String(req.body?.imageUrl || "").trim();
    const target = req.body?.target || { type: "all" };
    const scheduledAt = String(req.body?.scheduledAt || "").trim();
    if (!title || !body) {
      return res.status(400).json({ message: "Tiêu đề và nội dung là bắt buộc." });
    }
    if (imageUrl && !/^https:\/\//i.test(imageUrl)) {
      return res.status(400).json({ message: "Ảnh notification phải dùng URL HTTPS hợp lệ." });
    }
    if (!["all", "shop", "revenueAverage"].includes(target.type)) {
      return res.status(400).json({ message: "Đối tượng nhận không hợp lệ." });
    }
    if (target.type === "shop" && !target.shopId) {
      return res.status(400).json({ message: "Hãy chọn cửa hàng nhận thông báo." });
    }
    if (target.type === "shop" && !validFirebaseKey(target.shopId)) return res.status(400).json({ message: "Mã cửa hàng không hợp lệ." });
    if (
      target.type === "revenueAverage" &&
      !REVENUE_AVERAGE_OPTIONS.some((option) => option.value === target.revenueAverage)
    ) {
      return res.status(400).json({ message: "Hãy chọn nhóm doanh thu." });
    }
    const scheduledTimestamp = scheduledAt ? Date.parse(scheduledAt) : null;
    if (scheduledAt && (!Number.isFinite(scheduledTimestamp) || scheduledTimestamp <= Date.now())) {
      return res.status(400).json({ message: "Thời gian lên lịch phải ở tương lai." });
    }

    const campaignId = createId();
    const createdAt = new Date().toISOString();
    try {
      const campaign = {
        title,
        body,
        imageUrl,
        target,
        status: scheduledAt ? "scheduled" : "sending",
        createdBy: req.adminUser.username,
        createdAt,
        scheduledAt: scheduledAt ? new Date(scheduledTimestamp).toISOString() : "",
        recipientCount: 0,
        successCount: 0,
        failureCount: 0
      };
      await db.ref(`systemAdmin/notificationCampaigns/${campaignId}`).set(campaign);
      if (scheduledAt) {
        return res.status(201).json({ campaign: publicCampaign({ id: campaignId, ...campaign }) });
      }
      const sentCampaign = await sendCampaign({
        db,
        messaging,
        messagingProjectId,
        campaignId,
        campaign
      });
      res.status(201).json({ campaign: publicCampaign(sentCampaign) });
    } catch (error) {
      const status = error.code === "campaign/no-recipients" ? 400 : 500;
      await db.ref(`systemAdmin/notificationCampaigns/${campaignId}`).update({
        status: "failed",
        failedAt: new Date().toISOString(),
        errors: [{ code: error.code || "campaign/send-error", message: error.message }]
      }).catch(() => {});
      res.status(status).json({ message: status === 400 ? "Không tìm thấy thiết bị phù hợp để gửi." : "Không thể gửi chiến dịch thông báo." });
    }
  });

  router.delete("/campaigns/:campaignId", async (req, res) => {
    try {
      const ref = db.ref(`systemAdmin/notificationCampaigns/${req.params.campaignId}`);
      const snapshot = await ref.once("value");
      const existingCampaign = snapshot.val();
      if (!existingCampaign) {
        return res.status(404).json({ message: "Không tìm thấy campaign." });
      }
      const result = await ref.transaction((campaign) => {
        const current = campaign || existingCampaign;
        if (current.status !== "scheduled") return undefined;
        return {
          ...current,
          status: "canceled",
          canceledAt: new Date().toISOString(),
          canceledBy: req.adminUser.username
        };
      });
      if (!result.committed) {
        return res.status(409).json({ message: "Chỉ có thể hủy campaign đang chờ gửi." });
      }
      res.json({ campaign: publicCampaign({ id: req.params.campaignId, ...result.snapshot.val() }) });
    } catch (error) {
      res.status(500).json({ message: "Không thể hủy campaign." });
    }
  });

  router.get("/orders", async (req, res) => {
    try {
      const limit = Math.min(Math.max(asNumber(req.query.limit) || 100, 1), 500);
      const snapshot = await db.ref("shops").once("value");
      res.json({ orders: buildOrders(snapshot.val(), req.query.shopId).slice(0, limit) });
    } catch {
      res.status(500).json({ message: "Không thể tải danh sách đơn hàng." });
    }
  });

  router.get("/users", async (req, res) => {
    try {
      const context = createAdminReadContext(db, adminReadOptions), usernames = await context.keys("users");
      const users = await mapLimited(usernames, async (username) => {
        const memberships = (await context.read(`users/${username}/shops`)).val() || {};
        const stores = await mapLimited(entries(memberships), async ([shopId, membership]) => ({
          shopId, shopName: safeBasicInfo(shopId, (await context.read(`shops/${shopId}/basicInfo`)).val() || {}).name,
          personnelID: membership.personnelID || "", name: membership.personnelName || username,
          role: membership.role || "Nhân viên", isActive: membership.isActive !== false
        }), context.concurrency);
        return { username, stores };
      }, context.concurrency);
      res.json({ users });
    } catch {
      res.status(500).json({ message: "Không thể tải danh sách người dùng." });
    }
  });

  router.post("/users", async (req, res) => {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    const storeIds = Array.isArray(req.body?.storeIds) ? [...new Set(req.body.storeIds.map(String))] : [];
    if (!validFirebaseKey(username)) return res.status(400).json({ message: "Tên đăng nhập chứa ký tự không hợp lệ." });
    if (password.length < 6) return res.status(400).json({ message: "Mật khẩu phải có ít nhất 6 ký tự." });
    if (typeof req.body?.password !== "string" || Buffer.byteLength(password, "utf8") > 72) return res.status(400).json({ message: "Mật khẩu phải là chuỗi có tối đa 72 byte." });
    if (!storeIds.length) return res.status(400).json({ message: "Hãy chọn ít nhất một cửa hàng." });
    if (!storeIds.every(validFirebaseKey)) return res.status(400).json({ message: "Mã cửa hàng không hợp lệ." });

    try {
      const userRef = db.ref(`users/${username}`);
      if ((await userRef.once("value")).exists()) return res.status(409).json({ message: "Tên đăng nhập đã tồn tại." });
      const passwordHash = await bcrypt.hash(password, 10);
      const updates = { [`users/${username}/password`]: passwordHash };
      storeIds.forEach((shopId) => {
        const membership = {
          personnelID: createId(),
          personnelName: String(req.body?.name || username).trim(),
          role: String(req.body?.role || "Nhân viên"),
          isActive: req.body?.isActive !== false,
          payrollEnabled: req.body?.payrollEnabled === true
        };
        updates[`users/${username}/shops/${shopId}`] = membership;
        updates[`shops/${shopId}/personnelPins/${username}`] = membership;
      });
      await db.ref().update(updates);
      res.status(201).json({ username });
    } catch (error) {
      res.status(error.status || 500).json({ code: error.code, message: error.status ? error.message : "Không thể tạo người dùng." });
    }
  });

  router.patch("/users/:username", async (req, res) => {
    const username = req.params.username;
    const storeIds = Array.isArray(req.body?.storeIds) ? [...new Set(req.body.storeIds.map(String))] : undefined;
    if (!validFirebaseKey(username)) return res.status(400).json({ message: "Tên đăng nhập không hợp lệ." });
    if (req.body?.storeIds !== undefined && !storeIds?.length) return res.status(400).json({ message: "Hãy chọn ít nhất một cửa hàng." });
    if (storeIds && !storeIds.every(validFirebaseKey)) return res.status(400).json({ message: "Mã cửa hàng không hợp lệ." });
    try {
      const snapshot = await db.ref(`users/${username}`).once("value");
      if (!snapshot.exists()) return res.status(404).json({ message: "Không tìm thấy người dùng." });
      const current = snapshot.val() || {};
      const updates = {};
      if (storeIds) {
        const removed = Object.keys(current.shops || {}).filter((shopId) => !storeIds.includes(shopId));
        removed.forEach((shopId) => {
          updates[`users/${username}/shops/${shopId}`] = null;
          updates[`shops/${shopId}/personnelPins/${username}`] = null;
        });
        storeIds.forEach((shopId) => {
          const existing = current.shops?.[shopId] || {};
          const membership = {
            personnelID: existing.personnelID || createId(),
            personnelName: String(req.body?.name || existing.personnelName || username).trim(),
            role: String(req.body?.role || existing.role || "Nhân viên"),
            isActive: req.body?.isActive !== false,
          payrollEnabled: req.body?.payrollEnabled === true
          };
          updates[`users/${username}/shops/${shopId}`] = membership;
          updates[`shops/${shopId}/personnelPins/${username}`] = membership;
        });
      }
      if (req.body?.password) {
        if (String(req.body.password).length < 6) return res.status(400).json({ message: "Mật khẩu phải có ít nhất 6 ký tự." });
        if (typeof req.body.password !== "string" || Buffer.byteLength(req.body.password, "utf8") > 72) return res.status(400).json({ message: "Mật khẩu phải là chuỗi có tối đa 72 byte." });
        updates[`users/${username}/password`] = await bcrypt.hash(String(req.body.password), 10);
      }
      if (!Object.keys(updates).length) return res.status(400).json({ message: "Không có thông tin hợp lệ để cập nhật." });
      await db.ref().update(updates);
      res.json({ username });
    } catch (error) {
      res.status(error.status || 500).json({ code: error.code, message: error.status ? error.message : "Không thể cập nhật người dùng." });
    }
  });

  router.delete("/users/:username", async (req, res) => {
    const username = req.params.username;
    try {
      const snapshot = await db.ref(`users/${username}`).once("value");
      if (!snapshot.exists()) return res.status(404).json({ message: "Không tìm thấy người dùng." });
      const updates = { [`users/${username}`]: null };
      Object.keys(snapshot.val()?.shops || {}).forEach((shopId) => {
        updates[`shops/${shopId}/personnelPins/${username}`] = null;
      });
      await db.ref().update(updates);
      res.status(204).end();
    } catch {
      res.status(500).json({ message: "Không thể xóa người dùng." });
    }
  });

  router.get("/subscriptions", async (req, res) => {
    try {
      const context = createAdminReadContext(db, adminReadOptions), shops = await context.loadShopProfiles();
      const subscriptions = await mapLimited(entries(shops).filter(([shopId, shop]) => !shop.subscriptionRootID || shop.subscriptionRootID === shopId), async ([shopId, shop]) => {
        const subscription = await loadSubscription({ db: context.db, shopID: shopId, initialize: false });
        if (subscription.rootShopID !== shopId) return null;
        subscription.branchIDs = subscription.branchIDs.filter((id) => shops[id]);
        const usage = await subscriptionUsage({ db: context.db, subscription, initialize: false });
        return { shopId, shopName: safeBasicInfo(shopId, shop.basicInfo).name, ...readSubscription(shop), usage, remainingOrders: usage.orders.remaining, branchIDs: subscription.branchIDs };
      }, context.concurrency);
      res.json({ subscriptions: subscriptions.filter(Boolean), plans: Object.values(PLANS) });
    } catch {
      res.status(500).json({ message: "Không thể tải danh sách subscription." });
    }
  });

  router.patch("/subscriptions/:shopId", async (req, res) => {
    try {
      const shopsnapshot = await db.ref(`shops/${req.params.shopId}`).once("value");
      if (!shopsnapshot.exists()) return res.status(404).json({ message: "Không tìm thấy cửa hàng." });
      const shop = shopsnapshot.val();
      if (shop.subscriptionRootID && shop.subscriptionRootID !== req.params.shopId) return res.status(409).json({ message: "Vui lòng chỉnh sửa tại cửa hàng trung tâm.", rootShopID: shop.subscriptionRootID });
      let changes;
      try { changes = buildSubscriptionUpdate(shop, req.body); }
      catch (error) { return res.status(400).json({ message: error.message }); }
      const { packageInfo, license, updatedAt } = changes;
      await db.ref().update({
        [`shops/${req.params.shopId}/license`]: license,
        [`shops/${req.params.shopId}/basicInfo/packageInfo`]: packageInfo,
        [`shops/${req.params.shopId}/subscriptionInfo/packageInfo`]: packageInfo,
        [`shops/${req.params.shopId}/subscriptionInfo/startAt`]: packageInfo.startAt,
        [`shops/${req.params.shopId}/subscriptionInfo/expiresAt`]: packageInfo.expiresAt,
        [`shops/${req.params.shopId}/subscriptionInfo/updatedAt`]: updatedAt
      });
      res.json({ subscription: { shopId: req.params.shopId, ...readSubscription({ ...shop, license, basicInfo: { ...shop.basicInfo, packageInfo } }) } });
    } catch {
      res.status(500).json({ message: "Không thể cập nhật subscription." });
    }
  });

  router.get("/customers", async (req, res) => {
    try {
      const snapshot = await db.ref("shops").once("value");
      const query = String(req.query.query || "").toLowerCase();
      const customers = [];
      entries(snapshot.val()).forEach(([shopId, shop]) => {
        if (req.query.shopId && req.query.shopId !== shopId) return;
        const shopName = safeBasicInfo(shopId, shop.basicInfo).name;
        entries(shop.customers).forEach(([customerId, customer]) => {
          const record = {
            id: customerId,
            shopId,
            shopName,
            name: customer.name || customer.customerName || "Khách hàng",
            phone: customer.phone || customer.phoneNumber || "",
            email: customer.email || "",
            address: customer.address || "",
            debt: asNumber(customer.debt),
            rewardPoints: asNumber(customer.rewardPoints),
            createdAt: customer.createdAt || customer.timeStamp || ""
          };
          if (!query || `${record.name} ${record.phone} ${record.email}`.toLowerCase().includes(query)) customers.push(record);
        });
      });
      res.json({ customers: customers.slice(0, 500) });
    } catch {
      res.status(500).json({ message: "Không thể tải danh sách khách hàng." });
    }
  });

  router.get("/support-tickets", async (req, res) => {
    try {
      const snapshot = await db.ref("systemAdmin/supportTickets").once("value");
      const tickets = entries(snapshot.val()).map(([id, ticket]) => ({ id, ...ticket }))
        .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0));
      res.json({ tickets });
    } catch {
      res.status(500).json({ message: "Không thể tải yêu cầu chăm sóc." });
    }
  });

  router.post("/support-tickets", async (req, res) => {
    const subject = String(req.body?.subject || "").trim();
    if (!subject) return res.status(400).json({ message: "Nội dung yêu cầu là bắt buộc." });
    const id = createId();
    const now = new Date().toISOString();
    const ticket = {
      userId: String(req.body?.userId || req.body?.customerId || ""),
      userName: String(req.body?.userName || req.body?.customerName || "Người dùng"),
      shopId: String(req.body?.shopId || ""),
      shopName: String(req.body?.shopName || ""),
      subject,
      note: String(req.body?.note || ""),
      channel: String(req.body?.channel || "phone"),
      priority: String(req.body?.priority || "normal"),
      status: "open",
      assignedTo: "",
      createdAt: now,
      updatedAt: now
    };
    try {
      await db.ref(`systemAdmin/supportTickets/${id}`).set(ticket);
      res.status(201).json({ ticket: { id, ...ticket } });
    } catch {
      res.status(500).json({ message: "Không thể tạo yêu cầu chăm sóc." });
    }
  });

  router.patch("/support-tickets/:id", async (req, res) => {
    const updates = { updatedAt: new Date().toISOString() };
    ["status", "priority", "assignedTo", "note", "subject", "channel"].forEach((key) => {
      if (req.body?.[key] !== undefined) updates[key] = String(req.body[key]);
    });
    try {
      const ref = db.ref(`systemAdmin/supportTickets/${req.params.id}`);
      if (!(await ref.once("value")).exists()) return res.status(404).json({ message: "Không tìm thấy yêu cầu." });
      await ref.update(updates);
      res.json({ id: req.params.id, ...updates });
    } catch {
      res.status(500).json({ message: "Không thể cập nhật yêu cầu chăm sóc." });
    }
  });

  router.delete("/support-tickets/:id", async (req, res) => {
    try {
      await db.ref(`systemAdmin/supportTickets/${req.params.id}`).remove();
      res.status(204).end();
    } catch {
      res.status(500).json({ message: "Không thể xóa yêu cầu chăm sóc." });
    }
  });

  router.all("/audit-logs", (req, res) => res.status(410).json({ message: "Nhật ký hoạt động đang tạm tắt." }));

  return router;
};
