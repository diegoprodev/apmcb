# MIGRATION_SPEC.md — apmcb: Deployment Híbrido (SaaS Supabase/Cloudflare + On-Premise Docker)

Versão: 1.0
Escopo: especificação de arquitetura, não é um plano de codificação linha-a-linha. Define o que muda, onde, e por quê, para que o apmcb rode em dois modos sem duplicar a base de código.

---

## 1. Contexto & objetivo

O apmcb hoje roda 100% sobre Supabase (Postgres + Auth + Realtime + Storage, hospedado em AWS `sa-east-1`) e Cloudflare (Pages para `apps/web`, Turnstile para captcha). É usado por efetivo policial (PMPB) para controle de armamento, material, plantão e ocorrências.

Existe demanda de órgãos de segurança pública (outras PMs, SSPs, guardas municipais) que **não aceitam depender de nuvem de terceiros** para dados operacionais e de identidade de agentes armados. O requisito é **soberania de dados total**: banco, arquivos, sessão, autenticação e comunicação críticos rodando dentro do datacenter do próprio órgão, sob custódia exclusiva dele.

**Objetivo desta spec**: introduzir um segundo modo de deployment — **On-Premise via Docker** — mantendo o modo **SaaS (Supabase/Cloudflare)** existente intacto e funcional, com uma única base de código, uma única variável de ambiente decidindo o comportamento (`AMBIENTE_INFRA`), e zero regressão para os clientes SaaS atuais.

**Critério de sucesso**: paridade funcional completa entre os dois modos (mesmas telas, mesmas regras de negócio, mesma UX), zero dado do órgão trafegando ou residindo em infraestrutura do fornecedor no modo on-prem, e conformidade documentada com a LGPD nos dois modos.

---

## 2. Modelo de deployment

Uma única variável de ambiente é a fonte de verdade em todo o backend (`apps/bff`):

```
AMBIENTE_INFRA = SUPABASE | ON_PREMISE
```

Validada com zod na inicialização do BFF (hoje não existe validação central de env — isso é gap novo a fechar, ver §4.5). Falha de boot se `AMBIENTE_INFRA` estiver ausente ou tiver valor fora do enum — **fail-closed**, nunca assume um modo por default silencioso, porque assumir errado aqui pode vazar dado pra nuvem que o órgão explicitamente rejeitou.

Matriz de decisão por camada (detalhada nas seções seguintes):

| Camada | `SUPABASE` | `ON_PREMISE` |
|---|---|---|
| Banco de dados | Postgres gerenciado pela Supabase (AWS sa-east-1) | Postgres puro, container do órgão |
| Autenticação | Supabase Auth (GoTrue REST, `/auth/v1/token`) | Tabela `public.usuarios` + bcrypt, nativo no BFF |
| Sessão | iron-session (`apmcb_session`) | iron-session (idêntico, sem mudança) |
| Realtime | Supabase Realtime (`postgres_changes`) | `LISTEN/NOTIFY` do Postgres + broadcaster no BFF |
| Storage de arquivo | Supabase Storage (S3-compat) | MinIO (S3-compat) |
| Email | Resend | SMTP do próprio órgão |
| Push (VAPID) | Gateway público (Google/Mozilla/Apple) | Mesmo gateway — limitação aceita, ver §9-B |
| Captcha | Cloudflare Turnstile | Desabilitado ou captcha self-host, ver §9 |
| Hospedagem do `apps/web` | Cloudflare Pages | Container Docker (Next.js standalone) |
| Hospedagem do `apps/bff` | VPS (já Dockerizado hoje) | Container Docker, mesma imagem |
| Suporte remoto do fornecedor | N/A (acesso direto à VPS própria) | Túnel zero-trust sob demanda, ver §9-B |

---

## 3. Arquitetura de referência

**Modo SUPABASE (hoje):**

```
Browser ── HTTPS ──> Cloudflare Pages (apps/web, Next.js)
                          │  (SSR/browser client direto contra Supabase, hoje)
                          ▼
                    Supabase Cloud (AWS sa-east-1)
                    Postgres + Auth + Realtime + Storage
                          ▲
Browser ── HTTPS ──> BFF (apps/bff, Docker em VPS Hetzner)
                    service-role → mesmo Postgres acima
                    iron-session (apmcb_session)
                    Realtime→SSE proxy
```

**Modo ON_PREMISE (novo):**

```
                    Rede interna do órgão (datacenter / sala-cofre)
                    ────────────────────────────────────────────
Browser (rede local) ── HTTPS ──> apps/web (container Docker, Next.js standalone)
                                        │
                                        ▼
                          apps/bff (container Docker, mesma imagem do modo SaaS)
                          iron-session (apmcb_session) — inalterado
                          LocalAuthProvider (bcrypt) — nova implementação
                          LISTEN/NOTIFY → SSE — novo broadcaster interno
                                        │
                                        ▼
                          Postgres (container Docker, dados do órgão)
                          MinIO (container Docker, arquivos do órgão)
                          SMTP relay do próprio órgão (email)
                    ────────────────────────────────────────────
                    Único egress permitido: túnel zero-trust sob demanda
                    para suporte/atualização (ver §9-B) + gateway de push
                    (Google/Mozilla/Apple, ver §9-B)
```

