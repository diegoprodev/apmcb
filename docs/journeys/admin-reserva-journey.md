# Jornada do Admin Reserva (Master)

**Role:** `admin_reserva` (mapeado como `master` no frontend)  
**Contexto:** Administrador de uma reserva específica de armamento. Vê e opera apenas dentro do escopo de sua reserva (`reserve_id` armazenado em `user_reserve_preferences`). Gerencia o dia a dia operacional: saídas, cautelas, passagens, aprovações de SSA de armeiros da sua reserva.  
**Interface frontend:** `/reserva` — sidebar com 7 seções (mesma do armeiro, com mais permissões).

---

## ICP (Ideal Customer Profile)

- Tenente ou Sargento-Mor responsável por uma reserva de armamento de batalhão
- Opera diariamente com saídas e devoluções de material
- Tem autoridade para atribuir armeiro entrante em passagens de turno
- Escopo limitado à sua própria reserva

---

## Páginas Acessíveis

| Rota | Descrição |
|---|---|
| `/reserva` | Painel da reserva — cards de atalho com contagens em tempo real |
| `/reserva/arsenal` | Inventário completo da reserva |
| `/reserva/arsenal/manutencao` | Materiais danificados/perdidos/administrativo da reserva |
| `/reserva/saidas` | Lista de saídas de material (ativas + histórico) |
| `/reserva/saidas/nova` | Criar nova saída de material |
| `/reserva/cautelas` | Cautelas eletrônicas (ativas + histórico) |
| `/reserva/militares` | Busca biométrica + perfis de militares |
| `/reserva/relatorios` | Relatórios da reserva |
| `/reserva/solicitacoes` | Solicitações de estoque enviadas ao `admin_global` |
| `/reserva/ocorrencias` | Ocorrências reportadas na reserva |
| `/reserva/passagens` | Passagens de turno digital |

---

## Jornada Passo a Passo

### Cenário 1: Início de turno — receber passagem + operar a reserva

#### 1. Login

1. Acessa `/login` → insere email + senha
2. Sistema reconhece `role=admin_reserva` → redireciona para `/reserva`
3. Dashboard carrega cards de atalho com contagens em tempo real:
   - "8 Cautelas Ativas" → clica → vai para `/reserva/cautelas`
   - "0 Saídas em Atraso" → card verde
   - "1 Passagem Pendente" → clica → vai para `/reserva/passagens`

#### 2. Receber Passagem de Turno

1. Navega para `/reserva/passagens`
2. Vê passagem em status `aguardando_atribuicao`:

```http
GET /api/handovers
→ { handovers: [{ id, status: "aguardando_atribuicao", saindo: "Sgt. Costa", created_at }] }
```

3. Clica na passagem → ver detalhes com snapshot completo:

```http
GET /api/handovers/{id}
→ {
  handover: {
    status: "aguardando_atribuicao",
    report_snapshot: {
      reserve: { nome: "APMCB — Reserva Principal" },
      carga_total: { total: 120, por_tipo: [...] },
      cautelas_ativas: [{ id, material, militar, prazo }],
      saidas_ativas: [{ id, material, militar }],
      solicitacoes_pendentes: 2,
      ocorrencias_abertas: 0
    }
  }
}
```

4. Atribui armeiro entrante:

```http
POST /api/handovers/{id}/assign-entry
{ entrando_id: "uuid-do-armeiro-entrante" }
→ { ok: true, status: "aguardando_assinatura_entrada", prazo_assumcao: "2026-06-26T10:00:00Z" }
```

Armeiro entrante tem 2 horas para assinar.

#### 3. Criar Nova Saída de Material

1. Clica card "Saídas" no painel ou navega para `/reserva/saidas`
2. Clica "Nova Saída" → `/reserva/saidas/nova`
3. Preenche formulário:
   - Busca militar (busca biométrica ou por nome/matrícula)
   - Seleciona item do inventário da reserva
   - Adiciona observação
4. Confirma:

```http
POST /api/saidas
{
  item_id: "uuid-do-item",
  militar_id: "uuid-do-militar",
  reserve_id: "{reserveId da sessão}",
  observacao: "Patrulha noturna"
}
→ { ok: true, saida_id, status: "emitida" }
```

5. Assina como responsável (TOTP ou biometria):

```http
POST /api/saidas/{saida_id}/sign-armeiro
{ totp_token: "123456" }
→ { ok: true, status: "aguardando_confirmacao", armeiro_signature_id }
```

6. Militar confirma recebimento com seu próprio TOTP.

#### 4. Emitir Termo de Cautela

Para uso prolongado (missão, comissão):

```http
POST /api/cautelamentos
{
  item_id: "uuid",
  militar_id: "uuid",
  motivo_emissao: "Comissão — 30 dias",
  condicao_emissao: "otimo",
  data_prevista_devolucao: "2026-07-26"
}
→ { cautela_id, status: "ativa" }

POST /api/cautelamentos/{cautela_id}/sign-armeiro
{ totp_token: "123456" }
→ { ok: true, armeiro_signature_id }
```

Militar assina em seguida (POST `/api/cautelamentos/{id}/sign-militar`) → PDF gerado automaticamente.

#### 5. Registrar Devolução de Material

**Saída diária:**
```http
PATCH /api/saidas/{saida_id}/return
{
  condicao_devolucao: "bom",
  observacao: "Devolvido sem ocorrências"
}
→ { ok: true, status: "devolvida" }
# item.status_operacional volta para "disponivel"
```

