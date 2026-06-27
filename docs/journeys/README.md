# APMCB — Jornadas de Usuário por Role

**Última atualização:** 2026-06-26  
**Status:** Baseado na implementação das Fases 1-6 (produção)

---

## Visão do Produto

**APMCB** é um sistema de **governança de bens sensíveis** (armamentos, equipamentos, fardamentos) para órgãos de segurança pública do Brasil. Funciona como um "Registro Digital de Armamento" — substituindo livros físicos, fichas de papel e processos manuais por fluxos digitais com rastreabilidade total, assinatura eletrônica e auditoria contínua.

**Problema que resolve:**
- Saídas e devoluções de armamento sem rastreio adequado
- Cautelas permanentes emitidas em papel, sem cópia digital
- Passagens de turno sem registro formal do estado da reserva
- Impossibilidade de auditoria retroativa de quem usou qual arma, quando, e em que condição

**Solução:**
- Status machine para cada item (disponível → em saída → devolvido → inapto)
- Dupla assinatura eletrônica (armeiro + militar) com TOTP/biometria
- Snapshot automático da reserva em cada passagem de turno
- PDF auditável gerado e armazenado para cada operação
- Hash criptográfico em cada documento para prova de integridade

---

## ICP — Ideal Customer Profile

| Segmento | Características |
|---|---|
| **Primário** | Reservas de armamento de Polícias Militares estaduais |
| **Secundário** | Corpos de Bombeiros, Guardas Municipais, Forças Auxiliares |
| **Tamanho** | 50-500 militares por reserva |
| **Complexidade** | Múltiplas reservas por batalhão/unidade |
| **Dor crítica** | Auditoria de corregedoria — precisam provar quem usou o quê |

---

## Mapeamento de Roles

| Role | Frontend | Contexto Militar | Responsabilidade Core |
|---|---|---|---|
| `superadmin` | Nenhum (apenas API) | Secretaria / Gestão TI | Onboarding de órgãos na plataforma |
| `admin_global` | `/admin` | Tenente-Coronel / Capitão Admin | Cadastro de militares, aprovação de estoque |
| `admin_reserva` | `/reserva` | Tenente / Sargento-Mor da Reserva | Operação diária, passagens de turno |
| `armeiro` | `/reserva` | Cabo / Soldado de plantão | Saídas, devoluções, biometria |
| `usuario` | `/cadete` | Qualquer militar | Confirmar retiradas, assinar cautelas |

---

## Documentos de Jornada

| Arquivo | Role | O que cobre |
|---|---|---|
| [superadmin-journey.md](./superadmin-journey.md) | `superadmin` | Onboarding de tenants, gestão de estrutura, monitoramento |
| [admin-global-journey.md](./admin-global-journey.md) | `admin_global` | Cadastro de militares, aprovação SSA, painel de comando |
| [admin-reserva-journey.md](./admin-reserva-journey.md) | `admin_reserva` | Operação da reserva, passagens, saídas, cautelas |
| [armeiro-journey.md](./armeiro-journey.md) | `armeiro` | Saídas diárias, biometria, cautelas, passagem de turno |
| [usuario-journey.md](./usuario-journey.md) | `usuario` | Confirmação de retirada, cautelas, histórico |

---

## Matriz RBAC Resumida

| Ação | superadmin | admin_global | admin_reserva | armeiro | usuario |
|---|:---:|:---:|:---:|:---:|:---:|
| Criar tenant / estrutura | ✅ | ✅¹ | ❌ | ❌ | ❌ |
| Criar militares | ❌ | ✅ | ❌ | ❌ | ❌ |
| Aprovar SSA | ❌ | ✅ | ❌ | ❌ | ❌ |
| Criar saídas de material | ❌ | ❌ | ✅ | ✅ | ❌ |
| Assinar saída (armeiro) | ❌ | ❌ | ✅ | ✅ | ❌ |
| Confirmar recebimento (militar) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Emitir cautela | ❌ | ❌ | ✅ | ✅ | ❌ |
| Assinar cautela (armeiro) | ❌ | ❌ | ✅ | ✅ | ❌ |
| Assinar cautela (militar) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Criar passagem de turno | ❌ | ❌ | ✅ | ✅ | ❌ |
| Atribuir armeiro entrante | ❌ | ❌ | ✅ | ❌ | ❌ |
| Assinar passagem (saindo) | ❌ | ❌ | ✅ | ✅ | ❌ |
| Assinar passagem (entrante) | ❌ | ❌ | ✅ | ✅ | ❌ |
| Capturar biometria | ❌ | ❌ | ✅ | ✅ | ✅² |
| Reportar ocorrência | ❌ | ❌ | ❌ | ❌ | ✅ |
| Resolver ocorrência | ❌ | ✅ | ✅ | ✅ | ❌ |
| Ver auditoria global | ✅ | ✅ | ❌ | ❌ | ❌ |
| Resetar TOTP de usuário | ✅ | ❌ | ❌ | ❌ | ❌ |
| Acessar `/api/nexus/*` | ✅ | ❌ | ❌ | ❌ | ❌ |

