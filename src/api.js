const API_ROOT = "/api/admin";
const sessionExpired = (response) => {
  if (response.status === 401) window.dispatchEvent(new Event("poso:session-expired"));
};

export const exportStoresExcel = async ({ search = "", status = "all", days = "30" } = {}) => {
  const query = new URLSearchParams({ search, status, days });
  const response = await fetch(`${API_ROOT}/stores/export.xlsx?${query}`, { credentials: "include" });
  if (!response.ok) {
    sessionExpired(response);
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Không thể xuất Excel cửa hàng. Vui lòng thử lại.");
  }
  if (!response.headers.get("Content-Type")?.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) {
    throw new Error("Máy chủ chưa trả về file Excel hợp lệ. Vui lòng tải lại trang và thử lại.");
  }
  const blob = await response.blob();
  const filename = response.headers.get("Content-Disposition")?.match(/filename="?([^";]+)/i)?.[1] || "poso-cua-hang-chi-tiet.xlsx";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename; document.body.appendChild(link);
  link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { count: Number(response.headers.get("X-Export-Count")) || 0, filename };
};

export const request = async (path, user, options = {}) => {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "POSO-Admin",
      ...options.headers
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { sessionExpired(response); throw new Error(payload.message || "Đã có lỗi xảy ra."); }
  return payload;
};

export const login = async (username, password) => {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-Requested-With": "POSO-Admin" },
    body: JSON.stringify({ username, password })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || "Không thể đăng nhập.");
    error.retryAfter = Number(payload.retryAfter) || 0;
    error.attemptsRemaining = payload.attemptsRemaining;
    throw error;
  }
  return payload.user;
};

export const getSession = async () => {
  const response = await fetch("/api/auth/session", { credentials: "include" });
  if (response.status === 401) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Không thể kiểm tra phiên đăng nhập.");
  return payload.user;
};

export const logout = async () => {
  const response = await fetch("/api/auth/logout", {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", "X-Requested-With": "POSO-Admin" }, body: "{}"
  });
  if (!response.ok) throw new Error("Chưa thể đăng xuất. Vui lòng thử lại.");
};
