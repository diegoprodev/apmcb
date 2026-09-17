# Enterprise Spec — Troca de E-mail de Acesso por Administrador

> **Data:** 2026-09-15
> **Fase:** Hardening de feature existente (não é greenfield)
> **DoD Canônica:** `docs/enterprise/07-canonical-definition-of-done.md`
> **Princípios:** SRP, DRY, SSOT, KISS, YAGNI, FailFast, Privilege Ceiling
> **Nota-alvo:** 9.5/10 — feature toca identidade de login (`auth.users.email`), então o
> padrão de rigor é o mesmo de assinatura eletrônica/auditoria (Fases 3-4), não o de uma
> tela de CRUD comum.

---

## 1. Contexto e Motivação

Andrômeda precisa que `admin_global` e `admin_reserva` possam trocar o e-mail de acesso de
outro usuário **mantendo a mesma conta** (mesmo `auth.users.id`, mesmo histórico de cautelas/
saídas/assinaturas — nunca delete+recreate). Pedido originado de uma necessidade concreta:
trocar o e-mail do armeiro de teste (`armeiro@apmcb.dev`, mockado) para um Gmail real
(`pmpbdga@gmail.com`), para validar com inbox de verdade o sistema de e-mail transacional
(Resend) que hoje só foi testado com endereços sintéticos.

**Esta não é uma feature nova.** Investigação de código (3 buscas independentes e completas
no repositório) achou que a troca de e-mail **já existe, implementada e em produção**, em
`apps/web/src/app/api/admin/users/route.ts` (branch `existing_user_id`, chamada pelo diálogo
"Alterar e-mail de acesso" em `apps/web/src/app/(dashboard)/admin/usuarios/_edit-dialog.tsx`).
O que já funciona corretamente:

- Teto de permissão próprio, mais estreito que o convite geral: `canChangeUserEmail()`
  (`apps/web/src/lib/invite-ceiling.ts:38-40`) — só `admin_global`/`admin_reserva`, nunca
  `armeiro`, mesmo quando o alvo (role `usuario`) estaria dentro do teto geral dele.
- Lock otimista anti-TOCTOU: reivindica a linha em `profiles` (`UPDATE ... WHERE email =
  oldEmail`) **antes** de tocar `auth.users` — só o request que "vence" a corrida prossegue.
- Dual-write consistente: `auth.users.email` (fonte de verdade de login, via
  `supabase.auth.admin.updateUserById`) + espelho `profiles.email` (usado por UI/joins).
- Rollback verificado: se `updateUserById` falhar, o `profiles.email` é restaurado a partir
  do valor **atual e confirmado** em `auth.users` (não de uma variável local capturada no
  início da request), evitando gravar um e-mail "fantasma" que nunca existiu de fato.
- Magic link enviado para o e-mail novo (login imediato) + notificação in-app.

O que **não** está pronto para nível "enterprise" — 3 gaps reais, achados nesta investigação,
não hipotéticos:

## 2. Estado Atual — Diagnóstico

