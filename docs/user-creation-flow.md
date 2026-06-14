# Fluxo de Criação de Usuários — APMCB

> Spec técnica e funcional do fluxo 2-way sync de criação de contas pelo administrador.

---

## Visão Geral

O administrador cria contas para militares sem exposição de chaves sensíveis no frontend.
O fluxo passa pelo BFF (Next.js API Route em CF Pages, com `SUPABASE_SERVICE_ROLE_KEY` como env var do CF Pages Dashboard — nunca commitada no git).

```
Admin (browser)
  → POST /api/admin/users  (Next.js Route Handler, edge runtime)
    → valida sessão admin (Supabase SSR cookie)
    → chama supabase.auth.admin.inviteUserByEmail() OU createUser()
    → upsert na tabela profiles
  ← { success: true, user_id }
Admin recebe toast de sucesso
Militar recebe e-mail com link de ativação (magic link) OU já pode fazer login (senha)
```

---

## Atores

| Ator | Papel |
|------|-------|
| Administrador | Acessa `/admin/usuarios`, clica "Criar Usuário", preenche o formulário |
| Sistema (BFF/Next.js) | Autentica a chamada e usa service role key para criar conta no Supabase |
| Militar | Recebe e-mail (magic link) ou credenciais; faz primeiro login |

---

## Pré-requisitos

| Requisito | Detalhe |
|-----------|---------|
| `SUPABASE_SERVICE_ROLE_KEY` | Definida no CF Pages Dashboard → Settings → Environment Variables. **Nunca no git.** |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase. Já no CF Pages. |
| `NEXT_PUBLIC_SITE_URL` | `https://apmcb.pmpb.online` — usado no redirectTo do magic link. |
| Supabase Email configurado | SMTP custom ou Supabase built-in para enviar convites. |
| Sessão admin válida | Requirente deve ter `role = 'admin'` na tabela `profiles`. |

---

## Campos do Formulário

| Campo | Obrigatório | Tipo | Observação |
|-------|-------------|------|------------|
| E-mail | Sim | TEXT | Usado para login no Supabase Auth |
| Método de acesso | Sim | magic_link / password | Padrão: magic_link |
| Nome completo | Sim | TEXT | Salvo em `profiles.nome_completo` |
| Matrícula | Sim | TEXT UNIQUE | Identificador militar; salvo em `profiles.matricula` |
| Posto | Não | ENUM | Salvo em `profiles.posto`; padrão `cadete` |
| Papel | Não | ENUM | `military` / `master` / `admin`; padrão `military` |
| Unidade | Não | TEXT | Local de trabalho; salvo em `profiles.unidade` |
| Telefone | Não | TEXT | Salvo em `profiles.telefone` |
| Senha temporária | Cond. | TEXT | Obrigatório quando método = `password`; mínimo 6 chars |

---

## Endpoint

### `POST /api/admin/users`

**Runtime:** `edge`  
**Auth:** Requer sessão admin (cookie `sb-*` via Supabase SSR).

#### Request Body

```json
{
  "email": "militar@pmpb.pb.gov.br",
  "nome_completo": "Ten Fulano da Silva",
  "matricula": "20250001",
  "posto": "Tenente",
  "role": "military",
  "unidade": "1ª Cia",
  "telefone": "(83) 9 9999-9999",
  "method": "magic_link"
}
```

Para método `password`, adicionar `"password": "SenhaForte123"`.

#### Resposta de sucesso `200`

```json
{ "success": true, "user_id": "uuid" }
```

#### Erros

| Status | Mensagem |
|--------|----------|
| 400 | email, nome_completo e matricula são obrigatórios |
| 400 | Senha deve ter ao menos 6 caracteres |
| 403 | Acesso negado |
| 500 | Mensagem do Supabase ou erro interno |

---

## Fluxo Magic Link

```
1. Admin preenche formulário → seleciona "Magic Link" → clica "Enviar convite"
2. Frontend → POST /api/admin/users { method: "magic_link", ... }
3. API Route:
   a. Valida sessão admin
   b. supabase.auth.admin.inviteUserByEmail(email, { redirectTo: "https://apmcb.pmpb.online/login" })
      → Supabase cria user em auth.users com status "invited"
      → Supabase envia e-mail com link único (válido por 24h)
   c. profiles.upsert({ id: userId, ... }) — perfil já populado com dados do admin
4. Admin vê modal de confirmação com e-mail para onde o convite foi enviado
5. Militar clica no link → Supabase redireciona para /login com tokens na URL
6. Supabase Auth troca o token → sessão ativa → militar já tem perfil completo
```

