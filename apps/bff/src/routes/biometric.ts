import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { roleGuard } from "../middleware/role-guard";
import { auditAction } from "../middleware/audit";
import { supabase } from "../services/supabase";
import { getFingerprintSDK } from "../services/fingerprint/index";
import type { HonoVariables } from "../types/hono";

export const biometricRoutes = new Hono<{ Variables: HonoVariables }>();

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

    if (!result) return c.json({ found: false }, 404);

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, matricula, nome_completo, posto, turma, foto_url, registration_status")
      .eq("id", result.userId)
      .single();

    return c.json({ found: true, score: result.score, profile });
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
    const sdk = await getFingerprintSDK();

    const template = await sdk.capture(fingerIndex);

    const { error } = await supabase.from("biometric_templates").upsert(
      {
        user_id: userId,
        template_data: template.data,
        finger_index: fingerIndex,
        registered_by: masterId,
      },
      { onConflict: "user_id,finger_index" }
    );

    if (error) return c.json({ error: "Failed to save template" }, 500);

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
