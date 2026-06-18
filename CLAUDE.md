# APMCB — Project Guidelines

## UX Principles

- **Mínimo de fricção**: toda ação principal deve ser acessível em ≤ 2 cliques
- **Feedback visual imediato**: badges, ícones e cores comunicam estado sem precisar ler texto
- **Defaults inteligentes**: formulários com campos opcionais ao mínimo; o que pode ser inferido, deve ser
- **Cards de atalho**: contagens em tempo real nos cards de painel eliminam navegação desnecessária
- **Confirmação contextual**: dialogs de confirmação só para ações destrutivas ou irreversíveis

## Architecture

- **Frontend**: Next.js 16 (CF Pages, edge runtime) — `apps/web`
- **BFF**: Hono on Hetzner VPS — `apps/bff`
- **DB**: Supabase (PostgreSQL + Realtime + Storage) — project `jepitcrkicwmvzrmllpn`

## Security

- Service role key **never** in client code — only in BFF routes
- No secrets in GitHub — use CF Pages env vars and BFF `.env`
- TOTP secrets stored only in `totp_secrets` table, accessed exclusively via BFF

## Validation

- **Never deploy without visual validation via Playwright first**
- Run `pnpm test:e2e` from `apps/web` before pushing to production
