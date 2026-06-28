# Spec - Materiais: categorias livres, metadados por tipo, validade e alertas

Data: 2026-06-28
Status: SPEC aguardando aprovacao antes de implementacao
Escopo: almoxarifado/arsenal, pedidos de armeiro, aprovacao por admin da reserva, notificacoes e relatorios

## 1. Contexto lido

- `docs/journeys/README.md`
- `docs/journeys/armeiro-journey.md`
- `docs/journeys/admin-reserva-journey.md`
- `docs/journeys/admin-global-journey.md`
- `docs/journeys/superadmin-journey.md`
- `docs/journeys/usuario-journey.md`
- `docs/enterprise/07-canonical-definition-of-done.md`
- `apps/web/src/app/(dashboard)/admin/arsenal/_material-dialog.tsx`
- `apps/web/src/components/arsenal/material-detail-sheet.tsx`
- `apps/web/src/app/(dashboard)/reserva/arsenal/page.tsx`
- `apps/bff/src/routes/arsenal.ts`
- `apps/bff/src/routes/notifications.ts`
- `apps/web/src/app/api/admin/almoxarifado/route.ts`
- `apps/web/src/app/(dashboard)/admin/relatorios/_filter-panel.tsx`
- `apps/web/src/app/(dashboard)/reserva/relatorios/_filter-panel.tsx`
- `supabase/migrations/20260620000001b_material_items.sql`
- `supabase/migrations/20260627000002_material_photos_arsenal_rbac.sql`

## 2. Estado atual relevante

- `material-photos` ja existe como bucket publico para fotos de material.
- `material_types` e o catalogo: nome, categoria, quantidade, descricao, foto e escopo tenant/reserva.
- `material_items` ja existe para unidade fisica: numero de serie, validade, descricao adicional e posse ativa.
- O admin da reserva pode gerir diretamente material pela UI de `/reserva/arsenal`.
- O armeiro cria `admin_approval_requests` e a aprovacao deve ir somente para `admin_reserva`.
- Relatorios hoje filtram por material, militar, posto, data e status; nao ha filtro de categoria/calibre.

## 3. Decisoes de dominio

1. Superadmin nao gerencia dados internos de reserva. Fica restrito a tenants, saude global e branding/sistema.
2. Admin global nao aprova solicitacao de armeiro. O teto de aprovacao operacional e `admin_reserva`.
3. Admin da reserva pode adicionar, editar e desativar material diretamente dentro da sua reserva.
4. Armeiro pode solicitar adicao, ajuste e desativacao; nada muda no estoque ate o admin da reserva aprovar.
5. Categoria passa a ser texto livre na UI e no contrato. O sistema tambem salva um `categoria_slug` normalizado para regra e filtro.
6. `material_types` guarda regras do catalogo; `material_items` guarda dados por unidade fisica.
7. Notificacao para "usuario" significa o militar que estiver com posse ativa do item. Se o item estiver na reserva, notificam apenas armeiros e admins da reserva.
8. Colete e identificado por `categoria_slug = 'colete'`, derivado de texto normalizado que contenha "colete".
9. Arma e identificada por `categoria_slug = 'arma'`, derivado de categoria igual/normalizada como "arma", "armas" ou texto configurado como arma.

## 4. Requisitos funcionais

### RF01 - Categoria personalizada

- Formulario de adicionar material deve aceitar categoria como texto livre.
- Deve manter sugestoes rapidas: Arma, Colete, Radio, Equipamento, Farda, Acessorio, Outro.
- Categoria digitada deve ser preservada como display em `categoria`.
- `categoria_slug` deve ser salvo normalizado para filtros e regras.

### RF02 - Descricao opcional

- Todo material deve ter campo `descricao` opcional.
- O campo deve ser aceito em criacao direta, edicao e solicitacao de armeiro.
- Deve aparecer no detalhe do material quando preenchido.

### RF03 - Numero de serie opcional

- Formulario deve ter checkbox `Controlar numero de serie`.
- Quando marcado:
  - se quantidade total for 1, exibir um campo de numero de serie;
  - se quantidade total for maior que 1, exibir lista compacta de unidades para preencher um numero por unidade.
