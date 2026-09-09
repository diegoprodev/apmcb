import { Hono } from "hono";
import { zValidator } from "../lib/validated-json";
import { z } from "zod";
import { roleGuard } from "../middleware/role-guard";
import { supabase } from "../services/supabase";
import { canInvite, allowedRoles } from "../lib/invite-ceiling";
import { sendEmail } from "../services/email";
import { renderTemplate } from "../lib/email-templates/index.ts";
import { primeiroNome } from "../lib/primeiro-nome";
import { buildRecoveryCallbackLink } from "../lib/auth-callback-link";
import type { HonoVariables } from "../types/hono";

const ROLE_LABEL: Record<string, string> = {
  admin_global: "Administrador Global",
  admin_reserva: "Administrador de Reserva",
  armeiro: "Armeiro",
  auditor: "Auditor",
  usuario: "Efetivo",
};
import {
  processProfilePhoto,
  ProfilePhotoError,
} from "../domain/profile-photo/process-profile-photo";
import { PROFILE_PHOTO_FILE_LIMIT_BYTES } from "../middleware/request-body-limit";

export const adminRoutes = new Hono<{ Variables: HonoVariables }>();

const LEGACY_STAGED_PHOTO_PATH =
  /^legacy-staged\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i;

function legacyProfilePhotoUploadEnabled() {
  return process.env.PROFILE_PHOTO_LEGACY_UPLOAD_ENABLED === "true";
}

// ─── POST /api/admin/militares ───────────────────────────────────────────────
// Cadastra um militar (cria auth.users + profiles) usando service role key.
adminRoutes.post(
  "/militares",
  // admin_reserva/armeiro incluídos: a checagem de ceiling (linha abaixo,
  // "só cadastram usuario") já existia mas nunca era alcançada porque o
  // roleGuard barrava essas roles antes — 403 garantido mesmo para o caso
  // legítimo (armeiro cadastrando um efetivo da própria reserva).
  // superadmin NÃO incluído: é operador SaaS (Nexus-only, sem tenant) — H-RBAC
  // canônico do projeto proíbe superadmin em guards de reserva/estrutura de
  // tenant. Cadastrar um militar sempre precisa de um tenantId de destino.
  roleGuard("admin_global", "admin_reserva", "armeiro"),
  zValidator("json", z.object({
    nome_completo:    z.string().min(1),
    matricula:        z.string().min(1),
    posto:            z.string().nullable().optional(),
    nome_de_guerra:   z.string().nullable().optional(),
    role:             z.enum(["usuario", "armeiro", "admin_reserva", "admin_global", "auditor"]).optional(),
    unidade:          z.string().nullable().optional(),
    telefone:         z.string().nullable().optional(),
    foto_url:         z.string().min(1).nullable().optional(), // path relativo ou URL (bucket privado)
  })),
  async (c) => {
    const body      = c.req.valid("json");
    const callerRole = c.get("role");
    const tenantId  = c.get("tenantId");
    const actorId   = c.get("userId");

    const userRole = body.role ?? "usuario";

    if (
      body.foto_url !== undefined &&
      (
        !legacyProfilePhotoUploadEnabled() ||
        body.foto_url === null ||
        !LEGACY_STAGED_PHOTO_PATH.test(body.foto_url)
      )
    ) {
      return c.json({ error: "foto_url não pode ser atribuída diretamente" }, 400);
    }

    // Privilege ceiling: reusa canInvite() (invite-ceiling.ts), a mesma fonte
    // de verdade já usada por POST /users/invite duas rotas abaixo — achado
    // real: esta rota tinha uma cópia local hardcoded do teto, divergente
    // (sem "auditor" para admin_reserva), igual ao endpoint Next.js
    // /api/admin/users que sofria do mesmo problema. Checado para os TRÊS
    // papéis chamadores (incluindo admin_global) — achado de code review:
    // uma primeira versão deste fix excluía admin_global da checagem, o que,
    // combinado com o enum abaixo aceitando "auditor", teria aberto uma
    // brecha real. invite-ceiling.ts foi então atualizado (decisão de
    // produto) para incluir "auditor" também no teto de admin_global — os
    // três papéis passam por essa mesma checagem, sem exceção hardcoded.
    if (!canInvite(callerRole, userRole)) {
      const allowed = allowedRoles(callerRole).join(", ");
      return c.json({ error: `Seu papel só pode cadastrar: ${allowed}` }, 403);
    }
    // Fail-fast: sem tenantId não há como escopar o novo profile — criar mesmo
    // assim deixaria a linha com default_tenant_id nulo, invisível para sempre
    // na grid /admin/usuarios (profiles_select RLS exige default_tenant_id =
    // my_tenant_id() para admin_global/admin_reserva/armeiro). Achado real:
    // era exatamente isso que fazia "cadastrei um usuário e ele não apareceu".
    if (!tenantId) {
      return c.json({ error: "Tenant não identificado na sessão" }, 400);
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
      role:                 userRole,
      registration_status:  "pending_biometric",
      nome_de_guerra:       body.nome_de_guerra ?? null,
      unidade:              body.unidade ?? null,
      telefone:             body.telefone ?? null,
      foto_url:             body.foto_url ?? null,
      default_tenant_id:    tenantId,
    });

    if (profileError) {
      // Rollback: delete auth user
      await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
        method: "DELETE",
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      });
      // 23505 = unique violation (matrícula já cadastrada) — caso esperado,
      // não um erro interno. Sem isso, tentar cadastrar uma matrícula
      // duplicada (ex: retry após falha de rede) retornava 500 genérico em
      // vez de uma mensagem clara — achado ao rodar journey-validation.spec.ts
      // JV-RBAC-06 contra produção (matrícula fixture já existente).
      if (profileError.code === "23505") {
        return c.json({ error: "Matrícula já cadastrada." }, 409);
      }
      return c.json({ error: profileError.message }, 500);
    }

    // tenantId sempre presente aqui (guard acima retorna 400 sem ele).
    // role_enum não tem valor "member" — precisa ser um valor válido do enum
    // (achado ao aplicar o backfill de produção: este upsert falhava
    // silenciosamente há tempos porque o retorno nunca era checado).
    const { error: membershipError } = await supabase.from("tenant_memberships").upsert({
      tenant_id: tenantId,
      user_id:   userId,
      role:      userRole,
    }, { onConflict: "tenant_id,user_id" });
    if (membershipError) {
      c.get("log").error({ error: membershipError.message, userId, tenantId }, "admin.militar.tenant_membership_failure");
    }

    await supabase.from("audit_logs").insert({
      actor_id: actorId,
      action: "admin.militar.created",
      resource_type: "profiles",
      resource_id: userId,
      metadata: { role: userRole, caller_role: callerRole, matricula: body.matricula },
    });

    return c.json({ success: true, user_id: userId });
  }
);

