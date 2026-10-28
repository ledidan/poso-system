import helmet from "helmet";
import { BlockList, isIP } from "node:net";
import { authConfigured } from "./auth.js";

export const trustedProxies = () => {
  const value = process.env.TRUST_PROXY?.trim();
  if (!value) return false;
  const entries = value.split(",").map((part) => part.trim());
  for (const entry of entries) {
    const [address, prefix, ...extra] = entry.split("/");
    const family = isIP(address);
    if (!family || extra.length || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) > (family === 4 ? 32 : 128)))) {
      throw new Error("TRUST_PROXY must contain explicit trusted IP addresses or CIDRs.");
    }
    const list = new BlockList();
    if (prefix === undefined) list.addAddress(address, family === 4 ? "ipv4" : "ipv6");
    else list.addSubnet(address, Number(prefix), family === 4 ? "ipv4" : "ipv6");
    if (prefix !== undefined && Number(prefix) === 0) throw new Error("TRUST_PROXY cannot trust the entire internet.");
  }
  return entries;
};

export const assertProductionConfig = ({ databaseConfigured }) => {
  trustedProxies();
  if (process.env.NODE_ENV !== "production") return;
  const password = process.env.ADMIN_PASSWORD || "";
  const secret = process.env.ADMIN_SESSION_SECRET || "";
  if (!authConfigured() || password.length < 16 || /change.this|your.strong|password|replace.with|your.random/i.test(password + secret) || new Set(secret).size < 12) {
    throw new Error("Production requires an admin username, a unique password (at least 16 characters), and a random session secret (at least 32 characters).");
  }
  let origin;
  try { origin = new URL(process.env.ADMIN_ORIGIN); } catch { /* Validated below. */ }
  if (!origin || origin.protocol !== "https:" || origin.origin !== process.env.ADMIN_ORIGIN) {
    throw new Error("ADMIN_ORIGIN must be the exact public HTTPS origin in production.");
  }
  if (!databaseConfigured) throw new Error("Production requires a configured shared database for login limits and sessions.");
};

export const applySecurity = (app) => {
  const production = process.env.NODE_ENV === "production";
  app.disable("x-powered-by");
  app.set("trust proxy", trustedProxies());
  app.use(helmet({
    contentSecurityPolicy: production ? { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'"], styleSrcAttr: ["'unsafe-inline'"], fontSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"], connectSrc: ["'self'"],
      objectSrc: ["'none'"], frameAncestors: ["'none'"], formAction: ["'self'"], baseUri: ["'self'"]
    } } : false,
    strictTransportSecurity: production ? { maxAge: 31536000, includeSubDomains: false } : false,
    referrerPolicy: { policy: "no-referrer" }
  }));
  app.use((req, res, next) => {
    if (production && !req.secure && req.path !== "/api/health") {
      return res.status(426).json({ message: "Kết nối an toàn HTTPS là bắt buộc." });
    }
    return next();
  });
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    // The custom header cannot be added by an HTML form or a cross-origin fetch
    // without a successful CORS preflight; this server never grants CORS access.
    const expectedOrigin = process.env.ADMIN_ORIGIN || `${req.protocol}://${req.get("host")}`;
    const origin = req.get("origin");
    const fetchSite = req.get("sec-fetch-site");
    if ((origin && origin !== expectedOrigin) || (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") || req.get("x-requested-with") !== "POSO-Admin") {
      return res.status(403).json({ message: "Yêu cầu không hợp lệ. Vui lòng tải lại trang và thử lại." });
    }
    if (!/^application\/json(?:\s*;|$)/i.test(req.get("content-type") || "")) return res.status(415).json({ message: "Yêu cầu phải dùng định dạng JSON." });
    return next();
  });
};
