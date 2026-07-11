# Rate Limit Hardening Design

> Data: 2026-07-11
> Escopo: brute force, reducao de credential stuffing e DoS economico no BFF APMCB.

## Prompt mestre

Use este prompt antes de aceitar qualquer nova rota publica, rota de autenticacao
ou endpoint com custo relevante:

```text
Audite este endpoint como arquiteto senior de seguranca enterprise.
Considere brute force, credential stuffing, DoS, custo de banco/API externa,
usuarios atras de NAT corporativo e bypass por ordem de middleware.

Exija:
1. Rate limit no BFF antes de authMiddleware e antes do handler da rota.
2. Bucket dedicado para login, exchange, heartbeat, rotas sensiveis,
   verificacao publica e API geral.
3. Limites documentados com janela, maximo, motivo e trade-off operacional.
4. Resposta 429 com Retry-After, X-RateLimit-Limit,
   X-RateLimit-Remaining e X-RateLimit-Reset.
5. Identidade de cliente baseada em headers de proxy somente quando
   RATE_LIMIT_TRUST_PROXY_HEADERS=true e o perimetro Cloudflare/Nginx remover
   headers enviados pelo cliente.
6. Teste automatizado que prove bloqueio, headers, isolamento de buckets e
   ausencia de rate limit fora de /api/*.
7. Risco residual documentado para ambiente multi-instancia; se houver mais de
   um processo BFF ativo, planeje Redis/Upstash/Cloudflare rate limiting como
   camada distribuida.

Nao trate Cloudflare Turnstile como substituto de rate limiting. Turnstile reduz
bot automatizado no login; o BFF ainda precisa proteger credenciais, banco,
Supabase Auth e rotas publicas contra volume.
```

## Objetivo

Garantir que o app nao aceite centenas de tentativas de senha ou chamadas caras
por minuto a partir do mesmo cliente. A defesa deve ser verificavel no repo,
compatível com Turnstile ja existente no login e escalavel para migracao futura
para storage distribuido.

## Fora do escopo

- Trocar nesta fatia o storage in-memory por Redis/Upstash.
- Alterar a semantica do login, Turnstile ou Supabase Auth.
- Criar bloqueio por conta/e-mail persistido em banco. Isso fica como proxima
  camada quando houver telemetria e UX de desbloqueio definidas; ate la, o
  controle por IP reduz brute force de origem unica, mas nao encerra credential
  stuffing distribuido.

## Arquitetura atual

`apps/bff/src/middleware/rate-limit.ts` aplica sliding window por IP em buckets
independentes:

| Perfil | Rota | Limite | Janela | Motivo |
|---|---:|---:|---:|---|
| `login` | `/api/auth/login` | 5 | 15 min | anti brute force de senha |
| `exchange` | `/api/auth/exchange` | 120 | 1 min | fluxo de token sem senha |
| `authMe` | `/api/auth/me` | 600 | 1 min | heartbeat de sessao sem competir com API geral |
| `sensitive` | `/api/totp/*`, `/api/ssa/*`, `/api/biometric/*` | 100 | 1 min | operacoes sensiveis com protecoes secundarias |
| `publicVerify` | `/api/public/*` exceto branding | 30 | 1 min | endpoints publicos sem sessao |
| `general` | demais `/api/*` | 120 | 1 min | API autenticada geral |

O middleware roda em `app.use("/api/*", routeRateLimiter)` antes de `authRoutes`
e antes das rotas com `authMiddleware`.

Em producao, `getClientIp()` so confia em `CF-Connecting-IP`, `X-Real-IP` e
`X-Forwarded-For` quando `RATE_LIMIT_TRUST_PROXY_HEADERS=true`. Essa configuracao
deve ser usada apenas quando Cloudflare/Nginx estiverem impedindo acesso direto ao
BFF e sobrescrevendo/removendo headers de forwarding enviados pelo cliente.

## Turnstile

Cloudflare Turnstile continua sendo camada anti-bot do login. Ele nao substitui
rate limiting porque:

- pode operar em modo soft gate quando o widget falha;
- nao protege rotas internas autenticadas;
- nao controla custo de banco/Supabase por IP;
- nao e uma politica de quota por rota.

## Harness

Novo teste: `apps/bff/src/__tests__/rate-limit-hardening-harness.test.ts`.

O harness valida:

- perfis exportados em `RATE_LIMIT_PROFILES`;
- ordem do middleware no `index.ts`;
- fail-closed de headers de proxy em producao sem `RATE_LIMIT_TRUST_PROXY_HEADERS`;
- preferencia por `CF-Connecting-IP` sobre `X-Forwarded-For` quando proxy trust esta habilitado;
- bloqueio do login na sexta chamada por IP;
- headers e body de `429`;
- isolamento do bloqueio de login contra exchange e API geral;
- buckets dedicados para TOTP/auth heartbeat/verificacao publica/branding;
- `/health` fora de `/api/*` sem headers de rate limit.

## Risco residual

O storage atual e in-memory por processo. Em um BFF horizontal com multiplas
replicas, o limite efetivo pode multiplicar pelo numero de instancias se nao
houver afinidade ou rate limit antes do app. Para escala multi-instancia, a
evolucao correta e mover contadores para Redis/Upstash ou aplicar uma camada
Cloudflare Rate Limiting/WAF antes do BFF, mantendo este harness como contrato
de comportamento.

O limite primario de login e por IP. Isso pode bloquear muitos usuarios legitimos
em um NAT de quartel se houver erro massivo ou abuso local, e tambem nao elimina
credential stuffing distribuido com rotacao de IP/IPv6. A camada enterprise
seguinte deve adicionar contador por conta/e-mail normalizado com resposta
generica, observabilidade e fluxo operacional de desbloqueio.

## Validacao obrigatoria

```bash
cd apps/bff
node --experimental-strip-types --test src/__tests__/rate-limit-hardening-harness.test.ts
```

```bash
pnpm --filter @apmcb/bff typecheck
```