| ID | Severidade | Descrição | Arquivo |
|---|---|---|---|
| EMAIL-01 | **CRÍTICO** | Sem escopo por reserva: a rota só verifica `default_tenant_id`. Um `admin_reserva` da Reserva A troca hoje o e-mail de login de um usuário da Reserva B (mesmo tenant) — mesma classe de IDOR que o épico "isolamento por reserva" existe para fechar em outras tabelas. | `apps/web/src/app/api/admin/users/route.ts:137` |
| EMAIL-02 | **CRÍTICO** | Troca é instantânea (`email_confirm: true`) sem confirmação em nenhum endereço. Não existe, hoje, NENHUM mecanismo no repositório para notificar o e-mail ANTIGO — o orquestrador de e-mail (`email-orchestrator.ts`) sempre resolve o e-mail *atual* do destinatário via `profiles`, que no momento de qualquer disparo já seria o e-mail NOVO. Um admin malicioso ou uma sessão de admin comprometida pode sequestrar silenciosamente a conta de qualquer usuário do tenant (ou, hoje, de qualquer reserva — ver EMAIL-01) e usar "esqueci minha senha" no e-mail novo para assumir a conta por completo. | `apps/web/src/app/api/admin/users/route.ts:202-205`, `apps/bff/src/routes/internal.ts:36-47` |
| EMAIL-03 | **ALTO** | Nenhuma re-autenticação do admin que está executando a ação. Único precedente de "step-up" no repositório é TOTP do operador em `POST /api/nexus/superadmins/invite`, nunca estendido à camada tenant (`admin_global`/`admin_reserva`). Dado o raio de explosão (account takeover completo de outra pessoa), a ausência de step-up é desproporcional à severidade da ação. | `apps/bff/src/routes/nexus.ts:1061-1164` (precedente a replicar) |
| EMAIL-04 | **MÉDIO** | Auditoria vai para `audit_logs` — tabela legada, plana, sem hash-chain, não a canônica `audit_events` (`apps/bff/src/middleware/audit.ts`, tamper-evident via `RULE ... DO INSTEAD NOTHING` em UPDATE/DELETE). Ações sensíveis de identidade merecem o padrão forte, igual assinatura eletrônica e movimentação de material. | `apps/web/src/app/api/admin/users/route.ts:267-273` |
| EMAIL-05 | **BAIXO** | Comentário no código afirma que "não existe pipeline de e-mail transacional custom neste repo" — **falso**. `apps/bff/src/lib/email-templates/` + `apps/bff/src/services/email.ts` (Resend) já existem, com precedente pronto para esse exato tipo de aviso (`password-changed.ts`, categoria `security`, nunca throttled). A migration `20260815090000_add_email_changed_notification_type.sql` repete o mesmo comentário incorreto. | `apps/web/src/app/api/admin/users/route.ts:278-283` |
| EMAIL-06 | **BAIXO** | Sem rate limit dedicado — a rota cai no bucket genérico `rateLimitGeneral` (120/min), mesmo tratamento de qualquer leitura simples. Uma ação que pode sequestrar contas merece um teto muito mais apertado. | `apps/bff/src/middleware/rate-limit.ts:14-26,319-343` |

**Decisão arquitetural desta spec** (não é bug do código atual, é framing pra decisão de
design): migrar a feature de `apps/web` (Next.js Edge Route) para `apps/bff` (Hono). Só o BFF
tem `auditLog()`/`audit_events` (hash-chain), `roleGuard`, middleware de rate-limit
nomeado, e o padrão TOTP do Nexus a ser replicado. Hoje o próprio diálogo já salva os demais
campos do usuário via `PATCH /api/profiles/:id` no BFF — só a troca de e-mail ficou presa no
edge (duas fontes de verdade para uma ação, violação de SRP). Escopo desta spec: **somente a
branch de troca de e-mail de conta já ativa** (`isEmailChange`). Provisionamento de primeiro
acesso (e-mail sintético → real, `apps/bff/src/routes/admin.ts:291-475`) fica como está —
YAGNI, menor raio de explosão, e já tem seu próprio hardening (rollback, `classifyEmailUpdateOutcome`).

---

## 3. Decisões de Produto/Segurança (confirmadas com o dono do produto)

| Decisão | Escolhida | Alternativa descartada | Motivo |
|---|---|---|---|
| **D1 — Escopo de reserva** | `admin_reserva` só troca e-mail de usuário da(s) própria(s) reserva(s) (via `reserve_memberships`) | Tenant-wide (padrão geral de `profiles`) | E-mail = login = takeover de conta inteira; mais perigoso que editar nome/posto, onde tenant-wide é aceitável por design (`profiles` é deliberadamente multi-reserva). `admin_global` continua sem essa restrição. |
| **D2 — Confirmação** | Duplo opt-in: e-mail novo só passa a valer depois que alguém clica num link de confirmação recebido nele | Instantâneo + avisar os 2 endereços | Impede confirmação automática (scanner de e-mail corporativo pré-buscando o link, §5.2) e dá uma janela de reação. **Correção de escopo (achado de code review, ver nota abaixo): D2 isolado NÃO protege contra um admin malicioso** — quem escolhe o e-mail novo é o próprio admin, então ele sempre consegue clicar o próprio link. A proteção real contra esse ator é D1 (raio de explosão) + o aviso ao endereço ANTIGO (o único que o dono de fato ainda controla) — por isso o endereço antigo agora é avisado NA SOLICITAÇÃO (`email_change_requested_notice`), não só depois de confirmada (`email_changed_notice`), dando à vítima real uma chance de agir ENQUANTO ainda há tempo, não um aviso post-mortem. |
| **D3 — Step-up do admin** | Exigir TOTP da própria conta do admin antes de confirmar a solicitação | Sem TOTP extra | Risco (account takeover de terceiro) justifica desviar do princípio de fricção mínima do CLAUDE.md para esta ação específica — mesmo padrão já aceito para convite de superadmin no Nexus. Mesma ressalva de D2: TOTP eleva a barra para uma SESSÃO comprometida sem o dispositivo do admin, mas não impede um admin genuinamente malicioso, que naturalmente já tem o próprio TOTP. |