¹ `admin_global` cria org_units e reserves dentro do seu tenant  
² Militar registra sua própria biometria presencialmente na reserva, capturada pelo armeiro

---

## Fluxos Críticos (Ponta a Ponta)

### 1. Saída Diária (~5 min)

```
Armeiro identifica militar (biometria)
  → POST /api/saidas (armeiro cria)
  → POST /api/saidas/:id/sign-armeiro (armeiro, TOTP)
  → POST /api/saidas/:id/confirm (militar, TOTP)
  → Item em uso no dashboard do militar (/cadete)
  → PATCH /api/saidas/:id/return (armeiro registra devolução)
```

### 2. Cautela Permanente (~10 min + prazo variável)

```
  → POST /api/cautelamentos (armeiro cria)
  → POST /api/cautelamentos/:id/sign-armeiro (armeiro, TOTP)
  → POST /api/cautelamentos/:id/sign-militar (militar, TOTP)
  → PDF gerado automaticamente
  → [dias a semanas depois]
  → POST /api/cautelamentos/:id/return (armeiro, com condição)
```

### 3. Passagem de Turno (~15 min)

```
  → POST /api/handovers (armeiro saindo, snapshot automático)
  → POST /api/handovers/:id/sign-exit (armeiro saindo, TOTP)
  → POST /api/handovers/:id/assign-entry (admin atribui entrante)
  → POST /api/handovers/:id/sign-entry (armeiro entrante, TOTP)
  → PDF da passagem disponível
```

### 4. Solicitação de Estoque (SSA) (~24h ciclo)

```
  → POST /api/arsenal/requests (armeiro, justificativa)
  → [notificação para admin_global]
  → PATCH /api/arsenal/requests/:id/approve (admin_global)
  → Estoque atualizado em material_items
```

---

## Garantias de Segurança (Sem Vazamentos RBAC)

| Garantia | Como é Implementada |
|---|---|
| **Tenant isolation** | `tenant_id` da sessão filtrado em todos os queries — impossível ver dados de outro tenant |
| **Reserve scoping** | `reserve_id` da sessão (`user_reserve_preferences`) filtra dados de armeiro e admin_reserva |
| **User scoping** | Usuario vê apenas dados onde `military_id = userId` |
| **Role guards** | `roleGuard(...)` em cada endpoint BFF → 403 imediato se role não autorizado |
| **Assinatura dupla** | Armeiro + militar assinam com credenciais independentes (TOTP separados) |
| **Anti-replay TOTP** | `last_used_token` no DB — mesmo código recusado na janela de 30s |
| **Mesmo ator = 422** | `saindo_id === userId` na sign-entry → 422 Conflict (proíbe auto-passagem) |
| **Membership check** | Armeiro deve ter `reserve_memberships` para criar passagem naquela reserva |
| **Impedimento administrativo** | Militar com status `impedimento_administrativo` → 403 em qualquer operação |
| **Audit log imutável** | `audit_logs` apenas INSERT — nunca UPDATE/DELETE |

---

## Implementação por Fase

| Fase | O que entregou | Status |
|---|---|---|
| Fase 1-2 | Auth, roles, TOTP, biometria, cadastro | ✅ Produção |
| Fase 3 | Audit log com hash chain | ✅ Produção |
| Fase 4 | Assinatura eletrônica de documentos | ✅ Produção |
| Fase 5 | Saída diária enterprise + Cautela permanente | ✅ Produção |
| Fase 6 | Livro Digital de Serviço (Passagem de Turno) | ✅ Produção |
| Fase 7 | Dashboard de Comando (14 métricas) | ✅ Produção |
