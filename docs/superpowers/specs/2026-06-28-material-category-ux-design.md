# Material Category UX Design Spec

Data: 2026-06-28

## Contexto

O fluxo atual de adicionar material ficou operacionalmente correto, mas ruim de usar: categoria e apenas texto, os inputs ocupam largura demais, as regras aparecem por inferencia fraca e categorias digitadas nao ficam reaproveitaveis no seletor. Isso quebra Hick, Miller e Postel: o usuario precisa adivinhar o que o sistema entendeu, ve muitos campos com peso igual e nao recebe uma criacao guiada de categoria.

## Objetivo

Transformar categoria de material em entidade reutilizavel e configuravel, mantendo criacao rapida no formulario e adicionando uma aba de categorias no almoxarifado. Ao selecionar ou criar uma categoria, o formulario deve mostrar apenas os campos relevantes para aquela categoria.

## Decisoes de UX

### Estrutura

- O almoxarifado ganha navegacao contextual por abas:
  - `Materiais`: inventario atual, KPIs, busca, filtros e botao de adicionar material.
  - `Categorias`: lista compacta de categorias da reserva, com botao para criar/editar categoria.
- O formulario de material usa um painel compacto de ate 3 blocos:
  - `Identificacao`: nome, quantidade, categoria e foto.
  - `Campos operacionais`: campos que dependem da categoria.
  - `Unidades fisicas`: aparece apenas quando a categoria exige validade ou numero de serie.
- O campo de categoria vira um seletor-criador:
  - seta/dropdown lista categorias existentes;
  - busca por digitacao;
  - botao `+` cria categoria sem sair do formulario;
  - depois de criada, a categoria entra na lista imediatamente.

### 5 leis de UX

- `Fitts`: botao `+` de categoria e CTA principal com hit area minima de 44px; a acao primaria fica no rodape do dialog.
- `Hick`: campos extras aparecem somente depois da categoria; nenhuma grade de campos gigantes com peso igual.
- `Doherty`: criacao de categoria e salvamento de material mostram estado carregando e toast imediato.
- `Miller`: formulario dividido em grupos curtos; no maximo 5-7 decisoes visiveis por bloco.
- `Postel`: o sistema aceita digitacao livre, normaliza slug e aplica presets por palavras como `colete`, `balistico`, `arma`, `veiculo`, `radio`.

## Modelo de categoria

A tabela existente `material_categories` sera estendida. A categoria passa a guardar o comportamento padrao:

- `slug`: identificador normalizado.
- `description`: texto opcional interno.
- `requires_caliber`: exige calibre.
- `requires_validity`: exige validade por unidade.
- `default_has_serial_numbers`: liga numero de serie por padrao.
- `validity_alert_days`: marcos permitidos, padrao `[365, 180, 90]` quando exige validade.
- `requires_vehicle_fields`: exige campos de veiculo.
- `active`: permite desativar sem apagar historico.

Presets automaticos:

- `Arma`: `requires_caliber=true`, `default_has_serial_numbers=true`.
- `Colete` ou `Colete balistico`: `requires_validity=true`, `default_has_serial_numbers=true`, alertas `[365,180,90]`.
- `Radio`: `default_has_serial_numbers=true`.
- `Veiculo`: `requires_vehicle_fields=true`, `default_has_serial_numbers=false`.
- Outros: nenhum campo obrigatorio extra.

## Modelo de material

`material_types` sera estendido para campos de veiculo:

- `vehicle_plate`
- `vehicle_color`
- `vehicle_year`
- `vehicle_model`

Para veiculos, placa e modelo sao obrigatorios. Cor e ano sao opcionais, mas ano deve estar entre 1900 e ano atual + 1 quando informado.

## Fluxo por papel

- `admin_reserva`: pode criar/editar/desativar categorias da sua reserva e criar material direto.
- `armeiro`: pode criar uma categoria dentro da solicitacao, mas ela fica dentro do payload da solicitacao; ao aprovar, o `admin_reserva` materializa a categoria e o material.
- `admin_global`: visualiza almoxarifado, sem mutacao direta de material ou categoria interna.
- `superadmin`: fora da gestao interna de materiais.

## API e persistencia

- BFF `GET /api/categories`: lista categorias do tenant/reserva.
- BFF `POST /api/categories`: cria categoria para `admin_reserva`.
- BFF `PATCH /api/categories/:id`: edita categoria para `admin_reserva`.
- BFF `DELETE /api/categories/:id`: desativa categoria se nao houver material ativo usando a categoria.
- API web `/api/admin/almoxarifado`: passa a aceitar `category_id` e campos de veiculo.
- BFF `/api/arsenal/requests`: aceita `category` no payload de material; approval cria categoria faltante antes de inserir `material_types`.

## UI detalhada

### Aba Materiais

- Header: titulo, subtitulo e duas acoes no maximo: `Adicionar material` e `Categorias`.
- Abas sob o header: `Materiais` e `Categorias`.
- O botao de adicionar aparece apenas para `admin_reserva`.

### Dialog de material

- Largura controlada: `max-w-3xl`, sem inputs full-width gigantes em desktop.
- Grid responsivo:
  - desktop: nome 2 colunas, quantidade 160px, categoria + botao compacto.
  - mobile: 1 coluna.
- Categoria:
  - input com dropdown filtravel;
  - botao iconico `+` abre mini form de categoria;
  - categorias novas aparecem no dropdown imediatamente.
- Campo de foto:
  - preview 56px;
  - botao discreto para selecionar arquivo/camera;
  - sem input nativo largo visualmente dominante.

### Dialog de categoria

Campos:

- Nome
- Descricao opcional
- Checkboxes:
  - Exige calibre
  - Controla numero de serie por padrao
  - Exige validade
  - Exige campos de veiculo
- Quando validade ativa: checkboxes 1 ano, 6 meses, 90 dias.
- Quando veiculo ativa: preview dos campos obrigatorios placa/modelo.

## Testes de aceite

- Criar categoria `Coletes balisticos` no formulario faz aparecer validade, alertas e numero de serie.
- Categoria criada aparece no dropdown/seta sem recarregar a pagina.
- Aba `Categorias` permite listar e criar categoria com presets.
- Ao selecionar `Veiculo`, o formulario mostra placa, modelo, cor e ano.
- Salvar veiculo sem placa/modelo falha com mensagem clara.
- `admin_global` nao ve botao de criacao/edicao de categoria.
- Playwright em producao valida botao do armeiro, categoria rapida, veiculo e cautelas sem regressao.

## Fora de escopo

- Inventario individual por placa no modulo de saidas.
- Alertas especificos para licenciamento de veiculo.
- Importacao em massa de categorias.

## Risco e rollback

- Risco principal: category_id nulo em materiais antigos. Mitigacao: manter `categoria` e `categoria_slug` como fallback e backfill via migration.
- Rollback: remover uso de `category_id` na UI/API mantendo colunas novas sem impacto; categorias continuam apenas como catalogo auxiliar.
