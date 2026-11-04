import { createHash, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { BUSINESS_CATEGORIES, PROVINCES } from "../shared/RegistrationOptions.js";
import { DEFAULT_ROLES } from "./RegistrationRoles.js";
import { createTrial } from "./Subscription.js";

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const text = (input, key, max, required = true) => {
  const value = typeof input[key] === "string" ? input[key].trim() : "";
  if ((required && !value) || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw fail(400, "INVALID_REGISTRATION", `Thông tin ${{ ownerName: "họ tên chủ cửa hàng", name: "tên cửa hàng", phoneNumber: "số điện thoại", email: "email", taxCode: "mã số thuế", address: "địa chỉ" }[key] || key} không hợp lệ.`);
  return value;
};
export const validateStoreRegistration = (input = {}) => {
  const ownerName = text(input, "ownerName", 120), name = text(input, "name", 120);
  const phoneNumber = text(input, "phoneNumber", 24).replace(/[\s().-]/g, "").replace(/^\+?84(?=\d{9}$)/, "0");
  if (!/^0[35789]\d{8}$/.test(phoneNumber)) throw fail(400, "INVALID_PHONE", "Số điện thoại không hợp lệ.");
  const password = input.password;
  if (typeof password !== "string" || password.length < 8 || /[\x00-\x1f\x7f]/.test(password) || new TextEncoder().encode(password).length > 72) throw fail(400, "INVALID_PASSWORD", "Mật khẩu cần ít nhất 8 ký tự và tối đa 72 byte.");
  const province = PROVINCES.find((item) => item.id === String(input.provinceID));
  const businessCategory = BUSINESS_CATEGORIES.find((item) => item.id === Number(input.businessCategoryID));
  if (!province || !businessCategory) throw fail(400, "INVALID_REGISTRATION_OPTIONS", "Vui lòng chọn tỉnh/thành phố và ngành kinh doanh.");
  const email = text(input, "email", 254, false).toLowerCase(), taxCode = text(input, "taxCode", 14);
  if (email && !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email)) throw fail(400, "INVALID_EMAIL", "Email không hợp lệ.");
  if (taxCode && !/^(?:\d{10}|\d{12}|\d{10}-?\d{3})$/.test(taxCode)) throw fail(400, "INVALID_TAX_CODE", "Mã số thuế cần 10, 12 hoặc 13 chữ số.");
  const street = text(input, "address", 300, false);
  const address = street ? `${street}, ${province.name}` : province.name;
  const registrationId = input.registrationId || randomUUID();
  if (typeof registrationId !== "string" || !/^[a-f0-9-]{36}$/i.test(registrationId)) throw fail(400, "INVALID_REGISTRATION_ID", "Mã yêu cầu tạo tài khoản không hợp lệ.");
  return { ownerName, name, phoneNumber, username: phoneNumber, password, provinceID: province.id, city: province.name, businessCategoryID: businessCategory.id, businessCategory: businessCategory.name, email, taxCode, address, registrationId };
};

// This workflow only provisions a new independent shop and owner. Its final
// multi-location write is atomic; it never changes an existing account or shop.
export const registerStoreAccount = async ({ database, input, createdBy, now = Date.now() }) => {
  const info = validateStoreRegistration(input), db = database[Symbol.for("poso.rawPlanDatabase")] || database;
  const { password, registrationId, username } = info;
  const publicInfo = { ...info }; delete publicInfo.password;
  const fingerprint = createHash("sha256").update(JSON.stringify(publicInfo)).digest("hex");
  const registrationPath = `systemAdmin/storeRegistrations/${registrationId}`;
  const previous = (await db.ref(registrationPath).once("value")).val();
  if (previous) {
    const user = (await db.ref(`users/${username}`).once("value")).val();
    if (previous.fingerprint !== fingerprint || !await bcrypt.compare(password, user?.password || "")) throw fail(409, "REGISTRATION_CONFLICT", "Yêu cầu tạo tài khoản đã được sử dụng với thông tin khác.");
    return { ...previous, info, created: false };
  }
  const aliasPath = `merchantAuth/loginAliases/phone/${username}`, userRef = db.ref(`users/${username}`);
  let reservedUser = false, reservedAlias = false;
  try {
    const reservation = await userRef.transaction((current) => current === null ? { authRegistrationPending: true, _adminRegistrationId: registrationId } : undefined);
    if (!reservation.committed) throw fail(409, "ACCOUNT_ALREADY_EXISTS", "Số điện thoại đã được sử dụng. Không thể tạo tài khoản trùng.");
    reservedUser = true;
    const alias = await db.ref(aliasPath).transaction((current) => !current ? { accountID: username, _adminRegistrationId: registrationId } : current.accountID === username ? current : undefined);
    if (!alias.committed) throw fail(409, "PHONE_IN_USE", "Số điện thoại đã được liên kết với tài khoản khác.");
    reservedAlias = alias.snapshot.val()?._adminRegistrationId === registrationId;
    const shopId = `shop_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    if ((await db.ref(`shops/${shopId}`).once("value")).exists()) throw fail(409, "SHOP_ALREADY_EXISTS", "Mã cửa hàng đã tồn tại. Vui lòng thử lại.");
    const trial = createTrial(now), createdAt = new Date(now).toISOString();
    const membership = { personnelID: randomUUID().slice(0, 12), personnelName: info.ownerName, role: "owner", isActive: true };
    const basicInfo = { id: shopId, name: info.name, ownerName: info.ownerName, address: info.address, city: info.city, provinceID: info.provinceID, businessCategory: info.businessCategory, businessCategoryID: info.businessCategoryID, phoneNumber: username, email: info.email, taxCode: info.taxCode, createdAt, membership: { status: "active" }, packageInfo: trial.packageInfo, phoneNumbersToReceiveOrders: { primary: username }, settings: { products: { skuCounters: { SKU: { current: 1, isHidden: false } } } } };
    const record = { shopId, username, fingerprint, createdAt, createdBy, customer: { ownerName: info.ownerName, phoneNumber: info.phoneNumber, email: info.email, taxCode: info.taxCode, address: info.address }, emailDelivery: { status: info.email ? "pending" : "skipped" } };
    await db.ref().update({
      [`shops/${shopId}`]: { basicInfo, roles: DEFAULT_ROLES, personnelPins: { [username]: membership }, subscriptionRootID: shopId, subscriptionBranches: { [shopId]: true }, subscriptionUsageStartedAt: now, license: trial.license, subscriptionInfo: trial.subscriptionInfo, isDeleted: false },
      [`users/${username}`]: { password: await bcrypt.hash(password, 12), authVersion: randomUUID(), isActive: true, contactPhone: username, email: info.email, emailVerified: false, shops: { [shopId]: membership } },
      [aliasPath]: { accountID: username }, [registrationPath]: record
    });
    reservedUser = false; reservedAlias = false;
    return { ...record, basicInfo, info, created: true };
  } catch (error) {
    if (reservedAlias) await db.ref(aliasPath).transaction((current) => current?._adminRegistrationId === registrationId ? null : undefined).catch(() => {});
    if (reservedUser) await userRef.transaction((current) => current?.authRegistrationPending && current._adminRegistrationId === registrationId ? null : undefined).catch(() => {});
    throw error;
  }
};

export const deliverStoreAccountEmail = async ({ database, registration, mailer }) => {
  const db = database[Symbol.for("poso.rawPlanDatabase")] || database;
  if (!registration.info.email) return { status: "skipped" };
  const ref = db.ref(`systemAdmin/storeRegistrations/${registration.info.registrationId}/emailDelivery`);
  const lock = await ref.transaction((current) => ["sent", "sending"].includes(current?.status) ? undefined : { status: "sending", attemptedAt: new Date().toISOString() });
  if (!lock.committed) return (await ref.once("value")).val() || { status: "pending" };
  let delivery;
  try {
    if (!mailer?.isConfigured()) throw Object.assign(new Error("Mail is not configured"), { code: "MAIL_NOT_CONFIGURED" });
    await mailer.send(registration.info);
    delivery = { status: "sent", sentAt: new Date().toISOString() };
  } catch (error) {
    delivery = { status: "failed", code: error.code === "MAIL_NOT_CONFIGURED" ? error.code : "MAIL_SEND_FAILED" };
  }
  await ref.set(delivery).catch(() => {});
  return delivery;
};
