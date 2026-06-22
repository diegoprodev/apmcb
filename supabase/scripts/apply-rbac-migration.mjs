// Script temporário — aplica migration RBAC via service_role (Supabase SDK)
// Usage: node apply-rbac-migration.mjs
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://jepitcrkicwmvzrmllpn.supabase.co";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY não definida");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function run() {
  console.log("Aplicando migration RBAC...");

  // 1. admin → admin_global
  const { data: admins, error: e1 } = await supabase
    .from("profiles")
    .update({ role: "admin_global" })
    .eq("role", "admin")
    .select("id, email, role");
  if (e1) { console.error("Erro admin_global:", e1); process.exit(1); }
  console.log(`  ${admins?.length ?? 0} admin → admin_global`);

  // 2. master → armeiro
  const { data: masters, error: e2 } = await supabase
    .from("profiles")
    .update({ role: "armeiro" })
    .eq("role", "master")
    .select("id, email, role");
  if (e2) { console.error("Erro armeiro:", e2); process.exit(1); }
  console.log(`  ${masters?.length ?? 0} master → armeiro`);

  // 3. tenant_memberships admin → admin_global
  const { error: e3 } = await supabase
    .from("tenant_memberships")
    .update({ role: "admin_global" })
    .eq("role", "admin");
  if (e3) { console.error("Aviso tenant_memberships admin:", e3.message); }

  // 4. tenant_memberships master → armeiro
  const { error: e4 } = await supabase
    .from("tenant_memberships")
    .update({ role: "armeiro" })
    .eq("role", "master");
  if (e4) { console.error("Aviso tenant_memberships master:", e4.message); }

  // 5. Verificar estado final
  const { data: roles } = await supabase
    .from("profiles")
    .select("role, email")
    .order("role");
  console.log("\nEstado final:");
  roles?.forEach(r => console.log(`  ${r.role}: ${r.email}`));
  console.log("\nMigração concluída.");
}

run().catch(err => { console.error(err); process.exit(1); });
