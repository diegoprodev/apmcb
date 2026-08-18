import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { roleGuard } from "../middleware/role-guard";
import { supabase } from "../services/supabase";
import {
  MATERIAL_VALIDITY_ALERT_DAYS,
  getMaterialCategoryDefaults,
  normalizeMaterialCategory,
} from "../lib/material-metadata";
import { insertNotifications } from "../lib/notifications";
import { logger } from "../lib/logger";
import type { HonoVariables, Role } from "../types/hono";

export const categoriesRoutes = new Hono<{ Variables: HonoVariables }>();

const CategorySchema = z.object({
  nome: z.string().min(1).max(80).trim(),
  description: z.string().max(500).optional().nullable(),
  icon: z.string().max(40).optional().nullable(),
  requires_caliber: z.boolean().optional(),
  requires_validity: z.boolean().optional(),
  default_has_serial_numbers: z.boolean().optional(),
  validity_alert_days: z.array(z.number().int()).optional().nullable(),
  requires_vehicle_fields: z.boolean().optional(),
});

function normalizeCategoryBody(body: z.infer<typeof CategorySchema>) {
  const category = normalizeMaterialCategory(body.nome);
  const defaults = getMaterialCategoryDefaults(category.slug);
  const requiresValidity = body.requires_validity ?? defaults.requires_validity;
  const alertDays = requiresValidity
    ? (body.validity_alert_days?.length ? body.validity_alert_days : [...MATERIAL_VALIDITY_ALERT_DAYS])
    : [];
  const invalidAlert = alertDays.find((day) =>
    !MATERIAL_VALIDITY_ALERT_DAYS.includes(day as 365 | 180 | 90)
  );
  if (invalidAlert) return { ok: false as const, error: "Marco de alerta de validade invalido" };

  return {
    ok: true as const,
    value: {
      nome: category.label,
      slug: category.slug,
      description: body.description?.trim() || null,
      icon: body.icon ?? null,
      requires_caliber: body.requires_caliber ?? defaults.requires_caliber,
      requires_validity: requiresValidity,
      default_has_serial_numbers: body.default_has_serial_numbers ?? defaults.default_has_serial_numbers,
      validity_alert_days: alertDays,
      requires_vehicle_fields: body.requires_vehicle_fields ?? defaults.requires_vehicle_fields,
    },
  };
}

type NormalizedCategoryValue = Extract<ReturnType<typeof normalizeCategoryBody>, { ok: true }>["value"];

// Extraído de PATCH /:id (achado de code review ao adicionar o fluxo de
// edição por aprovação abaixo — POST /requests/:id/approve para type='edit'
// precisa aplicar a MESMA mutação em material_categories, e duplicar esta
// chamada Supabase violaria DRY/SSOT). Não escopa por `active` de propósito:
// mantém o comportamento exato de PATCH /:id hoje (admin sempre pôde editar
// mesmo uma categoria já desativada); o approve do fluxo de edição faz sua
// própria checagem de `active` antes de chamar isto (ver comentário lá).
async function applyCategoryUpdate(id: string, tenantId: string, reserveId: string, value: NormalizedCategoryValue) {
  return supabase
    .from("material_categories")
    .update({ ...value, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .eq("reserve_id", reserveId)
    .select()
    .single();
}

categoriesRoutes.get(
  "/",
  roleGuard("admin_global", "armeiro", "admin_reserva", "auditor", "usuario"),
  async (c) => {
    const tenantId = c.get("tenantId");
    const reserveId = c.get("reserveId");
    if (!tenantId) return c.json({ error: "tenant nao encontrado" }, 400);

    let query = supabase
      .from("material_categories")
      .select(`
        id, tenant_id, reserve_id, nome, slug, description, icon,
        requires_caliber, requires_validity, default_has_serial_numbers,
        validity_alert_days, requires_vehicle_fields, active, created_at, created_by
      `)
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("nome");

    if (reserveId) query = query.or(`reserve_id.eq.${reserveId},reserve_id.is.null`);

    const { data, error } = await query;
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ categories: data ?? [] });
  }
);

