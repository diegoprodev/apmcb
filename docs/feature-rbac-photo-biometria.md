# APMCB — Spec: RBAC Expandido, Foto, Biometria, Notificações

> **Status:** Em desenvolvimento  
> **Data:** 2026-06-14  
> **Versão:** 1.0

---

## 1. Atores e Permissões

| Ação | Admin | Master (Armeiro) | Military (Cadete) |
|------|-------|-----------------|-------------------|
| Cadastrar Militar (sem login) | ✅ | ✅ | ❌ |
| Criar Login para militar | ✅ | ✅ | ❌ |
| Criar Login para armeiro/admin | ✅ | ❌ (bloqueado) | ❌ |
| Editar perfil de qualquer usuário | ✅ | ❌ | ❌ |
| Desativar usuário | ✅ | ❌ | ❌ |
| Ver lista de todos os usuários | ✅ | ✅ (apenas militares) | ❌ |
| Ver histórico próprio | ✅ | ✅ | ✅ |
| Gerar PDF histórico pessoal | ✅ | ✅ | ✅ |
| Capturar biometria | ✅ | ✅ | ❌ |

---

## 2. Fluxo: Cadastrar Militar (Master)

**Acesso:** `/armeiro/militares` → botão "Cadastrar Militar"

**Campos:**
| Campo | Obrigatório | Tipo |
|-------|-------------|------|
| Nome completo | ✅ | Text |
| Matrícula | ✅ | Text (mono) |
| Posto | | Select (posto_enum) |
| Papel | | Select (só `military` para master) |
| Unidade | | Text |
| Telefone | | Text |
| Foto | | File upload (jpg/png, max 5MB) |
| Capturar biometria | | Checkbox |
| → Seleção de dedo | Se checkbox | FingerSelector component |

**Fluxo pós-submit:**
1. Upload de foto para Supabase Storage → obtém `foto_url`
2. POST `/api/admin/militares` com todos os campos
3. Se biometria selecionada → POST BFF `/api/biometric/register`
4. Tela de confirmação: "Militar cadastrado com sucesso! Use Criar Login para provisionar acesso."

**Restrições para master:**
- Role sempre `military` (campo hidden ou readonly)
- Não pode criar admin/master

---

## 3. Fluxo: Criar Login (Master)

**Acesso:** `/armeiro/militares` → botão "Criar Login"

**Campos idênticos ao admin, exceto:**
- Role: apenas `military` visível
- Método: Magic Link ou Senha (ambos disponíveis)

**Backend:**
- `POST /api/admin/users` agora aceita callers com role `master`
- Valida: se caller é `master`, body.role deve ser `military` (não admin/master)
- Após criar usuário: envia notificação para o novo usuário

---

## 4. Fluxo: Notificação PWA ao receber login

**Trigger:** `POST /api/admin/users` com sucesso

**Ação:**
1. Inserir registro em `notifications` com:
   - `user_id` = id do novo usuário
   - `type` = `account_created`
   - `title` = "Acesso criado"
   - `body` = "Seu acesso ao sistema APMCB foi provisionado. Verifique seu e-mail."
   - `metadata` = `{ method: "magic_link" | "password" }`
2. Push notification PWA via VAPID (se service worker registrado)

**Bell UI:**
- Ícone no header com badge de contagem (não lidas)
- Click abre Sheet lateral com lista de notificações
- Click em notificação marca como lida + fecha sheet
- "Marcar todas como lidas" botão

---

## 5. Componente: FingerSelector

**Uso:** Dentro de `CadastrarMilitarDialog` quando checkbox "Capturar biometria" está marcado

**UI:**
```
┌─────────────────────────────────────┐
│ Selecione o dedo para captura       │
│                                     │
│  Mão Esquerda    Mão Direita        │
│  [5][4][3][2][1] [1][2][3][4][5]   │
│                                     │
│ ● Indicador direito (recomendado)  │
│                                     │
│ [Capturar impressão digital]        │
└─────────────────────────────────────┘
```

**Mapeamento finger_index (ZKTeco padrão):**
| Index | Dedo |
|-------|------|
| 1 | Polegar direito |
| 2 | Indicador direito |
| 3 | Médio direito |
| 4 | Anelar direito |
| 5 | Mínimo direito |
| 6 | Polegar esquerdo |
| 7 | Indicador esquerdo |
| 8 | Médio esquerdo |
| 9 | Anelar esquerdo |
| 10 | Mínimo esquerdo |

