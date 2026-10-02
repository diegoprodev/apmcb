import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../lib/validated-json";
import { roleGuard } from "../middleware/role-guard";
import { supabase } from "../services/supabase";
import { logFailure, logRejection, rejectionDetail } from "../lib/rejection-log";
import { firstNotOperable, reserveAdminStates, ReserveAdminLookupError, type ReserveAdminState } from "../lib/reserve-admin";
import { provisionMilitar, provisionAccess, type AdminCtx, type MilitarCreateBody } from "./admin";
import type { HonoVariables } from "../types/hono";

// Import de militares (CSV/XLSX lidos no navegador) + "adicionar à reserva".
// Quem pode: admin_global, admin_reserva, armeiro. O militar entra sempre como
// 'usuario'. Vincular a uma reserva (membro) dispara o convite por e-mail
// automaticamente. Sem reserva: só o perfil é criado (vincular depois).
export const militaresImportRoutes = new Hono<{ Variables: HonoVariables }>();

type ReserveTarget = { id: string; nome: string; acronym: string | null; admin_state: ReserveAdminState };

/**
 * Reservas às quais o chamador pode adicionar membros: admin_global = todas as
 * ativas do tenant; admin_reserva = as que administra; armeiro = as de que é membro.
 * Lança ReserveAdminLookupError/Error em falha de banco (o caller responde 500).
 */
async function callerReserveTargets(c: AdminCtx): Promise<ReserveTarget[]> {
  const role = c.get("role");
  const tenantId = c.get("tenantId")!;
  const actorId = c.get("userId")!;
  let ids: string[] | null = null;
  if (role !== "admin_global") {
    const q = supabase.from("reserve_memberships").select("reserve_id").eq("user_id", actorId);
    const { data, error } = await (role === "admin_reserva" ? q.eq("role", "admin_reserva") : q.eq("role", "armeiro"));
    if (error) throw new ReserveAdminLookupError(error.code);
    ids = [...new Set((data ?? []).map((r) => r.reserve_id as string))];
    if (ids.length === 0) return [];
  }
  let rq = supabase.from("reserves").select("id, nome, acronym").eq("tenant_id", tenantId).eq("status", "ativa").order("nome");
  if (ids) rq = rq.in("id", ids);
  const { data: reserves, error: rErr } = await rq;
  if (rErr) throw new ReserveAdminLookupError(rErr.code);
  const list = (reserves ?? []) as Array<{ id: string; nome: string; acronym: string | null }>;
  const states = await reserveAdminStates(list.map((r) => r.id), null);
  return list.map((r) => ({ ...r, admin_state: states.get(r.id) ?? "no_admin" }));
}

// GET /api/admin/reserve-targets — reservas onde o chamador pode adicionar membros (+ a reserva oficial).
militaresImportRoutes.get("/reserve-targets", roleGuard("admin_global", "admin_reserva", "armeiro"), async (c) => {
  const tenantId = c.get("tenantId");
  if (!tenantId) {
    logRejection(c, "admin.reserve_targets.rejected", { reason: "no_session_tenant", actorId: c.get("userId") });
    return c.json({ error: "Tenant não identificado" }, 403);
  }
  try {
    const targets = await callerReserveTargets(c);
    const official = c.get("reserveId") ?? null;
    return c.json({ reserves: targets, default_reserve_id: targets.some((t) => t.id === official) ? official : (targets.length === 1 ? targets[0].id : null) });
  } catch (err) {
    if (!(err instanceof ReserveAdminLookupError)) throw err;
    logFailure(c, { code: err.code, tenantId }, "admin.reserve_targets.failure");
    return c.json({ error: "Erro ao carregar as reservas" }, 500);
  }
});

// Teto por requisição: o import é sequencial (cada linha cria usuário e envia e-mail) — blocos pequenos
// evitam estourar o timeout do proxy/servidor; o navegador envia em vários blocos.
export const IMPORT_MAX_ROWS = 50;

