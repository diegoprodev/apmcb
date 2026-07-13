import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { generateSecret, generateSync, verifySync } from "otplib";
import { getIronSession } from "iron-session";
import { roleGuard } from "../middleware/role-guard";
import { supabase } from "../services/supabase";
import { sessionOptions, type SessionData } from "../lib/session";
import { encryptSecret, decryptSecret } from "../lib/crypto";
import { logger, maskMatricula } from "../lib/logger";
import type { HonoVariables } from "../types/hono";

// Erros de decrypt/chave nunca podem ser engolidos sem log — sem isso um 422
// de TOTP em produção é indiagnosticável (incidente 2026-07-07, matrícula 000003).
function logSecretFailure(event: string, err: unknown, ctx: Record<string, unknown>) {
  logger.error(event, { ...ctx, error: err instanceof Error ? err.message : String(err) });
}

// Re-exported so lendings.ts can reuse without duplicating the TOTP logic
export async function checkTotpForMatricula(
  matricula: string,
  tenantId: string,
  token: string,
  actorId: string,
): Promise<
  | { ok: true; profile: { id: string; nome_completo: string; matricula: string; posto: string | null; foto_url: string | null } }
  | { ok: false; status: 404 | 422 | 429 | 401; error: string; retry_after_seconds?: number }
> {
  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("id, nome_completo, matricula, posto, foto_url")
    .eq("matricula", matricula)
    .maybeSingle();

  if (profErr || !profile) {
    return { ok: false, status: 404, error: "Credenciais inválidas" };
  }

  // profiles has no tenant_id column — verify tenant via tenant_memberships
  const { data: tenantCheck } = await supabase
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("user_id", profile.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!tenantCheck) {
    return { ok: false, status: 404, error: "Credenciais inválidas" };
  }

  const { data, error } = await supabase
    .from("totp_secrets")
    .select("id, secret, failure_count, last_failure_at, last_used_token")
    .eq("user_id", profile.id)
    .eq("enabled", true)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, status: 422, error: "Militar sem TOTP configurado — use modo manual" };
  }

  if (data.failure_count >= RATE_LIMIT_MAX && data.last_failure_at) {
    const elapsed = Date.now() - new Date(data.last_failure_at).getTime();
    if (elapsed < RATE_LIMIT_WINDOW_MS) {
      const retry_after_seconds = Math.ceil((RATE_LIMIT_WINDOW_MS - elapsed) / 1000);
      return { ok: false, status: 429, error: "Credenciais inválidas", retry_after_seconds };
    }
  }

  let plainSecret: string;
  try {
    plainSecret = await readSecret(data.secret);
  } catch (err) {
    logSecretFailure("totp.identify.read_secret_failure", err, { military_id: profile.id, actor_id: actorId });
    return { ok: false, status: 422, error: "TOTP secret inválido. Militar deve reconfigurar o autenticador." };
  }
  const { valid: isValid } = verifySync({ secret: plainSecret, token, afterTimeStep: 1 });

  if (isValid) {
    if (data.last_used_token === token) {
      return { ok: false, status: 401, error: "Credenciais inválidas" };
    }
    await supabase.from("totp_secrets").update({
      failure_count: 0, last_failure_at: null,
      last_validated_at: new Date().toISOString(), last_used_token: token,
    }).eq("id", data.id);

    await supabase.from("audit_logs").insert({
      actor_id: actorId, action: "totp.identify.success",
      resource_type: "totp_secrets", resource_id: data.id,
      metadata: { matricula, tenant_id: tenantId },
    });

    return { ok: true, profile };
  }

  const newCount = (data.failure_count || 0) + 1;
  await supabase.from("totp_secrets").update({
    failure_count: newCount, last_failure_at: new Date().toISOString(),
  }).eq("id", data.id);

  await supabase.from("audit_logs").insert({
    actor_id: actorId, action: "totp.identify.failure",
    resource_type: "totp_secrets", resource_id: data.id,
    metadata: { matricula, attempt: newCount },
  });
  logger.warn("totp.identify.failure", { matricula: maskMatricula(matricula), attempt: newCount });

  return { ok: false, status: 401, error: "Credenciais inválidas" };
}

export const totpRoutes = new Hono<{ Variables: HonoVariables }>();

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const TOTP_PERIOD = 30;

// Chave de encriptação — obrigatória em produção (Fail Fast)
const TOTP_KEY = process.env.TOTP_ENCRYPTION_KEY;
if (!TOTP_KEY && process.env.NODE_ENV === "production") {
  throw new Error("TOTP_ENCRYPTION_KEY env var obrigatória em produção");
}

