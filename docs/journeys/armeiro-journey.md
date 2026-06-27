# Jornada do Armeiro

**Role:** `armeiro`  
**Contexto:** Operador de reserva de armamento no turno. Responsável pelas transações diárias: saídas, devoluções, cautelas e passagens. Usa biometria para identificar militares sem que eles precisem digitar nada. Trabalha dentro de uma reserva específica.  
**Interface frontend:** `/reserva` — sidebar compartilhado com `admin_reserva`, mas **sem** a capacidade de atribuir armeiro entrante em passagens.

---

## ICP (Ideal Customer Profile)

- Cabo ou Soldado de plantão na reserva de armamento
- Opera em contato direto com militares que retiram e devolvem material
- Usa leitor biométrico (ZKTeco) para identificação 1:N
- Participa de passagens de turno assinando dos dois lados (saindo ou entrante)

---

## Páginas Acessíveis

| Rota | Descrição |
|---|---|
| `/reserva` | Painel — cards de atalho com estado da reserva |
| `/reserva/militares` | Identificação biométrica + perfis |
| `/reserva/saidas` | Saídas de material (lista) |
| `/reserva/saidas/nova` | Criar nova saída |
| `/reserva/cautelas` | Cautelas ativas (lista) |
| `/reserva/relatorios` | Relatórios (somente leitura) |
| `/reserva/arsenal` | Inventário (somente leitura) |
| `/reserva/solicitacoes` | Suas solicitações de estoque (SSA) |
| `/reserva/ocorrencias` | Ocorrências da reserva |
| `/reserva/passagens` | Passagens de turno em que participa |

**Diferença vs admin_reserva:** O armeiro **não pode** chamar `POST /api/handovers/{id}/assign-entry` — a atribuição de armeiro entrante é responsabilidade do `admin_reserva` ou `admin_global`.

---

## Jornada Passo a Passo

### Cenário: Turno completo de armeiro — 5 saídas, 1 cautela, 1 passagem

#### 1. Login

1. Acessa `/login` → insere email + senha
2. Sistema reconhece `role=armeiro` + verifica `reserve_memberships` → redireciona para `/reserva`
3. Painel carrega estado atual da reserva:
   - "8 itens em saída"
   - "2 cautelas ativas"
   - "0 passagens pendentes de assinatura"

#### 2. Início do Turno — Assinar Passagem Entrante

1. Navega para `/reserva/passagens`
2. Vê passagem com status `aguardando_assinatura_entrada` (admin atribuiu o armeiro)
3. Clica "Ver Passagem" → snapshot do turno exibido:
   - Carga total: 120 itens
   - 2 cautelas ativas (lista com militares e prazos)
   - 0 saídas ativas no momento da passagem
4. Confere fisicamente o armamento + assina:

```http
POST /api/handovers/{handover_id}/sign-entry
{ totp_token: "456789" }
→ { ok: true, status: "concluido" }
```

Se encontrar divergência:
```http
POST /api/handovers/{handover_id}/report-divergence
{ descricao: "Fuzil FA-MAS #012 não encontrado no acervo. Última saída: Sgt. Costa em 25/06." }
→ { ok: true, status: "divergencia" }
```

#### 3. Identificar Militar por Biometria

1. Militar se apresenta à janela da reserva
2. Armeiro acessa `/reserva/militares`
3. Clica "Identificar Militar"
4. Coloca dedo do militar no leitor ZKTeco

```http
POST /api/biometric/identify
{ template: "<base64_template>" }
→ {
  matched: true,
  profile: {
    nome_completo: "João da Silva Santos",
    matricula: "2024001",
    posto: "soldado",
    nome_de_guerra: "Silva",
    foto_url: "...",
    registration_status: "complete"
  }
}
```

Se `registration_status !== "complete"` ou `impedimento_administrativo`:
- Sistema bloqueia a saída
- Exibe mensagem de impedimento

#### 4. Criar Saída de Material

1. Após identificar militar → clica "Nova Saída"
2. Seleciona item disponível no inventário
3. Adiciona observação

```http
POST /api/saidas
{
  item_id: "uuid-fuzil-001",
  militar_id: "uuid-joao",
  reserve_id: "92a0b388-cefa-4d1f-81ec-533f694d2ab9",
  observacao: "Patrulha noturna — Rua do Bode"
}
→ { ok: true, saida_id: "uuid", status: "emitida" }
```

5. Assina com TOTP ou biometria:

```http
POST /api/saidas/{saida_id}/sign-armeiro
{ totp_token: "123456" }
→ {
  ok: true,
  status: "aguardando_confirmacao",
  armeiro_signature_id: "uuid"
}
```

6. Militar confirma o recebimento com seu próprio TOTP:
```http
POST /api/saidas/{saida_id}/confirm
{ totp_token: "789012" }  # TOTP do militar, não do armeiro
→ { ok: true, status: "ativa" }
```

#### 5. Emitir Cautela Permanente

Para militares em missão prolongada:

```http
POST /api/cautelamentos
{
  item_id: "uuid-pistola-001",
  militar_id: "uuid-carlos",
  motivo_emissao: "Escolta especial — 7 dias",
  condicao_emissao: "otimo"
}
→ { cautela_id, status: "ativa" }

POST /api/cautelamentos/{cautela_id}/sign-armeiro
{ totp_token: "123456" }
→ { ok: true, armeiro_signature_id }
```