const matriculaSchema = z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9][A-Za-z0-9.\-/]*$/, "Matrícula inválida");
// Fórmula de planilha (=, +, -, @, tab, CR) no começo do texto: recusado no cadastro (injeção CSV/XLSX
// quando o nome for exportado em relatório).
const safeText = (max: number, min = 0) => z.string().trim().min(min).max(max).refine((v) => !/^[=+\-@\t\r]/.test(v), "Texto inválido");
const RowSchema = z.object({
  nome_completo: safeText(200, 2),
  email: z.string().trim().toLowerCase().email().max(254),
  matricula: matriculaSchema,
  posto: safeText(60).transform((v) => v || null).nullable().optional(),
});
// Linhas validadas UMA A UMA (uma linha ruim não derruba o bloco): o corpo só exige a forma geral.
const ImportSchema = z.object({
  reserve_id: z.string().uuid().nullable(),
  rows: z.array(z.unknown()).min(1).max(IMPORT_MAX_ROWS),
});

export type ImportRowStatus = "created_invited" | "created_invite_failed" | "created_no_reserve" | "exists" | "email_in_use" | "duplicate_in_file" | "blocked" | "error";

// POST /api/admin/militares/import
militaresImportRoutes.post(
  "/militares/import",
  roleGuard("admin_global", "admin_reserva", "armeiro"),
  zValidator("json", ImportSchema),
  async (c) => {
    const tenantId = c.get("tenantId");
    const actorId = c.get("userId");
    const callerRole = c.get("role");
    const { reserve_id, rows: rawRows } = c.req.valid("json");
    if (!tenantId) {
      logRejection(c, "admin.militares_import.rejected", { reason: "no_session_tenant", actorId });
      return c.json({ error: "Tenant não identificado" }, 403);
    }
    const parsedRows = rawRows.map((raw) => RowSchema.safeParse(raw));
    const rows = parsedRows.map((p, i) => (p.success ? p.data : null));

    // A reserva destino vem do cliente: precisa estar entre as que o chamador pode
    // alimentar (tenant + autoridade) e ter admin ativo (D-04, erro amigável).
    if (reserve_id) {
      try {
        const targets = await callerReserveTargets(c as AdminCtx);
        if (!targets.some((t) => t.id === reserve_id)) {
          logRejection(c, "admin.militares_import.rejected", { reason: "reserve_not_allowed", tenantId, actorId, reserveId: reserve_id });
          return c.json({ error: "Reserva inválida." }, 400);
        }
        const blocked = await firstNotOperable([reserve_id]);
        if (blocked) {
          logRejection(c, "admin.militares_import.rejected", { reason: `reserve_${blocked.code}`, tenantId, actorId, reserveId: reserve_id });
          return c.json({ error: blocked.error, code: blocked.code }, 409);
        }
      } catch (err) {
        if (!(err instanceof ReserveAdminLookupError)) throw err;
        logFailure(c, { code: err.code, tenantId }, "admin.militares_import.reserve_lookup_failure");
        return c.json({ error: "Erro ao validar a reserva" }, 500);
      }
    }

    // Pré-checagens em lote, SEMPRE restritas ao tenant do chamador: colisão com conta de OUTRO
    // tenant não pode ser distinguida aqui (sem oráculo de existência de matrícula/e-mail entre tenants).
    const valid = rows.filter((r): r is NonNullable<typeof r> => r !== null);
    const [matRes, mailRes] = valid.length === 0 ? [{ data: [], error: null }, { data: [], error: null }] : await Promise.all([
      supabase.from("profiles").select("matricula").eq("default_tenant_id", tenantId).in("matricula", valid.map((r) => r.matricula)),
      supabase.from("profiles").select("email").eq("default_tenant_id", tenantId).in("email", valid.map((r) => r.email)),
    ]);
    if (matRes.error || mailRes.error) {
      const e = matRes.error ?? mailRes.error!;
      logFailure(c, { code: e.code, detail: rejectionDetail(e.message), tenantId }, "admin.militares_import.precheck_failure");
      return c.json({ error: "Erro ao validar o arquivo" }, 500);
    }
    const existingMat = new Set((matRes.data ?? []).map((r) => String(r.matricula).toLowerCase()));
    const existingMail = new Set((mailRes.data ?? []).map((r) => String(r.email ?? "").toLowerCase()));
    const seenMat = new Set<string>();
    const seenMail = new Set<string>();
    const GENERIC = "Não foi possível cadastrar esta linha. Confira os dados ou fale com o administrador.";

    const results: Array<{ line: number; matricula: string; email: string; status: ImportRowStatus; message: string }> = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const line = i + 1;
      if (!r) {
        const raw = (rawRows[i] ?? {}) as { matricula?: unknown; email?: unknown };
        const issue = parsedRows[i].success ? "Linha inválida." : (parsedRows[i] as { error: z.ZodError }).error.issues[0]?.message ?? "Linha inválida.";
        results.push({ line, matricula: String(raw.matricula ?? "").slice(0, 30), email: String(raw.email ?? "").slice(0, 254), status: "error", message: `Linha inválida: ${issue}` });
        continue;
      }
      const base = { line, matricula: r.matricula, email: r.email };
      const matKey = r.matricula.toLowerCase();
      if (seenMat.has(matKey) || seenMail.has(r.email)) {
        results.push({ ...base, status: "duplicate_in_file", message: "Matrícula ou e-mail repetido no arquivo." });
        continue;
      }
      seenMat.add(matKey); seenMail.add(r.email);
      if (existingMat.has(matKey)) {
        results.push({ ...base, status: "exists", message: "Matrícula já cadastrada — use \"Adicionar à reserva\" no filtro de militares sem reserva." });
        continue;
      }
      if (existingMail.has(r.email)) {
        results.push({ ...base, status: "email_in_use", message: "E-mail já cadastrado em outra conta." });
        continue;
      }

      const created = await provisionMilitar(
        c as AdminCtx,
        { nome_completo: r.nome_completo, matricula: r.matricula, posto: r.posto ?? null, role: "usuario" } as MilitarCreateBody,
        { reserveId: reserve_id, contactEmail: r.email },
      );
      const createdBody = (await created.json().catch(() => ({}))) as { success?: boolean; user_id?: string; membership_ok?: boolean; error?: string; code?: string };
      if (created.status !== 200 || !createdBody.user_id) {
        // Só o bloqueio de reserva (D-04) tem mensagem própria; o resto é genérico (colisão fora do tenant etc.).
        c.get("log").warn({ status: created.status, code: createdBody.code ?? null, tenantId, line }, "admin.militares_import.row_failed");
        results.push(createdBody.code
          ? { ...base, status: "blocked", message: createdBody.error ?? GENERIC }
          : { ...base, status: "error", message: GENERIC });
        continue;
      }
      if (!reserve_id) {
        results.push({ ...base, status: "created_no_reserve", message: "Cadastrado sem reserva — adicione a uma reserva para enviar o convite." });
        continue;
      }
      if (createdBody.membership_ok === false) {
        // Vínculo falhou (logado em provisionMilitar): sem convite e sem prometer "membro".
        results.push({ ...base, status: "created_invite_failed", message: "Cadastrado, mas não foi possível vinculá-lo à reserva. Use \"Adicionar à reserva\" no filtro Sem reserva." });
        continue;
      }
      // Membro de uma reserva: o convite sai automaticamente.
      const access = await provisionAccess(c as AdminCtx, createdBody.user_id, r.email);
      const accessBody = (await access.json().catch(() => ({}))) as { email_sent?: boolean; error?: string };
      if (access.status === 200 && accessBody.email_sent) {
        results.push({ ...base, status: "created_invited", message: "Cadastrado e convite enviado." });
      } else {
        // Mensagem FIXA (não repassa accessBody.error): o texto do envio pode revelar que o e-mail já é login em outro tenant.
        c.get("log").warn({ status: access.status, tenantId, line }, "admin.militares_import.invite_failed");
        results.push({ ...base, status: "created_invite_failed", message: "Cadastrado, mas o convite não pôde ser enviado — reenvie pela lista de usuários." });
      }
    }

    const counts = results.reduce<Record<string, number>>((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; }, {});
    const { error: auditErr } = await supabase.from("audit_logs").insert({
      actor_id: actorId,
      action: "admin.militares.imported",
      resource_type: "profiles",
      resource_id: null,
      metadata: { caller_role: callerRole, reserve_id, total: rows.length, counts },
    });
    if (auditErr) logFailure(c, { code: auditErr.code, detail: rejectionDetail(auditErr.message), tenantId }, "admin.militares_import.audit_failure");
    invalidateSemReserva(tenantId);
    return c.json({ results, counts });
  },
);

