import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createAuthRouter } from "../server/auth.js";
import bcrypt from "bcryptjs";
import { createAdminRouter } from "../server/admin-router.js";

const createFixture = () => {
  const memberships = {
    shopA: { personnelID: "person-a", personnelName: "Tên tại A", role: "Admin", isActive: false, permissions: { refund: true } },
    shopB: { personnelID: "person-b", personnelName: "Tên tại B", role: "Thu ngân", isActive: true }
  };
  return {
    users: {
      unassigned: { password: "previous-hash", notificationTokens: { fcmToken: "test-device-token" } },
      assigned: { password: "previous-hash", shops: structuredClone(memberships) }
    },
    shops: Object.fromEntries(Object.entries(memberships).map(([id, membership]) => [id, {
      personnelPins: { assigned: structuredClone(membership) }
    }]))
  };
};

const startTestServer = async (t) => {
  process.env.ADMIN_SESSION_SECRET = "user-test-session-secret-over-32-characters";
  process.env.ADMIN_USERNAME = "test-admin";
  process.env.ADMIN_PASSWORD = "test-admin-password";
  const state = createFixture();
  const writes = [];
  const db = {
    ref(path = "") {
      return {
        once: async () => {
          const value = path.split("/").filter(Boolean).reduce((current, key) => current?.[key], state);
          return { exists: () => value !== undefined && value !== null, val: () => structuredClone(value) };
        },
        update: async (updates) => {
          writes.push(structuredClone(updates));
          for (const [key, value] of Object.entries(updates)) {
            const parts = `${path}/${key}`.split("/").filter(Boolean);
            const leaf = parts.pop();
            const parent = parts.reduce((current, part) => current[part] ||= {}, state);
            if (value === null) delete parent[leaf];
            else parent[leaf] = structuredClone(value);
          }
        }
      };
    }
  };
  const app = express();
  app.use(express.json());
  app.use("/api/auth", createAuthRouter());
  app.use("/api/admin", createAdminRouter({ db }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const login = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const request = (path, body, { authenticated = true, method = "PATCH" } = {}) => fetch(
    `http://127.0.0.1:${server.address().port}/api/admin${path}`,
    {
      method,
      headers: { "Content-Type": "application/json", ...(authenticated ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body)
    }
  );
  return { state, writes, request };
};

test("password-only update works without a name or any store assignment", async (t) => {
  const { state, writes, request } = await startTestServer(t);
  const before = structuredClone(state);
  const response = await request("/users/unassigned", { password: "test-new-password" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { username: "unassigned" });
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0]), ["users/unassigned/password"]);
  assert.ok(await bcrypt.compare("test-new-password", state.users.unassigned.password));
  before.users.unassigned.password = state.users.unassigned.password;
  assert.deepEqual(state, before);
});

test("password-only update preserves names, roles, inactive status, and both store mirrors", async (t) => {
  const { state, writes, request } = await startTestServer(t);
  const before = structuredClone(state);
  const response = await request("/users/assigned", { password: "test-new-password" });
  assert.equal(response.status, 200);
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0]), ["users/assigned/password"]);
  assert.ok(await bcrypt.compare("test-new-password", state.users.assigned.password));
  before.users.assigned.password = state.users.assigned.password;
  assert.deepEqual(state, before);
});

test("short passwords and empty updates are rejected without database writes", async (t) => {
  const { state, writes, request } = await startTestServer(t);
  const before = structuredClone(state);
  for (const body of [{ password: "12345" }, { password: "" }, {}]) {
    const response = await request("/users/assigned", body);
    assert.equal(response.status, 400);
  }
  assert.deepEqual(writes, []);
  assert.deepEqual(state, before);
});

test("password changes still require admin authentication and an existing valid username", async (t) => {
  const { writes, request } = await startTestServer(t);
  const body = { password: "test-new-password" };
  assert.equal((await request("/users/assigned", body, { authenticated: false })).status, 401);
  assert.equal((await request("/users/missing-user", body)).status, 404);
  assert.equal((await request("/users/invalid.name", body)).status, 400);
  assert.deepEqual(writes, []);
});

test("explicit store assignment updates still synchronize both mirrors", async (t) => {
  const { state, writes, request } = await startTestServer(t);
  const response = await request("/users/assigned", {
    name: "Tên mới", storeIds: ["shopB", "shopC"], role: "Quản lý", isActive: false
  });
  assert.equal(response.status, 200);
  assert.equal(writes.length, 1);
  assert.equal(state.users.assigned.password, "previous-hash");
  assert.equal(state.users.assigned.shops.shopA, undefined);
  assert.equal(state.shops.shopA.personnelPins.assigned, undefined);
  for (const shopId of ["shopB", "shopC"]) {
    const membership = state.users.assigned.shops[shopId];
    assert.deepEqual(membership, state.shops[shopId].personnelPins.assigned);
    assert.equal(membership.personnelName, "Tên mới");
    assert.equal(membership.role, "Quản lý");
    assert.equal(membership.isActive, false);
    assert.ok(membership.personnelID);
  }
});

test("invalid explicit store lists cannot clear existing access during a password change", async (t) => {
  const { writes, request } = await startTestServer(t);
  for (const storeIds of [[], null, "shopA"]) {
    const response = await request("/users/assigned", { password: "test-new-password", storeIds });
    assert.equal(response.status, 400);
  }
  assert.deepEqual(writes, []);
});

test("creating a user still requires a store and a password of at least six characters", async (t) => {
  const { writes, request } = await startTestServer(t);
  for (const body of [
    { username: "new-user", password: "test-new-password" },
    { username: "new-user", password: "12345", storeIds: ["shopA"] }
  ]) {
    const response = await request("/users", body, { method: "POST" });
    assert.equal(response.status, 400);
  }
  assert.deepEqual(writes, []);
});
