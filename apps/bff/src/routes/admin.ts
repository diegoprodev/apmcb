import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { roleGuard } from "../middleware/role-guard";
import { supabase } from "../services/supabase";
import { canInvite } from "../lib/invite-ceiling";
import type { HonoVariables } from "../types/hono";

export const adminRoutes = new Hono<{ Variables: HonoVariables }>();

// ─── POST /api/admin/militares ───────────────────────────────────────────────
// Cadastra um militar (cria auth.users + profiles) usando service role key.
adminRoutes.post(
  "/militares",
  roleGuard("admin_global", "superadmin"),
  zValidator("json", z.object({
    nome_completo:    z.string().min(1),
    matricula:        z.string().min(1),
    posto:            z.string().nullable().optional(),
    nome_de_guerra:   z.string().nullable().optional(),
    role:             z.string().optional(),
    unidade:          z.string().nullable().optional(),
    telefone:         z.string().nullable().optional(),
    foto_url:         z.string().min(1).nullable().optional(), // path relativo ou URL (bucket privado)
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

    // Retorna o path relativo (não URL pública) — bucket é privado; signed URLs são geradas no frontend
    return c.json({ url: path });
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
        .select("id, nome, acronym, type, status, icon_name")
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

    // Busca admin_reserva de cada reserva
    const reserveIds = (reserveRes.data ?? []).map((r) => r.id);
    const adminRes = reserveIds.length > 0
      ? await supabase
          .from("reserve_memberships")
          .select("reserve_id, user_id, profiles(id, nome_completo)")
          .in("reserve_id", reserveIds)
          .eq("role", "admin_reserva")
      : { data: [] };

    const adminByReserve = Object.fromEntries(
      (adminRes.data ?? []).map((m) => {
        const p = m.profiles;
        const profile = Array.isArray(p) ? (p[0] as { id: string; nome_completo: string } | undefined) ?? null : (p as { id: string; nome_completo: string } | null);
        return [m.reserve_id, profile];
      })
    );

    const reservesWithAdmin = (reserveRes.data ?? []).map((r) => ({
      ...r,
      admin_reserva: adminByReserve[r.id] ?? null,
    }));

    return c.json({
      tenant: tenantRes.data,
      org_units: orgRes.data ?? [],
      reserves: reservesWithAdmin,
    });
  }
);

// ─── POST /api/admin/org-units ────────────────────────────────────────────────
adminRoutes.post(
  "/org-units",
  roleGuard("admin_global", "superadmin"),
  zValidator("json", z.object({
    nome:      z.string().min(1).max(100),
    acronym:   z.string().min(1).max(20).toUpperCase().optional(),
    type:      z.enum(["diretoria", "batalhao", "companhia", "centro", "guarda", "secretaria", "unidade", "outro"]).optional(),
    icon_name: z.enum(["shield","building2","users","clipboard","star","lock","folder","target","archive","map-pin","flag","layers","award","briefcase","wrench","radio","key","badge-check"]).optional(),
  })),
  async (c) => {
    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json({ error: "tenant não encontrado" }, 400);
    const body = c.req.valid("json");
    const { data, error } = await supabase.from("org_units").insert({
      tenant_id: tenantId, nome: body.nome,
      acronym: body.acronym ?? null, type: body.type ?? "outro",
      icon_name: body.icon_name ?? "building2", status: "ativa",
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
    nome:      z.string().min(1).max(100).optional(),
    acronym:   z.string().min(1).max(20).optional(),
    type:      z.enum(["diretoria","batalhao","companhia","centro","guarda","secretaria","unidade","outro"]).optional(),
    status:    z.enum(["ativa", "inativa"]).optional(),
    icon_name: z.enum(["shield","building2","users","clipboard","star","lock","folder","target","archive","map-pin","flag","layers","award","briefcase","wrench","radio","key","badge-check"]).optional(),
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
      acronym: body.acronym ?? null, org_unit_id: body.org_unit_id ?? null, status: "ativa",
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
    status:      z.enum(["ativa", "inativa"]).optional(),
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

// ─── GET /api/admin/branding ─────────────────────────────────────────────────
adminRoutes.get(
  "/branding",
  roleGuard("admin_global", "superadmin"),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const { data, error } = await supabase
      .from("tenant_branding")
      .select("primary_hex, secondary_hex, tenant_logo_url, reserve_logo_url")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) return c.json({ error: "Falha ao buscar branding" }, 500);
    return c.json({
      primary_hex:      data?.primary_hex      ?? "#0f172a",
      secondary_hex:    data?.secondary_hex    ?? "#3b82f6",
      tenant_logo_url:  data?.tenant_logo_url  ?? null,
      reserve_logo_url: data?.reserve_logo_url ?? null,
    });
  }
);

// ─── PATCH /api/admin/branding ───────────────────────────────────────────────
adminRoutes.patch(
  "/branding",
  roleGuard("admin_global", "superadmin"),
  zValidator("json", z.object({
    primary_hex:   z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    secondary_hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  })),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const body = c.req.valid("json");
    const { error } = await supabase
      .from("tenant_branding")
      .upsert({ tenant_id: tenantId, ...body }, { onConflict: "tenant_id" });
    if (error) return c.json({ error: "Falha ao salvar branding" }, 500);
    return c.json({ ok: true });
  }
);

// ─── POST /api/admin/branding/logo ───────────────────────────────────────────
// Upload de logo da reserva (imagem) para o tenant atual.
adminRoutes.post(
  "/branding/logo",
  roleGuard("admin_global", "superadmin"),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const formData = await c.req.formData();
    const file = formData.get("logo");
    const logoType = (formData.get("logo_type") as string) ?? "reserve";

    if (!file || !(file instanceof File)) {
      return c.json({ error: "Campo 'logo' obrigatório (multipart/form-data)" }, 400);
    }
    const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
    if (!ALLOWED.includes(file.type)) {
      return c.json({ error: "Tipo inválido. Use png, jpg, webp ou svg" }, 400);
    }
    if (file.size > 2 * 1024 * 1024) {
      return c.json({ error: "Máximo 2MB" }, 400);
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
    const field = logoType === "tenant" ? "tenant_logo_url" : "reserve_logo_url";
    const path = `${tenantId}/${logoType}-logo.${ext}`;
    const buf = await file.arrayBuffer();

    const { error: uploadErr } = await supabase.storage
      .from("reserve-logos")
      .upload(path, buf, { contentType: file.type, upsert: true });
    if (uploadErr) return c.json({ error: "Falha no upload: " + uploadErr.message }, 500);

    const { data: { publicUrl } } = supabase.storage.from("reserve-logos").getPublicUrl(path);
    await supabase
      .from("tenant_branding")
      .upsert({ tenant_id: tenantId, [field]: publicUrl }, { onConflict: "tenant_id" });

    return c.json({ ok: true, url: publicUrl });
  }
);

// ─── POST /api/admin/users/invite ────────────────────────────────────────────
// Convite com Privilege Ceiling: cada role só pode convidar até seu próprio teto.
// Ceiling: superadmin→admin_global | admin_global→admin_global/admin_reserva/armeiro/usuario
//          admin_reserva→armeiro/usuario/auditor | armeiro→usuario
adminRoutes.post(
  "/users/invite",
  roleGuard("superadmin", "admin_global", "admin_reserva", "armeiro"),
  zValidator(
    "json",
    z.object({
      email:         z.string().email(),
      nome_completo: z.string().min(2).max(200).optional(),
      role:          z.string(),
      reserve_id:    z.string().uuid().optional(),
    })
  ),
  async (c) => {
    const callerRole = c.get("role");
    const tenantId   = c.get("tenantId");
    const actorId    = c.get("userId");
    const body       = c.req.valid("json");

    if (!canInvite(callerRole, body.role)) {
      return c.json({ error: `${callerRole} não pode convidar ${body.role}` }, 403);
    }

    if (!tenantId) return c.json({ error: "Tenant não identificado" }, 403);

    const frontendUrl = process.env.FRONTEND_URL ?? "https://apmcb.pmpb.online";
    const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
      body.email,
      {
        data: { nome_completo: body.nome_completo ?? "" },
        redirectTo: `${frontendUrl}/auth/exchange`,
      }
    );

    if (inviteError) {
      console.error("[invite] supabase error:", inviteError.status, inviteError.message);
      return c.json({ error: inviteError.message ?? "Falha ao enviar convite" }, 422);
    }

    const user = inviteData.user;

    if (user?.id) {
      await supabase.from("profiles").upsert(
        {
          id: user.id,
          nome_completo: body.nome_completo ?? body.email.split("@")[0],
          role: body.role as "admin_global" | "admin_reserva" | "armeiro" | "usuario" | "auditor",
          default_tenant_id: tenantId,
          registration_status: "pending",
        },
        { onConflict: "id" }
      );

      await supabase.from("tenant_memberships").upsert(
        { user_id: user.id, tenant_id: tenantId, role: body.role },
        { onConflict: "user_id,tenant_id" }
      );

      if (body.reserve_id) {
        await supabase.from("reserve_memberships").upsert(
          { user_id: user.id, reserve_id: body.reserve_id, role: body.role },
          { onConflict: "user_id,reserve_id" }
        );
      }
    }

    await supabase.from("audit_logs").insert({
      actor_id: actorId,
      action: "admin.user.invited",
      resource_type: "profile",
      resource_id: user?.id ?? null,
      metadata: {
        email: body.email,
        role: body.role,
        reserve_id: body.reserve_id ?? null,
        caller_role: callerRole,
      },
    });

    return c.json({ ok: true, email: body.email }, 201);
  }
);

// ─── GET /api/admin/saidas ────────────────────────────────────────────────────
// Monitor de saídas por reserva — admin_global vê qualquer reserva do seu tenant.
adminRoutes.get(
  "/saidas",
  roleGuard("admin_global", "superadmin"),
  zValidator(
    "query",
    z.object({
      reserveId: z.string().uuid().optional(),
      status:    z.enum(["ativo", "devolvido"]).optional(),
      from:      z.string().optional(),
      to:        z.string().optional(),
    })
  ),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const { reserveId, status, from, to } = c.req.valid("query");

    // Validate cross-tenant: reserve must belong to caller's org
    if (reserveId) {
      const { data: reserve } = await supabase
        .from("reserves")
        .select("id, tenant_id")
        .eq("id", reserveId)
        .single();
      if (!reserve || reserve.tenant_id !== tenantId) {
        return c.json({ error: "Reserva não encontrada" }, 404);
      }
    }

    let query = supabase
      .from("lendings")
      .select(`
        id, quantidade, status_legacy, issued_at, returned_at, local, notes, auth_mode, material_request_id, movement_id,
        material_type:material_types(nome, categoria),
        military:profiles!lendings_military_id_fkey(id, nome_completo, matricula, posto, foto_url),
        master:profiles!lendings_master_id_fkey(nome_completo, matricula)
      `)
      .order("issued_at", { ascending: false })
      .limit(500);

    if (reserveId) {
      query = query.eq("reserve_id", reserveId);
    } else {
      query = query.eq("tenant_id", tenantId);
    }

    if (status) query = query.eq("status_legacy", status);
    if (from)   query = query.gte("issued_at", from);
    if (to)     query = query.lte("issued_at", to + "T23:59:59");

    const { data, error } = await query;
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ saidas: data ?? [] });
  }
);
