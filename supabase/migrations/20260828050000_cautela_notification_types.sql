-- ═══════════════════════════════════════════════════════════════════
-- CAULC-02 — Novos tipos de notificação para vencimento de cautela.
-- Migration PRÓPRIA e separada de qualquer coisa que use estes valores
-- (Postgres não permite usar um valor de enum recém-adicionado via
-- ADD VALUE na mesma transação em que foi criado — cada migration do
-- Supabase já roda em sua própria transação, então isto precisa
-- continuar sendo o único conteúdo deste arquivo).
-- ═══════════════════════════════════════════════════════════════════

ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'cautela_vencendo';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'cautela_vencida';
