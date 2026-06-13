#!/usr/bin/env bash
# cleanup.sh — limpeza diária de Docker + temporários
# Executado via cron: 0 3 * * * bash /opt/apmcb/scripts/cleanup.sh >> /var/log/apmcb-cleanup.log 2>&1
set -euo pipefail

echo "==> [$(date)] Cleanup diário iniciado"

# 1. Imagens dangling (sem tag, sem uso)
DANGLING=$(docker images -f "dangling=true" -q | wc -l)
if [ "$DANGLING" -gt 0 ]; then
  docker image prune -f
  echo "==> Removidas $DANGLING imagens dangling"
fi

# 2. Containers parados há mais de 24h
STOPPED=$(docker ps -a -f "status=exited" -f "status=dead" -q | wc -l)
if [ "$STOPPED" -gt 0 ]; then
  docker container prune -f --filter "until=24h"
  echo "==> Removidos $STOPPED containers parados"
fi

# 3. Volumes não usados
docker volume prune -f >/dev/null
echo "==> Volumes órfãos removidos"

# 4. Build cache com mais de 7 dias
docker builder prune -f --filter "until=168h" >/dev/null
echo "==> Build cache antigo removido"

# 5. Logs de containers grandes (rotar se > 50MB)
for CONTAINER in $(docker ps -q); do
  LOG_FILE=$(docker inspect --format='{{.LogPath}}' "$CONTAINER" 2>/dev/null || true)
  if [ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ]; then
    SIZE=$(du -m "$LOG_FILE" 2>/dev/null | cut -f1)
    if [ "${SIZE:-0}" -gt 50 ]; then
      NAME=$(docker inspect --format='{{.Name}}' "$CONTAINER" | tr -d '/')
      echo "==> Log de $NAME: ${SIZE}MB — truncando"
      truncate -s 10M "$LOG_FILE"
    fi
  fi
done

# 6. Arquivos temporários do sistema (> 7 dias)
find /tmp -maxdepth 1 -type f -mtime +7 -delete 2>/dev/null || true
find /tmp -maxdepth 1 -type d -name "apmcb-*" -mtime +7 -exec rm -rf {} + 2>/dev/null || true

# 7. Relatório de disco
echo "==> Uso de disco após cleanup:"
df -h / | tail -1 | awk '{printf "    Usado: %s / %s (%s livre)\n", $3, $2, $4}'
docker system df --format "    Docker: {{.Type}} — {{.Size}} ({{.Reclaimable}} recuperável)" 2>/dev/null || true

echo "==> [$(date)] Cleanup concluído"
