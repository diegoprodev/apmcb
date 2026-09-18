import type { SupabaseClient } from "@supabase/supabase-js";

// Fase 5 da spec de rastreabilidade enterprise (histórico completo por
// item de material + ações de usuário). Duas trilhas de auditoria
// paralelas e desconectadas existem hoje: `audit_events` (canônica,
// hash-chain, usada por cautelamentos/handovers/inventory/arsenal/saidas/
// signatures/parte de admin) e `audit_logs` (legada, sem hash-chain,
// usada por auth/totp/nexus/profiles/shifts/public/internal/maior parte
// de admin.ts). As telas de consulta existentes (/admin/auditoria,
// GET /api/nexus/errors|/events) leem SÓ audit_logs — tudo que está em
// audit_events é invisível nelas. Esta camada não migra/unifica schema
// (risco alto, fora de escopo) — só dá uma VISÃO de leitura unificada
// pras telas novas (histórico de item, histórico de usuário) precisarem
// consultar as duas trilhas sem duplicar essa lógica em cada endpoint.

export interface UnifiedAuditEvent {
  id: string;
  source: "audit_logs" | "audit_events";
  actor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  // audit_logs não tem coluna reserve_id (predata o conceito de reserva) —
  // sempre null nesse source.
  reserve_id: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

export interface UnifiedAuditCursor {
  createdAt: string;
  id: string;
}

// Achado MÉDIO de code review: `reserveIds?: string[] | null` (undefined
// = irrestrito, array vazio = restrito-vazio) é um contrato fácil de
// violar por engano — um bug que devolvesse `[]` em vez de `undefined`
// por acidente silenciosamente vira "0 resultados" em vez de estourar.
// Tipo discriminado força o caller a escolher explicitamente.
export type ReserveScope =
  | { mode: "unrestricted" }
  | { mode: "restricted"; reserveIds: string[] };

export interface UnifiedAuditFilters {
  tenantId: string;
  actorId?: string;
  action?: string;
  resourceType?: string;
  // Omitido = equivalente a { mode: "unrestricted" } (ex: admin_global/
  // auditor). Ver ReserveScope acima.
  reserveScope?: ReserveScope;
  from?: string;
  to?: string;
  cursor?: UnifiedAuditCursor;
  limit?: number;
}

export interface UnifiedAuditPage {
  events: UnifiedAuditEvent[];
  hasMore: boolean;
  nextCursor: UnifiedAuditCursor | null;
  // Achado MÉDIO de code review: em modo restrito, audit_logs é excluída
  // por completo (não tem reserve_id pra verificar). Sem este campo, a
  // resposta não distingue "não há nada" de "há, mas essa trilha está
  // fora do escopo consultado" — relevante pro domínio de compliance que
  // esta camada serve.
  excludedSources: Array<"audit_logs">;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function normalizeLimit(limit?: number): number {
  if (!limit || limit < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

// Achado ALTO de code review: `.or()` do PostgREST usa `,`/`()` como
// grammar estrutural (confirmado no código-fonte de @supabase/postgrest-js
// — a lib NÃO escapa esses caracteres dentro do valor, só faz o encoding
// de transporte HTTP via URLSearchParams). created_at (timestamptz do
// Postgres) e id (uuid canônico) nunca contêm esses caracteres nos
// formatos reais — mas a função não pode simplesmente CONFIAR nisso pra
// sempre: um cursor futuro decodificado de query param do cliente sem
// validação equivalente herdaria uma classe real de "filter injection"
// do PostgREST. Valida o formato aqui, na fronteira desta camada, em vez
// de depender de todo caller futuro repetir a mesma garantia.
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidCursor(cursor: UnifiedAuditCursor): void {
  if (!ISO_TIMESTAMP_RE.test(cursor.createdAt)) {
    throw new Error(`unified-audit-reader: cursor.createdAt com formato inválido: ${JSON.stringify(cursor.createdAt)}`);
  }
  if (!UUID_RE.test(cursor.id)) {
    throw new Error(`unified-audit-reader: cursor.id com formato inválido: ${JSON.stringify(cursor.id)}`);
  }
}

// Comparador de ordenação canônico dos dois lados: created_at desc, id
// desc como tie-breaker (mesmo par usado no cursor) — precisa ser
// idêntico à ORDER BY de cada query pra o merge ficar correto. Comparação
// lexicográfica de string (não Date/epoch) é segura aqui porque as duas
// tabelas são TIMESTAMPTZ formatadas pelo mesmo PostgREST/Postgres, sempre
// no mesmo formato — premissa que deixa de valer se algum dia uma das
// fontes vier de outro serviço/formato.
function compareDesc(a: UnifiedAuditEvent, b: UnifiedAuditEvent): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

function cursorOrFilter(cursor: UnifiedAuditCursor): string {
  return `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`;
}

async function queryAuditEvents(
  supabase: SupabaseClient,
  filters: UnifiedAuditFilters,
  fetchLimit: number,
): Promise<UnifiedAuditEvent[]> {
  let query = supabase
    .from("audit_events")
    .select("id, actor_id, action, resource_type, resource_id, reserve_id, created_at, metadata")
    .eq("tenant_id", filters.tenantId);

  if (filters.actorId) query = query.eq("actor_id", filters.actorId);
  if (filters.action) query = query.eq("action", filters.action);
  if (filters.resourceType) query = query.eq("resource_type", filters.resourceType);
  if (filters.reserveScope?.mode === "restricted") query = query.in("reserve_id", filters.reserveScope.reserveIds);
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", filters.to);
  if (filters.cursor) query = query.or(cursorOrFilter(filters.cursor));

  const { data } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(fetchLimit);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    source: "audit_events" as const,
    actor_id: row.actor_id as string | null,
    action: row.action as string,
    resource_type: row.resource_type as string,
    resource_id: row.resource_id as string | null,
    reserve_id: row.reserve_id as string | null,
    created_at: row.created_at as string,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  }));
}

async function queryAuditLogs(
  supabase: SupabaseClient,
  filters: UnifiedAuditFilters,
  fetchLimit: number,
): Promise<UnifiedAuditEvent[]> {
  // Modo restrito por reserva: audit_logs não tem reserve_id, não dá pra
  // verificar se a linha pertence a uma reserva permitida — exclui a
  // trilha inteira nesse modo em vez de arriscar vazar (ver
  // UnifiedAuditPage.excludedSources, que sinaliza isso pro caller).
  if (filters.reserveScope?.mode === "restricted") return [];

  let query = supabase
    .from("audit_logs")
    .select("id, actor_id, action, resource_type, resource_id, created_at, metadata")
    .eq("tenant_id", filters.tenantId);

  if (filters.actorId) query = query.eq("actor_id", filters.actorId);
  if (filters.action) query = query.eq("action", filters.action);
  if (filters.resourceType) query = query.eq("resource_type", filters.resourceType);
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", filters.to);
  if (filters.cursor) query = query.or(cursorOrFilter(filters.cursor));

  const { data } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(fetchLimit);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    source: "audit_logs" as const,
    actor_id: row.actor_id as string | null,
    action: row.action as string,
    resource_type: row.resource_type as string,
    resource_id: row.resource_id as string | null,
    reserve_id: null,
    created_at: row.created_at as string,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  }));
}

