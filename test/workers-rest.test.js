import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { createRestDatabase } from "../server/workers/database-rest.js";
import { createGoogleTokenProvider } from "../server/workers/google-auth.js";
import { createRestMessaging } from "../server/workers/messaging-rest.js";
import { createMemoryDatabase } from "./FirebaseMemory.js";
import { createDatabaseAuthStore } from "../server/auth-store.js";
import { createPlanDatabase } from "../server/subscriptions/PlanDatabase.js";
import { createAdminAuth } from "../server/auth.js";
import express from "express";
import { buildCampaignMessage, processScheduledCampaigns } from "../server/notification-campaign.js";

const transportFor = (initial = {}) => {
  const raw = createMemoryDatabase(initial), calls = [];
  const etag = (value) => `"${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}"`;
  const transport = { raw, calls, beforePut: null, fetcher: async (input, options = {}) => {
    const url = new URL(input), path = decodeURIComponent(url.pathname.slice(1, -5)), headers = new Headers(options.headers);
    assert.equal(headers.get("authorization"), "Bearer offline-service-token");
    assert.ok(!url.search.includes("offline-service-token"));
    calls.push({ path, method: options.method, query: url.searchParams, body: options.body, headers });
    let value = raw.read(path);
    if (options.method === "GET") {
      if (url.searchParams.has("orderBy")) {
        const field = JSON.parse(url.searchParams.get("orderBy"));
        const pairs = Object.entries(value || {}).filter(([, item]) => {
          const selected = field.split("/").reduce((node, key) => node?.[key], item);
          return ["startAt", "endAt", "equalTo"].every((parameter) => {
            if (!url.searchParams.has(parameter)) return true;
            const bound = JSON.parse(url.searchParams.get(parameter));
            return parameter === "startAt" ? selected >= bound : parameter === "endAt" ? selected <= bound : selected === bound;
          });
        });
        value = Object.fromEntries(pairs.slice(0, url.searchParams.has("limitToFirst") ? Number(url.searchParams.get("limitToFirst")) : undefined));
      }
      return Response.json(value, { headers: { etag: etag(value) } });
    }
    if (options.method === "PUT") {
      await transport.beforePut?.(path);
      value = raw.read(path);
      if (headers.has("if-match") && headers.get("if-match") !== etag(value)) return Response.json(value, { status: 412, headers: { etag: etag(value) } });
      const next = JSON.parse(options.body); raw.write(path, next); return Response.json(next);
    }
    if (options.method === "PATCH") { await raw.ref(path).update(JSON.parse(options.body)); return Response.json(JSON.parse(options.body)); }
    if (options.method === "DELETE") { await raw.ref(path).remove(); return Response.json(null); }
    throw new Error("Unexpected method");
  } };
  transport.db = createRestDatabase({ databaseURL: "https://offline-test.firebasedatabase.app", getToken: async () => "offline-service-token", fetcher: transport.fetcher });
  return transport;
};

test("REST preserves omitted root arguments and commits multi-location updates in one PATCH", async () => {
  const { db, raw, calls } = transportFor({ shops: { main: { basicInfo: { name: "Tên cũ" }, usage: 4 } } });
  assert.throws(() => db.ref(""));
  assert.throws(() => db.ref("shops/bad.name"));
  assert.throws(() => createRestDatabase({ databaseURL: "https://evil.example", getToken: async () => "" }));
  await db.ref().update({ "shops/main/basicInfo/name": "Tên mới", "shops/main/package": "plus" });
  assert.equal(calls.length, 1); assert.equal(calls[0].method, "PATCH");
  assert.equal(raw.read("shops/main/basicInfo/name"), "Tên mới"); assert.equal(raw.read("shops/main/usage"), 4);
  assert.equal((await db.ref("shops/main").once("value")).exists(), true);
});

test("conditional transaction retries ETag conflicts with the latest value and aborts without writes", async () => {
  const transport = transportFor({ counter: 1 });
  let conflict = true;
  transport.beforePut = () => { if (conflict) { transport.raw.write("counter", 9); conflict = false; } };
  const result = await transport.db.ref("counter").transaction((value) => value + 1);
  assert.equal(result.committed, true); assert.equal(result.snapshot.val(), 10);
  assert.equal(transport.calls.filter((call) => call.method === "PUT").length, 2);
  const before = transport.calls.length;
  const aborted = await transport.db.ref("counter").transaction(() => undefined);
  assert.equal(aborted.committed, false); assert.equal(aborted.snapshot.val(), 10);
  assert.equal(transport.calls.length, before + 1);
});

test("REST refuses invalid values before an atomic update can partially drop fields", async () => {
  const { db, calls, raw } = transportFor({ original: 7 });
  for (const invalid of [undefined, NaN, Infinity]) await assert.rejects(db.ref().update({ original: 8, nested: { invalid } }), /Invalid database value/);
  assert.equal(calls.length, 0); assert.equal(raw.read("original"), 7);
  const missingEtag = createRestDatabase({ databaseURL: "https://offline-test.firebasedatabase.app", getToken: async () => "offline", fetcher: async () => Response.json(1) });
  await assert.rejects(missingEtag.ref("counter").transaction((value) => value + 1), /ETag/);
});