> **Nota de honestidade de threat model** (achado de code review nesta própria sessão,
> antes do commit): a primeira versão desta spec descrevia D2 como fechando "a janela de
> takeover silencioso por completo" — impreciso. Contra um atacante EXTERNO à conta admin
> (sessão roubada sem TOTP, scanner de e-mail), D2+D3 são efetivas. Contra um admin
> genuinamente malicioso (o próprio ator autorizado abusando do poder que já tem), a única
> defesa real é: D1 (limita QUEM ele pode atingir), o aviso ao e-mail antigo NA SOLICITAÇÃO
> (dá à vítima real uma chance de reagir antes da confirmação), e a cadeia de auditoria
> (responsabilização após o fato). Nenhum design de "admin troca e-mail de outra pessoa" pode
> ser 100% à prova de admin malicioso sem também exigir aprovação de um SEGUNDO admin
> (four-eyes) — fora do escopo pedido; citado como possível hardening futuro em §14.

---

## 4. Modelo de Dados

Nova tabela — **não** reaproveitar `profiles.email` como rascunho. `profiles.email` e
`auth.users.email` continuam sempre significando "o que está valendo agora"; nunca um estado
intermediário.

```sql
CREATE TABLE pending_email_changes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES profiles(id),
  tenant_id          UUID NOT NULL REFERENCES tenants(id),
  reserve_id         UUID REFERENCES reserves(id),   -- reserva do alvo no momento do pedido (auditoria)
  old_email          TEXT NOT NULL,
  new_email          TEXT NOT NULL,
  token_hash         TEXT NOT NULL,                  -- HMAC-SHA256 do token bruto; nunca o token cru persiste
  requested_by       UUID NOT NULL REFERENCES profiles(id),
  requested_by_role  TEXT NOT NULL,
  expires_at         TIMESTAMPTZ NOT NULL,            -- +1h (mesma janela do template `acesso`)
  confirmed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No máximo 1 pendência ativa por usuário — uma nova solicitação substitui a anterior
CREATE UNIQUE INDEX pending_email_changes_active_user_idx
  ON pending_email_changes (user_id) WHERE confirmed_at IS NULL;

CREATE INDEX pending_email_changes_token_idx ON pending_email_changes (token_hash);

ALTER TABLE pending_email_changes ENABLE ROW LEVEL SECURITY;
-- Sem policy de SELECT/INSERT/UPDATE para anon/authenticated — só service_role (BFF) acessa.
-- Mesmo padrão de totp_secrets e audit_events.
```

Token bruto: 32 bytes aleatórios (`crypto.randomBytes(32).toString("base64url")`), existe só
em memória e na URL do e-mail enviado. O que persiste é o HMAC-SHA256 (chave própria, nunca
o `RESEND_API_KEY` nem outro segredo reaproveitado) — mesma disciplina já aplicada a
`totp_secrets.secret` (criptografado) e ao `hashed_token` de recovery link do GoTrue.

Reaproveita `notification_type_enum` — valor `email_changed` já existe via migration
`20260815090000_add_email_changed_notification_type.sql`. **Pré-requisito de implementação**:
confirmar via `mcp__supabase__list_migrations` que essa migration já rodou em produção antes
de depender dela; se não rodou, aplicar primeiro.

---

## 5. Contrato de API (BFF, Hono)

### 5.1 `POST /api/admin/users/:id/email-change` — solicitar troca

- **Middleware**: `roleGuard("admin_global", "admin_reserva")` + rate limit dedicado (§7).
- **Body** (Zod, `.strict()`):
  ```ts
  z.object({
    new_email: z.string().email().max(255),
    totp_code: z.string().length(6).regex(/^\d{6}$/),
  })
  ```
- **Passo 1 — TOTP do admin** (D3): replicar exatamente `apps/bff/src/routes/nexus.ts:1078-1118`
  — busca `totp_secrets` do **actorId** (`enabled=true`), lockout 5 falhas/15min, verificação
  `verifySync`, anti-replay via `last_used_token`. Falha → `422` + `audit_events` com action
  `admin.user.totp_step_up_failed` (§8).