// POST /api/admin/militares/:id/add-to-reserve — vincula o militar à reserva e envia o convite.
militaresImportRoutes.post(
  "/militares/:id/add-to-reserve",
  roleGuard("admin_global", "admin_reserva", "armeiro"),
  zValidator("json", z.object({ reserve_id: z.string().uuid() })),
  async (c) => {
    const tenantId = c.get("tenantId");
    const actorId = c.get("userId");
    const targetId = c.req.param("id");
    const { reserve_id } = c.req.valid("json");
    if (!tenantId) {
      logRejection(c, "admin.add_to_reserve.rejected", { reason: "no_session_tenant", actorId });
      return c.json({ error: "Tenant não identificado" }, 403);
    }
    if (!/^[0-9a-f-]{36}$/i.test(targetId)) return c.json({ error: "Militar não encontrado" }, 404);

    const { data: target, error: targetErr } = await supabase
      .from("profiles")
      .select("id, role, email, invite_sent_at, account_activated_at, default_tenant_id")
      .eq("id", targetId)
      .eq("default_tenant_id", tenantId)
      .maybeSingle();
    if (targetErr) {
      logFailure(c, { code: targetErr.code, detail: rejectionDetail(targetErr.message), tenantId }, "admin.add_to_reserve.lookup_failure");
      return c.json({ error: "Erro ao buscar o militar" }, 500);
    }
    if (!target || target.role !== "usuario") {
      logRejection(c, "admin.add_to_reserve.rejected", { reason: "target_not_found_or_not_militar", tenantId, actorId, targetId });
      return c.json({ error: "Militar não encontrado" }, 404);
    }

    try {
      const targets = await callerReserveTargets(c as AdminCtx);
      if (!targets.some((t) => t.id === reserve_id)) {
        logRejection(c, "admin.add_to_reserve.rejected", { reason: "reserve_not_allowed", tenantId, actorId, reserveId: reserve_id });
        return c.json({ error: "Reserva inválida." }, 400);
      }
      const blocked = await firstNotOperable([reserve_id]);
      if (blocked) {
        logRejection(c, "admin.add_to_reserve.rejected", { reason: `reserve_${blocked.code}`, tenantId, actorId, reserveId: reserve_id });
        return c.json({ error: blocked.error, code: blocked.code }, 409);
      }
    } catch (err) {
      if (!(err instanceof ReserveAdminLookupError)) throw err;
      logFailure(c, { code: err.code, tenantId }, "admin.add_to_reserve.reserve_lookup_failure");
      return c.json({ error: "Erro ao validar a reserva" }, 500);
    }

    // Só quem está SEM reserva entra por aqui (o filtro "Sem reserva"): puxar um militar que já é membro
    // de outra reserva é decisão daquela reserva, não deste fluxo.
    const { data: existing, error: existingErr } = await supabase
      .from("reserve_memberships").select("id, reserve_id").eq("user_id", targetId).limit(1);
    if (existingErr) {
      logFailure(c, { code: existingErr.code, detail: rejectionDetail(existingErr.message), tenantId }, "admin.add_to_reserve.membership_lookup_failure");
      return c.json({ error: "Erro ao adicionar à reserva" }, 500);
    }
    if ((existing ?? []).length > 0) {
      logRejection(c, "admin.add_to_reserve.rejected", { reason: "already_member", tenantId, actorId, targetId, reserveId: reserve_id });
      return c.json({ error: (existing ?? [])[0].reserve_id === reserve_id ? "O militar já é membro desta reserva." : "O militar já é membro de uma reserva." }, 409);
    }

    const { error: insErr } = await supabase
      .from("reserve_memberships").insert({ reserve_id, user_id: targetId, role: "usuario" });
    if (insErr?.code === "23505") return c.json({ error: "O militar já é membro desta reserva." }, 409);
    if (insErr) {
      logFailure(c, { code: insErr.code, detail: rejectionDetail(insErr.message), tenantId, reserveId: reserve_id }, "admin.add_to_reserve.insert_failure");
      return c.json({ error: "Erro ao adicionar à reserva" }, 500);
    }
    const { error: auditErr } = await supabase.from("audit_logs").insert({
      actor_id: actorId, action: "admin.militar.added_to_reserve", resource_type: "profiles", resource_id: targetId,
      metadata: { reserve_id, caller_role: c.get("role") },
    });
    if (auditErr) logFailure(c, { code: auditErr.code, tenantId }, "admin.add_to_reserve.audit_failure");

    invalidateSemReserva(tenantId);
    // Convite automático: só se a conta ainda não foi ativada e há e-mail real.
    const email = (target.email ?? "").trim();
    let invite: "sent" | "failed" | "already_active" | "no_email" = "no_email";
    if (target.account_activated_at) invite = "already_active";
    else if (email && !email.toLowerCase().endsWith(".interno@apmcb.sistema")) {
      const access = await provisionAccess(c as AdminCtx, targetId, email);
      const body = (await access.json().catch(() => ({}))) as { email_sent?: boolean };
      invite = access.status === 200 && body.email_sent ? "sent" : "failed";
    }
    return c.json({ ok: true, invite });
  },
);

