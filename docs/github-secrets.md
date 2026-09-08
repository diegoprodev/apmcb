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

# E-mail transacional (Resend) — ver docs/email-transacional.md.
# Sem RESEND_API_KEY / EMAIL_ENABLED=false → sendEmail vira no-op (fail-soft).
EMAIL_ENABLED=false
RESEND_API_KEY=
FROM_EMAIL=nao-responda@alertas.pmpb.online
FROM_NAME=APMCB
FRONTEND_URL=https://apmcb.pmpb.online
INTERNAL_EMAIL_SECRET=
EMAIL_DEDUP_PEPPER=
EMAIL_DAILY_CAP=60
EMAIL_RATE_MAX=20
```

`INTERNAL_EMAIL_SECRET` também precisa estar no ambiente do CF Pages (o `apps/web`
usa `lib/notify-email.ts` para chamar o BFF). É **distinto** de `INTERNAL_API_SECRET`.
