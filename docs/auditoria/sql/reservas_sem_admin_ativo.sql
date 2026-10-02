-- SOMENTE LEITURA (SELECT). D-04: lista as reservas SEM admin_reserva ATIVO.
-- Admin ativo = profiles.role = 'admin_reserva', conta não suspensa
-- (inactive / impedimento_administrativo) e convite aceito (convite enviado, sem
-- account_activated_at e cadastro não 'complete' = pendente).
SELECT r.id, r.nome, r.acronym, r.status, t.nome AS tenant,
  COUNT(*) FILTER (WHERE p.id IS NOT NULL AND p.role = 'admin_reserva'
    AND COALESCE(p.registration_status::text,'') NOT IN ('inactive','impedimento_administrativo')
    AND NOT (p.invite_sent_at IS NOT NULL AND p.account_activated_at IS NULL AND p.registration_status::text <> 'complete')) AS admins_ativos,
  COUNT(*) FILTER (WHERE p.id IS NOT NULL AND p.role = 'admin_reserva'
    AND p.invite_sent_at IS NOT NULL AND p.account_activated_at IS NULL AND p.registration_status::text <> 'complete')       AS admins_convite_pendente,
  COUNT(*) FILTER (WHERE p.id IS NOT NULL AND p.role = 'admin_reserva'
    AND p.registration_status::text IN ('inactive','impedimento_administrativo')) AS admins_suspensos
FROM reserves r
LEFT JOIN tenants t ON t.id = r.tenant_id
LEFT JOIN reserve_memberships m ON m.reserve_id = r.id AND m.role = 'admin_reserva'
LEFT JOIN profiles p ON p.id = m.user_id
GROUP BY r.id, r.nome, r.acronym, r.status, t.nome
HAVING COUNT(*) FILTER (WHERE p.id IS NOT NULL AND p.role = 'admin_reserva'
    AND COALESCE(p.registration_status::text,'') NOT IN ('inactive','impedimento_administrativo')
    AND NOT (p.invite_sent_at IS NOT NULL AND p.account_activated_at IS NULL AND p.registration_status::text <> 'complete')) = 0
ORDER BY t.nome, r.nome;
