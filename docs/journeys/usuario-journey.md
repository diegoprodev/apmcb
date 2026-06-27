# Jornada do Usuário (Cadete / Militar)

**Role:** `usuario` (mapeado como `usuario` no frontend)  
**Contexto:** Militar da organização que solicita, retira e devolve armamento e equipamentos. Tem acesso exclusivamente aos seus próprios dados: suas cautelas, suas saídas, seus pedidos. Não vê dados de outros militares.  
**Interface frontend:** `/cadete` — sidebar com 4 seções.

---

## ICP (Ideal Customer Profile)

- Soldado, Cabo, Sargento ou Oficial que necessita de equipamentos
- Primeiro usuário de um sistema digital — pode ser primeira experiência com autenticação 2FA
- Recebe convite por email e completa cadastro autonomamente
- Interage com o sistema principalmente no momento de retirar e devolver material

---

## Páginas Acessíveis

| Rota | Descrição |
|---|---|
| `/cadete` | Dashboard — "Meus Materiais" — visão geral do que tem em mãos |
| `/cadete/minhas-cautelas` | Cautelas ativas (longo prazo) |
| `/cadete/historico` | Histórico de saídas e devoluções |
| `/cadete/perfil` | Dados pessoais + setup de TOTP + biometria |

---

## Jornada Passo a Passo

### Cenário: Primeiro Acesso — Setup Completo e Primeira Retirada

#### 1. Receber Convite

Admin global cria o perfil e o sistema envia magic link via email:

```
De: noreply@supabase.io
Assunto: "Acesso ao Sistema APMCB — Defina sua senha"
Link: https://apmcb.pages.dev/auth/callback?code=xxx&type=magiclink
```

#### 2. Ativar Conta

1. Clica no link do email
2. Frontend processa callback: `POST /api/auth/exchange` com o `access_token` + `refresh_token` da Supabase
3. Iron-session criada
4. Sistema detecta `registration_status = "pending"` → redireciona para `/auth/confirmar-conta`
5. Militar define senha:
   - Mínimo 8 caracteres
   - Confirmação de senha
   - `PATCH /api/auth/password` → senha salva em `auth.users`

#### 3. Completar Cadastro — Biometria

**Na reserva de armamento (presencialmente):**

1. Armeiro acessa `/reserva/militares`
2. Busca o militar pelo nome ou matrícula
3. Clica "Registrar Biometria"
4. Coloca dedo do militar no leitor

```http
POST /api/biometric/capture
{ profile_id: "uuid-do-militar" }
→ { template_id, ok: true }
```

`registration_status` muda para `"complete"` após biometria registrada.

#### 4. Configurar TOTP (Autenticador)

1. Militar acessa `/cadete/perfil`
2. Vê alerta: "Configure seu autenticador para poder confirmar retiradas e assinar cautelas"
3. Clica "Configurar TOTP"

```http
GET /api/nexus/setup-2fa
→ { qr_code_url, secret, expires_in_seconds: 600 }
```

4. Abre Google Authenticator / Authy no celular
5. Scanneia QR Code → conta "APMCB — Silva" aparece
6. Insere o código de 6 dígitos exibido:

```http
POST /api/nexus/setup-2fa/confirm
{ token: "123456" }
→ { ok: true }
# totp_configured = true
```

#### 5. Dashboard — Meus Materiais

Acessa `/cadete` e vê:

```
┌─────────────────────────────┐
│  0 itens em uso             │ ← GET /api/lendings (ativos)
│  0 cautelas ativas          │ ← GET /api/cautelamentos/ativos
│  0 solicitações pendentes   │ ← (implícito)
└─────────────────────────────┘
```

Se tiver material: card com nome do item, tipo, data de saída, prazo (se houver).

#### 6. Confirmar Recebimento de Material

Quando armeiro cria saída para o militar:

1. Militar vai à reserva
2. Armeiro identifica via biometria ou matrícula
3. Armeiro cria saída e assina (POST sign-armeiro)
4. Armeiro apresenta o terminal ou item para o militar confirmar
5. Militar insere seu TOTP:

```http
POST /api/saidas/{saida_id}/confirm
{ totp_token: "789012" }
→ { ok: true, status: "ativa" }
```

Material aparece em `/cadete` e em `/cadete/historico`.

#### 7. Assinar Termo de Cautela

Para cautelas de longo prazo (armeiro já criou e assinou):

```http
POST /api/cautelamentos/{cautela_id}/sign-militar
{ totp_token: "456789" }
→ { ok: true, status: "ativa_assinada" }
# PDF gerado automaticamente com ambas as assinaturas
```

