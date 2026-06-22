# Fase 9 — E-mail Transacional (Resend)

> **DoD Canônica:** IMPLEMENTADO NÃO É ENTREGUE — ver `../07-canonical-definition-of-done.md`  
> **Harness ID:** PH-9  
> **Premissa:** Fase 8 concluída — inventário periódico com INV01-INV05 passando

---

## Objetivo

Integrar Resend SDK no BFF para envio de e-mails transacionais da plataforma (convite de usuário, setup de TOTP, passagem pendente, cautela emitida, inventário próximo do prazo), com logs de envio em audit_events.

---

## Escopo

- Resend SDK em `apps/bff/src/services/email.ts`
- 5 templates de e-mail transacional (convite, totp-setup, handover-pending, cautela-emitted, inventory-due)
- Disparar e-mail nos eventos correspondentes (nos endpoints já existentes)
- Logs de envio de e-mail em audit_events (action="email.sent")
- Variáveis de ambiente: `RESEND_API_KEY`, `FROM_EMAIL`, `FROM_NAME`

---

## Fora do Escopo

- ❌ Migrar e-mails de autenticação do Supabase para Resend (não fazer)
- ❌ SPF/DKIM/DMARC (aguarda domínio definitivo)
- ❌ Templates HTML elaborados com branding visual (apenas estrutura funcional)
- ❌ Unsubscribe / preferências de e-mail
- ❌ E-mails de marketing ou newsletters

---

## Premissas

| # | Premissa | Como verificar |
|---|---|---|
| P1 | Fase 8 completa | `pnpm test:e2e --project=inventory-suite` |
| P2 | `RESEND_API_KEY` disponível no BFF `.env` | `echo $RESEND_API_KEY` |
| P3 | `FROM_EMAIL` configurado com domínio verificado no Resend | Dashboard Resend |

---

## Arquivos Permitidos

**BFF:**
- `apps/bff/src/services/email.ts` — CRIAR (Resend SDK + sendEmail() helper)
- `apps/bff/src/lib/email-templates/` — CRIAR (templates de e-mail como funções)
- `apps/bff/src/routes/lendings.ts` — adicionar `sendEmail()` após emissão
- `apps/bff/src/routes/handovers.ts` — adicionar `sendEmail()` após criação
- `apps/bff/src/routes/inventory.ts` — adicionar `sendEmail()` após iniciar campanha

## Arquivos Proibidos

| Arquivo | Motivo |
|---|---|
| `apps/bff/src/routes/auth.ts` | Auth usa Supabase email — não tocar |
| `apps/web/src/**` | Zero mudanças no frontend |
| `supabase/migrations/**` | Zero migrations nesta fase |

---

## Tabelas Permitidas / Proibidas

**Nenhuma migration nesta fase.** Os e-mails são disparados em fire-and-forget nos endpoints existentes. Logs vão para `audit_events` (já existe).

---

## Variáveis de Ambiente

| Variável | Status | Descrição |
|---|---|---|
| `RESEND_API_KEY` | Necessária | Chave de API do Resend (não expor) |
| `FROM_EMAIL` | Necessária | E-mail remetente verificado no Resend |
| `FROM_NAME` | Necessária | Nome do remetente |
| `APP_URL` | Necessária | URL base da aplicação (para links nos e-mails) |

**Nunca logar o valor de `RESEND_API_KEY`.** Apenas confirmar que está presente.

---

## Serviço de E-mail

**Arquivo:** `apps/bff/src/services/email.ts`

```typescript
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  try {
    await resend.emails.send({
      from: `${process.env.FROM_NAME} <${process.env.FROM_EMAIL}>`,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    });
  } catch (err) {
    console.error("[email] falha ao enviar:", { to: payload.to, subject: payload.subject });
    // fire-and-forget — não quebrar a requisição por falha de e-mail
  }
}
```

**Princípio:** E-mail é fire-and-forget. Falha de e-mail NÃO deve retornar erro ao cliente. Logar o erro internamente.

---

## Templates