Ponto central: **nenhum componente novo é inventado**. O BFF já é a única peça com acesso privilegiado ao banco (service-role hoje, superusuário/app-role no on-prem) e já é a única peça que fala com Realtime — ele só passa a ter duas implementações por trás de cada interface (Auth, Storage, Realtime), selecionadas por `AMBIENTE_INFRA`.

---

## 4. Banco de dados

### 4.1 Inventário das 47 tabelas (por domínio)

**Identidade e organização** (tenant = órgão; reserve = unidade/arsenal operacional):
- `tenants` — órgão raiz (slug, tipo, modo de estrutura)
- `org_units` — hierarquia opcional (batalhão/companhia/diretoria)
- `reserves` — unidade policial/arsenal, nível de escopo operacional
- `tenant_memberships` — usuário ↔ tenant
- `reserve_memberships` — usuário ↔ reserve + papel
- `profiles` — perfil do policial (matrícula, posto, papel), hoje FK de `auth.users`
- `user_reserve_preferences` — reserve ativa preferida por usuário multi-reserva

**Biometria** (dado sensível LGPD Art. 5º II):
- `biometric_templates` — template de digital, criptografado
- `biometric_devices` — leitores registrados
- `biometric_challenges` — estado de desafio/liveness
- `biometric_pairing_codes` — pareamento do bridge Windows
- `biometric_device_request_nonces` — anti-replay
- `biometric_proofs` / `biometric_proof_consumptions` — prova de presença biométrica e consumo único

**Catálogo e inventário de material:**
- `material_types` — catálogo de material (armamento, uniforme, equipamento)
- `material_categories` — perfis de categoria reutilizáveis
- `material_items` — itens serializados rastreados
- `material_item_event_index` — índice de eventos/auditoria do item

**Operações de armamento e custódia:**
- `lendings` — check-out de armamento/equipamento
- `cautelamentos` — custódia formal com assinatura
- `material_requests` / `material_request_items` — fluxo de aprovação de retirada
- `category_requests` — pedido de nova categoria (**drift de schema, ver §4.3**)
- `document_signatures` — assinatura digital de documentos
- `handover_attachments` — anexos de troca de serviço

**Livro de serviço / plantão:**
- `service_shifts` — turnos de plantão
- `service_log_events` — eventos do livro digital
- `service_handovers` — troca de serviço/plantão

**Auditoria física de inventário:**
- `inventory_campaigns` — campanhas de conferência física
- `inventory_item_checks` — resultado por item
- `inventory_reserve_checks` — resumo por reserve

**Ocorrências e aprovações administrativas:**
- `ocorrencias` — registro de ocorrência
- `admin_approval_requests` — fluxo genérico de aprovação (ex.: elevação de papel)

**Notificação e comunicação:**
- `notifications` — feed por usuário
- `push_subscriptions` — endpoints de web push
- `email_log` / `email_dedup` — auditoria e deduplicação de envio de email

**Segurança e sessão:**
- `audit_logs` — trilha imutável legada (INSERT-only via RULE)
- `audit_events` — trilha estruturada mais nova
- `revoked_sessions` — revogação de sessão/JWT
- `known_login_devices` — fingerprint de dispositivo para alerta de novo login
- `totp_secrets` — segredo TOTP, criptografado AES-256-GCM em nível de aplicação (não depende de extensão do Postgres)
- `totp_identity_claims` — claim de identidade TOTP de curta duração
- `pending_email_changes` — fluxo de confirmação de troca de email

**Branding e limites por tenant:**
- `tenant_branding` — logo/cores/subdomínio custom por tenant
- Colunas de limite/plano em `tenants` (não é tabela própria)

**Alertas de cron:**
- `cautela_vencimento_alert_events` — dedup do alerta de vencimento de cautela
- `material_validity_alert_events` — dedup do alerta de validade de material

### 4.2 RLS: preservado 100%, não reescrito

O schema tem **250 `CREATE POLICY`** distribuídas em 23 migrations, apoiadas em funções `SECURITY DEFINER`/`STABLE` (`auth_role()`, `my_tenant_id()`, `my_active_reserve_id()`, `reserve_tenant_id()`, `auth_admin_reserve_ids()`). Todas essas funções, na raiz, leem `auth.uid()` — que no Supabase é:

```sql
current_setting('request.jwt.claims', true)::json->>'sub'
```

Isso é só uma leitura de uma **GUC de sessão** (`request.jwt.claims`) que o PostgREST/GoTrue populam a partir do JWT antes de rodar a query. **Não é mágica do Supabase** — é um mecanismo padrão do Postgres (`current_setting`) que qualquer client pode preencher.