/**
 * Consulta as duas trilhas de auditoria (audit_events canônica +
 * audit_logs legada), normaliza pro mesmo formato e devolve UMA página
 * mesclada por created_at desc, paginação cursor-based.
 *
 * Corretude da paginação por merge: pedir `limit` linhas de CADA fonte
 * (já ordenadas da mesma forma) e mesclar garante que a página resultante
 * (top `limit` do conjunto mesclado) está correta — qualquer linha que
 * pertença ao top-N global tem, por definição, no máximo N-1 linhas na
 * frente dela NO TOTAL, logo no máximo N-1 na frente dela dentro da
 * PRÓPRIA fonte — ou seja, seu rank local na própria fonte também é ≤ N.
 * Pedir N de cada fonte nunca deixa escapar uma linha que deveria estar
 * no top-N mesclado. O mesmo argumento vale recursivamente por página
 * (cursor consistente nas duas fontes).
 */
export async function queryUnifiedEvents(
  supabase: SupabaseClient,
  filters: UnifiedAuditFilters,
): Promise<UnifiedAuditPage> {
  if (filters.cursor) assertValidCursor(filters.cursor);

  const limit = normalizeLimit(filters.limit);
  const excludedSources: Array<"audit_logs"> = filters.reserveScope?.mode === "restricted" ? ["audit_logs"] : [];

  // Modo restrito com zero reservas permitidas: nada pra ver, não vale
  // nem consultar o banco (evita 2 queries inúteis + fecha por completo
  // qualquer chance de erro do PostgREST com `.in("reserve_id", [])`,
  // que alguns clientes tratam como "sem filtro" em vez de "sempre falso").
  if (filters.reserveScope?.mode === "restricted" && filters.reserveScope.reserveIds.length === 0) {
    return { events: [], hasMore: false, nextCursor: null, excludedSources };
  }

  // Pede limit+1 de cada fonte pra saber se há próxima página sem uma
  // query de count separada.
  const fetchLimit = limit + 1;
  const [eventsRows, logsRows] = await Promise.all([
    queryAuditEvents(supabase, filters, fetchLimit),
    queryAuditLogs(supabase, filters, fetchLimit),
  ]);

  const merged = [...eventsRows, ...logsRows].sort(compareDesc);
  const hasMore = merged.length > limit;
  const page = merged.slice(0, limit);
  const last = page[page.length - 1];

  return {
    events: page,
    hasMore,
    nextCursor: hasMore && last ? { createdAt: last.created_at, id: last.id } : null,
    excludedSources,
  };
}
