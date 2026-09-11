# Andrômeda — Project Guidelines

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

## Pipeline de qualidade — A ORDEM IMPORTA (regra canônica inegociável)

**Gestão sênior de arquitetura e engenharia, sempre com foco em escala modular.** Claude continua
implementando, mas **deixa de ser o único que decide se o código está pronto**. Nenhuma etapa
pula a anterior, e nenhuma tarefa de código de produção é declarada "concluída" sem passar pela
cadeia inteira — achado real (SP2, isolamento por reserva, 2026-09-10): 9 tarefas foram commitadas
com só teste de asserção-de-texto (`readFileSync().includes(...)`) e chamadas de "prontas"; a
revisão adversarial feita SÓ NO FINAL achou IDOR real (`reserve_id` do cliente sem validação de
tenant/autoridade) e um DELETE destrutivo que apaga dados antes de checar se a operação principal
vai falhar — nenhum dos dois teria sobrevivido se a cadeia abaixo tivesse rodado por tarefa.

```
1. Claude implementa       (TDD — superpowers:test-driven-development)
2. Playwright testa        (mcp__playwright__* — navegador real, não mock)
3. Verificação de fluxo    (spec-to-code-compliance + differential-review — "TestSprite": cada
                             requisito do spec/plano contra o código, achados adjudicados)
4. Code Review             (sub-agente sênior, mandato abaixo — corrigir e re-revisar até 0
                             CRÍTICO/ALTO)
5. Varredura de segurança  (insecure-defaults:audit — Trail of Bits — + static-analysis:semgrep
                             no diff)
```

**Quando rodar a cadeia inteira**: a cada tarefa/commit de código de produção (`.ts`, `.tsx`,
`.sql`, `.yml`) — não só uma vez no fim de um plano de várias tarefas. Um plano com N tarefas
gera N passagens pela cadeia, não 1.

**Contra-teste da etapa 4 (Code Review)**: teste de asserção-de-texto (`.includes()` no arquivo)
prova que o código FOI ESCRITO; não prova que o código FUNCIONA contra o schema/banco/navegador
real. Serve como guarda de regressão de fiação, nunca como única evidência de correção — a
correção vem das etapas 2 e 3.

**Escala modular**: cada etapa deve caber isolada — um módulo pequeno e testável passa pela
cadeia mais rápido e barato que revisar um monólito no fim. Preferir tarefas bite-sized (uma
função, uma rota, um componente) exatamente para que a cadeia rode barato e com frequência.

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

## Debug — sempre pelo BFF primeiro

**Regra canônica**: ao investigar qualquer bug relatado pelo usuário ("deu erro", "travou",
"não funcionou"), a primeira fonte de verdade é a observabilidade do BFF — **nunca** assumir a
causa a partir do sintoma no cliente sem checar o lado do servidor primeiro. Ganha tempo e token:
o log já tem status, path, payload de erro estruturado (sem PII/segredo) e `requestId` de
correlação; adivinhar pelo comportamento do frontend é mais lento e mais impreciso.

Ordem de investigação:
1. `docker logs apmcb-bff --since <janela>` no VPS (SSH: `ssh -i ~/.ssh/apmcb_hetzner root@91.99.113.89`,
   `docker exec apmcb-bff` para contexto vivo) — grep pelo evento nomeado (`"msg":"totp.validate.failure"`),
   pelo `requestId` (se o cliente reportou um), ou pelo path/status.
   **Limitação real**: `docker logs` só retém desde o último restart do container — um deploy
   recente apaga o histórico anterior. Se o container foi recriado depois do incidente, não vai
   ter nada ali (achado real, 2026-08-27).
2. `GET /api/nexus/errors` (painel Nexus) — trilha persistente via `audit_logs`, sobrevive a
   restart do container.
3. Só depois disso, se nada aparecer, investigar o código estaticamente (schema/validação/lógica)
   e o client-side.

**Todo evento de negação/bloqueio/falha de validação precisa deixar rastro no log** — não é
aceitável um fluxo de erro que responde ao cliente mas nunca loga nada no BFF (achados reais
corrigidos em 2026-08-27: `zValidator` sem hook — falha de validação Zod invisível; rate limiter
retornando 429 direto sem log — força bruta invisível; `roleGuard` sem contexto de quem/o quê).

## Falhas pré-existentes — Regra canônica inegociável

Qualquer falha encontrada durante o trabalho (teste quebrado, suite vermelha, erro em log, warning) — **mesmo que não tenha sido causada pela mudança atual** — deve ser investigada até a causa raiz e corrigida antes de encerrar a tarefa. Não é aceitável classificar como "débito técnico pré-existente" e seguir em frente sem resolver. Confirmar que a falha é pré-existente (ex: via `git stash` + reprodução) é apenas o primeiro passo do diagnóstico, não uma justificativa para deixá-la sem correção.