export async function readSecret(raw: string): Promise<string> {
  if (!raw.startsWith("v1:")) return raw; // plaintext secret — always OK
  if (!TOTP_KEY) throw new Error("TOTP_SECRET_ENCRYPTED_BUT_NO_KEY");
  try {
    return await decryptSecret(raw, TOTP_KEY);
  } catch (err) {
    logSecretFailure("totp.decrypt.failure", err, {});
    throw new Error("TOTP_SECRET_INVALID");
  }
}

async function writeSecret(plaintext: string): Promise<string> {
  return TOTP_KEY ? encryptSecret(plaintext, TOTP_KEY) : plaintext;
}

// ── GET /api/totp/status ──────────────────────────────────────
// Returns whether the current user has TOTP configured.
// Safe for all roles — does NOT expose the secret.
totpRoutes.get("/status", async (c) => {
  const userId = c.get("userId");
  const { data } = await supabase
    .from("totp_secrets")
    .select("id")
    .eq("user_id", userId)
    .eq("enabled", true)
    .maybeSingle();
  return c.json({ configured: data !== null });
});

// ── POST /api/totp/setup ──────────────────────────────────────
// Initialises TOTP for the current military user.
// Idempotent: if already configured, returns ok without regenerating the secret.
totpRoutes.post("/setup", roleGuard("usuario", "armeiro", "admin_global", "admin_reserva"), async (c) => {
  const userId = c.get("userId");

  // Check if already exists
  const { data: existing } = await supabase
    .from("totp_secrets")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) return c.json({ ok: true, already_configured: true });

  const secret = await writeSecret(generateSecret({ length: 20 }));

  const { error } = await supabase.from("totp_secrets").insert({
    user_id: userId,
    secret,
  });

  if (error) {
    // Unique constraint: another concurrent request already created it
    if (error.code === "23505") {
      await supabase.from("profiles").update({ totp_configured: true }).eq("id", userId);
      return c.json({ ok: true, already_configured: true });
    }
    c.get("log").error({ code: error.code, error: error.message }, "totp.setup.persist_failure");
    return c.json({ error: "Não foi possível configurar o código de acesso. Tente novamente." }, 500);
  }

  await supabase.from("profiles").update({ totp_configured: true }).eq("id", userId);
  c.get("log").info({ userId }, "totp.setup.confirm");

  // Notify the user (fire-and-forget — don't block the response)
  supabase.from("notifications").insert({
    user_id: userId,
    type: "totp_configured",
    title: "Código de acesso configurado ✓",
    body: "Seu código TOTP foi configurado. Você já pode requisitar materiais pela Reserva de Armamento.",
  }).then(() => {});

  return c.json({ ok: true }, 201);
});

// ── POST /api/totp/reconfigure ────────────────────────────────
// Regenera o secret TOTP do próprio usuário da sessão. Único caminho de
// recuperação quando o secret está corrompido ou foi encriptado com chave
// divergente (/code retorna 422 needs_reconfigure) — /setup é idempotente
// e nunca regenera.
//
// Restrito ao caso needs_reconfigure real: exige que o secret ATUAL falhe
// em readSecret(). Sem essa checagem, qualquer sessão poderia usar este
// endpoint para zerar failure_count/last_used_token e contornar o rate
// limit de tentativas (o secret válido nunca é o problema, então nunca
// deveria ser motivo para reconfigurar).
totpRoutes.post("/reconfigure", roleGuard("usuario", "armeiro", "admin_global", "admin_reserva"), async (c) => {
  const userId = c.get("userId");

  const { data: existing, error: fetchError } = await supabase
    .from("totp_secrets")
    .select("id, secret, enabled")
    .eq("user_id", userId)
    .maybeSingle();

  if (fetchError) {
    logger.error("totp.reconfigure.fetch_failure", { user_id: userId, error: fetchError.message });
    return c.json({ error: "Falha ao reconfigurar o autenticador" }, 500);
  }

  if (existing) {
    try {
      await readSecret(existing.secret);
      // Secret atual é válido — reconfigurar não é o remédio certo aqui.
      return c.json({ error: "Autenticador já está configurado corretamente." }, 409);
    } catch {
      // Esperado: secret corrompido/chave divergente — segue para regenerar.
    }
  }

  const secret = await writeSecret(generateSecret({ length: 20 }));

  const { error } = await supabase.from("totp_secrets").upsert(
    {
      user_id: userId,
      secret,
      enabled: existing?.enabled ?? true,
      failure_count: 0,
      last_failure_at: null,
      last_used_token: null,
    },
    { onConflict: "user_id" }
  );

  if (error) {
    logger.error("totp.reconfigure.failure", { user_id: userId, error: error.message });
    return c.json({ error: "Falha ao reconfigurar o autenticador" }, 500);
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ totp_configured: true })
    .eq("id", userId);
  if (profileError) {
    logger.error("totp.reconfigure.profile_update_failure", { user_id: userId, error: profileError.message });
  }

  const { error: auditError } = await supabase.from("audit_logs").insert({
    actor_id: userId,
    action: "totp.reconfigure",
    resource_type: "totp_secrets",
    resource_id: null,
    metadata: { user_id: userId },
  });
  if (auditError) {
    logger.error("totp.reconfigure.audit_failure", { user_id: userId, error: auditError.message });
  }

  supabase.from("notifications").insert({
    user_id: userId,
    type: "totp_configured",
    title: "Autenticador reconfigurado",
    body: "Seu código TOTP foi reconfigurado. Se você não fez essa ação, contate o administrador.",
  }).then(() => {});

  return c.json({ ok: true });
});

