import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { roleGuard } from "../middleware/role-guard";
import { canInvite, allowedRoles } from "../lib/invite-ceiling";
import { supabase } from "../services/supabase";
import type { HonoVariables } from "../types/hono";
import {
  ProfilePhotoReplaceError,
  replaceProfilePhoto,
} from "../domain/profile-photo/replace-profile-photo";
import {
  ProfilePhotoError,
} from "../domain/profile-photo/process-profile-photo";
import { createProfilePhotoDependencies } from "../repositories/profile-photo-repository";
import { PROFILE_PHOTO_FILE_LIMIT_BYTES } from "../middleware/request-body-limit";
import {
  ProfilePhotoReadError,
  resolveProfilePhotoUrl,
} from "../domain/profile-photo/resolve-profile-photo-url";

export const profileRoutes = new Hono<{ Variables: HonoVariables }>();
type ProfileContext = Context<{ Variables: HonoVariables }>;

const PROFILE_PHOTO_BUCKET = "profile-photos";

function profilePhotoErrorResponse(c: ProfileContext, error: unknown) {
  if (error instanceof ProfilePhotoError) {
    const status =
      error.code === "PROFILE_PHOTO_INPUT_TOO_LARGE"
        ? 413
        : error.code === "PROFILE_PHOTO_OUTPUT_TOO_LARGE"
          ? 422
          : 400;
    return c.json({ error: error.message, code: error.code }, status);
  }
  if (error instanceof ProfilePhotoReplaceError) {
    const status = ({
      PROFILE_PHOTO_TARGET_NOT_FOUND: 404,
      PROFILE_PHOTO_FORBIDDEN: 403,
      PROFILE_PHOTO_STORAGE_FAILED: 502,
      PROFILE_PHOTO_UPDATE_FAILED: 500,
      PROFILE_PHOTO_CONFLICT: 409,
    } as const)[error.code];
    return c.json({ error: error.message, code: error.code }, status);
  }
  c.get("log").error(
    { error: error instanceof Error ? error.message : "unknown" },
    "profile_photo.unexpected_failure",
  );
  return c.json({ error: "Erro interno" }, 500);
}

async function readProfilePhotoFile(c: ProfileContext) {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return { response: c.json({ error: "Envie multipart/form-data", code: "PROFILE_PHOTO_REQUIRED" }, 400) };
  }
  const candidate = formData.get("file") ?? formData.get("photo");
  if (!(candidate instanceof File)) {
    return { response: c.json({ error: "Arquivo de foto obrigatório", code: "PROFILE_PHOTO_REQUIRED" }, 400) };
  }
  if (candidate.size > PROFILE_PHOTO_FILE_LIMIT_BYTES) {
    return { response: c.json({ error: "A foto excede o limite de 5 MiB", code: "PROFILE_PHOTO_INPUT_TOO_LARGE" }, 413) };
  }
  return { bytes: new Uint8Array(await candidate.arrayBuffer()) };
}

function dependenciesFor(c: ProfileContext) {
  return createProfilePhotoDependencies(supabase, {
    supabaseUrl: process.env.SUPABASE_URL!,
    warn: (message, context) => c.get("log").warn(context, message),
  });
}

const ALL_STATUSES = z.enum([
  "complete",
  "inactive",
  "pending_biometric",
  "impedimento_administrativo",
]);

// "reactivate" é um valor SINTÉTICO — não existe no enum do banco
// (registration_status_enum). Aceito nos 2 endpoints abaixo além dos 4
// valores reais, e sempre resolvido pra um valor real por
// resolveRegistrationStatus() antes de qualquer UPDATE.
const STATUS_INPUT = z.enum([
  "complete",
  "inactive",
  "pending_biometric",
  "impedimento_administrativo",
  "reactivate",
]);