test("REST queries encode values and security cleanup retains active sessions and lockouts", async () => {
  const now = Date.now();
  const { db, raw, calls } = transportFor({ systemAdmin: { security: { sessions: { old: { expiresAt: now - 1 }, active: { expiresAt: now + 5000 } }, loginLimits: { locked: { count: 5, resetAt: now + 1000 } } } } });
  await createDatabaseAuthStore(db).cleanup(now);
  assert.equal(raw.read("systemAdmin/security/sessions/old"), null);
  assert.ok(raw.read("systemAdmin/security/sessions/active")); assert.ok(raw.read("systemAdmin/security/loginLimits/locked"));
  assert.equal(calls[0].query.get("orderBy"), '"expiresAt"'); assert.equal(calls[0].query.get("endAt"), String(now));
});

test("plan wrapper retains quota enforcement and mirrored user updates over REST", async () => {
  const { db: rawRest, raw } = transportFor({ shops: { main: {
    basicInfo: { name: "Test" }, license: { plan: "lite", expiredAt: "2099-01-01", isActive: true }, subscriptionRootID: "main", subscriptionBranches: { main: true }, subscriptionUsageStartedAt: Date.now(), personnelPins: { owner: { role: "owner" } }
  } } });
  const db = createPlanDatabase(rawRest);
  for (const username of ["staff01", "staff02"]) await db.ref().update({ [`shops/main/personnelPins/${username}`]: { role: "cashier" }, [`users/${username}/shops/main`]: { role: "cashier" } });
  await assert.rejects(db.ref().update({ "shops/main/personnelPins/staff03": { role: "cashier" } }), { code: "PLAN_USERS_LIMIT" });
  assert.equal(raw.read("shops/main/personnelPins/staff03"), null);
  assert.equal(raw.read("users/staff01/shops/main/role"), "cashier");
});

test("account lock remains atomic across concurrent REST clients", async (t) => {
  process.env.ADMIN_USERNAME = "rest-test-admin"; process.env.ADMIN_PASSWORD = "rest-test-credential"; process.env.ADMIN_SESSION_SECRET = "rest-test-session-secret-over-32-characters";
  const transport = transportFor();
  const app = express(); app.use(express.json()); app.use("/auth", createAdminAuth({ store: createDatabaseAuthStore(transport.db) }).router);
  const server = app.listen(0, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const url = `http://127.0.0.1:${server.address().port}/auth/login`;
  const responses = await Promise.all(Array.from({ length: 8 }, () => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "rest-test-admin", password: "wrong" }) })));
  assert.equal(responses.filter((response) => response.status === 401).length, 4); assert.equal(responses.filter((response) => response.status === 429).length, 4);
  assert.ok(Object.values(transport.raw.read("systemAdmin/security/loginLimits")).every((limit) => limit.count === 5));
});

test("service OAuth signs RS256 assertions, caches access tokens and refreshes before expiry", async () => {
  const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  let timestamp = Date.now(), calls = 0;
  const getToken = createGoogleTokenProvider({ email: "offline@example.test", privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }), scope: "offline-scope", now: () => timestamp, fetcher: async (url, options) => {
    calls++; assert.equal(url, "https://oauth2.googleapis.com/token");
    const assertion = options.body.get("assertion"), parts = assertion.split(".");
    assert.equal(crypto.verify("RSA-SHA256", Buffer.from(parts.slice(0, 2).join(".")), pair.publicKey, Buffer.from(parts[2], "base64url")), true);
    const claims = JSON.parse(Buffer.from(parts[1], "base64url")); assert.equal(claims.scope, "offline-scope"); assert.equal(claims.iss, "offline@example.test");
    return Response.json({ access_token: "offline-token", expires_in: 3600 });
  } });
  assert.equal(await getToken(), "offline-token"); await getToken(); assert.equal(calls, 1);
  timestamp += 3_550_000; await getToken(); assert.equal(calls, 2);
});

test("messaging REST maps Android and APNS payloads and reports per-device failures", async () => {
  const message = buildCampaignMessage({ title: "Thử", body: "Nội dung", imageUrl: "https://example.test/image.png" });
  const messaging = createRestMessaging({ projectId: "offline-project", getToken: async () => "offline-token", fetcher: async (url, options) => {
    const { message: payload } = JSON.parse(options.body);
    assert.equal(payload.android.notification.channel_id, "poso_notifications_v2"); assert.equal(payload.android.priority, "HIGH");
    assert.equal(payload.apns.payload.aps["mutable-content"], 1); assert.equal(payload.apns.fcm_options.image, "https://example.test/image.png");
    assert.equal(payload.notification.image, "https://example.test/image.png");
    return payload.token === "good" ? Response.json({ name: "sent-id" }) : Response.json({ error: { details: [{ errorCode: "UNREGISTERED" }] } }, { status: 404 });
  } });
  const result = await messaging.sendEachForMulticast({ ...message, tokens: ["good", "invalid"] });
  assert.equal(result.successCount, 1); assert.equal(result.failureCount, 1); assert.equal(result.responses[1].error.code, "messaging/registration-token-not-registered");
});

test("scheduled campaigns claim and finish through REST transactions without a resident process", async () => {
  const now = Date.now(); const transport = transportFor({ users: { owner: { notificationTokens: { fcmToken: "offline-device" } } }, systemAdmin: { notificationCampaigns: { scheduled: { title: "Thử", body: "Nội dung", target: { type: "all" }, status: "scheduled", scheduledAt: new Date(now - 1000).toISOString() } } } });
  let sends = 0;
  const messaging = { sendEachForMulticast: async () => { sends++; return { successCount: 1, failureCount: 0, responses: [{ success: true }] }; } };
  await processScheduledCampaigns({ db: transport.db, messaging, now });
  await processScheduledCampaigns({ db: transport.db, messaging, now });
  assert.equal(sends, 1); assert.equal(transport.raw.read("systemAdmin/notificationCampaigns/scheduled/status"), "sent");
});
