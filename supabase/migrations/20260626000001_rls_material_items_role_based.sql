-- Fase B.2: RLS por role em material_items
-- Aplicado via psql em 2026-06-26 — este arquivo rastreia a operação.
--
-- Contexto: qualquer membro do tenant conseguia ler todos os material_items.
-- Fix: staff (admin/armeiro/auditor) vê tudo; usuário só vê itens que possui ou disponíveis.

-- Tipo ENUM criado mas não usado ainda (migration deferida por trigger dependencies)
CREATE TYPE IF NOT EXISTS public.material_item_status AS ENUM (
  'disponivel',
  'em_saida',
  'em_cautela',
  'em_manutencao',
  'inativo'
);

-- Remover policy genérica anterior se existir
DROP POLICY IF EXISTS "material_items_tenant_member" ON material_items;

-- Staff: admin_global, admin_reserva, superadmin, armeiro, auditor — veem todos os itens do tenant
CREATE POLICY "material_items_staff_select" ON material_items
  FOR SELECT USING (
    tenant_id = (
      SELECT p.tenant_id FROM profiles p WHERE p.id = auth.uid()
    )
    AND (
      SELECT p.role FROM profiles p WHERE p.id = auth.uid()
    ) IN ('admin_global', 'admin_reserva', 'superadmin', 'armeiro', 'auditor')
  );

-- Usuário: só vê itens que possui em cautela ativa ou itens disponíveis do tenant
CREATE POLICY "material_items_usuario_select" ON material_items
  FOR SELECT USING (
    tenant_id = (
      SELECT p.tenant_id FROM profiles p WHERE p.id = auth.uid()
    )
    AND (
      SELECT p.role FROM profiles p WHERE p.id = auth.uid()
    ) = 'usuario'
    AND (
      status_operacional = 'disponivel'
      OR EXISTS (
        SELECT 1 FROM lendings l
        WHERE l.item_id = material_items.id
          AND l.military_id = auth.uid()
          AND l.status NOT IN ('devolvido', 'cancelado')
      )
    )
  );

-- Coluna sessions_invalidated_at para invalidação de sessão por mudança de role
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sessions_invalidated_at TIMESTAMPTZ;
