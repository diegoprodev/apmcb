"use client";

import { useState, useEffect } from "react";
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
import { createClient } from "@/lib/supabase/client";

export type UserRow = {
  id: string;
  nome_completo: string;
  matricula: string;
  email: string | null;
  role: "admin" | "master" | "usuario";
  registration_status: "pending_biometric" | "complete" | "inactive";
  totp_configured: boolean;
  invite_sent_at: string | null;
  account_activated_at: string | null;
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

function minutesSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

function AccountStatusBadge({ user }: { user: UserRow }) {
  const { registration_status: status, totp_configured, invite_sent_at, account_activated_at } = user;

  if (status === "inactive") {
    return <span className="badge-danger text-[11px] font-semibold px-2.5 py-0.5 rounded-full">Inativo</span>;
  }

  // Determine bio, totp, account states
  const bioPending = status === "pending_biometric";
  const totpPending = !totp_configured;

  // Account states
  const accountActive = !!account_activated_at;
  const inviteExpired = invite_sent_at && !account_activated_at &&
    (Date.now() - new Date(invite_sent_at).getTime()) > 24 * 3600 * 1000;
  const inviteSent = !!invite_sent_at && !account_activated_at;
  const noInvite = !invite_sent_at && !account_activated_at;

  const allComplete = !bioPending && !totpPending && accountActive;
  if (allComplete) {
    return <span className="badge-success text-[11px] font-semibold px-2.5 py-0.5 rounded-full">Completo</span>;
  }

  const pendingCount = [bioPending, totpPending, noInvite || inviteSent || inviteExpired].filter(Boolean).length;

  return (
    <div className="flex flex-col gap-1" title={[
      bioPending ? "Biometria pendente" : null,
      totpPending ? "TOTP pendente" : null,
      noInvite ? "Sem convite" : inviteExpired ? "Convite expirado" : inviteSent ? `Convite enviado (${minutesSince(invite_sent_at)} min)` : null,
    ].filter(Boolean).join(" · ")}>
      <span className="text-[10px] text-muted-foreground font-medium">{pendingCount} pendência{pendingCount !== 1 ? "s" : ""}</span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {bioPending && (
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Bio</span>
        )}
        {totpPending && (
          <abbr title="TOTP pendente — código de verificação temporal (6 dígitos, muda a cada 30s) ainda não configurado" className="no-underline">
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 cursor-help">TOTP</span>
          </abbr>
        )}
        {noInvite && (
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500">Sem acesso</span>
        )}
        {inviteSent && !inviteExpired && (
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">Convite env.</span>
        )}
        {inviteExpired && (
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700">Expirado</span>
        )}
        {accountActive && (
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Conta ✓</span>
        )}
      </div>
    </div>
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

  // Supabase Realtime — 2-way sync when profiles table updates
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("admin-profiles-grid")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles" },
        (payload) => {
          setUsers((prev) =>
            prev.map((u) =>
              u.id === payload.new.id
                ? {
                    ...u,
                    registration_status: payload.new.registration_status ?? u.registration_status,
                    totp_configured: payload.new.totp_configured ?? u.totp_configured,
                    invite_sent_at: payload.new.invite_sent_at ?? u.invite_sent_at,
                    account_activated_at: payload.new.account_activated_at ?? u.account_activated_at,
                    email: payload.new.email ?? u.email,
                  }
                : u
            )
          );
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

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
              <AccountStatusBadge user={u} />
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