**Decisão de arquitetura (o ponto mais importante desta spec):** no modo `ON_PREMISE`, o BFF assume o papel que o PostgREST tem hoje: no início de cada transação que atende uma requisição autenticada, ele executa

```sql
SET LOCAL request.jwt.claims = '{"sub":"<uuid-do-usuario>","role":"authenticated"}';
```

antes de qualquer query de negócio. Como `SET LOCAL` vale só dentro da transação atual, não há vazamento entre requisições mesmo em um pool de conexões compartilhado (cuidado operacional: **cada request precisa abrir sua própria transação explícita** — não pode reusar conexão de pool sem `SET LOCAL` por request, senão a claim de um usuário vaza pro próximo request que pegar a mesma conexão).

Resultado: **as 250 policies e as funções helper continuam byte-a-byte idênticas nos dois ambientes.** O único artefato novo é a função `auth.uid()` em si — no on-prem ela é criada manualmente (mesma assinatura, mesmo corpo, já que ela só faz `current_setting`), sem depender do schema `auth` completo do GoTrue. Isso elimina a necessidade de rodar GoTrue/Kong no on-prem só para ter RLS funcionando.

Efeito colateral positivo pra LGPD: RLS continua sendo a camada de isolamento entre tenants **mesmo com o BFF usando um papel privilegiado** (hoje service-role bypassa RLS — no on-prem, recomenda-se que o BFF rode com um role de aplicação que **não** tem `BYPASSRLS`, fechando a defesa em profundidade que hoje só existe em teoria).

### 4.3 Drift de schema — resolver antes de congelar baseline

A tabela `category_requests` existe em produção (aparece em `supabase/ci/policy-snapshot.json` e tem 6+ migrations escrevendo policy contra ela) **sem nenhum `CREATE TABLE` correspondente em `supabase/migrations/`**. O próprio CI reconhece isso ("prod tem drift real, migrações via MCP").

Antes de usar as migrations atuais como baseline para o on-prem, é obrigatório:
1. Rodar `supabase db pull` contra o projeto de produção (captura o schema real, inclusive `category_requests`) para gerar uma migration de reconciliação.
2. Revisar o diff gerado manualmente — comparar contra o que já existe em `supabase/migrations/` para não duplicar `CREATE TABLE`/`CREATE POLICY` já commitados.
3. Commitar essa migration de reconciliação como baseline oficial. A partir daqui, **toda mudança de schema passa a ser feita só por migration versionada** — chega de alteração direta via MCP em produção sem migration correspondente.

### 4.4 Sincronizar Supabase (SaaS) e Postgres on-prem sem esforço manual

Pedido explícito: o fluxo oficial do **Supabase CLI** vira a fonte única de verdade de schema para os dois ambientes (o Postgres on-prem roda as mesmas migrations `.sql`, sem nenhuma dependência do resto da stack Supabase).

**Setup (uma vez):**

```bash
# supabase já é devDependency do monorepo (pnpm add -D supabase, feito nesta mudança)
pnpm exec supabase login
pnpm exec supabase link --project-ref <PROJECT_REF_DE_PRODUCAO>
```

`<PROJECT_REF_DE_PRODUCAO>` é o ref do projeto Supabase (visível na URL do dashboard ou em Project Settings → General). O `link` grava a associação em `supabase/.temp/` (gitignored) — não versiona nada sensível.

**Capturar o baseline atual de produção (resolve o drift do §4.3):**

```bash
pnpm exec supabase db pull
```

Isso gera automaticamente um arquivo `.sql` novo em `supabase/migrations/` com tudo que existe em prod e ainda não está representado localmente — inclusive `category_requests`.

**Daqui pra frente, sempre que alguém alterar o schema direto no dashboard/SQL editor de produção** (o que deveria parar de acontecer, mas serve de rede de segurança) **e você precisar capturar esse diff estrutural como migration versionada:**

```bash
pnpm exec supabase db diff -f nome_descritivo_da_mudanca
```

Isso compara o schema do banco linkado (produção) contra o estado acumulado das migrations locais e escreve só a diferença em `supabase/migrations/<timestamp>_nome_descritivo_da_mudanca.sql`.

**Fluxo recomendado daqui pra frente (o certo, não o de emergência):** escrever a migration à mão com `supabase migration new nome` e aplicar com `supabase db push` — `db diff` é para capturar o que já mudou fora do fluxo, não para o dia a dia.

**Aplicar as migrations num Postgres novo (é exatamente o passo que também "sincroniza" o on-prem):**

```bash
# contra o projeto Supabase linkado (SaaS)
pnpm exec supabase db push

# contra o Postgres on-prem (não é um projeto Supabase — usa a mesma pasta de migrations,
# mas aplica direto via psql/flyway-style runner, já que on-prem não roda o resto da stack Supabase)
pnpm exec supabase db push --db-url "$ON_PREM_DATABASE_URL"
```

