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
): Promise<BffResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

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
  }
}
