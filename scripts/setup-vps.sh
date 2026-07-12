#!/usr/bin/env bash
# APMCB VPS setup script — run once on fresh Hetzner CAX21 (Ubuntu 24.04 ARM)
# Usage: curl -sSL https://raw.githubusercontent.com/diegoprodev/apmcb/main/scripts/setup-vps.sh | sudo bash

set -euo pipefail

echo "==> Updating system..."
apt-get update -y && apt-get upgrade -y

echo "==> Installing dependencies..."
apt-get install -y curl git nginx certbot python3-certbot-nginx ufw

echo "==> Installing Docker..."
curl -fsSL https://get.docker.com | sh
systemctl enable docker && systemctl start docker

echo "==> Installing Docker Compose plugin..."
apt-get install -y docker-compose-plugin

echo "==> Configuring firewall..."
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> Creating deploy user..."
useradd -m -s /bin/bash deploy 2>/dev/null || true
usermod -aG docker deploy

echo "==> Creating app directory..."
mkdir -p /var/www/apmcb
chown deploy:deploy /var/www/apmcb

echo "==> Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Clone repo: cd /var/www && git clone https://github.com/diegoprodev/apmcb.git apmcb"
echo "  2. Copy .env: cp /var/www/apmcb/.env.example /var/www/apmcb/.env && nano /var/www/apmcb/.env"
echo "  3. Get SSL cert: certbot --nginx -d api.apmcb.pmpb.online"
echo "     (certbot --nginx configura o cert direto no nginx do sistema — não precisa copiar"
echo "     arquivos manualmente. Ver infra/nginx/api.apmcb.pmpb.online.conf para a config"
echo "     de referência do site em /etc/nginx/sites-enabled/apmcb.)"
echo "  4. Start BFF: bash /var/www/apmcb/infra/scripts/deploy-bff.sh"
