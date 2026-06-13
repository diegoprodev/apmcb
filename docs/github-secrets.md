# GitHub Actions Secrets

Configure these in: **GitHub → Settings → Secrets and variables → Actions**

## Required secrets

| Secret | Description | Where to get |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Supabase Dashboard → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key | Supabase Dashboard → Project Settings → API |
| `NEXT_PUBLIC_BFF_URL` | BFF public URL | `https://bff.apmcb.com.br` |
| `HETZNER_HOST` | VPS IP address | Hetzner Cloud Console |
| `HETZNER_USER` | SSH user on VPS | `deploy` (created by setup-vps.sh) |
| `HETZNER_SSH_KEY` | SSH private key | Generate: `ssh-keygen -t ed25519 -C "github-actions"` |
| `CLOUDFLARE_API_TOKEN` | CF API token with Pages:Edit permission | Cloudflare → My Profile → API Tokens |
| `CLOUDFLARE_ACCOUNT_ID` | CF account ID | Cloudflare → Overview (right sidebar) |

## VPS .env file

Copy `.env.example` to `/var/www/apmcb/.env` on the VPS and fill in:

```env
SUPABASE_URL=https://jepitcrkicwmvzrmllpn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
WEB_URL=https://apmcb.pages.dev
FINGERPRINT_SDK=zkteco
VAPID_PUBLIC_KEY=<generate with: npx web-push generate-vapid-keys>
VAPID_PRIVATE_KEY=<from above>
VAPID_SUBJECT=mailto:admin@apmcb.com.br
```
