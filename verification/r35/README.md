# R-35 — pacote de verificação externa (profile-photos)

Material para outro ambiente/agente validar a migration R-35 **antes** de ela
entrar no repositório. Não contém dados reais, credenciais, tokens ou fotos.

## O que a migration faz
Remove as 5 policies de `storage.objects` que se aplicam ao bucket privado
`profile-photos` para `authenticated` (ver `POLICY_BASELINE.md`). Não cria
policy nova. Resultado pretendido: **nenhum acesso direto** ao bucket para
`anon`/`authenticated`; `service_role` (BFF, scripts) continua operando porque
ignora RLS. Guardas: falha se, depois dos DROPs, sobrar policy PERMISSIVA para
anon/authenticated/PUBLIC que cite `profile-photos` ou que não filtre
`bucket_id`, ou se o bucket estiver ausente ou público.

## Por que é seguro remover (verificado no código)
Todo acesso legítimo ao bucket usa service role:
- BFF `POST /api/profiles/me/photo` e `POST /api/profiles/:id/photo`
  (`replaceProfilePhoto`): path `<profile_id>/<uuid>.webp` gerado no servidor;
  alvo autorizado (self, ou staff do mesmo tenant da sessão).
- BFF `POST /api/admin/upload-photo`: `legacy-staged/<uuid>.webp`, staff.
- BFF `GET /api/profiles/:id/photo-url`: URL assinada TTL 1h; self ou staff do
  mesmo tenant da sessão.
- `apps/bff/scripts/*profile-photo*`, `apps/web/e2e/global-setup.ts`: service role.
- O web não lê o bucket com o JWT do usuário (garantido por
  `profile-photo-static-harness.test.ts`).

## Arquivos
| Arquivo | Conteúdo |
|---|---|
| `20260930130000_r35_profile_photos_storage_isolation.sql` | migration exata sob validação |
| `MIGRATION_SHA256.txt` | hashes (a validação vale só para esse hash) |
| `baseline_policies.sql`, `POLICY_BASELINE.md` | estado anterior + especificação de rollback |
| `EXPECTED_BEFORE.md`, `EXPECTED_AFTER.md` | estados esperados |
| `ACCEPTANCE_CRITERIA.md` | critérios objetivos, inclusive contraprova |
| `RESULT_TEMPLATE.md` | formato obrigatório do resultado |

## Restrições do validador
- Somente ambiente local/descartável (Supabase local ou Postgres com o schema
  `storage` do Supabase). **Nunca produção.**
- Objetos artificiais (bytes mínimos), identidades artificiais de dois tenants.
- Não aplicar em produção; não usar `db push`, `--include-all` nem
  `migration repair` (o bloqueio de `20260923120000_usuarios_onprem` segue
  valendo — deploy é decisão separada).

## Como este pacote chegou aqui
Publicado na branch `claude/r35-verification-package` (a partir de `76fe826`),
só para ser acessível a outro ambiente. A migration está como `.sql.txt` e fora
de `supabase/migrations/` de propósito: nenhuma ferramenta deve aplicá-la. O
SHA-256 em `MIGRATION_SHA256.txt` é dos BYTES do arquivo (o nome não entra):
`sha256sum 20260930130000_r35_profile_photos_storage_isolation.sql.txt` deve dar
`d63f4b5e58a91c4f85f64b79a0a54060975e1837452c58ebcb7fc17506551b5b`.
Esta branch não deve ser mergeada.