// ─── POST /api/admin/users/enviar-acesso ─────────────────────────────────────
// Provisiona o login de um militar já cadastrado (fluxo único — substitui o
// toggle Magic Link/Senha). Passos, cada um com checagem de erro:
//   1. troca o e-mail sintético (.interno@apmcb.sistema) pelo e-mail real
//   2. atualiza profiles.email + invite_sent_at
//   3. gera recovery link (roteia por /auth/callback → verifyOtp → define senha)
//   4. envia o e-mail "acesso" (Andrômeda, via Resend)
//   5. cria a notificação in-app de boas-vindas + orientação de biometria
// superadmin NÃO passa no roleGuard — só admin_global/admin_reserva/armeiro.
adminRoutes.post(
  "/users/enviar-acesso",
  roleGuard("admin_global", "admin_reserva", "armeiro"),
  zValidator("json", z.object({
    user_id: z.string().uuid(),
    email:   z.string().email(),
  })),
  async (c) => {
    const { user_id, email } = c.req.valid("json");
    const callerRole = c.get("role");
    const tenantId   = c.get("tenantId");
    const actorId    = c.get("userId");
    const log        = c.get("log");

    if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);

    const { data: target, error: lookupErr } = await supabase
      .from("profiles")
      .select("id, role, default_tenant_id, nome_completo, registration_status, invite_sent_at")
      .eq("id", user_id)
      .maybeSingle();
    if (lookupErr) { log.error({ err: lookupErr.message }, "admin.acesso.lookup_failure"); return c.json({ error: "Erro ao buscar o militar" }, 500); }
    if (!target || target.default_tenant_id !== tenantId) return c.json({ error: "Militar não encontrado" }, 404);
    if (!canInvite(callerRole, target.role)) {
      return c.json({ error: `Seu papel só pode provisionar acesso para: ${allowedRoles(callerRole).join(", ") || "nenhum papel"}` }, 403);
    }

    // Debounce: cada generateLink invalida o token anterior (uso único). Dois
    // cliques / dois admins em sequência queimariam o link recém-enviado. 30 s.
    if (target.invite_sent_at && Date.now() - new Date(target.invite_sent_at).getTime() < 30_000) {
      return c.json({ error: "Um e-mail de acesso acabou de ser enviado. Aguarde alguns segundos antes de reenviar." }, 429);
    }

    // 1. e-mail real em auth.users (email_confirm pula a confirmação).
    // Idempotente: numa re-tentativa após falha parcial de um envio anterior o
    // e-mail já pode estar gravado — nesse caso pular a troca evita o 422 do
    // GoTrue ("email already registered") que seria classificado como conflito
    // de terceiro e travaria o admin.
    const alvo = email.toLowerCase();
    const { data: currentUser, error: getUserErr } = await supabase.auth.admin.getUserById(user_id);
    if (getUserErr) log.warn({ err: getUserErr.message }, "admin.acesso.getuser_failure");

    if ((currentUser?.user?.email ?? "").toLowerCase() !== alvo) {
      const upd = await supabase.auth.admin.updateUserById(user_id, { email, email_confirm: true });
      if (upd.error) {
        const dup = upd.error.status === 422 || /already/i.test(upd.error.message ?? "");
        // 422 pode ser o e-mail do PRÓPRIO militar (corrida, ou o getUserById
        // acima falhou) — re-conferir o dono antes de devolver conflito.
        const { data: recheck } = dup
          ? await supabase.auth.admin.getUserById(user_id)
          : { data: null };
        const jaEhMeu = (recheck?.user?.email ?? "").toLowerCase() === alvo;
        if (!jaEhMeu) {
          log.warn({ status: upd.error.status, err: upd.error.message }, "admin.acesso.update_email_failure");
          return c.json(
            { error: dup ? "Este e-mail já está em uso por outra conta." : "Não foi possível definir o e-mail de acesso." },
            dup ? 409 : 500,
          );
        }
      }
    }

    // 2. espelho em profiles
    const { error: profErr } = await supabase
      .from("profiles")
      .update({ email, invite_sent_at: new Date().toISOString() })
      .eq("id", user_id);
    if (profErr) log.error({ err: profErr.message }, "admin.acesso.profile_update_failure");

    // 3. link de acesso — montado por lib/auth-callback-link.ts a partir do
    // `hashed_token`, apontando direto para /auth/callback (NÃO o `action_link`,
    // que roteia pelo /auth/v1/verify do GoTrue e devolve os tokens no fragmento
    // — invisível para o Route Handler server-side). Ver o cabeçalho da lib.
    const frontendUrl = (process.env.FRONTEND_URL ?? "https://apmcb.pmpb.online").replace(/\/$/, "");
    const link = await supabase.auth.admin.generateLink({ type: "recovery", email });
    const hashedToken = link.data?.properties?.hashed_token;
    if (link.error || !hashedToken) {
      log.error({ err: link.error?.message }, "admin.acesso.generate_link_failure");
      return c.json({ error: "Não foi possível gerar o link de acesso." }, 500);
    }
    let actionLink: string;
    try {
      actionLink = buildRecoveryCallbackLink({ frontendUrl, hashedToken });
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err) }, "admin.acesso.link_build_failure");
      return c.json({ error: "Não foi possível gerar o link de acesso." }, 500);
    }

    // órgão = nome da reserva do militar (se tiver), senão nome do tenant
    let orgao: string | null = null;
    const { data: rm } = await supabase
      .from("reserve_memberships")
      .select("reserves(nome)")
      .eq("user_id", user_id)
      .limit(1)
      .maybeSingle();
    orgao = (rm?.reserves as { nome?: string } | null)?.nome ?? null;
    if (!orgao) {
      const { data: t } = await supabase.from("tenants").select("nome").eq("id", tenantId).maybeSingle();
      orgao = t?.nome ?? null;
    }

    // 4. e-mail "acesso"
    const rendered = renderTemplate(
      "acesso",
      { papel: ROLE_LABEL[target.role] ?? target.role, url: actionLink },
      { baseUrl: frontendUrl, logoDataUri: "" },
      { nome: primeiroNome(target.nome_completo, "militar"), orgao },
    );
    const emailRes = await sendEmail({
      to: email, subject: rendered.subject, html: rendered.html, text: rendered.text,
      category: "lifecycle", log,
    });

    // 5. notificação in-app de boas-vindas + biometria
    const primeiro = primeiroNome(target.nome_completo, "militar");
    const { error: notifErr } = await supabase.from("notifications").insert({
      user_id,
      type: "account_created",
      title: `Seja bem-vindo, ${primeiro}`,
      body: "Dirija-se à reserva da sua unidade para o registro de biometria. Seu código dinâmico já está funcional.",
      tenant_id: tenantId,
      metadata: { provisioned_by: actorId, provisioned_by_role: callerRole },
    });
    if (notifErr) log.error({ err: notifErr.message }, "admin.acesso.notification_failure");

    await supabase.from("audit_logs").insert({
      actor_id: actorId,
      action: "admin.user.access_provisioned",
      resource_type: "profiles",
      resource_id: user_id,
      metadata: { email, target_role: target.role, caller_role: callerRole, email_sent: emailRes.ok },
    });

    return c.json({ ok: true, email_sent: emailRes.ok });
  }
);