// ── GET /api/totp/code ────────────────────────────────────────
// Returns the current 6-digit TOTP code and seconds remaining in the period.
// Secret NEVER leaves the server — client only receives the computed code.
totpRoutes.get("/code", async (c) => {
  const userId = c.get("userId");

  const { data, error } = await supabase
    .from("totp_secrets")
    .select("secret, failure_count, last_failure_at")
    .eq("user_id", userId)
    .eq("enabled", true)
    .maybeSingle();

  if (error || !data) {
    return c.json({ error: "TOTP not configured. Call POST /api/totp/setup first." }, 404);
  }

  // Check rate limit (lockout based on excessive validation failures)
  if (data.failure_count >= RATE_LIMIT_MAX && data.last_failure_at) {
    const elapsed = Date.now() - new Date(data.last_failure_at).getTime();
    if (elapsed < RATE_LIMIT_WINDOW_MS) {
      const retryAfterSec = Math.ceil((RATE_LIMIT_WINDOW_MS - elapsed) / 1000);
      return c.json(
        { error: "Conta bloqueada por tentativas excessivas. Tente novamente mais tarde.", retry_after_seconds: retryAfterSec },
        429
      );
    }
  }

  const epochSec = Math.floor(Date.now() / 1000);
  const secondsRemaining = TOTP_PERIOD - (epochSec % TOTP_PERIOD);
  let plainSecret: string;
  let code: string;
  try {
    plainSecret = await readSecret(data.secret);
    code = generateSync({ secret: plainSecret });
  } catch (err) {
    // 422: dado corrompido ou chave de encriptação divergente — usuário precisa reconfigurar
    logSecretFailure("totp.code.read_secret_failure", err, { user_id: userId });
    return c.json({ error: "Autenticador inválido. Acesse 'Meu Perfil' e configure o TOTP novamente.", needs_reconfigure: true }, 422);
  }

  return c.json({ code, seconds_remaining: secondsRemaining, period: 30 });
});

