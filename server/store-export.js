import ExcelJS from "exceljs";
import { activeshops, asNumber, orderTime, summarizeStore } from "./store-summary.js";
import { readSubscription } from "./Subscription.js";
import { timestamp } from "./subscriptions/PlanCatalog.js";
import { REVENUE_AVERAGE_OPTIONS } from "./notification-campaign.js";
import { filterStores, STORE_STATUS_OPTIONS } from "../shared/store-filters.js";

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DAY = 86_400_000;
const GMT7 = 7 * 3_600_000;
const INTEGER = "#,##0";
const MONEY = '#,##0 "₫"';
const DATE = "dd/mm/yyyy hh:mm";
const labels = Object.fromEntries([
  ...STORE_STATUS_OPTIONS, ["downgraded", "Đã về Free"], ["owner", "Chủ cửa hàng"],
  ["invalid", "Chưa có thời hạn hợp lệ"], ["notStarted", "Chưa bắt đầu"]
]);
const text = (value) => typeof value === "string" || typeof value === "number" ? String(value) : "";
const label = (value) => labels[value] || text(value);
const enabled = (value) => value ? "Bật" : "Tắt";
const limit = (value) => value === null ? "Không giới hạn" : value;
// Excel dates have no timezone. Store Vietnam wall-clock time and label the timezone in the workbook.
const localDate = (value) => Number.isFinite(timestamp(value)) ? new Date(timestamp(value) + GMT7) : null;
const badInput = (message) => Object.assign(new Error(message), { status: 400 });

export const parseStoreExportOptions = (query = {}) => {
  for (const key of ["search", "status", "days"]) {
    if (query[key] !== undefined && typeof query[key] !== "string") throw badInput("Bộ lọc xuất Excel không hợp lệ.");
  }
  const search = (query.search || "").trim();
  const status = query.status || "all";
  const days = query.days === undefined ? 30 : Number(query.days);
  if (search.length > 200) throw badInput("Từ khóa tìm kiếm tối đa 200 ký tự.");
  if (status !== "all" && !STORE_STATUS_OPTIONS.some(([value]) => value === status)) throw badInput("Trạng thái cửa hàng không hợp lệ.");
  if (!Number.isInteger(days) || days < 1 || days > 365) throw badInput("Kỳ thống kê phải từ 1 đến 365 ngày.");
  return { search, status, days };
};

const storeColumns = [
  ["id", "Mã cửa hàng", 23], ["name", "Tên cửa hàng", 32], ["address", "Địa chỉ", 48],
  ["phone", "Số điện thoại", 20], ["category", "Ngành hàng", 25], ["status", "Trạng thái cửa hàng", 23],
  ["createdAt", "Ngày tạo (GMT+7)", 23, DATE], ["ownerAccounts", "Tài khoản chủ cửa hàng", 26], ["ownerNames", "Tên chủ cửa hàng", 30],
  ["revenue", "Doanh thu đơn hoàn tất (VND)", 29, MONEY], ["completed", "Đơn hoàn tất trong kỳ", 22, INTEGER],
  ["active", "Đơn đang xử lý hiện tại", 23, INTEGER], ["canceled", "Đơn hủy trong kỳ", 20, INTEGER],
  ["returned", "Đơn hoàn trả trong kỳ", 22, INTEGER], ["returnedAmount", "Giá trị đơn hoàn trả (VND)", 27, MONEY],
  ["customers", "Khách hàng hiện tại", 21, INTEGER], ["products", "Sản phẩm hiện tại", 20, INTEGER],
  ["personnel", "Tài khoản được gán", 21, INTEGER], ["lowStock", "Mục tồn kho thấp", 20, INTEGER],
  ["revenueAverage", "Nhóm doanh thu năm", 30], ["notifications", "Thông báo", 16], ["campaigns", "Campaign", 16],
  ["dailyRevenue", "Báo cáo cuối ngày", 21], ["dailyRevenueTime", "Giờ báo cáo (GMT+7)", 23]
];
const subscriptionColumns = [
  ["id", "Mã cửa hàng", 23], ["name", "Tên cửa hàng", 32], ["rootId", "Mã cửa hàng trung tâm", 25],
  ["rootName", "Tên cửa hàng trung tâm", 32], ["branches", "Gian hàng dùng chung", 23, INTEGER],
  ["configuredPlan", "Gói đăng ký", 21], ["effectivePlan", "Gói đang áp dụng", 22], ["status", "Trạng thái subscription", 27],
  ["startAt", "Bắt đầu (GMT+7)", 23, DATE], ["expiresAt", "Hết hạn (GMT+7)", 23, DATE],
  ["remainingDays", "Số ngày còn lại", 21, INTEGER], ["duration", "Thời hạn gói đang áp dụng", 29],
  ["orders", "Hạn mức đơn / tháng", 24, INTEGER], ["products", "Hạn mức sản phẩm", 23, INTEGER],
  ["users", "Hạn mức tài khoản", 23, INTEGER], ["shops", "Hạn mức gian hàng", 23, INTEGER],
  ["payroll", "Hạn mức nhân sự tính lương", 29, INTEGER], ["onlineSales", "Bán hàng online", 20],
  ["eInvoice", "Hóa đơn điện tử", 21], ["staff", "Quản lý nhân viên", 22], ["payrollFeature", "Chấm công, tính lương", 26]
];
const personnelColumns = [
  ["shopId", "Mã cửa hàng", 23], ["shopName", "Tên cửa hàng", 32], ["username", "Tài khoản", 23],
  ["personnelId", "Mã nhân sự", 23], ["name", "Họ tên", 32], ["role", "Vai trò", 23],
  ["status", "Trạng thái truy cập", 24], ["payroll", "Tham gia tính lương", 24]
];

