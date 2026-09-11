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
import { persistEmailLog, persistEmailFailureAudit } from "../lib/email-log";
import { isInviteDebounced } from "../lib/invite-debounce";
import { classifyGotrueError } from "../lib/gotrue-error";
import { classifyEmailUpdateOutcome } from "../lib/acesso-email-update.ts";
import type { HonoVariables } from "../types/hono";

const ROLE_LABEL: Record<string, string> = {
  admin_global: "Administrador Global",
  admin_reserva: "Administrador de Reserva",
  armeiro: "Armeiro",
  auditor: "Auditor",
  usuario: "Efetivo",
};

// user_ids com um provisionamento de acesso em andamento — anti-corrida do
// POST /users/enviar-acesso (ver comentário no handler). Escopo de módulo:
// vive enquanto o processo do BFF, que hoje é instância única.
const provisioningInFlight = new Set<string>();

// supabase-js resolve com { error } em falha de constraint/enum (não rejeita);
// só rejeita em falha de rede/exceção. Extrai a mensagem de erro nos dois casos.
function settledDbError(r: PromiseSettledResult<unknown>): string | undefined {
  if (r.status === "rejected") return String(r.reason);
  const err = (r.value as { error?: { message?: string } | null } | null)?.error;
  return err?.message ?? undefined;
}
import {
  processProfilePhoto,
  ProfilePhotoError,
} from "../domain/profile-photo/process-profile-photo";
import { PROFILE_PHOTO_FILE_LIMIT_BYTES } from "../middleware/request-body-limit";
import { resolveCreationReserveId, isStaffReserveRole, STAFF_RESERVE_ROLES } from "../lib/reserve-staff";

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
    reserve_id:       z.string().uuid().nullable().optional(), // SP2: reserva do militar (obrigatório quando o criador está em matriz)
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

    // SP2 (F11): o militar entra numa reserva já na criação. Reserva = a do
    // seletor (se veio) ou a reserva ativa do criador. Criador em matriz
    // (admin_global/auditor sem reserva ativa) sem seletor → 400 ANTES de
    // criar auth user/profile (fail-fast, sem rollback). O militar comum
    // sempre entra como 'usuario'; se `role` for staff (admin_global criando
    // um armeiro fora do fluxo /estrutura), a linha usa o próprio `role`.
    const { reserveId: creationReserveId, needsSelector } = resolveCreationReserveId({
      creatorRole: callerRole,
      creatorActiveReserveId: c.get("reserveId") ?? null,
      explicitReserveId: body.reserve_id ?? null,
    });
    if (needsSelector) {
      c.get("log").warn({ callerRole }, "admin.militares.reserve_selector_required");
      return c.json({ error: "Selecione a reserva do militar." }, 400);
    }

    const supabaseUrl  = process.env.SUPABASE_URL!;
    const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const internalEmail = `${body.matricula.toLowerCase().replace(/\W/g, "")}.interno@apmcb.sistema`;
    const log = c.get("log");

    // Matrícula já cadastrada? O e-mail sintético abaixo colidiria no GoTrue
    // ("email already registered") e o erro virava um 500 genérico e mudo
    // (achado prod 2026-09-09: matrícula 5246367 já existente → 500). Barrar
    // aqui, com mensagem que aponta pro fluxo de militar já cadastrado.
    const { data: matriculaExistente, error: matriculaErr } = await supabase
      .from("profiles")
      .select("id")
      .eq("matricula", body.matricula)
      .maybeSingle();
    if (matriculaErr) log.warn({ err: matriculaErr.message }, "admin.militares.matricula_precheck_failure");
    if (matriculaExistente) {
      return c.json(
        { error: 'Matrícula já cadastrada. Use "Militar já cadastrado" para provisionar acesso ou ajustar o perfil.' },
        409,
      );
    }

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
      // SEMPRE logar (regra canônica: nenhuma falha responde ao cliente sem rastro).
      const { detail, code, isDuplicate } = classifyGotrueError(await createRes.text());
      log.error(
        { status: createRes.status, code, detail },
        "admin.militares.create_user_failure",
      );
      return c.json(
        { error: isDuplicate ? "Matrícula já cadastrada." : "Erro ao criar usuário" },
        isDuplicate ? 409 : 500,
      );
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

    // tenant_membership + auditoria em paralelo — independentes, e nenhum muda
    // a resposta (o profile já existe). role_enum não tem "member" (achado do
    // backfill: este upsert falhava em silêncio porque o retorno não era checado).
    // allSettled: nem membership nem auditoria mudam a resposta (o profile já
    // existe) — uma falha de rede num deles não deve virar 500 com o militar
    // já criado.
    // SP2: militar comum entra como 'usuario'; papel de staff (raro nesta rota)
    // entra com o próprio papel. onConflict (reserve_id,user_id) = idempotente.
    const reserveMembershipRole = isStaffReserveRole(userRole) ? userRole : "usuario";

    const [membershipSettled, reserveMembershipSettled, auditSettled] = await Promise.allSettled([
      supabase.from("tenant_memberships").upsert(
        { tenant_id: tenantId, user_id: userId, role: userRole },
        { onConflict: "tenant_id,user_id" },
      ),
      supabase.from("reserve_memberships").upsert(
        { reserve_id: creationReserveId, user_id: userId, role: reserveMembershipRole },
        { onConflict: "reserve_id,user_id" },
      ),
      supabase.from("audit_logs").insert({
        actor_id: actorId,
        action: "admin.militar.created",
        resource_type: "profiles",
        resource_id: userId,
        metadata: { role: userRole, caller_role: callerRole, matricula: body.matricula, reserve_id: creationReserveId },
      }),
    ]);
    // supabase-js NÃO rejeita por erro de constraint/enum — resolve com
    // { error }. Checar os dois: rejeição (rede) E value.error (DB).
    const membershipErr = settledDbError(membershipSettled);
    if (membershipErr) log.error({ error: membershipErr, userId, tenantId }, "admin.militar.tenant_membership_failure");
    const reserveMembershipErr = settledDbError(reserveMembershipSettled);
    if (reserveMembershipErr) log.error({ error: reserveMembershipErr, userId, reserveId: creationReserveId }, "admin.militar.reserve_membership_failure");
    const auditErr = settledDbError(auditSettled);
    if (auditErr) log.error({ error: auditErr, userId }, "admin.militar.audit_failure");

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

    // Debounce do reenvio (só morde se um envio anterior foi concluído —
    // invite_sent_at é gravado só após sendEmail ok).
    if (isInviteDebounced(target.invite_sent_at)) {
      return c.json({ error: "Um e-mail de acesso acabou de ser enviado. Aguarde alguns segundos antes de reenviar." }, 429);
    }

    // Guarda in-flight: fecha a janela de corrida entre o SELECT de
    // invite_sent_at e a gravação (que só acontece depois do sendEmail). Sem
    // isso, dois requests concorrentes para o mesmo user_id gerariam dois
    // recovery links (o 1º invalidado) e dois e-mails. Em memória — o BFF roda
    // uma instância; num cenário multi-instância cai no debounce como backstop.
    if (provisioningInFlight.has(user_id)) {
      return c.json({ error: "Já há um envio de acesso em andamento para este militar. Aguarde." }, 409);
    }
    provisioningInFlight.add(user_id);
    try {

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
        // O GoTrue devolve a violação de `users_email_partial_key` (e-mail já
        // de outra conta) como um 500 "Error updating user" genérico — não dá
        // pra confiar no status. Re-confere o dono e classifica com
        // classifyEmailUpdateOutcome (testado).
        const { data: recheck, error: recheckErr } = await supabase.auth.admin.getUserById(user_id);
        const outcome = classifyEmailUpdateOutcome({
          updateErrorStatus: upd.error.status,
          recheckEmail: recheckErr ? null : (recheck?.user?.email ?? null),
          targetEmail: alvo,
        });
        if (!outcome.ok) {
          log.warn(
            { status: upd.error.status, err: upd.error.message, resolved: outcome.status },
            outcome.status === 409 ? "admin.acesso.email_conflito" : "admin.acesso.update_email_failure",
          );
          return c.json({ error: outcome.error }, outcome.status ?? 500);
        }
      }
    }

    // 2+3+4 em paralelo — nenhum depende do outro (todos só precisam de `email`
    // / `user_id`). Antes eram 3-4 round-trips sequenciais (~1s desperdiçado no
    // spinner). `frontendUrl` é síncrono.
    const frontendUrl = (process.env.FRONTEND_URL ?? "https://apmcb.pmpb.online").replace(/\/$/, "");
    const [profRes, link, orgao] = await Promise.all([
      supabase.from("profiles").update({ email }).eq("id", user_id),
      supabase.auth.admin.generateLink({ type: "recovery", email }),
      (async (): Promise<string | null> => {
        const { data: rm, error: rmErr } = await supabase
          .from("reserve_memberships")
          .select("reserves(nome)")
          .eq("user_id", user_id)
          .limit(1)
          .maybeSingle();
        if (rmErr) log.warn({ err: rmErr.message }, "admin.acesso.orgao_reserve_lookup_failure");
        const r = (rm?.reserves as { nome?: string } | null)?.nome ?? null;
        if (r) return r;
        const { data: t, error: tErr } = await supabase.from("tenants").select("nome").eq("id", tenantId).maybeSingle();
        if (tErr) log.warn({ err: tErr.message }, "admin.acesso.orgao_tenant_lookup_failure");
        return t?.nome ?? null;
      })(),
    ]);
    if (profRes.error) log.error({ err: profRes.error.message }, "admin.acesso.profile_update_failure");

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

    // 5. e-mail "acesso"
    const primeiro = primeiroNome(target.nome_completo, "militar");
    const rendered = renderTemplate(
      "acesso",
      { papel: ROLE_LABEL[target.role] ?? target.role, url: actionLink },
      { baseUrl: frontendUrl, logoDataUri: "" },
      { nome: primeiro, orgao },
    );
    const emailRes = await sendEmail({
      to: email, subject: rendered.subject, html: rendered.html, text: rendered.text,
      category: "lifecycle", log,
    });

    // AGUARDADO: stamp (debounce/guard) + trilha durável de auditoria — precisam
    // sobreviver a um restart do container no meio (achado de review: audit_logs
    // é a fonte de verdade de GET /api/nexus/errors e do debug pós-deploy).
    const durable: PromiseLike<unknown>[] = [
      supabase.from("audit_logs").insert({
        actor_id: actorId,
        action: "admin.user.access_provisioned",
        resource_type: "profiles",
        resource_id: user_id,
        metadata: { email, target_role: target.role, caller_role: callerRole, email_sent: emailRes.ok },
      }),
    ];
    if (emailRes.ok) {
      durable.push(
        supabase.from("profiles").update({ invite_sent_at: new Date().toISOString() }).eq("id", user_id),
      );
    } else {
      durable.push(persistEmailFailureAudit(
        { template: "acesso", category: "lifecycle", error_code: emailRes.error, actor_id: actorId, resource_id: user_id },
        log,
      ));
    }
    for (const r of await Promise.allSettled(durable)) {
      const err = settledDbError(r);
      if (err) log.error({ err }, "admin.acesso.durable_write_failure");
    }

    // DETACHED: email_log + notificação in-app — não bloqueiam a resposta e uma
    // perda no restart é tolerável (o e-mail em si já saiu; o card do sino é
    // reforço).
    void Promise.allSettled([
      persistEmailLog({
        template: "acesso", category: "lifecycle", recipient_id: user_id,
        status: emailRes.ok ? "sent" : "failed",
        resend_id: emailRes.ok ? emailRes.id : null,
        error_code: emailRes.ok ? null : emailRes.error,
      }, log),
      supabase.from("notifications").insert({
        user_id,
        type: "account_created",
        title: `Seja bem-vindo, ${primeiro}`,
        body: "Dirija-se à reserva da sua unidade para o registro de biometria. Seu código dinâmico já está funcional.",
        tenant_id: tenantId,
        metadata: { provisioned_by: actorId, provisioned_by_role: callerRole },
      }),
    ]).then((results) => {
      for (const r of results) {
        const err = settledDbError(r);
        if (err) log.error({ err }, "admin.acesso.trailing_write_failure");
      }
    });

    return c.json({ ok: true, email_sent: emailRes.ok });

    } finally {
      provisioningInFlight.delete(user_id);
    }
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
// SP2 (MÉDIO-3, F11): 3 achados do review do SP1 corrigidos aqui —
//  1. pre-check contava TODA reserve_membership, inclusive role='usuario'
//     (militar comum, desde a Task 3/4) — bloqueava a deleção mesmo quando só
//     havia efetivo, não staff. Agora só bloqueia por STAFF_RESERVE_ROLES;
//     memberships de usuario são removidas junto (o militar só perde o
//     vínculo com ESTA reserva, não a conta).
//  2. sem status='inativa' antes → race: alguém entra na reserva entre o
//     pre-check e o delete final (profiles_validate_active_reserve passa a
//     rejeitar active_reserve_id pra reserva não-ativa, fechando a janela).
//  3. o DELETE final não checava `error` — 200 mentiroso se a query falhasse.
adminRoutes.delete(
  "/reserves/:id",
  roleGuard("admin_global"),
  async (c) => {
    const id       = c.req.param("id");
    const tenantId = c.get("tenantId");
    const log      = c.get("log");

    const { data: reserve, error: statusErr } = await supabase
      .from("reserves")
      .update({ status: "inativa" })
      .eq("id", id)
      .eq("tenant_id", tenantId!)
      .select("id")
      .maybeSingle();
    if (statusErr) {
      log.error({ error: statusErr.message, id }, "admin.reserve.delete_status_failure");
      return c.json({ error: "Erro ao iniciar a exclusão da reserva" }, 500);
    }
    if (!reserve) return c.json({ error: "Reserva não encontrada" }, 404);

    // Checar materiais ou STAFF (não efetivo) — só isso bloqueia a deleção.
    const [{ count: mats }, { count: staffCount }] = await Promise.all([
      supabase.from("material_types").select("id", { count: "exact", head: true }).eq("reserve_id", id),
      supabase.from("reserve_memberships").select("id", { count: "exact", head: true })
        .eq("reserve_id", id).in("role", STAFF_RESERVE_ROLES),
    ]);
    if ((mats ?? 0) > 0 || (staffCount ?? 0) > 0) {
      // reverte — não deixa a reserva "meio deletada" (inativa sem querer)
      const { error: revertErr } = await supabase.from("reserves").update({ status: "ativa" }).eq("id", id);
      if (revertErr) log.error({ error: revertErr.message, id }, "admin.reserve.delete_revert_failure");
      return c.json({
        error: `Reserve possui ${mats ?? 0} tipo(s) de material e ${staffCount ?? 0} membro(s) de equipe. Transfira ou remova antes de deletar.`,
        details: { materiais: mats, staff: staffCount },
      }, 409);
    }

    // Ninguém mais entra (status='inativa') — limpa quem já estava: reserva
    // ativa de todo mundo (staff já removido acima; sobra só efetivo) e as
    // memberships (agora só role='usuario') antes do DELETE final.
    const { error: clearActiveErr } = await supabase
      .from("profiles")
      .update({ active_reserve_id: null })
      .eq("active_reserve_id", id);
    if (clearActiveErr) log.error({ error: clearActiveErr.message, id }, "admin.reserve.delete_clear_active_failure");

    const { error: clearMembershipsErr } = await supabase
      .from("reserve_memberships")
      .delete()
      .eq("reserve_id", id);
    if (clearMembershipsErr) log.error({ error: clearMembershipsErr.message, id }, "admin.reserve.delete_clear_memberships_failure");

    const { error: deleteErr } = await supabase.from("reserves").delete().eq("id", id).eq("tenant_id", tenantId!);
    if (deleteErr) {
      log.error({ error: deleteErr.message, id }, "admin.reserve.delete_failure");
      return c.json({ error: "Erro ao excluir a reserva" }, 500);
    }
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