- Os numeros de serie ficam em `material_items.numero_serie`.
- A validacao deve impedir duplicidade por tenant quando o numero for preenchido.

### RF04 - Colete com validade obrigatoria

- Ao selecionar/digitar categoria de colete, o formulario deve automaticamente habilitar validade.
- Para colete, validade e obrigatoria por unidade fisica.
- Se quantidade total for maior que 1, a UI deve permitir:
  - aplicar uma validade padrao para todas as unidades;
  - ajustar validade individual quando necessario.

### RF05 - Alertas configuraveis de validade

- Para material com validade, alertas devem aceitar os marcos:
  - 365 dias;
  - 180 dias;
  - 90 dias.
- UI deve exibir esses tres checks ja marcados por padrao para colete.
- O catalogo deve salvar os marcos em `validity_alert_days`.
- O job de alerta deve criar uma notificacao quando a validade entrar em cada janela configurada.

### RF06 - Arma com calibre obrigatorio

- Ao selecionar/digitar categoria de arma, campo `calibre` aparece e e obrigatorio.
- O BFF e a API Next devem rejeitar arma sem calibre com 400/422.
- O calibre deve ser salvo em `material_types.calibre`.

### RF07 - Fotos

- Reaproveitar bucket `material-photos`.
- Upload/camera continuam opcionais.
- A foto deve funcionar tanto em criacao direta quanto em solicitacao de armeiro.

### RF08 - Fluxo de armeiro

- Armeiro ve botao `Adicionar Material` em `/reserva/arsenal`.
- Ao enviar, cria solicitacao `material_addition` com todos os metadados: categoria, categoria_slug, descricao, calibre, foto, validade, serializacao e alertas.
- Admin da reserva aprova em `/admin/arsenal/solicitacoes`.
- Ao aprovar, sistema cria/atualiza `material_types` e cria os `material_items` quando houver numero de serie, validade ou controle por unidade.
- Aprovacao gera notificacao para o armeiro solicitante.

### RF09 - Fluxo admin da reserva

- Admin da reserva adiciona diretamente com os mesmos campos.
- Admin da reserva desativa diretamente quando nao houver unidade em uso.
- Toda criacao/edicao/desativacao gera auditoria.

### RF10 - Notificacoes

- Ao chegar em cada marco de validade, criar notificacao `material_validity_warning`.
- Destinatarios:
  - admins da reserva;
  - armeiros da reserva;
  - usuario/militar atual se `material_items.current_holder_user_id` estiver preenchido.
- Deduplicar por `material_item_id + alert_days + validade_item`.

### RF11 - Relatorios com categoria e calibre

- Relatorios admin e reserva devem ter filtro de categoria.
- Ao selecionar categoria de arma, mostrar filtro de calibre.
- Query deve aceitar `categoria`/`categoria_slug` e `calibre`.
- Tabelas e exportacao devem incluir calibre quando houver.

## 5. Modelo de dados proposto

### Migration nova

Arquivo sugerido: `supabase/migrations/20260628000002_material_metadata_alerts.sql`

```sql
ALTER TABLE public.material_types
  ADD COLUMN IF NOT EXISTS categoria_slug TEXT,
  ADD COLUMN IF NOT EXISTS calibre TEXT,
  ADD COLUMN IF NOT EXISTS has_serial_numbers BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_validity BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS validity_alert_days INTEGER[] NOT NULL DEFAULT '{}';

ALTER TYPE public.notification_type_enum
  ADD VALUE IF NOT EXISTS 'material_validity_warning';

CREATE TABLE IF NOT EXISTS public.material_validity_alert_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reserve_id UUID REFERENCES public.reserves(id) ON DELETE CASCADE,
  material_item_id UUID NOT NULL REFERENCES public.material_items(id) ON DELETE CASCADE,
  alert_days INTEGER NOT NULL CHECK (alert_days IN (90, 180, 365)),
  validade_item DATE NOT NULL,
  notification_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (material_item_id, alert_days, validade_item)
);
```

