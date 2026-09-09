// Classifica o desfecho do passo 1 de POST /api/admin/users/enviar-acesso:
// a troca do e-mail sintético (.interno@apmcb.sistema) pelo e-mail real via
// `supabase.auth.admin.updateUserById(user_id, { email, email_confirm: true })`.
//
// Por que não basta olhar o status do erro: quando o e-mail alvo já pertence a
// outra conta, o índice único `users_email_partial_key` do GoTrue estoura e o
// GoTrue devolve isso como um **500 "Error updating user"** genérico (nem
// sempre 422). A fonte de verdade é re-conferir o dono depois do erro: se o
// e-mail do militar AGORA é o alvo, foi corrida e deu certo; se não é, o alvo
// está em uso por terceiro (409, mensagem amigável — nunca um 500 mudo).
//
// `updateErrorStatus === undefined` = o update não deu erro.

export interface EmailUpdateOutcome {
  ok: boolean;
  status?: 409 | 429 | 502;
  error?: string;
}

export function classifyEmailUpdateOutcome(args: {
  /** `upd.error?.status` — undefined quando `upd.error` é null/undefined. */
  updateErrorStatus: number | undefined;
  /** E-mail atual do militar APÓS a re-conferência; null se a re-conferência falhou. */
  recheckEmail: string | null;
  /** E-mail que se quer definir. */
  targetEmail: string;
}): EmailUpdateOutcome {
  const { updateErrorStatus, recheckEmail, targetEmail } = args;

  if (updateErrorStatus === undefined) return { ok: true };

  // Rate limit do GoTrue: NÃO cair no ramo de "e-mail em uso" (o recheck
  // mostraria o e-mail antigo e acusaria conflito por engano).
  if (updateErrorStatus === 429) {
    return { ok: false, status: 429, error: "Muitas tentativas seguidas. Aguarde um minuto e tente de novo." };
  }

  const target = targetEmail.trim().toLowerCase();
  // "" conta como re-conferência inconclusiva (não como "e-mail diferente") —
  // senão um user sem e-mail cairia no ramo 409 "em uso" por engano.
  const current = recheckEmail && recheckEmail.trim() ? recheckEmail.trim().toLowerCase() : null;

  // Corrida: outro request já gravou o e-mail alvo neste militar.
  if (current === target) return { ok: true };

  // Re-conferência falhou → não dá pra afirmar "em uso"; erro transitório.
  if (current === null) {
    return {
      ok: false,
      status: 502,
      error: "Não foi possível definir o e-mail de acesso agora. Tente novamente em instantes.",
    };
  }

  // Update falhou num e-mail válido, num militar válido, e o e-mail NÃO ficou
  // sendo o alvo → o alvo pertence a outra conta.
  return {
    ok: false,
    status: 409,
    error: "Este e-mail já está em uso por outra conta. Use outro endereço ou remova a conta antiga.",
  };
}
