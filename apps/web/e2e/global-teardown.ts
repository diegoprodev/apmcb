import { createClient } from "@supabase/supabase-js";

// Identificadores usados nos specs para marcar dados gerados por testes.
// Padrões: matriculas começando com "E2E", emails "*@e2e.test", notas com prefixo "[E2E]".
const E2E_MATRICULA_PREFIX = "E2E";
const E2E_EMAIL_SUFFIX = "@e2e.test";
const E2E_NOTE_PREFIX = "[E2E]";

export default async function globalTeardown() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Teardown só executa quando as variáveis de ambiente estão presentes (CI e .env.test local).
  // Em runs sem credenciais (ex: só build), sai sem erro.
  if (!supabaseUrl || !serviceKey) return;

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Cancelar material_requests pendentes deixadas por testes de SSA/stress
  await db
    .from("material_requests")
    .update({ status: "cancelado", cancelled_at: new Date().toISOString() })
    .in("status", ["pendente", "aprovado"]);

  // 2. Remover usuários temporários criados com email @e2e.test ou matrícula E2E*
  const { data: tempProfiles } = await db
    .from("profiles")
    .select("id, matricula")
    .or(`matricula.like.${E2E_MATRICULA_PREFIX}%,email.like.%${E2E_EMAIL_SUFFIX}`);

  if (tempProfiles?.length) {
    const ids = tempProfiles.map((p) => p.id);
    // Deleta em cascade: totp_secrets, notifications, audit_logs via FK ON DELETE CASCADE
    await db.from("profiles").delete().in("id", ids);
    // Remove auth.users (service role necessário)
    for (const id of ids) {
      await db.auth.admin.deleteUser(id).catch(() => {});
    }
  }

  // 3. Remover service_shifts abertos deixados por testes de livro digital
  await db
    .from("service_shifts")
    .update({ closed_at: new Date().toISOString(), status: "fechado" })
    .eq("status", "aberto")
    .like("notes", `${E2E_NOTE_PREFIX}%`);

  // 4. Resetar TOTP anti-replay (failure_count e last_used_token) para usuários de teste
  await db
    .from("totp_secrets")
    .update({ failure_count: 0, last_failure_at: null, last_used_token: null })
    .in("user_id", (
      await db.from("profiles").select("id").in("email", [
        "cadete@apmcb.dev",
        "armeiro@apmcb.dev",
        "admin@apmcb.dev",
        "admin_reserva@apmcb.dev",
      ]).then((r) => r.data?.map((p) => p.id) ?? [])
    ));
}
