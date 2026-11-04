import crypto from "node:crypto";
import { isIP } from "node:net";
import express from "express";
import { createApp } from "./app.js";
import { assertProductionConfig } from "./security.js";
import { createWorkerServices as createServerlessServices } from "./workers/services.js";
import { processScheduledCampaigns } from "./notification-campaign.js";

export const configureVercelEnvironment = () => {
  process.env.NODE_ENV = "production";
  // A trusted Vercel system variable supplies the stable production domain.
  // Never construct the allowed origin from visitor-controlled Host headers.
  if (!process.env.ADMIN_ORIGIN && process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    process.env.ADMIN_ORIGIN = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  assertProductionConfig({ databaseConfigured: ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY", "FIREBASE_DATABASE_URL"].every((key) => Boolean(process.env[key])) });
  const secret = process.env.CRON_SECRET || "";
  if (secret && (secret.length < 32 || new Set(secret).size < 12 || [process.env.ADMIN_PASSWORD, process.env.ADMIN_SESSION_SECRET].includes(secret))) {
    throw new Error("CRON_SECRET must be an independent random secret of at least 32 characters.");
  }
};

const digest = (value) => crypto.createHash("sha256").update(value).digest();
export const createVercelCronRouter = ({ services, auth, now = Date.now, runCampaigns = processScheduledCampaigns }) => {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    const secret = process.env.CRON_SECRET || "";
    if (secret.length < 32) return res.status(503).json({ message: "Tác vụ theo lịch chưa được cấu hình." });
    if (!crypto.timingSafeEqual(digest(req.get("authorization") || ""), digest(`Bearer ${secret}`))) return res.status(401).json({ message: "Yêu cầu không được xác thực." });
    if (req.method !== "GET") return res.set("Allow", "GET").status(405).json({ message: "Phương thức không được hỗ trợ." });
    next();
  });
  const run = (task) => async (req, res) => {
    try {
      const result = await task(now());
      res.json({ ok: true, ...(Array.isArray(result) ? { processed: result.length } : {}) });
    } catch (error) {
      console.error("Scheduled task failed:", error.code || "SCHEDULED_TASK_FAILED");
      res.status(503).json({ message: "Tác vụ theo lịch tạm thời chưa hoàn tất." });
    }
  };
  router.get("/campaigns", run((timestamp) => runCampaigns({ ...services, now: timestamp })));
  router.get("/security-cleanup", run((timestamp) => auth.store.cleanup(timestamp)));
  return router;
};

export const prepareVercelRequest = (req, res, next) => {
  // Only use edge headers inside the Vercel runtime. Express itself keeps
  // trust proxy disabled; arbitrary local forwarded headers have no authority.
  if (process.env.VERCEL === "1") {
    const protocol = req.get("x-forwarded-proto") === "https" ? "https" : "http";
    const candidate = req.get("x-forwarded-for") || "";
    const ip = isIP(candidate) ? candidate : "unknown";
    Object.defineProperties(req, {
      secure: { get: () => protocol === "https" },
      protocol: { get: () => protocol },
      ip: { get: () => ip }
    });
  }
  next();
};

export const createVercelRuntime = (options = {}) => {
  configureVercelEnvironment();
  const services = options.services || createServerlessServices(process.env);
  return createApp({
    services: { ...services, adminReadOptions: { concurrency: 16, storeConcurrency: 8 } },
    serveFrontend: false, prepareRequest: prepareVercelRequest,
    registerRoutes(app, { auth }) {
      if (process.env.CRON_SECRET) app.use("/api/cron", createVercelCronRouter({ services, auth, now: options.now, runCampaigns: options.runCampaigns }));
    }
  });
};
