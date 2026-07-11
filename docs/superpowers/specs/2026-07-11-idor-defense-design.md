# Anti-IDOR Enterprise Defense Design

**Data:** 2026-07-11
**Status:** Spec aprovada para planejamento detalhado
**Escopo:** BFF, Next Route Handlers, Supabase RLS, Storage, Realtime/SSE, PDFs publicos, relatorios/exportacoes e filtros de busca.

---

## 1. Objetivo

Eliminar IDOR (Insecure Direct Object Reference) como classe de falha na plataforma APMCB.

Nesta spec, IDOR nao significa apenas trocar `/recurso/1` por `/recurso/2`. A definicao operacional e:

> Qualquer fluxo que recebe, consulta, persiste, assina, exporta ou deriva um recurso a partir de um identificador externo deve provar autorizacao por `owner_id`, `tenant_id`, `reserve_id` ou allowlist publica documentada antes de revelar ou alterar dados.

UUIDs continuam obrigatorios para reduzir enumeracao, mas nao sao controle de acesso.

---

## 2. Decisao Arquitetural

### 2.1 Contrato de acesso por recurso

Cada recurso sensivel deve declarar um contrato de acesso:

| Campo | Descricao |
|---|---|
| Recurso | Tabela, bucket, canal Realtime, PDF, endpoint ou payload derivado |
| Identificadores externos | Path params, query params, body, arrays, metadata, filtros, document IDs, storage paths |
| Predicado obrigatorio | `owner_id`, `tenant_id`, `reserve_id`, membership ou combinacao |
| Roles permitidas | `usuario`, `armeiro`, `admin_reserva`, `admin_global`, `auditor`, `superadmin` |
| Operacoes permitidas | Ler, criar, atualizar, assinar, aprovar, exportar, revogar |
| Payload permitido | Campos que podem sair da fronteira do backend |
| Teste negativo | Usuario/tenant/reserva incorretos devem receber 403/404 e nao alterar estado |

### 2.2 Fonte de autoridade

`userId`, `role`, `tenantId`, `reserveId`, `activeMode` e `nexusAuthorized` devem vir exclusivamente da sessao validada pelo backend.

Campos equivalentes enviados por body/query/path sao apenas seletores de recurso. Eles nunca podem definir autoridade.

### 2.3 BFF com `service_role`

O BFF usa Supabase `service_role` e, portanto, bypassa RLS. Para o BFF:

- Toda leitura por identificador externo deve aplicar escopo no backend.
- Toda mutation sensivel deve incluir o predicado de escopo na propria operacao de escrita quando a tabela possuir o campo.
- Checagem previa seguida de `update/delete` por `id` puro e proibida para tabelas com `tenant_id`, `reserve_id` ou owner field.
- Excecoes precisam ter nome, justificativa, risco residual e teste dedicado.

Exemplo obrigatorio para mutation:

```ts
await supabase
  .from("lendings")
  .update(payload)
  .eq("id", id)
  .eq("tenant_id", tenantId)
  .eq("status_legacy", "ativo");
```

### 2.4 Next Route Handlers

Handlers em `apps/web/src/app/api/**` usam anon/RLS com cookies Supabase, mas continuam no escopo:

- lookup exato por `id` deve validar role e escopo esperado;
- busca ampla por `q`, `military_id`, `tenant_id`, `reserve_id` ou similar deve ser testada contra vazamento;
- payload deve ser minimizado por caso de uso.

### 2.5 Superadmin e Nexus

Regra canonica:

> `superadmin` e papel Nexus/SaaS-only. Nao acessa dado operacional de tenant.

Consequencias:

- `superadmin` so pode aparecer em `/api/nexus/**` e endpoints publicos/tecnicos explicitamente documentados.
- Qualquer referencia a `superadmin` fora de Nexus deve ser inventariada como risco, nao apenas `roleGuard`.
- Rotas operacionais devem negar `superadmin`, mesmo que exista `tenantId` na sessao.
- Paginas, Server Components, Next Route Handlers, guards, libs de navegacao e helpers que liberem dado operacional para `superadmin` tambem entram na matriz.

### 2.6 Endpoints publicos

Endpoints publicos de verificacao sao permitidos apenas por allowlist. Cada um deve declarar:

- finalidade publica;
- identificador aceito;
- campos permitidos;
- PII proibida;
- comportamento anti-enumeracao;
- limite de payload;
- teste que valida conteudo, nao apenas status HTTP.

PII proibida por padrao em endpoint publico: email, matricula, telefone, `profile.id` sem necessidade documental, biometria, TOTP, path bruto privado de Storage, tenant/reserve IDs internos quando o hash/documento publico bastar.

---

## 3. Superficies Obrigatorias

### 3.1 BFF REST

Inventariar todos os arquivos em `apps/bff/src/routes/**` que aceitam:

- path params (`:id`, `:document_id`, `:userId`, `:iid`);
- query params (`military_id`, `material_id`, `tenant_id`, `reserve_id`, `from/to`, filtros de relatorio);
- body IDs (`militar_id`, `military_id`, `material_type_id`, `item_id`, `reserve_id`, `document_id`, `lending_ids`, `user_id`);
- arrays de IDs;
- metadata usada para derivar notificacao, auditoria, PDF ou assinatura.

