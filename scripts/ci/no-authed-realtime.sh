#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

# INVARIANTE do isolamento por reserva (docs/superpowers/specs/2026-09-09-
# isolamento-reserva-design.md — F2 / RT-04).
#
# As policies STABLE SECURITY DEFINER da §4.2 (my_tenant_id / my_active_reserve_id
# / my_tenant_isolation_enabled) só são seguras porque NÃO existe assinante
# Realtime autenticado: todo Realtime passa pelo proxy SSE do BFF
# (apps/bff/src/routes/realtime.ts), que assina com SUPABASE_SERVICE_ROLE_KEY e
# bypassa a RLS/walrus. Se `apps/web` voltar a assinar Realtime direto com a
# anon-key, funções STABLE em policy retornam NULL no contexto WAL e a entrega
# de eventos quebra em silêncio (regressão RT-04, já corrigida 2x).
#
# Se você REALMENTE precisa de uma assinatura direta e ela não usa nenhuma das
# tabelas com policy de reserva, marque a linha com `// realtime-ok:` e um motivo.

if grep -rnE '\.channel\(|postgres_changes' apps/web/src \
     --include='*.ts' --include='*.tsx' \
   | grep -v '// realtime-ok:'; then
  echo ""
  echo "ERRO: assinatura Realtime direta encontrada em apps/web/src."
  echo "Ver docs/superpowers/specs/2026-09-09-isolamento-reserva-design.md (F2 / RT-04)."
  exit 1
fi

echo "OK: nenhum assinante Realtime autenticado em apps/web/src"
