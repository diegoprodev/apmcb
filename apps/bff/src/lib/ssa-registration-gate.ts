// Gate de registro para o self-service de solicitação de armamento
// (POST /api/ssa/requests).
//
// `pending_biometric` É PERMITIDO: a biometria não é pré-requisito de uso —
// serve só para marcar o cadastro como 100% completo (decisão do dono
// 2026-09-09). O que barra é conta suspensa: `inactive` (desativada) ou
// `impedimento_administrativo` (acesso suspenso pelo admin).

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

  // Só conta suspensa barra. `complete` e `pending_biometric` (e um profile
  // não encontrado — trata como não-suspenso) passam.
  if (registrationStatus === "impedimento_administrativo") {
    return { allowed: false, status: 403, error: "Sua conta está sob impedimento administrativo. Procure a Reserva de Armamento." };
  }
  if (registrationStatus === "inactive") {
    return { allowed: false, status: 403, error: "Sua conta está inativa. Procure a Reserva de Armamento." };
  }
  return GATE_OK;
}
