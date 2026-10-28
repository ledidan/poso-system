export const STORE_STATUS_OPTIONS = [
  ["active", "Đang hoạt động"],
  ["comingSoon", "Sắp ra mắt"],
  ["suspended", "Tạm khóa"],
  ["inactive", "Ngừng hoạt động"],
  ["trial", "Dùng thử"],
  ["expired", "Đã hết hạn"]
];

export const filterStores = (stores, { search = "", status = "all" } = {}) => {
  const query = search.trim().toLocaleLowerCase("vi");
  return stores.filter((store) =>
    `${store.name} ${store.address} ${store.id}`.toLocaleLowerCase("vi").includes(query) &&
    (status === "all" || store.status === status)
  );
};