### 3.2 Next Route Handlers

Inventariar `apps/web/src/app/api/**/route.ts`, especialmente:

- handlers com `[id]`;
- `searchParams.get("id")`;
- buscas por texto que retornam dados pessoais;
- handlers que usam `createServerClient` com anon key e dependem de RLS.

### 3.3 Supabase RLS

RLS continua obrigatoria para acesso via anon key, browser SSR e queries diretas do Next. A spec nao substitui RLS. Ela cria uma segunda camada para BFF/service_role.

Toda policy nova ou alterada deve:

- escopar por `tenant_id` para dados operacionais;
- escopar por owner para dados de usuario;
- excluir `superadmin` de dados internos de tenant;
- ter teste cross-tenant.

### 3.4 Storage

Inventariar buckets e fluxos de URL:

| Bucket/fluxo | Regra esperada |
|---|---|
| Avatares/perfis | usuario so acessa proprio path; staff so por tenant/reserva autorizada |
| Fotos de material | signed URL gerada somente apos escopo por item/material/tenant |
| Logos publicos | publico somente quando branding exige exposicao publica |
| Documentos de custodia | signed URL curta e vinculada a documento autorizado |

Contrato Storage:

- paths privados devem conter escopo (`tenant_id/reserve_id/user_id` quando aplicavel);
- TTL maximo padrao para signed URL privada: 1 hora;
- bucket publico precisa de justificativa de produto;
- teste negativo deve tentar reutilizar path privado de outro usuario/tenant/reserva.

### 3.5 Realtime/SSE

Realtime via BFF/SSE usa service role e deve ser tratado como API sensivel.

Cada canal deve declarar:

- nome do canal;
- roles permitidas;
- predicado de sessao usado para filtrar (`userId`, `tenantId`, `reserveId`);
- tabelas observadas;
- colunas enviadas;
- se envia row completa ou payload reduzido;
- teste de usuario/tenant/reserva incorreto.

Proibido: canal que aceite `tenant_id`, `reserve_id` ou `user_id` do cliente como autoridade.

### 3.6 PDFs, verificacao publica e exportacoes

PDFs e exportacoes sao superficies IDOR porque agregam dados. Cada rota deve ter:

- predicado de acesso antes de gerar documento;
- payload minimo;
- hash/verificacao quando documento publico;
- teste que baixa/consulta documento de outro usuario/tenant/reserva e espera 403/404;
- teste que garante que endpoint publico nao revela PII proibida.

### 3.7 Busca, autocomplete e relatorios

Filtros de relatorio e autocomplete aceitam IDs e texto livre. Eles devem:

- aplicar escopo antes de buscar ou hidratar label por ID;
- retornar lista vazia para recurso fora de escopo;
- limitar payload;
- nao permitir que `admin_global` injete `tenant_id` de outro tenant;
- nao permitir que `usuario` use filtros para descobrir outro usuario.

---

## 4. Matriz de Riscos Inicial

| Area | Risco IDOR | Severidade | Exemplo de teste |
|---|---|---:|---|
| BFF mutations | update/delete por `id` sem escopo na escrita | Critico | `admin_global` tenant A tenta devolver lending tenant B |
| Body IDs | `military_id`/`item_id`/`reserve_id` de outro escopo | Critico | criar saida com item de outro tenant |
| Bulk arrays | `lending_ids` misturando recursos autorizados e nao autorizados | Alto | bulk-return com um lending de outro usuario |
| Storage | signed URL para path privado sem checar dono | Alto | usuario A solicita foto/documento de B |
| Realtime/SSE | canal envia row de outro tenant/reserva | Alto | listener de tenant A recebe evento tenant B |
| Public verify | endpoint publico revela PII ou confirma enumeracao | Alto | GET verify com UUID valido de documento alheio |
| Search/autocomplete | hidratacao por `id` revela perfil fora de escopo | Medio | `/api/admin/search-profiles?id=uuid-outro-tenant` |
| Relatorios/export | filtro por `military_id` fora do tenant | Alto | export PDF com dados de outro tenant |
| Superadmin operacional | `superadmin` em roleGuard de dado interno | Alto | superadmin chama `/api/saidas` |

---

## 5. Harness de Testes

### 5.1 Fixtures deterministicas

O harness deve provisionar ou localizar:

| Grupo | Tenant A | Tenant B |
|---|---|---|
| `usuario` | usuario A1, usuario A2 | usuario B1 |
| `armeiro` | armeiro A1, armeiro A2 | armeiro B1 |
| `admin_reserva` | admin_reserva A1, admin_reserva A2 | admin_reserva B1 |
| `admin_global` | admin_global A | admin_global B |
| `auditor` | auditor A | auditor B |
| `superadmin` | Nexus-only | Nexus-only |
| reservas | reserva A1, reserva A2 | reserva B1 |
| recursos | material, item, lending, cautela, shift, notification, document, storage object | equivalentes |

### 5.2 Camadas de teste

