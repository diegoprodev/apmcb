
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { SearchInput } from "./search-input";
import { AdminUserToolbar } from "./_user-actions";
import { UsersTable } from "./_users-table";
import { resolvePhotosInBulk } from "@/lib/storage";
import type { UserRow } from "./_users-table";

export default async function UsuariosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin_global" && profile?.role !== "admin_reserva") redirect("/");

  const { q } = await searchParams;

  const { data: users } = await supabase
    .from("profiles")
    .select("id, nome_completo, matricula, email, role, registration_status, totp_configured, invite_sent_at, account_activated_at, posto, nome_de_guerra, unidade, telefone, foto_url, created_at")
    .order("created_at", { ascending: false });

  const { data: activeItems } = await supabase
    .from("lendings")
    .select("military_id")
    .eq("status_legacy", "ativo");

  const activeCountMap: Record<string, number> = {};
  for (const item of activeItems ?? []) {
    activeCountMap[item.military_id] = (activeCountMap[item.military_id] ?? 0) + 1;
  }

  const usersBase = (users ?? []).map((u) => ({
    id: u.id,
    nome_completo: u.nome_completo,
    matricula: u.matricula,
    email: u.email,
    role: u.role as UserRow["role"],
    registration_status: u.registration_status as UserRow["registration_status"],
    totp_configured: u.totp_configured ?? false,
    invite_sent_at: u.invite_sent_at ?? null,
    account_activated_at: u.account_activated_at ?? null,
    posto: u.posto ?? null,
    nome_de_guerra: u.nome_de_guerra ?? null,
    unidade: u.unidade ?? null,
    telefone: u.telefone ?? null,
    foto_url: u.foto_url ?? null,
    created_at: u.created_at,
    activeCount: activeCountMap[u.id] ?? 0,
  }));
  const usersResolved = await resolvePhotosInBulk(usersBase, supabase);
  const allUsers: UserRow[] = usersResolved;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Usuários</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Gerenciamento de usuários
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="size-3.5" />
            {allUsers.length}{" "}
            {allUsers.length === 1 ? "usuário cadastrado" : "usuários cadastrados"}
          </span>
          <AdminUserToolbar callerRole={profile.role} />
        </div>
      </div>

      {/* Search */}
      <SearchInput defaultValue={q} />

      {/* Table — client component holds local state for optimistic updates */}
      <div
        className="rounded-2xl bg-card overflow-hidden"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <UsersTable
          key={q ?? ""}
          initialUsers={allUsers}
          currentUserId={user.id}
          searchQuery={q}
        />
      </div>
    </div>
  );
}
