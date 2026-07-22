import { csrfHeaders } from "@/lib/csrf";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface BffResponse {
  ok: boolean;
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
  /** Correlação com os logs do BFF — exibir como "código de suporte" em erros. */
  requestId: string;
}

/**
 * Fetch centralizado para o BFF.
 * - Timeout de 10s via AbortController (evita spinner infinito se BFF não responder)
 * - 401/403 → redirect para /login (sessão expirada)
 * - credentials: "include" (envia apmcb_session automaticamente)
 * - Lança em caso de falha de rede / timeout (caller deve usar try/catch)
 */
export async function bffFetch(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  // Achado ALTO de code review (2026-07-22): sem isto, um AbortController
  // criado pelo caller (ex: pra cancelar um POST se o usuário fechar um
  // dialog) não tinha como cancelar o fetch de verdade — só existia um
  // AbortController INTERNO aqui, usado só pro timeout. O caller conseguia
  // no máximo descartar o resultado localmente, mas o request continuava
  // rodando no servidor até completar (ex: um código de pareamento de uso
  // único sendo criado "órfão", sem ninguém pra mostrar/descartar).
  externalSignal?: AbortSignal,
): Promise<BffResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onExternalAbort = () => ctrl.abort();
  if (externalSignal) {
    if (externalSignal.aborted) ctrl.abort();
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  const requestId = crypto.randomUUID();
  try {
    const headers = new Headers(csrfHeaders());
    headers.set("Content-Type", "application/json");
    headers.set("X-Request-Id", requestId);

    const res = await fetch(`${BFF_URL}${path}`, {
      method,
      credentials: "include",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: Record<string, any> = await res.json().catch(() => ({}));

    return { ok: res.ok, status: res.status, data, requestId: res.headers.get("X-Request-Id") ?? requestId };
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}
