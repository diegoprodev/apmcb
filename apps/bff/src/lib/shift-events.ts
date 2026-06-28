import { createHash } from "crypto";
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

function computeHash(
  id: string,
  shiftId: string,
  happenedAt: string,
  eventType: string,
  description: string,
  prevHash: string | null
): string {
  const input = `${id}${shiftId}${happenedAt}${eventType}${description}${prevHash ?? "genesis"}`;
  return createHash("sha256").update(input).digest("hex");
}

export async function logShiftEvent(params: LogEventParams): Promise<void> {
  // Encontrar turno ativo do ator
  const { data: shift } = await supabase
    .from("service_shifts")
    .select("id, tenant_id")
    .eq("armeiro_id", params.actorId)
    .eq("status", "ativo")
    .maybeSingle();

  if (!shift) return; // Sem turno ativo — silently skip

  // Buscar hash do último evento para encadear
  const { data: lastEvent } = await supabase
    .from("service_log_events")
    .select("event_hash")
    .eq("shift_id", shift.id)
    .order("happened_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const id = crypto.randomUUID();
  const happenedAt = new Date().toISOString();
  const prevHash = lastEvent?.event_hash ?? null;
  const eventHash = computeHash(id, shift.id, happenedAt, params.eventType, params.description, prevHash);

  // Usa tenant_id do turno (garantidamente non-null) em vez de params.tenantId
  await supabase.from("service_log_events").insert({
    id,
    shift_id: shift.id,
    tenant_id: shift.tenant_id,
    happened_at: happenedAt,
    event_type: params.eventType,
    actor_id: params.actorId,
    subject_id: params.subjectId ?? null,
    subject_type: params.subjectType ?? null,
    description: params.description,
    metadata: params.metadata ?? {},
    is_pending: params.isPending ?? false,
    prev_hash: prevHash,
    event_hash: eventHash,
  });
}
