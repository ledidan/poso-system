export const subscriptionDateInput = (value) => {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(value)).replace(" ", "T");
};
export const subscriptionDateISO = (value) => {
  const date = new Date(`${value}+07:00`);
  return value && Number.isFinite(date.getTime()) ? date.toISOString() : "";
};
export const formatSubscriptionDate = (value) => value && Number.isFinite(new Date(value).getTime()) ? new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value)) : "Chưa thiết lập";
export const isExpiringSubscription = (item, now = Date.now()) => !item.isUnlimited && ["active", "trial"].includes(item.licenseStatus) && Date.parse(item.expiresAt) > now && Date.parse(item.expiresAt) - now < 14 * 86400000;