// ── POST /api/totp/validate ───────────────────────────────────
// Validates a TOTP token for a given military_id.
// Only callable by Reserva de Armamento (master) or admin.
// Rate-limited: 5 failed attempts per military_id per 15 minutes.
totpRoutes.post(
  "/validate",
  roleGuard("armeiro", "admin_global", "admin_reserva"),
  zValidator(
    "json",
    z.object({
      military_id: z.string().uuid(),
      token: z.string().length(6).regex(/^\d{6}$/),
    })
  ),
  async (c) => {
    const reserva_id = c.get("userId");
    const { military_id, token } = c.req.valid("json");

    const { data, error } = await supabase
      .from("totp_secrets")
      .select("id, secret, failure_count, last_failure_at, last_used_token")
      .eq("user_id", military_id)
      .eq("enabled", true)
      .maybeSingle();

    if (error || !data) {
      return c.json({ error: "Militar não possui TOTP configurado." }, 404);
    }

    // Rate limit check
    if (data.failure_count >= RATE_LIMIT_MAX && data.last_failure_at) {
      const elapsed = Date.now() - new Date(data.last_failure_at).getTime();
      if (elapsed < RATE_LIMIT_WINDOW_MS) {
        const retryAfterSec = Math.ceil((RATE_LIMIT_WINDOW_MS - elapsed) / 1000);
        c.get("log").warn({ military_id, actor_id: reserva_id, retryAfterSec }, "totp.validate.locked");
        return c.json(
          { error: "Militar bloqueado por tentativas excessivas.", retry_after_seconds: retryAfterSec },
          429
        );
      }
    }

    let plainSecret: string;
    try {
      plainSecret = await readSecret(data.secret);
    } catch (err) {
      logSecretFailure("totp.validate.read_secret_failure", err, { military_id, actor_id: reserva_id });
      return c.json({ error: "TOTP inválido. O militar precisa reconfigurar o autenticador.", needs_reconfigure: true }, 422);
    }
    const { valid: isValid } = verifySync({ secret: plainSecret, token, afterTimeStep: 1 });

    if (isValid) {
      // Anti-replay: reject if this exact code was already used in this period
      if (data.last_used_token === token) {
        return c.json({ valid: false, error: "Código já utilizado neste período." });
      }

      // Reset failure counter + record last validation + store used token
      await supabase
        .from("totp_secrets")
        .update({
          failure_count: 0,
          last_failure_at: null,
          last_validated_at: new Date().toISOString(),
          last_used_token: token,
        })
        .eq("id", data.id);

      // Fetch military name for UX
      const { data: profile } = await supabase
        .from("profiles")
        .select("nome_completo, posto, matricula")
        .eq("id", military_id)
        .maybeSingle();

      await supabase.from("audit_logs").insert({
        actor_id: reserva_id,
        action: "totp.validado",
        resource_type: "totp_secrets",
        resource_id: data.id,
        metadata: { military_id, success: true },
      });
      c.get("log").info({ military_id, actor_id: reserva_id }, "totp.validate.success");

      return c.json({
        valid: true,
        military_nome: profile?.nome_completo,
        military_posto: profile?.posto,
        military_matricula: profile?.matricula,
      });
    }

    // Failed: increment counter
    const newCount = (data.failure_count || 0) + 1;
    await supabase
      .from("totp_secrets")
      .update({ failure_count: newCount, last_failure_at: new Date().toISOString() })
      .eq("id", data.id);

    await supabase.from("audit_logs").insert({
      actor_id: reserva_id,
      action: "totp.falhou",
      resource_type: "totp_secrets",
      resource_id: data.id,
      metadata: { military_id, attempt: newCount },
    });
    c.get("log").warn({ military_id, actor_id: reserva_id, attempt: newCount }, "totp.validate.failure");

    return c.json({ valid: false });
  }
);

// ── POST /api/totp/self-validate ─────────────────────────────
// Validates the current admin's own TOTP token (nexus step-2 authentication).
// On success, stamps nexusAuthorized on the iron-session (TTL 2h).
totpRoutes.post(
  "/self-validate",
  roleGuard("admin_global", "superadmin"),
  zValidator("json", z.object({ token: z.string().length(6).regex(/^\d{6}$/) })),
  async (c) => {
    const userId = c.get("userId");
    const { token } = c.req.valid("json");

    const { data, error } = await supabase
      .from("totp_secrets")
      .select("id, secret, failure_count, last_failure_at, last_used_token")
      .eq("user_id", userId)
      .eq("enabled", true)
      .maybeSingle();

    if (error || !data) {
      return c.json({ error: "TOTP não configurado. Configure em /admin primeiro." }, 404);
    }

    // Rate limit check
    if (data.failure_count >= RATE_LIMIT_MAX && data.last_failure_at) {
      const elapsed = Date.now() - new Date(data.last_failure_at).getTime();
      if (elapsed < RATE_LIMIT_WINDOW_MS) {
        const retryAfterSec = Math.ceil((RATE_LIMIT_WINDOW_MS - elapsed) / 1000);
        return c.json(
          { error: "Bloqueado por tentativas excessivas.", retry_after_seconds: retryAfterSec },
          429
        );
      }
    }

    let plainSecret: string;
    try {
      plainSecret = await readSecret(data.secret);
    } catch (err) {
      logSecretFailure("totp.self_validate.read_secret_failure", err, { user_id: userId });
      return c.json({ error: "TOTP inválido. O militar precisa reconfigurar o autenticador.", needs_reconfigure: true }, 422);
    }
    const { valid: isValid } = verifySync({ secret: plainSecret, token, afterTimeStep: 1 });

    if (isValid) {
      if (data.last_used_token === token) {
        return c.json({ valid: false, error: "Código já utilizado neste período." });
      }

      await supabase
        .from("totp_secrets")
        .update({
          failure_count: 0,
          last_failure_at: null,
          last_validated_at: new Date().toISOString(),
          last_used_token: token,
        })
        .eq("id", data.id);

      // Stamp nexus authorization on session
      const session = await getIronSession<SessionData>(c.req.raw, c.res, sessionOptions);
      session.nexusAuthorized = true;
      session.nexusAuthorizedAt = Date.now();
      await session.save();

      await supabase.from("audit_logs").insert({
        actor_id: userId,
        action: "nexus.login",
        resource_type: "nexus",
        resource_id: null,
        metadata: { success: true },
      });

      return c.json({ valid: true });
    }

    // Failed
    const newCount = (data.failure_count || 0) + 1;
    await supabase
      .from("totp_secrets")
      .update({ failure_count: newCount, last_failure_at: new Date().toISOString() })
      .eq("id", data.id);

    await supabase.from("audit_logs").insert({
      actor_id: userId,
      action: "nexus.login_failed",
      resource_type: "nexus",
      resource_id: null,
      metadata: { attempt: newCount },
    });

    return c.json({ valid: false });
  }
);