// ─── POST /api/admin/upload-photo ────────────────────────────────────────────
// Upload de foto de perfil via BFF (usa service role para bypass do RLS de Storage).
adminRoutes.post(
  "/upload-photo",
  roleGuard("admin_global", "admin_reserva", "armeiro"),
  async (c) => {
    if (!legacyProfilePhotoUploadEnabled()) {
      return c.json({ error: "Endpoint legado desativado" }, 410);
    }

    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.json({ error: "Formato inválido — envie multipart/form-data" }, 400);
    }

    const file = formData.get("file") as File | null;
    if (!(file instanceof File)) {
      return c.json({ error: "file é obrigatório" }, 400);
    }
    if (file.size > PROFILE_PHOTO_FILE_LIMIT_BYTES) {
      return c.json({ error: "A foto excede o limite de 5 MiB", code: "PROFILE_PHOTO_INPUT_TOO_LARGE" }, 413);
    }

    let processed;
    try {
      processed = await processProfilePhoto(
        new Uint8Array(await file.arrayBuffer()),
      );
    } catch (error) {
      if (error instanceof ProfilePhotoError) {
        const status =
          error.code === "PROFILE_PHOTO_INPUT_TOO_LARGE"
            ? 413
            : error.code === "PROFILE_PHOTO_OUTPUT_TOO_LARGE"
              ? 422
              : 400;
        return c.json({ error: error.message, code: error.code }, status);
      }
      return c.json({ error: "Não foi possível processar a foto" }, 500);
    }

    const path = `legacy-staged/${crypto.randomUUID()}.webp`;
    const { error: uploadError } = await supabase.storage
      .from("profile-photos")
      .upload(path, processed.bytes, {
        contentType: "image/webp",
        cacheControl: "31536000",
        upsert: false,
      });
    if (uploadError) {
      c.get("log").error(
        { error: uploadError.message },
        "admin.legacy_profile_photo_upload_failed",
      );
      return c.json({ error: "Erro no upload" }, 502);
    }

    return c.json({ url: path });
  }
);

