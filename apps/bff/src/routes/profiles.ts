import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { roleGuard } from "../middleware/role-guard";
import { supabase } from "../services/supabase";
import type { HonoVariables } from "../types/hono";

export const profileRoutes = new Hono<{ Variables: HonoVariables }>();

const ALL_STATUSES = z.enum([
  "complete",
  "inactive",
  "pending_biometric",
  "impedimento_administrativo",
]);

// PATCH /api/profiles/me — self-update (qualquer usuário autenticado)
profileRoutes.patch(
  "/me",
  zValidator("json", z.object({
    foto_url:       z.string().min(1).optional(), // aceita path relativo ou URL (bucket privado)
    posto:          z.string().nullable().optional(),
    nome_de_guerra: z.string().nullable().optional(),
  })),
  async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Não autenticado" }, 401);

    const body = c.req.valid("json");
    const payload: Record<string, unknown> = {};
    if (body.foto_url       !== undefined) payload.foto_url       = body.foto_url;
    if (body.posto          !== undefined) payload.posto          = body.posto;
    if (body.nome_de_guerra !== undefined) payload.nome_de_guerra = body.nome_de_guerra;

    if (Object.keys(payload).length === 0) return c.json({ error: "Nada para atualizar" }, 400);

    const { error } = await supabase.from("profiles").update(payload).eq("id", userId);
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ ok: true });
  }
);

// PATCH /api/profiles/:id — full profile update (name, posto, etc.)
profileRoutes.patch(
  "/:id",
  // superadmin é Nexus/SaaS-only e nunca acessa dado operacional de tenant
  // (regra H-RBAC canônica, docs/security.md §21) — achado durante pentest
  // dinâmico, estava presente aqui indevidamente.
  roleGuard("admin_global", "armeiro", "admin_reserva"),
  zValidator("json", z.object({
    nome_completo:    z.string().min(1).optional(),
    posto:            z.string().nullable().optional(),
    nome_de_guerra:   z.string().nullable().optional(),
    unidade:          z.string().nullable().optional(),
    telefone:         z.string().nullable().optional(),
    registration_status: ALL_STATUSES.optional(),
  })),
  async (c) => {
    const targetId   = c.req.param("id");
    const callerId   = c.get("userId");
    const callerRole = c.get("role");
    const tenantId   = c.get("tenantId");
    const body       = c.req.valid("json");

    if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);

    // Só busca o target quando a mudança de registration_status precisa ser
    // avaliada (teto de privilégio / auto-alteração) — o dialog de edição
    // (_edit-dialog.tsx) sempre reenvia registration_status no payload,
    // mesmo sem o admin ter mexido nele, então "presente no body" não é o
    // mesmo que "está mudando"; comparar com o valor atual evita bloquear
    // edições legítimas de outros campos (ex: admin_global corrigindo o
    // próprio nome_completo na tela de Usuários, que lista o próprio caller).
    let targetForStatusCheck: { role: string; registration_status: string } | null = null;
    if (body.registration_status) {
      const { data: target } = await supabase
        .from("profiles")
        .select("role, registration_status")
        .eq("id", targetId)
        .eq("default_tenant_id", tenantId)
        .maybeSingle();
      targetForStatusCheck = target;
    }
    const statusIsChanging =
      !!body.registration_status &&
      targetForStatusCheck !== null &&
      body.registration_status !== targetForStatusCheck.registration_status;

    if (statusIsChanging && callerId === targetId) {
      // Ninguém altera o próprio registration_status — mesma guarda de
      // PATCH /:id/status (linha ~149 abaixo). Sem isso, um usuário cujo
      // acesso acabou de ser suspenso (inactive/impedimento_administrativo)
      // podia usar a sessão ainda válida (deactivation não invalida sessão
      // ativa, só bloqueia login futuro) para se auto-reativar por aqui.
      return c.json({ error: "Não é possível alterar o próprio status." }, 403);
    }

    // Teto de privilégio ao alterar registration_status — CRÍTICO encontrado
    // em code review: esta rota faltava a mesma proteção que PATCH /:id/status
    // já tinha (linhas ~160-165 abaixo). Sem isso, armeiro/admin_reserva
    // conseguia setar registration_status:"inactive" (suspensão de conta,
    // ver nexus.ts:786) no profile de um admin_global/admin_reserva da
    // própria reserva — só o valor "impedimento_administrativo" e só o role
    // "armeiro" eram bloqueados, deixando "inactive" e admin_reserva livres.
    if (statusIsChanging && (callerRole === "armeiro" || callerRole === "admin_reserva")) {
      if (body.registration_status === "impedimento_administrativo") {
        return c.json({ error: "Apenas administradores podem aplicar impedimento administrativo." }, 403);
      }
      if (
        targetForStatusCheck &&
        (targetForStatusCheck.role === "admin_global" ||
          targetForStatusCheck.role === "superadmin" ||
          targetForStatusCheck.role === "admin_reserva")
      ) {
        return c.json({ error: "Sem permissão para alterar status de administrador." }, 403);
      }
    }

    const updatePayload: Record<string, unknown> = {};
    if (body.nome_completo    !== undefined) updatePayload.nome_completo    = body.nome_completo;
    if (body.posto            !== undefined) updatePayload.posto            = body.posto;
    if (body.nome_de_guerra   !== undefined) updatePayload.nome_de_guerra   = body.nome_de_guerra;
    if (body.unidade          !== undefined) updatePayload.unidade          = body.unidade;
    if (body.telefone         !== undefined) updatePayload.telefone         = body.telefone;
    if (body.registration_status !== undefined) updatePayload.registration_status = body.registration_status;

    if (Object.keys(updatePayload).length === 0) {
      return c.json({ error: "Nenhum campo para atualizar." }, 400);
    }

    // .select().maybeSingle() é essencial aqui, não só estilo: sem ele, um
    // UPDATE que casa 0 linhas (ex: targetId de outro tenant) retorna
    // error=null (sucesso "vazio") e o handler respondia 200 {ok:true} para
    // uma escrita que nunca aconteceu — achado durante pentest dinâmico
    // (cross-tenant-write.pentest.test.ts). Não é vazamento de dado (o
    // WHERE por tenant já protegia a linha em si), mas é um contrato de API
    // enganoso: o caller não tem como saber que nada foi alterado.
    const { data: updated, error } = await supabase
      .from("profiles")
      .update(updatePayload)
      .eq("id", targetId)
      .eq("default_tenant_id", tenantId)
      .select("id")
      .maybeSingle();

    if (error) return c.json({ error: error.message }, 500);
    if (!updated) return c.json({ error: "Usuário não encontrado" }, 404);

    // Audit only if status changed
    if (body.registration_status) {
      await supabase.from("audit_logs").insert({
        actor_id: callerId,
        action: "profile.updated",
        resource_type: "profiles",
        resource_id: targetId,
        metadata: { fields: Object.keys(updatePayload) },
      });
    }

    return c.json({ ok: true });
  }
);

