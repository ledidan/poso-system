import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, Check, Clock3, Pencil, Plus, RefreshCw, Save, Send, Wrench, X } from "lucide-react";
import { request } from "../api.js";
import "./maintenance.css";

const dateInput = value => value ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)).replace(" ", "T") : "";
const format = value => new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
const emptyForm = () => ({ title: "Thông báo bảo trì hệ thống POSO", message: "", displayFrom: dateInput(new Date()), startsAt: "", endsAt: "", audiences: ["merchant", "mobile"], status: "draft" });
export const maintenanceStatus = (notice, now = Date.now()) => {
  if (notice.status === "draft") return "Bản nháp";
  if (["canceled", "retired"].includes(notice.status)) return notice.status === "canceled" ? "Đã thu hồi" : "Đã thay thế";
  if (Date.parse(notice.endsAt) <= now) return "Đã kết thúc";
  if (Date.parse(notice.displayFrom) > now) return "Chờ hiển thị";
  return Date.parse(notice.startsAt) > now ? "Sắp bảo trì" : "Đang bảo trì";
};
export default function MaintenancePage({ user }) {
  const [notices, setNotices] = useState([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null), [form, setForm] = useState(emptyForm), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [now, setNow] = useState(Date.now());
  const pending = useRef(false), mounted = useRef(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { const result = await request("/maintenance", user); if (mounted.current) setNotices(result.notices || []); }
    catch (failure) { if (mounted.current) setError(failure.message); }
    finally { if (mounted.current) setLoading(false); }
  }, [user]);
  useEffect(() => { mounted.current = true; load(); const timer = setInterval(() => setNow(Date.now()), 30000); return () => { mounted.current = false; clearInterval(timer); }; }, [load]);
  const open = notice => { setEditing(notice || { id: "" }); setForm(notice ? { ...notice, ...Object.fromEntries(["displayFrom", "startsAt", "endsAt"].map(key => [key, dateInput(notice[key])])), status: notice.status === "published" ? "published" : "draft" } : emptyForm()); setError(""); setMessage(""); };
  const field = key => event => setForm(previous => ({ ...previous, [key]: event.target.value }));
  const submit = async event => {
    event.preventDefault(); if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const body = { ...form, ...Object.fromEntries(["displayFrom", "startsAt", "endsAt"].map(key => [key, new Date(`${form[key]}+07:00`).toISOString()])) };
      await request(`/maintenance${editing.id ? `/${editing.id}` : ""}`, user, { method: editing.id ? "PUT" : "POST", body: JSON.stringify(body) });
      if (!mounted.current) return;
      setMessage(form.status === "published" ? "Đã công bố. Thông báo sẽ hiển thị trong khoảng thời gian đã chọn." : "Đã lưu bản nháp; thông báo chưa hiển thị trên web/mobile.");
      setEditing(null); await load();
    } catch (failure) { if (mounted.current) setError(failure.message || "Không thể lưu thông báo."); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const cancel = async notice => {
    if (pending.current) return; pending.current = true; setBusy(true); setError("");
    try { await request(`/maintenance/${notice.id}/cancel`, user, { method: "POST", body: "{}" }); if (mounted.current) { setMessage("Đã thu hồi thông báo."); await load(); } }
    catch (failure) { if (mounted.current) setError(failure.message); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  return <>
    <div className="heading"><div><p className="eyebrow">Thông báo hệ thống</p><h1>Bảo trì hệ thống</h1><p>Quản lý lịch hiển thị thông báo trên Merchant Dashboard và ứng dụng POSO.</p></div><button className="button primary" onClick={() => open()}><Plus size={17} />Tạo thông báo</button></div>
    {message && <div className="success-banner" role="status"><Check size={16} /> {message}</div>}
    {error && !editing && <div className="error-banner" role="alert">{error}</div>}
    <div className="maintenance-info"><Clock3 size={19} /><span>Giờ Việt Nam (UTC+7). Mỗi lần công bố thay thế thông báo đang hiển thị. Thông báo tự ẩn sau giờ kết thúc và không khóa thao tác bán hàng.</span></div>
    <section className="panel"><div className="maintenance-panel-head"><h2>Thông báo bảo trì</h2><button className="button" onClick={load} disabled={loading}><RefreshCw size={16} />Tải lại</button></div>
      {loading ? <p className="maintenance-empty">Đang tải thông báo...</p> : !notices.length ? <div className="maintenance-empty"><Wrench size={30} /><h3>Chưa có thông báo bảo trì</h3><p>Tạo bản nháp và chọn thời gian công bố đến các cửa hàng.</p></div> : <div className="maintenance-list">{notices.map(notice => <article key={notice.id}><div className="maintenance-list-title"><span className="icon-tile"><Wrench size={19} /></span><div><h3>{notice.title}</h3><span className={`maintenance-tag ${notice.status === "published" && Date.parse(notice.endsAt) > now ? "published" : ""}`}>{maintenanceStatus(notice, now)}</span></div></div><p>{notice.message}</p><dl><div><dt>Bảo trì</dt><dd>{format(notice.startsAt)} → {format(notice.endsAt)}</dd></div><div><dt>Hiển thị từ</dt><dd>{format(notice.displayFrom)}</dd></div><div><dt>Nơi hiển thị</dt><dd>{notice.audiences.map(value => value === "mobile" ? "Mobile" : "Merchant Dashboard").join(" · ")}</dd></div></dl><div className="actions"><button className="button" disabled={busy} onClick={() => open(notice)}><Pencil size={15} />Chỉnh sửa</button>{["published", "draft"].includes(notice.status) && <button className="button" disabled={busy} onClick={() => cancel(notice)}><X size={16} />Thu hồi</button>}</div></article>)}</div>}
    </section>
    {editing && <div className="backdrop modal-wrap"><form className="modal maintenance-modal" onSubmit={submit}><header><div><span className="icon-tile"><CalendarClock size={21} /></span><h2>{editing.id ? "Chỉnh sửa thông báo" : "Tạo thông báo bảo trì"}</h2><p>Nội dung hiển thị chung trên các kênh đã chọn.</p></div><button type="button" className="icon-button" aria-label="Đóng thông báo" disabled={busy} onClick={() => setEditing(null)}><X size={20} /></button></header>
      <label>Tiêu đề<input required maxLength={120} value={form.title} onChange={field("title")} disabled={busy} /></label>
      <label>Nội dung<textarea required rows={4} maxLength={2000} value={form.message} onChange={field("message")} placeholder="Nội dung bảo trì, phạm vi ảnh hưởng và hướng dẫn sử dụng..." disabled={busy} /></label>
      <div className="form-row">{[["startsAt", "Bắt đầu bảo trì"], ["endsAt", "Kết thúc dự kiến"]].map(([key, label]) => <label key={key}>{label}<input required type="datetime-local" value={form[key]} onChange={field(key)} disabled={busy} /></label>)}</div>
      <label>Hiển thị thông báo từ<input required type="datetime-local" value={form.displayFrom} onChange={field("displayFrom")} disabled={busy} /></label>
      <fieldset className="maintenance-targets"><legend>Nơi hiển thị</legend>{[["merchant", "Merchant Dashboard"], ["mobile", "Mobile"]].map(([value, label]) => <label key={value}><input type="checkbox" checked={form.audiences.includes(value)} disabled={busy} onChange={() => setForm(previous => ({ ...previous, audiences: previous.audiences.includes(value) ? previous.audiences.filter(item => item !== value) : [...previous.audiences, value] }))} />{label}</label>)}</fieldset>
      <label>Trạng thái<select value={form.status} onChange={field("status")} disabled={busy}><option value="draft">Bản nháp — chưa hiển thị</option><option value="published">Công bố theo lịch</option></select></label>
      <div className="maintenance-preview"><Wrench size={20} /><div><strong>{form.title || "Tiêu đề thông báo"}</strong><p>{form.message || "Nội dung thông báo sẽ hiển thị tại đây."}</p><small>{form.startsAt && format(`${form.startsAt}+07:00`)} {form.endsAt && `→ ${format(`${form.endsAt}+07:00`)}`}</small></div></div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <div className="actions"><button type="button" className="button" disabled={busy} onClick={() => setEditing(null)}>Đóng</button><button className="button primary" disabled={busy || !form.audiences.length}>{form.status === "published" ? <Send size={17} /> : <Save size={17} />}{busy ? "Đang lưu..." : form.status === "published" ? "Công bố thông báo" : "Lưu bản nháp"}</button></div>
    </form></div>}
  </>;
}
