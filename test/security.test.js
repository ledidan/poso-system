import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import express from "express";
import { createAdminAuth, LOCKOUT_MS } from "../server/auth.js";
import { createMemoryAuthStore, createDatabaseAuthStore } from "../server/auth-store.js";
import { createApp } from "../server/app.js";
import { assertProductionConfig, trustedProxies } from "../server/security.js";
import { createAdminRouter } from "../server/admin-router.js";
import { createMemoryDatabase } from "./FirebaseMemory.js";

const configure = (t, production = false) => {
  const keys = ["NODE_ENV", "ADMIN_USERNAME", "ADMIN_PASSWORD", "ADMIN_SESSION_SECRET", "ADMIN_ORIGIN", "ADMIN_COOKIE_SECURE", "TRUST_PROXY", "JWT_SECRET"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  Object.assign(process.env, {
    NODE_ENV: production ? "production" : "test", ADMIN_USERNAME: "security-admin", ADMIN_PASSWORD: "Random-Credential-7uY5x9",
    ADMIN_SESSION_SECRET: crypto.randomBytes(32).toString("hex"), ADMIN_COOKIE_SECURE: "false", TRUST_PROXY: ""
  });
  if (production) process.env.ADMIN_ORIGIN = "https://admin.example.com";
  else delete process.env.ADMIN_ORIGIN;
};
const serve = async (t, app) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
};
const authServer = async (t, options = {}) => {
  const auth = createAdminAuth(options);
  const app = express();
  app.set("trust proxy", "loopback");
  app.use(express.json());
  app.use("/api/auth", auth.router);
  app.get("/private", auth.requireAdmin, (req, res) => res.json(req.adminUser));
  return { url: await serve(t, app), ...auth };
};
const login = (url, { password = process.env.ADMIN_PASSWORD, username = process.env.ADMIN_USERNAME, headers = {} } = {}) => fetch(`${url}/api/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "POSO-Admin", ...headers }, body: JSON.stringify({ username, password })
});
const cookieFor = async (url) => {
  const response = await login(url);
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
};

test("fifth failed attempt locks even the correct password; expires after 15 minutes without extending on retries", async (t) => {
  configure(t);
  let timestamp = Date.now();
  const { url } = await authServer(t, { now: () => timestamp });
  for (let i = 1; i <= 5; i++) {
    const response = await login(url, { password: "incorrect" });
    assert.equal(response.status, i === 5 ? 429 : 401);
    assert.equal((await response.json()).attemptsRemaining, 5 - i);
    if (i === 5) assert.equal(response.headers.get("retry-after"), "900");
  }
  timestamp += 60_000;
  const blocked = await login(url);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("retry-after"), "840");
  assert.equal(blocked.headers.get("set-cookie"), null);
  timestamp += LOCKOUT_MS - 60_000;
  assert.equal((await login(url)).status, 200);
});

test("successful fifth attempt resets prior failures, while password guesses never appear in persisted state", async (t) => {
  configure(t);
  const raw = createMemoryDatabase();
  const { url } = await authServer(t, { store: createDatabaseAuthStore(raw) });
  for (let i = 0; i < 4; i++) assert.equal((await login(url, { password: "secret-guess" })).status, 401);
  assert.equal((await login(url)).status, 200);
  const next = await login(url, { password: "secret-guess" });
  assert.equal(next.status, 401);
  assert.equal((await next.json()).attemptsRemaining, 4);
  const persisted = JSON.stringify(raw.data);
  for (const secret of ["secret-guess", process.env.ADMIN_PASSWORD, process.env.ADMIN_SESSION_SECRET, "127.0.0.1"]) assert.ok(!persisted.includes(secret));
});

test("five concurrent guesses across two instances lock the account despite rotating IPs; restart keeps the lock", async (t) => {
  configure(t);
  const raw = createMemoryDatabase();
  const options = { store: createDatabaseAuthStore(raw) };
  const first = await authServer(t, options);
  const second = await authServer(t, { store: createDatabaseAuthStore(raw) });
  const responses = await Promise.all(Array.from({ length: 12 }, (_, index) => login(index % 2 ? first.url : second.url, {
    password: "incorrect", headers: { "X-Forwarded-For": `192.0.2.${index + 1}` }
  })));
  assert.equal(responses.filter((response) => response.status === 401).length, 4);
  assert.equal(responses.filter((response) => response.status === 429).length, 8);
  const restarted = await authServer(t, { store: createDatabaseAuthStore(raw) });
  assert.equal((await login(restarted.url, { headers: { "X-Forwarded-For": "198.51.100.200" } })).status, 429);
});

test("changing usernames cannot evade the IP limit", async (t) => {
  configure(t);
  const { url } = await authServer(t);
  for (let index = 0; index < 5; index++) assert.equal((await login(url, { username: `unknown-${index}` })).status, index < 4 ? 401 : 429);
  assert.equal((await login(url)).status, 429);
});

test("session survives instance replacement, logout revokes cookie and Bearer replay on all instances", async (t) => {
  configure(t);
  const raw = createMemoryDatabase();
  const first = await authServer(t, { store: createDatabaseAuthStore(raw) });
  const cookie = await cookieFor(first.url);
  const restarted = await authServer(t, { store: createDatabaseAuthStore(raw) });
  assert.equal((await fetch(`${restarted.url}/private`, { headers: { Cookie: cookie } })).status, 200);
  const logout = await fetch(`${first.url}/api/auth/logout`, { method: "POST", headers: { Cookie: cookie } });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get("set-cookie"), /HttpOnly/);
  assert.equal((await fetch(`${restarted.url}/private`, { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await fetch(`${first.url}/private`, { headers: { Authorization: `Bearer ${cookie.split("=")[1]}` } })).status, 401);
});

test("credential rotation, expired sessions, invalid cookies and JWTs lacking registered sessions are rejected", async (t) => {
  configure(t);
  let timestamp = Date.now();
  const { url } = await authServer(t, { now: () => timestamp });
  const cookie = await cookieFor(url);
  process.env.ADMIN_PASSWORD += "-rotated";
  assert.equal((await fetch(`${url}/private`, { headers: { Cookie: cookie } })).status, 401);
  const current = await cookieFor(url);
  timestamp += 8 * 60 * 60 * 1000;
  assert.equal((await fetch(`${url}/private`, { headers: { Cookie: current } })).status, 401);
  const legacy = jwt.sign({ username: process.env.ADMIN_USERNAME }, process.env.ADMIN_SESSION_SECRET, { expiresIn: "8h", issuer: "poso-central-admin", audience: "poso-admin-web" });
  for (const invalid of ["%E0%A4%A", "forged", legacy]) assert.equal((await fetch(`${url}/private`, { headers: { Cookie: `unrelated=%xx; poso_admin_session=${invalid}` } })).status, 401);
});

test("storage failure fails closed for login and protected APIs", async (t) => {
  configure(t);
  const store = createMemoryAuthStore();
  const { url } = await authServer(t, { store });
  const cookie = await cookieFor(url);
  store.getSession = async () => { throw new Error("private database diagnostic"); };
  assert.equal((await fetch(`${url}/private`, { headers: { Cookie: cookie } })).status, 503);
  store.updateLimit = async () => { throw new Error("private database diagnostic"); };
  const response = await login(url);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.doesNotMatch(await response.text(), /private database diagnostic|Firebase|ADMIN_/);
});

test("all admin routes reject unauthenticated access before any merchant database read or write", async (t) => {
  configure(t);
  const raw = createMemoryDatabase();
  const { app } = createApp({ services: { db: raw } });
  const router = createAdminRouter({ db: raw });
  const routes = router.stack.filter((layer) => layer.route).map((layer) => layer.route);
  const url = await serve(t, app);
  assert.ok(routes.length >= 20);
  for (const route of routes) {
    const method = Object.keys(route.methods).find((method) => method !== "_all") || "get";
    const endpoint = route.path.replace(/:[\w]+/g, "valid-id");
    const response = await fetch(`${url}/api/admin${endpoint}`, { method: method.toUpperCase(), headers: { "Content-Type": "application/json", "X-Requested-With": "POSO-Admin" }, ...(method === "get" ? {} : { body: "{}" }) });
    assert.equal(response.status, 401, `${method} ${endpoint}`);
  }
  assert.deepEqual(raw.reads, []);
  assert.deepEqual(raw.writes, []);
});

test("CSRF protection rejects foreign origins, null origins, same-site sibling domains and HTML forms", async (t) => {
  configure(t);
  const { app } = createApp({ services: { db: createMemoryDatabase() } });
  const url = await serve(t, app);
  for (const headers of [{ Origin: "https://evil.example.com" }, { Origin: "null" }, { "Sec-Fetch-Site": "same-site" }, { "Sec-Fetch-Site": "cross-site" }]) {
    assert.equal((await login(url, { headers })).status, 403);
  }
  assert.equal((await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 403);
  assert.equal((await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "text/plain", "X-Requested-With": "POSO-Admin" }, body: "{}" })).status, 415);
  assert.equal((await login(url, { headers: { Origin: url, "Sec-Fetch-Site": "same-origin" } })).status, 200);
});

test("production requires HTTPS and uses Secure cookies, CSP, no-store and safe public responses", async (t) => {
  configure(t, true);
  process.env.TRUST_PROXY = "127.0.0.1/32";
  const { app } = createApp({ services: { db: createMemoryDatabase() }, authStore: createMemoryAuthStore() });
  const url = await serve(t, app);
  assert.equal((await login(url)).status, 426);
  const headers = { "X-Forwarded-Proto": "https", Origin: process.env.ADMIN_ORIGIN };
  const response = await login(url, { headers });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /; Secure/);
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  assert.match(response.headers.get("set-cookie"), /SameSite=Strict/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.match(response.headers.get("strict-transport-security"), /max-age=31536000/);
  assert.equal(response.headers.get("x-powered-by"), null);
  const health = await fetch(`${url}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(Object.keys(await health.json()).sort(), ["ok", "timestamp"]);
  const missing = await fetch(`${url}/api/missing`, { headers });
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get("content-type"), /json/);
});

