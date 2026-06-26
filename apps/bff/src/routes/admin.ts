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

// ─── POST /api/admin/org-units ────────────────────────────────────────────────
adminRoutes.post(
  "/org-units",
  roleGuard("admin_global", "superadmin"),
  zValidator("json", z.object({
    nome:    z.string().min(1).max(100),
    acronym: z.string().min(1).max(20).toUpperCase().optional(),
    type:    z.enum(["batalhao", "companhia", "pelotao", "secao", "outro"]).optional(),
  })),
  async (c) => {
    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json({ error: "tenant não encontrado" }, 400);
    const body = c.req.valid("json");
    const { data, error } = await supabase.from("org_units").insert({
      tenant_id: tenantId, nome: body.nome,
      acronym: body.acronym ?? null, type: body.type ?? "outro", status: "active",
    }).select().single();
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ org_unit: data }, 201);
  }
);

// ─── PATCH /api/admin/org-units/:id ──────────────────────────────────────────
adminRoutes.patch(
  "/org-units/:id",
  roleGuard("admin_global", "superadmin"),
  zValidator("json", z.object({
    nome:    z.string().min(1).max(100).optional(),
    acronym: z.string().min(1).max(20).optional(),
    type:    z.enum(["batalhao", "companhia", "pelotao", "secao", "outro"]).optional(),
    status:  z.enum(["active", "inactive"]).optional(),
  })),
  async (c) => {
    const id       = c.req.param("id");
    const tenantId = c.get("tenantId");
    const body     = c.req.valid("json");
    const { data, error } = await supabase.from("org_units")
      .update(body).eq("id", id).eq("tenant_id", tenantId!).select().single();
    if (error || !data) return c.json({ error: error?.message ?? "Não encontrado" }, error ? 500 : 404);
    return c.json({ org_unit: data });
  }
);

// ─── DELETE /api/admin/org-units/:id ─────────────────────────────────────────
adminRoutes.delete(
  "/org-units/:id",
  roleGuard("admin_global", "superadmin"),
  async (c) => {
    const id       = c.req.param("id");
    const tenantId = c.get("tenantId");
    // Checar se há reserves vinculadas
    const { count } = await supabase.from("reserves")
      .select("id", { count: "exact", head: true }).eq("org_unit_id", id);
    if ((count ?? 0) > 0) {
      return c.json({ error: `Não é possível remover — ${count} reserva(s) vinculada(s). Remova ou mova-as primeiro.` }, 409);
    }
    await supabase.from("org_units").delete().eq("id", id).eq("tenant_id", tenantId!);
    return c.json({ ok: true });
  }
);

// ─── POST /api/admin/reserves ─────────────────────────────────────────────────
adminRoutes.post(
  "/reserves",
  roleGuard("admin_global", "superadmin"),
  zValidator("json", z.object({
    nome:        z.string().min(1).max(100),
    acronym:     z.string().min(1).max(20).optional(),
    org_unit_id: z.string().uuid().nullable().optional(),
  })),
  async (c) => {
    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json({ error: "tenant não encontrado" }, 400);
    const body = c.req.valid("json");
    const { data, error } = await supabase.from("reserves").insert({
      tenant_id: tenantId, nome: body.nome,
      acronym: body.acronym ?? null, org_unit_id: body.org_unit_id ?? null, status: "active",
    }).select().single();
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ reserve: data }, 201);
  }
);

// ─── PATCH /api/admin/reserves/:id ───────────────────────────────────────────
adminRoutes.patch(
  "/reserves/:id",
  roleGuard("admin_global", "superadmin"),
  zValidator("json", z.object({
    nome:        z.string().min(1).max(100).optional(),
    acronym:     z.string().min(1).max(20).optional(),
    org_unit_id: z.string().uuid().nullable().optional(),
    status:      z.enum(["active", "inactive"]).optional(),
  })),
  async (c) => {
    const id       = c.req.param("id");
    const tenantId = c.get("tenantId");
    const body     = c.req.valid("json");
    const { data, error } = await supabase.from("reserves")
      .update(body).eq("id", id).eq("tenant_id", tenantId!).select().single();
    if (error || !data) return c.json({ error: error?.message ?? "Não encontrado" }, error ? 500 : 404);
    return c.json({ reserve: data });
  }
);

// ─── DELETE /api/admin/reserves/:id ──────────────────────────────────────────
adminRoutes.delete(
  "/reserves/:id",
  roleGuard("admin_global", "superadmin"),
  async (c) => {
    const id       = c.req.param("id");
    const tenantId = c.get("tenantId");
    // Checar se há materiais ou membros
    const [{ count: mats }, { count: members }] = await Promise.all([
      supabase.from("material_types").select("id", { count: "exact", head: true }).eq("reserve_id", id),
      supabase.from("reserve_memberships").select("id", { count: "exact", head: true }).eq("reserve_id", id),
    ]);
    if ((mats ?? 0) > 0 || (members ?? 0) > 0) {
      return c.json({
        error: `Reserve possui ${mats ?? 0} tipo(s) de material e ${members ?? 0} membro(s). Transfira ou remova antes de deletar.`,
        details: { materiais: mats, membros: members },
      }, 409);
    }
    await supabase.from("reserves").delete().eq("id", id).eq("tenant_id", tenantId!);
    return c.json({ ok: true });
  }
);
