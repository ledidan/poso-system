export const PLAN_POLICY_VERSION = "2026-10-16";
export const TRIAL_DAYS = 14;
export const DAY = 86400000;
const featureSet = (enabled) => ({ onlineSales: enabled, eInvoice: enabled, staff: enabled, payroll: enabled });
export const PLANS = Object.freeze({
  free: { id: "free", name: "Free", limits: { monthlyOrders: 300, products: 100, users: 1, shops: 1, payroll: 0 }, features: featureSet(false) },
  lite: { id: "lite", name: "Lite", limits: { monthlyOrders: 600, products: 500, users: 3, shops: 1, payroll: 3 }, features: featureSet(true) },
  plus: { id: "plus", name: "Plus", limits: { monthlyOrders: 1000, products: 1000, users: null, shops: 3, payroll: 15 }, features: featureSet(true) },
  pro: { id: "pro", name: "Pro", limits: { monthlyOrders: null, products: null, users: null, shops: 3, payroll: 30 }, features: featureSet(true) },
});
export const normalizePlan = (value) => {
  const key = String(value || "").trim().toLowerCase();
  return { professional: "pro", enterprise: "pro", basic: "lite" }[key] || (PLANS[key] ? key : "free");
};
export const timestamp = (value) => {
  if (value === null || value === undefined || value === "") return NaN;
  const parsed = typeof value === "number" || /^\d+$/.test(String(value)) ? Number(value) : Date.parse(value);
  return new Date(parsed).getTime();
};
export const monthPeriod = (now = Date.now()) => {
  const key = new Date(now + 7 * 3600000).toISOString().slice(0, 7);
  const [year, month] = key.split("-").map(Number);
  return { key, startAt: Date.UTC(year, month - 1, 1) - 7 * 3600000, endAt: Date.UTC(year, month, 1) - 7 * 3600000 };
};
export const resolvePlan = (license = {}, packageInfo = {}, now = Date.now()) => {
  license = license || {};
  const trial = license.isTrial === true || (license.plan === undefined && packageInfo.status === "trial");
  const configuredPlan = trial ? "pro" : normalizePlan(license.plan || packageInfo.packageType || (Number.isFinite(timestamp(license.expiredAt)) ? "pro" : "free"));
  const expiry = timestamp(license.expiredAt), start = timestamp(license.startAt);
  const dateValid = Number.isFinite(expiry) && (!license.startAt || Number.isFinite(start)) && (!Number.isFinite(start) || expiry > start);
  const available = configuredPlan === "free" || (dateValid && expiry > now && (!Number.isFinite(start) || start <= now));
  const plan = available ? configuredPlan : "free";
  const suspended = license.isActive === false;
  const downgraded = !available && configuredPlan !== "free";
  return { ...PLANS[plan], plan, configuredPlan, isTrial: trial && !downgraded, downgraded,
    status: suspended ? "suspended" : downgraded ? "downgraded" : trial ? "trial" : "active",
    policyVersion: PLAN_POLICY_VERSION, fallback: PLANS.free,
    license: { plan, configuredPlan, isTrial: trial && !downgraded, isUnlimited: plan === "free", downgraded,
      status: suspended ? "disabled" : "active", isUsable: !suspended, isActive: !suspended,
      startAt: Number.isFinite(start) ? new Date(start).toISOString() : null,
      expiredAt: Number.isFinite(expiry) ? new Date(expiry).toISOString() : null,
      remainingDays: plan === "free" ? null : Math.max(0, Math.ceil((expiry - now) / DAY)) },
  };
};
export const createTrial = (now = Date.now()) => {
  const startAt = new Date(now).toISOString(), expiredAt = new Date(now + TRIAL_DAYS * DAY).toISOString();
  const license = { plan: "pro", isTrial: true, startAt, expiredAt, isActive: true };
  const packageInfo = { packageName: "Pro dùng thử 14 ngày", packageType: "pro", status: "trial", startAt, expiresAt: expiredAt };
  return { license, packageInfo, subscriptionInfo: { packageInfo, startAt, expiresAt: expiredAt, createdAt: startAt } };
};
export const planError = (code, message, details = {}) => Object.assign(new Error(message), { status: 403, statusCode: 403, code, ...details });