**Cautela (longo prazo):**
```http
POST /api/cautelamentos/{cautela_id}/return
{
  condicao_devolucao: "bom",
  motivo_devolucao: "Fim da comissão"
}
→ { ok: true, status: "devolvida" }
```

Se `condicao_devolucao = "inapto"`:
- `item.status_operacional` muda para `"inapto"` (indisponível para novas saídas)

#### 5b. Registrar Ocorrência de Material (item no estoque, não retirado)

Diferente da devolução acima (que trata de item em posse ativa), esta é para um item que **nunca saiu** e foi encontrado danificado/desaparecido num levantamento físico:

```http
PATCH /api/arsenal/items/{item_id}/ocorrencia
{ novo_status: "avariado", motivo: "Trinca na coronha, achado na conferência semanal" }
→ { ok: true }
```

Grupos de status disponíveis: **Dano** (`avariado`), **Perda** (`extraviado`, `furtado` — exige `numero_bo`, registro interno, não B.O. de delegacia), **Administrativo** (`em_pericia`, `bloqueado`, `em_transito`). Item passa a aparecer em `/reserva/arsenal/manutencao`. Se o item estiver `em_saida`/`cautelado` (posse ativa), a rota recusa com 409 — use a devolução com condição inadequada (item 5) nesse caso.

#### 6. Criar Passagem de Turno (ao Encerrar)

```http
POST /api/handovers
{
  reserve_id: "{reserveId}",
  observacao_saindo: "Turno encerrado. 8 cautelas ativas, 0 ocorrências abertas."
}
→ {
  ok: true,
  handover_id,
  document_hash,
  snapshot: { carga_total, cautelas_ativas, saidas_ativas, ... }
}
```

Assinar:
```http
POST /api/handovers/{handover_id}/sign-exit
{ totp_token: "123456" }
→ { ok: true, status: "aguardando_atribuicao" }
```

#### 7. Gerenciar Ocorrências (complaint de militar sobre material em uso)

Distinto do item 5b acima — esta é uma ocorrência **relatada pelo próprio militar** sobre o material que está com ele (ver `usuario-journey.md`), não uma ação direta de staff sobre um item do estoque.

```http
GET /api/ocorrencias
→ { ocorrencias: [{ id, tipo, descricao, reportado_por, status, created_at }] }

PATCH /api/ocorrencias/{id}
{ status: "resolvida", resolucao: "Encaminhado para manutenção" }
→ { ok: true }
```

#### 8. Enviar Solicitação de Estoque

Quando material abaixo do limite mínimo:

```http
POST /api/arsenal/requests
{
  type: "stock_adjustment",
  material_type_id: "uuid",
  current_quantity: 3,
  new_quantity: 50,
  justificativa: "Estoque crítico — abaixo do mínimo operacional"
}
→ { request_id, status: "pendente" }
```

`admin_global` recebe notificação e aprova/rejeita.

#### 9. Gerar Relatório

1. Navega para `/reserva/relatorios`
2. Filtra por período, Tipo de Registro (Saídas / Cautelas / Livro de Serviço), material, categoria, usuário (autocomplete assíncrono), posto
3. Seleciona linhas via checkbox → PDF dinâmico (hash de integridade) ou CSV; paginação "Ver mais" (10/20/30)
4. Livro de Serviço mostra usuário (com foto, se cadastrada), material referenciado, descrição completa e status (Pendente/Resolvido)

---

## RBAC — O Que o Admin Reserva NÃO Pode Fazer

| Ação Bloqueada | Motivo |
|---|---|
| Ver dados de outra reserva | `reserve_id` da sessão filtra todos os queries |
| Criar militares (`POST /api/admin/militares`) | Apenas `admin_global` |
| Aprovar SSA | Apenas `admin_global` aprova |
| Acessar `/admin` | Apenas `admin_global` |
| Aplicar impedimento administrativo | Apenas `admin_global` |
| Acessar `/api/nexus/*` | Apenas `superadmin` |

---

## Controles de Segurança

| Controle | Implementação |
|---|---|
| Reserve scoping | `reserve_id` da sessão (`user_reserve_preferences`) filtra todos os dados |
| TOTP obrigatório em assinaturas | `validateTotp()` com replay protection em sign-exit, sign-entry |
| Tenant isolation | `tenant_id` verificado em todos os endpoints |
| Mesmo ator não assina dos dois lados | Sign-exit + sign-entry por atores diferentes |
| Prazo de assunção | 2h após assign-entry; passagens vencidas ficam status `vencido` |

---

## Fluxo de Passagem — Responsabilidades do Admin Reserva

```
Admin Reserva Saindo:
  POST /api/handovers → cria + snapshot
  POST /api/handovers/{id}/sign-exit → assina saída

Admin Reserva Entrante (ou qualquer admin):
  POST /api/handovers/{id}/assign-entry → atribui quem recebe
  
Armeiro ou Admin Reserva Entrante:
  POST /api/handovers/{id}/sign-entry → assina entrada
  (mesmo ator de saindo: 422 Conflict)

Decisão pós-recebimento:
  → Tudo OK: passagem conclui (status "concluido")
  → Divergência: POST /api/handovers/{id}/report-divergence → "divergencia"
                 Admin global toma providências
```
