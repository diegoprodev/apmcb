import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { generateSecret, generateSync, verifySync } from "otplib";
import { roleGuard } from "../middleware/role-guard";
import { supabase } from "../services/supabase";
import type { HonoVariables } from "../types/hono";

export const totpRoutes = new Hono<{ Variables: HonoVariables }>();

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

const TOTP_PERIOD = 30;

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
totpRoutes.post("/setup", roleGuard("usuario"), async (c) => {
  const userId = c.get("userId");

  // Check if already exists
  const { data: existing } = await supabase
    .from("totp_secrets")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) return c.json({ ok: true, already_configured: true });

  const secret = generateSecret({ length: 20 }); // 160-bit Base32

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
    return c.json({ error: "Failed to configure TOTP" }, 500);
  }

  await supabase.from("profiles").update({ totp_configured: true }).eq("id", userId);

  // Notify the user (fire-and-forget — don't block the response)
  supabase.from("notifications").insert({
    user_id: userId,
    type: "totp_configured",
    title: "Código de acesso configurado ✓",
    body: "Seu código TOTP foi configurado. Você já pode requisitar materiais pela Reserva de Armamento.",
  }).then(() => {});

  return c.json({ ok: true }, 201);
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
  const code = generateSync({ secret: data.secret });

  return c.json({ code, seconds_remaining: secondsRemaining, period: 30 });
});

// ── POST /api/totp/validate ───────────────────────────────────
// Validates a TOTP token for a given military_id.
// Only callable by Reserva de Armamento (master) or admin.
// Rate-limited: 5 failed attempts per military_id per 15 minutes.
totpRoutes.post(
  "/validate",
  roleGuard("master", "admin"),
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
        return c.json(
          { error: "Militar bloqueado por tentativas excessivas.", retry_after_seconds: retryAfterSec },
          429
        );
      }
    }

    const { valid: isValid } = verifySync({ secret: data.secret, token, afterTimeStep: 1 });

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

    return c.json({ valid: false });
  }
);

// ── POST /api/totp/admin-provision ───────────────────────────
// Provisions TOTP for a given military user without requiring them to be logged in.
// Only callable by admin or master (armeiro). Used at registration time.
totpRoutes.post(
  "/admin-provision",
  roleGuard("admin", "master"),
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

    const secret = generateSecret({ length: 20 });

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
