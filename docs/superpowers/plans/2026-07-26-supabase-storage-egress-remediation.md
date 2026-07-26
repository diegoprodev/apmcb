# Supabase Storage Egress Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkboxes and require red/green evidence.

**Goal:** Corrigir o egress de `profile-photos` sem tornar o bucket público, aceitando uploads brutos de até 5 MiB, persistindo WebP imutável de até 150 KB e resolvendo uma signed URL por `(profileId, photoPath)` no cliente.

**Architecture:** O BFF/Bun será a fronteira única para validar, processar, persistir e assinar fotos. A troca de objeto usa upload novo, CAS do banco com a referência bruta original, recontagem normalizada e remoção condicional. O frontend recebe somente o path estável e compartilha uma query TanStack entre todos os avatares montados.

**Tech Stack:** Hono 4, Bun/Node test runner, Supabase JS, Sharp, Next.js 16, React 19, TanStack Query 5, Vitest/Testing Library e Playwright.

---

## Regras de execução

- Implementar somente a spec aprovada em `docs/superpowers/specs/2026-07-26-supabase-storage-egress-remediation-design.md`.
- Para cada mudança comportamental: criar teste, executar e confirmar falha pela razão esperada; escrever a implementação mínima; executar e confirmar sucesso.
- Não fazer commit de código de produção antes do code review obrigatório do subagente definido no `CLAUDE.md`.
- Não corrigir warnings preexistentes fora do escopo. Gate: zero erros, nenhum warning novo e total global `<= 88`.
- Não executar migração `--apply`, remoção de órfãos ou deploy sem autorização separada.
- Registrar comandos, contagens e resultados para o relatório final de 14 seções.

## Task 1: Fixar ferramentas e capturar o baseline Network

**Files:**