- **Passo 2 — Alvo existe e é do tenant**: `.eq("id", targetId).eq("default_tenant_id",
  tenantId)` → `404` "Militar não encontrado" se não achar (mesmo texto/padrão de
  `admin.ts:307-313`, não vaza existência cross-tenant).
- **Passo 3 — Teto de papel**: `canChangeUserEmail(role)` — portar de
  `apps/web/src/lib/invite-ceiling.ts` para um módulo compartilhável pelo BFF (ou duplicar a
  função pura de 2 linhas; é só um `Set`, sem estado).
- **Passo 4 — Escopo de reserva (D1, EMAIL-01)**: se `role === "admin_reserva"`, busca
  `reserve_memberships` do **alvo** e do **caller**, exatamente como
  `apps/bff/src/routes/profiles.ts:368-386` já faz para a sub-decisão de `reserve_ids` — o
  alvo precisa estar em pelo menos uma reserva onde o caller tem `role='admin_reserva'`.
  Falha → `403` "Você só pode alterar o e-mail de usuários da sua reserva."
  `admin_global` pula este passo.
- **Passo 5**: normaliza e-mail (`trim().toLowerCase()`); se igual ao atual → `400`.
- **Passo 6**: upsert em `pending_email_changes` — se já existe pendência ativa
  (`confirmed_at IS NULL`) para este `user_id`, grava `admin.user.email_change_superseded`
  (§8) antes de substituir.
- **Passo 7**: gera token, HMAC-armazena o hash, `expires_at = now() + 1h`.
- **Passo 8**: envia e-mail **para o endereço NOVO** com link de confirmação — template
  `email-change-confirm` (novo, §6), `cta.url = `${process.env.FRONTEND_URL ??
  "https://apmcb.pmpb.online"}/auth/email-change/confirm?token=...`` (mesmo fallback já usado
  em `admin.ts:370,976` e `login-device.ts:347`).
- **Passo 8b** (achado de code review — ver nota de D2 em §3): envia TAMBÉM, na hora do
  pedido, um aviso pro endereço ANTIGO (`email_change_requested_notice`, novo, §6, categoria
  `security`) — "um administrador pediu a troca do seu e-mail para X; se não foi você, aja
  agora". Sem isso, o único aviso ao dono real da conta chegaria depois de confirmada, tarde
  demais para impedir qualquer coisa.
- **Passo 9**: `auditLog(c, { action: "admin.user.email_change_requested", ... })` (§8).
- **Resposta**: `200 { pending: true, expires_at }` — nunca `success: true` sozinho; o texto
  deixa claro que nada mudou ainda de fato.

### 5.2 Confirmar troca — validação read-only + página Next.js + POST executa

**Achado próprio, corrigido antes de implementar**: um design ingênuo onde o `GET` do link
do e-mail já executa a troca tem o mesmo problema clássico de link de unsubscribe/verificação
por e-mail — scanners corporativos de segurança (Outlook Safe Links, gateways de e-mail)
pré-buscam (`GET`) todo link recebido para escanear por malware, **antes** do usuário real
abrir a mensagem. Se o `GET` mutasse direto, a troca seria confirmada pelo scanner, não pelo
usuário — anulando o propósito inteiro do duplo opt-in (D2). Por isso:

O BFF neste repositório só fala JSON — nenhuma rota existente renderiza HTML (a UI é sempre
`apps/web`, mesmo padrão de `/auth/callback`, que é uma página Next.js consumindo o resultado
de um link do GoTrue, não uma página servida pelo próprio Auth). Este endpoint segue a mesma
separação:

- **`GET /api/auth/email-change/validate?token=...`** (BFF, JSON, público, sem `roleGuard`):
  só valida o token (existe, não expirado, não confirmado) **sem marcar nada** — devolve
  `{ valid: true, new_email }` ou `{ valid: false, reason }`.
- **Página `apps/web/src/app/auth/email-change/confirm/page.tsx`** (nova, client component):
  ao montar, chama o `GET` acima e mostra o e-mail novo + botão "Confirmar troca de e-mail".
  O e-mail do link recebido aponta pra ESTA página
  (`${FRONTEND_URL}/auth/email-change/confirm?token=...`), nunca direto pro BFF — mesmo motivo
  de todo outro link de e-mail do repo (`acesso.ts` aponta pra `/auth/callback`, não pro
  GoTrue). Isso já garante que um scanner de e-mail que pré-busca (`GET`) o link só dispara a
  validação read-only da página, nunca a troca — a troca só acontece no passo seguinte,
  disparado por um clique real.
