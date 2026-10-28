import { PLANS, normalizePlan, resolvePlan, createTrial as newTrial, timestamp } from "./subscriptions/PlanCatalog.js";
export { timestamp } from "./subscriptions/PlanCatalog.js";
export const isoDate = (value) => {
  if (value === "" || value === null) return "";
  const time = timestamp(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};
export const createTrial = newTrial;
export const readSubscription = (shop = {}, now = Date.now()) => {
  const info = { ...shop.subscriptionInfo?.packageInfo, ...shop.basicInfo?.packageInfo };
  const subscription = resolvePlan(shop.license, shop.subscriptionInfo?.packageInfo || {}, now);
  const startAt = isoDate(shop.license?.startAt || info.startAt || shop.basicInfo?.createdAt || "") || "";
  const expiresAt = isoDate(shop.license?.expiredAt || "") || "";
  return { packageName: PLANS[subscription.configuredPlan].name, packageType: subscription.configuredPlan,
    effectivePlan: subscription.plan, effectivePlanName: subscription.name,
    status: shop.license?.isActive === false ? "suspended" : subscription.isTrial ? "trial" : "active",
    ordersLimit: subscription.limits.monthlyOrders, remainingOrders: null,
    startAt, expiresAt, licenseStatus: subscription.status, licenseSource: shop.license ? "license" : "legacy",
    remainingDays: subscription.license.remainingDays, isUnlimited: subscription.license.isUnlimited,
    downgraded: subscription.downgraded, limits: subscription.limits, features: subscription.features };
};
export const buildSubscriptionUpdate = (shop, input, now = Date.now()) => {
  const current = readSubscription(shop, now);
  const rawPlan = input?.packageType ?? current.packageType;
  if (!["free", "lite", "plus", "pro", "basic", "professional", "enterprise"].includes(rawPlan)) throw new Error("Gói dịch vụ không hợp lệ.");
  const plan = normalizePlan(rawPlan), definition = PLANS[plan];
  const status = input?.status ?? current.status;
  if (!["active", "trial", "suspended", "inactive"].includes(status)) throw new Error("Trạng thái subscription không hợp lệ.");
  if (status === "trial" && plan !== "pro") throw new Error("Chỉ gói Pro có dùng thử 14 ngày.");
  const startAt = isoDate(input?.startAt ?? current.startAt) || (plan === "free" ? new Date(now).toISOString() : "");
  let expiresAt = plan === "free" ? "" : isoDate(input?.expiresAt ?? current.expiresAt);
  if (status === "trial" && startAt) expiresAt = new Date(timestamp(startAt) + 14 * 86400000).toISOString();
  if (plan !== "free" && (!startAt || !expiresAt || timestamp(expiresAt) <= timestamp(startAt))) throw new Error("Ngày giờ hết hạn phải hợp lệ và sau ngày bắt đầu.");
  const packageInfo = { packageName: definition.name, packageType: plan, status, ordersLimit: definition.limits.monthlyOrders, startAt, expiresAt };
  return { packageInfo, license: { ...shop.license, plan, isTrial: status === "trial", startAt, expiredAt: expiresAt || null, isActive: ["active", "trial"].includes(status) }, updatedAt: new Date(now).toISOString() };
};
