
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { AdminUserToolbar } from "@/app/(dashboard)/admin/usuarios/_user-actions";
import { MilitaresTable, type MilitarRow } from "./_militares-table";
import { resolvePhotosInBulk } from "@/lib/storage";

export default async function ArmeiroMilitaresPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "armeiro" && profile?.role !== "admin_global" && profile?.role !== "admin_reserva" && profile?.role !== "superadmin") redirect("/");

  const { data: militares } = await supabase
    .from("profiles")
    .select("id, nome_completo, matricula, foto_url, registration_status, totp_configured, posto, email, nome_de_guerra, unidade, telefone, invite_sent_at, account_activated_at")
    .eq("role", "usuario")
    .order("nome_completo");

  const allMilitares = militares ?? [];
  const militaryIds = allMilitares.map((m) => m.id);

  const [{ data: activeLendings }, { data: bioTemplates }] = await Promise.all([
    militaryIds.length > 0
      ? supabase.from("lendings").select("military_id").in("military_id", militaryIds).eq("status_legacy", "ativo")
      : Promise.resolve({ data: [] }),
    militaryIds.length > 0
      ? supabase.from("biometric_templates").select("user_id, finger_index").in("user_id", militaryIds)
      : Promise.resolve({ data: [] }),
  ]);

  const lendingCountMap: Record<string, number> = {};
  for (const lending of activeLendings ?? []) {
    lendingCountMap[lending.military_id] = (lendingCountMap[lending.military_id] ?? 0) + 1;
  }

  const fingerMap: Record<string, number[]> = {};
  for (const t of bioTemplates ?? []) {
    if (!fingerMap[t.user_id]) fingerMap[t.user_id] = [];
    fingerMap[t.user_id].push(t.finger_index);
  }

  const rowsBase = allMilitares.map((m) => ({
    id: m.id,
    nome_completo: m.nome_completo ?? "",
    matricula: m.matricula ?? "",
    posto: m.posto ?? null,
    foto_url: m.foto_url ?? null,
    email: m.email ?? null,
    nome_de_guerra: m.nome_de_guerra ?? null,
    unidade: m.unidade ?? null,
    telefone: m.telefone ?? null,
    registration_status: m.registration_status as MilitarRow["registration_status"],
    totp_configured: m.totp_configured ?? false,
    registeredFingers: fingerMap[m.id] ?? [],
    activeCount: lendingCountMap[m.id] ?? 0,
    invite_sent_at: m.invite_sent_at ?? null,
    account_activated_at: m.account_activated_at ?? null,
  }));
  const rows: MilitarRow[] = await resolvePhotosInBulk(rowsBase, supabase);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Usuários</h2>
          <p className="text-muted-foreground text-sm mt-1">
            {allMilitares.length} usuário{allMilitares.length !== 1 ? "s" : ""} cadastrado
            {allMilitares.length !== 1 ? "s" : ""}
          </p>
        </div>
        <AdminUserToolbar callerRole="admin_reserva" />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl bg-card p-10 text-center" style={{ boxShadow: "var(--shadow-card)" }}>
          <Users className="size-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">Nenhum usuário cadastrado</p>
          <p className="text-xs text-muted-foreground mt-1">
            Cadastre usuários para gerenciar saídas de material
          </p>
        </div>
      ) : (
        <MilitaresTable militares={rows} currentUserId={user.id} callerRole={profile.role as "admin" | "master"} />
      )}
    </div>
  );
}
