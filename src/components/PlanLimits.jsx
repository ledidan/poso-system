const label = (value) => value === null ? "Không giới hạn" : Number(value || 0).toLocaleString("vi-VN");
export default function PlanLimits({ limits = {}, usage = {} }) {
  const fields = [["orders", "monthlyOrders", "Đơn hàng / tháng"], ["products", "products", "Sản phẩm"], ["users", "users", "Tài khoản hoạt động"], ["shops", "shops", "Gian hàng"], ["payroll", "payroll", "Nhân viên chấm công, tính lương"]];
  return <dl className="plan-limits">{fields.map(([resource, limit, title]) => <div key={resource}><dt>{title}</dt><dd>{usage[resource] ? `${label(usage[resource].used)} / ` : ""}{label(limits[limit])}</dd></div>)}</dl>;
}
