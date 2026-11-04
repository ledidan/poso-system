import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createServer } from "node:http";
import { createVercelRuntime, configureVercelEnvironment } from "../server/vercel.js";
import { createMemoryDatabase } from "./FirebaseMemory.js";
import { createPlanDatabase } from "../server/subscriptions/PlanDatabase.js";

const configure = (t) => {
  const values = {
    NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "isolated-admin.vercel.app",
    ADMIN_USERNAME: "vercel-test-admin", ADMIN_PASSWORD: crypto.randomBytes(24).toString("hex"), ADMIN_SESSION_SECRET: crypto.randomBytes(32).toString("hex"),
    CRON_SECRET: crypto.randomBytes(32).toString("hex"), TRUST_PROXY: "", ADMIN_COOKIE_SECURE: "true", ADMIN_ORIGIN: "",
    FIREBASE_PROJECT_ID: "isolated-test", FIREBASE_CLIENT_EMAIL: "isolated@example.test", FIREBASE_PRIVATE_KEY: "offline-key-not-used", FIREBASE_DATABASE_URL: "https://isolated-test.firebasedatabase.app"
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  Object.assign(process.env, values);
};
const serve = async (t, handler) => {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  return `http://127.0.0.1:${server.address().port}`;
};
const edge = { "x-forwarded-proto": "https", "x-forwarded-for": "192.0.2.1" };
const headers = () => ({ ...edge, "content-type": "application/json", "x-requested-with": "POSO-Admin", origin: process.env.ADMIN_ORIGIN });
const login = (url, body = {}) => fetch(url + "/api/auth/login", { method: "POST", headers: headers(), body: JSON.stringify({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD, ...body }) });
const servicesFor = (raw) => ({ securityDb: raw, db: createPlanDatabase(raw) });

test("Vercel resolves only the trusted production system domain and validates optional cron credentials", (t) => {
  configure(t); configureVercelEnvironment();
  assert.equal(process.env.ADMIN_ORIGIN, "https://isolated-admin.vercel.app");
  process.env.ADMIN_ORIGIN = "https://custom-admin.example.com"; configureVercelEnvironment();
  assert.equal(process.env.ADMIN_ORIGIN, "https://custom-admin.example.com");
  process.env.CRON_SECRET = process.env.ADMIN_SESSION_SECRET;
  assert.throws(configureVercelEnvironment, /independent random secret/);
  process.env.CRON_SECRET = "short";
  assert.throws(configureVercelEnvironment, /CRON_SECRET/);
  process.env.ADMIN_ORIGIN = ""; process.env.VERCEL_ENV = "preview";
  assert.throws(configureVercelEnvironment, /ADMIN_ORIGIN/);
});

test("Vercel HTTPS and same-origin cookies work across instances while admin and cron authorities remain separate", async (t) => {
  configure(t);
  const raw = createMemoryDatabase({ shops: {}, users: {} }), services = servicesFor(raw);
  let campaignRuns = 0;
  const runtime = () => createVercelRuntime({ services, runCampaigns: async () => { campaignRuns++; return []; } });
  const first = await serve(t, runtime().app), second = await serve(t, runtime().app);
  assert.equal((await fetch(first + "/api/admin/users", { headers: edge })).status, 401);
  assert.equal(raw.reads.length, 0);
  const response = await login(first); assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  assert.match(response.headers.get("set-cookie"), /; Secure/); assert.match(response.headers.get("set-cookie"), /HttpOnly/); assert.match(response.headers.get("set-cookie"), /SameSite=Strict/);
  assert.equal((await fetch(second + "/api/auth/session", { headers: { ...edge, cookie } })).status, 200);
  for (const extra of [{}, { cookie }, { authorization: `Bearer ${cookie.split("=")[1]}` }, { authorization: "Bearer undefined" }]) {
    assert.equal((await fetch(first + "/api/cron/campaigns", { headers: { ...edge, ...extra } })).status, 401);
  }
  assert.equal(campaignRuns, 0);
  const cron = await fetch(first + "/api/cron/campaigns", { headers: { ...edge, authorization: `Bearer ${process.env.CRON_SECRET}` } });
  assert.equal(cron.status, 200); assert.equal(cron.headers.get("cache-control"), "no-store"); assert.equal(campaignRuns, 1);
  assert.equal((await fetch(first + "/api/admin/users", { headers: { ...edge, authorization: `Bearer ${process.env.CRON_SECRET}` } })).status, 401);
  assert.equal((await fetch(first + "/api/auth/logout", { method: "POST", headers: { ...headers(), cookie }, body: "{}" })).status, 204);
  assert.equal((await fetch(second + "/api/auth/session", { headers: { ...edge, cookie } })).status, 401);
  assert.equal((await fetch(first + "/api/does-not-exist", { headers: edge })).status, 404);
});

test("Vercel preserves the five-failure lockout across instances and ignores local spoofed forwarding", async (t) => {
  configure(t);
  const services = servicesFor(createMemoryDatabase());
  const first = await serve(t, createVercelRuntime({ services }).app), second = await serve(t, createVercelRuntime({ services }).app);
  for (let attempt = 1; attempt <= 5; attempt++) assert.equal((await login(attempt % 2 ? first : second, { password: "incorrect" })).status, attempt === 5 ? 429 : 401);
  const locked = await login(second); assert.equal(locked.status, 429); assert.equal(locked.headers.get("retry-after"), "900");
  delete process.env.VERCEL;
  assert.equal((await login(first)).status, 426);
  process.env.VERCEL = "1";
  const foreign = await fetch(first + "/api/auth/login", { method: "POST", headers: { ...headers(), origin: "https://foreign.example.com" }, body: "{}" });
  assert.equal(foreign.status, 403);
});

test("Vercel cleanup uses persistent expiration checks and cron failures do not expose service details", async (t) => {
  configure(t);
  const now = Date.now();
  const raw = createMemoryDatabase({ systemAdmin: { security: { sessions: { expired: { expiresAt: now - 1 }, active: { expiresAt: now + 60_000 } }, loginLimits: { locked: { count: 5, resetAt: now + 60_000 } } } } });
  const { app } = createVercelRuntime({ services: servicesFor(raw), now: () => now, runCampaigns: async () => { throw new Error("private-service-detail"); } });
  const url = await serve(t, app), cronHeaders = { ...edge, authorization: `Bearer ${process.env.CRON_SECRET}` };
  assert.equal((await fetch(url + "/api/cron/security-cleanup", { headers: cronHeaders })).status, 200);
  assert.equal(raw.read("systemAdmin/security/sessions/expired"), null);
  assert.ok(raw.read("systemAdmin/security/sessions/active")); assert.ok(raw.read("systemAdmin/security/loginLimits/locked"));
  const failed = await fetch(url + "/api/cron/campaigns", { headers: cronHeaders });
  assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /private-service-detail/);
});