O CLI do Supabase aceita `--db-url` apontando para **qualquer** Postgres, não precisa ser um projeto Supabase — é por isso que a mesma pasta `supabase/migrations/*.sql` serve de fonte única de verdade para os dois ambientes, sem duplicar schema em lugar nenhum. Isso resolve o pedido de "sincronizados sem esforço manual": o esforço manual que resta é só decidir quando rodar `db push` contra qual ambiente (idealmente via CI, ver abaixo).

**Scripts adicionados ao `package.json` raiz nesta mudança:**

```json
"db:link": "supabase link --project-ref $SUPABASE_PROJECT_REF",
"db:pull": "supabase db pull",
"db:diff": "supabase db diff -f",
"db:push": "supabase db push"
```

**Gap a fechar (fora do escopo desta spec, registrado para a Fase 1 da execução):** hoje nenhum workflow de CI roda `supabase db push` — aplicação é manual via MCP. Depois do baseline reconciliado, o pipeline `ci-cd.yml` deve ganhar um step de `db push` (contra staging, no mínimo) antes do deploy do BFF, para que schema e código nunca fiquem fora de sincronia — e para que o mesmo step, apontado para `--db-url` do on-prem, seja literalmente o mecanismo de atualização de schema em campo.

### 4.5 Validação central de env

Hoje a validação de variável de ambiente é ad-hoc, espalhada por módulo (`TOTP_ENCRYPTION_KEY`, `BIOMETRIC_PAIRING_CODE_PEPPER` etc. cada um checa a si mesmo). Este spec formaliza um único ponto de entrada (`apps/bff/src/lib/env.ts`, zod) que:
- Falha o boot se `AMBIENTE_INFRA` estiver ausente/inválido.
- Aplica schema condicional: `SUPABASE_URL`+`SUPABASE_SERVICE_ROLE_KEY` obrigatórios só quando `AMBIENTE_INFRA=SUPABASE`; `DATABASE_URL` obrigatório só quando `ON_PREMISE`.
- Centraliza os "fail fast in production" que hoje estão espalhados (`TOTP_ENCRYPTION_KEY`, `BIOMETRIC_TEMPLATE_MASTER_KEY`).

---

## 5. Autenticação e sessão

### 5.1 iron-session — zero mudança

`apps/bff/src/lib/session.ts` já é 100% isolado no BFF, nunca foi tocado pelo `apps/web` diretamente, e o formato de `SessionData` (userId, role, tenantId, reserveId, sessionId, csrfToken etc.) não depende de qual auth está por trás. **Continua idêntico nos dois modos.** O único ajuste é condicional, já existente hoje (`domain: ".apmcb.pmpb.online"` só em produção) — no on-prem, esse domínio de cookie passa a ser configurável por env (domínio interno do órgão) ou `undefined` (mesma origem).

### 5.2 Interface `AuthProvider`

```ts
interface AuthProvider {
  login(email: string, password: string): Promise<{ userId: string; profile: Profile }>;
  exchangeToken(accessToken: string, refreshToken: string): Promise<{ userId: string; profile: Profile }>;
  // getUser é o que "GET /api/auth/me" usa pra revalidar a cada heartbeat
  getUser(userId: string): Promise<Profile | null>;
}
```

- **`SupabaseAuthProvider`** — implementação atual, sem mudança: chama `/auth/v1/token` e `/auth/v1/user` da Supabase (service-role key), como já é feito em `apps/bff/src/routes/auth.ts`.
- **`LocalAuthProvider`** (novo) — tabela `public.usuarios` (login, hash bcrypt, `profile_id` referenciando `profiles`), validação nativa em Node.js com `bcrypt`. Mesma forma de resposta (`{ userId, profile }`), então o resto de `auth.ts` (montagem da `SessionData`, resolução de `tenant_memberships`/`reserve_memberships`, TOTP, revogação de sessão) **não muda uma linha**.

Selecionado por `AMBIENTE_INFRA` num factory único, injetado nas rotas de auth — mesmo padrão de "trocar implementação por env" usado no resto da spec.

### 5.3 Migração de dado: `auth.users` → `public.usuarios`

Hoje `profiles.id` é `UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE` — dependência direta do schema interno do GoTrue. Para o on-prem:
- Criar `public.usuarios (id uuid primary key, email text unique, senha_hash text, criado_em timestamptz, ...)`, com `id` gerado do mesmo jeito (`gen_random_uuid()`), preservando compatibilidade com o FK que `profiles.id` já tem hoje (a FK passa a apontar para `public.usuarios(id)` em vez de `auth.users(id)` nesse ambiente).
- Script de carga inicial (Fase 2 da execução, §12): para uma instalação nova (o caso comum — 1 órgão on-prem normalmente começa do zero), não há migração de senha nenhuma, só provisionamento de usuário inicial com senha temporária forçando troca no primeiro login. Migração de senha existente da Supabase só seria necessária se um cliente SaaS migrasse *para* on-prem — nesse caso a senha não é recuperável (GoTrue não expõe hash em texto plano de forma seria), então o caminho correto é reset de senha obrigatório no corte, não tentativa de copiar hash.
- TOTP (`totp_secrets`) já é criptografado em nível de aplicação (AES-256-GCM, chave `TOTP_ENCRYPTION_KEY`) — migra sem alteração, é só dado de tabela normal.

