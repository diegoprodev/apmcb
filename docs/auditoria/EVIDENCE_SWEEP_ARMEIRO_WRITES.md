# Varredura — rotas de escrita guardadas por armeiro (somente auditoria)

Data: 2026-10-02. Nenhum código de produção foi alterado; achados registrados em `REMEDIATION_LEDGER.md` (R-54..R-58).

## Metodologia
- Heurística (Python) sobre `apps/bff/src/routes/*.ts`: rotas não-GET com `roleGuard` contendo `armeiro` (58 rotas), seguida de leitura manual das suspeitas.
- Critérios por rota: (1) exige turno ativo (`requireActiveShift`/gate inline)? (2) o turno é checado contra a reserva alvo? (3) a escrita é confinada à reserva da sessão (`canAccessResourceReserve`/`scopedReserveIds`/filtro `reserve_id`)?
- Limitações: análise estática; nenhum teste contra banco real/produção; UI não rastreada por completo; arquivos em WIP (cautelamentos, saidas, shifts, biometria) apenas lidos.

## Resultado por grupo
| Arquivo | Rotas | Turno | Reserva do turno | Confinamento | Classificação |
|---|---|---|---|---|---|
| `lendings.ts` | POST / (e afins) | sim (inline) | igual à reserva do corpo | `assertActorReserveAccess` | OK |
| `arsenal.ts` | POST /requests, PATCH /items/:id/ocorrencia | sim | sim (R-50) | sim (R-48) | OK (corrigido) |
| `categories.ts`, `ocorrencias.ts` | requests/edit-request, PATCH /:id | sim | sim (R-50) | R-53 em aberto | OK exceto R-53 |
| `handovers.ts` | POST, assign-entry, sign-*, report-divergence | não | — | sim (R-40/42/43) | pergunta de produto (R-58) |
| `profiles.ts` | PATCH, status | n/a | n/a | tenant | OK |
| `reserves.ts` | switch | n/a | n/a | exige membership | OK |
| `shifts.ts` | open/log/close | n/a | n/a | posse do turno (`armeiro_id`) | OK |
| `biometric*`, `totp.ts` | autenticação | n/a | n/a | n/a | fora de escopo |
| `signatures.ts` | POST / | não | n/a | **nenhum sobre o documento** | **R-54 ALTO** |
| `ssa.ts` | POST /modo-a | **não** | — | tenant + reserveId | **R-55 MÉDIO** |
| `inventory.ts` | check | não | — | lookup, UPDATE por id | R-56 BAIXO |
| `saidas.ts` | sign-armeiro, confirm | não | — | só tenant | R-57 BAIXO (WIP) |
| `admin.ts`, `arsenal.ts` | upload de foto | n/a | n/a | sem reserva | R-58 (produto) |
| `cautelamentos.ts` | vários | parcial | falsy-target (R-50 residual) | R-49 | já registrado |

## Achados
- **R-54** `POST /api/signatures` — nenhuma validação do documento (existência/tenant/reserva/autoridade); hash sobre `document_data` do cliente; a assinatura é imutável. Confiança ~8/10 (uso pela UI a confirmar).
- **R-55** `POST /api/ssa/modo-a` sem gate de turno.
- **R-56/R-57** escopo fraco em rotas legadas/secundárias (BAIXO).
- **R-58** perguntas de produto (não são defeitos confirmados).

Nenhum item foi corrigido nesta etapa, conforme solicitado.
