# Enterprise Spec — Isolamento por Tenant das Fotos de Material (Storage RLS)

> **Para agentes:** implementar fase-by-fase seguindo os checkboxes abaixo.
> DoD canônica: `docs/enterprise/07-canonical-definition-of-done.md`
> Princípios: SRP · DRY · SSOT · KISS · YAGNI · SoC · Fail Fast · Least Surprise

**Status:** 🔴 Pendente (migration escrita, não aplicada em produção)
**Data:** 2026-08-28
**Fase:** Segurança — Storage RLS
**Escopo primário:** `supabase/migrations` (RLS de `storage.objects`) — nenhuma mudança de aplicação necessária

---

## 1. Origem do achado

Encontrado por um code review sênior (mandato `CLAUDE.md`) sobre o fix do bug de `photo_url`
em `POST /api/arsenal/requests` (2026-08-27) — não é uma regressão introduzida por aquele fix,
é uma falha pré-existente que o bug acidentalmente mascarava (ver §2). Investigado a fundo nesta
entrega, conforme pedido do dono do produto: "investigue, crie uma spec, crie um harness".

**Achado CRÍTICO**: a policy de `SELECT` em `storage.objects` para o bucket `material-photos`
(bucket privado desde `20260629000001_fix_rls_security_audit.sql`) permite que **qualquer
usuário autenticado da plataforma, de QUALQUER tenant**, leia o objeto de **qualquer outro
tenant** — a policy não filtra por tenant/reserva nenhuma:

```sql
-- 20260629000001_fix_rls_security_audit.sql:215-217 (ATUAL, ainda em produção)
CREATE POLICY "material_photos_auth_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'material-photos');
```

Isso é um IDOR cross-tenant em fotos de armamento — um armeiro do Tenant B, tendo visto (por
acaso, log, captura de tela, network tab do navegador) o path de uma foto do Tenant A, consegue
ler essa foto usando o SDK do Supabase diretamente no console do navegador com o próprio JWT,
sem passar pela UI da plataforma.

## 2. Por que isto não é (e nunca foi) explorável via a UI da plataforma hoje

Investigado a fundo antes de decidir o fix — importante pra dimensionar o risco real e pra
garantir que a correção não quebra nada:

- **Toda exibição real de foto passa pelo BFF com a service role key**, que **bypassa RLS por
  completo** — confirmado em `apps/bff/src/lib/storage` (client-side, via `resolvePhotoUrl`/
  `withMaterialPhotoDisplayUrls`, `apps/web/src/lib/storage.ts`) e em
  `apps/bff/src/routes/usuario.ts:124-143` (`resolveMaterialPhotoUrls`, `createSignedUrls` via
  client com service role). A policy RLS de `storage.objects` **nunca é avaliada** nesse
  caminho — o service role ignora RLS inteiramente, por design do Postgres/Supabase.
- **Nenhum lugar do frontend acessa o bucket `material-photos` direto via SDK do browser**
  (confirmado por grep em `apps/web/src` — zero ocorrências de
  `storage.from("material-photos")` fora do BFF). Só o BFF (`apps/bff/src/routes/arsenal.ts`,
  `usuario.ts`) toca esse bucket, sempre com a service role.
- **Conclusão**: a superfície de exploração real hoje é estreita — só alguém tecnicamente
  capaz de abrir o devtools do navegador, extrair o próprio JWT da sessão Supabase, e chamar a
  API REST do Storage manualmente (ou o SDK JS num console) com um path de outro tenant que
  já tenha visto de alguma forma. Não é um "clique de botão" pra qualquer usuário, mas é uma
  falha real de autorização no armazenamento de dados sensíveis, e paths podem vazar por vários
  canais (screenshot, log de erro, network tab compartilhado em suporte, etc.) — inaceitável
  num sistema de custódia de armamento pela severidade do dado exposto, mesmo com probabilidade
  de exploração mais baixa que um IDOR "clicável".

