# E-mail Transacional — SSOT

Fonte única de verdade do subsistema de e-mail. Plano completo (PRD + spec + fases):
`.claude/plans/quero-que-leia-todo-dreamy-star.md`. Supersede parcialmente
`docs/enterprise/phases/phase-9-resend-email.md`.

## Arquitetura

Híbrido:

- **E-mails de AUTH** (convite, reset de senha, magic link, troca de e-mail): o link/token é
  gerado pelo GoTrue do Supabase. O envio sai pelo **SMTP custom configurado no dashboard do
  Supabase**. Estado atual: Mailjet (`no-reply@auth.pmpb.online`). Migração para Resend
  (`alertas.pmpb.online`) decidida — passo manual pendente (ver abaixo).
- **E-mails do APP** (`welcome`, `new_login`, `password_changed`, `invite` companheiro): o
  Supabase não participa. O **BFF** chama a **API REST do Resend** diretamente.

```
apps/web (edge)  --POST /api/internal/email (x-internal-email-secret)-->  apps/bff
  lib/notify-email.ts  (fire-and-forget, timeout 3s)

apps/bff
  middleware/internal-secret.ts     guard + log de negação (internal.auth.denied)
  routes/internal.ts                wrapper HTTP fino — injeta Supabase + sendEmail
  lib/email-orchestrator.ts         TODA a lógica (validação, lookup, dedup, rate/cap,
                                    render, envio, trilha). Testável isolado.
  lib/email-templates/*             funções 100% puras; escapeHtml em todo campo
  lib/email-dedup.ts                HMAC + tabela email_dedup (não pré-colidível)
  lib/email-rate.ts                 token-bucket em memória por categoria
  services/email.ts                 transporte Resend: timeout, fail-soft, redação
```

Regra: `services/email.ts` não conhece templates nem HTTP. Templates não fazem I/O nem leem env.
Call sites (auth.ts, admin.ts, edge routes) só disparam.

## Categorias

- `security` — `password_changed`, `new_login`. Nunca silenciados: sob rate-limit/cota saturada,
  o BFF loga `email.security.throttled` e **segue tentando enviar**.
- `lifecycle` — `welcome`, `invite`. Barrados pelo teto diário; um throttle é aceitável.

## Variáveis de ambiente (VPS `.env`)

| Var | Obrigatória | Nota |
|---|---|---|
| `EMAIL_ENABLED` | não | `false` (default) → `sendEmail` vira no-op logado |
| `RESEND_API_KEY` | para enviar | chave `bff-transacional`. Só no `.env` do VPS |
| `FROM_EMAIL` | para enviar | `nao-responda@alertas.pmpb.online` |
| `FROM_NAME` | não | `Andrômeda` |
| `FRONTEND_URL` | não | default `https://apmcb.pmpb.online` |
| `INTERNAL_EMAIL_SECRET` | sim (web+BFF) | **distinto** de `INTERNAL_API_SECRET`. `openssl rand -hex 32` |
| `EMAIL_DEDUP_PEPPER` | sim | `openssl rand -hex 32` |
| `EMAIL_DAILY_CAP` | não | default 60 (tier free Resend 100/dia − ~40 reserva AUTH) |
| `EMAIL_RATE_MAX` | não | default 20/min por categoria |
| `EMAIL_SEND_TIMEOUT_MS` | não | default 8000 |

`INTERNAL_EMAIL_SECRET` também vai no CF Pages (env do `apps/web`).

## Redação de log

`resend_api_key`, `internal_email_secret`, `email_dedup_pepper`, `login_device_hash_pepper`,
`email_html`, `email_text` estão em `REDACT_PATHS` (`apps/bff/src/lib/logger.ts`). Destinatário
sempre via `maskEmail` (`d***@***`). Nunca logar `data` / corpo renderizado / a chave.

## Eventos de log (grep-áveis)

`internal.auth.denied` · `internal.email.unknown_template` · `internal.email.invalid_data` ·
`internal.email.unknown_recipient` · `email.skipped` · `email.dedup.error` ·
`email.security.throttled` · `email.sent` · `email.send.failure` · `email.send_failed` (também
`audit_logs`, aparece em `GET /api/nexus/errors`).

## Passos manuais — Fase 0

1. **Resend — domínio.** Verificado: **`alertas.pmpb.online`** (subdomínio). DNS na Cloudflare:
   `resend._domainkey.alertas` (DKIM), `send.alertas` TXT SPF + MX (AmazonSES), `rastreamento.alertas`
   CNAME. **DMARC: pendente** — adicionar `_dmarc.alertas.pmpb.online` TXT
   `v=DMARC1; p=quarantine; sp=reject; pct=100; rua=mailto:<endereço>` (decisão do usuário: adiado).
2. **Resend — chaves.** Revogar qualquer chave exposta. Criar `bff-transacional` (→ `.env` do
   VPS) e `supabase-smtp` (→ config SMTP do Supabase). Billing/usage alert no dashboard.
3. **Supabase — Custom SMTP → Resend.** Authentication → Emails → SMTP: host `smtp.resend.com`,
   porta `465`, user `resend`, senha = chave `supabase-smtp`, sender `nao-responda@alertas.pmpb.online`,
   sender name `Andrômeda - Sistema de Governança`. Rate Limits → "Emails per hour" ~150. Revisar os
   templates pt-BR (Invite / Reset / Magic Link / Change Email). Corrigir o mojibake do
   `smtp_sender_name` atual ("AndrÃ´meda System" → "Andrômeda System").
4. **VPS `.env`** — adicionar as vars da tabela acima. `docker compose -f docker-compose.prod.yml
   up -d --build bff`. Conferir `docker logs apmcb-bff` sem erro de boot.
5. **Canário** — `pg_cron` a cada 15 min → `net.http_post` para `POST /api/internal/email`
   template `canary` (`recipient_id` de um profile de sistema) → `delivered@resend.dev`. Segredo
   via Postgres settings/Vault. Alarme se faltar `email.sent`.
6. **Migrations** — aplicar `20260908000000_email_log_and_dedup.sql` (testar em branch Supabase
   antes). `pg_cron` e `pg_net` já instalados no projeto.

### Pendência técnica separada (pré-requisito da Fase 3)

Race da hash-chain de `audit_events` (`middleware/audit.ts` — `getLastEventHash` + INSERT não
atômico). **Não** é introduzida por este trabalho e e-mails não escrevem em `audit_events`.
Correção (RPC `append_audit_event` com `pg_advisory_xact_lock` + revalidação `stale_chain` +
retry no TS) tem seu próprio ciclo de review e deve estar pronta **antes** da Fase 3 (que escreve
auditoria no caminho quente de login).

## Runbook — Resend fora do ar

- **E-mails do APP**: degradam sozinhos (fire-and-forget). `email.send_failed` no log + painel
  Nexus. Sem retry no v1.
- **E-mails de AUTH** (após migrar o SMTP do Supabase para Resend): convites/resets param.
  Mitigação: dashboard Supabase → Authentication → Emails → SMTP → desabilitar Custom SMTP (ou
  reapontar para o Mailjet), reabilitar quando o Resend voltar. Monitorar o status page + canário.

## Verificação por fase

Checklists detalhados no plano (§5.4). Resumo: unit/integração determinístico (CI) + E2E contra
produção (assert de estado, nunca inbox; fixture `delivered+apmcb-e2e@resend.dev`) + verificação
manual documentada com screenshot em 4 clientes.