categoriesRoutes.post(
  "/",
  roleGuard("admin_reserva"),
  zValidator("json", CategorySchema),
  async (c) => {
    const tenantId = c.get("tenantId");
    const reserveId = c.get("reserveId");
    const userId = c.get("userId");
    if (!tenantId) return c.json({ error: "tenant nao encontrado" }, 400);
    if (!reserveId) return c.json({ error: "reserva nao encontrada" }, 400);

    const normalized = normalizeCategoryBody(c.req.valid("json"));
    if (!normalized.ok) return c.json({ error: normalized.error }, 400);

    const { data, error } = await supabase
      .from("material_categories")
      .insert({
        tenant_id: tenantId,
        reserve_id: reserveId,
        ...normalized.value,
        created_by: userId,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") return c.json({ error: "Categoria ja existe" }, 409);
      return c.json({ error: error.message }, 500);
    }
    return c.json({ category: data }, 201);
  }
);

categoriesRoutes.patch(
  "/:id",
  roleGuard("admin_reserva"),
  zValidator("json", CategorySchema),
  async (c) => {
    const id = c.req.param("id");
    const tenantId = c.get("tenantId");
    const reserveId = c.get("reserveId");
    if (!tenantId || !reserveId) return c.json({ error: "escopo nao encontrado" }, 400);

    const normalized = normalizeCategoryBody(c.req.valid("json"));
    if (!normalized.ok) return c.json({ error: normalized.error }, 400);

    const { data, error } = await applyCategoryUpdate(id, tenantId, reserveId, normalized.value);

    if (error) return c.json({ error: error.message }, 500);
    if (!data) return c.json({ error: "Categoria nao encontrada" }, 404);
    return c.json({ category: data });
  }
);

categoriesRoutes.delete(
  "/:id",
  roleGuard("admin_reserva"),
  async (c) => {
    const id = c.req.param("id");
    const tenantId = c.get("tenantId");
    const reserveId = c.get("reserveId");

    const { data: cat } = await supabase
      .from("material_categories")
      .select("id, nome, slug, tenant_id, reserve_id")
      .eq("id", id)
      .single();

    if (!cat || cat.tenant_id !== tenantId || cat.reserve_id !== reserveId) {
      return c.json({ error: "Categoria nao encontrada" }, 404);
    }

    const { count } = await supabase
      .from("material_types")
      .select("id", { count: "exact", head: true })
      .or(`category_id.eq.${cat.id},categoria_slug.eq.${cat.slug}`)
      .eq("tenant_id", tenantId)
      .eq("reserve_id", reserveId)
      .eq("ativo", true);

    if ((count ?? 0) > 0) {
      return c.json({
        error: `Nao e possivel remover: ${count} tipo(s) de material usam esta categoria`,
      }, 409);
    }

    await supabase.from("material_categories").update({ active: false }).eq("id", id);
    return c.json({ ok: true });
  }
);

// ── Category Requests (armeiro solicita, admin aprova) ─────────────────────
//
// category_requests não tem tenant_id próprio (só reserve_id) — mesma
// característica documentada nas migrations 20260711000003/000005 para as
// policies de RLS. As rotas abaixo usam o client `supabase` com service_role
// (services/supabase.ts), que IGNORA RLS por completo — então o escopo por
// tenant/reserva precisa ser reforçado manualmente aqui, com o mesmo rigor
// já aplicado em arsenal.ts (requestBelongsToScope/scopedRequestorIds) para
// admin_approval_requests. Sem isso, admin_global (cujo reserveId de sessão
// normalmente é null — só é populado se o usuário também tiver uma linha
// própria em reserve_memberships, ver auth.ts) cai no branch "sem filtro" e
// vê/aprova solicitações de QUALQUER tenant.

const CategoryRequestSchema = z.object({
  nome: z.string().min(1).max(80).trim(),
  slug: z.string().min(1).max(80).trim().optional(),
  icon: z.string().max(40).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
});

// Resolve o conjunto de reserve_id que o revisor pode enxergar/agir sobre:
// admin_reserva fica restrito à própria reserva (sessão), admin_global ao
// tenant inteiro (todas as reservas do tenant) — mesmo contrato de
// scopedRequestorIds em arsenal.ts.
async function scopedReserveIds(role: Role, reserveId: string | null, tenantId: string | null): Promise<string[]> {
  if (role === "admin_reserva") return reserveId ? [reserveId] : [];
  if (role !== "admin_global") return [];
  if (!tenantId) return [];
  // Achado de code review: erro da query era descartado (`{ data }` sem
  // checar `error`), então uma falha de rede/timeout virava silenciosamente
  // "nenhuma reserva" — admin_global legítimo recebia 404 "solicitação não
  // encontrada" sem nenhum log, impossível de diferenciar de um problema real
  // de permissão. Loga o erro; mantém o retorno vazio (mesmo contrato de
  // antes) porque os callers já tratam lista vazia como "sem acesso".
  const { data, error } = await supabase.from("reserves").select("id").eq("tenant_id", tenantId);
  if (error) {
    logger.error("categories.scoped_reserve_ids.query_failure", { tenantId, error: error.message });
    return [];
  }
  return (data ?? []).map((r) => r.id as string);
}

// Notifica admin_reserva da reserva + admin_global do tenant — mesmo padrão
// de notifyReviewers em arsenal.ts (achado real replicado aqui: sem isto, a
// solicitação de categoria fica pendente sem nenhum revisor ser avisado).
// `kind` só ajusta o texto (reaproveita o mesmo notification_type "category_request"
// tanto para propostas de categoria nova quanto de edição — nenhum enum novo
// precisa ser adicionado, distinguível pelo texto e por metadata.request_id).
async function notifyCategoryReviewers(
  reserveId: string,
  requestId: string,
  categoryNome: string,
  kind: "create" | "edit" = "create"
) {
  // Achado de code review (3ª rodada): esta função é best-effort/fire-and-
  // -forget por design (mesmo contrato de insertNotifications, que já tem
  // seu próprio try/catch) — mas as 3 queries abaixo não checavam `error`
  // (falha vira "zero linhas" em silêncio, sem log) nem estavam protegidas
  // contra exceção (rejeição de promise propagava pro caller e virava 500
  // pro armeiro mesmo com o category_requests já inserido com sucesso). O
  // try/catch aqui garante que NENHUM problema em notificar revisores possa
  // derrubar a resposta HTTP de POST /request.
  try {
    const recipientIds = new Set<string>();

    // reserve_memberships (admins da própria reserva) e reserves (tenant_id,
    // usado logo abaixo pra buscar admin_global do tenant) são independentes
    // entre si — rodavam em sequência antes, somando as duas latências de
    // round-trip numa chamada que é await'ada antes da resposta de
    // POST /request voltar pro armeiro.
    const [
      { data: reserveAdmins, error: reserveAdminsError },
      { data: reserveRow, error: reserveRowError },
    ] = await Promise.all([
      supabase.from("reserve_memberships").select("user_id").eq("reserve_id", reserveId).eq("role", "admin_reserva"),
      supabase.from("reserves").select("tenant_id").eq("id", reserveId).maybeSingle(),
    ]);
    if (reserveAdminsError) {
      logger.error("categories.notify_reviewers.reserve_admins_query_failure", { request_id: requestId, error: reserveAdminsError.message });
    }
    if (reserveRowError) {
      logger.error("categories.notify_reviewers.reserve_row_query_failure", { request_id: requestId, error: reserveRowError.message });
    }
    for (const row of reserveAdmins ?? []) recipientIds.add(row.user_id as string);

    if (reserveRow?.tenant_id) {
      const { data: globalAdmins, error: globalAdminsError } = await supabase
        .from("profiles")
        .select("id")
        .eq("default_tenant_id", reserveRow.tenant_id)
        .eq("role", "admin_global");
      if (globalAdminsError) {
        logger.error("categories.notify_reviewers.global_admins_query_failure", { request_id: requestId, error: globalAdminsError.message });
      }
      for (const row of globalAdmins ?? []) recipientIds.add(row.id as string);
    }

    if (recipientIds.size === 0) return;

    await insertNotifications(
      [...recipientIds].map((userId) => ({
        user_id: userId,
        type: "category_request",
        title: kind === "edit" ? "Solicitacao de edicao de categoria" : "Solicitacao de nova categoria",
        body: kind === "edit"
          ? `Armeiro solicitou edicao da categoria "${categoryNome}"`
          : `Armeiro solicitou a categoria "${categoryNome}"`,
        metadata: { request_id: requestId },
      })),
      "categories.notify_reviewers.insert_failure",
      { request_id: requestId }
    );
  } catch (err) {
    logger.error("categories.notify_reviewers.unexpected_failure", {
      request_id: requestId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// POST /api/categories/request — armeiro cria solicitação
categoriesRoutes.post(
  "/request",
  roleGuard("armeiro", "admin_reserva", "admin_global"),
  zValidator("json", CategoryRequestSchema),
  async (c) => {
    const userId = c.get("userId");
    const reserveId = c.get("reserveId");
    if (!reserveId) return c.json({ error: "reserva nao encontrada" }, 400);

    const body = c.req.valid("json");
    const category = normalizeMaterialCategory(body.nome);
    const slug = body.slug ?? category.slug;

    const { data, error } = await supabase
      .from("category_requests")
      .insert({
        reserve_id: reserveId,
        requested_by: userId,
        nome: category.label,
        slug,
        icon: body.icon ?? null,
        description: body.description?.trim() || null,
        status: "pendente",
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") return c.json({ error: "Solicitacao ja existe" }, 409);
      return c.json({ error: error.message }, 500);
    }

    await notifyCategoryReviewers(reserveId, data.id, category.label, "create");

    return c.json({ request: data }, 201);
  }
);

// POST /api/categories/:id/edit-request — armeiro propõe EDIÇÃO de uma
// categoria JÁ EXISTENTE para aprovação do admin_reserva/admin_global.
// Antes desta rota, um armeiro (canManage=false) só conseguia "Solicitar
// Nova Categoria" — para propor mudanças numa categoria já cadastrada
// (achado do produto), ele ficava travado em "Somente leitura" sem
// alternativa. Reaproveita normalizeCategoryBody (mesma validação/normalização
// de POST/PATCH diretos) para não duplicar regras de negócio: a diferença é
// que a mudança fica pendente em category_requests (type='edit') em vez de
// ser aplicada direto em material_categories — só é aplicada de fato em
// POST /requests/:id/approve, via applyCategoryUpdate (mesma função usada
// por PATCH /:id).
categoriesRoutes.post(
  "/:id/edit-request",
  roleGuard("armeiro"),
  zValidator("json", CategorySchema),
  async (c) => {
    const id = c.req.param("id");
    const userId = c.get("userId");
    const tenantId = c.get("tenantId");
    const reserveId = c.get("reserveId");
    if (!tenantId || !reserveId) return c.json({ error: "escopo nao encontrado" }, 400);

    // Escopo: a categoria alvo precisa pertencer ao mesmo tenant/reserva do
    // armeiro — sem isto, um armeiro autenticado poderia enviar o :id de uma
    // categoria de OUTRA reserva/tenant, e o admin revisor (também escopado
    // por reserve_id em scopedReserveIds) acabaria vendo uma solicitação
    // referenciando uma categoria fora do próprio alcance. Mesmo raciocínio
    // de scoping manual documentado no topo desta seção (client service_role
    // ignora RLS por completo).
    const { data: target, error: targetError } = await supabase
      .from("material_categories")
      .select("id, tenant_id, reserve_id, active")
      .eq("id", id)
      .maybeSingle();

    if (targetError) {
      logger.error("categories.edit_request.target_select_failure", { category_id: id, error: targetError.message });
      return c.json({ error: targetError.message }, 500);
    }
    if (!target || target.tenant_id !== tenantId || target.reserve_id !== reserveId || !target.active) {
      return c.json({ error: "Categoria nao encontrada" }, 404);
    }

    const normalized = normalizeCategoryBody(c.req.valid("json"));
    if (!normalized.ok) return c.json({ error: normalized.error }, 400);

    const { data, error } = await supabase
      .from("category_requests")
      .insert({
        reserve_id: reserveId,
        requested_by: userId,
        type: "edit",
        target_category_id: id,
        ...normalized.value,
        status: "pendente",
      })
      .select()
      .single();

    if (error) {
      // Índice único parcial em (reserve_id, slug) WHERE status='pendente'
      // (mesma constraint que já protege POST /request contra duplicidade)
      // — aqui bloqueia uma SEGUNDA edição pendente para a mesma categoria
      // antes da primeira ser revisada.
      if (error.code === "23505") {
        return c.json({ error: "Ja existe uma solicitacao de edicao pendente para esta categoria" }, 409);
      }
      logger.error("categories.edit_request.insert_failure", { category_id: id, error: error.message });
      return c.json({ error: error.message }, 500);
    }

    await notifyCategoryReviewers(reserveId, data.id, normalized.value.nome, "edit");

    return c.json({ request: data }, 201);
  }
);

// GET /api/categories/requests — admin lista (todos os status, escopado)
categoriesRoutes.get(
  "/requests",
  roleGuard("admin_global", "admin_reserva"),
  async (c) => {
    const tenantId = c.get("tenantId");
    const reserveId = c.get("reserveId");
    const role = c.get("role");
    if (!tenantId) return c.json({ error: "tenant nao encontrado" }, 400);

    const reserveIds = await scopedReserveIds(role, reserveId, tenantId);
    if (reserveIds.length === 0) return c.json({ requests: [] });

    // type/target_category_id/requires_*/validity_alert_days: colunas novas
    // do fluxo de edição (ver migration da seção "Category edit requests").
    // target_category traz o estado ATUAL da categoria (não uma foto antiga
    // tirada no momento da solicitação) para a UI montar o diff "antigo →
    // novo" — join, não uma query por request renderizado na lista.
    const { data, error } = await supabase
      .from("category_requests")
      .select(`
        id, nome, slug, icon, description, status, type, target_category_id,
        requires_caliber, requires_validity, default_has_serial_numbers,
        validity_alert_days, requires_vehicle_fields,
        created_at, reviewed_at, rejection_reason,
        requested_by:profiles!requested_by(nome_completo, matricula),
        reviewed_by:profiles!reviewed_by(nome_completo),
        reserve:reserves(nome),
        target_category:material_categories!target_category_id(
          nome, slug, icon, description, requires_caliber, requires_validity,
          default_has_serial_numbers, validity_alert_days, requires_vehicle_fields
        )
      `)
      .in("reserve_id", reserveIds)
      .order("created_at", { ascending: false });

    if (error) return c.json({ error: error.message }, 500);
    return c.json({ requests: data ?? [] });
  }
);

// POST /api/categories/requests/:id/approve — admin aprova
categoriesRoutes.post(
  "/requests/:id/approve",
  roleGuard("admin_global", "admin_reserva"),
  async (c) => {
    const id = c.req.param("id");
    const userId = c.get("userId");
    const tenantId = c.get("tenantId");
    const reserveId = c.get("reserveId");
    const role = c.get("role");
    if (!tenantId) return c.json({ error: "tenant nao encontrado" }, 400);

    // Achado de code review (2ª rodada): a versão anterior buscava o request
    // SEM filtro de escopo e só checava "já processada" (409) ANTES do scope
    // check (403) — isso deixava um oráculo cross-tenant: um admin sem
    // permissão nenhuma sobre o registro conseguia distinguir "não existe"
    // (404) de "existe e está pendente" (403) de "existe e já foi processada"
    // (409), sem nunca ter acesso de fato. Filtrar reserve_id JÁ no SELECT
    // (mesmo padrão de PATCH /api/arsenal/requests/:id/approve, que filtra
    // status na query em vez de depois) colapsa "não existe" e "fora do
    // escopo" numa única resposta 404 — nenhuma informação vaza para quem
    // não tem acesso.
    const reserveIds = await scopedReserveIds(role, reserveId, tenantId);
    if (reserveIds.length === 0) return c.json({ error: "Solicitacao nao encontrada" }, 404);

    // Achado de code review: destructurar só `data` (descartando `error`)
    // fazia uma falha real de SELECT (rede/timeout) virar "não encontrada"
    // (404) em vez de propagar como erro de servidor — indistinguível de um
    // ID inválido pra quem está debugando um incidente em produção.
    const { data: req, error: reqSelectError } = await supabase
      .from("category_requests")
      .select(`
        id, nome, slug, icon, description, reserve_id, status, requested_by,
        type, target_category_id, requires_caliber, requires_validity,
        default_has_serial_numbers, validity_alert_days, requires_vehicle_fields
      `)
      .eq("id", id)
      .in("reserve_id", reserveIds)
      .maybeSingle();

    if (reqSelectError) {
      logger.error("categories.approve.select_failure", { request_id: id, error: reqSelectError.message });
      return c.json({ error: reqSelectError.message }, 500);
    }
    if (!req) return c.json({ error: "Solicitacao nao encontrada" }, 404);
    if (req.status !== "pendente") return c.json({ error: "Solicitacao ja processada" }, 409);

    // Concorrência otimista: reivindica a solicitação atomicamente ANTES de
    // criar a categoria — mesmo padrão de PATCH /api/arsenal/requests/:id/approve
    // (WHERE status = "pendente", 409 se não afetou). O código anterior fazia
    // o insert em material_categories e o update de status em Promise.all SEM
    // essa trava: dois revisores clicando quase ao mesmo tempo passavam pelo
    // SELECT acima e a categoria só era criada uma vez (unique constraint),
    // mas o UPDATE de category_requests para "aprovado" rodava para os DOIS —
    // e se o insert falhasse por qualquer outro motivo, o request já tinha
    // sido marcado "aprovado" sem a categoria existir (estado inconsistente).
    // Achado de code review: destructurar só `data` (descartando `error`)
    // fazia uma falha real de UPDATE (rede/timeout) ser reportada como "já
    // processada por outro revisor" (409) — mascarando uma falha de
    // infraestrutura como se fosse uma race condition legítima.
    const { data: claimed, error: claimError } = await supabase
      .from("category_requests")
      .update({
        status: "aprovado",
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "pendente")
      .select("id")
      .maybeSingle();

    if (claimError) {
      logger.error("categories.approve.claim_failure", { request_id: id, error: claimError.message });
      return c.json({ error: claimError.message }, 500);
    }
    if (!claimed) return c.json({ error: "Solicitacao ja foi processada por outro revisor" }, 409);

    // Reabre a solicitação — o "claim" acima não pode deixar o request
    // marcado "aprovado" se a mutação em material_categories (create OU
    // edit) não tiver de fato ocorrido. Extraído para reuso pelos dois
    // branches abaixo (achado de code review 2ª rodada, já existia só para
    // o branch de criação: esse UPDATE de reversão não checava o próprio
    // erro — se ELE também falhasse, a solicitação ficava presa em
    // "aprovado" sem nenhuma mutação real e sem rastro além do log).
    async function revertClaim(originalError: string) {
      const { error: revertError } = await supabase
        .from("category_requests")
        .update({ status: "pendente", reviewed_by: null, reviewed_at: null })
        .eq("id", id);
      if (revertError) {
        logger.error("categories.approve.revert_claim_failure", {
          request_id: id,
          original_error: originalError,
          revert_error: revertError.message,
        });
      }
    }

    if (req.type === "edit") {
      if (!req.target_category_id) {
        // Dado corrompido/legado (linha 'edit' sem alvo) — a CHECK constraint
        // da migration deveria impedir isto, mas não confiamos cegamente
        // numa constraint que ainda não foi aplicada manualmente (ver
        // comentário da migration): falha explicitamente em vez de tentar um
        // UPDATE com id undefined.
        await revertClaim("edit request sem target_category_id");
        logger.error("categories.approve.edit_missing_target", { request_id: id });
        return c.json({ error: "Solicitacao de edicao invalida: sem categoria alvo" }, 500);
      }

      // A categoria alvo pode ter sido desativada DEPOIS que o armeiro
      // propôs a edição e ANTES da revisão — aplicar mudanças numa categoria
      // já desativada seria uma reativação implícita e inesperada.
      const { data: targetCheck, error: targetCheckError } = await supabase
        .from("material_categories")
        .select("active")
        .eq("id", req.target_category_id)
        .maybeSingle();

      if (targetCheckError) {
        await revertClaim(targetCheckError.message);
        logger.error("categories.approve.edit_target_check_failure", { request_id: id, error: targetCheckError.message });
        return c.json({ error: targetCheckError.message }, 500);
      }
      if (!targetCheck?.active) {
        await revertClaim("target category inactive or missing");
        return c.json({ error: "Categoria alvo foi desativada e nao pode mais ser editada" }, 409);
      }

      const { error: updateError } = await applyCategoryUpdate(req.target_category_id, tenantId, req.reserve_id, {
        nome: req.nome,
        slug: req.slug,
        description: req.description,
        icon: req.icon,
        requires_caliber: req.requires_caliber ?? false,
        requires_validity: req.requires_validity ?? false,
        default_has_serial_numbers: req.default_has_serial_numbers ?? false,
        validity_alert_days: req.validity_alert_days ?? [],
        requires_vehicle_fields: req.requires_vehicle_fields ?? false,
      });

      if (updateError) {
        await revertClaim(updateError.message);
        logger.error("categories.approve.update_category_failure", { request_id: id, error: updateError.message });
        return c.json({ error: updateError.message }, 500);
      }
    } else {
      const defaults = getMaterialCategoryDefaults(req.slug);
      const { error: catError } = await supabase.from("material_categories").insert({
        tenant_id: tenantId,
        reserve_id: req.reserve_id,
        nome: req.nome,
        slug: req.slug,
        icon: req.icon,
        description: req.description,
        requires_caliber: defaults.requires_caliber,
        requires_validity: defaults.requires_validity,
        default_has_serial_numbers: defaults.default_has_serial_numbers,
        validity_alert_days: defaults.requires_validity ? [...MATERIAL_VALIDITY_ALERT_DAYS] : [],
        requires_vehicle_fields: defaults.requires_vehicle_fields,
        active: true,
        created_by: userId,
      });

      if (catError) {
        await revertClaim(catError.message);
        if (catError.code === "23505") return c.json({ error: "Categoria ja existe" }, 409);
        logger.error("categories.approve.insert_category_failure", { request_id: id, error: catError.message });
        return c.json({ error: catError.message }, 500);
      }
    }

    await insertNotifications(
      [{
        user_id: req.requested_by,
        type: "category_approved",
        title: "Categoria aprovada",
        body: req.type === "edit"
          ? `Sua solicitacao de edicao da categoria "${req.nome}" foi aprovada.`
          : `Sua solicitacao de categoria "${req.nome}" foi aprovada.`,
        metadata: { request_id: id },
      }],
      "categories.notify_approved.insert_failure",
      { request_id: id, requestor_id: req.requested_by }
    );

    return c.json({ ok: true });
  }
);

// POST /api/categories/requests/:id/reject — admin rejeita
categoriesRoutes.post(
  "/requests/:id/reject",
  roleGuard("admin_global", "admin_reserva"),
  zValidator("json", z.object({ reason: z.string().min(5).max(300) })),
  async (c) => {
    const id = c.req.param("id");
    const userId = c.get("userId");
    const tenantId = c.get("tenantId");
    const reserveId = c.get("reserveId");
    const role = c.get("role");
    const { reason } = c.req.valid("json");

    // Achado real: a versão anterior não checava escopo nenhum (qualquer
    // admin_reserva/admin_global autenticado podia rejeitar a solicitação de
    // categoria de QUALQUER outra reserva/tenant — IDOR) e não checava se o
    // UPDATE de fato afetou uma linha (retornava 200 "ok" mesmo quando a
    // solicitação já tinha sido processada por outro revisor). O filtro
    // reserve_id IN (...) já no SELECT (em vez de buscar sem escopo e checar
    // depois) colapsa "não existe" e "fora do escopo" numa única resposta
    // 404 — mesmo raciocínio aplicado em POST /requests/:id/approve acima.
    const reserveIds = await scopedReserveIds(role, reserveId, tenantId);
    if (reserveIds.length === 0) return c.json({ error: "Solicitacao nao encontrada" }, 404);

    const { data: req, error: reqSelectError } = await supabase
      .from("category_requests")
      .select("id, nome, reserve_id, status, requested_by, type")
      .eq("id", id)
      .in("reserve_id", reserveIds)
      .maybeSingle();

    if (reqSelectError) {
      logger.error("categories.reject.select_failure", { request_id: id, error: reqSelectError.message });
      return c.json({ error: reqSelectError.message }, 500);
    }
    if (!req) return c.json({ error: "Solicitacao nao encontrada" }, 404);

    const { data: rejected, error } = await supabase
      .from("category_requests")
      .update({
        status: "rejeitado",
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        rejection_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "pendente")
      .select("id")
      .maybeSingle();

    if (error) return c.json({ error: error.message }, 500);
    if (!rejected) return c.json({ error: "Solicitacao ja foi processada por outro revisor" }, 409);

    await insertNotifications(
      [{
        user_id: req.requested_by,
        type: "category_rejected",
        title: "Categoria negada",
        body: req.type === "edit"
          ? `Sua solicitacao de edicao da categoria "${req.nome}" foi rejeitada. Motivo: ${reason}`
          : `Sua solicitacao de categoria "${req.nome}" foi rejeitada. Motivo: ${reason}`,
        metadata: { request_id: id },
      }],
      "categories.notify_rejected.insert_failure",
      { request_id: id, requestor_id: req.requested_by }
    );

    return c.json({ ok: true });
  }
);
