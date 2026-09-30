# EVIDENCE — R-35: isolamento do bucket `profile-photos`

## Estado inicial
| Campo | Valor |
|---|---|
| Branch | `claude/bold-planck-6xy9fc` |
| HEAD | `76fe826` (`4628502` presente) |
| `origin/main` | `5f91635` |
| Working tree | limpo |
| WIP_INFRA_HIBRIDA / WIP_BIOMETRIA | não tocadas |

## Antes
As policies de `storage.objects` para o bucket privado `profile-photos` eram iguais no repositório e em produção (metadados de `pg_policies`; nenhum objeto lido). Eram 5 policies para `authenticated`:
- leitura, inserção e atualização condicionadas **só** por `bucket_id`, sem vínculo com dono ou tenant;
- duas policies de papéis legados (`admin`, `master`).

Não havia policy de DELETE. O baseline canônico e o hash estão no pacote de verificação (branch `claude/r35-verification-package`, `verification/r35/`).

**Consumidores legítimos (todos com service role):**
- troca de foto no BFF (`replaceProfilePhoto`): o path é gerado no servidor, e o alvo é autorizado como o próprio usuário ou staff do mesmo tenant da sessão;
- `POST /api/admin/upload-photo` (staff);
- `GET /api/profiles/:id/photo-url`: URL assinada com TTL de 1h, só para o próprio usuário ou staff do mesmo tenant;
- scripts de manutenção e setup de E2E.

O web não acessa o bucket com o JWT do usuário (`profile-photo-static-harness.test.ts`).

## Migration
`supabase/migrations/20260930130000_r35_profile_photos_storage_isolation.sql`
- SHA-256 `d63f4b5e58a91c4f85f64b79a0a54060975e1837452c58ebcb7fc17506551b5b`, 4990 bytes. São os mesmos bytes validados externamente.
- Remove as 5 policies e não cria nenhuma: o acesso direto de `anon`/`authenticated` fica negado por padrão, e o `service_role` continua funcionando porque ignora o RLS.
- Guardas (abortam a migration):
  1. sobrou policy PERMISSIVA para `anon`/`authenticated`/`PUBLIC` que cita o bucket (cobre drift de nome);
  2. sobrou policy dessas sem filtro de `bucket_id` (ela alcançaria todos os buckets);
  3. o bucket está ausente ou público.
- As guardas só olham o risco do R-35. Policies restritivas, de outros papéis ou de outros buckets não bloqueiam.
- Escopo: nada além do `profile-photos`. Grants (R-36), `material-photos`, outros buckets e tabelas de `public` (R-34) não mudam.
- Histórico de versões:
  - `45d2fda8…` (guarda 2 ampla demais, superada);
  - `d63f4b5e…` (atual).

## Verificação (externa, ambiente descartável)
**Executada por outra sessão do Claude Code**, em Supabase local via Docker:
- Postgres 15.8 com a Storage API real v1.28.0;
- identidades artificiais de dois tenants;
- bytes artificiais;
- nenhum acesso a produção.

**Resultado:** FINAL_RESULT = **PASS**, com hash conferido antes da primeira aplicação e no fim.

| Fase | Resultado |
|---|---|
| Baseline | reconstruído das migrations do repositório; policies idênticas a `baseline_policies.sql` |
| Antes | reproduzido na Storage API e em SQL: `authenticated` SELECT/INSERT/UPDATE = ALLOWED, DELETE = DENIED; `anon` = DENIED (igual ao esperado) |
| Depois: `anon` | SELECT/INSERT/UPDATE/DELETE = DENIED (API e SQL) |
| Depois: `authenticated` | DENIED nas 4 operações para usuário do tenant A, usuário com papel legado e o próprio dono (B). O objeto de B ficou intacto |
| `service_role` | upload, substituição, URL assinada (aberta sem login), `legacy-staged/`, remoção = ALLOWED |
| Bucket | continua privado; nenhuma policy remanescente cita o bucket |
| Outros buckets | policies de `material-photos` idênticas antes e depois |
| Idempotência | 2ª e 3ª aplicações sem erro |
| Contraprova | policy ampla reintroduzida com outro nome: 20 testes de negação falharam e a guarda 1 abortou a reaplicação. Policy sem filtro de bucket: guarda 2. Bucket público: guarda 3. Mutações removidas: PASS de novo |
| Regressão BFF (export exato de `76fe826`) | foto de perfil 59/59; URL assinada 7/7; suíte completa 689/689 |

Limitações registradas pelo validador:
- O restante do banco era um stand-in mínimo. É suficiente, porque as policies só referenciam `profiles` e o baseline bate.
- A versão local da Storage API pode diferir da de produção. Por isso tudo foi repetido direto em SQL.
- A migration foi aplicada em transação, como o Supabase CLI faz. Sem transação, uma guarda que falhasse deixaria as policies já removidas: o estado ficaria mais restrito, nunca mais aberto.

As evidências brutas ficaram no scratchpad da sessão validadora e não estão no repositório.

