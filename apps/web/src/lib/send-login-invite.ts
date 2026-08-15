import { friendlyApiError } from "@/lib/api-error";

interface SendLoginInviteParams {
  email: string;
  existingUserId: string;
  method?: "magic_link" | "password";
  password?: string;
}

export interface SendLoginInviteResult {
  ok: boolean;
  message?: string;
}

// POST /api/admin/users (existing_user_id) — reenvio/provisionamento de
// login para um militar já cadastrado. Extraído de 3 componentes que
// duplicavam a mesma chamada (fetch + parse + friendlyApiError). Sempre
// resolve (nunca rejeita) — uma falha aqui não pode vazar pro catch de um
// caller que já tenha feito outra mutação bem-sucedida antes (achado de
// code review: _edit-dialog.tsx mostrava "Erro de conexão" mesmo quando o
// perfil já tinha sido salvo, só porque o convite falhou depois).
export async function sendLoginInvite({
  email, existingUserId, method = "magic_link", password,
}: SendLoginInviteParams): Promise<SendLoginInviteResult> {
  try {
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, existing_user_id: existingUserId, method, password }),
    });
    const data = await res.json().catch(() => ({}) as { error?: string });
    if (!res.ok) {
      return { ok: false, message: friendlyApiError(res.status, data.error, "Erro ao enviar convite") };
    }
    return { ok: true };
  } catch (err) {
    console.error("[send-login-invite] erro de conexão", err);
    return { ok: false, message: "Erro de conexão. Tente novamente." };
  }
}