Baixar PDF:
```http
GET /api/cautelamentos/{cautela_id}/pdf
→ Content-Type: application/pdf
# Documento assinado eletronicamente
```

#### 8. Ver Cautelas Ativas

1. Navega para `/cadete/minhas-cautelas`

```http
GET /api/cautelamentos/ativos
→ {
  cautelas: [
    {
      id: "uuid",
      item: { nome: "Pistola Taurus PT100", tipo: "arma_curta" },
      motivo_emissao: "Escolta especial",
      data_emissao: "2026-06-20",
      prazo_previsto: "2026-06-27"
    }
  ]
}
```

#### 9. Ver Histórico

1. Navega para `/cadete/historico`

```http
GET /api/lendings  # com filtro military_id implícito pela sessão
→ {
  saidas: [
    {
      item: "Fuzil FA-MAS #001",
      data_saida: "2026-06-25T14:00:00Z",
      data_devolucao: "2026-06-25T22:00:00Z",
      condicao_devolucao: "bom",
      status: "devolvida"
    }
  ]
}
```

#### 10. Reportar Ocorrência

Militar detecta problema com material:

```http
POST /api/ocorrencias
{
  tipo: "dano",
  descricao: "Carregadeira da Pistola PT100 trincada ao manusear",
  item_id: "uuid-pistola"
}
→ { ocorrencia_id, status: "aberta" }
```

Armeiro e admin recebem notificação.

Acompanhar:
```http
GET /api/ocorrencias  # filtra por reporter_id da sessão
→ { ocorrencias: [{ id, status: "resolvida", resolucao: "Encaminhado para manutenção" }] }
```

#### 11. Atualizar Perfil

```http
PATCH /api/profiles/{user_id}
{
  nome_de_guerra: "Silva",
  telefone: "+55 83 99999-0001"
}
→ { ok: true }
```

Foto de perfil: não pode alterar via frontend (apenas admin_global faz upload via `/api/admin/upload-photo`).

#### 12. Logout

```http
POST /api/auth/logout
→ iron-session destruída → redireciona para /login
```

---

## RBAC — O Que o Usuario NÃO Pode Fazer

| Ação Bloqueada | Motivo |
|---|---|
| Criar saídas de material | Apenas `armeiro` / `admin_reserva` |
| Emitir cautelas | Apenas `armeiro` / `admin_reserva` |
| Assinar como armeiro | Roles de operação da reserva |
| Criar passagens de turno | Apenas `armeiro` / `admin_reserva` |
| Ver dados de outros militares | Todos os queries filtrados por `userId` da sessão |
| Acessar `/reserva`, `/admin` | Acesso negado (roleGuard) — redirecionado para `/cadete` |
| Resolver ocorrências | Apenas `armeiro`, `admin_reserva`, `admin_global` |
| Cancelar cautela alheia | Apenas o armeiro que emitiu |
| Deletar qualquer dado | Operação não disponível para esta role |

---

## Controles de Segurança

| Controle | Implementação |
|---|---|
| Dados isolados por userId | Todos os GETs filtram por `military_id = session.userId` |
| TOTP obrigatório para confirmações | `validateTotp()` em sign-militar e /api/saidas/:id/confirm |
| Status de impedimento bloqueia operações | `registration_status = "impedimento_administrativo"` → 403 em qualquer ação |
| Biometria registrada presencialmente | Armeiro captura na reserva — não pode ser feito remotamente |
| Magic link tem prazo | Links de ativação expiram em 24h |

---

## Fluxo de Primeiro Acesso (Resumo)

```
1. Recebe email com magic link
   ↓
2. Define senha em /auth/confirmar-conta
   ↓
3. Vai até a reserva → armeiro registra biometria
   ↓  registration_status = "complete"
4. Acessa /cadete/perfil → scanneia QR code → TOTP configurado
   ↓  totp_configured = true
5. Pronto para confirmar saídas e assinar cautelas
```

---

## Fluxo de Retirada de Material (Resumo)

```
Militar vai à reserva
  ↓
Armeiro identifica por biometria
  ↓
Armeiro cria saída → assina com seu TOTP
  ↓
Militar confirma recebimento com seu TOTP
  ↓ [Material aparece em /cadete]
Militar usa por horas / dias
  ↓
Militar devolve na reserva
  ↓
Armeiro registra devolução
  ↓ [Item some do dashboard, aparece em /cadete/historico]
```
