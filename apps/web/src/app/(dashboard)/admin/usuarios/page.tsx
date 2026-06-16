export const runtime = 'edge';

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SearchInput } from "./search-input";
import { UserRowActions, AdminUserToolbar } from "./_user-actions";

type Profile = {
  id: string;
  nome_completo: string;
  matricula: string;
  email: string | null;
  role: "admin" | "master" | "usuario";
  registration_status: "pending_biometric" | "complete" | "inactive";
  posto: string | null;
  unidade: string | null;
  telefone: string | null;
  foto_url: string | null;
  created_at: string;
};

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

function StatusBadge({ status }: { status: Profile["registration_status"] }) {
  const map: Record<Profile["registration_status"], { label: string; cls: string }> = {
    complete: { label: "Completo", cls: "badge-success" },
    pending_biometric: { label: "Pendente", cls: "badge-warning" },
    inactive: { label: "Inativo", cls: "badge-danger" },
  };
  const { label, cls } = map[status] ?? { label: status, cls: "badge-neutral" };
  return (
    <span className={`${cls} text-[11px] font-semibold px-2.5 py-0.5 rounded-full`}>
      {label}
    </span>
  );
}

function RoleBadge({ role }: { role: Profile["role"] }) {
  const map: Record<Profile["role"], { label: string; style: React.CSSProperties }> = {
    admin: {
      label: "Admin",
      style: { backgroundColor: "#DBEAFE", color: "#1D4ED8" },
    },
    master: {
      label: "Reserva de Armamento",
      style: { backgroundColor: "#EDE9FE", color: "#5B21B6" },
    },
    military: {
      label: "Usuário",
      style: { backgroundColor: "#F3F4F6", color: "#374151" },
    },
  };
  const { label, style } = map[role] ?? { label: role, style: {} };
  return (
    <span
      className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full"
      style={style}
    >
      {label}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

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

  if (profile?.role !== "admin") redirect("/");

  const { q } = await searchParams;

  let query = supabase
    .from("profiles")
    .select("id, nome_completo, matricula, email, role, registration_status, posto, nome_de_guerra, unidade, telefone, foto_url, created_at")
    .order("created_at", { ascending: false });

  const { data: users } = await query;

  const { data: activeItems } = await supabase
    .from("lendings")
    .select("military_id")
    .eq("status", "ativo");

  const activeCountMap: Record<string, number> = {};
  for (const item of activeItems ?? []) {
    activeCountMap[item.military_id] = (activeCountMap[item.military_id] ?? 0) + 1;
  }

  // Filter client-side after fetch (edge-compatible ilike alternative)
  const filtered = (users ?? []).filter((u: Profile) => {
    if (!q) return true;
    const term = q.toLowerCase();
    return (
      u.nome_completo.toLowerCase().includes(term) ||
      u.matricula.toLowerCase().includes(term)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Usuários</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Gerenciamento de militares
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="size-3.5" />
            {filtered.length}{" "}
            {filtered.length === 1 ? "militar cadastrado" : "militares cadastrados"}
          </span>
          <AdminUserToolbar />
        </div>
      </div>

      {/* Search */}
      <SearchInput defaultValue={q} />

      {/* Table */}
      <div
        className="rounded-2xl bg-card overflow-hidden"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="size-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">
              {q ? `Nenhum resultado para "${q}"` : "Nenhum usuário cadastrado"}
            </p>
            {q && (
              <p className="text-xs text-muted-foreground mt-1">
                Tente buscar por outro nome ou matrícula
              </p>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border hover:bg-transparent">
                <TableHead className="pl-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Militar
                </TableHead>
                <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Matrícula
                </TableHead>
                <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">
                  Posto
                </TableHead>
                <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Papel
                </TableHead>
                <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Status
                </TableHead>
                <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell text-right">
                  Cadastro
                </TableHead>
                <TableHead className="pr-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">
                  Ações
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((u: Profile) => (
                <TableRow
                  key={u.id}
                  className="border-b border-border/60 hover:bg-muted/40 transition-colors"
                >
                  {/* Avatar + Nome */}
                  <TableCell className="pl-5 py-3">
                    <div className="flex items-center gap-3">
                      {u.foto_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={u.foto_url}
                          alt={u.nome_completo}
                          className="w-8 h-8 rounded-full object-cover shrink-0 ring-1 ring-border"
                        />
                      ) : (
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0"
                          style={{ backgroundColor: "#1B3A8C" }}
                          aria-hidden="true"
                        >
                          {getInitials(u.nome_completo)}
                        </div>
                      )}
                      <span className="text-sm font-medium text-foreground leading-tight">
                        {u.nome_completo}
                      </span>
                    </div>
                  </TableCell>

                  {/* Matrícula */}
                  <TableCell className="py-3">
                    <span className="text-sm font-mono text-muted-foreground">
                      {u.matricula}
                    </span>
                  </TableCell>

                  {/* Posto */}
                  <TableCell className="py-3 hidden sm:table-cell">
                    <span className="text-sm text-foreground">
                      {u.posto ?? <span className="text-muted-foreground">—</span>}
                    </span>
                  </TableCell>

                  {/* Role */}
                  <TableCell className="py-3">
                    <RoleBadge role={u.role} />
                  </TableCell>

                  {/* Status */}
                  <TableCell className="py-3">
                    <StatusBadge status={u.registration_status} />
                  </TableCell>

                  {/* Data */}
                  <TableCell className="py-3 hidden md:table-cell text-right">
                    <span className="text-xs text-muted-foreground">
                      {formatDate(u.created_at)}
                    </span>
                  </TableCell>

                  {/* Actions */}
                  <TableCell className="pr-5 py-3">
                    <UserRowActions
                      user={{
                        id: u.id,
                        nome_completo: u.nome_completo,
                        matricula: u.matricula,
                        email: u.email,
                        role: u.role,
                        registration_status: u.registration_status,
                        posto: u.posto,
                        nome_de_guerra: u.nome_de_guerra ?? null,
                        unidade: u.unidade,
                        telefone: u.telefone,
                        foto_url: u.foto_url,
                        activeCount: activeCountMap[u.id] ?? 0,
                      }}
                      currentUserId={user.id}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
