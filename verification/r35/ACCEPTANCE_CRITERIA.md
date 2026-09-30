# Critérios de aceitação

Todos obrigatórios para FINAL_RESULT = PASS:

| Critério | Esperado |
|---|---|
| MIGRATION_SHA256 | = `d63f4b5e58a91c4f85f64b79a0a54060975e1837452c58ebcb7fc17506551b5b` |
| BASELINE reproduzido (EXPECTED_BEFORE) | sim |
| ANON_SELECT / ANON_INSERT / ANON_UPDATE / ANON_DELETE | DENIED |
| AUTHENTICATED_SELECT / _INSERT / _UPDATE / _DELETE | DENIED |
| SERVICE_ROLE_LEGITIMATE_FLOW | ALLOWED |
| BUCKET_PUBLIC | FALSE |
| UNEXPECTED_PROFILE_PHOTOS_POLICY | NONE |
| OTHER_BUCKET_POLICIES_UNCHANGED | TRUE |
| IDEMPOTENCY (2ª aplicação) | sem erro |
| BFF_PROFILE_PHOTO_TESTS | PASS (`node --experimental-strip-types --test` nos testes `profile-photo-*` e `replace-profile-photo` do BFF, env de CI) |
| SIGNED_URL_SCOPE_TESTS | PASS (`profile-photo-routes.test.ts`) |
| MUTATION (ver abaixo) | detectada |

## Contraprova obrigatória (mutation testing)
1. Com o estado corrigido e os testes verdes, reintroduzir temporariamente uma
   policy PERMISSIVA equivalente à classe antiga (acesso de `authenticated` ao
   bucket condicionado só por `bucket_id`).
2. Os testes de negação devem FALHAR (e a migration, se reaplicada, deve
   falhar pela guarda 1).
3. Remover a mutação, reaplicar o estado corrigido, rodar de novo: PASS.
Sem essa sequência o resultado é INCONCLUSIVE.

## Resultados possíveis
PASS · FAIL (algum critério violado) · INCONCLUSIVE (baseline não reproduzido,
infraestrutura, ou contraprova ausente).
