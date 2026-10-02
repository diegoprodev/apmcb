# D-03 — `admin_global` somente leitura sobre material e movimentação (classificação, sem código)

Data: 2026-10-02. Fonte: levantamento estático dos `roleGuard` de rotas não-GET que incluem `admin_global` em `apps/bff/src/routes`.

## A. Remover `admin_global` (material / movimentação — clara)
| Arquivo | Rotas |
|---|---|
| `arsenal.ts` | `PATCH /items/:id/ocorrencia` |
| `lendings.ts` | `POST /`, `/batch`, `/bulk-return`, `/identify`, `PATCH /:id/return` |
| `handovers.ts` | `POST /`, `/:id/sign-exit`, `/:id/assign-entry`, `/:id/sign-entry`, `/:id/report-divergence` |
| `ssa.ts` | `PATCH /requests/:id/deliver`, `POST /modo-a` (entregas) |
| `cautelamentos.ts` (**WIP — só depois**) | `POST /`, `/batch`, sign-*, `/:id/return`, `/:id/cancel`, `PATCH /:id`, `/:id/vencimento-snooze`, `/:id/substitute` |
| `saidas.ts` (**WIP — só depois**) | `POST /`, `/:id/sign-armeiro`, `PATCH /:id/return` |
| `inventory.ts` | `POST /reserve-checks/:id/items/:iid/check` |

Web: remover botão/ação de escrita para `admin_global` (ex.: `RegistrarOcorrenciaButton` em `/admin/arsenal/manutencao`, `_aprovacao-client`, `_cautelas-client`, `reserva/passagens/[id]/_detail`).

## B. Ambíguas — precisam de decisão do dono do produto
- Aprovar/rejeitar solicitações de material: `arsenal.ts /requests/:id/approve|reject`, `categories.ts /requests/:id/approve|reject`, `ssa.ts /requests/:id/approve|reject` (decisão de gestão ou movimentação?).
- Inventário (campanhas): `inventory.ts /campaigns`, `/start`, `/close`, `/reserve-checks/:id/assign|sign` (gestão/auditoria, não altera material diretamente).
- Assinaturas: `signatures.ts POST /` e `/:id/revoke` (R-54).
- Biometria: `devices/pair|revoke`, `pairing-codes`, `challenges*`, `identify`, `register` (WIP).

## C. Mantêm `admin_global` (administração, D-03)
`admin.ts` (convites, `enviar-acesso`, `email-change`, `org-units`, `reserves`, `branding`), `profiles.ts` (`PATCH /:id`, `/:id/status`, foto de perfil), `reserves.ts` (`switch`, `settings`), `totp.ts`.

## Observações
- Uploads de foto de item (`arsenal.ts /material-photo`) alteram material: classificar em A.
- `requireActiveShift` já não cobre admin_global; passa a ser irrelevante para ele nas rotas de A.
- Mudança de comportamento: remove capacidade existente — exige teste por rota (admin_global → 403 + log) e ajuste dos testes que hoje afirmam o contrário.
