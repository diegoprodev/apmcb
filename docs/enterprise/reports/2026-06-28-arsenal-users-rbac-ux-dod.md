# DoD - Arsenal, usuarios e RBAC UX (2026-06-28)

Escopo validado contra `docs/enterprise/07-canonical-definition-of-done.md`:

- Almoxarifado exibe `Materiais` e `Categorias` no topo para `admin_reserva` e `armeiro`.
- Modal de adicionar/solicitar material foi ampliado e compactado para reduzir scroll operacional.
- Dropdown de categoria mantem botao de seta explicito e criacao rapida por `+`.
- Header carrega foto de perfil com `img` nativo, `loading=eager` e `fetchPriority=high`.
- `/admin/usuarios` aceita `admin_reserva`, reutiliza SearchInput/autocomplete existente e passa o callerRole real aos dialogs.
- Cadastro de militar permite perfil inicial `usuario` ou `armeiro`; `armeiro` so fica disponivel para `admin_reserva`.
- Endpoints `/api/admin/militares` e `/api/admin/search-profiles` foram alinhados ao RBAC atual.

Validacao local executada:

- `pnpm typecheck` OK.
- `pnpm lint` OK com warnings preexistentes, sem erros.
- `pnpm --filter web build` OK.

Validacao E2E adicionada:

- `arsenal-profile-feedback.spec.ts` cobre seta do dropdown de categoria.
- `arsenal-profile-feedback.spec.ts` cobre busca/autocomplete em usuarios e modal Cadastrar Militar com perfil inicial.
