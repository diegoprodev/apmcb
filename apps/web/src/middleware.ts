import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { fetchVerifiedUserId } from "@/lib/verified-user";

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
  return fetchVerifiedUserId(sessionCookie);
}

// Domínio canônico único — qualquer outro host (o *.pages.dev bruto que
// Cloudflare Pages sempre expõe ao lado do domínio customizado, ou qualquer
// outro alias) é redirecionado aqui. Achado real de produção 2026-07-17:
// um usuário tinha o ícone do PWA instalado a partir de apmcb.pages.dev (não
// apmcb.pmpb.online) — provavelmente de antes do domínio customizado estar
// configurado. O manifest.webmanifest usa start_url relativo ("/"), então o
// PWA fica permanentemente amarrado à ORIGEM de onde foi instalado. Nesse
// domínio errado, TODOS os cookies de sessão (apmcb_session, sb-*, escopados
// para .apmcb.pmpb.online) simplesmente não existem — o app carrega (JS
// funciona, tema aplica) mas toda autenticação por cookie falha em silêncio,
// parecendo logout aleatório. Este redirect corrige automaticamente
// qualquer PWA já instalado no domínio errado, sem exigir reinstalação
// manual — a navegação de troca de ícone redireciona pro domínio certo antes
// de qualquer lógica de sessão rodar.
//
// TODO(Phase 5B — Nexus Enterprise subdomínio por tenant): quando
// *.apmcb.pmpb.online por tenant for implementado (ver
// docs/enterprise/phases/phase-5b-nexus-enterprise.md, tenants.custom_subdomain
// já existe no schema mas nenhum runtime hoje resolve tenant por Host), trocar
// a comparação abaixo por `host === CANONICAL_HOST || host.endsWith("." + CANONICAL_HOST)`
// — como está, este guard redirecionaria um subdomínio de tenant legítimo pro apex.
const CANONICAL_HOST = "apmcb.pmpb.online";

export async function middleware(request: NextRequest) {
  // Só em produção — não interfere com dev local (localhost:3000) nem com
  // qualquer fluxo de preview/staging que rode em NODE_ENV diferente.
  if (process.env.NODE_ENV === "production") {
    const host = request.headers.get("host") ?? request.nextUrl.hostname;
    if (host !== CANONICAL_HOST) {
      // IMPORTANTE: usar os setters de NextURL (clone + hostname), NÃO
      // `new URL(pathname + search, base)`. Achado de code review: se
      // pathname começar com "//" (ex: um path literal "//evil.com/x" — Next
      // não colapsa barras duplas), o parser de URL trata isso como
      // referência protocol-relative e SUBSTITUI o host do `base`, criando
      // um open redirect. Os setters abaixo nunca fazem esse re-parsing de
      // autoridade a partir do path. 307 (não 308) enquanto o fix "queima"
      // em produção — 308 é cacheado agressivamente pelo browser e
      // dificultaria reverter caso surja algum efeito colateral inesperado.
      const canonicalUrl = request.nextUrl.clone();
      canonicalUrl.protocol = "https:";
      canonicalUrl.hostname = CANONICAL_HOST;
      canonicalUrl.port = "";
      return NextResponse.redirect(canonicalUrl, 307);
    }
  }

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
