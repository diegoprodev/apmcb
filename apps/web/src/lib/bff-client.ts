import { csrfHeaders } from "@/lib/csrf";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface BffResponse {
  ok: boolean;
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
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

  try {
    const headers = new Headers(csrfHeaders());
    headers.set("Content-Type", "application/json");

    const res = await fetch(`${BFF_URL}${path}`, {
      method,
      credentials: "include",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: Record<string, any> = await res.json().catch(() => ({}));

    if (res.status === 401 || res.status === 403) {
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    }

    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}
