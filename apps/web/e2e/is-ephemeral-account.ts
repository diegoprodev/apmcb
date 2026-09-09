/**
 * Identifica uma conta de militar como EFÊMERA de teste E2E — algo que o
 * global-teardown deve remover (ou inativar, se FK travar o delete).
 *
 * Por que existe: o teardown antigo só casava `matricula LIKE 'E2E%'` OU
 * `email LIKE '%@e2e.test'`. Dezenas de specs criam contas com OUTROS padrões
 * (U7*, CM*, LG*, PW*, CFAP*, NUPEX*, RBAC*, R15_PENDING_*, HACK*, 999xxx,
 * e-mail @apmcb.test, nomes "Test …"/"Temp …"/"Teste …") — nada disso era
 * limpo, e ~949 contas de teste vazaram para o tenant PMPB de produção
 * (limpeza manual em 2026-09-09). Este predicado é a fonte única de verdade.
 *
 * Segurança: contas seed/reais conhecidas estão na whitelist abaixo e NUNCA
 * são efêmeras. O marcador por nome só usa frases que nenhum nome real de
 * militar da PMPB tem ("Test …", "Temp …", "Teste …", "E2E …", etc.).
 */

export interface AccountLike {
  matricula?: string | null;
  email?: string | null;
  nome_completo?: string | null;
}

// Contas PERMANENTES (seeds + contas de teste manual do dono) — nunca efêmeras.
// Sincronizada com a whitelist da limpeza manual de 2026-09-09.
export const PERMANENT_FIXTURE_MATRICULAS = new Set([
  "000001", "000002", "000003", "000004", "000005",
  "202601", "526334", "5248767", "526690-1", "5246367",
]);

// Prefixos/padrões de matrícula que só um spec E2E gera.
const EPHEMERAL_MATRICULA =
  /^(E2E|U7[A-Z0-9]|CM[A-Z0-9]|LG[A-Z0-9]|PW[A-Z0-9]|ML[A-Z0-9]|MT[A-Z0-9]|MSV|CFAP|NUPEX|RBAC|R15[_-]?PENDING|HACK|X\d|999\d{3})/i;

// Domínios/sufixos de e-mail que só teste usa.
const EPHEMERAL_EMAIL =
  /@(e2e\.test|apmcb\.test|example\.com|e2e\.local)$|\.novo@e2e\.test$|\+e2e[@.]|\+test[@.]|@resend\.dev$|^deleted-.*@apmcb\.invalid$/i;

// Frases de nome geradas por specs. Nenhum nome real de militar da PMPB
// (padrão "SOBRENOME NOME" ou "Posto Nome") começa assim ou contém isto.
const EPHEMERAL_NAME =
  /\bE2E\b|^(Teste |Test |Temp |Sd E2E|Sgt Cadastro |Cap Login |Hacker\b)|Pending Biometric|Cancel Teste|Nome Editado Teste|Militar Teste|\bCT05c\b|\bRBAC\b/i;

export function isEphemeralTestAccount(a: AccountLike): boolean {
  const matricula = (a.matricula ?? "").trim();
  const email = (a.email ?? "").trim();
  const nome = (a.nome_completo ?? "").trim();

  if (PERMANENT_FIXTURE_MATRICULAS.has(matricula)) return false;

  return (
    EPHEMERAL_MATRICULA.test(matricula) ||
    EPHEMERAL_EMAIL.test(email) ||
    EPHEMERAL_NAME.test(nome)
  );
}
