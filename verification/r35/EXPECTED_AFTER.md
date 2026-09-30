# Estado esperado DEPOIS da migration

1. Migration aplicada sem erro, **duas vezes** (idempotência).
2. Nenhuma das 5 policies do baseline existe.
3. Nenhuma policy PERMISSIVA para anon/authenticated/PUBLIC cita
   `profile-photos` ou deixa de filtrar `bucket_id`.
4. Para `anon` e `authenticated` (tenant A, e também o próprio dono B):
   SELECT, INSERT, UPDATE e DELETE no bucket = DENIED.
5. `service_role`: upload, substituição, geração de URL assinada e remoção de
   objeto artificial = ALLOWED.
6. Bucket continua `public = false`.
7. Policies de outros buckets idênticas ao antes.
