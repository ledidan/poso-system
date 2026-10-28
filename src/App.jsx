import DailyRevenueSettings from "./components/DailyRevenueSettings.jsx";
import { useEffect, useMemo, useState } from "react";
import {
  Building2, ChevronRight, CircleDollarSign,
  ClipboardList, Clock3, CreditCard, FileSpreadsheet, Headphones, LayoutDashboard, LogOut, Menu,
  Image as ImageIcon, Megaphone, Plus, RefreshCw, Search, Send, Settings, ShieldCheck, ShoppingBag, Store,
  Trash2, UserRoundCog, Users, Save, X
} from "lucide-react";
import PlanLimits from "./components/PlanLimits.jsx";
import { PLANS } from "../server/subscriptions/PlanCatalog.js";
import FormField from "./components/FormField.jsx";
import StoreExportModal from "./components/StoreExportModal.jsx";
import MaintenancePage from "./components/MaintenancePage.jsx";
import { filterStores, STORE_STATUS_OPTIONS } from "../shared/store-filters.js";
import { subscriptionDateInput, subscriptionDateISO, formatSubscriptionDate, isExpiringSubscription } from "./SubscriptionDates.js";
import { request } from "./api.js";
import { login, logout } from "./api.js";

const money = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("vi-VN");
const dateTime = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const scheduledDateTime = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const localDateTimeInput = (value) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const statusMap = {
  downgraded: ["Đã về Free", "amber"],
  expired: ["Đã hết hạn", "red"], invalid: ["Chưa có thời hạn hợp lệ", "amber"], notStarted: ["Chưa bắt đầu", "blue"],
  active: ["Đang hoạt động", "green"], trial: ["Dùng thử", "blue"],
  comingSoon: ["Sắp ra mắt", "amber"], suspended: ["Tạm khóa", "red"],
  inactive: ["Ngừng hoạt động", "gray"], closed: ["Hoàn tất", "green"],
  canceled: ["Đã hủy", "red"], returned: ["Đã hoàn trả", "amber"],
  sent: ["Đã gửi", "green"], failed: ["Gửi lỗi", "red"],
  scheduled: ["Đã lên lịch", "blue"], sending: ["Đang gửi", "amber"]
};
const initials = (name = "POSO") => name.split(/\s+/).filter(Boolean).slice(-2).map((part) => part[0]).join("").toUpperCase();
const revenueAverageOptions = [
  ["under_500m", "Dưới 500 triệu / năm"],
  ["under_1b", "Dưới 1 tỷ / năm"],
  ["one_to_three_b", "Trên 1 tỷ đến 3 tỷ / năm"]
];
const campaignEmojis = ["📣", "🎉", "🔥", "🎁", "💰", "📈", "⭐", "✅", "⚠️", "🍽️", "🛍️", "❤️"];
const campaignErrorHints = {
  "messaging/mismatched-credential": "Thiết bị chưa khớp với cấu hình gửi thông báo. Vui lòng liên hệ quản trị hệ thống.",
  "messaging/registration-token-not-registered": "Token không còn hợp lệ; người dùng cần mở lại ứng dụng để đăng ký token mới.",
  "messaging/invalid-registration-token": "Token thiết bị sai định dạng hoặc đã bị hỏng.",
  "messaging/invalid-argument": "Payload notification có trường hoặc giá trị không hợp lệ.",
  "campaign/no-recipients": "Không tìm thấy thiết bị phù hợp với đối tượng nhận đã chọn."
};

function Status({ value }) {
  const [label, tone] = statusMap[value] || [value || "Không xác định", "gray"];
  return <span className={`status status-${tone}`}><i />{label}</span>;
}