// "complete" e "pending_biometric" são estados DERIVADOS do cadastro
// biométrico real (ver supabase/migrations/20260721173926_..._enrollment_
// liveness_gate_txn.sql — só a RPC de enrollment seta "complete", ao
// consumir um challenge de biometria com sucesso). Achado real de produção
// (2026-08-15): o dialog de edição deixava o admin escolher "Completo"
// livremente num <select>, permitindo declarar biometria capturada sem
// ela nunca ter existido — a MESMA classe de bug (status mentindo sobre o
// estado real) encontrada e corrigida horas antes nesta sessão em
// classifyAccountStatus/AccessBadge. Esta função é o único portão: bloqueia
// qualquer transição MANUAL para "complete"/"pending_biometric" que não
// seja um no-op, e resolve "reactivate" consultando se o usuário TEM
// template biométrico cadastrado — nunca aceita o valor de volta do
// cliente.
async function resolveRegistrationStatus(
  requested: z.infer<typeof STATUS_INPUT>,
  currentStatus: string,
  targetId: string
): Promise<{ ok: true; status: z.infer<typeof ALL_STATUSES> } | { ok: false; error: string }> {
  if (requested === "reactivate") {
    const { count } = await supabase
      .from("biometric_templates")
      .select("id", { count: "exact", head: true })
      .eq("user_id", targetId);
    return { ok: true, status: (count ?? 0) > 0 ? "complete" : "pending_biometric" };
  }
  if ((requested === "complete" || requested === "pending_biometric") && requested !== currentStatus) {
    return {
      ok: false,
      error: "Este status é definido automaticamente pelo sistema (cadastro biométrico) — use \"Inativo\", \"Impedimento Administrativo\" ou reative a conta.",
    };
  }
  return { ok: true, status: requested };
}

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
    if (body.foto_url !== undefined) {
      const { data: current, error } = await supabase
        .from("profiles")
        .select("foto_url")
        .eq("id", userId)
        .maybeSingle();
      if (error) return c.json({ error: "Erro ao consultar perfil" }, 500);
      if (!current || current.foto_url !== body.foto_url) {
        return c.json({ error: "foto_url não pode ser atribuída diretamente" }, 400);
      }
    }
    if (body.posto          !== undefined) payload.posto          = body.posto;
    if (body.nome_de_guerra !== undefined) payload.nome_de_guerra = body.nome_de_guerra;

    if (Object.keys(payload).length === 0) {
      return body.foto_url !== undefined
        ? c.json({ ok: true })
        : c.json({ error: "Nada para atualizar" }, 400);
    }

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
    registration_status: STATUS_INPUT.optional(),
    role:             z.enum(["admin_global", "admin_reserva", "armeiro", "usuario", "auditor"]).optional(),
    // Reserva(s) de atuação — só relevante quando o papel EFETIVO (novo, se
    // estiver mudando, senão o atual) do alvo é armeiro/admin_reserva. Achado
    // real de produto: promover alguém a armeiro/admin_reserva não tinha como
    // escolher EM QUAL reserva do tenant a pessoa vai atuar (um tenant pode
    // ter dezenas de armarias) — ver bloco de tratamento abaixo.
    reserve_ids:      z.array(z.string().uuid()).optional(),
  })),
  async (c) => {
    const targetId   = c.req.param("id");
    const callerId   = c.get("userId");
    const callerRole = c.get("role");
    const tenantId   = c.get("tenantId");
    const body       = c.req.valid("json");

    if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);

    // Só busca o target quando a mudança de registration_status OU role
    // precisa ser avaliada (teto de privilégio / auto-alteração) — o dialog
    // de edição (_edit-dialog.tsx) sempre reenvia registration_status no
    // payload, mesmo sem o admin ter mexido nele, então "presente no body"
    // não é o mesmo que "está mudando"; comparar com o valor atual evita
    // bloquear edições legítimas de outros campos (ex: admin_global
    // corrigindo o próprio nome_completo na tela de Usuários, que lista o
    // próprio caller).
    let targetForStatusCheck: { role: string; registration_status: string } | null = null;
    if (body.registration_status || body.role) {
      const { data: target } = await supabase
        .from("profiles")
        .select("role, registration_status")
        .eq("id", targetId)
        .eq("default_tenant_id", tenantId)
        .maybeSingle();
      targetForStatusCheck = target;
    }

    // Auto-alteração de status bloqueada ANTES de resolver o valor pedido
    // (achado de code review — regressão pega pelo pentest suite local: sem
    // isso, um armeiro tentando auto-reativar com um valor "complete"/
    // "pending_biometric" batia primeiro no bloqueio de valor manual
    // proibido — abaixo — e recebia 400 em vez do 403 "não pode alterar o
    // próprio status" esperado; a ação continuava bloqueada nos dois casos,
    // mas com o motivo errado reportado ao caller). Comparação usa o valor
    // BRUTO do cliente — "reactivate" nunca é literalmente igual ao status
    // atual, então já conta como tentativa de mudança corretamente.
    if (
      body.registration_status &&
      targetForStatusCheck &&
      body.registration_status !== targetForStatusCheck.registration_status &&
      callerId === targetId
    ) {
      return c.json({ error: "Não é possível alterar o próprio status." }, 403);
    }

    // Resolve "reactivate"/bloqueia complete-pending manual ANTES de
    // qualquer checagem de teto abaixo — todo o resto do handler passa a
    // trabalhar só com o valor JÁ resolvido, nunca com o bruto do cliente.
    let resolvedStatus: z.infer<typeof ALL_STATUSES> | undefined;
    if (body.registration_status && targetForStatusCheck) {
      const resolution = await resolveRegistrationStatus(
        body.registration_status,
        targetForStatusCheck.registration_status,
        targetId
      );
      if (!resolution.ok) return c.json({ error: resolution.error }, 400);
      resolvedStatus = resolution.status;
    }

    const statusIsChanging =
      !!resolvedStatus &&
      targetForStatusCheck !== null &&
      resolvedStatus !== targetForStatusCheck.registration_status;
    const roleIsChanging =
      !!body.role &&
      targetForStatusCheck !== null &&
      body.role !== targetForStatusCheck.role;

    if (roleIsChanging) {
      // Ninguém altera o próprio papel — mesma guarda de auto-alteração já
      // aplicada a registration_status abaixo. Sem isso, um admin_global
      // conseguiria se auto-rebaixar/promover fora do fluxo de convite (que
      // já tem essa proteção implícita: não dá pra convidar a si mesmo).
      if (callerId === targetId) {
        return c.json({ error: "Não é possível alterar o próprio papel." }, 403);
      }
      // Teto de privilégio nos DOIS sentidos: o caller precisa ter
      // autoridade sobre o papel NOVO (o que está tentando atribuir) E
      // sobre o papel ATUAL do alvo (sem isso, um admin_reserva — cujo teto
      // não inclui admin_global — poderia rebaixar um admin_global pra
      // armeiro, já que "armeiro" está dentro do teto dele; a checagem do
      // papel atual fecha essa lacuna, mesma lógica já aplicada a
      // registration_status logo abaixo).
      if (!canInvite(callerRole, body.role!)) {
        return c.json({ error: `Seu papel só pode atribuir: ${allowedRoles(callerRole).join(", ") || "nenhum papel"}` }, 403);
      }
      if (!targetForStatusCheck || !canInvite(callerRole, targetForStatusCheck.role)) {
        return c.json({ error: "Sem permissão para alterar o papel deste usuário." }, 403);
      }
    }

    // ─── reserve_ids: atribuição de reserva(s) para armeiro/admin_reserva ────
    // Achado real de produto: promover alguém a armeiro/admin_reserva não
    // tinha como escolher EM QUAL reserva do tenant essa pessoa vai atuar —
    // um tenant pode ter dezenas de armarias/reservas. Só admin_global e
    // admin_reserva chegam aqui: armeiro nunca atinge este ramo (seu teto em
    // invite-ceiling.ts só permite atribuir "usuario", nunca
    // armeiro/admin_reserva — canInvite já barra isso lá em cima quando
    // roleIsChanging, e um armeiro também nunca tem canEditRole=true sobre um
    // alvo armeiro/admin_reserva no frontend).
    let reservesChanged = false;
    let reserveAuditMeta: { reserve_ids_added: string[]; reserve_ids_removed: string[] } | null = null;
    // Só a VALIDAÇÃO roda aqui (fail-fast); a ESCRITA em reserve_memberships
    // fica pendente e só é executada depois que o UPDATE de profiles abaixo
    // (quando houver) confirmar sucesso — ver bloco "pendingReserveWrite"
    // mais adiante. Sem esse adiamento, uma corrida com o lock otimista de
    // roleIsChanging (2 admins editando o mesmo alvo ao mesmo tempo) podia
    // gravar reserve_memberships assumindo um effectiveRole que o UPDATE do
    // profile, alguns milissegundos depois, rejeitava com 409 por já estar
    // desatualizado — deixando o alvo com uma membership para um papel que
    // ele nunca chegou a assumir de fato.
    let pendingReserveWrite: {
      toAdd: string[];
      toRemove: { id: string; reserve_id: string }[];
      effectiveRole: string;
    } | null = null;
    if (body.reserve_ids !== undefined) {
      if (callerRole === "armeiro") {
        return c.json({ error: "Sem permissão para atribuir reservas." }, 403);
      }
      // reserve_ids sozinho (sem registration_status/role no mesmo payload)
      // ainda não tinha disparado a busca do target lá em cima — busca agora,
      // sempre escopada por tenant (mesma proteção cross-tenant já aplicada
      // ao restante do handler).
      if (!targetForStatusCheck) {
        const { data: target } = await supabase
          .from("profiles")
          .select("role, registration_status")
          .eq("id", targetId)
          .eq("default_tenant_id", tenantId)
          .maybeSingle();
        targetForStatusCheck = target;
      }
      if (!targetForStatusCheck) {
        return c.json({ error: "Usuário não encontrado" }, 404);
      }

      const effectiveRole = roleIsChanging ? body.role! : targetForStatusCheck.role;
      if (effectiveRole !== "armeiro" && effectiveRole !== "admin_reserva") {
        return c.json({ error: "reserve_ids só se aplica a papéis armeiro ou admin_reserva." }, 400);
      }

      const requestedIds = [...new Set(body.reserve_ids)];
      if (requestedIds.length === 0) {
        // Nunca aceita esvaziar — evitaria a última reserve_membership do
        // alvo, quebrando o acesso dele por completo. O cliente sempre deve
        // mandar pelo menos 1 reserva quando o papel é armeiro/admin_reserva.
        return c.json({ error: "Selecione ao menos uma reserva." }, 400);
      }

      // Teto de privilégio — CRÍTICO: admin_global escolhe qualquer reserva
      // ATIVA do próprio tenant; admin_reserva só pode atribuir a(s)
      // reserva(s) onde ELE MESMO é admin_reserva hoje — nunca outra (sem
      // isso, um admin_reserva conseguiria conceder acesso de armeiro/
      // admin_reserva numa reserva que não é dele — escalação de privilégio
      // horizontal). Nunca confia em c.get("reserveId") pra essa decisão: é
      // só a reserva ATIVA da sessão, que pode ter sido trocada via
      // POST /api/reserves/switch/:id para qualquer reserva onde o usuário
      // tenha QUALQUER membership — a fonte de verdade é sempre
      // reserve_memberships.role = 'admin_reserva' do PRÓPRIO caller.
      let allowedReserveIds: Set<string>;
      if (callerRole === "admin_global") {
        // Achado de code review: faltava `.eq("status", "ativa")` — sem isto,
        // admin_global conseguia atribuir alguém a uma reserva já desativada
        // (reserves.status = 'inativa'), um estado semanticamente inválido.
        const { data: tenantReserves } = await supabase
          .from("reserves")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("status", "ativa")
          .in("id", requestedIds);
        allowedReserveIds = new Set((tenantReserves ?? []).map((r) => r.id as string));
      } else {
        const { data: ownAdminReserves } = await supabase
          .from("reserve_memberships")
          .select("reserve_id")
          .eq("user_id", callerId)
          .eq("role", "admin_reserva");
        allowedReserveIds = new Set((ownAdminReserves ?? []).map((r) => r.reserve_id as string));
      }

      const invalidIds = requestedIds.filter((id) => !allowedReserveIds.has(id));
      if (invalidIds.length > 0) {
        return c.json(
          {
            error: callerRole === "admin_global"
              ? "Uma ou mais reservas selecionadas não existem neste tenant."
              : "Você só pode atribuir a própria reserva.",
          },
          callerRole === "admin_global" ? 400 : 403
        );
      }

      const { data: existingRows } = await supabase
        .from("reserve_memberships")
        .select("id, reserve_id")
        .eq("user_id", targetId)
        .eq("role", effectiveRole);

      const requestedSet = new Set(requestedIds);
      const existingIds = new Set((existingRows ?? []).map((r) => r.reserve_id as string));
      const toAdd = requestedIds.filter((id) => !existingIds.has(id));
      // Só remove memberships que estão DENTRO do escopo de autoridade do
      // caller (allowedReserveIds) — para admin_reserva isso é só a própria
      // reserva, então uma membership do alvo numa reserva ALHEIA (ex: um
      // armeiro que também atua noutra reserva do tenant, fora do alcance
      // deste admin_reserva) NUNCA é tocada, nem por omissão. Sem isso,
      // salvar este form sem nenhuma intenção de mexer em reservas podia
      // revogar silenciosamente o acesso do alvo a uma reserva que o caller
      // nem administra, só porque ela não aparecia entre as opções dele.
      const toRemove = (existingRows ?? []).filter(
        (r) => allowedReserveIds.has(r.reserve_id as string) && !requestedSet.has(r.reserve_id as string)
      ) as { id: string; reserve_id: string }[];

      pendingReserveWrite = { toAdd, toRemove, effectiveRole };
    }

    // (Auto-alteração de status já bloqueada mais acima, antes da resolução
    // de "reactivate" — ver comentário lá. Mesma guarda de PATCH
    // /:id/status abaixo. Sem isso, um usuário cujo acesso acabou de ser
    // suspenso — inactive/impedimento_administrativo — podia usar a sessão
    // ainda válida, deactivation não invalida sessão ativa, só bloqueia
    // login futuro, para se auto-reativar por aqui.)

    // Teto de privilégio ao alterar registration_status — CRÍTICO encontrado
    // em code review: esta rota faltava a mesma proteção que PATCH /:id/status
    // já tinha (linhas ~160-165 abaixo). Sem isso, armeiro/admin_reserva
    // conseguia setar registration_status:"inactive" (suspensão de conta,
    // ver nexus.ts:786) no profile de um admin_global/admin_reserva da
    // própria reserva — só o valor "impedimento_administrativo" e só o role
    // "armeiro" eram bloqueados, deixando "inactive" e admin_reserva livres.
    if (statusIsChanging && (callerRole === "armeiro" || callerRole === "admin_reserva")) {
      if (resolvedStatus === "impedimento_administrativo") {
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
    if (resolvedStatus !== undefined) updatePayload.registration_status = resolvedStatus;
    if (roleIsChanging) updatePayload.role = body.role;

    // reserve_ids sozinho (sem nenhum outro campo mudando) é um payload
    // válido — ex: admin_global só adicionando uma 2ª reserva a um armeiro
    // já existente, sem tocar em mais nada. A escrita em reserve_memberships
    // (pendingReserveWrite) só acontece depois do bloco abaixo; aqui só
    // bloqueia quando NADA (nem profile, nem reservas) foi de fato pedido.
    if (Object.keys(updatePayload).length === 0 && body.reserve_ids === undefined) {
      return c.json({ error: "Nenhum campo para atualizar." }, 400);
    }

    if (Object.keys(updatePayload).length > 0) {
      // .select().maybeSingle() é essencial aqui, não só estilo: sem ele, um
      // UPDATE que casa 0 linhas (ex: targetId de outro tenant) retorna
      // error=null (sucesso "vazio") e o handler respondia 200 {ok:true} para
      // uma escrita que nunca aconteceu — achado durante pentest dinâmico
      // (cross-tenant-write.pentest.test.ts). Não é vazamento de dado (o
      // WHERE por tenant já protegia a linha em si), mas é um contrato de API
      // enganoso: o caller não tem como saber que nada foi alterado.
      let updateQuery = supabase
        .from("profiles")
        .update(updatePayload)
        .eq("id", targetId)
        .eq("default_tenant_id", tenantId);

      // Lock otimista contra TOCTOU (achado de code review): sem isto, o
      // teto de privilégio checado acima (canInvite nos dois sentidos) é
      // avaliado contra uma leitura que pode já estar obsoleta quando o
      // UPDATE de fato executa — 2 callers editando o mesmo alvo
      // concorrentemente podiam fazer um deles sobrescrever o role para um
      // valor que o SEU PRÓPRIO teto nunca permitiria, só por timing (ex:
      // admin_reserva rebaixa um admin_reserva de volta pra armeiro depois
      // que um admin_global já tinha promovido esse mesmo alvo). Reexecuta
      // o UPDATE só se o role no banco ainda for o mesmo que foi checado.
      if (roleIsChanging) {
        updateQuery = updateQuery.eq("role", targetForStatusCheck!.role);
      }

      const { data, error } = await updateQuery.select("id").maybeSingle();

      if (error) return c.json({ error: error.message }, 500);
      if (!data) {
        return c.json(
          { error: roleIsChanging
            ? "O papel deste usuário mudou nesse meio tempo. Recarregue e tente novamente."
            : "Usuário não encontrado" },
          roleIsChanging ? 409 : 404
        );
      }
    }

    // Executa a escrita de reserve_memberships só agora — depois que o
    // UPDATE de profiles acima (quando presente) confirmou sucesso, inclusive
    // passando pelo lock otimista de roleIsChanging. Ver comentário em
    // pendingReserveWrite acima.
    if (pendingReserveWrite) {
      const { toAdd, toRemove, effectiveRole } = pendingReserveWrite;
      if (toAdd.length > 0) {
        const { error: addErr } = await supabase.from("reserve_memberships").upsert(
          toAdd.map((reserve_id) => ({ user_id: targetId, reserve_id, role: effectiveRole })),
          { onConflict: "reserve_id,user_id" }
        );
        // Achado de code review: mensagem de erro do Supabase pode expor
        // nomes de constraint/coluna (achado consistente com o padrão já
        // usado no resto deste arquivo — log interno com detalhe, resposta
        // ao cliente genérica).
        if (addErr) {
          c.get("log").error({ error: addErr.message, targetId }, "profiles.reserve_write.add_failure");
          return c.json({ error: "Erro ao atualizar reservas do usuário" }, 500);
        }
      }
      if (toRemove.length > 0) {
        const { error: delErr } = await supabase
          .from("reserve_memberships")
          .delete()
          .in("id", toRemove.map((r) => r.id));
        if (delErr) {
          c.get("log").error({ error: delErr.message, targetId }, "profiles.reserve_write.remove_failure");
          return c.json({ error: "Erro ao atualizar reservas do usuário" }, 500);
        }
      }
      reservesChanged = toAdd.length > 0 || toRemove.length > 0;
      if (reservesChanged) {
        reserveAuditMeta = {
          reserve_ids_added: toAdd,
          reserve_ids_removed: toRemove.map((r) => r.reserve_id),
        };
      }
    }

    // Mantém tenant_memberships.role em sincronia — mesmo par de tabelas já
    // atualizado junto na criação (admin.ts). Fire-and-forget: não é lido em
    // nenhuma decisão de autorização (session.role vem só de profiles.role,
    // ver auth.ts), então uma falha aqui não deixa a conta com privilégio
    // divergente do que o sistema realmente aplica — só um dado secundário
    // ficando temporariamente desatualizado.
    if (roleIsChanging) {
      supabase
        .from("tenant_memberships")
        .update({ role: body.role })
        .eq("user_id", targetId)
        .eq("tenant_id", tenantId)
        .then(({ error: syncErr }) => {
          if (syncErr) c.get("log").warn({ targetId, error: syncErr.message }, "profiles.role_sync.tenant_membership_failed");
        });
    }

    // Audit only if status or role ACTUALLY changed — não só "presente no
    // body" (achado de code review: o dialog de edição sempre reenvia
    // registration_status mesmo sem o admin ter mexido nele; usar a
    // presença em vez de statusIsChanging gravava uma linha de audit log
    // sugerindo mudança de status em toda edição de perfil, até uma
    // troca isolada de telefone).
    if (statusIsChanging || roleIsChanging || reservesChanged) {
      await supabase.from("audit_logs").insert({
        actor_id: callerId,
        action: "profile.updated",
        resource_type: "profiles",
        resource_id: targetId,
        metadata: {
          fields: Object.keys(updatePayload),
          ...(roleIsChanging ? { role_anterior: targetForStatusCheck!.role, role_novo: body.role } : {}),
          ...(reserveAuditMeta ?? {}),
        },
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
  zValidator("json", z.object({ status: STATUS_INPUT })),
  async (c) => {
    const targetId = c.req.param("id");
    const callerRole = c.get("role");
    const callerId = c.get("userId");
    const { status: requestedStatus } = c.req.valid("json");

    if (callerId === targetId) {
      return c.json({ error: "Não é possível alterar o próprio status." }, 403);
    }

    if ((callerRole === "armeiro" || callerRole === "admin_reserva") && requestedStatus === "impedimento_administrativo") {
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

    // "complete"/"pending_biometric" nunca são setáveis manualmente aqui —
    // só a RPC de enrollment biométrico seta "complete" de verdade, e
    // "reactivate" (usado por ChangeStatusButton pra "Ativar conta"/
    // "Remover Impedimento") resolve pro estado real checando se o usuário
    // TEM template biométrico cadastrado. Ver resolveRegistrationStatus().
    const resolution = await resolveRegistrationStatus(requestedStatus, current.registration_status, targetId);
    if (!resolution.ok) return c.json({ error: resolution.error }, 400);
    const status = resolution.status;

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

// POST /api/profiles/me/photo — processamento e troca da foto do próprio usuário
profileRoutes.post("/me/photo", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Não autenticado" }, 401);

  const parsed = await readProfilePhotoFile(c);
  if ("response" in parsed) return parsed.response;

  try {
    const result = await replaceProfilePhoto(
      {
        actor: {
          userId,
          role: c.get("role"),
          tenantId: c.get("tenantId"),
        },
        targetProfileId: userId,
        rawBytes: parsed.bytes,
      },
      dependenciesFor(c),
    );
    return c.json({ ok: true, photoPath: result.photoPath });
  } catch (error) {
    return profilePhotoErrorResponse(c, error);
  }
});

profileRoutes.post(
  "/:id/photo",
  roleGuard("admin_global", "admin_reserva", "armeiro"),
  async (c) => {
    const parsed = await readProfilePhotoFile(c);
    if ("response" in parsed) return parsed.response;

    try {
      const result = await replaceProfilePhoto(
        {
          actor: {
            userId: c.get("userId"),
            role: c.get("role"),
            tenantId: c.get("tenantId"),
          },
          targetProfileId: c.req.param("id"),
          rawBytes: parsed.bytes,
        },
        dependenciesFor(c),
      );
      return c.json({ ok: true, photoPath: result.photoPath });
    } catch (error) {
      return profilePhotoErrorResponse(c, error);
    }
  },
);

profileRoutes.get("/:id/photo-url", async (c) => {
  const profileId = c.req.param("id");
  c.header("Cache-Control", "private, no-store");
  try {
    const result = await resolveProfilePhotoUrl(
      {
        actor: {
          userId: c.get("userId"),
          role: c.get("role"),
          tenantId: c.get("tenantId"),
        },
        targetProfileId: profileId,
      },
      {
        supabaseUrl: process.env.SUPABASE_URL!,
        profiles: {
          async findForPhotoRead(input) {
            let query = supabase
              .from("profiles")
              .select("id, foto_url")
              .eq("id", input.profileId);
            if (!input.ownProfile) {
              query = query.eq("default_tenant_id", input.tenantId);
            }
            const { data, error } = await query.maybeSingle();
            if (error) throw error;
            return data
              ? {
                  id: data.id as string,
                  photoReferenceRaw: data.foto_url as string | null,
                }
              : null;
          },
        },
        storage: {
          async createSignedUrl(path, expiresInSeconds) {
            const { data, error } = await supabase.storage
              .from(PROFILE_PHOTO_BUCKET)
              .createSignedUrl(path, expiresInSeconds);
            if (error || !data?.signedUrl) {
              throw error ?? new Error("signed URL ausente");
            }
            return data.signedUrl;
          },
        },
      },
    );
    return c.json(result);
  } catch (error) {
    if (error instanceof ProfilePhotoReadError) {
      const status = ({
        PROFILE_PHOTO_FORBIDDEN: 403,
        PROFILE_PHOTO_TARGET_NOT_FOUND: 404,
        PROFILE_PHOTO_INVALID_REFERENCE: 500,
        PROFILE_PHOTO_SIGN_FAILED: 502,
      } as const)[error.code];
      if (error.code === "PROFILE_PHOTO_INVALID_REFERENCE") {
        c.get("log").warn({ profileId }, "profile_photo.invalid_reference");
      }
      return c.json({ error: error.message, code: error.code }, status);
    }
    c.get("log").error(
      { profileId, error: error instanceof Error ? error.message : "unknown" },
      "profile_photo.read_failed",
    );
    return c.json({ error: "Erro ao consultar perfil" }, 500);
  }
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

// GET /api/profiles/:id/reserves — reservas ATUAIS de um usuário-alvo
// (distinto de /me/reserves acima, que é sempre sobre o próprio caller).
// Usado pelo dialog de edição de usuário para pré-marcar os checkboxes de
// reserva quando o alvo já é armeiro/admin_reserva em uma ou mais reservas —
// sem isto o admin não tinha como saber, ao abrir o formulário, onde a
// pessoa já atuava antes de editar. Rota de leitura, sem side-effect: mesmo
// teto de rota (armeiro/admin_reserva/admin_global) do resto do arquivo,
// escopada por tenant contra enumeração cross-tenant.
profileRoutes.get(
  "/:id/reserves",
  roleGuard("admin_global", "admin_reserva", "armeiro"),
  async (c) => {
    const targetId = c.req.param("id");
    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);

    const { data: target } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", targetId)
      .eq("default_tenant_id", tenantId)
      .maybeSingle();
    if (!target) return c.json({ error: "Usuário não encontrado" }, 404);

    // Join com reserves + filtro por tenant_id — defesa em profundidade
    // (achado de code review): `target` já foi confirmado do MESMO tenant do
    // caller acima, então uma reserve_membership deste user_id só poderia
    // referenciar uma reserva de outro tenant por uma anomalia de dado já
    // existente em outro lugar (reserve_memberships não tem tenant_id
    // próprio, é derivado via reserve_id -> reserves.tenant_id) — não algo
    // que esta rota introduz, mas filtrar aqui custa uma junção e elimina a
    // superfície por completo, mesmo padrão de "RLS também garante, mas
    // defense-in-depth" já usado em outras rotas deste arquivo.
    const { data: memberships } = await supabase
      .from("reserve_memberships")
      .select("reserve_id, reserves!inner(tenant_id)")
      .eq("user_id", targetId)
      .eq("reserves.tenant_id", tenantId);

    return c.json({ reserve_ids: (memberships ?? []).map((m) => m.reserve_id as string) });
  }
);

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
