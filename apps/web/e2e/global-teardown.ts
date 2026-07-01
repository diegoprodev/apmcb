import { createClient } from "@supabase/supabase-js";

// ── Padrões que identificam dados criados por testes E2E ──────────────────────
// Convenção obrigatória nos specs:
//   - Usuários temporários: email terminando em @e2e.test  OU matrícula E2E*
//   - Shifts de livro digital: notes começando com [E2E]
//   - Usuários convidados por testes: registration_status='pending' + invited_at set
//     E email contendo '+e2e' ou domínio '@e2e.test'
const E2E_MATRICULA_PREFIX = "E2E";
const E2E_EMAIL_SUFFIX     = "@e2e.test";
const E2E_NOTE_PREFIX      = "[E2E]";

export default async function globalTeardown() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Teardown só executa quando vars de ambiente estão presentes.
  if (!supabaseUrl || !serviceKey) {
    console.log("[teardown] sem credenciais — skipping");
    return;
  }

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let cleaned = 0;

  // ── 1. Cancelar material_requests pendentes de testes SSA/stress ──────────
  const { data: canceledReqs } = await db
    .from("material_requests")
    .update({ status: "cancelado", cancelled_at: new Date().toISOString() })
    .in("status", ["pendente", "aprovado"])
    .select("id");
  const reqCount = canceledReqs?.length ?? 0;
  if (reqCount) {
    console.log(`[teardown] material_requests canceladas: ${reqCount}`);
    cleaned += reqCount;
  }

  // ── 2. Remover usuários temporários (E2E* matricula ou @e2e.test email) ────
  const { data: tempProfiles } = await db
    .from("profiles")
    .select("id, matricula, email")
    .or(`matricula.like.${E2E_MATRICULA_PREFIX}%,email.like.%${E2E_EMAIL_SUFFIX}`);

  if (tempProfiles?.length) {
    const ids = tempProfiles.map((p) => p.id);
    // ON DELETE CASCADE limpa: totp_secrets, notifications, reserve_memberships, tenant_memberships
    await db.from("profiles").delete().in("id", ids);
    // Remove da auth.users (requer service_role)
    const delResults = await Promise.allSettled(
      ids.map((id) => db.auth.admin.deleteUser(id))
    );
    const deleted = delResults.filter((r) => r.status === "fulfilled").length;
    console.log(`[teardown] usuários E2E removidos: ${deleted}/${ids.length}`);
    cleaned += deleted;
  }

  // ── 3. Remover usuários invited-pending criados por testes de convite ──────
  // Identifica por: invited_at NOT NULL + registration_status='pending'
  // + email contém '+e2e' (padrão recomendado nos specs de invite)
  // Seguro: nunca afeta usuários reais que possam ter aceito o convite
  const { data: pendingInvites } = await db
    .from("profiles")
    .select("id, email")
    .eq("registration_status", "pending")
    .like("email", "%+e2e%");

  if (pendingInvites?.length) {
    const ids = pendingInvites.map((p) => p.id);
    await db.from("profiles").delete().in("id", ids);
    await Promise.allSettled(ids.map((id) => db.auth.admin.deleteUser(id)));
    console.log(`[teardown] convites pendentes E2E removidos: ${ids.length}`);
    cleaned += ids.length;
  }

  // ── 4. Fechar service_shifts abertos deixados por testes do livro digital ──
  const closedShifts = await db
    .from("service_shifts")
    .update({ closed_at: new Date().toISOString(), status: "fechado" })
    .eq("status", "aberto")
    .like("notes", `${E2E_NOTE_PREFIX}%`)
    .select("id");
  const shiftCount = closedShifts?.data?.length ?? 0;
  if (shiftCount) {
    console.log(`[teardown] service_shifts fechados: ${shiftCount}`);
    cleaned += shiftCount;
  }

  // ── 5. Resetar TOTP anti-replay dos usuários fixture ─────────────────────
  // Evita que um teste de lockout bloqueie o próximo run
  const fixtureEmails = [
    "cadete@apmcb.dev",
    "armeiro@apmcb.dev",
    "admin@apmcb.dev",
    "admin_reserva@apmcb.dev",
    "auditor@apmcb.dev",
  ];
  const { data: fixtureProfiles } = await db
    .from("profiles")
    .select("id")
    .in("email", fixtureEmails);

  if (fixtureProfiles?.length) {
    const ids = fixtureProfiles.map((p) => p.id);
    await db
      .from("totp_secrets")
      .update({ failure_count: 0, last_failure_at: null, last_used_token: null })
      .in("user_id", ids);
    console.log(`[teardown] TOTP anti-replay resetado para ${ids.length} usuários fixture`);
  }

  // ── 6. Devolver items cautelados por usuários de teste ────────────────────
  // Identifica cautelamentos ativos de usuários E2E (não afeta dados reais)
  const { data: e2eUserIds } = await db
    .from("profiles")
    .select("id")
    .or(`matricula.like.${E2E_MATRICULA_PREFIX}%,email.like.%${E2E_EMAIL_SUFFIX}`);

  if (e2eUserIds?.length) {
    const ids = e2eUserIds.map((p) => p.id);
    const { data: cautelados } = await db
      .from("material_items")
      .select("id")
      .eq("status", "cautelado")
      .in("current_holder_id", ids);

    if (cautelados?.length) {
      const itemIds = cautelados.map((i) => i.id);
      await db
        .from("material_items")
        .update({ status: "disponivel", current_holder_id: null })
        .in("id", itemIds);
      console.log(`[teardown] items devolvidos de usuários E2E: ${itemIds.length}`);
      cleaned += itemIds.length;
    }
  }

  console.log(`[teardown] concluído — ${cleaned} registros limpos`);
}
