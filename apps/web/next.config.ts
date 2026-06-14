import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // Disabled in dev (Turbopack default). Production uses --webpack (vercel.json).
  disable: process.env.NODE_ENV === "development",
});

// NEXT_PUBLIC_* vars must be inlined at webpack compile time.
// vercel build (called by next-on-pages) strips system env vars, so we
// explicitly forward them here. Fallbacks are the project's public values
// (Supabase anon key is safe to ship — it is NOT a secret by design).
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // TypeScript is checked via `pnpm typecheck` (pre-push). Skipping it here
  // removes ~10s from the CF Pages build. tsc still enforces types locally.
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
  env: {
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "https://jepitcrkicwmvzrmllpn.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplcGl0Y3JraWN3bXZ6cm1sbHBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMzk2MDgsImV4cCI6MjA5NjgxNTYwOH0.3FWH0VGtAqWD-c2r39wDL4uLUKrhh-HS0kyupgcPhic",
    NEXT_PUBLIC_BFF_URL:
      process.env.NEXT_PUBLIC_BFF_URL || "https://api.apmcb.com.br",
  },
};

export default withSerwist(nextConfig);
