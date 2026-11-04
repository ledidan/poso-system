import express from "express";
import { createVercelRuntime } from "../server/vercel.js";

let runtime;
// Export an Express application so Vercel leaves request body parsing to
// express.json(), including its 64 kB limit and malformed-JSON handling.
const app = express();
app.disable("x-powered-by");
app.use((req, res) => {
  try {
    runtime ||= createVercelRuntime();
    return runtime.app(req, res);
  } catch (error) {
    console.error("Server initialization failed:", error.message);
    res.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ message: "Dịch vụ tạm thời chưa sẵn sàng. Vui lòng kiểm tra cấu hình triển khai." }));
  }
});
export default app;