---

## 6. Tempo real

### 6.1 Invariante preservado: browser só fala SSE

Hoje o browser **nunca** abre WebSocket direto contra Supabase Realtime — só existe `EventSource` (SSE) contra o BFF (`apps/web/src/hooks/use-sse-refresh.ts`), e isso é garantido por um script de CI (`scripts/ci/no-authed-realtime.sh`) que falha o build se alguém importar o client de Realtime no `apps/web`. **Essa garantia não muda** — é o que torna a troca de mecanismo interno transparente pro frontend.

Canais existentes (todos hoje implementados como subscrições `postgres_changes` filtradas por `tenant_id`/`reserve_id`/`user_id`, re-emitidas como evento SSE por `apps/bff/src/routes/realtime.ts`):

| Canal | Tabelas observadas | Filtro |
|---|---|---|
| `efetivo-sync` | `profiles`, `lendings`, `material_requests`, `cautelamentos` | `military_id`/`id` do próprio usuário |
| `armeiro-sync` | `lendings`, `material_requests`, `cautelamentos` | `tenant_id` |
| `arsenal-sync` | `material_items`, `material_types`, `lendings` | `tenant_id` |
| `admin-profiles-grid` | `profiles` | `default_tenant_id` |
| `livro-sync` | `service_log_events` | `tenant_id` |
| `nexus-events` / `nexus-errors` | `audit_logs` (INSERT) | superadmin, cross-tenant |
| `notifications` | `notifications` | `user_id` |

### 6.2 Modo ON_PREMISE: `LISTEN/NOTIFY` em vez de Socket.io

Avaliada a sugestão de usar Socket.io: **descartada** — exigiria abrir um transporte novo pro browser (WebSocket) e reescrever `use-sse-refresh.ts` e os componentes que o consomem, além de adicionar uma dependência nova (`socket.io`) e um servidor WebSocket adicional pra operar/patchear. Sem ganho real, já que o browser já não fala Realtime diretamente — o único ponto que precisa mudar é *de onde o BFF recebe o evento de mudança*, não como ele entrega pro browser.

Solução recomendada: **triggers de Postgres com `pg_notify`** nas mesmas tabelas hoje observadas via `postgres_changes`, e um listener nativo no BFF (`pg` já é dependência transitiva do client Postgres; usar uma conexão dedicada em modo `LISTEN`) que:
1. Recebe a notificação (payload JSON com tabela, operação, e as colunas de filtro relevantes: `tenant_id`/`reserve_id`/`user_id`).
2. Alimenta o **mesmo broadcaster SSE** que hoje recebe evento do client Supabase Realtime — ou seja, `realtime.ts` ganha uma segunda fonte de evento (`ListenNotifySource` vs `SupabaseRealtimeSource`) atrás da mesma interface, selecionada por `AMBIENTE_INFRA`.

```sql
-- exemplo para lendings, replicar por canal/tabela da tabela acima
CREATE OR REPLACE FUNCTION notify_lendings_change() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('lendings_changes', json_build_object(
    'op', TG_OP, 'tenant_id', NEW.tenant_id, 'id', NEW.id
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_lendings
AFTER INSERT OR UPDATE OR DELETE ON lendings
FOR EACH ROW EXECUTE FUNCTION notify_lendings_change();
```

Zero mudança no frontend, zero lib nova, zero novo transporte de rede exposto — só uma segunda implementação de fonte de evento dentro do BFF, que já era o único consumidor de Realtime mesmo.

---

## 7. Armazenamento de arquivos

### 7.1 Unificação via protocolo S3

Cloudflare R2, MinIO **e o próprio Supabase Storage** expõem uma API compatível com S3. Em vez de uma abstração com `if/else` por provedor, a recomendação é usar **um único client S3** (`@aws-sdk/client-s3`) nos dois modos — só o endpoint, região, credenciais e `forcePathStyle` mudam por env:

| Var | `SUPABASE` | `ON_PREMISE` |
|---|---|---|
| `STORAGE_S3_ENDPOINT` | endpoint S3-compat da Supabase Storage | endpoint do MinIO interno |
| `STORAGE_S3_REGION` | `auto` (ou região do projeto) | `us-east-1` (MinIO ignora, mas o SDK exige um valor) |
| `STORAGE_S3_ACCESS_KEY` / `STORAGE_S3_SECRET_KEY` | credencial S3 gerada no dashboard Supabase | credencial do MinIO (`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` ou service account dedicada) |
| `STORAGE_S3_FORCE_PATH_STYLE` | `false` | `true` (MinIO precisa de path-style) |

Isso substitui a dependência hoje existente no client `@supabase/storage-js`/SDK de Storage por chamadas S3 puras, o que também **simplifica o código atual** (elimina a necessidade de dois SDKs diferentes para "signed URL" — `createSignedUrl` vira `getSignedUrl` do `@aws-sdk/s3-request-presigner`, funciona igual nos dois modos).