**Por que o bug de `photo_url` (corrigido em 2026-08-27) mascarava isto sem querer**: antes do
fix, `POST /api/arsenal/requests` com `photo_url` (path relativo real) **sempre falhava** com
ZodError — ou seja, nenhum path relativo de foto de material chegava a ser persistido em
`material_types.photo_url` por ESSE fluxo. Corrigir o bug de verdade (photo precisa funcionar)
aumenta o volume de fotos reais entrando no sistema por este caminho — sem essa correção de RLS,
o "raio de explosão" do problema pré-existente cresce.

## 3. Decisão de arquitetura — por que NÃO precisa mover/renomear nenhum objeto existente

Duas abordagens foram avaliadas:

| Abordagem | Custo/Risco | Escolhida? |
|---|---|---|
| **A. Reparticionar o path** (`materials/{tenantId}/{uuid}.webp`) + policy por prefixo de path (`storage.foldername`) | Exige migrar/renomear TODO objeto já existente no bucket (custo de storage + risco de quebrar signed URLs em voo durante a migração) — e não dá pra saber o volume real de objetos existentes sem acesso de execução SQL (bloqueado nesta sessão, ver §6) | ❌ Não |
| **B. Function `SECURITY DEFINER` que confere posse via JOIN nas tabelas de negócio** (`material_types`/`material_items`, que já têm `tenant_id` desde `20260620000001_multitenant_foundation.sql`) | Zero mudança de dado — o path do objeto nunca muda, só a policy de leitura passa a checar se ESSE path aparece em alguma linha do tenant do usuário | ✅ **Sim** |

A abordagem B é estritamente aditiva: nenhum objeto de storage é tocado, nenhuma URL assinada
existente quebra, e o comportamento do BFF (sempre service role) não muda em nada — só fecha a
leitura direta via SDK do browser pra quem não tem uma linha de negócio correspondente no
próprio tenant.

**Efeito colateral aceito, documentado**: enquanto uma solicitação de adição de material está
**pendente de aprovação** (`admin_approval_requests.payload`, ainda não virou uma linha real de
`material_types`), a nova policy nega leitura via SDK do browser pra QUALQUER usuário — inclusive
o próprio tenant dono da solicitação. Isso é aceitável e correto: ninguém deveria conseguir ler
essa foto por esse caminho enquanto ela não existe como material aprovado; a tela de aprovação do
admin já usa o BFF (service role) pra mostrar a prévia, então não é afetada.

## 4. Fix

### Fase A — Function + policy (uma migration, uma entrega)

- [ ] **A.1** — Nova migration `supabase/migrations/20260828000000_fix_material_photos_cross_tenant_rls.sql`
  (conteúdo já escrito neste repo, ver arquivo) — cria `can_read_material_photo(object_path text)`
  (`SECURITY DEFINER`, `STABLE`, reaproveita `my_tenant_id()` já existente e testado desde
  `20260629000006_fix_auth_role_recursion.sql`) e substitui `material_photos_auth_read` por
  `material_photos_tenant_read`.
