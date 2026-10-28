import { useState } from "react";
import { buildDailyRevenueNotification } from "../../shared/daily-revenue-content.js";
import { BarChart3, Check, Clock3, ShieldCheck } from "lucide-react";
import { dailyRevenueSettings } from "../../shared/daily-revenue-settings.js";

export default function DailyRevenueSettings({ settings: input, roles = [{ id: "owner", name: "Chủ cửa hàng", canReceive: true }], onChange }) {
  const settings = dailyRevenueSettings(input);
  const [scenario, setScenario] = useState("up");
  const sample = { date: "2026-10-28", todayRevenue: 12500000, todayOrderCount: 42, cancelledOrderCount: 1, refundedOrderCount: 2, grossProfit: 2200000,
    yesterdayRevenue: scenario === "up" ? 12500000 / 1.08 : scenario === "down" ? 12500000 / .92 : scenario === "flat" ? 12500000 : 0 };
  const preview = buildDailyRevenueNotification(sample);
  const options = [...roles, ...settings.dailyRevenueRoles.filter(id => !roles.some(role => role.id === id)).map(id => ({ id, name: id, canReceive: false }))];
  const change = (key, value) => onChange({ ...input, [key]: value });
  const toggleRole = id => onChange({ ...input, dailyRevenueRolesConfigured: true, dailyRevenueRoles: settings.dailyRevenueRoles.includes(id) ? settings.dailyRevenueRoles.filter(role => role !== id) : [...settings.dailyRevenueRoles, id] });
  return <fieldset className="daily-report-settings">
    <legend><BarChart3 size={17} />Báo cáo doanh thu cuối ngày</legend>
    <div className="report-system-status"><span><Check size={15} />Tự động tổng hợp</span><strong>Luôn bật</strong></div>
    <p className="report-setting-hint">Hệ thống tổng hợp doanh thu mỗi ngày, kể cả khi tắt thông báo hoặc quyền xem trên mobile.</p>
    <label className="report-toggle"><span><strong>Hiển thị trên mobile</strong><small>Chỉ tài khoản có quyền xem báo cáo được truy cập.</small></span><input type="checkbox" role="switch" checked={settings.dailyRevenueMobileEnabled} onChange={event => change("dailyRevenueMobileEnabled", event.target.checked)} /></label>
    <label className="report-toggle"><span><strong>Thông báo doanh thu</strong><small>Gửi push đến thiết bị của các vai trò đã chọn.</small></span><input type="checkbox" role="switch" checked={settings.dailyRevenueEnabled} onChange={event => change("dailyRevenueEnabled", event.target.checked)} /></label>
    {(!settings.enabled || !settings.dailyRevenueMobileEnabled) && <p className="report-warning">Thông báo doanh thu chỉ được gửi khi bật thông báo cửa hàng và hiển thị báo cáo trên mobile.</p>}
    <div className="report-setting-label"><ShieldCheck size={16} />Vai trò nhận thông báo</div>
    <div className="report-role-options">{options.map(role => <label className={`report-role-option ${!role.canReceive ? "unavailable" : ""}`} key={role.id}>
      <input type="checkbox" checked={settings.dailyRevenueRoles.includes(role.id)} disabled={!role.canReceive && !settings.dailyRevenueRoles.includes(role.id)} onChange={() => toggleRole(role.id)} /><span>{role.name}{!role.canReceive && <small>Chưa có quyền xem báo cáo</small>}</span>
    </label>)}</div>
    <label className="report-select"><span><Clock3 size={16} />Thời điểm gửi</span><select value={settings.dailyRevenueSendMode} onChange={event => change("dailyRevenueSendMode", event.target.value)}>
      <option value="scheduled">Theo giờ mỗi ngày</option><option value="shift_close">Sau mỗi lần chốt ca</option>
    </select></label>
    {settings.dailyRevenueSendMode === "scheduled" ? <label className="report-select"><span>Giờ gửi · Việt Nam (GMT+7)</span><input type="time" value={typeof input?.dailyRevenueTime === "string" ? input.dailyRevenueTime : "23:55"} required onInput={event => change("dailyRevenueTime", event.currentTarget.value)} onChange={event => change("dailyRevenueTime", event.target.value)} /></label> : <p className="report-setting-hint">Gửi tự động sau khi ca kết thúc thành công. Mỗi ca gửi một lần, tổng hợp doanh thu của ngày đến thời điểm kết thúc ca.</p>}
    <p className="report-setting-hint">Báo cáo tự động gửi theo cấu hình, không cần chốt báo cáo thủ công. Có thể chỉnh thông báo trên mobile bằng tài khoản có quyền cài đặt.</p>
    <section className="report-push-preview" aria-label="Xem trước thông báo doanh thu">
      <strong>Xem trước thông báo</strong><small>Số liệu minh họa · Nội dung tự thay đổi theo doanh thu</small>
      <div className="report-preview-tabs">{[["up", "Tăng"], ["down", "Giảm"], ["flat", "Không đổi"], ["no_baseline", "Chưa có kỳ trước"]].map(([id, label]) => <button key={id} type="button" aria-pressed={scenario === id} onClick={() => setScenario(id)}>{label}</button>)}</div>
      <article><strong>{preview.title}</strong><p>{preview.body}</p></article>
    </section>
  </fieldset>;
}