### Constraints e indices

- Indice em `material_types(tenant_id, reserve_id, categoria_slug)`.
- Indice em `material_types(tenant_id, calibre)` onde `calibre IS NOT NULL`.
- Constraint:
  - se `categoria_slug = 'arma'`, `calibre` nao pode ser nulo/vazio;
  - se `requires_validity = true`, itens criados devem possuir `material_items.validade_item`.
- Confirmar se `material_types.categoria` ainda e enum no banco aplicado; se for enum, migrar para `TEXT` antes de aceitar categoria livre.

## 6. Contratos de API

### POST/PATCH `/api/admin/almoxarifado`

Entrada nova:

```ts
{
  nome: string;
  categoria: string;
  categoria_slug?: string;
  quantidade_total: number;
  descricao?: string | null;
  calibre?: string | null;
  has_serial_numbers?: boolean;
  requires_validity?: boolean;
  validity_alert_days?: number[];
  photo_url?: string | null;
  photo_storage_path?: string | null;
  items?: Array<{
    numero_serie?: string | null;
    validade_item?: string | null;
    descricao_adicional?: string | null;
  }>;
}
```

Regras:

- `admin_reserva` pode mutar somente material da propria reserva.
- `admin_global` nao aprova solicitacao de armeiro e nao deve mutar reserva sem membership de admin da reserva.
- `superadmin` recebe 403 em dados internos de reserva.
- Input validado com Zod ou schema equivalente.

### POST `/api/arsenal/requests`

`material_addition.batch[]` passa a aceitar os mesmos campos do contrato acima.

Regras:

- `armeiro`: cria solicitacao pendente.
- `admin_reserva`: pode usar rota direta; se usar requests, ainda so aprova dentro da propria reserva.
- Aprovacao aplica automaticamente o payload aprovado no sistema.

### Job de validade

Endpoint interno sugerido:

- `POST /api/arsenal/validity-alerts/run`
- Protecao por `CRON_SECRET` ou worker/service role.
- Pode ser acionado por Cloudflare Cron/Supabase cron.
- Consulta itens com `validade_item` dentro das janelas configuradas e cria notificacoes deduplicadas.

## 7. UI/UX

### Principios

- Manter identidade visual atual Athena.
- Menos e mais: campos aparecem somente quando fazem sentido.
- Nao criar nova tela se o sheet/modal existente atende.
- Usar controles familiares:
  - combobox/input para categoria;
  - checkbox para numero de serie;
  - date input para validade;
  - checkboxes para alertas;
  - select/input para calibre.

### Comportamento do formulario

Campos sempre visiveis:

- Nome
- Categoria
- Quantidade
- Foto opcional
- Descricao opcional

Campos condicionais:

- Categoria arma: calibre obrigatorio.
- Categoria colete: validade obrigatoria e alertas visiveis.
- Checkbox numero de serie marcado: campos de serie por unidade.

Microcopy:

- Botao admin reserva: `Adicionar material`.
- Botao armeiro: `Solicitar aprovacao do admin da reserva`.
- Erro arma sem calibre: `Informe o calibre da arma.`
- Erro colete sem validade: `Informe a validade do colete.`

## 8. Relatorios

Alterar admin e reserva:

- Select de materiais deve buscar `id, nome, categoria, categoria_slug, calibre`.
- Filtro categoria fica em filtros avancados.
- Filtro calibre aparece quando categoria selecionada tiver slug `arma`.
- Query aplica:
  - `material_types.categoria_slug = categoria` ou filtro equivalente;
  - `material_types.calibre = calibre` quando informado.
- Exportacao CSV/PDF inclui coluna `Calibre`.

## 9. Testes obrigatorios

### Unitarios/integracao

- Normalizador transforma `Armas`, `arma`, `ARMAMENTO` configurado em `arma` quando aplicavel.
- Normalizador transforma `Colete Balistico` em `colete`.
- Validacao rejeita arma sem calibre.
- Validacao rejeita colete sem validade.
- Deduplicacao impede alerta duplicado para mesmo item/marco/validade.