- Modify: `apps/bff/package.json`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/src/test/setup.ts`
- Create: `apps/web/e2e/profile-photo-network.spec.ts`
- Create: `artifacts/storage-egress/network-baseline.json`

**Steps:**

- [ ] Adicionar `sharp` como dependência direta do BFF.
- [ ] Adicionar script `test:unit` do web e configuração Vitest/jsdom.
- [ ] Criar o primeiro teste mínimo do harness Network e executá-lo vermelho até registrar requests de assinatura, GET do objeto, bytes, URLs únicas, status e cache headers.
- [ ] Executar o harness autenticado contra o baseline nos cenários viáveis e salvar JSON real. Se o ambiente não permitir comparação autenticada, registrar a limitação sem estimar redução.
- [ ] Rodar `pnpm --filter @apmcb/bff typecheck` e `pnpm --filter @apmcb/web test:unit`.

## Task 2: Selecionar o body limit antes de qualquer rejeição

**Files:**

- Create: `apps/bff/src/middleware/request-body-limit.ts`
- Create: `apps/bff/src/__tests__/profile-photo-body-limit.test.ts`
- Modify: `apps/bff/src/index.ts`

**Steps:**

- [ ] Escrever teste comportamental Hono com multipart contendo arquivo `>2 MiB` e `<5 MiB` para `POST /api/profiles/me/photo`; executar e confirmar rejeição pelo limite global atual.
- [ ] Cobrir também `POST /api/profiles/:id/photo` e `POST /api/admin/upload-photo`.
- [ ] Escrever teste de rota comum com body `>2 MiB` e confirmar `413`.
- [ ] Escrever teste de foto `>5 MiB` e confirmar `413`.
- [ ] Implementar um middleware seletor único: 2 MiB nas rotas comuns e `5 MiB + 64 KiB` nas três rotas de foto. Não registrar primeiro o limitador global.
- [ ] Confirmar que os arquivos `>2 MiB` e `<5 MiB` chegam aos handlers de foto e que a rota comum permanece em 2 MiB.

## Task 3: Processar bytes reais com Sharp

**Files:**

- Create: `apps/bff/src/domain/profile-photo/process-profile-photo.ts`
- Create: `apps/bff/src/__tests__/process-profile-photo.test.ts`

**Steps:**

- [ ] Gerar em memória JPEG e PNG de 3–5 MiB, EXIF rotacionado, imagem pequena, ruído de alta entropia, GIF/SVG, bytes falsos e bomba acima de 40 MP.
- [ ] Executar o teste vermelho por ausência do processador.
- [ ] Implementar validação de 5 MiB, formato real jpeg/png/webp, animação, `limitInputPixels`, auto-orientação, resize sem ampliar e WebP.
- [ ] Implementar a matriz 512/448/384/320/256 e qualidades aprovada, preferindo `<=100 KB` e impondo `<=150 KB`.
- [ ] Inspecionar a saída novamente com Sharp e provar formato, dimensão, orientação e tamanho.

## Task 4: Normalizar referências sem contaminar o CAS

**Files:**

- Create: `apps/bff/src/domain/profile-photo/profile-photo-reference.ts`
- Create: `apps/bff/src/__tests__/profile-photo-reference.test.ts`

**Steps:**

- [ ] Escrever testes para path relativo, URL pública legada, URL signed válida, host/bucket externo, traversal, query, fragmento e barra invertida.
- [ ] Executar vermelho e implementar normalização estrita para `profile-photos`.
- [ ] Provar que a função retorna um novo `oldPhotoPathNormalized` sem alterar `oldPhotoReferenceRaw`.

## Task 5: Implementar troca transacional com CAS e concorrência

**Files:**

- Create: `apps/bff/src/domain/profile-photo/replace-profile-photo.ts`
- Create: `apps/bff/src/repositories/profile-photo-repository.ts`
- Create: `apps/bff/src/__tests__/replace-profile-photo.test.ts`

**Steps:**

- [ ] Criar fakes determinísticos de repositório e Storage com log de ordem.
- [ ] Escrever testes vermelhos de primeira foto, troca, falha de upload, falha de update, falha de delete, path inválido, referência compartilhada e falha de recontagem.
- [ ] Adicionar teste em que o banco contém URL pública absoluta: exigir que o CAS receba exatamente `oldPhotoReferenceRaw` e Storage receba somente `oldPhotoPathNormalized`.
- [ ] Adicionar teste com duas promises concorrentes: exatamente um CAS vence; a perdedora remove somente seu novo objeto; a foto vencedora e objeto referenciado permanecem.
- [ ] Implementar `replaceProfilePhoto` com upload `upsert:false`, path `{profileId}/{uuid}.webp`, CAS escopado, compensação e recontagem segura.
- [ ] Implementar adaptador Supabase com semântica nula equivalente a `IS NOT DISTINCT FROM` e confirmação de uma linha.
- [ ] Executar a suíte várias vezes para excluir dependência de timing.

## Task 6: Expor upload e signed URL autorizados no BFF

**Files:**

- Modify: `apps/bff/src/routes/profiles.ts`
- Modify: `apps/bff/src/routes/admin.ts`
- Modify: `apps/bff/src/types.ts` (se necessário)
- Create: `apps/bff/src/__tests__/profile-photo-routes.test.ts`

**Steps:**

- [ ] Escrever testes vermelhos para self, staff same-tenant, user third-party, cross-tenant, superadmin, alvo inexistente e resposta sem foto.
- [ ] Escrever testes de multipart ausente, arquivo `>5 MiB`, MIME declarado falso e retorno de `photoPath` sem signed URL.
- [ ] Implementar `POST /api/profiles/me/photo`, `POST /api/profiles/:id/photo` e `GET /api/profiles/:id/photo-url`.
- [ ] Derivar path do banco no endpoint de assinatura; nunca aceitar bucket/path do cliente; retornar `Cache-Control: private, no-store`.
- [ ] Colocar `/api/admin/upload-photo` atrás de `PROFILE_PHOTO_LEGACY_UPLOAD_ENABLED`, processando para `legacy-staged/{uuid}.webp`; desligada, responder 410.
- [ ] Restringir `foto_url` no cadastro e no PATCH conforme a janela de compatibilidade da spec.

## Task 7: Criar cache client-side e componente único

**Files:**

- Create: `apps/web/src/lib/profile-photo-query.ts`
- Create: `apps/web/src/components/profile-avatar.tsx`
- Create: `apps/web/src/lib/profile-photo-query.test.tsx`
- Modify: `apps/web/src/components/providers.tsx`

**Steps:**

- [ ] Escrever teste com QueryClient real: dois avatares iguais fazem uma chamada; re-render/remount/focus/reconnect não refazem enquanto fresh.
- [ ] Escrever teste de novo path fazendo exatamente uma nova resolução.
- [ ] Escrever teste de mismatch A→B: URL não fica sob A, B é semeada e refresh ocorre no máximo uma vez.
- [ ] Escrever teste de `SIGNED_OUT`, troca A→B e `TOKEN_REFRESHED` do mesmo usuário.
- [ ] Implementar key `["profile-photo-url", profileId, photoPath]`, tempos e flags exatamente como a spec.
- [ ] Implementar fallback estável e higiene de sessão no QueryClient.

## Task 8: Remover signed URL do ciclo do layout e do perfil

**Files:**

- Modify: `apps/web/src/app/(dashboard)/layout.tsx`
- Modify: `apps/web/src/components/layout/app-shell.tsx`
- Modify: `apps/web/src/components/layout/header.tsx`
- Modify: `apps/web/src/app/(dashboard)/perfil/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/perfil/_profile-client.tsx`
- Modify: `apps/web/src/app/(dashboard)/efetivo/perfil/page.tsx`
- Modify: `apps/web/src/app/api/profiles/photo/route.ts`
- Create: `apps/bff/src/__tests__/profile-photo-static-harness.test.ts`

**Steps:**

- [ ] Escrever guarda estática vermelha contra `resolvePhotoUrl`/preload no layout e assinaturas server-side de perfil.
- [ ] Alterar o layout para passar `userId` e `photoPath`, sem URL e sem preload.
- [ ] Migrar Header e páginas de perfil para `ProfileAvatar`.
- [ ] Fazer upload novo chamar o BFF e atualizar o path; não enviar mais `foto_url` no PATCH.
- [ ] Transformar o Route Handler Edge legado em proxy fino, sem Storage/service role/processamento.
- [ ] Executar testes unitários e typecheck dos dois apps.

## Task 9: Migrar listas, dialogs e relatórios sem prefetch oculto

**Files:**

- Modify: `apps/web/src/app/(dashboard)/admin/usuarios/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/admin/usuarios/_users-table.tsx`
- Modify: `apps/web/src/app/(dashboard)/admin/usuarios/_edit-dialog.tsx`
- Modify: `apps/web/src/app/(dashboard)/admin/usuarios/_cadastrar-militar-dialog.tsx`
- Modify: `apps/web/src/app/(dashboard)/reserva/militares/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/reserva/militares/_militares-table.tsx`
- Modify: `apps/web/src/app/(dashboard)/reserva/solicitacoes/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/reserva/solicitacoes/_solicitacoes-client.tsx`
- Modify: `apps/web/src/app/(dashboard)/reserva/saidas/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/reserva/saidas/_saidas-client.tsx`
- Modify: `apps/web/src/app/(dashboard)/reserva/saidas/_desarmamento-modal.tsx`
- Modify: `apps/web/src/components/reports/relatorio-detail-table.tsx`
- Modify: `apps/bff/src/__tests__/profile-photo-static-harness.test.ts`

**Steps:**

- [ ] Ampliar guarda estática para falhar com `resolvePhotosInBulk`, `resolvePhotoUrl` operacional, assinatura invisível em solicitações e imagens diretas de `foto_url`.
- [ ] Preservar `profileId + photoPath` brutos nas páginas servidoras.
- [ ] Montar `ProfileAvatar` somente nas linhas/páginas visíveis; dialogs reutilizam a mesma key.
- [ ] Remover `foto_url` de solicitações onde não há renderização.
- [ ] Inverter cadastro administrativo: criar perfil primeiro, enviar foto depois e exibir falha parcial sem repetir cadastro.
- [ ] Manter `resolvePhotoUrl` apenas para `material-photos` e o Nexus fora desta entrega.

## Task 10: Criar dry-run ativo e relatório read-only de órfãos

**Files:**

- Create: `apps/bff/scripts/migrate-active-profile-photos.ts`
- Create: `apps/bff/scripts/report-profile-photo-orphans.ts`
- Create: `apps/bff/src/__tests__/profile-photo-scripts.test.ts`

**Steps:**

- [ ] Escrever testes vermelhos de argumentos: dry-run padrão; apply somente com as duas confirmações; relatório sem opção destrutiva.
- [ ] Injetar adaptadores e provar zero chamadas de upload/update/remove no dry-run.
- [ ] Implementar inventário ativo, download/processamento em memória e resumo JSON.
- [ ] Implementar apply com o mesmo serviço CAS, sem executá-lo nesta tarefa.
- [ ] Implementar relatório de órfãos estritamente read-only.
- [ ] Executar o dry-run real autorizado e guardar a saída; não executar `--apply`.

## Task 11: Validação integrada e Network depois

**Files:**

- Modify: `apps/web/e2e/profile-photo-network.spec.ts`
- Create: `artifacts/storage-egress/network-after.json`
- Create: `artifacts/storage-egress/diff-summary.md`

**Steps:**

- [ ] Executar BFF tests, web unit tests, typechecks, build e `git diff --check`.
- [ ] Executar lint, registrar zero erros e confirmar total `<=88` sem warnings novos nos arquivos alterados.
- [ ] Executar Playwright visual aplicável.
- [ ] Executar Network pós-implementação com os mesmos cenários e ambiente do baseline.
- [ ] Comparar requests de assinatura, GETs, bytes, URLs únicas e cache; não comparar ambientes incompatíveis.
- [ ] Inspecionar o diff real e documentar arquivos, linhas e mudanças de contrato.

## Task 12: Code review obrigatório, correções e fechamento

**Files:**

- Review: todo o diff desde `7da9688`
- Modify: arquivos apontados pelo review, se necessário

**Steps:**

- [ ] Invocar exatamente um subagente code reviewer com o mandato completo do `CLAUDE.md`: bugs, escala, segurança, testes, práticas, edge cases e regressões.
- [ ] Exigir severidade, cenário concreto, arquivo/linha, nota e evidência para cada achado.
- [ ] Validar tecnicamente cada sugestão antes de aplicar.
- [ ] Corrigir todos os achados CRÍTICOS e ALTOS por TDD; repetir review se houver qualquer um.
- [ ] Reexecutar a matriz integral de verificação após a última correção.
- [ ] Confirmar nota `>=9,5/10`, sem CRÍTICO/ALTO.
- [ ] Somente então criar o commit de produção.
- [ ] Entregar relatório final em 14 seções, destacando diff real, testes de concorrência e Network antes/depois.