const tableSheet = (workbook, name, columns, rows) => {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: "frozen", xSplit: 2, ySplit: 1, showGridLines: false }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });
  sheet.columns = columns.map(([key, header, width, numFmt]) => ({ key, header, width, style: { numFmt: numFmt || "@" } }));
  rows.forEach((row) => sheet.addRow(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === "" ? null : value]))));
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: columns.length } };
  sheet.getRow(1).height = 44;
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF343D35" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { right: { style: "thin", color: { argb: "FFFFFFFF" } } };
  });
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    let lineCount = 1;
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      cell.font = { name: "Arial", size: 10, color: { argb: "FF202320" } };
      cell.alignment = { vertical: "middle", horizontal: typeof cell.value === "number" ? "right" : "left", wrapText: true };
      if (index % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F7F3" } };
      // Identifiers, phone numbers, and user-supplied strings stay literal, including leading '='.
      if (!columns[column - 1][3]) cell.numFmt = "@";
      if (typeof cell.value === "string") {
        const lines = cell.value.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / columns[column - 1][2])), 0);
        lineCount = Math.max(lineCount, lines);
      }
    });
    row.height = Math.min(409, Math.max(36, lineCount * 15 + 12));
  });
  sheet.pageSetup.printTitlesRow = "1:1";
  return sheet;
};

