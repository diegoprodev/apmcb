import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { HTTPException } from "hono/http-exception";
import { authMiddleware } from "./middleware/auth";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { lendingRoutes } from "./routes/lendings";
import { dashboardRoutes } from "./routes/dashboard";
import { biometricRoutes } from "./routes/biometric";
import type { HonoVariables } from "./types/hono";

const app = new Hono<{ Variables: HonoVariables }>();

app.use("*", logger());
app.use("*", secureHeaders());
app.use(
  "*",
  cors({
    origin: [
      process.env.WEB_URL ?? "http://localhost:3000",
      "https://apmcb.pages.dev",
    ],
    credentials: true,
  })
);

app.use("/api/*", rateLimitMiddleware);
app.use("/api/*", authMiddleware);

app.get("/health", (c) =>
  c.json({ ok: true, ts: new Date().toISOString(), service: "apmcb-bff" })
);

app.route("/api/lendings", lendingRoutes);
app.route("/api/dashboard", dashboardRoutes);
app.route("/api/biometric", biometricRoutes);

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
