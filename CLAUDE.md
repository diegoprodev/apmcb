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

## Code Review — Obrigatório antes de cada commit

**Regra canônica inegociável**: antes de qualquer commit com mudanças em código de produção, invocar o sub-agente de code review sênior com o seguinte mandato:

```
Agent({
  subagent_type: "code-reviewer",
  prompt: `
Faça uma revisão de código EXTREMAMENTE rigorosa e imparcial das mudanças abaixo.
Postura: engenheiro sênior corrigindo uma redação para nota 1000. Sem piedade com problemas reais.

FOCO OBRIGATÓRIO (todos os itens, sem exceção):
1. Bugs silenciosos: race conditions, null dereference, off-by-one, estado inconsistente entre renders
2. Escalabilidade: O(n²) ocultos, queries sem índice, N+1 queries, memória não liberada
3. Segurança: injeção, XSS, CSRF, vazamento de segredos, privilege escalation, IDOR
4. Testes: o que DEVERIA ter teste e não tem; o que o teste existente NÃO cobre
5. Boas práticas: violações de SRP/DRY/SSOT/KISS; acoplamento desnecessário; abstrações prematuras
6. Edge cases: inputs vazios, usuário sem permissão, timeout, falha de rede, estado inválido
7. Regressão: o que essa mudança pode quebrar silenciosamente em outros fluxos

ARQUITETURA DO PROJETO:
- Frontend: Next.js (CF Pages, edge runtime) — apps/web
- BFF: Hono/Bun no VPS — apps/bff
- DB: Supabase PostgreSQL + RLS
- Sessão: iron-session HttpOnly no BFF; sb-* cookies no Supabase SSR
- Service role key: NUNCA no client; apenas no BFF

ARQUIVOS MODIFICADOS:
[listar os arquivos e diffs]

Retorne: lista ordenada por severidade (CRÍTICO > ALTO > MÉDIO > BAIXO).
Para cada item: arquivo:linha, descrição do problema, cenário de falha concreto, sugestão de fix.
Se nenhum problema: confirme explicitamente que a revisão passou.
`
})
```

**Quando executar**: em toda tarefa que modifique arquivos `.ts`, `.tsx`, `.sql`, `.yml` de produção.
**Quando NÃO é necessário**: mudanças apenas em testes, docs, CHANGELOG, arquivos de config sem lógica.
**Bloqueador**: se o review retornar item CRÍTICO ou ALTO não endereçado, não commitar. Corrigir e re-revisar.

## Validation

- **Never deploy without visual validation via Playwright first**
- Run `pnpm test:e2e` from `apps/web` before pushing to production
