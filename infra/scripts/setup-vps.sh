#!/usr/bin/env bash
# setup-vps.sh — instalar scripts e cron jobs na VPS
# Executar UMA VEZ como root na VPS: bash setup-vps.sh
set -euo pipefail

SCRIPTS_DIR="/opt/apmcb/scripts"
ENV_FILE="/opt/apmcb/.env"

echo "==> Criando estrutura de diretórios..."
mkdir -p "$SCRIPTS_DIR"
mkdir -p /opt/apmcb/backups/daily
mkdir -p /opt/apmcb/backups/weekly

echo "==> Copiando scripts..."
# Execute este script de dentro do repo clonado na VPS:
REPO_SCRIPTS="$(dirname "$(realpath "$0")")"
cp "${REPO_SCRIPTS}/deploy-bff.sh" "$SCRIPTS_DIR/"
cp "${REPO_SCRIPTS}/cleanup.sh"    "$SCRIPTS_DIR/"
cp "${REPO_SCRIPTS}/backup.sh"     "$SCRIPTS_DIR/"
chmod +x "${SCRIPTS_DIR}"/*.sh

echo "==> Criando arquivo .env template (preencha depois)..."
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<'EOF'
# BFF environment — /opt/apmcb/.env
# Preencha os valores e proteja o arquivo: chmod 600 /opt/apmcb/.env
SUPABASE_URL=https://jepitcrkicwmvzrmllpn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=PREENCHA
SESSION_SECRET=GERE_UM_SECRET_FORTE_COM_openssl_rand_base64_48
NODE_ENV=production
PORT=3001
EOF
  chmod 600 "$ENV_FILE"
  echo "==> .env criado em $ENV_FILE — preencha SUPABASE_SERVICE_ROLE_KEY e SESSION_SECRET"
fi

echo "==> Instalando cron jobs..."
# Remover entradas antigas do APMCB se existirem
crontab -l 2>/dev/null | grep -v "apmcb" | crontab - 2>/dev/null || true

# Adicionar novos cron jobs
(
  crontab -l 2>/dev/null
  echo "# APMCB — Cleanup diário às 03:00"
  echo "0 3 * * * bash ${SCRIPTS_DIR}/cleanup.sh >> /var/log/apmcb-cleanup.log 2>&1"
  echo "# APMCB — Backup diário às 02:00"
  echo "0 2 * * * bash ${SCRIPTS_DIR}/backup.sh >> /var/log/apmcb-backup.log 2>&1"
) | crontab -

echo "==> Cron jobs instalados:"
crontab -l | grep "apmcb"

echo "==> Rotação de logs (logrotate)..."
cat > /etc/logrotate.d/apmcb <<'EOF'
/var/log/apmcb-*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 640 root root
}
EOF

echo ""
echo "✅ Setup concluído!"
echo ""
echo "Próximos passos:"
echo "  1. Editar /opt/apmcb/.env com os valores reais"
echo "  2. Testar deploy:  bash ${SCRIPTS_DIR}/deploy-bff.sh"
echo "  3. Testar backup:  bash ${SCRIPTS_DIR}/backup.sh"
echo "  4. Testar cleanup: bash ${SCRIPTS_DIR}/cleanup.sh"
echo "  5. Ver backups:    ls -lh /opt/apmcb/backups/daily/"
