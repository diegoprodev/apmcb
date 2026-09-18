import type { Context } from "hono";
import { supabase } from "../services/supabase";
import type { HonoVariables } from "../types/hono";
import { computeEventHash, getLastEventHash } from "../lib/audit-hash";
import { getAuditClientIp } from "../lib/audit-client-ip";
import { logger } from "../lib/logger";

interface AuditPayload {
  action: string;
  resource_type: string;
  resource_id?: string | null;
  before_snapshot?: unknown;
  after_snapshot?: unknown;
  metadata?: Record<string, unknown>;
  // Reserva do recurso NO MOMENTO do evento — nunca preenchido antes desta
  // feature (achado real: 1480+ linhas em prod, todas reserve_id NULL).
  // Sem backfill (append-only, RULE bloqueia UPDATE) — todo evento anterior
  // fica NULL pra sempre; NULL deve ser lido como "anterior à
  // instrumentação", nunca como "sem reserva".
  reserve_id?: string | null;
}

/**
 * Audit logging with SHA-256 hash chain.
 * Returns a Promise — can be awaited for guaranteed delivery or called
 * fire-and-forget. On Supabase failure, always emits a structured log line
 * to stdout so events are never silently lost.
 */
export function auditLog(
  c: Context<{ Variables: HonoVariables }>,
  payload: AuditPayload
): Promise<void> {
  const actorId   = c.get("userId");
  const actorRole = c.get("role");
  const tenantId  = c.get("tenantId") ?? null;

  if (!actorId || !actorRole) return Promise.resolve();

  const ip        = getAuditClientIp(c.req.raw, c.get("log"));
  const userAgent = c.req.header("user-agent") ?? null;

  // Achado de code review: NÃO cair pra c.get("reserveId") (active_reserve_id
  // da sessão do ATOR) como default — a reserva do RECURSO pode ser
  // diferente (ex: admin_global sem reserva ativa criando uma cautela em
  // body.reserve_id=X; ou, em rotas sem checagem cross-reserve, um armeiro
  // de A operando explicitamente sobre um recurso de B). Aplicar esse
  // fallback retroativamente contaminaria silenciosamente reserve_id em
  // TODO auditLog() existente com o valor errado. Cada chamador que sabe a
  // reserva real do recurso passa `reserve_id` explícito; sem isso, fica
  // NULL (== "reserva não informada"), nunca um palpite.
  return _persistAuditEvent({ actorId, actorRole, tenantId, ip, userAgent }, payload)
    .then(() => undefined);
}

/**
 * Direct audit call for routes where context variables are not yet populated
 * (e.g., auth.ts during login, before session is stored in context).
 */
export function auditLogDirect(
  params: {
    actorId: string | null;
    actorRole: string | null;
    tenantId: string | null;
    ip: string | null;
    userAgent: string | null;
  },
  payload: AuditPayload
): Promise<void> {
  // actor_id é nullable no schema (evento anônimo/pré-identificação, ex:
  // token de confirmação que não resolveu a nenhum usuário); actor_role é
  // NOT NULL — essa é a única guarda real.
  if (!params.actorRole) return Promise.resolve();
  return _persistAuditEvent({
    actorId: params.actorId,
    actorRole: params.actorRole,
    tenantId: params.tenantId,
    ip: params.ip,
    userAgent: params.userAgent,
  }, payload).then(() => undefined);
}

/**
 * Audita um evento que afeta um ou mais itens de material específicos
 * (saída/devolução/cautela em lote, criação de item físico, ocorrência,
 * etc.) — grava UM evento em audit_events (custo sequencial O(1) na
 * hash-chain, que serializa insert por partição via getLastEventHash) e
 * indexa cada item_id afetado em material_item_event_index via insert
 * multi-row (sem dependência entre linhas, paralelizável). Isso é
 * deliberado: gravar 1 audit_event POR item numa operação em lote de N
 * itens serializaria N inserts dependentes na mesma cadeia de hash.
 *
 * A tabela de índice é derivada/rebuildable a partir de
 * `audit_events.metadata.item_ids` — por isso `itemIds` é sempre também
 * gravado em `metadata`, mesmo quando o insert de índice falhar.
 */
