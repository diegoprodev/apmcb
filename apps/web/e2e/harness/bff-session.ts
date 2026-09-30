// R-28 / D-02 (docs/auditoria/EVIDENCE_R28.md): o Modo Usuário é por sessão
// web, então o BFF só concede papel de staff dentro de uma sessão web
// (iron-session). Bearer sem sessão autentica, mas com teto "usuario".
// Chamadas diretas ao BFF feitas pelos specs como staff precisam autenticar
// como o navegador: trocar o JWT por uma sessão (POST /api/auth/exchange) e
// mandar cookie + x-csrf-token.
//
// Efeitos colaterais do exchange (diferente do Bearer): registra dispositivo de
// login, grava audit_logs (auth.exchange), pode persistir a reserva ativa e
// conta no rate limit de exchange. Por isso a sessão é criada UMA vez por
// token (cache abaixo).
//
// Uso: registre a sessão Supabase no login (rememberSupabaseSession) e troque
// `Authorization: Bearer ${token}` por `...(await bffSessionHeaders(token))`.

import { BFF_URL } from "../harness";

const refreshTokens = new Map<string, string>();
const webSessions = new Map<string, Promise<Record<string, string>>>();

export function rememberSupabaseSession(session: { access_token: string; refresh_token: string }): string {
  refreshTokens.set(session.access_token, session.refresh_token);
  return session.access_token;
}

export function bffSessionHeaders(accessToken: string): Promise<Record<string, string>> {
  let pending = webSessions.get(accessToken);
  if (!pending) {
    pending = (async () => {
      const refresh_token = refreshTokens.get(accessToken);
      if (!refresh_token) {
        throw new Error("bffSessionHeaders: token sem refresh_token — registre com rememberSupabaseSession no login");
      }
      const res = await fetch(`${BFF_URL}/api/auth/exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: accessToken, refresh_token }),
      });
      const cookie = res.headers.getSetCookie().find((v) => v.startsWith("apmcb_session="))?.split(";")[0];
      const { csrfToken } = (await res.json().catch(() => ({}))) as { csrfToken?: string };
      if (res.status !== 200 || !cookie || !csrfToken) {
        throw new Error(`exchange falhou (${res.status}) — sem sessão web o BFF não concede staff`);
      }
      return { cookie, "x-csrf-token": csrfToken };
    })();
    webSessions.set(accessToken, pending);
    pending.catch(() => webSessions.delete(accessToken));
  }
  return pending;
}
