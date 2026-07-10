#!/usr/bin/env bash
# Gate OBS17: proíbe console.* em apps/bff/src — use lib/logger em vez disso.
# Sem isso, logs sem requestId/redaction voltam a vazar pro stdout cru.
set -euo pipefail
cd "$(dirname "$0")/.."

MATCHES=$(grep -rEn 'console\.(log|error|warn|info|debug)' src --include='*.ts' \
  | grep -v '__tests__' | grep -v 'src/lib/logger.ts' || true)

if [ -n "$MATCHES" ]; then
  echo "❌ console.* proibido em apps/bff/src — use lib/logger:"
  echo "$MATCHES"
  exit 1
fi

echo "✅ OBS17: zero console.* em apps/bff/src"