test("untrusted forwarding headers do not bypass HTTPS enforcement", async (t) => {
  configure(t, true);
  const { app } = createApp({ services: { db: createMemoryDatabase() }, authStore: createMemoryAuthStore() });
  const url = await serve(t, app);
  assert.equal((await login(url, { headers: { "X-Forwarded-Proto": "https", "X-Forwarded-For": "198.51.100.3" } })).status, 426);
});

test("malformed or oversized input is rejected safely and weak/unconfigured auth cannot issue sessions", async (t) => {
  configure(t);
  const { app } = createApp();
  const url = await serve(t, app);
  for (const body of ["{", JSON.stringify({ password: "x".repeat(70_000) })]) {
    const response = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "POSO-Admin" }, body });
    assert.equal(response.status, body === "{" ? 400 : 413);
    assert.doesNotMatch(await response.text(), /SyntaxError|stack|Firebase/);
  }
  assert.equal((await login(url, { username: { injected: true } })).status, 400);
  process.env.ADMIN_SESSION_SECRET = "";
  process.env.JWT_SECRET = "legacy-secret-should-not-be-used";
  assert.equal((await login(url)).status, 503);
});

test("path injection into admin IDs and store memberships is rejected before writes", async (t) => {
  configure(t);
  const raw = createMemoryDatabase({ users: { existing: {} } });
  const { app } = createApp({ services: { db: raw } });
  const url = await serve(t, app), cookie = await cookieFor(url);
  const headers = { Cookie: cookie, "Content-Type": "application/json", "X-Requested-With": "POSO-Admin" };
  for (const [method, endpoint] of [["DELETE", "/users/a%2Fb"], ["PATCH", "/stores/%24bad"], ["PATCH", "/subscriptions/a%2Fb"], ["DELETE", "/support-tickets/%24bad"], ["DELETE", "/campaigns/constructor"]]) {
    const response = await fetch(`${url}/api/admin${endpoint}`, { method, headers });
    assert.equal(response.status, 400, endpoint);
  }
  assert.equal((await fetch(`${url}/api/admin/users/existing`, { method: "PATCH", headers, body: JSON.stringify({ storeIds: ["../../systemAdmin"], password: "valid-pass" }) })).status, 400);
  assert.equal((await fetch(`${url}/api/admin/users/existing`, { method: "PATCH", headers, body: JSON.stringify({ password: "Đ".repeat(40) }) })).status, 400);
  assert.deepEqual(raw.writes, []);
});

