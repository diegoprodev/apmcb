# D-05 — importação de usuários (CSV/XLSX), adicionar à reserva e filtro "sem reserva"

Data: 2026-10-02. Sem produção, sem migration, sem deploy.

## Implementado
| Camada | Mudança |
|---|---|
| BFF `routes/militares-import.ts` (novo) | `GET /api/admin/reserve-targets` (reservas onde o chamador pode adicionar membros + reserva oficial; `admin_state`); `POST /api/admin/militares/import` (≤200 linhas por requisição; nome ≥2, e-mail válido, matrícula; reserva opcional); `POST /api/admin/militares/:id/add-to-reserve`; `GET /api/admin/militares/sem-reserva` |
| BFF `routes/admin.ts` | cadastro de militar e envio de acesso extraídos em `provisionMilitar`/`provisionAccess` (mesmo comportamento; reaproveitados pelo import); `provisionMilitar` aceita reserva já autorizada ou nenhuma e grava o e-mail de contato |
| Web | botão **Importar** (lê .csv/.xlsx no navegador com `xlsx`, valida colunas mínimas, escolhe a reserva, mostra resultado por linha), filtro **Sem reserva (N)** com dropdown **Adicionar à reserva**, modelo CSV para baixar; **Exportar** oculto para armeiro (`canExport`) |

Regras: o usuário importado entra como `usuario`; com reserva → vira membro e o convite sai automaticamente (falha de e-mail não desfaz o cadastro: `created_invite_failed`); sem reserva → só o perfil, sem convite. Autoridade: `admin_global` = todas as reservas ativas do tenant; `admin_reserva` = as que administra; armeiro = as de que é membro; reserva fora disso/de outro tenant/inexistente → 400 igual (sem oráculo). Reserva com convite do admin pendente/sem admin ativo → 409 amigável (`pending_invite`/`no_admin`, D-04). Linhas problemáticas viram status por linha (`exists`, `email_in_use`, `duplicate_in_file`, `blocked`, `error`) sem derrubar o lote. Toda negação/falha deixa log; auditoria `admin.militares.imported` e `admin.militar.added_to_reserve`.

## Verificação
- BFF integração `militares-import.test.ts` (15, handlers reais; GoTrue/Resend simulados): reservas por papel, import com/sem reserva, convite automático, autoridade, D-04, linhas problemáticas, falha de e-mail, validação, add-to-reserve (convite/ativa/sem e-mail/já membro/não militar/outro tenant), sem-reserva, papéis fora. Mutações detectadas: autoridade (import e add), alvo `global`, convite real, já-membro, alvo staff, tenant do filtro; **equivalente**: remover o pré-check de matrícula (a checagem de `provisionMilitar` produz o mesmo resultado).
- Web: parser (6), diálogo (6), painel (5), página (+1); mutações: `canExport`, coluna e-mail, reserva padrão, desabilitar reserva pendente.
- Suítes: BFF unit 695, integração 397, web 395; `tsc`, `lint:logs`, `git diff --check` limpos.

## Limitações
- `GET /militares/sem-reserva` é tenant-wide para os 3 papéis (decisão do dono: armeiro/admin da reserva "idem"); teto de 2000 resultados (falha alto).
- O import grava o e-mail em `profiles.email` no cadastro; o e-mail de acesso real só vai para o login no `enviar-acesso` (convite). Sem reserva, nenhum convite sai.
- Escala: import sequencial (cada linha cria usuário e envia e-mail); lote de 200 por requisição, o navegador envia em blocos.
- Rota legada do Next (`apps/web/src/app/api/admin/users`) segue fora (R-59). E2E (Playwright) não executado: só roda contra produção.

## Revisão (code + segurança) — 0 CRÍTICO, 1 ALTO e 6 MÉDIO corrigidos
- **A1 (escala/timeout):** blocos de 20 linhas por requisição no navegador (BFF aceita até 50); linhas com convite falho em âmbar + aviso; arquivo ≤5 MB e ≤5.000 linhas no navegador.
- **M1 (oráculo entre tenants):** pré-checagem de matrícula/e-mail restrita ao tenant do chamador; colisão fora do tenant volta como `error` genérico (log `admin.militares_import.row_failed`).
- **M2 (injeção de fórmula):** nome/posto que começam com `= + - @ \t \r` são recusados no import (servidor e navegador); exportações CSV/XLSX passam por `sanitizeCell` (apóstrofo) — corrige também o risco pré-existente em relatórios.
- **M3:** validação por linha (uma linha ruim não derruba o bloco); parser web espelha limites (nome 200, posto 60, e-mail 254).
- **M4:** `add-to-reserve` só para militar SEM reserva (409 se já é membro de outra); 23505 concorrente → 409.
- **M5:** o painel "Sem reserva" só consulta o BFF quando aberto; continua tenant-wide (decisão do dono) — rever se armeiro deve ver e-mails.
- **M6:** `provisionMilitar` devolve `membership_ok`; vínculo falho → linha `created_invite_failed` sem convite.
- Aceitos/BAIXOS: heurística de status 409 (agora só `code` de D-04 vira `blocked`), colisão `12-3`/`123` no e-mail interno (pré-existente), `xlsx@0.18.5` com CVEs conhecidos (migrar para build do SheetJS CDN/exceljs — pendente), sem teste de concorrência real.
- Suítes: BFF unit 695, integração 400, web 397.
- Re-revisão: 0 CRÍTICO/0 ALTO. MÉDIOS fechados: mensagem FIXA de convite falho (sem repassar o erro do envio — fechava o oráculo de e-mail entre tenants); linhas não processadas por falha no meio dos blocos aparecem como "Não processado" com aviso; teto do arquivo = 2.000 linhas (= teto da lista "Sem reserva"). BAIXOS: matrícula não pode começar com `-`; posto vazio → null; reabrir o painel tenta de novo após falha. Pendentes aceitos: lista "Sem reserva" sem paginação/busca e checagem por N/50 queries (RPC `NOT EXISTS` exigiria migration), `-`/`+` iniciais em texto livre saem com apóstrofo nas exportações (trade-off OWASP), `xlsx@0.18.5`.
