import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // Disabled until @serwist/next adds Turbopack support (Next.js 16 default)
  disable: true,
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Acknowledge Turbopack (Next.js 16 default) — serwist re-enabled via @serwist/turbopack later
  turbopack: {},
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
};

export default withSerwist(nextConfig);
