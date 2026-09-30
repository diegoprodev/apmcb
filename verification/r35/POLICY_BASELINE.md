# Baseline de policies (estado anterior) e especificação de rollback

Fonte: `pg_policies` de produção (metadado, 2026-09-30) = repositório
(migrations 20260614000002, 20260627000002, 20260629000001). Formato canônico
em `baseline_policies.sql` (espaços internos das subqueries normalizados);
SHA-256 em `MIGRATION_SHA256.txt`.

| Policy | Cmd | Permissive | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `profile_photos_auth_read` | SELECT | PERMISSIVE | authenticated | `bucket_id = 'profile-photos'` | — |
| `profile_photos_authenticated_insert` | INSERT | PERMISSIVE | authenticated | — | `bucket_id = 'profile-photos'` |
| `profile_photos_authenticated_update` | UPDATE | PERMISSIVE | authenticated | `bucket_id = 'profile-photos'` | — (reusa USING) |
| `admin_master_can_upload_photos` | INSERT | PERMISSIVE | authenticated | — | bucket + `profiles.role IN ('admin','master')` |
| `admin_master_can_update_photos` | UPDATE | PERMISSIVE | authenticated | bucket + `profiles.role IN ('admin','master')` | — |

Nenhuma policy de DELETE para o bucket. Bucket: `public = false`.
Outras policies de `storage.objects` (não alteradas): `material_photos_tenant_read`,
`material_photos_staff_write`, `material_photos_staff_update`.

## Rollback (especificação, não automatizado)
Recriar as 5 policies acima com as definições exatas de `baseline_policies.sql`.
**Atenção:** o rollback restaura o estado anterior por completo, inclusive o
acesso amplo que motivou o R-35. Só deve ser usado, de forma manual e
controlada, se uma validação posterior detectar regressão de fluxo legítimo que
não possa ser corrigida de outra forma — e reabre o R-35.
