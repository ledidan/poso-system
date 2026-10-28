import { dailyRevenueSettings } from "../shared/daily-revenue-settings.js";
const DAY = 24 * 60 * 60 * 1000;

export const activeshops = (shops = {}) => Object.fromEntries(Object.entries(shops || {}).filter(([, shop]) =>
  shop && typeof shop === "object" && shop.isDeleted !== true &&
  shops?.[shop.subscriptionRootID]?.isDeleted !== true
));

export const asNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const orderTime = (order) => order?.closedAt || order?.updatedAt || order?.timeStamp || order?.createdAt || "";

export const withinDays = (order, days, now = Date.now()) => {
  const timestamp = Date.parse(orderTime(order));
  return Number.isFinite(timestamp) && timestamp >= now - days * DAY;
};

export const safeBasicInfo = (shopId, basicInfo = {}) => ({
  id: shopId,
  name: basicInfo.name || basicInfo.shopName || `Cửa hàng ${shopId}`,
  address: basicInfo.address || "",
  phoneNumber: basicInfo.phoneNumber || "",
  businessCategory: basicInfo.businessCategory || "",
  createdAt: basicInfo.createdAt || "",
  logoURL: basicInfo.logoURL || "",
  thumbnailImg: basicInfo.thumbnailImg || "",
  membership: basicInfo.membership || {},
  packageInfo: basicInfo.packageInfo || {},
  revenueAverage: basicInfo.revenueAverage || "",
  notificationSettings: dailyRevenueSettings(basicInfo.notificationSettings)
});

export const summarizeStore = (shopId, shop = {}, days = 30, now = Date.now()) => {
  const activeOrders = Object.values(shop.activeOrders || {});
  const pastOrders = Object.values(shop.pastOrders || {}).filter((order) => withinDays(order, days, now));
  const canceledOrders = Object.values(shop.canceledOrders || {}).filter((order) => withinDays(order, days, now));
  const inventory = Object.values(shop.inventory || {});

  return {
    ...safeBasicInfo(shopId, shop.basicInfo),
    status: shop.basicInfo?.membership?.status || shop.basicInfo?.packageInfo?.status || "active",
    revenue: pastOrders.reduce((sum, order) => sum + asNumber(order.total), 0),
    orderCount: pastOrders.length,
    activeOrderCount: activeOrders.length,
    canceledOrderCount: canceledOrders.length,
    customerCount: Object.keys(shop.customers || {}).length,
    itemCount: Object.keys(shop.allItems || {}).length,
    personnelCount: Object.keys(shop.personnelPins || {}).length,
    lowStockCount: inventory.filter((item) => {
      const stock = asNumber(item.currentStock ?? item.stockQuantity ?? item.quantity);
      const minimum = asNumber(item.minimumStock ?? item.lowStockAlert ?? item.minQuantity);
      return minimum > 0 && stock <= minimum;
    }).length
  };
};

export const normalizeOrder = (shopId, shopName, bucket, orderId, order = {}) => ({
  id: orderId,
  shopId,
  shopName,
  bucket,
  customerName: order.customerName || order.customerInfo?.name || "Khách lẻ",
  paymentMethod: order.paymentMethod || "",
  deliveryType: order.orderDeliveryTypeID || "",
  status: order.status || (bucket === "pastOrders" ? "closed" : bucket === "canceledOrders" ? "canceled" : "active"),
  total: asNumber(order.total),
  itemCount: Array.isArray(order.orderItems)
    ? order.orderItems.reduce((sum, item) => sum + asNumber(item.quantity || 1), 0)
    : Object.keys(order.orderItems || {}).length,
  timeStamp: orderTime(order)
});
