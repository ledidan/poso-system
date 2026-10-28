import crypto from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { createMemoryAuthStore } from "./auth-store.js";

export const MAX_ATTEMPTS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
const SESSION_MS = 8 * 60 * 60 * 1000;
const COOKIE_NAME = "poso_admin_session";
const sessionSecret = () => process.env.ADMIN_SESSION_SECRET || "";
const configuredUsername = () => process.env.ADMIN_USERNAME || "";
const configuredPassword = () => process.env.ADMIN_PASSWORD || "";
const digest = (value) => crypto.createHash("sha256").update(String(value)).digest();
const safeEqual = (left, right) => crypto.timingSafeEqual(digest(left), digest(right));
const privateKey = (value) => crypto.createHmac("sha256", sessionSecret()).update(value).digest("hex");
const credentialVersion = () => privateKey(JSON.stringify([configuredUsername(), configuredPassword()]));
const cookieOptions = () => ({
  httpOnly: true, sameSite: "strict", path: "/",
  secure: process.env.NODE_ENV === "production" || process.env.ADMIN_COOKIE_SECURE === "true"
});
export const authConfigured = () => Boolean(configuredUsername() && configuredPassword() && sessionSecret().length >= 32);

const readToken = (req) => {
  const header = req.get("authorization") || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  const cookie = (req.headers.cookie || "").split(";").find((part) => part.trim().startsWith(`${COOKIE_NAME}=`));
  if (!cookie) return "";
  try { return decodeURIComponent(cookie.trim().slice(COOKIE_NAME.length + 1)); }
  catch { return ""; }
};
const verify = (token, now) => jwt.verify(token, sessionSecret(), {
  algorithms: ["HS256"], issuer: "poso-central-admin", audience: "poso-admin-web", clockTimestamp: Math.floor(now / 1000)
});
const unavailable = (res) => res.status(503).json({ message: "Dịch vụ đăng nhập tạm thời chưa sẵn sàng. Vui lòng thử lại sau." });

export const createAdminAuth = ({ store = createMemoryAuthStore(), now = Date.now } = {}) => {
  const router = express.Router();
  const requireAdmin = async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!authConfigured()) return unavailable(res);
    let payload;
    try {
      payload = verify(readToken(req), now());
      if (!/^[a-f0-9]{64}$/.test(payload.jti || "") || payload.username !== configuredUsername()) throw new Error("Invalid session");
    } catch {
      return res.status(401).json({ message: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại." });
    }
    try {
      const session = await store.getSession(payload.jti);
      if (!session || session.expiresAt <= now() || session.username !== payload.username || !safeEqual(session.credentials, credentialVersion())) {
        return res.status(401).json({ message: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại." });
      }
      req.adminUser = { username: payload.username, name: "Quản trị viên" };
      return next();
    } catch { return unavailable(res); }
  };

  const attempt = async (key, failed, timestamp) => {
    const result = await store.updateLimit(privateKey(key), (value) => {
      const current = value?.resetAt > timestamp ? value : { count: 0, resetAt: timestamp + LOCKOUT_MS };
      if (current.count >= MAX_ATTEMPTS) return undefined;
      if (!failed) return null;
      const count = current.count + 1;
      return { count, resetAt: count === MAX_ATTEMPTS ? timestamp + LOCKOUT_MS : current.resetAt };
    });
    return {
      blocked: !result.committed || result.value?.count >= MAX_ATTEMPTS,
      remaining: MAX_ATTEMPTS - (result.value?.count || 0),
      retryAfter: Math.max(1, Math.ceil(((result.value?.resetAt || timestamp + LOCKOUT_MS) - timestamp) / 1000))
    };
  };
  router.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  router.post("/login", async (req, res) => {
    if (!authConfigured()) return unavailable(res);
    const { username, password } = req.body || {};
    if (typeof username !== "string" || !username.length || username.length > 128 || typeof password !== "string" || !password.length || password.length > 1024) {
      return res.status(400).json({ message: "Thông tin đăng nhập không hợp lệ." });
    }
    const matchesUsername = safeEqual(username, configuredUsername());
    const matchesPassword = safeEqual(password, configuredPassword());
    const failed = !matchesUsername || !matchesPassword;
    const timestamp = now();
    try {
      // Account lock survives changing IPs; IP lock also limits invalid usernames.
      const limits = [];
      if (matchesUsername) limits.push(await attempt(`account:${configuredUsername()}`, failed, timestamp));
      limits.push(await attempt(`ip:${req.ip}`, failed, timestamp));
      const blocked = limits.filter((limit) => limit.blocked);
      if (blocked.length) {
        const retryAfter = Math.max(...blocked.map((limit) => limit.retryAfter));
        res.set("Retry-After", String(retryAfter));
        return res.status(429).json({ message: "Đăng nhập đã bị khóa do sai 5 lần. Vui lòng chờ hết thời gian khóa 15 phút.", retryAfter, attemptsRemaining: 0 });
      }
      if (failed) return res.status(401).json({ message: "Tên đăng nhập hoặc mật khẩu không đúng.", attemptsRemaining: Math.min(...limits.map((limit) => limit.remaining)) });
      const user = { username: configuredUsername(), name: "Quản trị viên" };
      const id = crypto.randomBytes(32).toString("hex");
      const token = jwt.sign({ ...user, iat: Math.floor(timestamp / 1000) }, sessionSecret(), {
        algorithm: "HS256", expiresIn: "8h", issuer: "poso-central-admin", audience: "poso-admin-web", jwtid: id
      });
      await store.saveSession(id, { username: user.username, credentials: credentialVersion(), expiresAt: timestamp + SESSION_MS });
      res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: SESSION_MS });
      return res.json({ user });
    } catch { return unavailable(res); }
  });
  router.get("/session", requireAdmin, (req, res) => res.json({ user: req.adminUser }));
  router.post("/logout", async (req, res) => {
    let payload;
    try { payload = verify(readToken(req), now()); } catch { /* Already expired or missing. */ }
    try {
      if (/^[a-f0-9]{64}$/.test(payload?.jti || "")) await store.deleteSession(payload.jti);
      res.clearCookie(COOKIE_NAME, cookieOptions());
      return res.status(204).end();
    } catch { return unavailable(res); }
  });
  return { router, requireAdmin, store };
};

// Both routers share the same app-scoped authority, including in isolated tests.
const authorities = new WeakMap();
export const createAuthRouter = (options) => {
  const auth = createAdminAuth(options);
  const router = express.Router();
  router.use((req, res, next) => { authorities.set(req.app, auth); next(); });
  router.use(auth.router);
  return router;
};
export const requireAdmin = (req, res, next) => {
  const auth = authorities.get(req.app);
  if (!auth) return res.status(401).json({ message: "Vui lòng đăng nhập." });
  return auth.requireAdmin(req, res, next);
};