// GET /api/admin/militares/sem-reserva?page=1&page_size=10&q= — militares do tenant sem NENHUMA reserva
// como membro (visível a admin_global, admin_reserva e armeiro, por decisão do dono). Paginado
// (10/20/30/50) com busca por nome, matrícula, posto ou e-mail; devolve o total para a paginação.
export const PAGE_SIZES = [10, 20, 30, 50] as const;
const SEM_RESERVA_TTL_MS = 10_000;
const semReservaCache = new Map<string, { at: number; matches: Array<Record<string, unknown> & { id: string; nome_completo: string; matricula: string; posto: string | null; email: string | null; invite_sent_at: string | null; account_activated_at: string | null }> }>();
/** Invalida o cache da lista "sem reserva" do tenant (após importar/adicionar à reserva). */
export function invalidateSemReserva(tenantId: string) {
  for (const k of [...semReservaCache.keys()]) if (k.startsWith(`${tenantId}|`)) semReservaCache.delete(k);
}
const SemReservaQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  page_size: z.coerce.number().int().refine((n) => (PAGE_SIZES as readonly number[]).includes(n), "page_size inválido").default(10),
  q: z.string().trim().max(100).optional(),
});
militaresImportRoutes.get("/militares/sem-reserva", roleGuard("admin_global", "admin_reserva", "armeiro"), zValidator("query", SemReservaQuery), async (c) => {
  const tenantId = c.get("tenantId");
  const actorId = c.get("userId");
  const { page, page_size, q } = c.req.valid("query");
  if (!tenantId) {
    logRejection(c, "admin.militares_sem_reserva.rejected", { reason: "no_session_tenant", actorId });
    return c.json({ error: "Tenant não identificado" }, 403);
  }
  const fail = (stage: string, err: { code?: string; message: string }) => {
    logFailure(c, { stage, code: err.code, detail: rejectionDetail(err.message), tenantId }, "admin.militares_sem_reserva.failure");
    return c.json({ error: "Erro ao buscar usuários" }, 500);
  };
  const PAGE = 1000;
  const SCAN_CAP = 20000; // teto de varredura: acima disso falha alto (refinar), não trunca em silêncio
  type SemReservaRow = { id: string; nome_completo: string; matricula: string; posto: string | null; email: string | null; invite_sent_at: string | null; account_activated_at: string | null };
  const fold = (v: string | null) => (v ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const needle = fold(q ?? "");

  // Cache curto por (tenant, busca): trocar de página/tamanho não refaz a varredura completa (autoamplificação).
  // Invalidado ao adicionar à reserva/importar; TTL curto limita a defasagem entre instâncias.
  const cacheKey = `${tenantId}|${needle}`;
  const hit = semReservaCache.get(cacheKey);
  let matches: SemReservaRow[];
  if (hit && Date.now() - hit.at < SEM_RESERVA_TTL_MS) {
    matches = hit.matches;
  } else {
  // 1) quem já é membro de alguma reserva do tenant (varredura paginada, poucas consultas).
  //    Membership em reserva de OUTRO tenant não conta (invariante: um perfil só tem reservas do próprio tenant).
  const { data: tenantReserves, error: trErr } = await supabase.from("reserves").select("id").eq("tenant_id", tenantId);
  if (trErr) return fail("reserves", trErr);
  const reserveIds = (tenantReserves ?? []).map((r) => r.id as string);
  const member = new Set<string>();
  // ids da reserva vão na query string: em blocos de 50 (centenas de reservas estourariam o limite de URL).
  for (let i = 0; i < reserveIds.length; i += 50) {
    const chunk = reserveIds.slice(i, i + 50);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("reserve_memberships").select("user_id").in("reserve_id", chunk).order("id").range(from, from + PAGE - 1);
      if (error) return fail("reserve_memberships", error);
      for (const m of data ?? []) member.add(m.user_id as string);
      if ((data ?? []).length < PAGE) break;
      if (from >= SCAN_CAP) return fail("row_cap", { message: "memberships acima do teto" });
    }
  }

  // 2) militares do tenant (varredura paginada), sem membership, filtrados pela busca, ordenados por nome.
  matches = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, nome_completo, matricula, posto, email, invite_sent_at, account_activated_at")
      .eq("default_tenant_id", tenantId)
      .eq("role", "usuario")
      .order("nome_completo")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) return fail("profiles", error);
    const rows = (data ?? []) as typeof matches;
    for (const p of rows) {
      if (member.has(p.id)) continue;
      if (needle && ![p.nome_completo, p.matricula, p.posto, p.email].some((v) => fold(v).includes(needle))) continue;
      matches.push(p);
    }
    if (rows.length < PAGE) break;
    if (from >= SCAN_CAP) return fail("row_cap", { message: "profiles acima do teto" });
  }
  semReservaCache.set(cacheKey, { at: Date.now(), matches });
  if (semReservaCache.size > 200) for (const k of semReservaCache.keys()) { semReservaCache.delete(k); if (semReservaCache.size <= 100) break; }
  }
  // Página além do fim (ex.: o último item da última página foi adicionado): serve a última e devolve a efetiva.
  const lastPage = Math.max(1, Math.ceil(matches.length / page_size));
  const effective = Math.min(page, lastPage);
  const start = (effective - 1) * page_size;
  return c.json({ militares: matches.slice(start, start + page_size), total: matches.length, page: effective, page_size });
});
