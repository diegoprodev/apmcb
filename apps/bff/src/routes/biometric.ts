import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { roleGuard } from "../middleware/role-guard";
import { auditAction } from "../middleware/audit";
import { supabase } from "../services/supabase";
import { getFingerprintSDK } from "../services/fingerprint/index";
import { logger } from "../lib/logger";
import type { HonoVariables } from "../types/hono";

export const biometricRoutes = new Hono<{ Variables: HonoVariables }>();

const BIOMETRIC_MIN_SCORE = parseFloat(process.env.BIOMETRIC_MIN_SCORE ?? "0.92");

biometricRoutes.post(
  "/identify",
  roleGuard("admin_global", "armeiro", "admin_reserva"),
  auditAction("biometric.identify", "biometric_templates"),
  async (c) => {
    const sdk = await getFingerprintSDK();
    const captured = await sdk.capture(1);

    const { data: templates } = await supabase
      .from("biometric_templates")
      .select("user_id, template_data");

    const result = await sdk.identify(
      captured.data,
      (templates ?? []).map((t) => ({
        userId: t.user_id,
        templateData: Buffer.from(t.template_data),
      }))
    );

    if (!result || result.score < BIOMETRIC_MIN_SCORE) {
      c.get("log").warn({ matched: false, candidates: templates?.length ?? 0 }, "biometric.match.failure");
      return c.json({ found: false, score: result?.score ?? 0, threshold: BIOMETRIC_MIN_SCORE }, 404);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, matricula, nome_completo, posto, turma, foto_url, registration_status")
      .eq("id", result.userId)
      .single();
    c.get("log").info({ matched: true, candidates: templates?.length ?? 0 }, "biometric.match.success");

    return c.json({ found: true, score: result.score, threshold: BIOMETRIC_MIN_SCORE, profile });
  }
);

biometricRoutes.post(
  "/register",
  roleGuard("admin_global", "armeiro", "admin_reserva"),
  zValidator(
    "json",
    z.object({
      userId: z.string().uuid(),
      fingerIndex: z.number().int().min(1).max(10),
    })
  ),
  auditAction("biometric.register", "biometric_templates"),
  async (c) => {
    const { userId, fingerIndex } = c.req.valid("json");
    const masterId = c.get("userId");
    const role = c.get("role");
    const tenantId = c.get("tenantId");

    // Privilege ceiling: armeiro can only register their own biometrics
    if (role === "armeiro" && userId !== masterId) {
      return c.json({ error: "Acesso negado: armeiro só pode registrar a própria biometria" }, 403);
    }

    // Cross-tenant guard: admin_reserva/admin_global só registram biometria
    // de usuários do próprio tenant (service_role ignora RLS — validar aqui).
    if (role !== "armeiro" && tenantId) {
      const { data: membership } = await supabase
        .from("tenant_memberships")
        .select("tenant_id")
        .eq("user_id", userId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!membership) {
        return c.json({ error: "Acesso negado: usuário não pertence ao seu tenant" }, 403);
      }
    }

    let template: import("../services/fingerprint/interface").FingerprintTemplate;
    try {
      const sdk = await getFingerprintSDK();
      template = await sdk.capture(fingerIndex);
    } catch (err) {
      logger.error("biometric.register.sdk_failure", {
        user_id: userId,
        actor_id: masterId,
        error: err instanceof Error ? err.message : String(err),
      });
      return c.json({ error: "Leitor biométrico indisponível. Verifique a conexão do dispositivo." }, 503);
    }

    const { error } = await supabase.from("biometric_templates").upsert(
      {
        user_id: userId,
        template_data: template.data,
        finger_index: fingerIndex,
        registered_by: masterId,
      },
      { onConflict: "user_id,finger_index" }
    );

    if (error) {
      c.get("log").error({ code: error.code, error: error.message, userId }, "biometric.register.persist_failure");
      return c.json({ error: "Não foi possível salvar o cadastro biométrico. Tente novamente." }, 500);
    }

    await supabase
      .from("profiles")
      .update({ registration_status: "complete" })
      .eq("id", userId);

    await supabase.from("notifications").insert({
      user_id: userId,
      type: "biometric_registered",
      title: "Biometria registrada",
      body: "Seu cadastro biométrico foi concluído com sucesso.",
    });

    return c.json({ ok: true, quality: template.quality });
  }
);
