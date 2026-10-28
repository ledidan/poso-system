const money = value => new Intl.NumberFormat("vi-VN").format(value || 0);
const percent = value => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(value);

export const dailyRevenueComparison = (report = {}) => {
  const today = Number(report.todayRevenue) || 0, yesterday = Number(report.yesterdayRevenue) || 0;
  if (yesterday <= 0) return { direction: "no_baseline", label: "Hôm qua chưa phát sinh doanh thu", change: null };
  const change = (today - yesterday) / yesterday * 100;
  if (change === 0) return { direction: "flat", label: "Không đổi so với hôm qua", change: "0%" };
  const amount = Math.abs(change) < 0.1 ? "dưới 0,1%" : `${percent(Math.abs(change))}%`;
  return { direction: change > 0 ? "up" : "down", label: `${change > 0 ? "Tăng" : "Giảm"} ${amount} so với hôm qua`, change: amount };
};

export const buildDailyRevenueNotification = (report = {}) => {
  const date = String(report.date || "").split("-").reverse().slice(0, 2).join("/");
  const shopName = typeof report.shopName === "string" ? report.shopName.trim().slice(0, 80) : "";
  const comparison = dailyRevenueComparison(report);
  const title = comparison.direction === "up" ? `🎉 Doanh thu ngày ${date} tăng ${comparison.change}!`
    : comparison.direction === "down" ? `📊 Doanh thu ngày ${date} giảm ${comparison.change}`
      : comparison.direction === "flat" ? `Báo cáo kinh doanh ngày ${date}` : `📊 Tổng kết doanh thu ngày ${date}`;
  const headline = comparison.direction === "flat"
    ? `${shopName ? `${shopName} · ` : ""}Tổng doanh thu: ${money(report.todayRevenue)}đ | Đơn hàng: ${report.todayOrderCount || 0} | So với hôm qua: 0%.`
    : `${shopName || "Cửa hàng"} đạt ${money(report.todayRevenue)}đ từ ${report.todayOrderCount || 0} đơn hàng. ${comparison.label}.`;
  const details = [];
  if (Number.isFinite(report.cancelledOrderCount) && Number.isFinite(report.refundedOrderCount)) details.push(`Hủy: ${report.cancelledOrderCount} · Hoàn tiền: ${report.refundedOrderCount}.`);
  // The current ledger provides gross margin, not verified net profit.
  if (Number.isFinite(report.grossProfit)) details.push(`Lợi nhuận gộp: ${money(report.grossProfit)}đ.`);
  return { title, body: [headline, ...details, "Xem chi tiết →"].join(" "), comparison };
};