// ─── GET /api/admin/estrutura ────────────────────────────────────────────────
// Returns tenant structure (org_units + reserves) for the admin's tenant.
// Requires regular session auth (not nexus).
adminRoutes.get(
  "/estrutura",
  roleGuard("admin_global"),
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

    // Busca admin_reserva de cada reserva — uma reserva pode (e deve poder)
    // ter MAIS DE UM admin_reserva simultaneamente (achado real de produção,
    // 2026-08-15: reserve_memberships já é M:N por design — o upsert de
    // POST /users/invite abaixo usa onConflict "user_id,reserve_id", nunca
    // exigiu unicidade por reserve_id sozinho — mas Object.fromEntries()
    // aqui colapsava múltiplas linhas da mesma reserva pra só a ÚLTIMA
    // processada, descartando as demais silenciosamente da resposta da API).
    const reserveIds = (reserveRes.data ?? []).map((r) => r.id);
    const adminRes = reserveIds.length > 0
      ? await supabase
          .from("reserve_memberships")
          .select("reserve_id, user_id, profiles(id, nome_completo)")
          .in("reserve_id", reserveIds)
          .eq("role", "admin_reserva")
      : { data: [] };

    const adminsByReserve = new Map<string, { id: string; nome_completo: string }[]>();
    for (const m of adminRes.data ?? []) {
      const p = m.profiles;
      const profile = Array.isArray(p) ? (p[0] as { id: string; nome_completo: string } | undefined) ?? null : (p as { id: string; nome_completo: string } | null);
      if (!profile) continue;
      const list = adminsByReserve.get(m.reserve_id) ?? [];
      list.push(profile);
      adminsByReserve.set(m.reserve_id, list);
    }

    const reservesWithAdmin = (reserveRes.data ?? []).map((r) => ({
      ...r,
      admin_reservas: adminsByReserve.get(r.id) ?? [],
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
  roleGuard("admin_global"),
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
  roleGuard("admin_global"),
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
  roleGuard("admin_global"),
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
  roleGuard("admin_global"),
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
  roleGuard("admin_global"),
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
  roleGuard("admin_global"),
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
  roleGuard("admin_global"),
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
  roleGuard("admin_global"),
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
  roleGuard("admin_global"),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const formData = await c.req.formData();
    const file = formData.get("logo");
    const logoType = (formData.get("logo_type") as string) ?? "reserve";

    if (!file || !(file instanceof File)) {
      return c.json({ error: "Campo 'logo' obrigatório (multipart/form-data)" }, 400);
    }
    // Achado de code review (reforma de geração de PDF): pdf-lib só embute
    // PNG/JPG (embedPng/embedJpg) — não existe embedSvg/embedWebp. Um logo
    // SVG ou WEBP salvo aqui era aceito pela API mas ficava silenciosamente
    // ausente em todo PDF gerado (loadLogoBytes cai no catch e usa o
    // fallback estático, sem nenhum erro visível pro admin que fez upload).
    // Restringe no upload em vez de converter em toda geração de PDF —
    // mais barato e evita reintroduzir o mesmo bug em um gerador futuro.
    const ALLOWED = ["image/png", "image/jpeg"];
    if (!ALLOWED.includes(file.type)) {
      return c.json({ error: "Tipo inválido. Use png ou jpg — svg e webp não são suportados na geração de PDF." }, 400);
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
  roleGuard("admin_global", "admin_reserva", "armeiro"),
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

    const frontendUrl = (process.env.FRONTEND_URL ?? "https://apmcb.pmpb.online").replace(/\/$/, "");
    // /auth/callback (verifyOtp) — funciona p/ link gerado no servidor. O
    // /auth/exchange (PKCE) falha (sem code_verifier no browser).
    const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
      body.email,
      {
        data: { nome_completo: body.nome_completo ?? "" },
        redirectTo: `${frontendUrl}/auth/callback?next=/auth/update-password`,
      }
    );

    if (inviteError) {
      c.get("log").error({ status: inviteError.status, error: inviteError.message }, "admin.invite.failure");
      return c.json({ error: inviteError.message ?? "Falha ao enviar convite" }, 422);
    }

    const user = inviteData.user;

    if (user?.id) {
      const { error: profileErr } = await supabase.from("profiles").upsert(
        {
          id: user.id,
          nome_completo: body.nome_completo ?? body.email.split("@")[0],
          // Admin de reserva convidado pela estrutura organizacional não tem
          // matrícula de militar — synthetic único (matricula é NOT NULL).
          matricula: `ADM-${user.id.slice(0, 8).toUpperCase()}`,
          role: body.role as "admin_global" | "admin_reserva" | "armeiro" | "usuario" | "auditor",
          default_tenant_id: tenantId,
          // enum registration_status_enum não tem "pending" — usar
          // pending_biometric (achado: o valor "pending" fazia o upsert
          // falhar em silêncio e deixava o auth.users órfão → /auth/error).
          registration_status: "pending_biometric",
        },
        { onConflict: "id" }
      );
      if (profileErr) {
        c.get("log").error({ err: profileErr.message, userId: user.id }, "admin.invite.profile_failure");
        // rollback do auth.users pra não deixar órfão
        await supabase.auth.admin.deleteUser(user.id).catch(() => {});
        return c.json({ error: "Falha ao criar o perfil do convidado." }, 500);
      }

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
  roleGuard("admin_global"),
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