// PATCH /api/profiles/:id/status
// Admin: any status. Master: only complete / inactive / pending_biometric.
profileRoutes.patch(
  "/:id/status",
  roleGuard("admin_global", "armeiro", "admin_reserva"),
  zValidator("json", z.object({ status: ALL_STATUSES })),
  async (c) => {
    const targetId = c.req.param("id");
    const callerRole = c.get("role");
    const callerId = c.get("userId");
    const { status } = c.req.valid("json");

    if (callerId === targetId) {
      return c.json({ error: "Não é possível alterar o próprio status." }, 403);
    }

    if ((callerRole === "armeiro" || callerRole === "admin_reserva") && status === "impedimento_administrativo") {
      return c.json(
        { error: "Apenas administradores podem aplicar impedimento administrativo." },
        403
      );
    }

    const callerTenantId = c.get("tenantId");
    if (!callerTenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);

    // Fetch current status for audit trail — ESCOPADO por tenant. Sem o
    // .eq("default_tenant_id", ...) aqui, um armeiro conseguia sondar
    // QUALQUER id de QUALQUER tenant: a mensagem de erro devolvida mais
    // abaixo (403 "administrador" vs. seguir em frente) revelava a role de
    // um profile fora do próprio tenant — achado durante pentest dinâmico
    // (cross-tenant-write.pentest.test.ts). Falhar aqui, cedo e com 404
    // genérico, fecha a enumeração antes de qualquer decisão de negócio.
    const { data: current } = await supabase
      .from("profiles")
      .select("registration_status, nome_completo, role")
      .eq("id", targetId)
      .eq("default_tenant_id", callerTenantId)
      .maybeSingle();

    if (!current) return c.json({ error: "Usuário não encontrado." }, 404);

    // Master (armeiro/admin_reserva) cannot change status of admin users
    if ((callerRole === "armeiro" || callerRole === "admin_reserva") &&
        (current.role === "admin_global" || current.role === "superadmin" || current.role === "admin_reserva")) {
      return c.json({ error: "Sem permissão para alterar status de administrador." }, 403);
    }

    const { data: updated, error } = await supabase
      .from("profiles")
      .update({ registration_status: status })
      .eq("id", targetId)
      .eq("default_tenant_id", callerTenantId)
      .select("id")
      .maybeSingle();

    if (error) return c.json({ error: error.message }, 500);
    if (!updated) return c.json({ error: "Usuário não encontrado." }, 404);

    // Audit log
    await supabase.from("audit_logs").insert({
      actor_id: callerId,
      action: "profile.status_changed",
      resource_type: "profiles",
      resource_id: targetId,
      metadata: {
        status_anterior: current.registration_status,
        status_novo: status,
        nome: current.nome_completo,
      },
    });

    // Notify the affected user on impactful transitions
    if (
      status === "inactive" ||
      status === "impedimento_administrativo"
    ) {
      const title =
        status === "impedimento_administrativo"
          ? "Impedimento Administrativo Aplicado"
          : "Conta Desativada";
      const body =
        status === "impedimento_administrativo"
          ? "Seu acesso ao armamento foi suspenso por impedimento administrativo. Em caso de dúvidas, procure o Departamento de Pessoas de sua unidade."
          : "Sua conta foi desativada. Entre em contato com o administrador.";

      await supabase
        .from("notifications")
        .insert({
          user_id: targetId,
          type: status === "impedimento_administrativo" ? "account_blocked" : "account_deactivated",
          title,
          body,
        });
    }

    return c.json({ ok: true, status });
  }
);

