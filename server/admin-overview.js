import { summarizeStore, normalizeOrder, orderTime } from "./store-summary.js";
import { mapLimited } from "./admin-read.js";

const rank = (order) => Date.parse(orderTime(order)) || 0;
export const recentAdminOrders = (shopID, shop, { days = null, limit = 12, now = Date.now() } = {}) => {
  const recent = [];
  for (const bucket of ["activeOrders", "pastOrders", "canceledOrders", "returnedOrders"]) {
    for (const [id, order] of Object.entries(shop[bucket] || {})) {
      const timestamp = Date.parse(orderTime(order));
      if (days !== null && bucket !== "activeOrders" && (!Number.isFinite(timestamp) || timestamp < now - days * 86400000)) continue;
      const time = timestamp || 0;
      if (recent.length === limit && time <= recent.at(-1).time) continue;
      recent.push({ id, bucket, order, time });
      recent.sort((a, b) => b.time - a.time);
      if (recent.length > limit) recent.pop();
    }
  }
  return recent.map(({ id, bucket, order }) => normalizeOrder(shopID, shop.basicInfo?.name || shop.basicInfo?.shopName || `Cửa hàng ${shopID}`, bucket, id, order));
};

export const readAdminStores = async (context, profiles, { days = 30, includeRecent = false, now = Date.now() } = {}) => {
  // Bound store concurrency and release each bucket after reducing it. Catalog,
  // customer and personnel content is never downloaded for these summary rows.
  const result = await mapLimited(Object.entries(profiles), async ([id, profile]) => {
    const store = summarizeStore(id, profile, days, now);
    const fields = { activeOrders: ["activeOrderCount"], pastOrders: ["revenue", "orderCount"], canceledOrders: ["canceledOrderCount"], inventory: ["lowStockCount"] };
    let recent = [];
    for (const bucket of ["activeOrders", "pastOrders", "canceledOrders", "inventory", ...(includeRecent ? ["returnedOrders"] : [])]) {
      const value = (await context.readUncached(`shops/${id}/${bucket}`)).val();
      const partial = { ...profile, [bucket]: value }, summary = summarizeStore(id, partial, days, now);
      for (const field of fields[bucket] || []) store[field] = summary[field];
      if (includeRecent && bucket !== "inventory") recent = [...recent, ...recentAdminOrders(id, partial, { days, now })].sort((a, b) => rank(b) - rank(a)).slice(0, 12);
    }
    for (const [bucket, name] of [["customers", "customerCount"], ["allItems", "itemCount"], ["personnelPins", "personnelCount"]]) store[name] = (await context.keys(`shops/${id}/${bucket}`)).length;
    return { store, recent };
  }, context.storeConcurrency);
  return {
    stores: result.map((item) => item.store),
    recentOrders: result.flatMap((item) => item.recent).sort((a, b) => rank(b) - rank(a)).slice(0, 12)
  };
};
