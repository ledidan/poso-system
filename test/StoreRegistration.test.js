import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import bcrypt from "bcryptjs";
import { createMemoryDatabase } from "./FirebaseMemory.js";
import { createPlanDatabase } from "../server/subscriptions/PlanDatabase.js";
import { createAdminRouter } from "../server/admin-router.js";
import { validateStoreRegistration, registerStoreAccount } from "../server/StoreRegistration.js";
import { accountEmailMessage, createAccountMailer } from "../server/AccountEmail.js";
const input = (extra = {}) => ({ ownerName: "Khách hàng kiểm thử", name: "Cửa hàng kiểm thử", phoneNumber: "0900000123", password: "synthetic-test-password9", provinceID: "79", businessCategoryID: 1, email: "customer@example.invalid", taxCode: "012345678901", address: "123 Đường kiểm thử", registrationId: randomUUID(), ...extra });
const serve = async (t, raw, send = async () => {}) => {
  const messages = [], accountMailer = { isConfigured: () => true, send: async (info) => { messages.push(info); await send(info); } };
  const app = express(); app.use(express.json());
  app.use("/api", createAdminRouter({ db: createPlanDatabase(raw), accountMailer, authenticate(req, res, next) { req.adminUser = { username: "synthetic-admin" }; next(); } }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return { messages, post: (path, body) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) };
};

test("creates an operational owner and Pro trial atomically, then sends the requested email", async (t) => {
  const raw = createMemoryDatabase({}), info = input();
  const { post, messages } = await serve(t, raw, async ({ username }) => {
    assert.equal(raw.read(`users/${username}/authRegistrationPending`), null);
    assert.equal(Object.keys(raw.read(`users/${username}/shops`)).length, 1);
  });
  const response = await post("/stores", { ...info, license: { plan: "free" }, role: "staff" });
  assert.equal(response.status, 201); const result = await response.json();
  assert.equal(result.account.username, info.phoneNumber); assert.equal(result.emailDelivery.status, "sent");
  assert.equal(JSON.stringify(result).includes(info.password), false);
  const shop = raw.read(`shops/${result.store.id}`), owner = raw.read(`users/${info.phoneNumber}`);
  assert.equal(await bcrypt.compare(info.password, owner.password), true);
  assert.equal(shop.personnelPins[info.phoneNumber].personnelName, info.ownerName);
  assert.equal(shop.personnelPins[info.phoneNumber].role, "owner"); assert.ok(shop.roles.cashier);
  assert.equal(shop.license.plan, "pro"); assert.equal(shop.license.isTrial, true);
  assert.equal(Date.parse(shop.license.expiredAt) - Date.parse(shop.license.startAt), 14 * 86400000);
  assert.equal(shop.basicInfo.taxCode, info.taxCode); assert.equal(shop.basicInfo.city, "Thành phố Hồ Chí Minh");
  assert.equal(raw.read(`merchantAuth/loginAliases/phone/${info.phoneNumber}/accountID`), info.phoneNumber);
  assert.equal(JSON.stringify(raw.data).includes(info.password), false);
  assert.equal(messages.length, 1); assert.equal(messages[0].username, info.phoneNumber);
  const again = await post("/stores", info); assert.equal(again.status, 201);
  assert.equal((await again.json()).store.id, result.store.id); assert.equal(messages.length, 1);
});

test("email is optional and creating a shop never overwrites an existing account", async (t) => {
  const raw = createMemoryDatabase({}), { post, messages } = await serve(t, raw), info = input({ email: "" });
  const response = await post("/stores", info); assert.equal(response.status, 201);
  assert.equal((await response.json()).emailDelivery.status, "skipped"); assert.equal(messages.length, 0);
  const before = structuredClone(raw.data);
  const duplicate = await post("/stores", input({ password: "different-test-password" }));
  assert.equal(duplicate.status, 409); assert.deepEqual(raw.data, before);
});

test("a failed email reports the created account and allows safe retry without creating another shop", async (t) => {
  const raw = createMemoryDatabase({}); let failed = true;
  const { post, messages } = await serve(t, raw, async () => { if (failed) throw new Error("synthetic SMTP failure"); });
  const info = input(), response = await post("/stores", info), result = await response.json();
  assert.equal(response.status, 201); assert.equal(result.emailDelivery.status, "failed");
  assert.ok(raw.read(`users/${info.phoneNumber}/password`));
  const bad = await post(`/stores/${result.store.id}/account-email`, { registrationId: info.registrationId, password: "wrong-password" });
  assert.equal(bad.status, 400); assert.equal(messages.length, 1);
  failed = false;
  raw.write(`shops/${result.store.id}/basicInfo/email`, "changed@example.invalid");
  const retry = await post(`/stores/${result.store.id}/account-email`, { registrationId: info.registrationId, password: info.password });
  assert.equal(retry.status, 200); assert.equal((await retry.json()).emailDelivery.status, "sent");
  assert.equal(Object.keys(raw.read("shops")).length, 1); assert.equal(messages.length, 2);
  assert.equal(messages[1].email, info.email);
  await post(`/stores/${result.store.id}/account-email`, { registrationId: info.registrationId, password: info.password });
  assert.equal(messages.length, 2);
});

test("alias conflicts and failed atomic writes release only this request's reserved records", async () => {
  const info = input(), conflict = createMemoryDatabase({ merchantAuth: { loginAliases: { phone: { [info.phoneNumber]: { accountID: "other-account" } } } } });
  await assert.rejects(registerStoreAccount({ database: conflict, input: info, createdBy: "test" }), { code: "PHONE_IN_USE" });
  assert.equal(conflict.read(`users/${info.phoneNumber}`), null); assert.equal(conflict.read("shops"), null);
  assert.equal(conflict.read(`merchantAuth/loginAliases/phone/${info.phoneNumber}/accountID`), "other-account");
  const raw = createMemoryDatabase({}), ref = raw.ref.bind(raw);
  raw.ref = (path) => { const result = ref(path); if (path === undefined) result.update = async () => { throw new Error("synthetic commit failure"); }; return result; };
  await assert.rejects(registerStoreAccount({ database: raw, input: info, createdBy: "test" }));
  assert.equal(raw.read(`users/${info.phoneNumber}`), null); assert.equal(raw.read("shops"), null);
  assert.equal(raw.read(`merchantAuth/loginAliases/phone/${info.phoneNumber}`), null);
});

test("validates phone, email, province, industry and UTF-8 password length before writing", async (t) => {
  const raw = createMemoryDatabase({}), { post, messages } = await serve(t, raw);
  for (const invalid of [{ ownerName: "" }, { phoneNumber: "012345" }, { email: "a\r\nbcc:evil@example.invalid" }, { email: "other,customer@example.invalid" }, { provinceID: "9999" }, { businessCategoryID: 999 }, { password: "á".repeat(40) }, { taxCode: "abc" }, { taxCode: "" }]) {
    const response = await post("/stores", input(invalid)); assert.equal(response.status, 400);
  }
  assert.deepEqual(raw.writes, []); assert.deepEqual(messages, []);
  assert.equal(validateStoreRegistration(input({ phoneNumber: "+84 900000123" })).username, "0900000123");
});

test("email uses the provided content and escapes customer data in HTML", () => {
  const info = input({ ownerName: 'Khách <img src=x onerror="alert(1)">' });
  const email = accountEmailMessage({ ...info, username: info.phoneNumber });
  assert.ok(email.subject.startsWith("[POSO] Thông tin cấp tài khoản"));
  assert.ok(email.text.includes(`Tên đăng nhập: ${info.phoneNumber}`));
  assert.ok(email.text.includes("https://www.poso.vn/tai-ung-dung"));
  assert.ok(email.html.includes("0977140536")); assert.ok(email.html.includes("support@autuna.com"));
  assert.equal(email.html.includes("<img"), false); assert.ok(email.html.includes("&lt;img"));
});

test("SMTP uses encrypted Gmail transport and rejects a non-accepted recipient", async () => {
  let settings, message;
  const env = { SMTP_HOST: "smtp.gmail.com", SMTP_PORT: "465", SMTP_USER: "sender@example.invalid", SMTP_PASSWORD: "synthetic-app-password", SMTP_FROM: "sender@example.invalid" };
  const mailer = createAccountMailer(env, (options) => { settings = options; return { sendMail: async (mail) => { message = mail; return { accepted: [mail.to] }; } }; });
  const info = input(); await mailer.send({ ...info, username: info.phoneNumber });
  assert.equal(settings.secure, true); assert.equal(settings.port, 465); assert.equal(message.replyTo, "support@autuna.com");
  assert.equal(message.from.address, env.SMTP_FROM);
  const rejected = createAccountMailer(env, () => ({ sendMail: async () => ({ accepted: [] }) }));
  await assert.rejects(rejected.send({ ...info, username: info.phoneNumber }), { code: "MAIL_REJECTED" });
});