test("Vercel function fails closed for invalid environment and can recover on a later initialization", async (t) => {
  configure(t);
  const valid = process.env.CRON_SECRET; process.env.CRON_SECRET = "short";
  const { default: handler } = await import("../api/index.js");
  const url = await serve(t, handler);
  const unavailable = await fetch(url + "/api/health", { headers: edge });
  assert.equal(unavailable.status, 503); assert.doesNotMatch(await unavailable.text(), /CRON_SECRET|private|Firebase/);
  process.env.CRON_SECRET = valid;
  assert.equal((await fetch(url + "/api/health", { headers: edge })).status, 200);
  assert.equal((await fetch(url + "/api/auth/login", { method: "POST", headers: headers(), body: "{}" })).status, 400);
  assert.equal((await fetch(url + "/api/auth/login", { method: "POST", headers: headers(), body: "{" })).status, 400);
  assert.equal((await fetch(url + "/api/auth/login", { method: "POST", headers: headers(), body: JSON.stringify({ padding: "x".repeat(70_000) }) })).status, 413);
});

test("Vercel starts and authenticates without cron configuration or running background tasks", async (t) => {
  configure(t); delete process.env.CRON_SECRET;
  const raw = createMemoryDatabase(); let runs = 0;
  const { app } = createVercelRuntime({ services: servicesFor(raw), runCampaigns: async () => { runs++; } });
  const url = await serve(t, app);
  assert.equal((await fetch(url + "/api/health", { headers: edge })).status, 200);
  for (const path of ["campaigns", "security-cleanup"]) assert.equal((await fetch(url + "/api/cron/" + path, { headers: edge })).status, 404);
  assert.equal((await login(url)).status, 200);
  assert.equal(runs, 0);
});
