#!/bin/sh
set -e

# Disable telemetry to avoid slow network calls during build
export NEXT_TELEMETRY_DISABLED=1
export VERCEL_TELEMETRY_DISABLED=1
export DO_NOT_TRACK=1

# Write NEXT_PUBLIC_* vars so vercel build can inline them (it strips system env)
cat > apps/web/.env.production << ENVEOF
NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL:-https://jepitcrkicwmvzrmllpn.supabase.co}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplcGl0Y3JraWN3bXZ6cm1sbHBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMzk2MDgsImV4cCI6MjA5NjgxNTYwOH0.3FWH0VGtAqWD-c2r39wDL4uLUKrhh-HS0kyupgcPhic}
NEXT_PUBLIC_BFF_URL=${NEXT_PUBLIC_BFF_URL:-https://api.apmcb.com.br}
ENVEOF

pnpm install
pnpm --filter @apmcb/shared build
cd apps/web
npx @cloudflare/next-on-pages@1
