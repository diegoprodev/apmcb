import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SUPABASE_HOST = "jepitcrkicwmvzrmllpn.supabase.co";
const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "https://api.apmcb.pmpb.online";

// Rotas do route group (dashboard) — conteúdo por-usuário que precisa da
// verificação cruzada abaixo. Mantida como allowlist explícita (em vez de
// "tudo exceto login/auth/nexus/api") para não silenciosamente parar de
// proteger uma rota nova por engano de exclusão. `/v/[document_id]` NÃO
// entra — é rota pública de verificação de documento, fora do route group
// (dashboard), sem consumidor do header x-verified-user-id.
const DASHBOARD_PATH_PREFIXES = ["/admin", "/reserva", "/efetivo", "/perfil", "/suporte"];

function isDashboardPath(pathname: string): boolean {
  return DASHBOARD_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/**
 * Resolve a identidade do cookie de sessão DIRETO do objeto Request recebido
 * como parâmetro da função — não via cookies()/next/headers (que passam por
 * um AsyncLocalStorage/contexto ambiente cuja confiabilidade está em questão
 * no incidente de session-bleed que motiva esta checagem). O parâmetro
 * `request` é passado explicitamente pela plataforma para esta invocação
 * específica, então não sofre o mesmo risco de vazar entre requisições de
 * usuários diferentes quando um Worker isolate é reciclado.
 *
 * O BFF (Hono/Bun, runtime Node separado no VPS, sessão iron-session) nunca
 * apresentou esse tipo de vazamento em nenhum teste ao vivo — é a fonte mais
 * confiável disponível para comparar contra o que o Next.js resolver depois.
 *
 * Resultado é injetado no header `x-verified-user-id` do request encaminhado
 * adiante — mesmo mecanismo já usado abaixo para o nonce de CSP, que já
 * funciona de forma confiável nesta aplicação.
 */
async function resolveVerifiedUserId(request: NextRequest): Promise<string | null> {
  const sessionCookie = request.cookies.get("apmcb_session")?.value;
  if (!sessionCookie) return null;

  try {
    const res = await fetch(`${BFF_URL}/api/auth/me`, {
      headers: { cookie: `apmcb_session=${sessionCookie}` },
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) {
      // fail-open — instabilidade externa não deve travar navegação, mas
      // logamos pra distinguir de "sem proteção por falha silenciosa" e
      // detectar se o rate limit dedicado (rateLimitAuthMe) precisa de ajuste.
      console.warn("[middleware] resolveVerifiedUserId: BFF respondeu", res.status);
      return null;
    }
    const data = await res.json() as { user?: { id?: string } | null };
    return data.user?.id ?? null;
  } catch (error) {
    console.warn("[middleware] resolveVerifiedUserId: falha de rede/timeout", error);
    return null; // fail-open — instabilidade externa não deve travar navegação
  }
}

export async function middleware(request: NextRequest) {
  // Next.js App Router injects inline bootstrap scripts (hydration, flight data) that cannot
  // be nonce-tagged without deep framework integration. 'strict-dynamic' would IGNORE
  // 'unsafe-inline', blocking those scripts. We use 'unsafe-inline' without 'strict-dynamic'
  // so the app runs. Primary XSS defenses: default-src 'self', connect-src whitelist,
  // frame-ancestors 'none', form-action 'self'.
  const scriptSrc = process.env.NODE_ENV === "production"
    ? "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com https://challenges.cloudflare.com"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com https://challenges.cloudflare.com";

  const csp = [
    "default-src 'self'",
    // CF Pages auto-injects Cloudflare Web Analytics beacon — must allow its origin
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: https://${SUPABASE_HOST} https://challenges.cloudflare.com`,
    `connect-src 'self' https://${SUPABASE_HOST} wss://${SUPABASE_HOST} ${BFF_URL} https://cloudflareinsights.com https://challenges.cloudflare.com https://turnstile-siteverify-apmcb.arckosia.workers.dev`,
    "frame-src https://challenges.cloudflare.com",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  const reqHeaders = new Headers(request.headers);
  reqHeaders.set("Content-Security-Policy", csp);
  reqHeaders.delete("x-verified-user-id"); // nunca confiar em valor vindo do cliente

  if (isDashboardPath(request.nextUrl.pathname)) {
    const verifiedUserId = await resolveVerifiedUserId(request);
    if (verifiedUserId) reqHeaders.set("x-verified-user-id", verifiedUserId);
  }

  const res = NextResponse.next({ request: { headers: reqHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?|ttf|otf)$).*)",
  ],
};