---

## Fluxo Senha Temporária

```
1. Admin seleciona "Senha" → define senha temporária → clica "Criar conta"
2. Frontend → POST /api/admin/users { method: "password", password: "...", ... }
3. API Route:
   a. Valida sessão admin
   b. supabase.auth.admin.createUser({ email, password, email_confirm: true, ... })
      → Supabase cria user em auth.users com e-mail confirmado imediatamente
   c. profiles.upsert({ id: userId, ... })
4. Admin vê modal de confirmação — conta já ativa
5. Admin entrega credenciais ao militar por meio seguro (físico)
6. Militar faz login em /login com e-mail + senha
```

---

## Sincronização com Supabase (2-way)

| Direção | O que acontece |
|---------|---------------|
| **Admin → Supabase** | `auth.admin.inviteUserByEmail` ou `createUser` + `profiles.upsert` |
| **Supabase → Militar** | E-mail com magic link (método magic_link) |
| **Militar → Supabase** | Clica no link → troca token → sessão criada |
| **Supabase → Frontend** | Sessão SSR via cookie `sb-*` → servidor lê dados do perfil |

O perfil (`profiles`) é criado **pelo administrador** no momento da criação da conta, com todos os dados militares já preenchidos. O militar ao fazer o primeiro login já tem acesso completo ao sistema sem precisar preencher dados adicionais.

---

## Segurança

- `SUPABASE_SERVICE_ROLE_KEY` **nunca** é enviada ao browser. Reside apenas no edge worker do CF Pages.
- A API Route valida `role = 'admin'` antes de chamar qualquer método admin.
- Rate limiting aplicado pelo middleware existente (`rateLimitMiddleware` no BFF).
- Matrícula tem constraint `UNIQUE` na tabela `profiles` — tentativa de duplicata retorna erro 500 com mensagem do Supabase.
- Senhas temporárias devem ser trocadas pelo militar após o primeiro login (recomendado comunicar via Supabase Auth `update_user`).

---

## Checklist de Validação (QA / E2E)

- [ ] Botão "Criar Usuário" visível na página `/admin/usuarios`
- [ ] Modal abre com todos os campos
- [ ] Método "Magic Link" selecionado por padrão
- [ ] Campo senha visível somente quando método = "password"
- [ ] Submissão sem e-mail, nome ou matrícula mostra toast de erro
- [ ] Submissão com método password e senha < 6 chars bloqueia
- [ ] Envio com magic link → tela de confirmação → toast NÃO disparado (confirmação é visual)
- [ ] Envio com senha → tela de confirmação visual
- [ ] Usuário aparece na lista após `router.refresh()`
- [ ] Coluna `email` preenchida no registro
- [ ] Coluna `unidade` / `telefone` preenchidos quando informados
- [ ] Tentativa de criar usuário sem sessão admin retorna 403
- [ ] Matrícula duplicada retorna erro legível ao admin

---

## Schema de Banco Relacionado

```sql
-- Colunas adicionadas em 2026-06-14
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS unidade TEXT,
  ADD COLUMN IF NOT EXISTS telefone TEXT;
```

Arquivo de migração: `supabase/migrations/20260614000001_profiles_add_contact_fields.sql`

---

## Arquivos do Fluxo

| Arquivo | Papel |
|---------|-------|
| `apps/web/src/app/(dashboard)/admin/usuarios/_create-user-dialog.tsx` | Modal de criação (client component) |
| `apps/web/src/app/(dashboard)/admin/usuarios/_user-actions.tsx` | `CreateUserButton` + `UserRowActions` |
| `apps/web/src/app/(dashboard)/admin/usuarios/_edit-dialog.tsx` | Modal de edição (expandido com novos campos) |
| `apps/web/src/app/(dashboard)/admin/usuarios/page.tsx` | Página com query e botão |
| `apps/web/src/app/api/admin/users/route.ts` | API Route — usa service role key |
| `apps/web/e2e/crud-usuarios-create.spec.ts` | Harness E2E do fluxo |