test("expired auth records are cleaned without deleting records renewed during cleanup", async () => {
  const now = Date.now(), root = "systemAdmin/security";
  const raw = createMemoryDatabase({ systemAdmin: { security: {
    sessions: { expired: { expiresAt: now - 1 }, valid: { expiresAt: now + 1000 }, renewed: { expiresAt: now - 1 } },
    loginLimits: { old: { count: 5, resetAt: now - 1 }, locked: { count: 5, resetAt: now + 1000 } }
  } } });
  raw.beforeTransaction = (path) => { if (path === `${root}/sessions/renewed`) raw.write(path, { expiresAt: now + 5000 }); };
  await createDatabaseAuthStore(raw).cleanup(now);
  assert.equal(raw.read(`${root}/sessions/expired`), null);
  assert.equal(raw.read(`${root}/loginLimits/old`), null);
  assert.ok(raw.read(`${root}/sessions/valid`));
  assert.ok(raw.read(`${root}/sessions/renewed`));
  assert.ok(raw.read(`${root}/loginLimits/locked`));
});

test("campaign responses exclude provider project IDs and raw diagnostic messages", async (t) => {
  configure(t);
  const raw = createMemoryDatabase({ systemAdmin: { notificationCampaigns: { sample: {
    title: "Thông báo thử", status: "failed", createdAt: new Date().toISOString(), messagingProjectId: "private-project-id",
    errors: [{ code: "messaging/mismatched-credential", message: "Firebase private credential diagnostic" }]
  } } } });
  const { app } = createApp({ services: { db: raw } });
  const url = await serve(t, app), cookie = await cookieFor(url);
  const response = await fetch(`${url}/api/admin/campaigns`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.doesNotMatch(body, /Firebase|private-project-id|private credential|messagingProjectId/);
  assert.match(body, /messaging\/mismatched-credential/);
});

test("production startup rejects default credentials, weak secrets, missing storage/origin and overbroad proxy trust", (t) => {
  configure(t, true);
  assert.doesNotThrow(() => assertProductionConfig({ databaseConfigured: true }));
  assert.throws(() => assertProductionConfig({ databaseConfigured: false }), /shared database/);
  process.env.ADMIN_ORIGIN = "http://admin.example.com";
  assert.throws(() => assertProductionConfig({ databaseConfigured: true }), /HTTPS origin/);
  process.env.ADMIN_ORIGIN = "https://admin.example.com";
  process.env.ADMIN_PASSWORD = "change-this-password";
  assert.throws(() => assertProductionConfig({ databaseConfigured: true }), /unique password/);
  process.env.ADMIN_PASSWORD = "Random-Credential-7uY5x9";
  process.env.ADMIN_SESSION_SECRET = "x".repeat(64);
  assert.throws(() => assertProductionConfig({ databaseConfigured: true }), /random session secret/);
  for (const invalid of ["true", "1", "0.0.0.0/0", "0.0.0.0/00", "::/0", "127.0.0.1/99"]) {
    process.env.TRUST_PROXY = invalid;
    assert.throws(trustedProxies);
  }
});
