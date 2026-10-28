import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminRouter } from "./admin-router.js";
import { createAdminAuth, authConfigured } from "./auth.js";
import { createDatabaseAuthStore } from "./auth-store.js";
import { applySecurity } from "./security.js";

export const createApp = ({ services = {}, authStore, serveFrontend = true, prepareRequest } = {}) => {
  const app = express();
  if (prepareRequest) app.use(prepareRequest);
  applySecurity(app);
  app.use(express.json({ limit: "64kb" }));
  const auth = createAdminAuth({ store: authStore || (services.securityDb ? createDatabaseAuthStore(services.securityDb) : undefined) });
  if (process.env.NODE_ENV === "production" && !authStore && !services.securityDb) throw new Error("Shared authentication storage is required in production.");
  app.use("/api/auth", auth.router);
  app.get("/api/health", (req, res) => {
    const ok = Boolean(services.db) && authConfigured();
    res.status(ok ? 200 : 503).json({ ok, timestamp: new Date().toISOString() });
  });
  app.use("/api/admin", services.db
    ? createAdminRouter({ ...services, authenticate: auth.requireAdmin })
    : [auth.requireAdmin, (req, res) => res.status(503).json({ message: "Dịch vụ dữ liệu tạm thời chưa sẵn sàng." })]);
  app.use("/api", (req, res) => res.status(404).json({ message: "Không tìm thấy API." }));
  if (process.env.NODE_ENV === "production" && serveFrontend) {
    const dist = fileURLToPath(new URL("../dist", import.meta.url));
    app.use(express.static(dist, { dotfiles: "deny" }));
    app.get("*", (req, res) => res.sendFile(path.join(dist, "index.html")));
  }
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.type === "entity.too.large" ? 413 : error.status === 400 || error instanceof URIError ? 400 : 500;
    if (status === 500) console.error("Request failed:", error);
    res.status(status).json({ message: status === 413 ? "Nội dung yêu cầu quá lớn." : status === 400 ? "Nội dung yêu cầu không hợp lệ." : "Lỗi máy chủ không xác định." });
  });
  return { app, auth };
};
