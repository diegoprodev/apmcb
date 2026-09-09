import { bffFetch } from "@/lib/bff-client";
import { friendlyApiError } from "@/lib/api-error";

interface SendLoginInviteParams {
  email: string;
  existingUserId: string;
}

export interface SendLoginInviteResult {
  ok: boolean;
  message?: string;
}

// POST {BFF}/api/admin/users/enviar-acesso — provisiona o login de um militar
// já cadastrado: grava o e-mail real, gera o recovery link e envia o e-mail
// "acesso" (Andrômeda). Fluxo único — não há mais escolha magic-link/senha.
// Sempre resolve (nunca rejeita): uma falha aqui não pode vazar pro catch de
// um caller que já concluiu outra mutação (o militar já foi cadastrado).
export async function sendLoginInvite({
  email, existingUserId,
}: SendLoginInviteParams): Promise<SendLoginInviteResult> {
  try {
    const res = await bffFetch("POST", "/api/admin/users/enviar-acesso", {
      user_id: existingUserId,
      email,
    });
    if (!res.ok) {
      return { ok: false, message: friendlyApiError(res.status, res.data?.error, "Erro ao enviar o e-mail de acesso") };
    }
    if (res.data?.email_sent === false) {
      return { ok: false, message: "Acesso provisionado, mas o e-mail não pôde ser enviado agora. Reabra a edição do militar para reenviar." };
    }
    return { ok: true };
  } catch (err) {
    console.error("[send-login-invite] erro de conexão", err);
    return { ok: false, message: "Erro de conexão. Tente novamente." };
  }
}
