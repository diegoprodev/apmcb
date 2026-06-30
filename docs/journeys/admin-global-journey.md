# Jornada do Admin Global

**Role:** `admin_global` (mapeado como `admin` no frontend)  
**Contexto:** Administrador central de um tenant (PM estadual, Bombeiros, etc.). Gerencia o cadastro de todos os militares, aprova solicitações de estoque, configura a estrutura da organização e monitora o estado de todas as reservas.  
**Interface frontend:** `/admin` — sidebar com 7 seções.

---

## ICP (Ideal Customer Profile)

- Oficial de alta patente responsável pela administração (Tenente-Coronel, Capitão)
- Controla o ciclo de vida dos usuários do sistema
- Única role que pode criar militares e aprovar solicitações de estoque
- Acessa o painel de comando com 14 métricas de exceção em tempo real

---

## Páginas Acessíveis

| Rota | Descrição |
|---|---|
| `/admin` | Dashboard executivo com cards de atalho |
| `/admin/comando` | Painel de comando — 14 métricas (cautelas, saídas, estoque, divergências) |
| `/admin/usuarios` | CRUD completo de militares |
| `/admin/arsenal` | Inventário do almoxarifado por categoria |
| `/admin/arsenal/solicitacoes` | Aprovação de solicitações de estoque (SSA) |
| `/admin/estrutura` | Configuração de unidades organizacionais e reservas |
| `/admin/relatorios` | Relatórios de movimentação por período |
| `/admin/auditoria` | Log de auditoria de ações |

---

## Jornada Passo a Passo

### Cenário 1: Onboarding de 50 militares + configuração inicial

#### 1. Login e Dashboard

1. Acessa `/login` → insere email + senha
2. Sistema reconhece `role=admin_global` → redireciona para `/admin`
3. Dashboard carrega com GET `/api/dashboard/command`:

```json
{
  "cautelas_ativas": 47,
  "itens_com_atraso": 3,
  "estoque_baixo": 2,
  "ocorrencias_abertas": 1,
  "militares_total": 0,
  "divergencias_passagem": 0
}
```

Cada card é clicável → navega diretamente para a seção relevante.

#### 2. Cadastrar Militares

1. Navega para `/admin/usuarios`
2. Clica botão "Novo Militar"
3. Preenche formulário:

```http
POST /api/admin/militares
{
  nome_completo: "João da Silva Santos",
  matricula: "2024001",
  posto: "soldado",
  unidade: "1ª Companhia",
  email: "joao.silva@pm.pb.gov.br",
  role: "usuario"
}
→ {
  user_id: "uuid",
  magic_link_sent: true
}
```

Sistema cria `auth.users` + `profiles` + envia magic link por email.

4. Upload de foto (opcional):

```http
POST /api/admin/upload-photo
Content-Type: multipart/form-data (campo: photo)
→ { photo_url }

PATCH /api/profiles/{user_id}
{ foto_url: "{photo_url}" }
```

#### 3. Gerenciar Militares Existentes

**Buscar militar:**
- Campo de busca por nome, matrícula ou posto
- GET `/api/admin/militares?q=joao&reserve_id=&limit=20`

**Alterar status:**
```http
PATCH /api/profiles/{user_id}/status
{ registration_status: "impedimento_administrativo" }
```

Opções de status: `pending`, `complete`, `inactive`, `impedimento_administrativo`

**Atualizar dados básicos:**
```http
PATCH /api/profiles/{user_id}
{ nome_de_guerra: "Silva", telefone: "+55 83 99999-0001" }
```

#### 4. Configurar Estrutura Organizacional

1. Navega para `/admin/estrutura`
2. Visualiza árvore: Tenant → OrgUnits → Reserves

```http
GET /api/admin/estrutura
→ {
  tenant: { nome, logo_url, cor_primaria },
  org_units: [{ id, nome, acronym, reserves: [...] }]
}
```

**Criar Unidade:**
```http
POST /api/admin/org-units
{ nome: "1º Batalhão", acronym: "1BPM", tenant_id }
→ { org_unit_id }
```

**Criar Reserva:**
```http
POST /api/admin/reserves
{ nome: "Reserva de Armamento", acronym: "APMCB", org_unit_id }
→ { reserve_id }
```

**Deletar Unidade (validação automática):**
```http
DELETE /api/admin/org-units/{id}
→ 409 se houver reservas vinculadas
→ 200 se seguro deletar
```

#### 5. Aprovar Solicitações de Estoque (SSA)

1. Navega para `/admin/arsenal/solicitacoes`
2. GET `/api/arsenal/requests?status=pendente`:

```json
[
  {
    "id": "uuid",
    "type": "stock_adjustment",
    "material_type": "Fuzil FA-MAS",
    "current_quantity": 45,
    "requested_quantity": 50,
    "requestor": "Sgt. Pereira",
    "justificativa": "Ajuste após inventário semestral",
    "created_at": "2026-06-25T14:30:00Z"
  }
]
```

**Aprovar:**
```http
PATCH /api/arsenal/requests/{id}/approve
{ admin_note: "Aprovado — ajuste validado no inventário físico" }
→ { ok: true }
# Quantidade atualizada em material_items
# Notificação disparada para o solicitante
```

**Rejeitar:**
```http
PATCH /api/arsenal/requests/{id}/reject
{ admin_note: "Divergência com inventário físico. Rever contagem." }
→ { ok: true }
```

#### 6. Painel de Comando — Visão Executiva

1. Navega para `/admin/comando`
2. GET `/api/dashboard/command` retorna 14 métricas de exceção:

| Métrica | Descrição |
|---|---|
| Cautelas ativas | Termos de cautela em aberto |
| Saídas ativas | Itens fora da reserva hoje |
| Itens com atraso | Saídas além do prazo |
| Estoque baixo | Categorias abaixo do threshold mínimo |
| Divergências em passagem | Passagens com status `divergencia` |
| Ocorrências abertas | Ocorrências não resolvidas |
| Militares com impedimento | Usuarios em status `impedimento_administrativo` |
| Aguardando TOTP config | Usuários sem 2FA configurado |
| SSA pendentes aprovação | Solicitações aguardando despacho |
| ... | (14 total) |

#### 7. Relatórios

1. Navega para `/admin/relatorios`
2. Filtra por: período, tipo (saídas / cautelas / passagens / SSA), reserva
3. Export para PDF ou tabela na tela

#### 8. Auditoria

1. Navega para `/admin/auditoria`
2. Busca por: ação, ator, recurso, período
3. Ver detalhes de qualquer operação: quem fez, quando, de qual IP, com qual método de auth

---

## Hierarquia RBAC — Privilege Ceiling (H-RBAC)

O sistema implementa **Hierarchical RBAC com Privilege Ceiling**: cada role só pode exercer poder até o teto da sua camada, sem escalada vertical ou horizontal.

```
superadmin    → provisiona tenants (Nexus) — SEM controle estrutural interno
    │
admin_global  → governa estrutura em cascata: org_units → reserves → usuários
    │
admin_reserva → governa apenas a sua reserva (toggle SSA, membros, armeiros)
    │
armeiro       → operações do dia a dia dentro da reserva
    │
usuario       → auto-serviço (SSA, perfil, histórico)
```

**superadmin NÃO é admin da organização** — é o contratante SaaS (Nexus). Não gerencia reservas, usuários, estrutura nem toggles operacionais. Seus endpoints estão em `/api/nexus/*`.

**admin_global controla a estrutura em cascata** — único que pode criar/deletar org_units, reserves, provisionar militares e configurar a operação do tenant.

## RBAC — O Que o Admin Global NÃO Pode Fazer

| Ação Bloqueada | Role Responsável |
|---|---|
| Assinar saídas como armeiro | `armeiro`, `admin_reserva` |
| Emitir cautelas | `armeiro`, `admin_reserva` |
| Criar passagens de serviço | `armeiro`, `admin_reserva` |
| Capturar biometria de militares | `armeiro` |
| Acessar `/api/nexus/*` | `superadmin` |
| Deletar usuários permanentemente | Ninguém (apenas desativar) |
| Aprovar solicitações SSA de outro tenant | — (tenant isolation absoluto) |
| Configurar estrutura de outro tenant | — (tenant isolation absoluto) |

---

## Controles de Segurança

| Controle | Implementação |
|---|---|
| Tenant isolation | Todos os queries filtram por `tenant_id` da sessão |
| Audit log obrigatório | Toda criação/alteração de militar logada |
| Magic link seguro | Invite via Supabase — link expira em 24h |
| Status de impedimento | Usuário bloqueado não consegue autenticar (middleware verifica `registration_status`) |

---

## Fluxos Críticos com Validação RBAC

### Criar Militar — Verificações

1. `roleGuard("admin_global")` → 403 se não for admin_global
2. Email único no tenant (Supabase valida unique constraint)
3. Matrícula única (`UNIQUE` em `profiles.matricula`)
4. Foto uploadada separado (não required na criação)
5. Magic link enviado automaticamente

### Aprovar SSA — Verificações

1. `roleGuard("admin_global")` → 403
2. Solicitação deve estar em status `pendente` → 422 se já processada
3. `new_quantity` válido (> 0) → 400 se inválido
4. Audit log registra: aprovador, data, nota, quantidade anterior vs nova