function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  useEffect(() => {
    if (!lockedUntil) return;
    const update = () => setRemainingSeconds(Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [lockedUntil]);
  const submit = async (event) => {
    if (loading || remainingSeconds > 0) { event.preventDefault(); return; }
    event.preventDefault(); setError(""); setLoading(true);
    try { onLogin(await login(username, password)); }
    catch (error) {
      setError(`${error.message}${error.attemptsRemaining > 0 ? ` Còn ${error.attemptsRemaining} lần thử.` : ""}`);
      if (error.retryAfter) { setLockedUntil(Date.now() + error.retryAfter * 1000); setRemainingSeconds(error.retryAfter); }
    }
    finally { setLoading(false); }
  };

  return <main className="login-page">
    <section className="login-story">
      <Brand light />
      <div className="story-copy"><p className="eyebrow">Trung tâm vận hành</p><h1>Một góc nhìn.<br />Mọi cửa hàng.</h1><p>Theo dõi doanh thu, đơn hàng và trạng thái vận hành của toàn hệ thống trong thời gian thực.</p></div>
      <div className="story-stat"><strong>POSO</strong><span>Kết nối dữ liệu. Quản lý tập trung.</span></div>
    </section>
    <section className="login-panel"><form className="login-card" onSubmit={submit}>
      <div className="mobile-brand"><Brand /></div><span className="icon-tile"><ShieldCheck size={24} /></span>
      <h2>Chào mừng trở lại</h2><p>Đăng nhập bằng tài khoản quản trị hệ thống.</p>
      <label>Tên đăng nhập<input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Tên đăng nhập quản trị" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={128} required /></label>
      <label>Mật khẩu<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" maxLength={1024} required /></label>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <button className="button primary wide" disabled={loading || remainingSeconds > 0}>{loading ? "Đang xác thực..." : remainingSeconds > 0 ? `Thử lại sau ${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, "0")}` : "Đăng nhập"}<ChevronRight size={17} /></button>
      <small className="secure-note">Đăng nhập sai 5 lần sẽ bị khóa trong 15 phút.</small>
    </form></section>
  </main>;
}

function Brand({ light = false }) {
  return <div className={`brand ${light ? "brand-light" : ""}`}><span className="brand-mark">P</span><span>POSO <small>Central</small></span></div>;
}

const navigation = [
  ["overview", "Tổng quan", LayoutDashboard], ["stores", "Cửa hàng", Store],
  ["users", "Người dùng", UserRoundCog], ["subscriptions", "Subscription", CreditCard],
  ["campaigns", "Campaign thông báo", Megaphone], ["maintenance", "Bảo trì hệ thống", Clock3],
  ["care", "Chăm sóc người dùng", Headphones], ["orders", "Đơn hàng", ClipboardList]
];

function Sidebar({ page, setPage, user, onLogout, open, setOpen }) {
  return <aside className={`sidebar ${open ? "open" : ""}`}><Brand /><button className="close-side icon-button" onClick={() => setOpen(false)}><X size={20} /></button>
    <span className="nav-label">Không gian làm việc</span><nav>{navigation.map(([id, label, Icon]) => <button key={id} className={page === id ? "active" : ""} onClick={() => { setPage(id); setOpen(false); }}><Icon size={19} />{label}{id === "stores" && <small>ALL</small>}</button>)}</nav>
    <div className="sidebar-bottom"><button className="settings"><Settings size={18} />Thiết lập hệ thống</button><div className="user"><span className="avatar">{initials(user.name || user.username)}</span><div><strong>{user.name || "System Admin"}</strong><small>{user.username}</small></div><button className="icon-button" onClick={onLogout} title="Đăng xuất"><LogOut size={17} /></button></div></div>
  </aside>;
}

function Metric({ label, value, note, icon: Icon, tone }) {
  return <article className="metric"><span className={`metric-icon ${tone}`}><Icon size={21} /></span><div><small>{label}</small><strong>{value}</strong><p>{note}</p></div></article>;
}

function StoreTable({ stores, onOpen, compact = false }) {
  if (!stores.length) return <Empty icon={Store} title="Chưa có cửa hàng" text="Tạo cửa hàng đầu tiên để bắt đầu quản lý." />;
  return <div className="table-wrap"><table><thead><tr><th>Cửa hàng</th><th>Trạng thái</th><th>Doanh thu</th><th>Đơn hàng</th>{!compact && <><th>Khách hàng</th><th>Sản phẩm</th></>}<th /></tr></thead><tbody>{stores.map((store) => <tr key={store.id} onClick={() => onOpen(store.id)}><td><div className="store-cell"><span className="store-logo">{initials(store.name)}</span><span><strong>{store.name}</strong><small>{store.address || `Mã: ${store.id}`}</small></span></div></td><td><Status value={store.status} /></td><td><strong>{money.format(store.revenue)}</strong><small className="sub">30 ngày</small></td><td>{number.format(store.orderCount)}</td>{!compact && <><td>{number.format(store.customerCount)}</td><td>{number.format(store.itemCount)}</td></>}<td><ChevronRight size={17} /></td></tr>)}</tbody></table></div>;
}

function Overview({ data, subscriptions, onStore, setPage }) {
  if (!data) return <Skeleton />;
  const max = Math.max(...data.stores.map((item) => item.revenue), 1);
  return <><Heading eyebrow="Bảng điều hành" title="Tổng quan hệ thống" text={`Hiệu suất toàn bộ cửa hàng trong ${data.days} ngày gần nhất.`} extra={<span className="live"><i />Dữ liệu trực tiếp</span>} />
    <div className="metrics"><Metric label="Tổng doanh thu" value={money.format(data.totals.revenue)} note={`${number.format(data.totals.orderCount)} đơn hoàn tất`} icon={CircleDollarSign} tone="purple" /><Metric label="Tổng cửa hàng" value={data.totals.storeCount} note="Trên toàn hệ thống" icon={Building2} tone="blue" /><Metric label="Tổng người dùng" value={number.format(data.totals.userCount)} note="Tài khoản tại các cửa hàng" icon={Users} tone="green" /><Metric label="Subscription hoạt động" value={number.format(data.totals.subscriptionActiveCount)} note={`${data.totals.subscriptionTrialCount} dùng thử · ${data.totals.subscriptionSuspendedCount} tạm dừng`} icon={CreditCard} tone="orange" /></div>
    <div className="dashboard-grid"><section className="panel"><PanelHead title="Doanh thu theo cửa hàng" text="So sánh trong kỳ hiện tại" /><div className="revenue-list">{data.stores.slice().sort((a,b) => b.revenue-a.revenue).slice(0,6).map((store,index) => <button key={store.id} onClick={() => onStore(store.id)}><b>{String(index+1).padStart(2,"0")}</b><span><span><strong>{store.name}</strong><em>{money.format(store.revenue)}</em></span><i><u style={{ width: `${Math.max(store.revenue/max*100,2)}%` }} /></i></span></button>)}</div></section>
      <section className="panel health"><PanelHead title="Kiểm soát hệ thống" text="Chỉ số cần chú ý" /><div><Health icon={ShoppingBag} tone="purple" title={`${data.totals.activeOrderCount} đơn đang xử lý`} text="Cập nhật từ tất cả cửa hàng" /><Health icon={CreditCard} tone="orange" title={`${data.totals.subscriptionExpiringCount} subscription sắp hết hạn`} text="Trong vòng 14 ngày tới" /><Health icon={UserRoundCog} tone="green" title={`${data.totals.userCount} người dùng`} text="Được phân quyền trên hệ thống" /></div></section></div>
    <section className="panel overview-subscriptions"><PanelHead title="Kiểm soát subscription" text="Trạng thái gói dịch vụ của từng cửa hàng" action={() => setPage("subscriptions")} /><div className="table-wrap"><table><thead><tr><th>Cửa hàng</th><th>Gói</th><th>Trạng thái</th><th>Đơn hàng đã dùng</th><th>Ngày hết hạn</th></tr></thead><tbody>{subscriptions.slice(0,5).map((item) => <tr key={item.shopId}><td><strong>{item.shopName}</strong></td><td>{item.effectivePlanName || item.packageName}</td><td><Status value={item.licenseStatus} /></td><td>{item.usage?.orders?.used || 0} / {item.limits?.monthlyOrders === null ? "Không giới hạn" : number.format(item.limits?.monthlyOrders || 0)}</td><td>{item.isUnlimited ? "Không giới hạn" : formatSubscriptionDate(item.expiresAt)}</td></tr>)}</tbody></table></div></section>
    <section className="panel"><PanelHead title="Hiệu suất cửa hàng" text="Cập nhật theo dữ liệu mới nhất" action={() => setPage("stores")} /><StoreTable stores={data.stores.slice(0,5)} onOpen={onStore} compact /></section>
  </>;
}

function Health({ icon: Icon, tone, title, text }) { return <article className="health-row"><span className={tone}><Icon size={19} /></span><div><strong>{title}</strong><small>{text}</small></div></article>; }
function PanelHead({ title, text, action }) { return <div className="panel-head"><div><h2>{title}</h2><p>{text}</p></div>{action && <button onClick={action}>Xem tất cả <ChevronRight size={15} /></button>}</div>; }
function Heading({ eyebrow, title, text, extra }) { return <div className="heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><span>{text}</span></div>{extra}</div>; }
function Empty({ icon: Icon, title, text }) { return <div className="empty"><Icon size={28} /><strong>{title}</strong><span>{text}</span></div>; }
function Skeleton() { return <div className="skeleton">{Array.from({ length: 8 }).map((_,i) => <i key={i} />)}</div>; }

function Stores({ stores, loading, onStore, onCreate }) {
  const [search, setSearch] = useState(""); const [status, setStatus] = useState("all");
  const [exportOpen, setExportOpen] = useState(false); const [exportMessage, setExportMessage] = useState("");
  const list = useMemo(() => filterStores(stores, { search, status }), [stores, search, status]);
  return <><Heading eyebrow="Danh mục" title="Quản lý cửa hàng" text={`${stores.length} cửa hàng đang kết nối với POSO.`} extra={<div className="heading-actions"><button className="button secondary" onClick={() => { setExportMessage(""); setExportOpen(true); }} disabled={loading || !stores.length}><FileSpreadsheet size={17} />Xuất Excel</button><button className="button primary" onClick={onCreate}><Plus size={17} />Thêm cửa hàng</button></div>} />
    {exportMessage && <div className="success-banner" role="status">{exportMessage}</div>}
    <section className="panel"><div className="toolbar"><label className="search"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm tên, địa chỉ hoặc mã cửa hàng..." maxLength={200} /></label><select aria-label="Trạng thái cửa hàng" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">Tất cả trạng thái</option>{STORE_STATUS_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>{loading ? <Skeleton /> : <StoreTable stores={list} onOpen={onStore} />}</section>
    {exportOpen && <StoreExportModal search={search} status={status} filteredCount={list.length} totalCount={stores.length} close={() => setExportOpen(false)} exported={({ count }) => { setExportOpen(false); setExportMessage(`Đã tải file Excel chi tiết${count ? ` ${number.format(count)} cửa hàng` : ""}.`); }} />}
  </>;
}

function Orders({ orders, stores, loading }) {
  const [shop, setShop] = useState("all"); const list = shop === "all" ? orders : orders.filter((order) => order.shopId === shop);
  return <><Heading eyebrow="Giao dịch" title="Đơn hàng toàn hệ thống" text="Theo dõi giao dịch mới nhất từ mọi cửa hàng." /><section className="panel"><div className="toolbar"><strong>{number.format(list.length)} đơn gần nhất</strong><select value={shop} onChange={(e) => setShop(e.target.value)}><option value="all">Tất cả cửa hàng</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></div>{loading ? <Skeleton /> : list.length ? <div className="table-wrap"><table><thead><tr><th>Mã đơn</th><th>Cửa hàng</th><th>Khách hàng</th><th>Thời gian</th><th>Trạng thái</th><th>Tổng tiền</th></tr></thead><tbody>{list.map((order) => <tr key={`${order.shopId}-${order.bucket}-${order.id}`}><td><strong>#{order.id.slice(-8).toUpperCase()}</strong><small className="sub">{order.itemCount} sản phẩm</small></td><td>{order.shopName}</td><td>{order.customerName}</td><td>{order.timeStamp ? dateTime.format(new Date(order.timeStamp)) : "—"}</td><td><Status value={order.status} /></td><td><strong>{money.format(order.total)}</strong></td></tr>)}</tbody></table></div> : <Empty icon={ClipboardList} title="Chưa có đơn hàng" text="Đơn hàng mới sẽ xuất hiện tại đây." />}</section></>;
}

function StoreDrawer({ id, user, close, reload }) {
  const [detail, setDetail] = useState(null); const [form, setForm] = useState({}); const [edit, setEdit] = useState(false); const [error, setError] = useState("");
  const load = () => request(`/stores/${id}`, user).then((data) => { setDetail(data); setForm(data.store); }).catch((e) => setError(e.message));
  useEffect(() => {
    let active = true;
    request(`/stores/${id}`, user)
      .then((data) => { if (active) { setDetail(data); setForm(data.store); } })
      .catch((error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [id, user]);
  const save = async (event) => { event.preventDefault(); try { await request(`/stores/${id}`, user, { method: "PATCH", body: JSON.stringify(form) }); setEdit(false); await load(); reload(); } catch (e) { setError(e.message); } };
  return <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}><aside className="drawer"><header><strong>Chi tiết cửa hàng</strong><button className="icon-button" onClick={close}><X size={20} /></button></header>{!detail ? <div className="drawer-loading"><RefreshCw className="spin" />Đang tải...</div> : <><div className="store-hero"><span className="store-logo large">{initials(detail.store.name)}</span><div><h2>{detail.store.name}</h2><p>{detail.store.address || "Chưa có địa chỉ"}</p><Status value={detail.store.status} /></div></div><div className="drawer-metrics"><MetricSmall label="Doanh thu 30 ngày" value={money.format(detail.store.revenue)} /><MetricSmall label="Đơn hoàn tất" value={number.format(detail.store.orderCount)} /><MetricSmall label="Khách hàng" value={number.format(detail.store.customerCount)} /><MetricSmall label="Nhân sự" value={number.format(detail.personnel.length)} /></div>{error && <div className="error-banner">{error}</div>}{edit ? <StoreForm reportRoles={detail.reportRoles} form={form} setForm={setForm} submit={save} cancel={() => setEdit(false)} /> : <><button className="button secondary drawer-edit" onClick={() => setEdit(true)}>Chỉnh sửa thông tin</button><section className="drawer-section"><div className="section-title"><h3>Người dùng cửa hàng</h3><span>{detail.personnel.length} tài khoản</span></div>{detail.personnel.length ? <div className="personnel-list">{detail.personnel.map((person) => <article key={person.id}><span className="store-logo">{initials(person.name || person.id)}</span><div><strong>{person.name || person.id}</strong><small>{person.id} · {person.role || "Nhân viên"}</small></div><Status value={person.isActive === false ? "inactive" : "active"} /></article>)}</div> : <Empty icon={Users} title="Chưa có người dùng" text="Cửa hàng chưa được gán tài khoản." />}</section><section className="drawer-section"><div className="section-title"><h3>Chi tiết đơn hàng gần đây</h3><span>{detail.recentOrders.length} đơn</span></div>{detail.recentOrders.length ? <div className="order-details">{detail.recentOrders.slice(0,8).map((order,index) => <details className="order-detail-card" key={`${order.bucket}-${order.id}`} open={index === 0}><summary><span><strong>#{order.id.slice(-7).toUpperCase()}</strong><small>{order.customerName || "Khách lẻ"} · {order.itemCount} món</small></span><span><strong>{money.format(order.total)}</strong><small>{order.timeStamp ? dateTime.format(new Date(order.timeStamp)) : ""}</small></span></summary><div className="order-detail-body"><div className="order-status-line"><Status value={order.status} /><span>{order.paymentMethod || "Chưa rõ thanh toán"}</span></div>{order.items?.length ? <div className="order-items">{order.items.map((item) => <div className="order-item" key={item.id}><span><b>{item.quantity}×</b> {item.name}</span><strong>{money.format(item.price * item.quantity)}</strong></div>)}</div> : <p className="order-empty">Đơn chưa có thông tin món.</p>}<div className="order-meta">{order.phone && <span>Điện thoại: {order.phone}</span>}{order.address && <span>Địa chỉ: {order.address}</span>}{order.note && <span>Ghi chú: {order.note}</span>}</div></div></details>)}</div> : <Empty icon={ClipboardList} title="Chưa có đơn hàng" text="Đơn mới sẽ hiển thị tại đây." />}</section></>}</>}</aside></div>;
}
function MetricSmall({ label, value }) { return <div><small>{label}</small><strong>{value}</strong></div>; }
function StoreForm({ form, setForm, submit, cancel, reportRoles }) {
  const field = (key) => (event) => setForm({ ...form, [key]: event.target.value });
  const settings = form.notificationSettings || {};
  const toggleSetting = (key) => setForm({
    ...form,
    notificationSettings: { ...settings, [key]: settings[key] === false }
  });
  return <form className="store-form" onSubmit={submit}>
    <h3>Thông tin cửa hàng</h3>
    <label>Tên cửa hàng<input value={form.name || ""} onChange={field("name")} required /></label>
    <label>Địa chỉ<input value={form.address || ""} onChange={field("address")} /></label>
    <div className="form-row"><label>Số điện thoại<input value={form.phoneNumber || ""} onChange={field("phoneNumber")} /></label><label>Trạng thái<select value={form.status || "active"} onChange={field("status")}><option value="active">Đang hoạt động</option><option value="comingSoon">Sắp ra mắt</option><option value="suspended">Tạm khóa</option><option value="inactive">Ngừng hoạt động</option></select></label></div>
    <label>Ngành hàng<input value={form.businessCategory || ""} onChange={field("businessCategory")} /></label>
    <fieldset className="radio-field"><legend>Doanh thu trung bình</legend>{revenueAverageOptions.map(([value, label]) => <label key={value}><input type="radio" name="revenueAverage" value={value} checked={form.revenueAverage === value} onChange={field("revenueAverage")} /><span>{label}</span></label>)}</fieldset>
    <fieldset className="toggle-field"><legend>Cấu hình thông báo</legend><label><input type="checkbox" checked={settings.enabled !== false} onChange={() => toggleSetting("enabled")} /><span>Bật thông báo cho cửa hàng</span></label><label><input type="checkbox" checked={settings.campaignEnabled !== false} onChange={() => toggleSetting("campaignEnabled")} /><span>Nhận campaign từ hệ thống</span></label></fieldset>
    <DailyRevenueSettings settings={settings} roles={reportRoles} onChange={notificationSettings => setForm({ ...form, notificationSettings })} />
    <div className="actions"><button type="button" className="button secondary" onClick={cancel}>Hủy</button><button className="button primary"><Save size={16} />Lưu thay đổi</button></div>
  </form>;
}

function CreateModal({ user, close, created }) {
  const [form, setForm] = useState({ name:"", address:"", phoneNumber:"", businessCategory:"" }); const [error,setError]=useState("");
  const submit = async (event) => { event.preventDefault(); try { await request("/stores", user, { method:"POST", body:JSON.stringify(form) }); created(); } catch(e) { setError(e.message); } };
  const field = (key) => (e) => setForm({ ...form, [key]:e.target.value });
  return <div className="backdrop modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && close()}><form className="modal" onSubmit={submit}><header><div><span className="icon-tile"><Store size={21} /></span><h2>Thêm cửa hàng</h2><p>Kết nối một điểm bán mới vào hệ thống.</p></div><button type="button" className="icon-button" onClick={close}><X size={20} /></button></header><label>Tên cửa hàng<input value={form.name} onChange={field("name")} placeholder="Ví dụ: POSO Nguyễn Huệ" required /></label><label>Địa chỉ<input value={form.address} onChange={field("address")} placeholder="Số nhà, đường, quận/huyện" /></label><div className="form-row"><label>Số điện thoại<input value={form.phoneNumber} onChange={field("phoneNumber")} /></label><label>Ngành hàng<input value={form.businessCategory} onChange={field("businessCategory")} /></label></div>{error && <div className="error-banner">{error}</div>}<div className="actions"><button type="button" className="button secondary" onClick={close}>Hủy</button><button className="button primary">Tạo cửa hàng</button></div></form></div>;
}

function UserModal({ current, stores, user, close, saved }) {
  const firstMembership = current?.stores?.[0] || {};
  const [form, setForm] = useState({
    username: current?.username || "",
    password: "",
    name: firstMembership.name || "",
    role: firstMembership.role || "Nhân viên",
    isActive: firstMembership.isActive !== false,
    storeIds: current?.stores?.map((store) => store.shopId) || []
  });
  const [error, setError] = useState("");
  const toggleStore = (shopId) => setForm((value) => ({ ...value, storeIds: value.storeIds.includes(shopId) ? value.storeIds.filter((id) => id !== shopId) : [...value.storeIds, shopId] }));
  const submit = async (event) => {
    event.preventDefault(); setError("");
    try {
      const payload = current ? { password: form.password } : form;
      await request(current ? `/users/${current.username}` : "/users", user, { method: current ? "PATCH" : "POST", body: JSON.stringify(payload) });
      saved();
    } catch (e) { setError(e.message); }
  };
  return <div className="backdrop modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && close()}>
    <form className="modal" onSubmit={submit}>
      <header><div><span className="icon-tile"><UserRoundCog size={21} /></span><h2>{current ? "Sửa người dùng" : "Thêm người dùng"}</h2><p>{current ? "Cập nhật mật khẩu đăng nhập của người dùng." : "Phân quyền người dùng vào một hoặc nhiều cửa hàng."}</p></div><button type="button" className="icon-button" onClick={close}><X size={20} /></button></header>
      <div className="form-row">
        <label>Tên đăng nhập<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} disabled={Boolean(current)} required /></label>
        {current ? (
          <label>Mật khẩu mới<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Tối thiểu 6 ký tự" autoComplete="new-password" minLength={6} required /></label>
        ) : (
          <label>Họ tên<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
        )}
      </div>
      {!current && <>
        <div className="form-row"><label>Mật khẩu<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Tối thiểu 6 ký tự" autoComplete="new-password" minLength={6} required /></label><label>Vai trò<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option>Admin</option><option>Quản lý</option><option>Thu ngân</option><option>Nhân viên</option></select></label></div>
        <label className="checkbox-line"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />Cho phép đăng nhập và làm việc</label>
        <fieldset className="store-picker"><legend>Cửa hàng được truy cập</legend>{stores.map((store) => <label key={store.id}><input type="checkbox" checked={form.storeIds.includes(store.id)} onChange={() => toggleStore(store.id)} /><span className="store-logo">{initials(store.name)}</span><span><strong>{store.name}</strong><small>{store.address || store.id}</small></span></label>)}</fieldset>
      </>}
      {error && <div className="error-banner">{error}</div>}
      <div className="actions"><button type="button" className="button secondary" onClick={close}>Hủy</button><button className="button primary">{current ? "Lưu thay đổi" : "Tạo người dùng"}</button></div>
    </form>
  </div>;
}

function UsersPage({ users: records, stores, user, loading, reload }) {
  const [query, setQuery] = useState(""); const [role, setRole] = useState("all"); const [status, setStatus] = useState("all"); const [modal, setModal] = useState(undefined);
  const roles = useMemo(() => Array.from(new Set(records.flatMap((item) => item.stores.map((store) => store.role)).filter(Boolean))).sort(), [records]);
  const users = records.filter((item) => {
    const active = item.stores.some((store) => store.isActive !== false);
    const matchesSearch = `${item.username} ${item.stores.map((store) => `${store.name} ${store.shopName} ${store.role}`).join(" ")}`.toLowerCase().includes(query.toLowerCase());
    return matchesSearch && (role === "all" || item.stores.some((store) => store.role === role)) && (status === "all" || (status === "active" ? active : !active));
  });
  const remove = async (item) => {
    if (!window.confirm(`Xóa người dùng ${item.username}?`)) return;
    await request(`/users/${item.username}`, user, { method: "DELETE" }); reload();
  };
  return <><Heading eyebrow="Phân quyền" title="Người dùng cửa hàng" text={`${records.length} tài khoản đang làm việc trong hệ thống.`} extra={<button className="button primary" onClick={() => setModal(null)}><Plus size={17} />Thêm người dùng</button>} /><section className="panel"><div className="toolbar"><label className="search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm tài khoản, họ tên hoặc cửa hàng..." /></label><div className="filter-group"><select value={role} onChange={(e) => setRole(e.target.value)}><option value="all">Tất cả vai trò</option>{roles.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">Tất cả trạng thái</option><option value="active">Đang hoạt động</option><option value="inactive">Ngừng hoạt động</option></select><strong>{users.length} người dùng</strong></div></div>{loading ? <Skeleton /> : users.length ? <div className="table-wrap"><table><thead><tr><th>Người dùng</th><th>Vai trò</th><th>Cửa hàng</th><th>Trạng thái</th><th /></tr></thead><tbody>{users.map((item) => { const first = item.stores[0] || {}; return <tr key={item.username}><td><div className="store-cell"><span className="store-logo">{initials(first.name || item.username)}</span><span><strong>{first.name || item.username}</strong><small>{item.username}</small></span></div></td><td>{first.role || "Nhân viên"}</td><td><div className="tag-list">{item.stores.map((store) => <span key={store.shopId}>{store.shopName}</span>)}</div></td><td><Status value={item.stores.some((store) => store.isActive !== false) ? "active" : "inactive"} /></td><td><div className="row-actions"><button className="button secondary" onClick={() => setModal(item)}>Sửa</button><button className="icon-button danger" onClick={() => remove(item)}><Trash2 size={16} /></button></div></td></tr>; })}</tbody></table></div> : <Empty icon={UserRoundCog} title="Không có người dùng phù hợp" text="Thử thay đổi bộ lọc hoặc thêm tài khoản mới." />}</section>{modal !== undefined && <UserModal current={modal} stores={stores} user={user} close={() => setModal(undefined)} saved={() => { setModal(undefined); reload(); }} />}</>;
}

function SubscriptionModal({ subscription, user, close, saved }) {
  const [form, setForm] = useState({ ...subscription });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const selectedPlan = PLANS[form.packageType] || PLANS.free;
  const field = (key) => (event) => setForm({ ...form, [key]: event.target.value, ...(key === "status" && event.target.value === "trial" && form.startAt ? { expiresAt: new Date(Date.parse(form.startAt) + 14 * 86400000).toISOString() } : {}) });
  const dateField = (key) => (event) => {
    const value = subscriptionDateISO(event.target.value);
    setForm({ ...form, [key]: value, ...(key === "startAt" && form.status === "trial" && value ? { expiresAt: new Date(Date.parse(value) + 14 * 86400000).toISOString() } : {}) });
  };
  const selectPlan = (event) => setForm({ ...form, packageType: event.target.value, status: form.status === "trial" && event.target.value !== "pro" ? "active" : form.status });
  const submit = async (event) => {
    event.preventDefault(); setError(""); setSaving(true);
    try { await request(`/subscriptions/${subscription.shopId}`, user, { method: "PATCH", body: JSON.stringify(form) }); saved(); }
    catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };
  return <div className="backdrop modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && !saving && close()}><form className="modal" onSubmit={submit}>
    <header><div><span className="icon-tile"><CreditCard size={21} /></span><h2>Cập nhật gói dịch vụ</h2><p>{subscription.shopName}</p></div><button type="button" className="icon-button" disabled={saving} onClick={close} aria-label="Đóng"><X size={20} /></button></header>
    <FormField label="Gói đăng ký"><select value={form.packageType} onChange={selectPlan}>{Object.values(PLANS).map((plan) => <option value={plan.id} key={plan.id}>{plan.name}</option>)}</select></FormField>
    <PlanLimits limits={selectedPlan.limits} />
    <p className="subscription-help">Hạn mức tính chung cho subscription, gồm cả cửa hàng trung tâm. Lite tối đa 3 tài khoản, bao gồm chủ cửa hàng. Bán online và Hóa đơn điện tử được bật từ Lite.</p>
    {form.packageType !== "free" ? <div className="form-row">
      <FormField label="Ngày giờ bắt đầu (GMT+7)" type="datetime-local" step="1" value={subscriptionDateInput(form.startAt)} onChange={dateField("startAt")} required />
      <FormField label="Ngày giờ hết hạn (GMT+7)" type="datetime-local" step="1" min={subscriptionDateInput(form.startAt)} value={subscriptionDateInput(form.expiresAt)} onChange={dateField("expiresAt")} readOnly={form.status === "trial"} required />
    </div> : <p className="subscription-help">Free không giới hạn thời gian sử dụng. Ngày hết hạn được bỏ trống.</p>}
    <FormField label="Trạng thái"><select value={form.status} onChange={field("status")}><option value="active">Đang hoạt động</option>{form.packageType === "pro" && <option value="trial">Dùng thử Pro 14 ngày</option>}<option value="suspended">Tạm khóa</option><option value="inactive">Ngừng hoạt động</option></select></FormField>
    <p className="subscription-help">Khi Pro dùng thử hoặc gói trả phí hết hạn, hệ thống tự chuyển về Free và giữ nguyên dữ liệu. Hạn mức đơn làm mới theo tháng dương lịch tại Việt Nam.</p>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <div className="actions"><button type="button" className="button secondary" disabled={saving} onClick={close}>Hủy</button><button className="button primary" disabled={saving}>{saving ? "Đang lưu..." : "Lưu gói dịch vụ"}</button></div>
  </form></div>;
}

function SubscriptionsPage({ subscriptions, user, loading, reload }) {
  const [editing, setEditing] = useState(null);
  return <>
    <Heading eyebrow="Gói dịch vụ" title="Quản lý subscription" text="Dùng thử Pro 14 ngày, sau đó tự về Free. Hạn mức tính chung cho tất cả gian hàng trong subscription." />
    <div className="subscription-summary">
      <Metric label="Đang hoạt động" value={subscriptions.filter((item) => ["active", "downgraded"].includes(item.licenseStatus)).length} note="Bao gồm Free không thời hạn" icon={ShieldCheck} tone="green" />
      <Metric label="Dùng thử Pro" value={subscriptions.filter((item) => item.licenseStatus === "trial").length} note="Tự về Free sau 14 ngày" icon={Clock3} tone="orange" />
      <Metric label="Sắp hết hạn" value={subscriptions.filter((item) => isExpiringSubscription(item)).length} note="Gói có thời hạn còn dưới 14 ngày" icon={CreditCard} tone="purple" />
    </div>
    <section className="panel">{loading ? <Skeleton /> : subscriptions.length ? <div className="table-wrap"><table>
      <thead><tr><th>Cửa hàng trung tâm</th><th>Gói đang sử dụng</th><th>Trạng thái</th><th>Hạn mức dùng chung</th><th>Thời hạn (GMT+7)</th><th /></tr></thead>
      <tbody>{subscriptions.map((item) => <tr key={item.shopId}>
        <td><strong>{item.shopName}</strong><small className="sub">{item.shopId} · {item.branchIDs?.length || 1} gian hàng</small></td>
        <td><strong>{item.effectivePlanName || item.packageName}</strong>{item.downgraded && <small className="sub">Gói {item.packageName} đã hết hạn</small>}</td>
        <td><Status value={item.licenseStatus} />{item.remainingDays !== null && ["active", "trial"].includes(item.licenseStatus) && <small className="sub">Còn {item.remainingDays} ngày</small>}</td>
        <td><span>Đơn tháng: {item.usage?.orders?.used || 0} / {item.limits?.monthlyOrders === null ? "Không giới hạn" : number.format(item.limits?.monthlyOrders || 0)}</span><small className="sub">Sản phẩm: {item.usage?.products?.used || 0} / {item.limits?.products === null ? "Không giới hạn" : number.format(item.limits?.products || 0)}</small><small className="sub">Tài khoản: {item.usage?.users?.used || 0} / {item.limits?.users === null ? "Không giới hạn" : item.limits?.users}</small></td>
        <td>{item.isUnlimited ? <strong>Không giới hạn</strong> : <><span className="subscription-date">Từ {formatSubscriptionDate(item.startAt)}</span><strong className="sub">Đến {formatSubscriptionDate(item.expiresAt)}</strong></>}</td>
        <td><button className="button secondary" onClick={() => setEditing(item)}>Cập nhật</button></td>
      </tr>)}</tbody>
    </table></div> : <div className="empty-state">Chưa có gói dịch vụ.</div>}</section>
    {editing && <SubscriptionModal subscription={editing} user={user} close={() => setEditing(null)} saved={() => { setEditing(null); reload(); }} />}
  </>;
}

function TicketModal({ account, stores, user, close, saved }) {
  const membership = account?.stores?.[0] || {};
  const [form, setForm] = useState({ userId: account?.username || "", userName: membership.name || account?.username || "", shopId: membership.shopId || "", shopName: membership.shopName || "", subject: "", note: "", channel: "phone", priority: "normal" }); const [error, setError] = useState("");
  const field = (key) => (event) => setForm({ ...form, [key]: event.target.value });
  const submit = async (event) => { event.preventDefault(); try { await request("/support-tickets", user, { method: "POST", body: JSON.stringify(form) }); saved(); } catch (e) { setError(e.message); } };
  return <div className="backdrop modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && close()}><form className="modal" onSubmit={submit}><header><div><span className="icon-tile"><Headphones size={21} /></span><h2>Tạo yêu cầu chăm sóc</h2><p>Ghi nhận hỗ trợ dành cho tài khoản người dùng hệ thống.</p></div><button type="button" className="icon-button" onClick={close}><X size={20} /></button></header><div className="form-row"><label>Người dùng<input value={form.userName} onChange={field("userName")} required /></label><label>Tên đăng nhập<input value={form.userId} onChange={field("userId")} required /></label></div><label>Cửa hàng<select value={form.shopId} onChange={(e) => { const store = stores.find((item) => item.id === e.target.value); setForm({ ...form, shopId: e.target.value, shopName: store?.name || "" }); }}><option value="">Toàn hệ thống</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label><label>Chủ đề<input value={form.subject} onChange={field("subject")} placeholder="Nội dung cần hỗ trợ" required /></label><label>Ghi chú<textarea value={form.note} onChange={field("note")} rows="4" /></label><div className="form-row"><label>Kênh liên hệ<select value={form.channel} onChange={field("channel")}><option value="phone">Điện thoại</option><option value="zalo">Zalo</option><option value="email">Email</option><option value="facebook">Facebook</option><option value="other">Khác</option></select></label><label>Ưu tiên<select value={form.priority} onChange={field("priority")}><option value="low">Thấp</option><option value="normal">Bình thường</option><option value="high">Cao</option><option value="urgent">Khẩn cấp</option></select></label></div>{error && <div className="error-banner">{error}</div>}<div className="actions"><button type="button" className="button secondary" onClick={close}>Hủy</button><button className="button primary">Tạo yêu cầu</button></div></form></div>;
}

function CustomerCarePage({ users: accounts, tickets, stores, user, loading, reload }) {
  const [query, setQuery] = useState(""); const [ticketAccount, setTicketAccount] = useState(undefined);
  const list = accounts.filter((item) => `${item.username} ${item.stores.map((store) => `${store.name} ${store.shopName} ${store.role}`).join(" ")}`.toLowerCase().includes(query.toLowerCase())).slice(0,100);
  const updateTicket = async (ticket, status) => { await request(`/support-tickets/${ticket.id}`, user, { method: "PATCH", body: JSON.stringify({ status }) }); reload(); };
  return <><Heading eyebrow="Hỗ trợ cơ bản" title="Chăm sóc người dùng" text="Tra cứu tài khoản cửa hàng và theo dõi yêu cầu hỗ trợ tập trung." extra={<button className="button primary" onClick={() => setTicketAccount(null)}><Plus size={17} />Tạo yêu cầu</button>} /><div className="care-grid"><section className="panel"><PanelHead title="Người dùng hệ thống" text={`${accounts.length} tài khoản từ tất cả cửa hàng`} /><div className="toolbar"><label className="search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm tên, tài khoản, vai trò hoặc cửa hàng..." /></label></div>{loading ? <Skeleton /> : <div className="customer-list">{list.map((account) => { const first = account.stores[0] || {}; return <button key={account.username} onClick={() => setTicketAccount(account)}><span className="store-logo">{initials(first.name || account.username)}</span><span><strong>{first.name || account.username}</strong><small>{account.username} · {account.stores.map((store) => `${store.shopName} (${store.role || "Nhân viên"})`).join(", ") || "Chưa gán cửa hàng"}</small></span><ChevronRight size={17} /></button>; })}</div>}</section><section className="panel"><PanelHead title="Yêu cầu hỗ trợ" text={`${tickets.filter((item) => item.status !== "closed").length} yêu cầu đang mở`} />{loading ? <Skeleton /> : tickets.length ? <div className="ticket-list">{tickets.map((ticket) => <article key={ticket.id}><div><span className={`priority priority-${ticket.priority}`}>{ticket.priority}</span><strong>{ticket.subject}</strong><p>{ticket.userName || ticket.customerName || ticket.userId || "Người dùng"} · {ticket.userId || ticket.shopName || "Toàn hệ thống"}</p></div><select value={ticket.status} onChange={(e) => updateTicket(ticket, e.target.value)}><option value="open">Mới</option><option value="in_progress">Đang xử lý</option><option value="waiting">Chờ phản hồi</option><option value="closed">Hoàn tất</option></select></article>)}</div> : <Empty icon={Headphones} title="Chưa có yêu cầu" text="Tạo yêu cầu chăm sóc người dùng đầu tiên." />}</section></div>{ticketAccount !== undefined && <TicketModal account={ticketAccount} stores={stores} user={user} close={() => setTicketAccount(undefined)} saved={() => { setTicketAccount(undefined); reload(); }} />}</>;
}

function CampaignsPage({ campaigns, stores, user, loading, reload }) {
  const emptyForm = {
    title: "", body: "", imageUrl: "", targetType: "all", shopId: "",
    revenueAverage: "under_500m", deliveryMode: "now", scheduledAt: ""
  };
  const [form, setForm] = useState(emptyForm);
  const [showCreate, setShowCreate] = useState(false);
  const [sending, setSending] = useState(false);
  const [modalMessage, setModalMessage] = useState("");
  const [pageMessage, setPageMessage] = useState("");
  const [emojiTarget, setEmojiTarget] = useState("title");
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const field = (key) => (event) => setForm({ ...form, [key]: event.target.value });
  const addEmoji = (emoji) => setForm((current) => ({
    ...current,
    [emojiTarget]: `${current[emojiTarget]}${current[emojiTarget] ? " " : ""}${emoji}`
  }));
  const closeModal = () => {
    if (sending) return;
    setShowCreate(false);
    setModalMessage("");
  };
  const submit = async (event) => {
    event.preventDefault();
    setSending(true);
    setModalMessage("");
    try {
      const payload = await request("/campaigns", user, {
        method: "POST",
        body: JSON.stringify({
          title: form.title,
          body: form.body,
          imageUrl: form.imageUrl,
          target: {
            type: form.targetType,
            ...(form.targetType === "shop" ? { shopId: form.shopId } : {}),
            ...(form.targetType === "revenueAverage" ? { revenueAverage: form.revenueAverage } : {})
          },
          ...(form.deliveryMode === "scheduled" ? { scheduledAt: new Date(form.scheduledAt).toISOString() } : {})
        })
      });
      setPageMessage(form.deliveryMode === "scheduled"
        ? `Đã lên lịch gửi lúc ${scheduledDateTime.format(new Date(payload.campaign.scheduledAt))}.`
        : `Đã gửi thành công tới ${payload.campaign.successCount} thiết bị.`);
      setForm(emptyForm);
      setShowCreate(false);
      reload();
    } catch (error) {
      setModalMessage(error.message);
    } finally {
      setSending(false);
    }
  };
  const cancelCampaign = async (campaignId) => {
    setPageMessage("");
    try {
      await request(`/campaigns/${campaignId}`, user, { method: "DELETE" });
      setPageMessage("Đã hủy campaign đang chờ gửi.");
      reload();
    } catch (error) {
      setPageMessage(error.message);
    }
  };
  const targetLabel = (campaign) => {
    if (campaign.target?.type === "shop") {
      return stores.find((store) => store.id === campaign.target.shopId)?.name || campaign.target.shopId;
    }
    if (campaign.target?.type === "revenueAverage") {
      return revenueAverageOptions.find(([value]) => value === campaign.target.revenueAverage)?.[1] || "Nhóm doanh thu";
    }
    return "Tất cả người dùng";
  };

  return <><Heading eyebrow="Push notification" title="Campaign thông báo" text="Quản lý danh sách, lịch gửi và đối tượng nhận notification." extra={<button className="button primary" onClick={() => { setForm(emptyForm); setModalMessage(""); setShowCreate(true); }}><Plus size={17} />Tạo campaign</button>} />
    {pageMessage && <div className={pageMessage.startsWith("Đã") ? "success-banner" : "error-banner"}>{pageMessage}</div>}
    <section className="panel campaign-table-panel"><PanelHead title="Danh sách campaign" text={`${campaigns.length} campaign gần nhất · Nhấn vào một dòng để xem chi tiết`} />{loading ? <Skeleton /> : campaigns.length ? <div className="table-wrap"><table className="campaign-table"><thead><tr><th>Campaign</th><th>Đối tượng nhận</th><th>Thời gian</th><th>Trạng thái</th><th>Thiết bị</th><th /></tr></thead><tbody>{campaigns.map((campaign) => <tr key={campaign.id} className="campaign-row" onClick={() => setSelectedCampaign(campaign)}><td><div className="campaign-cell">{campaign.imageUrl ? <img src={campaign.imageUrl} alt="" /> : <span className="campaign-placeholder"><Megaphone size={17} /></span>}<span><strong>{campaign.title}</strong><small>{campaign.body}</small></span></div></td><td>{targetLabel(campaign)}</td><td><strong>{campaign.scheduledAt ? scheduledDateTime.format(new Date(campaign.scheduledAt)) : campaign.sentAt ? scheduledDateTime.format(new Date(campaign.sentAt)) : "Gửi ngay"}</strong><small className="sub">Tạo bởi {campaign.createdBy || "admin"}</small></td><td><Status value={campaign.status} /></td><td>{number.format(campaign.successCount || 0)} / {number.format(campaign.recipientCount || 0)}</td><td>{campaign.status === "scheduled" && <button type="button" className="button cancel-campaign" onClick={(event) => { event.stopPropagation(); cancelCampaign(campaign.id); }}>Hủy lịch</button>}</td></tr>)}</tbody></table></div> : <Empty icon={Megaphone} title="Chưa có campaign" text="Nhấn Tạo campaign để thêm thông báo đầu tiên." />}</section>
    {showCreate && <div className="backdrop modal-wrap" onMouseDown={(event) => event.target === event.currentTarget && closeModal()}><form className="modal campaign-modal" onSubmit={submit}><header><div><span className="icon-tile"><Megaphone size={20} /></span><h2>Tạo campaign</h2><p>Soạn nội dung và cấu hình lịch gửi notification.</p></div><button type="button" className="icon-button" onClick={closeModal}><X size={20} /></button></header>
      <section className="campaign-modal-section"><div className="campaign-section-head"><strong>Nội dung thông báo</strong><span>Icon sẽ được chèn vào trường đang chọn</span></div><label>Tiêu đề<input value={form.title} onChange={field("title")} onFocus={() => setEmojiTarget("title")} maxLength="120" placeholder="Ví dụ: 🎉 Ưu đãi mới từ POSO" required /></label><label>Nội dung<textarea value={form.body} onChange={field("body")} onFocus={() => setEmojiTarget("body")} rows="4" maxLength="500" placeholder="Nhập nội dung notification..." required /></label><div className="emoji-picker">{campaignEmojis.map((emoji) => <button type="button" key={emoji} onClick={() => addEmoji(emoji)} title={`Thêm vào ${emojiTarget === "title" ? "tiêu đề" : "nội dung"}`}>{emoji}</button>)}</div><label>Notification image <span className="label-hint">URL HTTPS, không bắt buộc</span><div className="image-url-input"><ImageIcon size={17} /><input type="url" value={form.imageUrl} onChange={field("imageUrl")} placeholder="https://.../campaign.jpg" /></div></label>{form.imageUrl && <div className="campaign-image-preview"><img src={form.imageUrl} alt="Xem trước notification" /><span>Ảnh xem trước</span></div>}</section>
      <section className="campaign-modal-section"><div className="campaign-section-head"><strong>Đối tượng nhận</strong><span>Chọn chính xác nhóm người dùng cần gửi</span></div><fieldset className="radio-field"><label><input type="radio" name="targetType" value="all" checked={form.targetType === "all"} onChange={field("targetType")} /><span>Tất cả người dùng</span></label><label><input type="radio" name="targetType" value="shop" checked={form.targetType === "shop"} onChange={field("targetType")} /><span>Owner của một cửa hàng</span></label><label><input type="radio" name="targetType" value="revenueAverage" checked={form.targetType === "revenueAverage"} onChange={field("targetType")} /><span>Owner theo nhóm doanh thu</span></label></fieldset>{form.targetType === "shop" && <label>Cửa hàng<select value={form.shopId} onChange={field("shopId")} required><option value="">Chọn cửa hàng</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>}{form.targetType === "revenueAverage" && <label>Nhóm doanh thu<select value={form.revenueAverage} onChange={field("revenueAverage")}>{revenueAverageOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}</section>
      <section className="campaign-modal-section"><div className="campaign-section-head"><strong>Thời gian gửi</strong><span>Gửi ngay hoặc tự động theo lịch</span></div><fieldset className="radio-field"><label><input type="radio" name="deliveryMode" value="now" checked={form.deliveryMode === "now"} onChange={field("deliveryMode")} /><span>Gửi ngay</span></label><label><input type="radio" name="deliveryMode" value="scheduled" checked={form.deliveryMode === "scheduled"} onChange={field("deliveryMode")} /><span>Lên lịch theo ngày và giờ</span></label></fieldset>{form.deliveryMode === "scheduled" && <label>Ngày giờ gửi<input type="datetime-local" value={form.scheduledAt} min={localDateTimeInput(Date.now() + 60_000)} onChange={field("scheduledAt")} required /></label>}</section>
      {modalMessage && <div className="error-banner">{modalMessage}</div>}<div className="actions campaign-modal-actions"><button type="button" className="button secondary" onClick={closeModal} disabled={sending}>Hủy</button><button className="button primary" disabled={sending}><Send size={17} />{sending ? "Đang xử lý..." : form.deliveryMode === "scheduled" ? "Lên lịch campaign" : "Gửi campaign"}</button></div></form></div>}
    {selectedCampaign && <div className="backdrop modal-wrap" onMouseDown={(event) => event.target === event.currentTarget && setSelectedCampaign(null)}><section className="modal campaign-detail-modal"><header><div><span className="icon-tile"><Megaphone size={20} /></span><h2>Chi tiết campaign</h2><p>Mã campaign: {selectedCampaign.id}</p></div><button type="button" className="icon-button" onClick={() => setSelectedCampaign(null)}><X size={20} /></button></header>{selectedCampaign.imageUrl && <img className="campaign-detail-image" src={selectedCampaign.imageUrl} alt="Notification campaign" />}<div className="campaign-detail-content"><div className="campaign-detail-title"><div><h3>{selectedCampaign.title}</h3><p>{selectedCampaign.body}</p></div><Status value={selectedCampaign.status} /></div><dl className="campaign-detail-grid"><div><dt>Đối tượng nhận</dt><dd>{targetLabel(selectedCampaign)}</dd></div><div><dt>Thiết bị phù hợp</dt><dd>{number.format(selectedCampaign.recipientCount || 0)}</dd></div><div><dt>Thành công / Thất bại</dt><dd>{number.format(selectedCampaign.successCount || 0)} / {number.format(selectedCampaign.failureCount || 0)}</dd></div><div><dt>Thời gian tạo</dt><dd>{selectedCampaign.createdAt ? scheduledDateTime.format(new Date(selectedCampaign.createdAt)) : "—"}</dd></div><div><dt>Lịch gửi</dt><dd>{selectedCampaign.scheduledAt ? scheduledDateTime.format(new Date(selectedCampaign.scheduledAt)) : "Gửi ngay"}</dd></div><div><dt>Bắt đầu xử lý</dt><dd>{selectedCampaign.startedAt ? scheduledDateTime.format(new Date(selectedCampaign.startedAt)) : "—"}</dd></div><div><dt>Hoàn tất</dt><dd>{selectedCampaign.sentAt ? scheduledDateTime.format(new Date(selectedCampaign.sentAt)) : selectedCampaign.failedAt ? scheduledDateTime.format(new Date(selectedCampaign.failedAt)) : "—"}</dd></div></dl>{selectedCampaign.matchedShopIds?.length > 0 && <div className="campaign-detail-block"><strong>Cửa hàng phù hợp</strong><div className="campaign-shop-tags">{selectedCampaign.matchedShopIds.map((shopId) => <span key={shopId}>{stores.find((store) => store.id === shopId)?.name || shopId}</span>)}</div></div>}<div className="campaign-detail-block"><strong>Chi tiết lỗi</strong>{selectedCampaign.errors?.length ? <div className="campaign-error-list">{selectedCampaign.errors.map((error, index) => <article key={`${error.code}-${index}`}><code>{error.code || "campaign/send-error"}</code><p>{campaignErrorHints[error.code] || "Không thể gửi thông báo đến thiết bị. Vui lòng kiểm tra cấu hình hoặc thử lại sau."}</p></article>)}</div> : <div className="campaign-no-error"><ShieldCheck size={18} />Campaign không ghi nhận lỗi gửi notification.</div>}</div></div></section></div>}
  </>;
}

function Admin({ user, onLogout }) {
  const [page,setPage]=useState("overview"), [data,setData]=useState(null), [orders,setOrders]=useState([]), [users,setUsers]=useState([]), [subscriptions,setSubscriptions]=useState([]), [tickets,setTickets]=useState([]), [campaigns,setCampaigns]=useState([]), [loading,setLoading]=useState(true), [error,setError]=useState(""), [drawer,setDrawer]=useState(""), [create,setCreate]=useState(false), [menu,setMenu]=useState(false);
  const load = async () => { setLoading(true); setError(""); try { const [overview,orderData,userData,subscriptionData,ticketData,campaignData]=await Promise.all([request("/overview?days=30",user),request("/orders?limit=150",user),request("/users",user),request("/subscriptions",user),request("/support-tickets",user),request("/campaigns",user)]); setData(overview);setOrders(orderData.orders);setUsers(userData.users);setSubscriptions(subscriptionData.subscriptions);setTickets(ticketData.tickets);setCampaigns(campaignData.campaigns); } catch(e) { setError(e.message);  } finally { setLoading(false); } };
  useEffect(()=>{ load(); },[user]); const stores=data?.stores||[]; const titles={overview:"Tổng quan",stores:"Cửa hàng",users:"Người dùng",subscriptions:"Subscription",campaigns:"Campaign thông báo",maintenance:"Bảo trì hệ thống",care:"Chăm sóc người dùng",orders:"Đơn hàng"};
  return <div className="shell"><Sidebar page={page} setPage={setPage} user={user} onLogout={onLogout} open={menu} setOpen={setMenu}/><main className="main"><header className="topbar"><button className="icon-button menu" onClick={()=>setMenu(true)}><Menu size={20}/></button><strong>{titles[page]}</strong><button className="icon-button" onClick={load}><RefreshCw className={loading?"spin":""} size={18}/></button></header><div className="content">{error&&<div className="error-banner">{error}</div>}{page==="overview"&&<Overview data={data} subscriptions={subscriptions} onStore={setDrawer} setPage={setPage}/>} {page==="stores"&&<Stores stores={stores} loading={loading} onStore={setDrawer} onCreate={()=>setCreate(true)}/>} {page==="users"&&<UsersPage users={users} stores={stores} user={user} loading={loading} reload={load}/>} {page==="subscriptions"&&<SubscriptionsPage subscriptions={subscriptions} user={user} loading={loading} reload={load}/>} {page==="maintenance"&&<MaintenancePage user={user}/>} {page==="campaigns"&&<CampaignsPage campaigns={campaigns} stores={stores} user={user} loading={loading} reload={load}/>} {page==="care"&&<CustomerCarePage users={users} tickets={tickets} stores={stores} user={user} loading={loading} reload={load}/>} {page==="orders"&&<Orders orders={orders} stores={stores} loading={loading}/>}</div></main>{drawer&&<StoreDrawer id={drawer} user={user} close={()=>setDrawer("")} reload={load}/>} {create&&<CreateModal user={user} close={()=>setCreate(false)} created={()=>{setCreate(false);load();}}/>}</div>;
}

export default function App({ initialUser }) {
  const [user, setUser] = useState(initialUser);
  const [logoutError, setLogoutError] = useState("");
  useEffect(() => {
    const expire = () => setUser(null);
    window.addEventListener("poso:session-expired", expire);
    return () => window.removeEventListener("poso:session-expired", expire);
  }, []);
  const handleLogout = async () => {
    try { await logout(); setUser(null); setLogoutError(""); }
    catch (error) { setLogoutError(error.message); }
  };
  return user ? <>{logoutError && <div className="logout-error error-banner" role="alert">{logoutError}</div>}<Admin user={user} onLogout={handleLogout} /></> : <Login onLogin={setUser} />;
}
