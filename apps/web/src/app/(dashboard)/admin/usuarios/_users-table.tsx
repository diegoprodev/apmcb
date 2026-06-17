"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserRowActions } from "./_user-actions";

export type UserRow = {
  id: string;
  nome_completo: string;
  matricula: string;
  email: string | null;
  role: "admin" | "master" | "usuario";
  registration_status: "pending_biometric" | "complete" | "inactive";
  posto: string | null;
  nome_de_guerra: string | null;
  unidade: string | null;
  telefone: string | null;
  foto_url: string | null;
  created_at: string;
  activeCount: number;
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

function StatusBadge({ status }: { status: UserRow["registration_status"] }) {
  const map: Record<UserRow["registration_status"], { label: string; cls: string }> = {
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

function RoleBadge({ role }: { role: UserRow["role"] }) {
  const map: Record<string, { label: string; style: React.CSSProperties }> = {
    admin: { label: "Admin", style: { backgroundColor: "#DBEAFE", color: "#1D4ED8" } },
    master: { label: "Reserva de Armamento", style: { backgroundColor: "#EDE9FE", color: "#5B21B6" } },
    military: { label: "Usuário", style: { backgroundColor: "#F3F4F6", color: "#374151" } },
    usuario: { label: "Usuário", style: { backgroundColor: "#F3F4F6", color: "#374151" } },
  };
  const { label, style } = map[role] ?? { label: role, style: {} };
  return (
    <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full" style={style}>
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

interface Props {
  initialUsers: UserRow[];
  currentUserId: string;
  searchQuery?: string;
}

export function UsersTable({ initialUsers, currentUserId, searchQuery }: Props) {
  const [users, setUsers] = useState<UserRow[]>(initialUsers);

  function handleUserUpdated(updated: Partial<UserRow> & { id: string }) {
    setUsers((prev) =>
      prev.map((u) => (u.id === updated.id ? { ...u, ...updated } : u))
    );
  }

  const filtered = users.filter((u) => {
    if (!searchQuery) return true;
    const term = searchQuery.toLowerCase();
    return (
      u.nome_completo.toLowerCase().includes(term) ||
      u.matricula.toLowerCase().includes(term) ||
      (u.nome_de_guerra ?? "").toLowerCase().includes(term) ||
      (u.posto ?? "").toLowerCase().includes(term)
    );
  });

  if (filtered.length === 0) {
    return (
      <div className="p-12 text-center">
        <Users className="size-10 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-sm font-medium text-muted-foreground">
          {searchQuery
            ? `Nenhum resultado para "${searchQuery}"`
            : "Nenhum usuário cadastrado"}
        </p>
        {searchQuery && (
          <p className="text-xs text-muted-foreground mt-1">
            Tente buscar por outro nome ou matrícula
          </p>
        )}
      </div>
    );
  }

  return (
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
        {filtered.map((u) => (
          <TableRow
            key={u.id}
            className="border-b border-border/60 hover:bg-muted/40 transition-colors"
          >
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
                  {[u.posto, u.nome_de_guerra].filter(Boolean).join(" ") || u.nome_completo}
                </span>
              </div>
            </TableCell>

            <TableCell className="py-3">
              <span className="text-sm font-mono text-muted-foreground">
                {u.matricula}
              </span>
            </TableCell>

            <TableCell className="py-3 hidden sm:table-cell">
              <span className="text-sm text-foreground">
                {u.posto ?? <span className="text-muted-foreground">—</span>}
              </span>
            </TableCell>

            <TableCell className="py-3">
              <RoleBadge role={u.role} />
            </TableCell>

            <TableCell className="py-3">
              <StatusBadge status={u.registration_status} />
            </TableCell>

            <TableCell className="py-3 hidden md:table-cell text-right">
              <span className="text-xs text-muted-foreground">
                {formatDate(u.created_at)}
              </span>
            </TableCell>

            <TableCell className="pr-5 py-3">
              <UserRowActions
                user={u}
                currentUserId={currentUserId}
                onUserUpdated={handleUserUpdated}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
