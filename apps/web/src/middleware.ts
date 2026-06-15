import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SUPABASE_HOST = "jepitcrkicwmvzrmllpn.supabase.co";
const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "https://api.apmcb.pmpb.online";

export function middleware(request: NextRequest) {
  // Next.js App Router injects inline bootstrap scripts (hydration, flight data) that cannot
  // be nonce-tagged without deep framework integration. 'strict-dynamic' would IGNORE
  // 'unsafe-inline', blocking those scripts. We use 'unsafe-inline' without 'strict-dynamic'
  // so the app runs. Primary XSS defenses: default-src 'self', connect-src whitelist,
  // frame-ancestors 'none', form-action 'self'.
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: https://${SUPABASE_HOST}`,
    `connect-src 'self' https://${SUPABASE_HOST} wss://${SUPABASE_HOST} ${BFF_URL}`,
    "font-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  const reqHeaders = new Headers(request.headers);
  reqHeaders.set("Content-Security-Policy", csp);

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
