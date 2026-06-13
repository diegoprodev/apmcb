# Secrets & Environment Variables

## Estratégia

| Onde | O que fica |
|---|---|
| **Cloudflare Pages dashboard** | Vars do frontend (NEXT_PUBLIC_*) |
| **VPS `.env`** (nunca no git) | Vars privadas do BFF |
| **GitHub Secrets** | Apenas SSH de infra (HETZNER_HOST, USER, KEY) |

## GitHub Secrets (só 3)

| Secret | Descrição |
|---|---|
| `HETZNER_HOST` | IP do VPS |
| `HETZNER_USER` | Usuário SSH (`root` ou `deploy`) |
| `HETZNER_SSH_KEY` | Conteúdo de `~/.ssh/apmcb_hetzner` (chave privada) |

## Cloudflare Pages

CF Pages → apmcb → Settings → Environment variables:
- `NEXT_PUBLIC_SUPABASE_URL` = https://jepitcrkicwmvzrmllpn.supabase.co
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = (anon key)
- `NEXT_PUBLIC_BFF_URL` = https://bff.apmcb.com.br

## VPS /var/www/apmcb/.env

```
SUPABASE_URL=https://jepitcrkicwmvzrmllpn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
PORT=3001
NODE_ENV=production
WEB_URL=https://apmcb.pages.dev
FINGERPRINT_SDK=zkteco
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@apmcb.com.br
```
