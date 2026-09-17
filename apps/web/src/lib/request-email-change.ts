import { bffFetch } from "@/lib/bff-client";
import { friendlyApiError } from "@/lib/api-error";

interface RequestEmailChangeParams {
  userId: string;
  newEmail: string;
  totpCode: string;
}

export interface RequestEmailChangeResult {
  ok: boolean;
  message?: string;
  status?: number;
}

// POST {BFF}/api/admin/users/:id/email-change — solicita a troca de e-mail
// de acesso de uma conta JÁ ativa (spec
// docs/enterprise/specs/troca-email-acesso-enterprise.md). Diferente de
// sendLoginInvite (primeiro acesso, efetiva na hora): isto só CRIA uma
// pendência com duplo opt-in — a troca de verdade só acontece quando o
// próprio usuário confirmar pelo link recebido no e-mail novo. Sempre
// resolve (nunca rejeita), mesmo contrato de sendLoginInvite.
export async function requestEmailChange({
  userId, newEmail, totpCode,
}: RequestEmailChangeParams): Promise<RequestEmailChangeResult> {
  try {
    const res = await bffFetch("POST", `/api/admin/users/${userId}/email-change`, {
      new_email: newEmail,
      totp_code: totpCode,
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message: friendlyApiError(
          res.status,
          res.data?.error,
          "Não foi possível solicitar a troca de e-mail agora. Tente novamente em instantes.",
        ),
      };
    }
    return { ok: true };
  } catch (err) {
    console.error("[request-email-change] erro de conexão", err);
    return { ok: false, message: "Erro de conexão. Tente novamente." };
  }
}