Militar assina: `POST /api/cautelamentos/{id}/sign-militar` com seu TOTP.  
PDF gerado automaticamente após ambas as assinaturas.

#### 6. Registrar Devolução de Saída Diária

```http
PATCH /api/saidas/{saida_id}/return
{
  condicao_devolucao: "bom",
  observacao: "Devolvido sem ocorrências"
}
→ { ok: true, status: "devolvida" }
```

Condições possíveis: `otimo`, `bom`, `regular`, `ruim`, `inapto`

Se `condicao_devolucao = "inapto"`:
- `item.status_operacional` muda para `"inapto"`
- Item fica indisponível para novas saídas
- Armeiro deve fazer SSA para reposição

#### 7. Substituir Item em Cautela

Se item cautelado apresentar defeito:

```http
POST /api/cautelamentos/{cautela_id}/substitute
{
  novo_item_id: "uuid-pistola-002",
  motivo: "Pistola original apresentou defeito no gatilho"
}
→ { ok: true, new_cautela_id }
```

Nova cautela criada com mesmo militar + novo item.

#### 8. Solicitar Ajuste de Estoque (SSA)

Quando nível de um material cai abaixo do mínimo:

```http
POST /api/arsenal/requests
{
  type: "stock_adjustment",
  material_type_id: "uuid-tipo-fuzil",
  current_quantity: 2,
  new_quantity: 50,
  justificativa: "Quantidade abaixo do mínimo operacional após baixa por inutilidade"
}
→ { request_id, status: "pendente" }
```

`admin_global` aprova ou rejeita. Armeiro acompanha em `/reserva/solicitacoes`.

**Solicitação de adição de novo material:**
```http
POST /api/arsenal/requests
{
  type: "new_material",
  descricao: "Rádio Portátil Motorola DP4400",
  quantidade: 10,
  justificativa: "Necessidade para operações noturnas"
}
```

#### 9. Fim do Turno — Criar Passagem de Saída

1. Navega para `/reserva/passagens`
2. Clica "Iniciar Passagem de Turno"

```http
POST /api/handovers
{
  reserve_id: "92a0b388-cefa-4d1f-81ec-533f694d2ab9",
  observacao_saindo: "Turno encerrado 00h-06h. 8 itens em cautela, 2 em saída, 0 ocorrências."
}
→ {
  ok: true,
  handover_id: "uuid",
  document_hash: "sha256:...",
  snapshot: {
    carga_total: { total: 120, por_tipo: [...] },
    cautelas_ativas: [...],
    saidas_ativas: [...]
  }
}
```

3. Assina como saindo:

```http
POST /api/handovers/{handover_id}/sign-exit
{ totp_token: "654321" }
→ { ok: true, status: "aguardando_atribuicao" }
```

`admin_reserva` atribui o armeiro entrante → armeiro entrante assina no próximo turno.

#### 10. Resolver Ocorrências

```http
GET /api/ocorrencias
→ { ocorrencias: [{ id, descricao: "Carregadeira danificada", tipo: "dano", status: "aberta" }] }

PATCH /api/ocorrencias/{id}
{ status: "resolvida", resolucao: "Encaminhado para manutenção — Protocolo 2026-001" }
→ { ok: true }
```

---

## RBAC — O Que o Armeiro NÃO Pode Fazer

| Ação Bloqueada | Motivo / Role Correto |
|---|---|
| `POST /api/handovers/{id}/assign-entry` | Apenas `admin_reserva` / `admin_global` |
| `POST /api/admin/militares` | Apenas `admin_global` |
| `PATCH /api/arsenal/requests/:id/approve` | Apenas `admin_global` |
| Acessar `/admin` ou `/api/nexus` | Roles superiores |
| Assinar saída de outra reserva | `reserve_memberships` verifica membership |
| Assinar como entrante na mesma passagem que saiu | 422 Conflict |
| Aplicar `impedimento_administrativo` | Apenas `admin_global` |
| Deletar qualquer dado | Operação não disponível |

---

## Controles de Segurança

| Controle | Implementação |
|---|---|
| Reserve membership | `reserve_memberships` verificado em POST /api/handovers — 403 se não membro |
| TOTP com replay protection | `last_used_token` no DB — mesmo código recusado na janela de 30s |
| Autenticidade dupla | Armeiro + militar assinam com credenciais diferentes |
| Audit log | Toda saída/cautela/passagem logada com actor_id, IP, auth_method |
| Biometria 1:N | Template comparado contra todos os militares da reserva — não aceita bypass |

---

## Fluxo Resumido — Saída Diária (5 minutos)

```
Militar se apresenta
  ↓
Biometria identifica (ou armeiro busca por matrícula)
  ↓
POST /api/saidas (armeiro cria)
  ↓
POST /api/saidas/:id/sign-armeiro (armeiro, TOTP)
  ↓
POST /api/saidas/:id/confirm (militar, TOTP)
  ↓
[Item saiu — status "ativa"]
  ↓ [fim do turno]
PATCH /api/saidas/:id/return (armeiro registra devolução)
  ↓
[Item devolvido — status "devolvida"]
```
