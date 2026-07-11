# OWASP Input Hardening Design

> Data: 2026-07-11
> Escopo: SQL Injection, XSS e CSRF em codigo de aplicacao APMCB.

## Objetivo

Blindar o app contra tres classes historicas de ataque, de forma verificavel no repo:

- SQL Injection: impedir raw SQL dinamico em codigo de aplicacao e manter queries via Supabase query builder/RPC tipada.
- XSS: impedir sinks de HTML/script no frontend e manter CSP/headers como defesa em profundidade.
- CSRF: garantir middleware BFF antes das rotas autenticadas e header `X-CSRF-Token` no cliente.

## Fora do Escopo

- Migrations SQL versionadas e scripts operacionais fora de `apps/*/src`.
- Refatoracao ampla de todos os route handlers Next que usam Supabase SSR/RLS.
- Troca estrutural da CSP do Next App Router para nonce-only. O App Router ainda requer inline bootstrap/hydration; a defesa atual e CSP restritiva com `unsafe-eval` proibido em producao.

## Arquitetura

O controle fica em tres camadas:

1. Harness estatico BFF (`owasp-input-safety-harness.test.ts`) que varre `apps/bff/src` e `apps/web/src`.
2. Remocao do sink XSS encontrado no exportador PDF (`GridPdfButton`), substituindo string HTML por DOM API segura.
3. Documentacao de seguranca atualizada para tornar os guardrails canonicos.

## SQL Injection

Regra canonica:

- Codigo em `apps/bff/src` e `apps/web/src` nao pode usar raw SQL runtime:
  `execute_sql`, `exec_sql`, `postgres(...)`, template `sql\`` mesmo com comentario
  intermediario, `.raw(...)`, `pool.query(...)`, `client.query(...)`,
  `db.execute(...)`, `connection.execute(...)`, `prisma.$queryRaw*` ou
  `prisma.$executeRaw*`.
- Queries devem usar Supabase query builder (`from`, `select`, `eq`, `in`, `or` com valores controlados) ou RPCs nomeadas.
- Scripts de seed e migrations podem conter SQL, mas ficam fora do harness porque sao artefatos operacionais; qualquer script que aceite input externo precisa revisao propria antes de uso.

## XSS

Regra canonica:

- Proibido `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`,
  `insertAdjacentHTML`, `document.write`, variantes computadas diretas como
  `document["write"]`, `eval` e `new Function` em codigo de aplicacao.
- Exportacao/print deve montar DOM com `createElement`, `textContent`, `appendChild` e atributos definidos por propriedade.
- URLs de imagem vindas de dados devem passar por allowlist de protocolo (`https:`, `blob:` ou data image raster).

## CSRF

Regra canonica:

- `csrfMiddleware` roda em `/api/*` antes de rotas autenticadas.
- Mutations de browser exigem `session.csrfToken` na iron-session e header `X-CSRF-Token`.
- O helper do browser le token de `sessionStorage`/fallback de teste em `localStorage`; nao le `document.cookie`.
- Excecoes precisam ser path exato, sem `startsWith`, e nao podem incluir rotas operacionais como `lendings`, `saidas`, `cautelamentos`, `admin` ou `arsenal`.

## Validação

Comandos obrigatorios:

```bash
cd apps/bff
node --experimental-strip-types --test src/__tests__/owasp-input-safety-harness.test.ts
```

```bash
pnpm --filter @apmcb/bff typecheck
pnpm --filter @apmcb/web typecheck
```

## Risco Residual

- Harness estatico nao substitui DAST/pentest nem analise semantica de todos os
  fluxos, mas bloqueia regressao das classes de erro mais comuns no codigo de
  aplicacao e inclui amostras de bypass para drivers SQL e sinks DOM conhecidos.
- CSP ainda usa `unsafe-inline` para compatibilidade com Next App Router; isso deve ser revisitado apenas quando houver uma estrategia suportada de nonce/hydration para a versao em uso.
