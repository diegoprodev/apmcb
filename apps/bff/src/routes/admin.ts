import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { roleGuard } from "../middleware/role-guard";
import { supabase } from "../services/supabase";
import type { HonoVariables } from "../types/hono";

export const adminRoutes = new Hono<{ Variables: HonoVariables }>();

// ─── POST /api/admin/militares ───────────────────────────────────────────────
// Cadastra um militar (cria auth.users + profiles) usando service role key.
adminRoutes.post(
  "/militares",
  roleGuard("admin_global", "superadmin", "admin_reserva", "armeiro"),
  zValidator("json", z.object({
    nome_completo:    z.string().min(1),
    matricula:        z.string().min(1),
    posto:            z.string().nullable().optional(),
    nome_de_guerra:   z.string().nullable().optional(),
    role:             z.string().optional(),
    unidade:          z.string().nullable().optional(),
    telefone:         z.string().nullable().optional(),
    foto_url:         z.string().url().nullable().optional(),
  })),
  async (c) => {
    const body      = c.req.valid("json");
    const callerRole = c.get("role");
    const tenantId  = c.get("tenantId");

    const userRole = body.role ?? "usuario";

    // Armeiro só pode cadastrar militares simples
    if ((callerRole === "armeiro" || callerRole === "admin_reserva") && userRole !== "usuario") {
      return c.json({ error: "Reserva de Armamento só pode cadastrar militares" }, 403);
    }

    const supabaseUrl  = process.env.SUPABASE_URL!;
    const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const internalEmail = `${body.matricula.toLowerCase().replace(/\W/g, "")}.interno@apmcb.sistema`;

    // Criar usuário auth via Admin API
    const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: internalEmail,
        email_confirm: true,
        user_metadata: { nome_completo: body.nome_completo, matricula: body.matricula, internal: true },
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.json() as { message?: string };
      return c.json({ error: err.message ?? "Erro ao criar usuário" }, 500);
    }

    const created = await createRes.json() as { id: string };
    const userId = created.id;

    const { error: profileError } = await supabase.from("profiles").upsert({
      id:                   userId,
      email:                null,
      nome_completo:        body.nome_completo,
      matricula:            body.matricula,
      posto:                body.posto ?? "cadete",
      role:                 userRole as "admin_global" | "armeiro" | "usuario",
      registration_status:  "pending_biometric",
      nome_de_guerra:       body.nome_de_guerra ?? null,
      unidade:              body.unidade ?? null,
      telefone:             body.telefone ?? null,
      foto_url:             body.foto_url ?? null,
    });

    if (profileError) {
      // Rollback: delete auth user
      await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
        method: "DELETE",
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      });
      return c.json({ error: profileError.message }, 500);
    }

    // Adicionar ao tenant se caller tiver tenantId
    if (tenantId) {
      await supabase.from("tenant_memberships").upsert({
        tenant_id: tenantId,
        user_id:   userId,
        role:      "member",
      }, { onConflict: "tenant_id,user_id" });
    }

    return c.json({ success: true, user_id: userId });
  }
);

// ─── POST /api/admin/upload-photo ────────────────────────────────────────────
// Upload de foto de perfil via BFF (usa service role para bypass do RLS de Storage).
adminRoutes.post(
  "/upload-photo",
  roleGuard("admin_global", "superadmin", "admin_reserva", "armeiro"),
  async (c) => {
    const supabaseUrl = process.env.SUPABASE_URL!;
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.json({ error: "Formato inválido — envie multipart/form-data" }, 400);
    }

    const file = formData.get("file") as File | null;
    const path = formData.get("path") as string | null;

    if (!file || !path) {
      return c.json({ error: "file e path são obrigatórios" }, 400);
    }

    const buffer = await file.arrayBuffer();

    const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/profile-photos/${path}`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": file.type || "image/jpeg",
        "x-upsert": "true",
      },
      body: buffer,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.json() as { message?: string; error?: string };
      return c.json({ error: err.message ?? err.error ?? "Erro no upload" }, 500);
    }

    const publicUrl = `${supabaseUrl}/storage/v1/object/public/profile-photos/${path}`;
    return c.json({ url: publicUrl });
  }
);

// ─── GET /api/admin/estrutura ────────────────────────────────────────────────
// Returns tenant structure (org_units + reserves) for the admin's tenant.
// Requires regular session auth (not nexus).
adminRoutes.get(
  "/estrutura",
  roleGuard("admin_global", "superadmin"),
  async (c) => {
    const tenantId = c.get("tenantId");

    if (!tenantId) {
      return c.json({ error: "tenant não encontrado na sessão" }, 400);
    }

    const [tenantRes, orgRes, reserveRes] = await Promise.all([
      supabase
        .from("tenants")
        .select("id, nome, slug, structure_mode, status")
        .eq("id", tenantId)
        .single(),
      supabase
        .from("org_units")
        .select("id, nome, acronym, type, status")
        .eq("tenant_id", tenantId)
        .order("nome"),
      supabase
        .from("reserves")
        .select("id, nome, acronym, logo_url, status, org_unit_id")
        .eq("tenant_id", tenantId)
        .order("nome"),
    ]);

    if (tenantRes.error || !tenantRes.data) {
      return c.json({ error: "tenant não encontrado" }, 404);
    }

    return c.json({
      tenant: tenantRes.data,
      org_units: orgRes.data ?? [],
      reserves: reserveRes.data ?? [],
    });
  }
);
