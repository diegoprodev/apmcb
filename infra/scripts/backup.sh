#!/usr/bin/env bash
# backup.sh — backup diário da VPS APMCB
# Salva: config nginx, env do container, repo local
# Rotação: 7 backups diários + 4 semanais
# Cron: 0 2 * * * bash /opt/apmcb/scripts/backup.sh >> /var/log/apmcb-backup.log 2>&1
set -euo pipefail

BACKUP_ROOT="/opt/apmcb/backups"
DATE=$(date +%Y-%m-%d)
WEEKDAY=$(date +%u)  # 1=segunda, 7=domingo
BACKUP_DIR="${BACKUP_ROOT}/daily/${DATE}"
CONTAINER_NAME="apmcb-bff"

echo "==> [$(date)] Backup iniciado — ${DATE}"

mkdir -p "${BACKUP_ROOT}/daily" "${BACKUP_ROOT}/weekly"

# Não duplicar se já rodou hoje
if [ -d "$BACKUP_DIR" ]; then
  echo "==> Backup de hoje já existe, pulando"
  exit 0
fi

mkdir -p "$BACKUP_DIR"

# 1. Configurações nginx
if [ -d /etc/nginx ]; then
  tar -czf "${BACKUP_DIR}/nginx-config.tar.gz" \
    /etc/nginx/nginx.conf \
    /etc/nginx/sites-available/ \
    /etc/nginx/sites-enabled/ \
    /etc/nginx/conf.d/ \
    2>/dev/null
  echo "==> nginx config salvo"
fi

# 2. Env vars do container BFF (sem valores — só chaves)
if docker inspect "$CONTAINER_NAME" &>/dev/null; then
  docker inspect "$CONTAINER_NAME" \
    --format '{{range .Config.Env}}{{println .}}{{end}}' \
    | sed 's/=.*/=REDACTED/' \
    > "${BACKUP_DIR}/bff-env-keys.txt"
  echo "==> Env keys do BFF salvas (valores removidos)"
fi

# 3. Scripts de infra
if [ -d /opt/apmcb/scripts ]; then
  tar -czf "${BACKUP_DIR}/scripts.tar.gz" /opt/apmcb/scripts/
  echo "==> Scripts de infra salvos"
fi

# 4. Crontab do root
crontab -l 2>/dev/null > "${BACKUP_DIR}/crontab-root.txt" || echo "(sem crontab)" > "${BACKUP_DIR}/crontab-root.txt"

# 5. Estado atual do Docker
{
  echo "=== Containers ==="
  docker ps -a --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
  echo ""
  echo "=== Imagens ==="
  docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}"
  echo ""
  echo "=== Volumes ==="
  docker volume ls
  echo ""
  echo "=== Disk ==="
  df -h /
  echo ""
  echo "=== Docker system df ==="
  docker system df
} > "${BACKUP_DIR}/docker-state.txt"

# 6. Certificados SSL (apenas metadados — não copiar chaves privadas)
if [ -d /etc/letsencrypt/renewal ]; then
  ls /etc/letsencrypt/renewal/ > "${BACKUP_DIR}/ssl-domains.txt" 2>/dev/null || true
  echo "==> Domínios SSL registrados"
fi

# 7. Compactar tudo
ARCHIVE="${BACKUP_ROOT}/daily/apmcb-backup-${DATE}.tar.gz"
tar -czf "$ARCHIVE" -C "$BACKUP_DIR" .
rm -rf "$BACKUP_DIR"

SIZE=$(du -sh "$ARCHIVE" | cut -f1)
echo "==> Backup criado: $ARCHIVE (${SIZE})"

# 8. Backup semanal (toda segunda-feira)
if [ "$WEEKDAY" = "1" ]; then
  WEEK=$(date +%Y-W%V)
  cp "$ARCHIVE" "${BACKUP_ROOT}/weekly/apmcb-backup-${WEEK}.tar.gz"
  echo "==> Backup semanal copiado: $WEEK"
fi

# 9. Rotação — manter apenas 7 diários + 4 semanais
find "${BACKUP_ROOT}/daily"   -name "*.tar.gz" -type f | sort -r | tail -n +8 | xargs -r rm -f
find "${BACKUP_ROOT}/weekly"  -name "*.tar.gz" -type f | sort -r | tail -n +5 | xargs -r rm -f

REMAINING=$(find "${BACKUP_ROOT}" -name "*.tar.gz" | wc -l)
echo "==> Rotação concluída — ${REMAINING} backups mantidos"

# 10. (Opcional) Enviar para Hetzner Object Storage / S3
# Descomente e configure as variáveis se tiver bucket S3-compatível:
# AWS_ACCESS_KEY_ID="..." AWS_SECRET_ACCESS_KEY="..." \
# aws s3 cp "$ARCHIVE" "s3://apmcb-backups/vps/$(basename $ARCHIVE)" \
#   --endpoint-url "https://fsn1.your-objectstorage.com" --no-progress

echo "==> [$(date)] Backup concluído"
