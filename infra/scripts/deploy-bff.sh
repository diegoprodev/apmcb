#!/usr/bin/env bash
# deploy-bff.sh — rebuild BFF Docker image, swap container, prune old images
# Usage: bash deploy-bff.sh [--env-file /path/to/.env]
set -euo pipefail

REPO_DIR="/tmp/apmcb-repo"
IMAGE_NAME="apmcb-bff"
CONTAINER_NAME="apmcb-bff"
PORT="127.0.0.1:3001:3001"
ENV_FILE="${1:-/opt/apmcb/.env}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
NEW_TAG="${IMAGE_NAME}:${TIMESTAMP}"

echo "==> [$(date)] Deploy BFF iniciado"

# 1. Atualizar repo
if [ -d "$REPO_DIR" ]; then
  echo "==> Atualizando repositório..."
  git -C "$REPO_DIR" fetch origin main --quiet
  git -C "$REPO_DIR" reset --hard origin/main --quiet
else
  echo "==> Clonando repositório..."
  git clone https://github.com/diegocpro/apmcb.git "$REPO_DIR" --depth=1 --quiet
fi

# 2. Build nova imagem com tag timestamp
echo "==> Build da imagem ${NEW_TAG}..."
docker build \
  -t "$NEW_TAG" \
  -t "${IMAGE_NAME}:latest" \
  "$REPO_DIR/apps/bff"

# 3. Parar e remover container antigo (sem falhar se não existir)
echo "==> Substituindo container..."
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm   "$CONTAINER_NAME" 2>/dev/null || true

# 4. Subir container novo
if [ -f "$ENV_FILE" ]; then
  ENV_ARGS="--env-file $ENV_FILE"
else
  echo "AVISO: arquivo $ENV_FILE não encontrado, subindo sem vars extras"
  ENV_ARGS=""
fi

docker run -d \
  --name "$CONTAINER_NAME" \
  -p "$PORT" \
  --restart unless-stopped \
  $ENV_ARGS \
  "${IMAGE_NAME}:latest"

# 5. Aguardar health check
echo "==> Aguardando health check..."
STATUS="FAIL"
for i in $(seq 1 15); do
  if curl -sf http://127.0.0.1:3001/health >/dev/null 2>&1; then
    STATUS="OK"
    echo "==> Health OK após ${i}s"
    break
  fi
  sleep 1
done

if [ "$STATUS" != "OK" ]; then
  echo "ERRO: health check falhou — veja: docker logs $CONTAINER_NAME"
  docker logs --tail 30 "$CONTAINER_NAME"
  exit 1
fi

# 6. Remover imagens antigas (manter apenas últimas 3 + latest)
echo "==> Limpando imagens antigas..."
docker images "${IMAGE_NAME}" --format "{{.Tag}}\t{{.ID}}" \
  | grep -v "^latest" \
  | sort -r \
  | tail -n +4 \
  | awk '{print $2}' \
  | xargs -r docker rmi -f

# 7. Remover imagens dangling
docker image prune -f --filter "until=24h" >/dev/null

echo "==> [$(date)] Deploy concluído — container rodando: $(docker ps --format '{{.Names}} ({{.Status}})' -f name=$CONTAINER_NAME)"