// ── POST /api/totp/identify ───────────────────────────────────
// Identity-first: armeiro informa matrícula + TOTP do militar.
// Persiste pendingIdentity na iron-session (TTL 2min verificado no bulk-return).
totpRoutes.post(
  "/identify",
  roleGuard("armeiro", "admin_global", "admin_reserva"),
  zValidator("json", z.object({
    matricula: z.string().min(1).max(20),
    code: z.string().length(6).regex(/^\d{6}$/),
  })),
  async (c) => {
    const actorId = c.get("userId");
    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json({ error: "Tenant não identificado" }, 400);

    const { matricula, code } = c.req.valid("json");
    const result = await checkTotpForMatricula(matricula, tenantId, code, actorId);

    if (!result.ok) {
      return c.json({ error: result.error, retry_after_seconds: result.retry_after_seconds }, result.status);
    }

    // Busca lendings ativos do militar identificado
    const { data: activeLendings } = await supabase
      .from("lendings")
      .select("id, quantidade, issued_at, movement_id, material_type:material_types(nome, categoria)")
      .eq("military_id", result.profile.id)
      .eq("tenant_id", tenantId)
      .eq("status_legacy", "ativo")
      .order("issued_at", { ascending: false });

    // Persiste pendingIdentity na sessão para uso no bulk-return
    const session = await getIronSession<SessionData>(c.req.raw, c.res, sessionOptions);
    session.pendingIdentity = {
      profile_id: result.profile.id,
      tenant_id: tenantId,
      identified_at: Date.now(),
      auth_mode: "totp",
    };
    await session.save();

    return c.json({ profile: result.profile, active_lendings: activeLendings ?? [] });
  }
);

// ── POST /api/totp/admin-provision ───────────────────────────
// Provisions TOTP for a given military user without requiring them to be logged in.
// Only callable by admin or master (armeiro). Used at registration time.
totpRoutes.post(
  "/admin-provision",
  roleGuard("admin_global", "armeiro", "admin_reserva"),
  zValidator("json", z.object({ user_id: z.string().uuid() })),
  async (c) => {
    const actorId = c.get("userId");
    const { user_id } = c.req.valid("json");

    const { data: existing } = await supabase
      .from("totp_secrets")
      .select("id")
      .eq("user_id", user_id)
      .maybeSingle();

    if (existing) {
      await supabase.from("profiles").update({ totp_configured: true }).eq("id", user_id);
      return c.json({ ok: true, already_configured: true });
    }

    const secret = await writeSecret(generateSecret({ length: 20 }));

    const { error } = await supabase.from("totp_secrets").insert({ user_id, secret });

    if (error) {
      if (error.code === "23505") {
        await supabase.from("profiles").update({ totp_configured: true }).eq("id", user_id);
        return c.json({ ok: true, already_configured: true });
      }
      return c.json({ error: "Failed to provision TOTP" }, 500);
    }

    await supabase.from("profiles").update({ totp_configured: true }).eq("id", user_id);

    await supabase.from("audit_logs").insert({
      actor_id: actorId,
      action: "totp.provisionado",
      resource_type: "totp_secrets",
      resource_id: user_id,
      metadata: { provisioned_for: user_id },
    });

    return c.json({ ok: true }, 201);
  }
);