- [ ] **A.2** — **Aplicar manualmente no Supabase Dashboard (SQL Editor)** — mesma prática já
  estabelecida no projeto pra migrations de RLS (ver CHANGELOG v22: "Ação pendente do dono do
  produto — aplicar manualmente no Supabase Dashboard"). Esta sessão não tem permissão de
  `execute_sql`/`get_advisors` no MCP do Supabase (bloqueado, confirmado 2x nesta mesma sessão)
  — não há como aplicar nem validar isto programaticamente daqui.
- [ ] **A.3** — Depois de aplicada, rodar o harness de validação manual (`§5` abaixo) no SQL
  Editor pra confirmar isolamento — com dado real de produção, não dá pra simular 2 tenants
  isolados via teste automatizado sem acesso de execução.

## 5. Harness de validação (SQL manual, rodar no Supabase SQL Editor)

Não é possível escrever um teste automatizado de verdade para uma RLS policy do Postgres a
partir desta sessão (exigiria uma conexão de banco real com 2 usuários JWT distintos de tenants
diferentes — a suíte de testes do BFF roda com `node --experimental-strip-types --test`, sem
Postgres real, e o MCP do Supabase está sem permissão de execução). Este harness é SQL puro,
pra rodar manualmente no SQL Editor do Supabase logo depois de aplicar a migration (A.2/A.3):

```sql
-- 1. Confirmar que a function existe e está SECURITY DEFINER
SELECT proname, prosecdef FROM pg_proc WHERE proname = 'can_read_material_photo';
-- esperado: prosecdef = true

-- 2. Confirmar que a policy antiga foi substituída
SELECT policyname, qual FROM pg_policies
  WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname LIKE 'material_photos%';
-- esperado: só "material_photos_tenant_read" (sem "material_photos_auth_read")

-- 3. Achar 2 material_types de tenants DIFERENTES que já tenham photo_url preenchido
--    (se não houver nenhum com foto ainda, o teste 4/5 abaixo não tem dado real pra
--    validar contra — nesse caso, a mitigação já vale preventivamente para o primeiro
--    upload real que acontecer).
SELECT id, tenant_id, photo_url FROM material_types WHERE photo_url IS NOT NULL LIMIT 5;

-- 4. Simular a checagem de posse SEM trocar de sessão (via SECURITY DEFINER,
--    a function roda com o auth.uid() da sessão ATUAL do SQL Editor — troque
--    pelo uid de um profile de teste de cada tenant, ou rode via
--    `SET LOCAL role authenticated; SET LOCAL request.jwt.claims = '{"sub":"<uuid>"}';`
--    pra simular um usuário específico, escopo de sessão só, sem persistir):
SELECT can_read_material_photo('<photo_url do tenant A, colado do passo 3>');
-- esperado, autenticado como usuário do tenant A: true
-- esperado, autenticado como usuário do tenant B: false
```

## 6. Riscos e Rollback

| # | Risco | Mitigação |
|---|---|---|
| R1 | Migration aplicada errada trava leitura de fotos LEGÍTIMAS (ex: nome de coluna errado) | Rollback de 1 linha: `DROP POLICY "material_photos_tenant_read" ON storage.objects; CREATE POLICY "material_photos_auth_read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'material-photos');` — reverte pro estado anterior (inseguro, mas funcional) instantaneamente |
| R2 | `can_read_material_photo` performático? | `STABLE` + índices já existentes em `material_types.tenant_id`/`material_items.tenant_id` (`idx_material_types_tenant`, ver `20260620000001_multitenant_foundation.sql:182`) — mas SEM índice em `photo_url`/`ocorrencia_foto_url` (busca por igualdade de string, não indexada). Volume esperado baixo (fotos, não uma tabela de alto tráfego) — aceitável sem índice novo nesta entrega; se `EXPLAIN ANALYZE` (não executável nesta sessão, ver §4/A.2) mostrar sequential scan lento em produção, adicionar índice parcial `WHERE photo_url IS NOT NULL` como follow-up |
| R3 | Sessão sem acesso de execução SQL nesta rodada — migration nunca chega a ser validada de verdade antes de aplicada | Documentado explicitamente em A.2/A.3 — dono do produto aplica e roda o harness §5 manualmente |
| R4 | `profile-photos` tem a MESMA classe de vulnerabilidade (`profile_photos_auth_read`, mesma migration, sem filtro de tenant) | **Fora do escopo desta entrega** (achado tangencial, registrado aqui pra não se perder) — dado sensível diferente (PII de foto de perfil, não foto de armamento), mesma abordagem B se aplicaria (`profiles.default_tenant_id` já existe). Recomendado como próxima entrega, spec própria. |

## 7. Definition of Done

- [ ] Migration aplicada em produção (dono do produto, SQL Editor)
- [ ] Harness §5 rodado e confirmando isolamento (dono do produto ou próxima sessão com MCP liberado)
- [ ] CHANGELOG atualizado após aplicação confirmada (não antes — "aplicado" e "escrito" são estados diferentes, não confundir)
- [ ] R4 (profile-photos) triado: decidir se vira spec própria ou é aceito como risco residual documentado
