import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createAuthRouter, requireAdmin } from "../server/auth.js";

const startTestServer = async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", createAuthRouter());
  app.get("/protected", requireAdmin, (req, res) => res.json({ username: req.adminUser.username }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
};

test("đăng nhập bằng tài khoản env và dùng cookie HttpOnly", async (t) => {
  process.env.ADMIN_USERNAME = "test-admin";
  process.env.ADMIN_PASSWORD = "test-password";
  process.env.ADMIN_SESSION_SECRET = "test-session-secret-with-more-than-32-characters";
  const { server, url } = await startTestServer();
  t.after(() => server.close());

  const login = await fetch(`${url}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "test-admin", password: "test-password" })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /poso_admin_session=/);
  assert.match(cookie, /HttpOnly/);

  const protectedResponse = await fetch(`${url}/protected`, { headers: { Cookie: cookie } });
  assert.equal(protectedResponse.status, 200);
  assert.equal((await protectedResponse.json()).username, "test-admin");
});

test("từ chối mật khẩu env không đúng", async (t) => {
  process.env.ADMIN_USERNAME = "test-admin";
  process.env.ADMIN_PASSWORD = "correct-password";
  process.env.ADMIN_SESSION_SECRET = "test-session-secret-with-more-than-32-characters";
  const { server, url } = await startTestServer();
  t.after(() => server.close());

  const response = await fetch(`${url}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "test-admin", password: "wrong-password" })
  });
  assert.equal(response.status, 401);
});