- **`POST /api/auth/email-change/confirm`** (BFF, JSON, body `{ token }`) — chamado pelo
  clique no botão da página acima. É este que executa os passos 1-8 abaixo.

Passos da execução (o `POST`):

- **Passo 1**: HMAC do `token` recebido → busca em `pending_email_changes` por
  `token_hash`. Não achou → resposta genérica de erro (nunca revela se o token é
  "inválido" vs. "não existe", evita enumeração).
- **Passo 2**: `confirmed_at IS NOT NULL` → erro "este link já foi usado" +
  `admin.user.email_change_confirm_failed` (`reason: "already_confirmed"`).
- **Passo 3**: `expires_at < now()` → erro "link expirado, peça um novo ao administrador" +
  `admin.user.email_change_confirm_failed` (`reason: "expired"`).
- **Passo 4**: `supabase.auth.admin.updateUserById(user_id, { email: new_email,
  email_confirm: true })` — reaproveita **sem modificar**
  `apps/bff/src/lib/acesso-email-update.ts`'s `classifyEmailUpdateOutcome()` para o caso de
  conflito (e-mail já reivindicado por outra conta nesse meio-tempo) → `409`.
- **Passo 5**: `UPDATE profiles SET email = new_email WHERE id = user_id` (espelho).
- **Passo 6**: `UPDATE pending_email_changes SET confirmed_at = now() WHERE id = pending.id`.
- **Passo 7**: `auditLog(c, { action: "admin.user.email_change_confirmed",
  before_snapshot: { email: old_email }, after_snapshot: { email: new_email }, ... })` (§8).
- **Passo 8** (fire-and-forget, try/catch total — falha aqui NUNCA desfaz a troca já
  commitada nos passos 4-6, mesmo princípio do código atual):
  - E-mail de segurança para o endereço **ANTIGO** — template `email-changed-notice` (novo,
    §6), categoria `security`, sem CTA. Como o orquestrador sempre resolve o e-mail *atual*
    (já seria o novo neste ponto), **não é possível usar `sendTransactionalEmail()`** —
    chamar `services/email.ts`'s `sendEmail({ to: old_email, ... })` diretamente, mesmo
    bypass deliberado que `login-device.ts` já faz para `new_login`.
  - E-mail de confirmação para o endereço **NOVO** ("seu e-mail de acesso agora é este").
  - Notification in-app (`type: "email_changed"`, `user_id`).
  - Falha de envio → `persistEmailFailureAudit` existente (mesmo helper de
    `login-device.ts`), visível em `GET /api/nexus/errors` — nunca só um `console.error`.
- **Resposta**: `200 { ok: true }` (ou `4xx/5xx` conforme a falha classificada acima) — a
  página `apps/web` que chamou o `POST` trata o sucesso navegando para
  `/login?email_changed=1` (toast "e-mail confirmado, faça login com o novo endereço").

---

## 6. Templates de E-mail Novos

Três, em `apps/bff/src/lib/email-templates/`, registrados em `index.ts`'s `TEMPLATES`,
seguindo o contrato `TemplateDef<T>` existente (schema Zod `.strict()`, `escapeHtml()` em
todo campo livre, `layout()` da identidade Andrômeda via `_layout.ts`).

