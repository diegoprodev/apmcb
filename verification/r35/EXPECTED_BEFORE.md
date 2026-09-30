# Estado esperado ANTES da migration

O validador confirma que o ambiente reproduz o baseline:
1. As 5 policies de `POLICY_BASELINE.md` existem com essas definições
   (comparar com `baseline_policies.sql`).
2. Bucket `profile-photos` privado (`public = false`).
3. Nenhuma policy de DELETE para o bucket.
4. Registrar, para identidades artificiais de dois tenants (A e B) e um objeto
   artificial de B, a decisão observada (ALLOWED/DENIED) para
   SELECT, INSERT, UPDATE e DELETE como `authenticated` de A e como `anon`.
   Esperado pelas policies: SELECT/INSERT/UPDATE de `authenticated` = ALLOWED
   (condição só por bucket); DELETE = DENIED; `anon` = DENIED.
   Se o observado divergir disso, o baseline não foi reproduzido:
   resultado INCONCLUSIVE.