// POST /api/profiles/me/photo — upload de foto de perfil do próprio usuário
profileRoutes.post("/me/photo", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Não autenticado" }, 401);

  const body = await c.req.parseBody();
  const file = body["photo"] as File | undefined;
  if (!file || !(file instanceof File)) return c.json({ error: "Arquivo 'photo' é obrigatório" }, 400);
  if (file.size > 2 * 1024 * 1024) return c.json({ error: "Tamanho máximo: 2MB" }, 413);

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const allowed = ["jpg", "jpeg", "png", "webp", "gif"];
  if (!allowed.includes(ext)) return c.json({ error: "Formato não suportado. Use JPG, PNG, WEBP ou GIF." }, 415);

  const path = `profiles/${userId}/avatar.${ext}`;
  const buffer = await file.arrayBuffer();

  const { error: upErr } = await supabase.storage
    .from("avatars")
    .upload(path, buffer, { contentType: file.type, upsert: true });

  if (upErr) return c.json({ error: "Falha ao enviar imagem: " + upErr.message }, 500);

  const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
  const photoUrl = urlData.publicUrl;

  await supabase.from("profiles").update({ foto_url: photoUrl }).eq("id", userId);

  return c.json({ ok: true, url: photoUrl });
});

// GET /api/profiles/me/reserves — retorna reservas do usuário autenticado
// Usa service role (bypassa RLS) — necessário pois o browser client não tem JWT
profileRoutes.get("/me/reserves", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ reserves: [] });

  const { data: memberships } = await supabase
    .from("reserve_memberships")
    .select("reserve_id")
    .eq("user_id", userId);

  const reserveIds = (memberships ?? []).map((m) => m.reserve_id as string);
  if (reserveIds.length === 0) return c.json({ reserves: [] });

  const { data: reserves } = await supabase
    .from("reserves")
    .select("id, nome")
    .in("id", reserveIds)
    .order("nome");

  return c.json({ reserves: reserves ?? [] });
});

// GET /api/profiles/usuarios — lista militares (role=usuario) do tenant, para
// popular seletores de "militar" em formulários de saída/cautela. Existia
// antes como query direta do client Supabase (RLS) em vários componentes —
// mas a sessão sb-* vira HttpOnly ~100ms após o login (ver
// auth/exchange/page.tsx), então o SDK do browser nunca tem um JWT de
// usuário pra anexar nessas chamadas depois do redirect pós-login: a query
// sempre rodava como anon e a RLS corretamente devolvia vazio (bug
// silencioso, confirmado via trace de rede). Mesmo padrão de
// GET /api/arsenal/items/disponiveis.
profileRoutes.get(
  "/usuarios",
  roleGuard("armeiro", "admin_reserva", "admin_global"),
  async (c) => {
    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json({ error: "Tenant não identificado" }, 400);

    const { data, error } = await supabase
      .from("profiles")
      .select("id, nome_completo, matricula, posto")
      .eq("default_tenant_id", tenantId)
      .eq("role", "usuario")
      .order("nome_completo");

    if (error) return c.json({ error: "Erro ao buscar usuários" }, 500);
    return c.json(data ?? []);
  }
);