## Verificação nesta sessão (após restaurar os bytes)
| Comando | Resultado |
|---|---|
| `sha256sum` da migration no repositório | `d63f4b5e…551b5b` (bate) |
| Postgres local: sintaxe, idempotência e guardas (bucket público/ausente, policy renomeada, policy sem filtro de bucket; restritiva, de outro papel e de outro bucket não bloqueiam) | como esperado |
| BFF unit (env CI), com a correção do BFF | 695/695 |
| BFF integração | 136/136 |
| R-06 + R-28 (`dashboard-scope-real-handler`, `mode-user-auth-paths`) | 32/32 |
| `profile-photo-routes` (após a correção) | 13/13; o código antigo falha em 5 |
| `tsc --noEmit` (BFF), `lint:logs`, `git diff --check` | OK |
| Web | não alterado |

## BFF: autorização e URL assinada
- O `service_role` ignora o RLS, então a segurança do fluxo depende dos handlers.
- Troca de foto: alvo = o próprio usuário, ou papel efetivo operacional com tenant da sessão igual ao do alvo. Caso contrário, 403 ou 404.
- URL assinada: o próprio usuário, ou papel efetivo de staff com lookup filtrado pelo tenant da sessão. Caso contrário, 403 ou 404.
- O papel efetivo respeita o Modo Usuário (R-28).
- Coberto pelos testes existentes (`replace-profile-photo`, `profile-photo-routes`).

## Correção complementar no BFF (achado da revisão de segurança)
- **Achado (MÉDIO, confiança 8), no mesmo fluxo de foto de perfil:**
  - `profiles.foto_url` pode ser gravado pelo próprio titular fora do BFF.
  - `GET /api/profiles/:id/photo-url` assinava com service role o caminho que estivesse gravado ali, sem conferir a quem o objeto pertence.
  - Com a migration, é o único caminho de leitura restante, e ele precisava do vínculo objeto → perfil.
- **Correção** (`domain/profile-photo/resolve-profile-photo-url.ts`, `routes/profiles.ts`):
  - só assina se o caminho for `<id_do_perfil>/…`, ou `legacy-staged/<uuid>.webp` sem nenhum outro perfil referenciando esse objeto (contagem por path ou URL);
  - fora disso responde 403 `PROFILE_PHOTO_FOREIGN_REFERENCE` e registra `profile_photo.foreign_reference_denied`;
  - se a contagem falhar, a URL não é assinada.
- **Testes** (`profile-photo-routes.test.ts`, 13 casos):
  - referência a outro perfil, pelo próprio titular e via staff do mesmo tenant;
  - forma de URL;
  - prefixo parecido;
  - `legacy-staged` próprio aceito e compartilhado recusado;
  - falha na contagem.
- **Contraprova:** o código antigo falha em 5 dos novos casos; o corrigido passa 13/13.
- **Pré-requisito funcional de deploy:** fotos antigas gravadas na raiz do bucket (`<matrícula>-<timestamp>.<ext>`, formato de `f44ff18`) passam a ser recusadas. Não foram liberadas porque os nomes são previsíveis. Antes do deploy, rodar `apps/bff/scripts/migrate-active-profile-photos.ts`, que move as fotos ativas para `<id>/<uuid>.webp`.

## Reviews
- **Code-review da migration: aprovada, 0 CRÍTICO, 0 ALTO.**
  - MÉDIO (não corrigido, para não invalidar a validação externa): as guardas 1 e 2 são heurísticas de texto. Uma policy com `bucket_id <> 'x'` ou `bucket_id IS NOT NULL`, ou dada a um papel herdado por `authenticated`, passaria por elas. Nenhuma existe hoje (a validação comportamental cobriu o estado real). Proposta: allowlist fechada de policies e `pg_has_role`.
  - BAIXOS: `storage.prefixes` fora da guarda; `resolvePhotoUrl`/`resolvePhotosInBulk` do web sem chamadores e com bucket padrão `profile-photos`; falta um gate de CI de policies de `storage.objects`; confirmar `supabase migration list` antes de aplicar.
- **Security-review:**
  - rodada 1: 1 MÉDIO (o `foto_url` acima), corrigido;
  - rodada 2 (correção): **nenhum achado com confiança ≥ 8**. Foram testadas tentativas por prefixo, encoding, URL, legado compartilhado ou órfão e injeção no `.or()`, sem sucesso.
  - Abaixo do limiar: um titular que conheça o path `legacy-staged` de outro pode fazer a foto dessa pessoa ser recusada (só disponibilidade). A causa raiz, `foto_url` gravável pelo titular, fica como item separado (R-38).

## Produção
Não aplicada e não alterada. Nesta etapa, só metadados foram lidos anteriormente (`pg_policies`, grants, `storage.buckets`); nenhum objeto, foto ou dado pessoal. Nenhum `db push`, `--include-all` ou `migration repair`. O bloqueio de `20260923120000_usuarios_onprem` continua.

## Status
**DONE_VERIFIED_REPO_PENDING_DEPLOY**: correto no repositório e verificado de forma hermética; **produção ainda não corrigida**.

**Para o deploy (decisão separada):**
1. Rodar `migrate-active-profile-photos.ts`.
2. Publicar o BFF com a correção de assinatura.
3. Aplicar a migration.

O bloqueio da `20260923120000_usuarios_onprem` impede `db push` comum. A aplicação isolada precisa ser decidida à parte, sem `--include-all` nem `migration repair`.
