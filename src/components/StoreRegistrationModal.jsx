import { useState } from "react";
import { Building2, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail, MapPin, Smartphone, Store, UserRound, X } from "lucide-react";
import { BUSINESS_CATEGORIES, PROVINCES } from "../../shared/RegistrationOptions.js";
import { request } from "../api.js";
import FormField from "./FormField.jsx";

const emptyForm = () => ({ ownerName: "", name: "", phoneNumber: "", password: "", provinceID: "", businessCategoryID: "", email: "", taxCode: "", address: "", registrationId: crypto.randomUUID() });
const InputField = ({ icon: Icon, label, ...props }) => <FormField label={label}><span className="registration-input"><Icon size={18} aria-hidden="true" /><input {...props} /></span></FormField>;

export default function StoreRegistrationModal({ user, close, created }) {
  const [form, setForm] = useState(emptyForm), [error, setError] = useState(""), [busy, setBusy] = useState(false), [showPassword, setShowPassword] = useState(false), [result, setResult] = useState(null);
  const field = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault(); if (busy || result) return;
    setError(""); setBusy(true);
    try {
      const response = await request("/stores", user, { method: "POST", body: JSON.stringify(form) });
      setResult(response); created();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const resend = async () => {
    if (busy) return; setError(""); setBusy(true);
    try {
      const response = await request(`/stores/${result.store.id}/account-email`, user, { method: "POST", body: JSON.stringify({ registrationId: form.registrationId, password: form.password }) });
      setResult((current) => ({ ...current, emailDelivery: response.emailDelivery }));
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const emailStatus = result?.emailDelivery?.status;
  const canResend = form.email && !["sent", "skipped", "sending"].includes(emailStatus);
  return <div className="backdrop modal-wrap" onMouseDown={(event) => event.target === event.currentTarget && !busy && close()}>
    <form className="modal registration-modal" onSubmit={submit} aria-labelledby="store-registration-title">
      <header><div><span className="icon-tile">{result ? <CheckCircle2 size={21} /> : <Store size={21} />}</span><h2 id="store-registration-title">{result ? "Tạo tài khoản thành công" : "Thêm cửa hàng"}</h2><p>{result ? form.name : "Đăng ký cửa hàng và cấp tài khoản cho chủ cửa hàng."}</p></div><button type="button" className="icon-button" disabled={busy} onClick={close} aria-label="Đóng"><X size={20} /></button></header>
      {result ? <>
        <div className="registration-success" role="status"><CheckCircle2 size={21} /><span>Cửa hàng và tài khoản chủ cửa hàng đã sẵn sàng.</span></div>
        <FormField label="Tên đăng nhập"><input value={result.account.username} readOnly /></FormField>
        <FormField label="Mật khẩu tạm thời"><span className="registration-input"><input type={showPassword ? "text" : "password"} value={form.password} readOnly /><button type="button" className="icon-button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></FormField>
        <p className={emailStatus === "sent" ? "success-banner" : emailStatus === "skipped" ? "subscription-help" : "error-banner"}>{emailStatus === "sent" ? `Đã gửi email cấp tài khoản tới ${form.email}.` : emailStatus === "skipped" ? "Không gửi email vì chưa cung cấp địa chỉ email." : emailStatus === "sending" ? "Email đang được xử lý. Tài khoản đã tạo thành công." : "Tài khoản đã tạo thành công nhưng chưa gửi được email. Vui lòng kiểm tra cấu hình gửi thư và thử lại."}</p>
        <p className="subscription-help">Quý khách đăng nhập bằng số điện thoại và đổi mật khẩu sau lần đăng nhập đầu tiên. Thông tin mật khẩu chỉ hiển thị trong lần tạo này.</p>
      </> : <>
        <div className="registration-fields">
          <InputField icon={UserRound} label="Họ và tên chủ cửa hàng" name="ownerName" value={form.ownerName} onChange={field("ownerName")} placeholder="Họ và tên chủ cửa hàng" autoComplete="name" maxLength={120} required />
          <InputField icon={Store} label="Tên cửa hàng" name="name" value={form.name} onChange={field("name")} placeholder="Tên cửa hàng" autoComplete="organization" maxLength={120} required />
          <InputField icon={Smartphone} label="Số điện thoại" name="phoneNumber" type="tel" inputMode="tel" value={form.phoneNumber} onChange={field("phoneNumber")} placeholder="Số điện thoại" autoComplete="tel" maxLength={24} required />
          <FormField label="Mật khẩu tạm thời"><span className="registration-input"><LockKeyhole size={18} aria-hidden="true" /><input name="password" type={showPassword ? "text" : "password"} value={form.password} onChange={field("password")} placeholder="Tối thiểu 8 ký tự" autoComplete="new-password" minLength={8} maxLength={72} required /><button type="button" className="icon-button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></FormField>
          <FormField label="Tỉnh/Thành phố"><span className="registration-input"><MapPin size={18} aria-hidden="true" /><select name="provinceID" value={form.provinceID} onChange={field("provinceID")} required><option value="" disabled>Chọn tỉnh/thành phố</option>{PROVINCES.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></span></FormField>
          <FormField label="Ngành kinh doanh"><span className="registration-input"><Building2 size={18} aria-hidden="true" /><select name="businessCategoryID" value={form.businessCategoryID} onChange={field("businessCategoryID")} required><option value="" disabled>Chọn ngành kinh doanh</option>{BUSINESS_CATEGORIES.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></span></FormField>
          <InputField icon={Mail} label="Email (tùy chọn)" name="email" type="email" value={form.email} onChange={field("email")} placeholder="Email nhận thông tin cấp tài khoản" autoComplete="email" maxLength={254} />
          <FormField label="Mã số thuế" name="taxCode" inputMode="numeric" value={form.taxCode} onChange={field("taxCode")} placeholder="Mã số thuế hoặc mã định danh cá nhân" maxLength={14} required />
        </div>
        <FormField label="Địa chỉ chi tiết (tùy chọn)" name="address" value={form.address} onChange={field("address")} placeholder="Số nhà, đường, phường/xã" autoComplete="street-address" maxLength={300} />
        <p className="subscription-help">Số điện thoại là tên đăng nhập. Nếu có email, Poso tự gửi thông tin tài khoản sau khi tạo thành công. Cửa hàng mới dùng thử Pro 14 ngày, sau đó tự về Free nếu chưa gia hạn.</p>
      </>}
      {error && <div className="error-banner" role="alert">{error}</div>}
      <div className="actions">{!result && <button type="button" className="button secondary" disabled={busy} onClick={close}>Hủy</button>}{result ? <>{canResend && <button type="button" className="button secondary" disabled={busy} onClick={resend}>{busy ? "Đang gửi..." : "Gửi lại email"}</button>}<button type="button" className="button primary" disabled={busy} onClick={close}>Hoàn tất</button></> : <button className="button primary" disabled={busy}>{busy ? "Đang tạo tài khoản..." : "Tạo cửa hàng và tài khoản"}</button>}</div>
    </form>
  </div>;
}
