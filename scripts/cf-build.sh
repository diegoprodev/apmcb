#!/bin/sh
# CF Pages build script
# Writes NEXT_PUBLIC_* vars to .env.production so vercel build (next-on-pages)
# can inline them at webpack compile time.

set -e

printf "NEXT_PUBLIC_SUPABASE_URL=%s\n"     "${NEXT_PUBLIC_SUPABASE_URL}"     > apps/web/.env.production
printf "NEXT_PUBLIC_SUPABASE_ANON_KEY=%s\n" "${NEXT_PUBLIC_SUPABASE_ANON_KEY}" >> apps/web/.env.production
printf "NEXT_PUBLIC_BFF_URL=%s\n"           "${NEXT_PUBLIC_BFF_URL:-https://api.apmcb.com.br}" >> apps/web/.env.production

echo "[cf-build] .env.production written:"
cat apps/web/.env.production

pnpm install
pnpm --filter @apmcb/shared build
cd apps/web
npx @cloudflare/next-on-pages@1