### 7.2 Buckets existentes (migram 1:1)

`profile-photos`, `material-photos` (arsenal), `reserve-logos`, `tenant-logos` — mesma nomenclatura, mesma política de acesso (hoje gated por RLS em `storage.objects`; no on-prem, MinIO não tem RLS — a checagem de tenant/role sobre quem pode pedir signed URL passa a ser feita **na rota do BFF antes de gerar a URL**, que já é o padrão usado em `apps/bff/src/routes/profiles.ts`/`arsenal.ts`/`admin.ts` hoje — o BFF já decide quem pode pedir, RLS em `storage.objects` era defesa redundante).

---

## 8. Variáveis de ambiente (tabela completa)

| Var | Camada | `SUPABASE` | `ON_PREMISE` |
|---|---|---|---|
| `AMBIENTE_INFRA` | novo, global | `SUPABASE` | `ON_PREMISE` |
| `DATABASE_URL` | novo, BFF | não usado | `postgres://...` do container Postgres do órgão |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | BFF | obrigatório | não usado |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web | obrigatório (se web mantiver client direto em algum ponto de transição) | não usado, migrado pra chamada via BFF |
| `SESSION_SECRET` | BFF (iron-session) | obrigatório | obrigatório, mesmo mecanismo |
| `STORAGE_S3_*` (endpoint/região/chaves/path-style) | novo, BFF | aponta pro Storage S3-compat da Supabase | aponta pro MinIO |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | novo, BFF | não usado | obrigatório, substitui `RESEND_API_KEY` |
| `RESEND_API_KEY` / `EMAIL_ENABLED` | BFF | usado | **desabilitado** — ver §9 |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | BFF+web | usado | usado, com ressalva de soberania — ver §9-B |
| `NEXT_PUBLIC_TURNSTILE_SITEKEY` / `NEXT_PUBLIC_TURNSTILE_WORKER_URL` | web | usado | **desabilitado** ou captcha self-host — ver §9 |
| `TOTP_ENCRYPTION_KEY` | BFF | obrigatório em produção | obrigatório em produção, mesmo mecanismo |
| `BIOMETRIC_TEMPLATE_MASTER_KEY` + demais `BIOMETRIC_*` | BFF | usado | usado, mesmo mecanismo (bridge já é on-prem por natureza) |
| `INTERNAL_API_SECRET` / `INTERNAL_EMAIL_SECRET` / `EMAIL_CHANGE_TOKEN_SECRET` / `LOGIN_DEVICE_HASH_PEPPER` / `EMAIL_DEDUP_PEPPER` | BFF | usado | usado, mesmo mecanismo |
| `CORS_ORIGINS` / `WEB_URL` / `PORT` / `NODE_ENV` | BFF | usado | usado, valores apontando pra rede interna do órgão |
| `RATE_LIMIT_TRUST_PROXY_HEADERS` | BFF | `true` (atrás de Cloudflare→nginx) | `false` por padrão, salvo se houver proxy reverso confiável interno |

Todas as demais (`FINGERPRINT_SDK`, `ZKTECO_LIB_PATH`, `NEXT_PUBLIC_IDLE_TIMEOUT_MS` etc.) não têm relação com `AMBIENTE_INFRA` e seguem sem mudança nos dois modos.

---

## 9. Dependências externas e soberania de dados (LGPD)

Levantamento de **toda** dependência de rede que hoje sai do perímetro Supabase/Cloudflare, com veredito para o modo soberano:

| Dependência | Uso atual | Veredito on-prem |
|---|---|---|
| **Resend** (email) | Envio transacional (convite, troca de senha, alerta) | **Inaceitável como obrigatório.** É serviço US, dado de agente policial (nome, email institucional, contexto do alerta) trafegaria pra fora do país. Substituir por SMTP relay do próprio órgão (`SMTP_*`, §8) — requisito, não opção. |
| **Web Push (VAPID)** | Notificação push no navegador/PWA | Depende estruturalmente do gateway de push do fabricante do browser (Google FCM, Mozilla, Apple) — **é assim que o padrão Web Push funciona, não é escolha do apmcb.** Não dá pra eliminar sem abandonar push de browser. Documentar como **limitação aceita e assinada pelo órgão**, com fallback de notificação in-app (polling via SSE, já existe) para quem preferir desligar. |
| **Cloudflare Turnstile** | Captcha no login | Não existe sem Cloudflare. No on-prem: desabilitar (aceitável se a rede já é fechada/VPN do órgão, reduzindo risco de bot) ou trocar por captcha self-host (ex.: `mCaptcha`, self-hosted). Registrar a decisão por instalação. |
| **Bridge biométrico (Windows)** | Leitor de digital local | Já é on-prem por natureza (roda no PC da unidade, fala HTTPS com o BFF). Sem mudança. |
| **Supabase MCP** (aplicação de migration) | Só usado hoje pra alterar schema de produção manualmente | Não existe no on-prem — reforça a necessidade do fluxo de CLI/CI do §4.4, que é agnóstico de MCP. |