- **`email-change-confirm.ts`** — categoria com CTA (padrão de `acesso.ts`): "Um
  administrador solicitou a troca do seu e-mail de acesso para este endereço. Se foi você (ou
  seu administrador a seu pedido), confirme abaixo. O link expira em 1 hora." `cta: {label:
  "Confirmar novo e-mail", url}`. Categoria `lifecycle` (pode ser throttled — não é alerta de
  segurança em si, é uma ação esperada).
- **`email-changed-notice.ts`** — categoria `security` (nunca throttled, regra O7), sem CTA,
  mesmo molde de `password-changed.ts`: "O e-mail de acesso da sua conta no Andrômeda foi
  alterado de `{old_email}` para `{new_email}` em `{quando}`, por um administrador. Se você
  reconhece esta ação, nada a fazer. **Se não foi você, contate imediatamente o administrador
  da sua unidade — sua conta pode estar comprometida.**" Dois disparos (para `old_email` e
  para `new_email`), mesmo template, `recipient` diferente.
- **`email-change-requested-notice.ts`** (achado de code review, ver nota de D2 em §3) —
  categoria `security`, sem CTA: disparado NA SOLICITAÇÃO (endpoint 5.1, passo 8b), só para
  `old_email`. "Um administrador solicitou a troca do seu e-mail de acesso para `{new_email}`
  em `{quando}`. A troca ainda não teve efeito. Se você reconhece o pedido, nada a fazer. Se
  não, contate o administrador AGORA, antes que a troca seja confirmada." É este template
  (não o `email-changed-notice` pós-confirmação) que dá à vítima real uma chance de agir a
  tempo.

---

## 7. Rate Limit

Novo profile nomeado em `RATE_LIMIT_PROFILES` (`apps/bff/src/middleware/rate-limit.ts:14-26`),
ex. `sensitiveAdminMutation: { windowMs: 60*60*1000, max: 10 }` (10/hora por admin — uma ação
que pode sequestrar até 10 contas diferentes por hora já é generosa para uso legítimo e
apertada o bastante para conter abuso). Wired em `routeRateLimiter`
(`apps/bff/src/middleware/rate-limit.ts:319-324`) para o prefixo
`/api/admin/users/*/email-change`, mesmo padrão de `/api/totp/`.

---

## 8. Rastreabilidade e Auditoria (escopo atual — sem infraestrutura nova)

Toda transição de estado grava em `audit_events` (canônico, hash-chain, tamper-evident via
`RULE ... DO INSTEAD NOTHING`), nunca em `audit_logs` (legado):

| Ação (`action`) | Quando | `before`/`after` | `metadata` |
|---|---|---|---|
| `admin.user.totp_step_up_failed` | TOTP do admin inválido/replay no passo 1 do endpoint 5.1 | — | `{ target_user_id }` |
| `admin.user.email_change_requested` | Endpoint 5.1, sucesso | — (nada mudou de fato ainda) | `{ old_email, new_email, requested_by_role, confirm_email_sent }` |
| `admin.user.email_change_superseded` | Nova solicitação substitui pendência anterior não confirmada | — | `{ superseded_pending_id, new_pending_id }` |
| `admin.user.email_change_confirm_failed` | Endpoint 5.2, token inválido/expirado/já usado | — | `{ reason: "expired"\|"invalid"\|"already_confirmed", pending_id }` — nunca `user_id` antes de validar titularidade |
| `admin.user.email_change_confirmed` | Endpoint 5.2, sucesso | `{email: old}` → `{email: new}` | `{ requested_by, requested_by_role }` |

Falha ao **enviar** o aviso de segurança (não a mutação em si, o e-mail) reaproveita
`persistEmailFailureAudit` (mesmo helper já usado por `login-device.ts`) — visível em
`GET /api/nexus/errors`, nunca apenas logado localmente.

**Consulta**: nenhuma tela nova é necessária. `audit_events` já é consultável por
`admin_global`/`admin_reserva`/`auditor` do mesmo tenant (RLS existente,
`20260622000003_audit_events.sql:67-76`); histórico de trocas de e-mail é
`SELECT * FROM audit_events WHERE action LIKE 'admin.user.email_change_%' ORDER BY seq`.
Citado aqui como capacidade já disponível — não é um gap desta spec.

`pending_email_changes` não precisa de cleanup ativo (sem RLS de escrita pública, só
admins autenticados+TOTP criam linhas — não cresce por abuso externo); linhas
confirmadas/expiradas ficam como evidência complementar (token só em hash), mas a fonte de
verdade para investigação é sempre a cadeia `audit_events`.

---

## 9. UI

### 9.1 `apps/web/src/app/(dashboard)/admin/usuarios/_edit-dialog.tsx` (diálogo existente)

- Campo de e-mail novo: sem mudança.
- `AlertDialog` de confirmação (hoje mostra só old→new) ganha campo de TOTP do admin (6
  dígitos) — reaproveitar o componente de input TOTP já usado em outros fluxos do projeto.
- Copy muda de "e-mail será alterado" para: "Um link de confirmação será enviado para o novo
  e-mail. A troca só terá efeito depois que o usuário confirmar (válido por 1 hora)."
- Submit chama `POST /api/admin/users/:id/email-change` (BFF), não mais o Next edge route
  para este caso específico.
- Fora do escopo mínimo, citado como follow-up: badge "troca pendente" na listagem de
  usuários quando existe uma linha ativa em `pending_email_changes` para aquele usuário.

### 9.2 `apps/web/src/app/auth/email-change/confirm/page.tsx` (nova)

- Client component. Lê `?token=` da query string.
- Ao montar: `GET /api/auth/email-change/validate?token=...` — mostra estado de
  carregamento, depois o e-mail novo (`new_email` da resposta) e um botão "Confirmar troca
  de e-mail"; token inválido/expirado/já usado → mensagem de erro amigável, sem botão.
- Clique no botão → `POST /api/auth/email-change/confirm` com o mesmo token → sucesso navega
  para `/login?email_changed=1`; falha mostra o erro (toast), mantém a página.
- Sem sessão exigida (página pública, mesmo espírito de `/auth/callback`) — o token é a
  prova de identidade.

---

## 10. Limpeza de Código

- Remover a branch `isEmailChange` de `apps/web/src/app/api/admin/users/route.ts`
  (linhas ~147-302) e o comentário desatualizado sobre "não existe pipeline de e-mail" —
  único caller é o diálogo, que passa a apontar para o endpoint novo.
- Atualizar o comentário da migration `20260815090000_add_email_changed_notification_type.sql`
  — o pipeline de e-mail passa a existir; o comentário histórico deve virar nota de "gap
  fechado em `troca-email-acesso-enterprise.md`", não afirmação factual desatualizada.

---

## 11. Cenários de Estresse (mesma disciplina da DoD canônica, §"Validação sob Estresse")

| # | Cenário | Resultado esperado |
|---|---|---|
| EMAIL-S01 | `admin_reserva` da Reserva A solicita troca de e-mail de usuário só-membro da Reserva B (mesmo tenant) | `403` |
| EMAIL-S02 | `admin_global` solicita troca de e-mail de usuário de qualquer reserva do seu tenant | `200`, fluxo segue |
| EMAIL-S03 | `armeiro`/`usuario`/`auditor` chama o endpoint 5.1 | `403` (roleGuard) |
| EMAIL-S04 | TOTP do admin errado 6 vezes seguidas | 6ª tentativa bloqueada por lockout (mesma janela de 15min do Nexus), `audit_events` com 6 `totp_step_up_failed` |
| EMAIL-S05 | Reenvio do mesmo `totp_code` (replay) | Rejeitado, `audit_events` registra tentativa |
| EMAIL-S06 | 2 solicitações de troca seguidas para o mesmo usuário, sem confirmar a 1ª | 2ª substitui a 1ª; `email_change_superseded` gravado; link da 1ª deixa de funcionar |
| EMAIL-S07 | Confirmação com token de uma pendência já confirmada | Erro "link já usado", `confirm_failed(already_confirmed)` |
| EMAIL-S08 | Confirmação após 1h de expiração | Erro "link expirado", `confirm_failed(expired)` |
| EMAIL-S09 | Confirmação com token adulterado/aleatório | Erro genérico (não revela se pendência existe), sem `audit_event` com `user_id` real |
| EMAIL-S10 | E-mail novo já pertence a outra conta, descoberto só na confirmação (corrida) | `409` via `classifyEmailUpdateOutcome`, `pending_email_changes` não fica "confirmada" |
| EMAIL-S11 | Envio do e-mail de aviso ao endereço antigo falha (Resend fora do ar) | Troca já efetivada (passos 4-6 não revertem); falha registrada em `email_log`/`GET /api/nexus/errors`, nunca apenas `console.error` |
| EMAIL-S12 | 11ª solicitação do mesmo admin na mesma hora | `429` (rate limit dedicado, 10/hora) |
| EMAIL-S13 | Teste vivo: `admin_global` troca e-mail de `armeiro@apmcb.dev` → `pmpbdga@gmail.com` via UI, TOTP real, confirma clicando no e-mail recebido de verdade | Login funciona no e-mail novo; `armeiro@apmcb.dev` recebe (ou teria recebido, se ainda existisse como inbox) o aviso de segurança; cadeia `audit_events` mostra `requested` → `confirmed` |

---

## 12. Plano de Implementação (bite-sized, cadeia completa do CLAUDE.md por tarefa)

1. Migration `pending_email_changes` + RLS.
2. Endpoint `POST .../email-change` (TOTP + escopo de reserva + pendência + e-mail pro novo endereço).
3. Endpoint `GET .../email-change/confirm` (efetiva a troca + audit + e-mail pro antigo).
4. Templates de e-mail novos + registro em `index.ts`.
5. Rate limit dedicado.
6. UI do diálogo (campo TOTP + copy nova).
7. Remoção da branch antiga no edge route + correção do comentário da migration.
8. E2E Playwright completo — inclui o teste vivo EMAIL-S13.

Cada tarefa: TDD → Playwright → verificação de fluxo (spec-to-code-compliance) → code review
sênior (bloqueia em CRÍTICO/ALTO não endereçado) → `insecure-defaults:audit` + `semgrep` no
diff — antes de avançar para a próxima, por regra canônica do `CLAUDE.md`.

---

## 13. Definition of Done desta Feature

Usa o checklist global de `07-canonical-definition-of-done.md` (G01-G17), mais os critérios
específicos abaixo:

- [ ] Todos os 13 cenários EMAIL-S01–S13 (§11) passando.
- [ ] `audit_events` cobre as 5 ações de §8, com `before`/`after` corretos nos casos de sucesso.
- [ ] Nenhuma linha em `audit_logs` (legado) para esta feature — só `audit_events`.
- [ ] `pending_email_changes` tem RLS sem policy para `anon`/`authenticated`.
- [ ] Token bruto nunca aparece em log, `metadata` de audit, ou é persistido — só o hash.
- [ ] Rate limit dedicado ativo e testado (EMAIL-S12).
- [ ] Branch antiga (`isEmailChange` no edge route) removida, sem dead code.
- [ ] `pnpm typecheck` e `pnpm lint` (web + bff) limpos.
- [ ] Teste vivo EMAIL-S13 executado e documentado (evidência: e-mail real recebido).

---

## 14. Riscos Residuais (declarados, não escondidos)

- **GoTrue "Change Email" nativo** (double opt-in self-service, configurado no dashboard
  Supabase) continua existindo em paralelo para o fluxo *self-service* (`auth.updateUser`)
  — fora do escopo desta spec, que cobre só o fluxo *admin-iniciado*. Não há conflito: são
  triggers diferentes (`updateUserById` com `email_confirm:true` não passa pelo template
  nativo de troca de e-mail).
- Se o admin que solicitou a troca perder acesso à própria conta entre os passos 5.1 e 5.2
  (ex. foi desativado nesse meio-tempo), a pendência ainda pode ser confirmada pelo usuário
  alvo — comportamento aceito: a ação já foi auditada e autorizada no momento em que TOTP
  passou; revogar isso exigiria checar o estado do admin na confirmação, adicionando
  complexidade para um cenário de janela muito estreita (pendência expira em 1h).
- `email-change-confirm` (template) é categoria `lifecycle`, então pode ser throttled pelo
  orquestrador sob carga extrema — aceitável, é uma ação de baixo volume esperado (admin
  trocando e-mail de alguém, não um fluxo de massa).
- **Admin genuinamente malicioso** (não uma sessão comprometida — o próprio ator autorizado
  abusando do poder que já tem): D2+D3 não impedem esse ator (ver nota em §3). Mitigação
  hoje: D1 (raio de explosão), aviso ao e-mail antigo NA SOLICITAÇÃO (chance de reação),
  cadeia de auditoria hash-chain (responsabilização). Hardening futuro possível, fora do
  escopo pedido: exigir aprovação de um SEGUNDO admin (four-eyes) antes da confirmação valer,
  ou notificar TODOS os `admin_global`/auditor do tenant a cada solicitação (não só o e-mail
  antigo), dando supervisão adicional independente do estado da vítima.
- **Corrida em `pending_email_changes`** (achado de code review, MÉDIO): duas solicitações
  concorrentes pro MESMO usuário podem ambas passar o SELECT de "existe pendência ativa?"
  antes de qualquer DELETE, e ambas tentarem INSERT — o índice único parcial
  (`WHERE confirmed_at IS NULL`) garante que só uma vence, mas a perdedora recebe um `500`
  genérico (erro de constraint não classificado) em vez de um `409` informativo. Não é falha
  de segurança (nenhum estado inconsistente, nenhuma duplicidade) — só uma mensagem de erro
  menos amigável numa corrida rara entre 2 admins editando o mesmo usuário ao mesmo tempo.
  Hardening futuro: classificar o erro de unique_violation e devolver 409 explícito.
