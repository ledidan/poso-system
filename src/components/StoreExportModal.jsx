import { useState } from "react";
import { Download, FileSpreadsheet, LoaderCircle, X } from "lucide-react";
import { exportStoresExcel } from "../api.js";

export default function StoreExportModal({ search, status, filteredCount, totalCount, close, exported }) {
  const [scope, setScope] = useState("filtered");
  const [days, setDays] = useState("30");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const count = scope === "filtered" ? filteredCount : totalCount;
  const dismiss = () => { if (!exporting) close(); };
  const submit = async (event) => {
    event.preventDefault();
    if (exporting || !count) return;
    setExporting(true); setError("");
    try {
      const result = await exportStoresExcel({ days, ...(scope === "filtered" ? { search, status } : {}) });
      exported(result);
    } catch (error) {
      setError(error.message);
    } finally { setExporting(false); }
  };
  return <div className="backdrop modal-wrap" onMouseDown={(event) => event.target === event.currentTarget && dismiss()}>
    <form className="modal store-export-modal" role="dialog" aria-modal="true" aria-labelledby="store-export-title" onSubmit={submit} onKeyDown={(event) => event.key === "Escape" && dismiss()} aria-busy={exporting}>
      <header><div><span className="icon-tile"><FileSpreadsheet size={22} /></span><h2 id="store-export-title">Xuất Excel cửa hàng</h2><p>Tải báo cáo chi tiết theo dữ liệu mới nhất.</p></div><button type="button" className="icon-button" aria-label="Đóng xuất Excel" onClick={dismiss} disabled={exporting}><X size={20} /></button></header>
      <fieldset className="radio-field" disabled={exporting}>
        <legend>Phạm vi xuất</legend>
        <label><input type="radio" name="exportScope" value="filtered" checked={scope === "filtered"} onChange={(event) => setScope(event.target.value)} />Kết quả đang lọc ({number(filteredCount)} cửa hàng)</label>
        <label><input type="radio" name="exportScope" value="all" checked={scope === "all"} onChange={(event) => setScope(event.target.value)} />Tất cả cửa hàng ({number(totalCount)} cửa hàng)</label>
      </fieldset>
      <label>Kỳ thống kê doanh thu, đơn hàng<select value={days} onChange={(event) => setDays(event.target.value)} disabled={exporting}>
        <option value="7">7 ngày gần nhất</option><option value="30">30 ngày gần nhất</option><option value="90">90 ngày gần nhất</option><option value="365">365 ngày gần nhất</option>
      </select></label>
      <div className="store-export-contents">
        <strong>Nội dung file .xlsx</strong>
        <ul>
          <li><b>Tổng quan:</b> số cửa hàng, doanh thu và đơn hàng trong kỳ.</li>
          <li><b>Cửa hàng:</b> thông tin liên hệ, chủ cửa hàng, khách hàng, sản phẩm, tồn kho và thông báo.</li>
          <li><b>Subscription:</b> cửa hàng trung tâm, gói đăng ký, gói đang áp dụng, thời hạn và hạn mức dùng chung.</li>
          <li><b>Nhân sự:</b> tài khoản, họ tên, vai trò và trạng thái truy cập theo từng cửa hàng.</li>
        </ul>
      </div>
      <p className="field-hint">Doanh thu tính từ đơn hoàn tất trong kỳ. Số lượng khách hàng, sản phẩm và nhân sự lấy tại thời điểm xuất. Ngày giờ theo GMT+7.</p>
      {!count && <div className="error-banner" role="alert">Không có cửa hàng trong phạm vi đã chọn.</div>}
      {error && <div className="error-banner" role="alert">{error}</div>}
      <div className="actions"><button type="button" className="button secondary" onClick={dismiss} disabled={exporting}>Hủy</button><button className="button primary" disabled={exporting || !count}>{exporting ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}{exporting ? "Đang tạo file..." : "Tải file Excel"}</button></div>
    </form>
  </div>;
}

const number = (value) => Number(value).toLocaleString("vi-VN");