**Recomendação padrão:** Indicador direito (index 2)

---

## 6. Foto de Perfil

**Storage:** Supabase Storage, bucket `profile-photos`, path `{user_id}/avatar.{ext}`

**Upload flow (client-side):**
1. Usuário seleciona arquivo → preview no dialog
2. Validação: max 5MB, apenas jpg/png/webp
3. Upload direto para Supabase Storage (usando browser client com RLS policy)
4. `foto_url` = URL pública do arquivo
5. Enviado junto com POST `/api/admin/militares`

**API change:**
- `POST /api/admin/militares` agora aceita campo `foto_url?: string | null`
- Salva no profile upsert

---

## 7. APIs

### `POST /api/admin/militares` (expandido)

**Auth:** role `admin` OU role `master`  
**New fields:** `foto_url?: string | null`  
**Master restrictions:** role deve ser `military` apenas

**Response:** `{ success: true, user_id: string }`

### `POST /api/admin/users` (expandido)

**Auth:** role `admin` OU role `master`  
**Master restrictions:** body.role não pode ser `admin` ou `master`  
**Side effect:** Cria notificação `account_created` para o novo usuário

### `GET /api/notifications`

**Auth:** qualquer role autenticado  
**Response:** `{ notifications: Notification[], unread_count: number }`  
Retorna apenas notificações do caller (user_id = auth.uid())

### `PATCH /api/notifications/[id]`

**Auth:** qualquer role autenticado, apenas suas próprias notificações  
**Body:** `{ read: true }`  
**Response:** `{ success: true }`

---

## 8. E2E Test Cases

### Suite A — Master RBAC
- M01: Armeiro vê botões "Cadastrar Militar" e "Criar Login" em `/armeiro/militares`
- M02: Armeiro abre "Criar Login" — campo Role só mostra "Militar"
- M03: API `/api/admin/users` com master token retorna 403 se body.role = "admin"
- M04: API `/api/admin/users` com master token e role = "military" retorna 200
- M05: API `/api/admin/militares` com master token retorna 200

### Suite B — Foto no cadastro
- F01: Campo foto presente no modal "Cadastrar Militar"
- F02: Preview aparece ao selecionar arquivo
- F03: Cadastro com foto salva foto_url no perfil

### Suite C — Biometria UI
- B01: Checkbox "Capturar biometria" presente no modal
- B02: FingerSelector aparece ao marcar checkbox
- B03: Seleção de dedo atualiza estado
- B04: Botão "Capturar" chama BFF endpoint

### Suite D — Notificações
- N01: Bell mostra badge com contagem de não lidas
- N02: Click no bell abre sheet com lista
- N03: Click em notificação marca como lida
- N04: Após criar login, nova notificação aparece para o usuário

---

## 9. QA Checklist

- [ ] Admin pode criar military, master e admin via "Criar Login"
- [ ] Master pode criar APENAS military via "Criar Login"
- [ ] API rejeita master tentando criar admin (403)
- [ ] Foto aparece na lista de militares após cadastro
- [ ] FingerSelector funciona em mobile (touch)
- [ ] Notificação aparece após criação de login
- [ ] Bell badge some após marcar todas como lidas
- [ ] 15/15 tests em crud-usuarios-create.spec.ts passando
- [ ] Suite armeiro-cadastro.spec.ts: M01-M05, F01-F03, B01-B04, N01-N04

---

## 10. Decisões de Design

| Decisão | Razão |
|---------|-------|
| Master não vê opção de role admin/master no dialog | Segurança: armeiro não pode se auto-promover nem promover outros |
| Foto upload client-side direto para Storage | Evita passar arquivo base64 pela edge API (tamanho) |
| Biometria no mesmo modal de cadastro (step optional) | UX: um fluxo só, não múltiplas páginas para cadastro simples |
| Notificação síncrona no POST (não queue) | MVP: simplifica stack; queue é FASE 4 com BFF |
| finger_index padrão = 2 (indicador direito) | Padrão policial/militar mais ergonômico |