export async function auditLogForItems(
  c: Context<{ Variables: HonoVariables }>,
  payload: AuditPayload,
  itemIds: string[]
): Promise<void> {
  const actorId   = c.get("userId");
  const actorRole = c.get("role");
  const tenantId  = c.get("tenantId") ?? null;
  // Mesmo achado de auditLog(): NÃO usar c.get("reserveId") (sessão do
  // ATOR) como default — a reserva do item pode ser outra. Chamador passa
  // reserve_id explícito quando souber a reserva real do(s) item(ns).
  const reserveId = payload.reserve_id ?? null;

  if (!actorId || !actorRole) return;

  const ip        = getAuditClientIp(c.req.raw, c.get("log"));
  const userAgent = c.req.header("user-agent") ?? null;

  // Dedup: um INSERT multi-row sem ON CONFLICT falha inteiro se duas linhas
  // colidirem na unique index (material_item_id, audit_event_id) — um
  // item_id duplicado no payload de entrada não pode derrubar a indexação
  // dos outros N-1 itens válidos.
  const uniqueItemIds = [...new Set(itemIds)];

  const event = await _persistAuditEvent(
    { actorId, actorRole, tenantId, ip, userAgent },
    { ...payload, reserve_id: reserveId, metadata: { ...payload.metadata, item_ids: uniqueItemIds } },
  );

  if (!event || uniqueItemIds.length === 0) return;

  if (!tenantId) {
    // Sem tenant não há como satisfazer material_item_event_index.tenant_id
    // (NOT NULL) — o audit_event canônico já foi gravado (com item_ids em
    // metadata, recuperável via backfill), só a indexação rápida fica pra
    // trás. Não é um evento perdido, é uma indexação atrasada.
    logger.error("audit.item_index.missing_tenant", { action: payload.action, audit_event_id: event.id });
    return;
  }

  // Achado ALTO de code review: este insert (diferente do de
  // _persistAuditEvent, que já tem try/catch) podia lançar (blip de rede,
  // mesmo motivo documentado lá) e propagar sem tratamento pro chamador —
  // numa rota real (ex: PATCH /arsenal/requests/:id/approve), isso vira um
  // 500 depois da mutação de negócio já ter sido aplicada e a solicitação
  // já reivindicada, derrubando notificação/Livro Digital que vêm depois
  // do await, mesmo com a operação principal já concluída de verdade.
  // A indexação derivada nunca pode ser o motivo de uma request falhar.
  try {
    const rows = uniqueItemIds.map((itemId) => ({
      material_item_id: itemId,
      audit_event_id:   event.id,
      tenant_id:         tenantId,
      reserve_id:        reserveId,
      action:            payload.action,
      actor_id:          actorId,
      event_created_at:  event.created_at,
    }));

    const { error } = await supabase.from("material_item_event_index").insert(rows);
    if (error) {
      logger.error("audit.item_index.persist_failure", {
        audit_event_id: event.id, action: payload.action, item_count: uniqueItemIds.length, error: error.message,
      });
    }
  } catch (err) {
    logger.error("audit.item_index.persist_exception", {
      audit_event_id: event.id, action: payload.action, item_count: uniqueItemIds.length,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function _persistAuditEvent(
  actor: { actorId: string | null; actorRole: string; tenantId: string | null; ip: string | null; userAgent: string | null },
  payload: AuditPayload
): Promise<{ id: string; created_at: string } | null> {
  try {
    const previousHash = await getLastEventHash(supabase, actor.tenantId);
    const createdAt    = new Date().toISOString();

    const hashInput = {
      seq: 0,
      actor_id:        actor.actorId,
      action:          payload.action,
      resource_type:   payload.resource_type,
      resource_id:     payload.resource_id ?? null,
      before_snapshot: payload.before_snapshot ?? null,
      after_snapshot:  payload.after_snapshot  ?? null,
      created_at:      createdAt,
      previous_hash:   previousHash,
    };
    const event_hash = computeEventHash(hashInput);

    const { data, error } = await supabase.from("audit_events").insert({
      tenant_id:       actor.tenantId,
      reserve_id:      payload.reserve_id ?? null,
      actor_id:        actor.actorId,
      actor_role:      actor.actorRole,
      action:          payload.action,
      resource_type:   payload.resource_type,
      resource_id:     payload.resource_id ?? null,
      before_snapshot: payload.before_snapshot ?? null,
      after_snapshot:  payload.after_snapshot  ?? null,
      metadata:        payload.metadata ?? {},
      ip:              actor.ip,
      user_agent:      actor.userAgent,
      event_hash,
      previous_hash:   previousHash,
      created_at:      createdAt,
    }).select("id, created_at").single();

    if (error || !data) {
      // Supabase unavailable — emit structured fallback log so event is traceable
      logger.error("audit.persist.failure", {
        actor_id: actor.actorId, action: payload.action,
        resource_type: payload.resource_type, error: error?.message,
      });
      return null;
    }
    return { id: data.id as string, created_at: data.created_at as string };
  } catch (err) {
    logger.error("audit.persist.exception", {
      actor_id: actor.actorId, action: payload.action,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Legacy compatibility wrapper — keeps old auditAction() callers working
 * without breaking existing routes. Converts middleware pattern to auditLog().
 *
 * Deprecated: prefer auditLog() directly in route handlers.
 */
export function auditAction(
  action: string,
  resourceType: string
) {
  return async (c: Context<{ Variables: HonoVariables }>, next: () => Promise<void>) => {
    await next();
    if (c.res.status >= 200 && c.res.status < 300) {
      await auditLog(c, { action, resource_type: resourceType });
    }
  };
}
