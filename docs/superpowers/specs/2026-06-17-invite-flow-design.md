# Fluxo de Convite de Login — Design Spec
**Data:** 2026-06-17  
**Status:** Aprovado para implementação

---

## Problema

O cadastro de militares está fragmentado em dois diálogos separados ("Cadastrar Militar" + "Criar Login"), exigindo múltiplos passos para um processo simples. Não há rastreamento de se o convite foi enviado, aceito ou expirou. O grid mostra apenas "Completo/Pendente" sem detalhar as 3 pendências reais: biometria, TOTP e conta de acesso.

---

## Objetivos

1. **Cadastro unificado** — um único formulário cria o perfil E envia convite se email for fornecido
2. **Re-envio de convite** — para militares existentes que perderam o link ou ele expirou
3. **3 pendências rastreadas** — biometria, TOTP, conta (com status do convite)
4. **2-way real-time sync** — Supabase Realtime atualiza o grid automaticamente

---

## Estado das Pendências

```
┌──────────────┬────────────────────────────────────────────────────┐
│ Pendência    │ Estados possíveis                                  │
├──────────────┼────────────────────────────────────────────────────┤
│ Biometria    │ Pendente | Completa (registeredFingers.length > 0) │
│ TOTP         │ Pendente | Configurado (profiles.totp_configured)  │
│ Conta        │ Sem convite | Convite enviado | Conta ativa        │
└──────────────┴────────────────────────────────────────────────────┘
```

**Badge "Completo" (verde) só aparece quando as 3 pendências estão resolvidas.**

---

## Modelo de Dados

### Migration: `20260617000003_invite_tracking.sql`

```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS invite_sent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS account_activated_at TIMESTAMPTZ;

-- Trigger: marca account_activated_at no primeiro login real do militar
CREATE OR REPLACE FUNCTION public.handle_user_first_login()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.last_sign_in_at IS NOT NULL AND OLD.last_sign_in_at IS NULL THEN
    UPDATE public.profiles
    SET account_activated_at = NEW.last_sign_in_at
    WHERE id = NEW.id AND account_activated_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_first_login ON auth.users;
CREATE TRIGGER on_first_login
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_first_login();
```

---

## API

### `POST /api/admin/users` (atualizado)

**Novos campos aceitos:**
- `existing_user_id?: string` — UUID de perfil existente; re-envia convite para esse militar
- Quando `existing_user_id` é fornecido: atualiza email do auth user, envia novo convite, atualiza `profiles.invite_sent_at`

**Mudança:** remove `registration_status: "complete"` do upsert — novos usuários ficam `"pending_biometric"`.

**Resposta:** `{ success: true, user_id: string, invite_sent: boolean }`

### `POST /api/admin/militares` (atualizado)

**Novos campos:**
- `email?: string` — quando fornecido, delega para o fluxo de `/api/admin/users` internamente
- `invite_method?: "magic_link" | "password"` — método de acesso se email fornecido
- `password?: string` — senha temporária se método for `password`

---

## UI

### Cadastrar Militar (unificado)

Novo bloco "Acesso ao Sistema" no formulário:

```
┌─────────────────────────────────────────────────────┐
│ ☐  Criar acesso ao sistema agora                    │
│    (opcional — pode ser feito depois)               │
│                                                     │
│  [quando marcado aparece:]                          │
│  Método: ● Magic Link  ○ Senha temporária           │
│  E-mail: [___________________________]              │
│  [campo senha — só se método=senha]                 │
└─────────────────────────────────────────────────────┘
```

### Criar Login / Re-enviar Convite

Novo campo no topo do dialog "Criar Login":

```
┌─────────────────────────────────────────────────────┐
│ Buscar militar existente (opcional)                 │
│ [______________________________] ← busca por nome/mat│
│ [resultado: Roberto Alves — Maj — 0000077] ← click │
│  → auto-preenche Nome, Matrícula, Posto, Unidade    │
│  → foca no campo e-mail                             │
└─────────────────────────────────────────────────────┘
```

Quando militar existente selecionado:
- Se já tem email → mostra email atual, botão "Re-enviar convite"
- Se não tem email → exige e-mail novo
- Aviso se `invite_sent_at` recente (< 10 min): "Convite enviado há X min. Tem certeza?"

### Grid de Usuários

Nova coluna "Status" mostrando 3 mini-badges verticais:

