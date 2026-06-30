# Spec: Controle de Acesso Remoto SSA por Reserva

> **Status:** Rascunho — aguarda aprovação  
> **DoD:** `docs/enterprise/07-canonical-definition-of-done.md`  
> **Princípios:** SRP · DRY · SSOT · KISS · YAGNI · SoC · Fail Fast · Tenant Isolation

---

## Problema

O sistema SSA (Solicitação de Armamento) permite que qualquer usuário de um tenant requisite material de qualquer reserva do tenant. Isso é correto para usuários *internos* da reserva. Porém, alguns tenants possuem múltiplos departamentos/batalhões/companhias, e cada reserva pode querer restringir o acesso de usuários externos (de outras unidades).

**Requisito:** `admin_reserva` deve poder habilitar/desabilitar o acesso remoto a sua reserva — ou seja, se usuários de outras unidades do mesmo tenant podem requisitar materiais dessa reserva.

**Isolamento:** Tenants permanecem completamente isolados entre si. Este controle é *intra-tenant* apenas.

---

## Definição de Comportamento

| `allow_remote_requests` | Usuário da mesma reserva | Usuário de outra unidade (mesmo tenant) |
|---|---|---|
| `true` (padrão) | Pode requisitar | Pode requisitar |
| `false` | Pode requisitar | **Bloqueado** — não vê materiais nem pode submeter |

**"Usuário da mesma unidade"** = `reserve_memberships.reserve_id` bate com a `reserve_id` da reserva alvo.

**"Usuário sem membership"** (ex.: usuário `role=usuario` sem `reserve_memberships`) = sempre tratado como externo.

---

## Escopo de Dados

### Tabela `reserves` (alteração)

```sql
ALTER TABLE reserves
  ADD COLUMN allow_remote_requests BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN reserves.allow_remote_requests IS
  'Quando false, bloqueia requisições SSA de usuários sem membership nesta reserva.';
```

### RLS

Nenhuma alteração de RLS necessária — a coluna é lida pelo BFF via service_role. A verificação é feita no nível de aplicação (BFF), não de banco.

---

## Endpoints BFF

### 1. `PATCH /api/reserves/:id/settings` — configurar acesso remoto

- **Roles:** `admin_reserva`, `admin_global`, `superadmin`
- **Guard de tenant:** `reserve.tenant_id === session.tenantId`
- **Guard de reserva (admin_reserva):** só pode editar a própria reserva (`reserve.id === session.reserveId`)
- **Body:** `{ allow_remote_requests: boolean }`
- **Resposta:** `{ ok: true, reserve: { id, nome, allow_remote_requests } }`

```typescript
// apps/bff/src/routes/reserves.ts
reservesRoutes.patch(
  "/:id/settings",
  roleGuard("admin_reserva", "admin_global", "superadmin"),
  async (c) => {
    const { id } = c.req.param();
    const tenantId = c.get("tenantId");
    const reserveId = c.get("reserveId");
    const role = c.get("role");
    const body = await c.req.json<{ allow_remote_requests: boolean }>();

    // tenant isolation
    const { data: reserve } = await supabase
      .from("reserves")
      .select("id, nome, tenant_id, allow_remote_requests")
      .eq("id", id)
      .eq("tenant_id", tenantId!)
      .single();
    if (!reserve) return c.json({ error: "Reserva não encontrada" }, 404);

    // admin_reserva só edita a própria reserva
    if (role === "admin_reserva" && reserve.id !== reserveId) {
      return c.json({ error: "Acesso negado à reserva" }, 403);
    }

    const { data: updated, error } = await supabase
      .from("reserves")
      .update({ allow_remote_requests: body.allow_remote_requests })
      .eq("id", id)
      .select("id, nome, allow_remote_requests")
      .single();

    if (error) return c.json({ error: error.message }, 500);
    return c.json({ ok: true, reserve: updated });
  }
);
```

### 2. `GET /api/ssa/available-materials` — filtrar por `allow_remote_requests`

Lógica adicional ao endpoint existente:

```typescript
// Determinar se o usuário é membro da reserva alvo
const userId = c.get("userId");

if (reserveId) {
  // Verificar se a reserva aceita externos
  const { data: reserve } = await supabase
    .from("reserves")
    .select("allow_remote_requests")
    .eq("id", reserveId)
    .eq("tenant_id", tenantId)
    .single();

  if (!reserve) return c.json({ error: "Reserva não encontrada" }, 404);

  if (!reserve.allow_remote_requests) {
    // Checar se o usuário tem membership nesta reserva
    const { data: membership } = await supabase
      .from("reserve_memberships")
      .select("reserve_id")
      .eq("user_id", userId)
      .eq("reserve_id", reserveId)
      .maybeSingle();

    if (!membership) {
      return c.json([]); // externo → sem materiais visíveis
    }
  }
}
```

### 3. `POST /api/ssa/requests` — bloquear submissão de externos

Mesma verificação antes de criar a requisição:

```typescript
// Ao criar SSA request, verificar allow_remote_requests da reserva alvo
const { data: reserve } = await supabase
  .from("reserves")
  .select("allow_remote_requests")
  .eq("id", body.reserve_id)
  .eq("tenant_id", tenantId)
  .single();

if (!reserve) return c.json({ error: "Reserva não encontrada" }, 404);

if (!reserve.allow_remote_requests) {
  const { data: membership } = await supabase
    .from("reserve_memberships")
    .select("reserve_id")
    .eq("user_id", userId)
    .eq("reserve_id", body.reserve_id)
    .maybeSingle();

  if (!membership) {
    return c.json({ error: "Esta reserva não aceita requisições externas." }, 403);
  }
}
```

---

## Frontend — Admin Reserva

### Localização

Painel `admin_reserva` → aba de configurações da reserva (nova seção "Acesso Remoto").

### Componente

```
apps/web/src/components/admin/reserve-remote-access-toggle.tsx
```

```tsx
"use client";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useState } from "react";
import { getBffHeaders } from "@/lib/bff";

interface Props {
  reserveId: string;
  initialValue: boolean;
}

export function ReserveRemoteAccessToggle({ reserveId, initialValue }: Props) {
  const [enabled, setEnabled] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  async function toggle(value: boolean) {
    setSaving(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BFF_URL}/api/reserves/${reserveId}/settings`, {
        method: "PATCH",
        headers: await getBffHeaders(),
        credentials: "include",
        body: JSON.stringify({ allow_remote_requests: value }),
      });
      if (!res.ok) throw new Error();
      setEnabled(value);
      toast.success(value ? "Acesso remoto habilitado." : "Acesso remoto desabilitado.");
    } catch {
      toast.error("Erro ao salvar configuração.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div className="space-y-0.5">
        <Label className="text-base font-medium">Acesso Remoto (SSA)</Label>
        <p className="text-sm text-muted-foreground">
          Permite que usuários de outras unidades do mesmo tenant requisitem
          materiais desta reserva.
        </p>
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={toggle}
        disabled={saving}
        aria-label="Habilitar acesso remoto"
      />
    </div>
  );
}
```

### Integração na página admin_reserva

Adicionar na página `/admin` (seção de configurações da reserva ativa):

```tsx
import { ReserveRemoteAccessToggle } from "@/components/admin/reserve-remote-access-toggle";

// Buscar allow_remote_requests junto com o reserve no SSR
<ReserveRemoteAccessToggle
  reserveId={reserve.id}
  initialValue={reserve.allow_remote_requests ?? true}
/>
```

---

## Migration

```sql
-- supabase/migrations/20260630000003_reserves_allow_remote_requests.sql
ALTER TABLE reserves
  ADD COLUMN IF NOT EXISTS allow_remote_requests BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN reserves.allow_remote_requests IS
  'Quando false, somente membros da reserva podem fazer SSA nela.';
```

---

## Critérios de Aceite (DoD)

| ID | Critério | Como verificar |
|----|----------|----------------|
| SSA-R01 | `allow_remote_requests = true` → usuário externo vê materiais | Teste E2E: login como usuário sem membership, abre sheet, vê lista |
| SSA-R02 | `allow_remote_requests = false` → usuário externo recebe lista vazia | Teste E2E: mesma sessão, desabilitar toggle, recarregar sheet |
| SSA-R03 | `allow_remote_requests = false` → POST SSA retorna 403 para externo | Teste unitário/E2E: chamada direta ao endpoint |
| SSA-R04 | Membro da reserva sempre vê materiais independente do toggle | Teste E2E: usuário com membership na reserva |
| SSA-R05 | `admin_reserva` só altera a própria reserva | Teste: PATCH `/api/reserves/<outra_id>/settings` retorna 403 |
| SSA-R06 | `admin_global` pode alterar qualquer reserva do tenant | Teste: PATCH via admin_global |
| SSA-R07 | Nenhuma query retorna dados de outro tenant | Teste: tenant_id sempre filtrado em todas as queries |
| SSA-R08 | Toggle visível apenas no painel `admin_reserva` e `admin_global` | Visual — DevTools Network sem role adequada |

---

## Ordem de Implementação

```
1. Migration (ADD COLUMN) → aplicar via Supabase MCP
2. BFF: PATCH /api/reserves/:id/settings
3. BFF: filtro allow_remote_requests em available-materials
4. BFF: filtro allow_remote_requests em POST /api/ssa/requests
5. Frontend: ReserveRemoteAccessToggle
6. Frontend: integrar no painel admin_reserva
7. Testes E2E: SSA-R01 a SSA-R08
8. Deploy + smoke test
```

---

## Considerações de Segurança

- A coluna `allow_remote_requests` é lida pelo BFF via service_role — sem exposição de RLS
- A verificação de membership é dupla: no `available-materials` E no `POST /requests` — um bypass em um não compromete o outro (defense-in-depth)
- Tenant isolation é garantida em todos os endpoints por `eq("tenant_id", tenantId)` + guard de 403 se tenantId nulo
- O toggle não expõe a lista de membros da reserva — apenas verifica se o usuário atual é membro
