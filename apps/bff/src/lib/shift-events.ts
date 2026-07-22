import { supabase } from "../services/supabase";
import { logger } from "./logger";

export type ShiftEventType =
  | "turno_assumido"
  | "cautela_emitida"
  | "cautela_devolvida"
  | "saida_autorizada"
  | "saida_devolvida"
  | "ocorrencia_registrada"
  | "solicitacao_aprovada"
  | "solicitacao_negada"
  | "inventario_divergencia"
  | "turno_encerrado"
  | "evento_manual";

interface LogEventParams {
  actorId: string;
  tenantId: string;
  eventType: ShiftEventType;
  description: string;
  // Quando o caller já sabe o turno exato (ex: POST /:id/close, que tem o id
  // na própria URL), passar aqui evita a busca por "turno ativo do armeiro"
  // abaixo — achado de bug real (2026-07-22): POST /:id/close atualiza
  // service_shifts.status para 'encerrado' ANTES de chamar logShiftEvent
  // pro evento turno_encerrado; sem shiftId explícito, a busca por
  // status='ativo' não encontra mais o turno (ele acabou de deixar de ser
  // ativo), e o evento de encerramento nunca era gravado — 100% dos
  // fechamentos de turno, silenciosamente, desde sempre. Confirmado via
  // query direta em produção: turnos encerrados tinham turno_assumido mas
  // nunca turno_encerrado em service_log_events.
  shiftId?: string;
  subjectId?: string;
  subjectType?: string;
  isPending?: boolean;
  metadata?: Record<string, unknown>;
}

export async function logShiftEvent(params: LogEventParams): Promise<void> {
  let shiftId = params.shiftId;

  if (!shiftId) {
    const { data: shift } = await supabase
      .from("service_shifts")
      .select("id")
      .eq("armeiro_id", params.actorId)
      .eq("status", "ativo")
      .maybeSingle();

    if (!shift) return;
    shiftId = shift.id;
  }

  const id = crypto.randomUUID();
  const happenedAt = new Date().toISOString();

  // Usa função SQL atômica: bloqueia a linha do turno (SELECT FOR UPDATE) antes de
  // ler o prev_hash e inserir, eliminando a race condition no encadeamento de hashes.
  const { error } = await supabase.rpc("log_shift_event_atomic", {
    p_id: id,
    p_shift_id: shiftId,
    p_tenant_id: params.tenantId,
    p_happened_at: happenedAt,
    p_event_type: params.eventType,
    p_actor_id: params.actorId,
    p_subject_id: params.subjectId ?? null,
    p_subject_type: params.subjectType ?? null,
    p_description: params.description,
    p_metadata: params.metadata ?? {},
    p_is_pending: params.isPending ?? false,
  });

  // Achado ALTO de code review (2026-07-22, mesma investigação do bug do
  // turno_encerrado): supabase-js NÃO lança em erro de RPC — sem checar
  // `error` aqui, uma falha (lock timeout, FK inválida, outage momentâneo)
  // desapareceria tão silenciosamente quanto o bug original que motivou
  // este arquivo a existir. Logar é o mínimo — não lança para não regredir
  // os callers que ainda tratam esta função como "nunca falha" (todos os
  // callers atuais fazem update do estado de negócio ANTES de chamar isto;
  // ver MÉDIO registrado nos call sites de shifts.ts).
  if (error) {
    logger.error(
      "shift_events.log_failed",
      { shiftId, eventType: params.eventType, actorId: params.actorId, error: error.message, code: error.code },
    );
  }
}
