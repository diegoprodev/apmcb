import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { authMiddleware } from "./middleware/auth";
import { routeRateLimiter } from "./middleware/rate-limit";
import { csrfMiddleware } from "./middleware/csrf";
import { authRoutes } from "./routes/auth";
import { lendingRoutes } from "./routes/lendings";
import { dashboardRoutes } from "./routes/dashboard";
import { biometricRoutes } from "./routes/biometric";
import { notificationRoutes } from "./routes/notifications";
import { pushRoutes } from "./routes/push";
import { totpRoutes } from "./routes/totp";
import { ssaRoutes } from "./routes/ssa";
import { arsenalRoutes } from "./routes/arsenal";
import { ocorrenciasRoutes } from "./routes/ocorrencias";
import { profileRoutes } from "./routes/profiles";
import { nexusRoutes } from "./routes/nexus";
import { adminRoutes } from "./routes/admin";
import { signatureRoutes, signatureVerifyRoutes } from "./routes/signatures";
import { cautelamentosRoutes } from "./routes/cautelamentos";
import type { HonoVariables } from "./types/hono";

const app = new Hono<{ Variables: HonoVariables }>();

app.use("*", logger());
app.use("*", secureHeaders());
app.use("/api/*", bodyLimit({ maxSize: 2 * 1024 * 1024 })); // 2MB max
app.use("/api/*", csrfMiddleware);
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

app.use("/api/*", routeRateLimiter);

// Auth routes do NOT require authMiddleware
app.route("/api/auth", authRoutes);

// All other /api/* routes require authentication
app.use("/api/lendings/*", authMiddleware);
app.use("/api/dashboard/*", authMiddleware);
app.use("/api/biometric/*", authMiddleware);
app.use("/api/notifications/*", authMiddleware);
app.use("/api/totp/*", authMiddleware);
app.use("/api/ssa/*", authMiddleware);
app.use("/api/arsenal/*", authMiddleware);
app.use("/api/ocorrencias/*", authMiddleware);
app.use("/api/profiles/*", authMiddleware);
app.use("/api/nexus/*", authMiddleware);
app.use("/api/admin/*", authMiddleware);
app.use("/api/signatures/*", authMiddleware);
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
app.route("/api/arsenal", arsenalRoutes);
app.route("/api/ocorrencias", ocorrenciasRoutes);
app.route("/api/profiles", profileRoutes);
app.route("/api/nexus", nexusRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/signatures", signatureRoutes);
app.route("/api/verify", signatureVerifyRoutes);
app.use("/api/cautelamentos/*", authMiddleware);
app.route("/api/cautelamentos", cautelamentosRoutes);

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
