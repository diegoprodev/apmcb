import { cookies } from "next/headers";

// D-02 / R-28 (docs/auditoria/EVIDENCE_R28.md): Modo Usuário é redução de
// privilégio POR SESSÃO e vive só na sessão do BFF (cookie apmcb_session).
// O BFF não concede papel de staff a Bearer sem sessão. Código do servidor
// Next que age como staff deve, portanto:
//  - chamar o BFF repassando o cookie da sessão (bffSessionHeaders), e
//  - decidir permissões pelo papel EFETIVO da sessão (resolveWebSessionRole),
//    nunca por profiles.role, que ignora o Modo Usuário.
// Mesmo padrão de repasse de cookie de lib/verified-user.ts e dos proxies
// app/api/nexus/*.

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "https://api.apmcb.pmpb.online";
const SESSION_COOKIE = "apmcb_session";

export async function bffSessionHeaders(): Promise<Record<string, string>> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  return value ? { cookie: `${SESSION_COOKIE}=${value}` } : {};
}

/**
 * Papel efetivo da sessão web (considera o Modo Usuário), ou null — sem
 * sessão, sessão recusada pelo BFF, falha de rede ou sessão de OUTRA
 * identidade que não `expectedUserId` (nunca mistura identidades).
 */
export async function resolveWebSessionRole(expectedUserId: string): Promise<string | null> {
  const headers = await bffSessionHeaders();
  if (!headers.cookie) {
    console.warn("[web-session] sem sessão do BFF", { expectedUserId });
    return null;
  }
  try {
    const res = await fetch(`${BFF_URL}/api/session/info`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) {
      console.warn("[web-session] BFF recusou a sessão", { status: res.status, expectedUserId });
      return null;
    }
    const data = (await res.json()) as { userId?: string; role?: string };
    if (!data.userId || data.userId !== expectedUserId) {
      console.warn("[web-session] sessão do BFF é de outra identidade", { expectedUserId, sessionUserId: data.userId ?? null });
      return null;
    }
    return data.role ?? null;
  } catch (err) {
    console.warn("[web-session] falha ao consultar a sessão", { expectedUserId, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