1. **API matrix rapida**: HTTP direto ao BFF/Next handlers com tokens/cookies por role.
2. **Playwright E2E**: fluxos criticos com browser, CSRF, cookies HttpOnly, download/exportacao e SSE.
3. **SQL/RLS checks**: consultas com anon/JWT quando aplicavel, sem service_role.
4. **Estado pos-mutation**: toda tentativa negativa de mutation valida que o banco nao mudou.

### 5.3 Resultado esperado

Para recurso existente fora de escopo:

- leitura: 403 ou 404 sem payload sensivel;
- mutation: 403 ou 404 e zero alteracao no banco;
- bulk: falha atomica ou ignora apenas itens nao autorizados somente se a rota documentar esse comportamento;
- public verify: payload minimo, sem PII proibida;
- Storage: sem signed URL para objeto privado fora de escopo;
- Realtime: nenhum evento cruzado recebido.

---

## 6. Inventario Inicial Obrigatorio

A implementacao deve gerar tabela de inventario cobrindo:

- `apps/bff/src/routes/*.ts`;
- `apps/web/src/app/api/**/route.ts`;
- `apps/web/src/app/v/[document_id]/**`;
- `apps/bff/src/routes/public.ts`;
- `apps/bff/src/routes/realtime.ts`;
- helpers de Storage em `apps/web/src/lib/storage.ts` e fluxos BFF que geram URL;
- relatorios e exports em `apps/web/src/components/reports/**` e rotas correspondentes;
- migrations/policies de `storage.objects` e tabelas criticas.

Cada linha deve indicar: recurso, identificadores, predicado atual, gap, severidade, teste proposto e arquivo responsavel.

---

## 7. Criterios de Aceite

### CA01 - Definicao ampla de IDOR

O inventario cobre identificadores em path, query, body, arrays, metadata, filtros, Storage paths, document IDs, canais Realtime e exports.

### CA02 - Mutations fail-closed

Toda mutation sensivel via BFF/service_role inclui `tenant_id`, `reserve_id` ou owner field na propria query de escrita quando a tabela possuir o campo. Excecoes documentadas exigem teste dedicado.

### CA03 - Superadmin Nexus-only

Varredura automatizada lista toda referencia a `superadmin` fora de `/api/nexus/**`, `/nexus/**` e allowlist publica/tecnica documentada. A varredura cobre BFF routes, Next Route Handlers, Server Components/pages, middleware, guards, libs, nav config e testes. Cada ocorrencia deve ser removida ou documentada como excecao publica/tecnica.

Teste obrigatorio: qualquer rota, pagina ou handler operacional que mencione ou aceite `superadmin` deve responder 403, 404 ou redirect para area Nexus, salvo excecao documentada.

### CA04 - Storage protegido

Nenhum signed URL privado e gerado sem autorizacao previa do recurso dono. Buckets publicos possuem justificativa e payload nao sensivel.

### CA05 - Realtime/SSE isolado

Todo canal usa sessao como fonte de escopo e nao aceita IDs do cliente como autoridade.

### CA06 - Public verify minimo

Endpoints publicos de verificacao tem allowlist de campos e teste que falha se email, telefone, matricula, TOTP, biometria ou path privado aparecerem.

### CA07 - Harness negativo

`idor-suite` executa matriz cross-user, cross-reserve, cross-tenant, role-insufficient, malformed ID e valid UUID unauthorized.

### CA08 - Estado imutado apos tentativa negativa

Toda mutation negativa valida estado do banco antes/depois.

### CA09 - Docs atualizadas

`docs/security.md` documenta Anti-IDOR, least privilege, roles atuais e limitacao de UUID.

### CA10 - Review externo

Spec e plano devem receber nota minima 9/10 em revisao de seguranca antes da implementacao.

---

## 8. Fora do Escopo Desta Spec

- Trocar UUIDs ja existentes por outro esquema.
- Criar ABAC generico completo.
- Refatorar design visual.
- Alterar migrations antigas ja commitadas.
- Mudar infraestrutura de auth fora do necessario para IDOR.

---

## 9. Riscos e Mitigacoes

| Risco | Mitigacao |
|---|---|
| Matrix grande demais para Playwright | Dividir API matrix rapida e E2E apenas para fluxos criticos |
| Fixtures contaminarem producao | Usar dados `[IDOR-TEST]`, cleanup e ambiente/staging quando disponivel |
| Regressao por superadmin removido de rota operacional usada pela UI | Teste deve confirmar que UI Nexus nao depende de dados operacionais |
| Checagem anterior inevitavel em fluxo complexo | Excecao nomeada, transacao/lock quando possivel, teste concorrente |
| Docs de seguranca com roles legados | Nova secao declara roles atuais e marca trechos historicos como legado ate reconciliacao completa |

---

## 10. Nota de Qualidade Esperada

Meta minima: **9/10**.

O plano so atinge 9/10 se:

- tratar IDOR como referencia externa a objeto, nao apenas URL por ID;
- endurecer mutations BFF com predicado na escrita;
- incluir Storage, Realtime, public verify e exportacoes;
- tornar `superadmin` Nexus-only verificavel;
- definir fixtures deterministicas e validação pos-mutation;
- atualizar a documentacao de seguranca.
