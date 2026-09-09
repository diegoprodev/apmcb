// Gate de registro para o self-service de solicitação de armamento
// (POST /api/ssa/requests). Sem biometria concluída (registration_status !=
// 'complete') o militar não abre solicitação — nem remota. Substitui a barreira
// que era só o landing em /registro-pendente (removida 2026-09-09).
//
// NÃO se aplica a POST /api/ssa/modo-a (solicitação presencial pelo armeiro):
// lá `pending_biometric` é permitido, com supervisão presencial. Divergência
// deliberada — não consolidar.

export interface SsaGateResult {
  allowed: boolean;
  /** status HTTP a devolver quando `!allowed`. */
  status: 403 | 503 | null;
  /** mensagem ao cliente quando `!allowed`. */
  error?: string;
}

const GATE_OK: SsaGateResult = { allowed: true, status: null };

export function checkSsaRegistrationGate(
  registrationStatus: string | null | undefined,
  lookupFailed: boolean,
): SsaGateResult {
  // Falha transitória da query → 503 (fail-closed com sinal claro de "tente de
  // novo"), NUNCA um 403 enganoso de "conclua a biometria".
  if (lookupFailed) {
    return {
      allowed: false,
      status: 503,
      error: "Não foi possível validar seu cadastro agora. Tente novamente.",
    };
  }
  if (registrationStatus === "complete") return GATE_OK;

  const error =
    registrationStatus === "impedimento_administrativo"
      ? "Sua conta está sob impedimento administrativo. Procure a Reserva de Armamento."
      : registrationStatus === "inactive"
      ? "Sua conta está inativa. Procure a Reserva de Armamento."
      : "Conclua o registro biométrico na Reserva de Armamento antes de solicitar material.";
  return { allowed: false, status: 403, error };
}
