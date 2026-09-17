# SP8 pt.2 — Wiring dos guards de reserva nas RPCs de escrita (F5)

> Spec focada, sub-fase do épico "isolamento por reserva"
> (`docs/superpowers/specs/2026-09-09-isolamento-reserva-design.md`, §4.4/§8, SP8).
> Portão de qualidade: nota ≥ 9.5 (auto-revisão + code review de arquiteto de segurança sênior
> + validação real em staging, não só teste de asserção de texto).

## 1. Contexto

SP8 pt.1 (mergeado, PR #42, aplicado em prod) criou 3 helpers `SECURITY DEFINER` —
`assert_actor_in_reserve`, `assert_device_in_reserve`, `assert_resource_in_reserve` — mas
**dormentes**: nenhuma RPC de negócio os chama ainda. As 9 assinaturas de F5 (RPCs
`SECURITY DEFINER` que fazem escrita real de cautela/empréstimo/biometria) continuam sem
guarda de isolamento por reserva no nível do banco. Elas rodam como `postgres` (bypassa RLS),
então hoje a única defesa contra um ator escrever numa reserva que não é a dele é o que o BFF
decide checar ANTES de chamar a RPC (variável por rota, não uniforme, não auditável num só
lugar). Esta spec fecha esse gap.

**Por que agora, e por que RPC por RPC**: cada uma destas RPCs é caminho quente de negócio
real (cautelamento de arma, empréstimo, prova biométrica) — a mesma disciplina do SP4/SP5/SP6/SP7
se aplica: nunca alterar o corpo de uma RPC de alto risco sem (1) auditoria completa do corpo
atual, (2) teste real em staging com dado real, (3) review adversarial ANTES de aplicar em prod.

## 2. Levantamento — estado real de cada RPC (lido direto do banco, 2026-09-15)

| RPC | Assinaturas | Tem ator? | Grants hoje | Achado |
|---|---|---|---|---|
| `record_cautelamento_batch` | 1 | `p_armeiro_id` | postgres, service_role | Falta `assert_actor_in_reserve`. Cross-check de item↔reserva **já existe** (`v_item_reserve_id <> p_reserve_id → RAISE CAUTELA_ITEM_WRONG_RESERVE`). |
| `record_lending_batch` | 2 (com/sem `p_totp_claim_id`) | `p_master_id` | postgres, service_role | Falta `assert_actor_in_reserve`. **Achado novo (não catalogado antes)**: `material_type_id` do payload NUNCA é checado contra `p_reserve_id` — `material_types.reserve_id` é lido só pra pegar `quantidade_total`/`quantidade_cautela`, sem comparar. Gap real de cross-reserve, mesma classe do que o `record_cautelamento_batch` já previne. |
| `record_lending_returns` | 2 (com/sem `p_totp_claim_id`) | `p_actor_id` | postgres, service_role | Falta `assert_actor_in_reserve`. Cross-check de recurso já adequado (toda query já filtra `l.reserve_id = p_reserve_id`; lending de outra reserva já cai em `BIOMETRIC_RETURN_LENDING_NOT_FOUND`). |
| `record_biometric_enrollment` | 1 | `p_actor_id` + `p_device_id` | postgres, service_role | Falta `assert_actor_in_reserve`. Device já validado inline (`status='active' AND reserve_id=p_reserve_id AND tenant_id=p_tenant_id`) — equivalente a `assert_device_in_reserve`, não duplicar. |
| `record_biometric_proof` | 1 | `p_actor_id` + `p_device_id` | postgres, service_role | Falta `assert_actor_in_reserve` **e** falta validação de device — diferente de `enrollment`, aqui `p_device_id` é gravado direto na consumação do challenge sem NUNCA checar que o device existe/está ativo/pertence à reserva. Precisa de `assert_device_in_reserve` também. |
| `set_material_cautela_eligibility` | 1 | **nenhum** | postgres, service_role | Não tem parâmetro de ator — precisa de mudança de assinatura. |
| `check_material_validade_vencimento` | 1 | **nenhum** (é cron; `p_reserve_id DEFAULT NULL` = varredura de TODAS as reservas do tenant) | postgres, service_role | Não se encaixa no padrão "ator escreve numa reserva" — é um job de sistema. Guard de defesa-em-profundidade, não o guard real (grant já restringe a postgres/service_role). |
| `bump_reserve_preference` | 1 | `p_user_id` | postgres, service_role | **Fora de escopo** (decisão do SP8 pt.1): registra preferência ANTES/DURANTE a troca de reserva — exigir "já estar ativo" seria circular. |

Todas as 8 funções de F5 já têm grant só pra `postgres`/`service_role` (confirmado via
`aclexplode`) — nenhuma é chamável direto por `anon`/`authenticated` via PostgREST. O guard que
esta spec adiciona é defesa **dentro** do caminho BFF→RPC (o BFF já é a fronteira confiável;
o guard prova que o BFF de fato repassou um ator autorizado, não que existe exposição direta).

## 3. Decisões

**D1 — fonte do `p_actor_id`**: sempre `c.get("userId")` do contexto Hono (resolvido pela sessão
iron-session do BFF), nunca de payload de cliente. Nenhuma rota atual faz diferente — confirmado
por leitura de `lendings.ts`, `cautelamentos.ts`, `biometric.ts`, `biometric-bridge.ts`,
`biometric-simulator.ts`, `arsenal.ts`.

**D2 — `set_material_cautela_eligibility`, mudança de assinatura em 3 passos, sem janela de
quebra E sem gap permanente silencioso** `[v2, achado ALTO #1 da revisão de arquitetura]`:

A 1ª versão desta spec propunha `p_actor_id uuid DEFAULT NULL` permanente, com o guard
condicional (`IF p_actor_id IS NOT NULL THEN ...`) ativando "automaticamente" quando o BFF
passasse a enviar o valor — mas o gate 5 do CI (`findUnguardedReserveFunctions`) é uma varredura
**textual** do corpo da função: uma vez que `PERFORM assert_actor_in_reserve(...)` apareça no
código-fonte, o gate passa **permanentemente**, mesmo que o BFF nunca envie `p_actor_id` de
verdade. Se o PR do `arsenal.ts` for esquecido/revertido/perdido num rebase, nada quebra, nenhum
gate acusa, e a função fica sem isolamento de fato, silenciosamente, para sempre. É a mesma
classe de "teste de asserção-de-texto prova que o código foi escrito, não que funciona" que o
CLAUDE.md já cataloga como achado real do SP2.

Fix: 3 passos, todos executados NESTA spec (não fica pendurado como débito):

1. **Migration B1** (aditiva): `p_actor_id uuid DEFAULT NULL` (novo último parâmetro) +
   guard condicional:
   ```sql
   IF p_actor_id IS NOT NULL THEN
     PERFORM assert_actor_in_reserve(p_actor_id, p_reserve_id);
   END IF;
   ```
   Aplicável a qualquer momento — não quebra o BFF atual, que não passa o param.
2. **Deploy do BFF**: `arsenal.ts` passa a enviar `p_actor_id: c.get("userId")`.
3. **Confirmação real + Migration B2** (torna obrigatório): depois do deploy do BFF confirmado
   no ar (mesmo `gh run view` que o resto do épico usa), rodar 1 chamada de teste real via a
   rota `PATCH /api/arsenal/:id` em staging e confirmar no log/tabela que `p_actor_id` chegou
   não-nulo na RPC — só então aplicar:
   ```sql
   ALTER FUNCTION public.set_material_cautela_eligibility(...) -- não aplicável a param;
   ```
   (Postgres não tem `ALTER FUNCTION ... ALTER PARAMETER`; o mecanismo real é
   `CREATE OR REPLACE FUNCTION` com a MESMA assinatura, `p_actor_id uuid` **sem** `DEFAULT`, e
   corpo trocando `IF p_actor_id IS NOT NULL THEN PERFORM ...` por
   `PERFORM assert_actor_in_reserve(p_actor_id, p_reserve_id);` incondicional — remover o
   `DEFAULT` de um parâmetro existente É uma mudança de assinatura binária compatível desde que
   nenhum caller restante omita o argumento; como o BFF (único caller, confirmado no passo 3)
   já sempre o envia, isso é seguro.
   **Se o passo 3 não puder ser confirmado na mesma sessão** (BFF ainda não deployado quando
   esta spec for implementada), Migration B2 fica registrada como item aberto no backlog do
   épico (`docs/superpowers/specs/2026-09-09-isolamento-reserva-design.md` §9, tabela de fases)
   com data e responsável — nunca como "invariante operacional" sem prazo.

**Ordem**: Migration B1 primeiro (aditiva, sempre segura), BFF depois — se invertida (BFF antes
da migration), a chamada com o parâmetro novo falha com "função não encontrada" (Postgres/
PostgREST resolve overload por nome de parâmetro). Migration B2 só depois de B1 + BFF deployado
+ confirmado.

**D3 — `check_material_validade_vencimento`, guard condicional**: como `p_reserve_id` pode ser
`NULL` (varredura de todas as reservas do tenant, uso real do cron hoje —
`cron.job.command = 'SELECT public.check_material_validade_vencimento()'`), não dá pra chamar
`assert_actor_in_reserve` incondicionalmente (falharia com "reserva inexistente" pra `p_reserve_id
NULL`, quebrando o uso legítimo). Fix:
```sql
IF p_reserve_id IS NOT NULL THEN
  PERFORM assert_actor_in_reserve(NULL, p_reserve_id);
END IF;
```
Sempre `p_actor_id = NULL` (não existe ator humano nesta função) — o branch `session_user =
'postgres'` do helper (fix do CRÍTICO do SP8 pt.1) garante que só uma chamada real via `pg_cron`
(ou `psql` direto como postgres) passa; qualquer hipotética chamada futura vinda de contexto
`authenticated`/`anon` (bug de exposição em outra camada) falharia aqui. Defesa-em-profundidade,
não fix de vulnerabilidade conhecida — grant já bloqueia o caminho direto.

**D4 — cross-check de recurso (`assert_resource_in_reserve` vs. inline)**: preferir o padrão
inline já estabelecido em `record_cautelamento_batch` (`SELECT ... INTO v_x_reserve_id ...; IF
v_x_reserve_id IS NOT NULL AND v_x_reserve_id <> p_reserve_id THEN RAISE`) quando a linha já está
sendo lida na mesma query (custo zero, mesmo estilo do arquivo). Reservar
`assert_resource_in_reserve` (EXECUTE dinâmico) pra casos sem uma leitura natural pra estender —
nenhum dos 9 casos desta spec precisa dele; fica disponível pra RPCs futuras.

**D5 — `record_biometric_proof` precisa de `assert_device_in_reserve` explícito** (não é
redundante aqui, diferente de `enrollment`): a função nunca valida `p_device_id` antes de
persistir — só o usa pra marcar o challenge consumido e gravar em `biometric_proofs`. Sem o
guard, um `device_id` de OUTRA reserva (ou revogado) é aceito sem checagem nenhuma.

**D6 — ordem de aplicação**: 3 migrations, não 1.
- **Migration A** (corpo-só, sem mudança de assinatura, sem dependência de BFF): as 6 funções
  que já têm ator — `record_cautelamento_batch`, `record_lending_batch`×2,
  `record_lending_returns`×2, `record_biometric_enrollment`, `record_biometric_proof`,
  `check_material_validade_vencimento`. Zero coordenação com deploy do BFF — aplicável
  imediatamente após teste em staging + review.
- **Migration B1** (`set_material_cautela_eligibility`, aditiva — §3/D2 passo 1): aplicar
  primeiro, DEPOIS deploy do BFF (`arsenal.ts`, §3/D2 passo 2). Mesma disciplina de
  sequenciamento do C1 do SP6, só que na direção oposta (aqui a migration é sempre segura
  sozinha; é o BFF que depende da migration já estar aplicada, não o contrário).
- **Migration B2** (`set_material_cautela_eligibility`, remove o `DEFAULT` — §3/D2 passo 3):
  só depois de confirmar B1 + BFF deployado E uma chamada real em staging/prod mostrando
  `p_actor_id` não-nulo chegando na RPC. Fecha o gap ALTO #1 da revisão de arquitetura
  (guard permanentemente dormente e indetectável se o BFF nunca for atualizado).

**D7 — `REVOKE` explícito em toda `CREATE OR REPLACE FUNCTION` desta spec**
`[v2, achado BAIXO #6 da revisão de arquitetura]`: embora `CREATE OR REPLACE FUNCTION` preserve
o ACL existente da função (não reseta grants), o histórico deste projeto tem 3 incidentes reais
de grant indevido reaparecendo (`20260714000007/008`, `20260829060000`, catalogados na spec-mãe
§7) — por clareza e pra não depender só do gate de CI pra pegar depois, cada migration desta
spec repete explicitamente o `REVOKE ALL ... FROM PUBLIC, anon, authenticated` (idêntico ao já
vigente) logo após cada `CREATE OR REPLACE FUNCTION`, mesmo sendo redundante com o estado atual.

## 4. Diffs exatos por função

### 4.1 `record_cautelamento_batch`

Inserir logo após o bloco de validação de input (`IF p_tenant_id IS NULL OR ... THEN RAISE
CAUTELA_BATCH_INPUT_INVALID`), antes do `pg_advisory_xact_lock`:
```sql
PERFORM assert_actor_in_reserve(p_armeiro_id, p_reserve_id);
```

### 4.2 `record_lending_batch` — 2 assinaturas, diff completo de cada uma
`[v2, achado ALTO #2 da revisão de arquitetura: a v1 desta spec só mostrava o diff completo da
1ª assinatura ("a 2ª recebe o mesmo tratamento") — exatamente a parte que fecha um gap de
cross-reserve write real. Ambas ficam explícitas abaixo.]`

Em **ambas**, inserir logo após o bloco de validação de input (`IF p_tenant_id IS NULL OR ...
THEN RAISE LENDING_BATCH_INPUT_INVALID`):
```sql
PERFORM assert_actor_in_reserve(p_master_id, p_reserve_id);
```

**Assinatura 1 — `record_lending_batch(p_tenant_id, p_master_id, p_military_id, p_reserve_id,
p_movement_id, p_notes, p_auth_mode, p_biometric_proof_id, p_items)`** (sem `p_totp_claim_id`):

`DECLARE` ganha `v_material_reserve_id uuid;` (variáveis existentes: `v_item jsonb; v_material_id
uuid; v_quantity integer; v_total integer; v_active integer; v_proof biometric_proofs%rowtype;`).

Antes (dentro do loop `for v_item in select value from jsonb_array_elements(p_items) loop`):
```sql
select quantidade_total into v_total
  from material_types
 where id = v_material_id and tenant_id = p_tenant_id
 for update;
if v_total is null then
  raise exception 'LENDING_MATERIAL_NOT_FOUND' using errcode = 'P0001';
end if;
```
Depois (o `IF v_total IS NULL` é PRÉ-EXISTENTE, inalterado — só a `SELECT` ganha `reserve_id` e
1 `IF` novo é adicionado depois dele):
```sql
select quantidade_total, reserve_id into v_total, v_material_reserve_id
  from material_types
 where id = v_material_id and tenant_id = p_tenant_id
 for update;
if v_total is null then
  raise exception 'LENDING_MATERIAL_NOT_FOUND' using errcode = 'P0001';
end if;
if v_material_reserve_id is not null and v_material_reserve_id <> p_reserve_id then
  raise exception 'LENDING_MATERIAL_WRONG_RESERVE' using errcode = 'P0001';
end if;
```

**Assinatura 2 — `record_lending_batch(..., p_items, p_totp_claim_id DEFAULT NULL)`** (com
`p_totp_claim_id`): mesmo fix, na query que já lê `quantidade_cautela` além de `quantidade_total`.

`DECLARE` ganha `v_material_reserve_id uuid;` (variáveis existentes desta assinatura: `v_item
jsonb; v_material_id uuid; v_quantity integer; v_total integer; v_cautela integer; v_active
integer; v_proof biometric_proofs%rowtype; v_claim totp_identity_claims%rowtype;`).

Antes:
```sql
select quantidade_total, quantidade_cautela into v_total, v_cautela
  from material_types
 where id = v_material_id and tenant_id = p_tenant_id
 for update;
if v_total is null then
  raise exception 'LENDING_MATERIAL_NOT_FOUND' using errcode = 'P0001';
end if;
```
Depois (`IF v_total IS NULL` pré-existente inalterado):
```sql
select quantidade_total, quantidade_cautela, reserve_id into v_total, v_cautela, v_material_reserve_id
  from material_types
 where id = v_material_id and tenant_id = p_tenant_id
 for update;
if v_total is null then
  raise exception 'LENDING_MATERIAL_NOT_FOUND' using errcode = 'P0001';
end if;
if v_material_reserve_id is not null and v_material_reserve_id <> p_reserve_id then
  raise exception 'LENDING_MATERIAL_WRONG_RESERVE' using errcode = 'P0001';
end if;
```

Ambas: mesmo padrão de `material_types.reserve_id IS NULL` = catálogo compartilhado do tenant,
igual SP5 — só bloqueia quando a linha tem reserva própria E diverge de `p_reserve_id`. O check
roda **dentro do loop**, uma vez por `material_type_id` do payload — cobre todos os itens do
batch, não só o primeiro.

### 4.3 `record_lending_returns` (ambas as 2 assinaturas)

Inserir logo após o bloco de validação de input (`IF p_tenant_id IS NULL OR ... THEN RAISE
BIOMETRIC_RETURN_INPUT_INVALID`):
```sql
PERFORM assert_actor_in_reserve(p_actor_id, p_reserve_id);
```

### 4.4 `record_biometric_enrollment`

Inserir logo no início do corpo (antes do check de `p_template_data`):
```sql
PERFORM assert_actor_in_reserve(p_actor_id, p_reserve_id);
```
Device já validado inline mais abaixo — não duplicar `assert_device_in_reserve` aqui. **Achado
MÉDIO #5 da revisão de arquitetura**: sem um marcador, um dev futuro vendo `record_biometric_proof`
chamar o helper explicitamente pode "simplificar" aqui removendo o check inline sem notar que ele
valida `tenant_id` também (o helper valida `reserve_id`/`status`, não `tenant_id`), ou copiar o
padrão desta função (só check inline) pra uma RPC biométrica nova sem perceber que aqui funciona
porque o check já existia, não porque é dispensável em geral. Adicionar comentário SQL logo acima
do bloco existente:
```sql
-- Equivalente a assert_device_in_reserve(p_device_id, p_reserve_id) (SP8 §3 D5) + tenant_id,
-- que o helper genérico não valida — não remover nem "simplificar" pra chamar o helper sem
-- primeiro conferir que o check de tenant_id continua coberto.
if not exists (
  select 1 from biometric_devices d
   where d.id = p_device_id
     and d.tenant_id = p_tenant_id
     and d.reserve_id = p_reserve_id
     and d.status = 'active'
) then
  raise exception 'BIOMETRIC_DEVICE_NOT_ACTIVE' using errcode = 'P0001';
end if;
```
(bloco em si inalterado — só ganha o comentário acima.)

### 4.5 `record_biometric_proof`

Inserir logo no início do corpo (antes do `UPDATE biometric_challenges`):
```sql
PERFORM assert_actor_in_reserve(p_actor_id, p_reserve_id);
PERFORM assert_device_in_reserve(p_device_id, p_reserve_id);
```

### 4.6 `check_material_validade_vencimento`

Inserir logo após `v_hoje := ...`:
```sql
IF p_reserve_id IS NOT NULL THEN
  PERFORM assert_actor_in_reserve(NULL, p_reserve_id);
END IF;
```

### 4.7 `set_material_cautela_eligibility` (migration B1, depois B2)

Assinatura ganha `p_actor_id uuid DEFAULT NULL` (novo último parâmetro, B1) — B2 remove o
`DEFAULT` (§3/D2, passo 3).

**Posição do guard — `[v2, achado MÉDIO #3 da revisão de arquitetura]`**: a v1 desta spec
inseria o `PERFORM` DEPOIS do `SELECT * INTO v_material ... FOR UPDATE`, divergindo sem
justificativa do padrão das outras 6 funções (guard sempre antes de qualquer lock). Como o
guard não depende de nenhum dado de `v_material` (só de `p_actor_id`/`p_reserve_id`, já
disponíveis como parâmetros), não há razão pra pagar o custo de adquirir/esperar o
`FOR UPDATE` antes de rejeitar um ator não autorizado — e esta função específica já teve 1
CRÍTICO de concorrência resolvido antes (comentário em `arsenal.ts:843-854`), então qualquer
mudança na ordem de lock dela merece o padrão mais conservador, não menos. Corpo, **logo no
início da função**, antes do `select * into v_material from material_types ... for update`:
```sql
IF p_actor_id IS NOT NULL THEN
  PERFORM assert_actor_in_reserve(p_actor_id, p_reserve_id);
END IF;
```

**BFF** (`apps/bff/src/routes/arsenal.ts`, handler `PATCH /:id`): adicionar
`p_actor_id: c.get("userId")` ao objeto passado em `supabase.rpc("set_material_cautela_eligibility",
{...})`.

## 5. Comportamento sob a flag (`tenants.reserve_isolation_enabled`)

Idêntico ao resto do épico: `assert_actor_in_reserve`/`assert_device_in_reserve` já fazem `IF NOT
reserve_isolation_enabled THEN RETURN` internamente (SP8 pt.1) — os `PERFORM` adicionados nesta
spec são **dormentes** enquanto a flag do tenant estiver OFF (estado atual de PMPB em prod).
Zero mudança de comportamento observável até a flag ligar (SP10).

## 6. Testes obrigatórios (staging, com dado real, não asserção de texto)

Por função, no mínimo:
1. **Regressão do caminho feliz** — chamada idêntica à que o BFF faz hoje, com a flag ligada e
   `active_reserve_id` do ator batendo com `p_reserve_id` → sucesso idêntico ao comportamento
   pré-wiring.
2. **Ator autorizado noutra reserva** (flag ON, `active_reserve_id` ≠ `p_reserve_id`, papel sem
   bypass de matriz) → `RAISE` do helper, não a exception de negócio da função.
3. **Flag OFF** → guard dormente, comportamento idêntico ao pré-wiring mesmo com `p_reserve_id`
   divergente do `active_reserve_id`.
4. Específico de `record_lending_batch`: `material_type_id` de OUTRA reserva (com
   `reserve_id` não-nulo) → `LENDING_MATERIAL_WRONG_RESERVE`, tanto com quanto sem o novo guard
   de ator (são checks independentes).
5. Específico de `record_biometric_proof`: `p_device_id` revogado/de outra reserva →
   `assert_device_in_reserve` dispara antes de qualquer INSERT.
6. Específico de `check_material_validade_vencimento`: chamada sem argumento (`p_reserve_id`
   NULL, uso real do cron) continua funcionando idêntica — guard não entra nesse caminho.
7. Específico de `set_material_cautela_eligibility`: chamada SEM `p_actor_id` (simulando BFF
   ainda não deployado) → sucesso idêntico ao atual (guard dormente por ausência do param, não
   pela flag). Chamada COM `p_actor_id` de ator não-autorizado + flag ON → `RAISE`.
8. **`[v2, achado MÉDIO #4 da revisão de arquitetura]`** Concorrência em
   `set_material_cautela_eligibility`: 2 chamadas concorrentes (mesmo padrão do CRÍTICO já
   resolvido, documentado em `arsenal.ts:843-854` — 2 sessões `psql` abrindo transação, uma
   chama a RPC e segura antes do `COMMIT` via `pg_sleep` num teste manual, a outra tenta
   concorrentemente) — confirmar que o `FOR UPDATE` de `v_material` ainda serializa as duas
   corretamente com o guard novo no meio do corpo (o guard em si é só leitura, não deveria
   interferir, mas isso precisa ser PROVADO com uma execução real, não assumido).

## 7. Portão de qualidade

1. Auto-revisão desta spec (placeholder scan, consistência interna, ambiguidade) — feita antes
   de salvar.
2. Code review por sub-agente com mandato de **arquiteto de segurança sênior** (não o mandato
   genérico do CLAUDE.md — este pede também: correção transacional sob concorrência, blast
   radius de cada RPC tocada, e se o cross-check de `record_lending_batch` cobre todo o
   caminho ou só o caso feliz).
3. Testes reais em staging (§6) — evidência de execução, não `.includes()`.
4. Aplicar em prod na ordem do §3/D6 — Migration A primeiro (sem dependência de BFF), depois
   Migration B1 + deploy do `arsenal.ts`, depois Migration B2 (só após confirmar `p_actor_id`
   chegando não-nulo na RPC real).
5. Regenerar `KNOWN_UNGUARDED_RESERVE_FUNCTIONS` em `ci-reserve-gates.ts`:
   - Após Migration A: remover as 8 assinaturas das 6 funções cobertas (`record_cautelamento_batch`,
     `record_lending_batch`×2, `record_lending_returns`×2, `record_biometric_enrollment`,
     `record_biometric_proof`, `check_material_validade_vencimento`).
   - `set_material_cautela_eligibility` **só sai da lista depois de B2** (remoção do `DEFAULT`) —
     o gate 5 (`findUnguardedReserveFunctions`) é textual (§3/D2, ALTO #1): já para de acusar
     assim que B1 aplica (o `PERFORM` condicional já aparece no corpo), então remover o nome da
     allowlist nesse ponto criaria falso silêncio equivalente ao próprio gap que D2 existe pra
     fechar. Manter o nome em `KNOWN_UNGUARDED_RESERVE_FUNCTIONS` entre B1 e B2 é deliberado —
     funciona como o marcador visível de "guard existe mas ainda não é garantidamente exercido",
     e só sai da lista no mesmo commit que aplica B2 (quando o `DEFAULT` deixa de existir e a
     chamada sem `p_actor_id` passa a falhar de verdade, não só silenciosamente aceitar NULL).
   - **Correção (2026-09-16, pós-aplicação de Migration A)**: `bump_reserve_preference` NÃO sai
     da lista nunca — ao contrário do que esta spec dizia antes, ela tem `p_reserve_id` como
     argumento e o gate 5 vai sinalizá-la para sempre, já que por design (D1 do SP8 pt.1) ela
     nunca vai chamar `assert_actor_in_reserve` (seria circular). Fica em
     `KNOWN_UNGUARDED_RESERVE_FUNCTIONS` como débito PERMANENTE e aceito, não temporário — única
     entrada da lista que nunca sai. Ao fim de B2, a lista tem só essa 1 entrada (não zero).
6. Teste adicional pós-B2 (fecha o loop de evidência do ALTO #1 de ponta a ponta): chamar
   `set_material_cautela_eligibility` OMITINDO `p_actor_id` depois que B2 estiver aplicado →
   deve falhar com erro de "função não encontrada" (PostgREST não resolve overload sem o
   parâmetro obrigatório), confirmando que o `DEFAULT` de fato não existe mais e que a única
   forma de chamar a função é passando um ator real.
