import { supabase } from "../services/supabase";

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
  subjectId?: string;
  subjectType?: string;
  isPending?: boolean;
  metadata?: Record<string, unknown>;
}

export async function logShiftEvent(params: LogEventParams): Promise<void> {
  const { data: shift } = await supabase
    .from("service_shifts")
    .select("id, tenant_id")
    .eq("armeiro_id", params.actorId)
    .eq("status", "ativo")
    .maybeSingle();

  if (!shift) return;

  const id = crypto.randomUUID();
  const happenedAt = new Date().toISOString();

  // Usa função SQL atômica: bloqueia a linha do turno (SELECT FOR UPDATE) antes de
  // ler o prev_hash e inserir, eliminando a race condition no encadeamento de hashes.
  await supabase.rpc("log_shift_event_atomic", {
    p_id: id,
    p_shift_id: shift.id,
    p_tenant_id: shift.tenant_id,
    p_happened_at: happenedAt,
    p_event_type: params.eventType,
    p_actor_id: params.actorId,
    p_subject_id: params.subjectId ?? null,
    p_subject_type: params.subjectType ?? null,
    p_description: params.description,
    p_metadata: params.metadata ?? {},
    p_is_pending: params.isPending ?? false,
  });
}