**Regra geral que fecha esta seção**: nenhuma chamada de rede egress nova pode ser adicionada ao modo `ON_PREMISE` sem entrar nesta tabela e ter veredito explícito. Isso é o item de checklist de aceite mais importante da spec (§13).

---

## 9-B. Modelo de acesso remoto e limite de fronteira de dados

Requisito confirmado pelo cliente: **nenhum dado do órgão pode residir em infraestrutura do fornecedor** no modo on-prem — não é só o banco, é banco, storage, fila de email, log e qualquer réplica de monitoramento. "Tudo deles."

**Suporte e manutenção remota**: o fornecedor não tem acesso permanente à instalação. Acesso é via **túnel zero-trust sob demanda** (ex.: Tailscale, Cloudflare Zero Trust Access, WireGuard) — três propriedades obrigatórias:
1. **Sob demanda** — o túnel não fica sempre ligado; é ativado pelo órgão para uma janela de manutenção/suporte e desligado depois.
2. **Auditado do lado do órgão** — quem entrou, quando, o que fez (o próprio produto de zero-trust escolhido normalmente já loga isso; o log fica com o órgão, não com o fornecedor).
3. **Revogável a qualquer momento** pelo órgão, sem depender do fornecedor para desligar.

O túnel dá acesso de **gerência de infraestrutura** (deploy de nova imagem, diagnóstico de container, leitura de log operacional para debug) — **nunca** um canal de replicação de dado de negócio (não é backup remoto, não é sincronização, não é telemetria de uso).

**Checklist de fronteira de dados (toda chamada de rede que sai do host on-prem precisa estar aqui, com opção de desligar documentada):**

| Chamada egress | Necessária? | Contém dado do cidadão/agente? | Pode ser desligada (modo air-gapped) |
|---|---|---|---|
| SMTP (§9, substituindo Resend) | Depende do órgão ter relay próprio | Sim (email, nome) — mas fica dentro do relay do próprio órgão, não sai pro fornecedor | Sim, com custo de perder notificação por email |
| Gateway Web Push (FCM/Mozilla/Apple) | Só se o órgão quiser push de browser | Payload da notificação passa pelo gateway do fabricante (fora do controle do órgão e do fornecedor) | Sim, cai para notificação in-app apenas |
| Túnel de suporte zero-trust | Só durante janela de manutenção | Não — é acesso de infra, não de dado de negócio | Sim, sempre desligável pelo órgão |
| Captcha (Turnstile ou self-host) | Opcional | Não (challenge/response, sem PII) | Sim |
| Bridge biométrico → BFF | Sim, é tráfego interno do próprio órgão (PC da unidade → BFF na mesma rede) | Sim, mas nunca sai do perímetro do órgão | N/A, já é interno |

**Monitoramento/observabilidade**, se existir no on-prem, roda com stack própria dentro do órgão (ex.: Grafana/Prometheus locais) — métrica e log operacional **não** são enviados a nenhum serviço SaaS do fornecedor.

---

## 10. Cenários de risco e gargalos comuns

- **Drift de schema não pego em CI** — já aconteceu uma vez (`category_requests`, §4.3). Depois do baseline reconciliado, falta de `db push` automatizado em CI é o jeito mais provável de o drift voltar a acontecer. Tratar como bug de processo, não só corrigir o sintoma pontual.
- **RLS mal portada = vazamento entre tenants = incidente LGPD reportável.** É o risco de maior impacto desta migração inteira, porque o shim de `auth.uid()` via `SET LOCAL` (§4.2) precisa estar em **todo** caminho de query do modo on-prem, sem exceção — um endpoint que esqueça de setar a claim antes de consultar vira bypass de RLS silencioso. Mitigação: suíte de teste automatizada de isolamento rodando contra os dois ambientes antes de qualquer release — o repo já tem `supabase/tests/reserve_isolation_canary.sql`, reaproveitar e expandir, não reinventar.
- **Backup/disaster recovery sem a infra gerenciada da Supabase.** No SaaS, backup é problema da Supabase. No on-prem, é problema do órgão + do fornecedor via runbook. `pg_dump`/`pg_basebackup` agendado não basta — o item de aceite tem que ser **teste de restore periódico documentado**, não só a existência do cron de backup.
- **Ambiente sem internet ou com internet restrita.** Qualquer chamada residual a serviço externo (SMTP externo, gateway de push, captcha, túnel de suporte) precisa de timeout curto e fallback explícito — travar a requisição inteira esperando um serviço externo responder é o tipo de bug que em produção policial vira "sistema caiu durante ocorrência".
- **TLS interno.** Rede do órgão normalmente não tem CA pública confiável para os hostnames internos. Planejar CA interna (ex.: `step-ca`, ou a CA que o próprio órgão já usa) antes do go-live — não deixar pra depois, senão vira "desliga o HTTPS pra funcionar" na prática.
- **Sem CD automático em rede fechada.** Deploy do modo SaaS hoje é blue/green automático via CI/SSH. Isso não existe (nem deveria, por segurança) numa rede isolada do órgão. Definir processo de atualização manual auditável (imagem versionada, checksum, aprovação humana no órgão antes de aplicar).
- **Custódia de chave sem HSM de nuvem.** `TOTP_ENCRYPTION_KEY` e `BIOMETRIC_TEMPLATE_MASTER_KEY` hoje presumem um ambiente com bom gerenciamento de secret (VPS do fornecedor). No on-prem, definir procedimento formal de geração/rotação/backup dessas chaves **do lado do órgão** — perder essa chave sem backup significa perder acesso a TOTP/template biométrico de todo mundo.
- **"Multi-tenant" numa instalação single-tenant na prática.** Uma instalação on-prem normalmente serve um órgão só. Isso não é motivo pra tirar o `tenant_id`/RLS do schema on-prem — é exatamente o que permite manter **um único código** para os dois modos. Tratar como decisão consciente, não como over-engineering a "simplificar" depois.

