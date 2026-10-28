export const DAILY_REVENUE_DEFAULTS = Object.freeze({
  dailyRevenueMobileEnabled: true,
  dailyRevenueEnabled: false,
  dailyRevenueRoles: ["owner"],
  dailyRevenueSendMode: "scheduled",
  dailyRevenueTime: "23:55",
});

export const dailyRevenueSettings = (settings = {}) => ({
  enabled: settings?.enabled !== false,
  campaignEnabled: settings?.campaignEnabled !== false,
  dailyRevenueMobileEnabled: settings?.dailyRevenueMobileEnabled !== false,
  dailyRevenueEnabled: settings?.dailyRevenueEnabled === true,
  // Firebase omits empty arrays. An explicitly empty selection remains empty.
  dailyRevenueRoles: Array.isArray(settings?.dailyRevenueRoles)
    ? [...new Set(settings.dailyRevenueRoles.filter(role => typeof role === "string"))]
    : settings?.dailyRevenueRolesConfigured === true ? [] : ["owner"],
  dailyRevenueRolesConfigured: settings?.dailyRevenueRolesConfigured === true || Array.isArray(settings?.dailyRevenueRoles),
  dailyRevenueSendMode: ["scheduled", "shift_close"].includes(settings?.dailyRevenueSendMode)
    ? settings.dailyRevenueSendMode : "scheduled",
  dailyRevenueTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(settings?.dailyRevenueTime)
    ? settings.dailyRevenueTime : "23:55",
});

export const canReadDailyRevenue = (actor = {}) => {
  if (actor.role === "owner") return true;
  const permissions = actor.permissions || actor.roles?.permissions || {};
  const allowed = key => Object.hasOwn(permissions, key) ? permissions[key] === true : permissions.checkout === true;
  return allowed("manageMoney") && allowed("viewReports");
};

export const canConfigureDailyRevenue = actor => canReadDailyRevenue(actor) &&
  (actor?.role === "owner" || actor?.permissions?.settings === true || actor?.roles?.permissions?.settings === true);

export const reportRoleOptions = (roles = {}) => [
  { id: "owner", name: "Chủ cửa hàng", canReceive: true },
  ...Object.entries(roles || {}).filter(([id]) => id !== "owner").map(([id, role]) => ({
    id, name: role?.roleName || role?.name || id,
    canReceive: canReadDailyRevenue({ role: id, permissions: role?.permissions }),
  })),
];
const invalid = message => { throw Object.assign(new Error(message), { status: 400, code: "INVALID_REPORT_SETTINGS" }); };
export const updateDailyRevenueSettings = (previous = {}, input, roles = {}, { merchant = false } = {}) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid("Cấu hình thông báo không hợp lệ.");
  const merchantKeys = ["dailyRevenueEnabled", "dailyRevenueTime", "dailyRevenueSendMode", "dailyRevenueRoles"];
  if (merchant && (!Object.keys(input).length || Object.keys(input).some(key => !merchantKeys.includes(key)))) invalid("Chỉ có thể chỉnh thông báo, người nhận và thời điểm gửi báo cáo.");
  const keys = ["enabled", "campaignEnabled", "dailyRevenueMobileEnabled", "dailyRevenueEnabled"];
  for (const key of keys) if (key in input && typeof input[key] !== "boolean") invalid("Giá trị bật/tắt không hợp lệ.");
  if ("dailyRevenueTime" in input && (typeof input.dailyRevenueTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.dailyRevenueTime))) invalid("Giờ gửi báo cáo doanh thu không hợp lệ.");
  if ("dailyRevenueSendMode" in input && !["scheduled", "shift_close"].includes(input.dailyRevenueSendMode)) invalid("Báo cáo chỉ gửi tự động theo giờ hoặc sau khi kết thúc ca.");
  const next = { ...previous };
  for (const key of [...keys, "dailyRevenueTime", "dailyRevenueSendMode"]) if (key in input) next[key] = input[key];
  if ("dailyRevenueRoles" in input) {
    const allowed = reportRoleOptions(roles).filter(role => role.canReceive).map(role => role.id);
    if (!Array.isArray(input.dailyRevenueRoles) || input.dailyRevenueRoles.length > 100 || input.dailyRevenueRoles.some(role => !allowed.includes(role))) invalid("Vai trò nhận báo cáo phải có quyền xem báo cáo doanh thu.");
    next.dailyRevenueRoles = [...new Set(input.dailyRevenueRoles)]; next.dailyRevenueRolesConfigured = true;
  }
  const normalized = dailyRevenueSettings(next);
  if (normalized.dailyRevenueEnabled && !normalized.dailyRevenueRoles.length) invalid("Chọn ít nhất một vai trò nhận báo cáo trước khi bật thông báo.");
  return { ...next, ...normalized };
};
