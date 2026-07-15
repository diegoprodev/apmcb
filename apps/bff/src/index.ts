import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { authMiddleware } from "./middleware/auth";
import { routeRateLimiter } from "./middleware/rate-limit";
import { csrfMiddleware } from "./middleware/csrf";
import { requestIdMiddleware } from "./middleware/request-id";
import { accessLogMiddleware } from "./middleware/access-log";
import { authRoutes } from "./routes/auth";
import { lendingRoutes } from "./routes/lendings";
import { dashboardRoutes } from "./routes/dashboard";
import { biometricRoutes } from "./routes/biometric";
import { biometricSimulatorRoutes } from "./routes/biometric-simulator";
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
import { saidasRoutes } from "./routes/saidas";
import { categoriesRoutes } from "./routes/categories";
import { handoversRoutes } from "./routes/handovers";
import { shiftsRoutes } from "./routes/shifts";
import { inventoryRoutes, inventoryPublicRoutes } from "./routes/inventory";
import { usuarioRoutes } from "./routes/usuario";
import { reservesRoutes } from "./routes/reserves";
import { sessionRoutes } from "./routes/session";
import { realtimeRoutes } from "./routes/realtime";
import { publicRoutes } from "./routes/public";
import { logger as structuredLogger } from "./lib/logger";
import type { HonoVariables } from "./types/hono";

const app = new Hono<{ Variables: HonoVariables }>();

app.use("*", requestIdMiddleware);
app.use("*", accessLogMiddleware);
// secureHeaders() com os defaults do Hono — protege qualquer acesso direto
// ao BFF que não passe pelo nginx (dev local em localhost:3001, misconfig).
// Em produção, nginx (sempre na frente — ver infra/nginx/) usa
// proxy_hide_header para remover X-Frame-Options/Strict-Transport-Security/
// Referrer-Policy da resposta do BFF ANTES de adicionar sua própria versão
// via add_header — evita os headers duplicados com valor divergente (achado
// durante investigação do incidente de 502/CORS em POST /api/session/mode)
// sem deixar o BFF "nu" quando acessado sem nginx na frente.
app.use("*", secureHeaders());
app.use("/api/*", bodyLimit({ maxSize: 2 * 1024 * 1024 })); // 2MB max
app.use("/api/*", csrfMiddleware);
// CORS: env var obrigatória em produção — sem domínios hardcoded (SSOT)
const allowedOrigins: string[] = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
  : process.env.NODE_ENV === "production"
    ? (() => { throw new Error("CORS_ORIGINS env var obrigatória em produção"); })()
    : [process.env.WEB_URL ?? "http://localhost:3000"];

app.use(
  "*",
  cors({
    origin: allowedOrigins,
    credentials: true,
    exposeHeaders: ["X-Request-Id"],
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

// ── GET /api/public/branding?tenant=slug ─────────────────────────
// Rota PÚBLICA — sem auth — retorna branding visual do tenant para login page
app.get("/api/public/branding", async (c) => {
  const slug = c.req.query("tenant");
  if (!slug) return c.json({ error: "tenant obrigatório" }, 400);

  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: tenant } = await sb
    .from("tenants")
    .select("id, nome, slug")
    .eq("slug", slug)
    .eq("status", "ativo")
    .single();

  if (!tenant) {
    return c.json({
      primary_hex: "#1B3A8C",
      secondary_hex: "#3b82f6",
      tenant_logo_url: null,
      name: null,
    });
  }

  const { data: branding } = await sb
    .from("tenant_branding")
    .select("primary_hex, secondary_hex, tenant_logo_url")
    .eq("tenant_id", tenant.id)
    .single();

  return c.json({
    primary_hex: branding?.primary_hex ?? "#1B3A8C",
    secondary_hex: branding?.secondary_hex ?? "#3b82f6",
    tenant_logo_url: branding?.tenant_logo_url ?? null,
    name: tenant.nome,
    slug: tenant.slug,
  });
});

app.route("/api/public", publicRoutes);

app.route("/api/lendings", lendingRoutes);
app.route("/api/dashboard", dashboardRoutes);
app.route("/api/biometric", biometricRoutes);
if (process.env.NODE_ENV !== "production" && process.env.BIOMETRIC_SIMULATOR_ENABLED === "true") {
  app.route("/api/biometric/simulator", biometricSimulatorRoutes);
}
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
app.use("/api/saidas/*", authMiddleware);
app.route("/api/saidas", saidasRoutes);
app.use("/api/categories/*", authMiddleware);
app.route("/api/categories", categoriesRoutes);
// GET /:id/verify é público (scan de QR code impresso no PDF, sem login) —
// mesmo padrão de exclusão usado em /api/inventory/verify/* logo abaixo.
// Match ancorado em método + formato exato do path (não um endsWith solto)
// para que uma rota futura sob /api/handovers/* cujo path termine em
// "/verify" não herde acesso público por acidente (achado de code review).
const HANDOVER_VERIFY_PATH = /^\/api\/handovers\/[^/]+\/verify$/;
app.use("/api/handovers/*", async (c, next) => {
  if (c.req.method === "GET" && HANDOVER_VERIFY_PATH.test(c.req.path)) {
    await next();
    return;
  }
  return authMiddleware(c, next);
});
app.route("/api/handovers", handoversRoutes);
app.use("/api/shifts/*", authMiddleware);
app.route("/api/shifts", shiftsRoutes);
app.route("/api/inventory", inventoryPublicRoutes);
app.use("/api/usuario/*", authMiddleware);
app.route("/api/usuario", usuarioRoutes);
app.use("/api/reserves/*", authMiddleware);
app.route("/api/reserves", reservesRoutes);
app.use("/api/session/*", authMiddleware);
app.route("/api/session", sessionRoutes);
app.use("/api/realtime/*", authMiddleware);
app.route("/api/realtime", realtimeRoutes);

app.use("/api/inventory/*", async (c, next) => {
  if (c.req.path.startsWith("/api/inventory/verify/")) {
    await next();
    return;
  }
  return authMiddleware(c, next);
});
app.route("/api/inventory", inventoryRoutes);

app.onError((err, c) => {
  // Propaga CORS para respostas de erro — sem isso, erros de middleware
  // (CSRF 403, auth 401) chegam ao browser como CORS error em vez do status real.
  const origin = c.req.header("Origin");
  if (origin && allowedOrigins.includes(origin)) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Access-Control-Allow-Credentials", "true");
    c.header("Vary", "Origin");
  }
  // c.get("log") é um pino.Logger nativo — convenção (mergingObject, msg),
  // diferente do wrapper de compat structuredLogger (msg, data) usado como
  // fallback quando o erro ocorre antes do requestIdMiddleware rodar.
  const requestId = c.get("requestId");
  const childLog = c.get("log");
  if (err instanceof HTTPException) {
    if (childLog) childLog.warn({ status: err.status, message: err.message, path: c.req.path }, "http.exception");
    else structuredLogger.warn("http.exception", { status: err.status, message: err.message, path: c.req.path });
    return c.json({ error: err.message, ...(requestId ? { requestId } : {}) }, err.status);
  }
  const errData = {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    path: c.req.path,
  };
  if (childLog) childLog.error(errData, "http.unhandled_error");
  else structuredLogger.error("http.unhandled_error", errData);
  return c.json({ error: "Internal server error", ...(requestId ? { requestId } : {}) }, 500);
});

const port = Number(process.env.PORT ?? 3001);
structuredLogger.info("bff_start", { port, env: process.env.NODE_ENV ?? "production" });

export default { port, fetch: app.fetch };