export const createStoreExport = async ({ shops = {}, options = parseStoreExportOptions(), now = Date.now(), resolveGroup }) => {
  const available = activeshops(shops);
  const selected = filterStores(Object.entries(available).map(([id, shop]) => summarizeStore(id, shop, options.days, now)), options)
    .sort((a, b) => a.name.localeCompare(b.name, "vi") || a.id.localeCompare(b.id));
  if (!selected.length) throw Object.assign(new Error("Không có cửa hàng phù hợp để xuất Excel."), { status: 404 });
  const from = now - options.days * DAY;
  const inPeriod = (orders) => Object.values(orders || {}).filter((order) => {
    const time = timestamp(orderTime(order));
    return Number.isFinite(time) && time >= from && time <= now;
  });
  const stores = [], subscriptions = [], personnel = [];
  const roots = new Set();
  for (const store of selected) {
    const shop = available[store.id];
    const people = Object.entries(shop.personnelPins || {}).filter(([, person]) => person && typeof person === "object");
    const owners = people.filter(([, person]) => person.role === "owner" && person.isActive !== false);
    const completed = inPeriod(shop.pastOrders), returned = inPeriod(shop.returnedOrders);
    stores.push({
      id: store.id, name: text(store.name), address: text(store.address), phone: text(store.phoneNumber),
      category: text(store.businessCategory), status: label(store.status), createdAt: localDate(store.createdAt),
      ownerAccounts: owners.map(([id]) => id).join("\n"), ownerNames: owners.map(([, person]) => text(person.personnelName || person.name)).join("\n"),
      revenue: completed.reduce((sum, order) => sum + asNumber(order.total), 0), completed: completed.length,
      active: store.activeOrderCount, canceled: inPeriod(shop.canceledOrders).length, returned: returned.length,
      returnedAmount: returned.reduce((sum, order) => sum + asNumber(order.total), 0), customers: store.customerCount,
      products: store.itemCount, personnel: people.length, lowStock: store.lowStockCount,
      revenueAverage: REVENUE_AVERAGE_OPTIONS.find((option) => option.value === store.revenueAverage)?.label || text(store.revenueAverage),
      notifications: enabled(store.notificationSettings.enabled), campaigns: enabled(store.notificationSettings.campaignEnabled),
      dailyRevenue: enabled(store.notificationSettings.dailyRevenueEnabled), dailyRevenueTime: text(store.notificationSettings.dailyRevenueTime)
    });
    const group = !shop.subscriptionRootID && resolveGroup ? await resolveGroup(store.id) : null;
    const rootId = shop.subscriptionRootID || group?.rootShopID || store.id;
    const root = available[rootId];
    if (root) roots.add(rootId);
    const subscription = root ? readSubscription(root, now) : null;
    const branches = new Set([rootId, ...Object.keys(root?.subscriptionBranches || {}).filter((id) => root.subscriptionBranches[id]),
      ...(group?.branchIDs || []), ...Object.keys(available).filter((id) => available[id].subscriptionRootID === rootId)]);
    const activeBranches = [...branches].filter((id) => available[id]);
    subscriptions.push({
      id: store.id, name: text(store.name), rootId, rootName: text(root?.basicInfo?.name || root?.basicInfo?.shopName || rootId),
      branches: activeBranches.length, configuredPlan: subscription?.packageName || "", effectivePlan: subscription?.effectivePlanName || "",
      status: subscription ? label(subscription.licenseStatus) : "Không tìm thấy cửa hàng trung tâm",
      startAt: localDate(subscription?.startAt), expiresAt: localDate(subscription?.expiresAt), remainingDays: subscription?.remainingDays ?? null,
      duration: subscription?.isUnlimited ? "Không giới hạn thời gian" : subscription ? "Có thời hạn" : "",
      orders: subscription ? limit(subscription.limits.monthlyOrders) : null, products: subscription ? limit(subscription.limits.products) : null,
      users: subscription ? limit(subscription.limits.users) : null, shops: subscription ? limit(subscription.limits.shops) : null,
      payroll: subscription ? limit(subscription.limits.payroll) : null,
      onlineSales: subscription ? enabled(subscription.features.onlineSales) : "", eInvoice: subscription ? enabled(subscription.features.eInvoice) : "",
      staff: subscription ? enabled(subscription.features.staff) : "", payrollFeature: subscription ? enabled(subscription.features.payroll) : ""
    });
    people.sort(([a], [b]) => a.localeCompare(b)).forEach(([username, person]) => personnel.push({
      shopId: store.id, shopName: text(store.name), username, personnelId: text(person.personnelID),
      name: text(person.personnelName || person.name || username), role: label(person.role || person.roleName || "Nhân viên"),
      status: person.isActive !== false ? "Cho phép truy cập" : "Đã khóa truy cập",
      payroll: person.role === "owner" ? "Không áp dụng" : person.payrollEnabled === false ? "Tắt" : "Bật"
    }));
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "POSO Central Admin";
  workbook.created = new Date(now);
  workbook.modified = new Date(now);
  workbook.calcProperties.fullCalcOnLoad = true;
  const summary = workbook.addWorksheet("Tổng quan", { views: [{ showGridLines: false }] });
  summary.columns = [{ width: 37 }, { width: 33 }, { width: 3 }, { width: 100 }];
  summary.getCell("A2").value = "QUẢN LÝ CỬA HÀNG POSO";
  summary.getCell("A2").font = { name: "Arial", size: 14, bold: true, color: { argb: "FFB74800" } };
  summary.getCell("A4").value = "Thời điểm xuất (GMT+7)";
  summary.getCell("B4").value = localDate(now); summary.getCell("B4").numFmt = DATE;
  summary.getCell("A5").value = "Thống kê từ (GMT+7)";
  summary.getCell("B5").value = localDate(from); summary.getCell("B5").numFmt = DATE;
  summary.getCell("A6").value = "Thống kê đến (GMT+7)";
  summary.getCell("B6").value = localDate(now); summary.getCell("B6").numFmt = DATE;
  summary.getCell("A7").value = "Từ khóa lọc"; summary.getCell("B7").value = options.search || "Tất cả";
  summary.getCell("A8").value = "Trạng thái lọc"; summary.getCell("B8").value = options.status === "all" ? "Tất cả trạng thái" : label(options.status);
  summary.getCell("D4").value = "Doanh thu là tổng tiền đơn hoàn tất trong kỳ, chưa trừ giá trị đơn hoàn trả.";
  summary.getCell("D5").value = "Đơn đang xử lý, khách hàng, sản phẩm và nhân sự là số lượng tại thời điểm xuất.";
  summary.getCell("D6").value = "Hạn mức subscription dùng chung theo cửa hàng trung tâm. Không cộng hạn mức giữa các chi nhánh.";
  summary.getCell("D7").value = "Dữ liệu nguồn: POSO. Thời gian trong file theo GMT+7. Ô ngày trống là chưa có dữ liệu.";
  tableSheet(workbook, "Cửa hàng", storeColumns, stores);
  tableSheet(workbook, "Subscription", subscriptionColumns, subscriptions);
  tableSheet(workbook, "Nhân sự", personnelColumns, personnel);
  const metrics = [
    ["Số cửa hàng xuất", "COUNTA('Cửa hàng'!A2:A", stores.length, INTEGER],
    ["Doanh thu đơn hoàn tất (VND)", "SUM('Cửa hàng'!J2:J", stores.reduce((sum, row) => sum + row.revenue, 0), MONEY],
    ["Đơn hoàn tất trong kỳ", "SUM('Cửa hàng'!K2:K", stores.reduce((sum, row) => sum + row.completed, 0), INTEGER],
    ["Đơn đang xử lý hiện tại", "SUM('Cửa hàng'!L2:L", stores.reduce((sum, row) => sum + row.active, 0), INTEGER],
    ["Đơn hủy trong kỳ", "SUM('Cửa hàng'!M2:M", stores.reduce((sum, row) => sum + row.canceled, 0), INTEGER],
    ["Đơn hoàn trả trong kỳ", "SUM('Cửa hàng'!N2:N", stores.reduce((sum, row) => sum + row.returned, 0), INTEGER],
    ["Giá trị đơn hoàn trả (VND)", "SUM('Cửa hàng'!O2:O", stores.reduce((sum, row) => sum + row.returnedAmount, 0), MONEY],
    ["Khách hàng hiện tại", "SUM('Cửa hàng'!P2:P", stores.reduce((sum, row) => sum + row.customers, 0), INTEGER],
    ["Sản phẩm hiện tại", "SUM('Cửa hàng'!Q2:Q", stores.reduce((sum, row) => sum + row.products, 0), INTEGER],
    ["Lượt gán tài khoản vào cửa hàng", "SUM('Cửa hàng'!R2:R", personnel.length, INTEGER]
  ];
  summary.getCell("A10").value = "Chỉ tiêu"; summary.getCell("B10").value = "Giá trị";
  metrics.forEach(([name, formula, result, format], index) => {
    summary.getCell(`A${index + 11}`).value = name;
    const cell = summary.getCell(`B${index + 11}`);
    cell.value = { formula: `${formula}${stores.length + 1})`, result }; cell.numFmt = format;
  });
  summary.getCell("A21").value = "Subscription độc lập liên quan"; summary.getCell("B21").value = roots.size;
  summary.getCell("A22").value = "Tài khoản duy nhất trong file"; summary.getCell("B22").value = new Set(personnel.map((person) => person.username)).size;
  summary.eachRow((row, index) => {
    row.height = 24;
    row.eachCell((cell) => {
      if (index !== 2) cell.font = { name: "Arial", size: 10, color: { argb: "FF202320" } };
      cell.alignment = { vertical: "middle", horizontal: cell.col === 2 && index >= 11 ? "right" : "left" };
      if (index === 10) {
        cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF343D35" } };
      }
    });
  });
  summary.getCell("B7").alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  summary.getRow(7).height = Math.max(24, Math.ceil((options.search || "").length / 33) * 15 + 8);
  const filename = `poso-cua-hang-chi-tiet-${new Date(now + GMT7).toISOString().slice(0, 10)}.xlsx`;
  return { workbook, filename, count: stores.length };
};