### E2E Playwright

- Admin da reserva adiciona arma com calibre e ve material no almoxarifado.
- Admin da reserva tenta adicionar arma sem calibre e recebe erro.
- Admin da reserva adiciona colete, campo de validade aparece automaticamente, alertas 365/180/90 aparecem marcados.
- Armeiro solicita novo material com categoria customizada, admin da reserva aprova, material aparece no almoxarifado.
- Superadmin nao acessa mutacao interna de material.
- Relatorio exibe filtro categoria; ao escolher arma, filtro calibre aparece e filtra resultado.
- Notificacao de validade aparece para admin da reserva, armeiro e usuario com posse ativa.

### Regressao

- Login UI para perfis existentes continua verde.
- `/reserva/arsenal` continua exibindo botao `Adicionar Material` para armeiro.
- Fluxo de suporte nao regride.
- Cautelas nao devem piorar performance; validar pagina apos migrations/indices.

## 10. Plano de implementacao

1. Criar migration de metadados e eventos de alerta.
2. Criar helpers compartilhados de normalizacao/validacao de material.
3. Atualizar API Next `/api/admin/almoxarifado`.
4. Atualizar BFF `/api/arsenal/requests` e aprovacao.
5. Atualizar modais/sheets admin reserva e armeiro.
6. Atualizar listagem/detalhe de material.
7. Implementar job/endpoint de alertas de validade.
8. Atualizar filtros e exportacao de relatorios admin/reserva.
9. Criar testes unitarios/integracao e Playwright.
10. Rodar DoD completo, atualizar changelog, gerar relatorio final e so entao finalizar.

## 11. Definition of Done desta entrega

Base: `docs/enterprise/07-canonical-definition-of-done.md`.

| Criterio | Exigencia |
|---|---|
| G01 | Escopo implementado igual a esta spec aprovada |
| G02 | Nenhuma feature fora desta spec |
| G03 | UI preserva identidade Athena atual |
| G04 | Queries filtradas por tenant/reserve quando aplicavel |
| G05 | RBAC: superadmin/admin_global/admin_reserva/armeiro/usuario sem escalada |
| G06 | Criacao, edicao, aprovacao e desativacao auditadas |
| G08 | Nenhum token, senha ou dado sensivel em log |
| G09 | Endpoints mutaveis com validacao de entrada |
| G10 | Fluxos sensiveis com teste minimo |
| G11 | `pnpm --filter web build` verde |
| G12 | `pnpm typecheck` verde |
| G13 | `pnpm lint` sem erro |
| G14 | Suites aplicaveis verdes |
| G15 | Regressao Playwright verde |
| G16 | Smoke Chromium/producao verde antes de finalizar |
| G17 | Relatorio final criado em `docs/enterprise/reports/` |

## 12. Validacao final esperada

Comandos locais:

```bash
pnpm typecheck
pnpm lint
pnpm --filter web build
pnpm --filter bff typecheck
pnpm exec playwright test --project=arsenal-profile-feedback
pnpm exec playwright test --project=chromium
```

Validacao em producao Cloudflare:

```bash
$env:E2E_BASE_URL='https://apmcb.pmpb.online'
$env:E2E_BFF_URL='https://api.apmcb.pmpb.online'
pnpm exec playwright test --project=arsenal-profile-feedback -g "material metadata"
pnpm exec playwright test --project=arsenal-profile-feedback -g "relatorios calibre"
```

## 13. Riscos e pontos de atencao

- Confirmar tipo real de `material_types.categoria` no banco de producao antes de aplicar migration; se ainda for enum, a migration precisa converter para `TEXT`.
- O codigo atual inclui `admin_global` em mutacao direta de almoxarifado; a implementacao desta spec deve restringir conforme RBAC operacional.
- Validar Cloudflare Cron ou alternativa Supabase para execucao diaria do job de validade.
- Se a quantidade for alta, a UI de itens fisicos deve limitar renderizacao e oferecer importacao/edicao em lote em fase posterior.