```
Bio     TOTP    Conta
●verde  ●âmbar  ●azul
Feita   Pend.   Enviado
```

OU linha única com ícones compactos:
```
🟢 🟡 🔵  →  expandível no hover
```

Quando todas 3 verdes: badge único "Completo" (green).
Quando pendências: badge "X pendência(s)" (amber) + tooltip com detalhes.

### Real-time Sync

```typescript
supabase
  .channel('profiles-grid')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'profiles',
  }, (payload) => {
    setUsers(prev => prev.map(u => 
      u.id === payload.new.id ? { ...u, ...payload.new } : u
    ));
  })
  .subscribe();
```

Cleanup no unmount. Atualiza apenas os campos relevantes (optimistic merge).

---

## Fluxos

### Fluxo A — Cadastro com convite imediato
```
Admin abre "Cadastrar Militar"
→ Preenche dados + marca "Criar acesso agora" + e-mail
→ [Cadastrar]
→ POST /api/admin/militares (cria profile interno)
→ POST /api/admin/users { existing_user_id, email, method }
→ Invite enviado, profiles.invite_sent_at = now()
→ Toast: "Militar cadastrado e convite enviado para email@..."
→ Grid atualiza via Realtime
```

### Fluxo B — Re-envio para militar existente
```
Armeiro abre "Criar Login"
→ Busca "Roberto Alves" → seleciona
→ Campos auto-preenchem
→ Digita email (se não tiver) ou confirma email atual
→ [Enviar convite]
→ PUT /api/admin/users/resend { profile_id, email }
→ Supabase: updateUserById + inviteUserByEmail
→ profiles.invite_sent_at = now()
→ Toast: "Convite reenviado para email@..."
```

### Fluxo C — Militar clica no link
```
Militar recebe e-mail → clica "Acessar sistema"
→ Supabase autentica via magic link
→ Trigger on_first_login: profiles.account_activated_at = now()
→ Supabase Realtime → grid admin atualiza badge "Conta" para ✓
→ Militar vê dashboard cadete com TOTP auto-configurado
```

---

## Edge Cases

| Caso | Comportamento |
|------|---------------|
| Convite enviado há < 10 min | Aviso + confirmação antes de re-enviar |
| Email já existe no sistema | Erro 409 com mensagem clara |
| Link expirado (> 24h) | `invite_sent_at` > 24h + `account_activated_at IS NULL` → badge "Convite expirado" (âmbar escuro) |
| Militar sem email registrado | Badge "Sem acesso" (cinza) + botão "Enviar convite" visível na linha |
| Militar inativo | Bloqueio: não permite enviar convite |

---

## Testes Playwright (`apps/web/e2e/login-invite.spec.ts`)

### Suite LI — Login Invite Flow (20 testes)

| Código | Descrição |
|--------|-----------|
| LI01 | Cadastrar militar com "Criar acesso agora" envia convite + perfil criado |
| LI02 | Cadastrar militar SEM "Criar acesso agora" → sem invite_sent_at |
| LI03 | Re-envio via "Criar Login" → busca military, auto-fill, envia |
| LI04 | Re-envio < 10 min → alerta de confirmação aparece |
| LI05 | Email duplicado → 409 com mensagem clara |
| LI06 | Grid mostra "Bio Pendente" para novo cadastro sem biometria |
| LI07 | Grid mostra "TOTP Pendente" para novo cadastro sem TOTP |
| LI08 | Grid mostra "Convite enviado" após invite_sent_at |
| LI09 | Grid mostra "Conta ativa" após primeiro login (via trigger) |
| LI10 | Grid mostra "Completo" quando bio+totp+conta todos OK |
| LI11 | Realtime: badge atualiza sem reload após trigger |
| LI12 | Armeiro (master) só pode criar/re-enviar para "usuario" |
| LI13 | Armeiro não pode criar admin/master → 403 |
| LI14 | Campo busca retorna resultados por nome parcial |
| LI15 | Campo busca retorna resultados por matrícula |
| LI16 | Auto-fill preenche nome, posto, matrícula, unidade |
| LI17 | Método "Senha" exibe campo senha temporária |
| LI18 | Senha < 6 chars → erro de validação |
| LI19 | Militar inativo → botão enviar desabilitado |
| LI20 | Convite expirado badge (> 24h sem ativação) visível no grid |
