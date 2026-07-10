import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Dá acesso aos bindings do Cloudflare (env vars) em `next dev`, igual produção.
initOpenNextCloudflareForDev();

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // Disabled in dev (Turbopack default). Production uses --webpack.
  disable: process.env.NODE_ENV === "development",
});

// NEXT_PUBLIC_* vars must be inlined at webpack compile time — explicitly
// forwarded here so the build doesn't depend on the runtime env being set
// at build time. Fallbacks are the project's public values (Supabase anon
// key is safe to ship — it is NOT a secret by design).
// CSP is handled per-request in middleware.ts (nonce-based, no unsafe-inline on scripts)

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  // O tracer de arquivos do Next (@vercel/nft) resolve o pacote `next` através
  // do symlink do pnpm e, quando o alvo físico (.pnpm/next@.../node_modules/next)
  // cai fora do outputFileTracingRoot calculado, descarta silenciosamente
  // arquivos referenciados apenas dinamicamente dentro do próprio next-server.js
  // — causa raiz confirmada (bug aberto do Next.js: vercel/next.js#83294).
  // Workaround oficial do OpenNext: forçar a inclusão desses arquivos.
  // https://opennext.js.org/aws/common_issues#a-filedependency-is-missing-from-my-bundle
  outputFileTracingIncludes: {
    "*": [
      "node_modules/next/dist/server/**/*",
      "node_modules/next/dist/shared/**/*",
      "node_modules/next/dist/lib/**/*",
      "node_modules/next/dist/build/output/**/*",
      "node_modules/next/dist/client/components/**/*",
      "node_modules/@swc/helpers/**/*",
    ],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
  async headers() {
    // CSP with nonces is handled by middleware.ts (per-request nonce).
    // Static security headers only here as a fallback for static assets.
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  env: {
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "https://jepitcrkicwmvzrmllpn.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplcGl0Y3JraWN3bXZ6cm1sbHBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMzk2MDgsImV4cCI6MjA5NjgxNTYwOH0.3FWH0VGtAqWD-c2r39wDL4uLUKrhh-HS0kyupgcPhic",
    NEXT_PUBLIC_BFF_URL:
      process.env.NEXT_PUBLIC_BFF_URL || "https://api.apmcb.pmpb.online",
  },
};

export default withSerwist(nextConfig);
