import { createServer } from "node:http";
import { httpServerHandler } from "cloudflare:node";
import { env } from "cloudflare:workers";
import { createApp } from "./app.js";
import { assertProductionConfig } from "./security.js";
import { createWorkerServices } from "./workers/services.js";
import { processScheduledCampaigns } from "./notification-campaign.js";

let runtime;
const getRuntime = () => {
  if (runtime) return runtime;
  assertProductionConfig({ databaseConfigured: Boolean(env.FIREBASE_DATABASE_URL && env.FIREBASE_PRIVATE_KEY && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PROJECT_ID) });
  const services = createWorkerServices(env);
  const { app, auth } = createApp({ services, serveFrontend: false, prepareRequest(req, res, next) {
    // Only the fetch handler below can supply these values; visitor copies are overwritten.
    Object.defineProperties(req, {
      secure: { get: () => req.headers["x-poso-edge-protocol"] === "https" },
      protocol: { get: () => req.headers["x-poso-edge-protocol"] || "http" },
      ip: { get: () => req.headers["x-poso-edge-ip"] || "unknown" }
    });
    next();
  } });
  runtime = { app, auth, services };
  return runtime;
};
createServer((req, res) => {
  try { getRuntime().app(req, res); }
  catch (error) {
    console.error("Worker initialization failed:", error.message);
    res.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ message: "Dịch vụ tạm thời chưa sẵn sàng. Vui lòng kiểm tra cấu hình triển khai." }));
  }
}).listen(4100);
const bridge = httpServerHandler({ port: 4100 });
const staticHeaders = {
  "Content-Security-Policy": "default-src 'self';script-src 'self';script-src-attr 'none';style-src 'self';style-src-attr 'unsafe-inline';font-src 'self';img-src 'self' data: https:;connect-src 'self';object-src 'none';frame-ancestors 'none';form-action 'self';base-uri 'self';upgrade-insecure-requests",
  "Strict-Transport-Security": "max-age=31536000", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer"
};
export default {
  async fetch(request, bindings, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const headers = new Headers(request.headers);
      headers.set("x-poso-edge-protocol", url.protocol.slice(0, -1));
      headers.set("x-poso-edge-ip", request.headers.get("CF-Connecting-IP") || "unknown");
      headers.delete("x-forwarded-for"); headers.delete("x-forwarded-proto"); headers.delete("x-forwarded-host");
      return bridge.fetch(new Request(request, { headers }), bindings, ctx);
    }
    if (url.protocol !== "https:") return new Response("HTTPS is required.", { status: 426 });
    const response = await bindings.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(staticHeaders)) headers.set(key, value);
    if (headers.get("Content-Type")?.includes("text/html")) headers.set("Cache-Control", "no-cache");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
  async scheduled(controller, bindings, ctx) {
    const { services, auth } = getRuntime();
    await processScheduledCampaigns(services);
    if (Math.floor(controller.scheduledTime / 60_000) % 15 === 0) await auth.store.cleanup(controller.scheduledTime);
  }
};
