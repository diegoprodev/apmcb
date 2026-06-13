#!/usr/bin/env bash
# Run on VPS to deploy latest version
# Usage: ssh deploy@VPS_IP "bash /var/www/apmcb/scripts/deploy.sh"

set -euo pipefail

APP_DIR="/var/www/apmcb"

echo "==> Pulling latest code..."
cd "$APP_DIR"
git pull origin main

echo "==> Rebuilding BFF container..."
docker compose build bff --no-cache

echo "==> Restarting services..."
docker compose up -d --remove-orphans

echo "==> Pruning old images..."
docker image prune -f

echo "==> Deploy complete! Health check:"
sleep 3
curl -s http://localhost:3001/health | python3 -m json.tool