---

## 11. Checklist de conformidade LGPD

- **Base legal**: execução de políticas públicas de segurança (Art. 7º/23 combinados com legislação específica de segurança pública) — documentar formalmente por instalação, já que é o órgão público o controlador, não o fornecedor.
- **Retenção**: definir prazo de retenção por tipo de dado (log de auditoria, ocorrência, template biométrico) junto ao DPO do órgão — hoje não há política de expurgo automático nas tabelas de auditoria.
- **Direitos do titular**: fluxo de acesso/correção/eliminação de dado do próprio agente — parcialmente coberto (perfil editável), eliminação de histórico operacional (cautela, ocorrência) tem tensão com dever de guarda de registro público, exige parecer jurídico do órgão, não é decisão técnica do fornecedor.
- **Trilha de auditoria**: `audit_logs` (INSERT-only via RULE) e `audit_events` já cobrem a maior parte — documentar formalmente como controle de conformidade existente, reaproveitável nos dois modos sem mudança.
- **Dado sensível — biometria (Art. 5º II LGPD)**: `biometric_templates` já criptografado AES-256-GCM com chave por-tenant via HKDF (`BIOMETRIC_TEMPLATE_MASTER_KEY`) — documentar como controle técnico existente que já atende ao requisito de proteção reforçada.
- **RIPD (Relatório de Impacto à Proteção de Dados)**: recomendado antes do go-live de cada instalação on-prem, dado o volume de dado sensível biométrico e a natureza do órgão (segurança pública armada).
- **DPO**: papel do DPO é do órgão contratante no modo on-prem — o fornecedor não é controlador nem processa dado fora do perímetro do órgão (é o próprio ponto central desta spec). Deixar isso explícito em contrato/termo, não só na arquitetura técnica.

---

## 12. Plano de execução faseado

1. **Consolidar schema** — rodar `supabase db pull`, reconciliar o drift de `category_requests` (§4.3), commitar `supabase/config.toml` (feito nesta mudança) como baseline.
2. **Abstrair Auth** — interface `AuthProvider`, implementar `LocalAuthProvider` (tabela `usuarios` + bcrypt), migrar FK de `profiles.id`.
3. **Abstrair Storage** — client S3 único, remover dependência de SDK específico de Storage da Supabase.
4. **Abstrair Realtime** — implementar `ListenNotifySource`, triggers `pg_notify` por tabela observada, manter a mesma interface de broadcaster SSE.
5. **Dockerizar `apps/web`** — hoje só builda para Cloudflare Pages (`@cloudflare/next-on-pages`); precisa de build `next start` standalone + Dockerfile próprio, e `docker-compose.onprem.yml` completo (web + bff + postgres + minio + SMTP local/relay).
6. **Validação LGPD + disaster recovery** — rodar a suíte de isolamento de tenant/reserve contra o ambiente on-prem, executar (não só agendar) um drill de restore de backup, fechar o RIPD com o órgão piloto antes do primeiro go-live real.

---

## 13. Critérios de aceite / verificação

- Toda tabela listada em §4.1 confirmada presente e com RLS ativa nos dois ambientes (`\d+` + `pg_policies` batendo).
- Suíte de isolamento (`reserve_isolation_canary.sql` expandida) passando nos dois ambientes, incluindo caso de teste específico simulando um request sem `SET LOCAL request.jwt.claims` (deve falhar a query, não vazar dado — prova de que o shim é fail-closed).
- Toda variável de §8 documentada e validada no boot (zod), falha explícita se faltar a obrigatória do modo ativo.
- Tabela de §9/§9-B com veredito para 100% das chamadas egress do host on-prem, sem item "a definir".
- Teste de restore de backup executado e documentado (não só cron configurado) para o ambiente on-prem.
- Túnel de suporte validado como sob-demanda + revogável pelo órgão, com teste de "órgão revoga acesso enquanto fornecedor está conectado" confirmando desconexão imediata.