**Arquivo:** `apps/bff/src/lib/email-templates/invite.ts`
```typescript
export function inviteTemplate(params: { nome: string; url: string; orgao: string }) {
  return {
    subject: `Convite para a Plataforma de Governança — ${params.orgao}`,
    html: `
      <h1>Olá, ${params.nome}</h1>
      <p>Você foi convidado para acessar a Plataforma de Governança de Bens Sensíveis.</p>
      <a href="${params.url}">Ativar minha conta</a>
    `,
    text: `Olá, ${params.nome}. Acesse: ${params.url}`,
  };
}
```

**Demais templates a criar:**
- `totp-setup.ts` — quando admin cria usuário sem TOTP configurado
- `handover-pending.ts` — quando passagem aguarda assinatura do entrante
- `cautela-emitted.ts` — quando cautela é emitida (confirmação para o militar)
- `inventory-due.ts` — quando campanha de inventário se aproxima do prazo

---

## Disparos de E-mail por Evento

| Evento | Template | Destinatário |
|---|---|---|
| Convite de usuário criado | `invite` | Novo usuário |
| Cautela emitida | `cautela-emitted` | Militar que recebeu |
| Passagem pendente de assinatura | `handover-pending` | Armeiro entrante |
| Campanha de inventário iniciada | `inventory-due` | Admin_reserva de cada unidade |
| Usuário sem TOTP (novo) | `totp-setup` | Novo usuário |

---

## Testes

**Não há suite E2E própria para esta fase** — e-mail transacional é difícil de testar E2E.

**O que testar:**
- `apps/bff/src/services/email.ts` — teste unitário com Resend mockado
- Verificar que `audit_event` com `action="email.sent"` é criado após cada disparo
- Verificar que falha de e-mail não quebra o endpoint principal

```bash
cd apps/bff && pnpm test   # Bun test para email.test.ts
```

**Teste manual:** Criar cautela em staging → verificar e-mail recebido.

---

## Testes de Regressão

```bash
cd apps/web
pnpm test:e2e    # Todas as suites — zero falhas permitidas
```

**Esta fase não cria nova suite E2E.** A regressão completa das fases anteriores é suficiente.

---

## Critérios de Aceite

| # | Critério | Bloqueio? |
|---|---|---|
| CA01 | Cautela emitida → e-mail enviado ao militar | ✅ Verificação manual em staging |
| CA02 | Falha de envio não quebra endpoint | ✅ BLOQUEIO |
| CA03 | Logs: `audit_event` com action="email.sent" | ✅ Sim |
| CA04 | `RESEND_API_KEY` não aparece em nenhum log | ✅ BLOQUEIO |
| CA05 | Regressão completa verde | ✅ BLOQUEIO |
| CA06 | E-mails de autenticação do Supabase não alterados | ✅ Sim |

---

## Segurança

- `RESEND_API_KEY` apenas em `.env` do BFF — nunca no código, nunca em log
- E-mail não contém dados sensíveis além do necessário (nome, URL de ação)
- Links nos e-mails usam tokens de curta duração quando possível

---

## Definition of Done da Fase 9

### 1. Critérios Funcionais
- [ ] 5 templates de e-mail funcionando
- [ ] E-mails disparados nos eventos corretos

### 2. Critérios Técnicos
- [ ] Build passa, typecheck passa
- [ ] Zero migrations

### 3. Critérios de Segurança
- [ ] `RESEND_API_KEY` não em nenhum log ✅ BLOQUEIO
- [ ] Falha de e-mail não quebra endpoint ✅ BLOQUEIO

### 4. Auditoria
- [ ] audit_event action="email.sent" para cada envio

### 5-6. Multi-tenant, RBAC
- [ ] E-mail só enviado para destinatários do tenant correto

### 7. UI
- [ ] N/A — zero mudanças no frontend

### 8-10. Regressão, Evidências
- [ ] Regressão completa: todas as suites anteriores passando
- [ ] Verificação manual de e-mail recebido em staging
- [ ] Relatório em `docs/enterprise/reports/phase-9-final-report.md`

---

*Fase 9 — Resend Email v1.0 — 2026-06-20*
