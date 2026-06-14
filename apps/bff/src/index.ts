import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { HTTPException } from "hono/http-exception";
import { authMiddleware } from "./middleware/auth";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { authRoutes } from "./routes/auth";
import { lendingRoutes } from "./routes/lendings";
import { dashboardRoutes } from "./routes/dashboard";
import { biometricRoutes } from "./routes/biometric";
import { notificationRoutes } from "./routes/notifications";
import { pushRoutes } from "./routes/push";
import { totpRoutes } from "./routes/totp";
import { ssaRoutes } from "./routes/ssa";
import type { HonoVariables } from "./types/hono";

const app = new Hono<{ Variables: HonoVariables }>();

app.use("*", logger());
app.use("*", secureHeaders());
const defaultOrigins = [
  process.env.WEB_URL ?? "http://localhost:3000",
  "https://apmcb.pages.dev",
  "https://apmcb.pmpb.online",
];
const extraOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim())
  : [];
const allowedOrigins = [...new Set([...defaultOrigins, ...extraOrigins])];

app.use(
  "*",
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

app.use("/api/*", rateLimitMiddleware);

// Auth routes do NOT require authMiddleware
app.route("/api/auth", authRoutes);

// All other /api/* routes require authentication
app.use("/api/lendings/*", authMiddleware);
app.use("/api/dashboard/*", authMiddleware);
app.use("/api/biometric/*", authMiddleware);
app.use("/api/notifications/*", authMiddleware);
app.use("/api/totp/*", authMiddleware);
app.use("/api/ssa/*", authMiddleware);
// Push broadcast is internal-only: protected by a shared secret header
app.use("/api/push/broadcast", async (c, next) => {
  const secret = c.req.header("x-internal-secret");
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    return c.json({ error: "Forbidden" }, 403);
  }
  await next();
});

app.get("/health", (c) =>
  c.json({ ok: true, ts: new Date().toISOString(), service: "apmcb-bff" })
);

app.route("/api/lendings", lendingRoutes);
app.route("/api/dashboard", dashboardRoutes);
app.route("/api/biometric", biometricRoutes);
app.route("/api/notifications", notificationRoutes);
app.route("/api/push", pushRoutes);
app.route("/api/totp", totpRoutes);
app.route("/api/ssa", ssaRoutes);

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

const port = Number(process.env.PORT ?? 3001);
console.log(`BFF running on http://0.0.0.0:${port}`);

export default { port, fetch: app.fetch };
