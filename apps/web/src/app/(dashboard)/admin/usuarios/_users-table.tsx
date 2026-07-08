"use client";

import { useState, useEffect, useMemo } from "react";
import { Users, LayoutGrid, Table2, ChevronDown } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserRowActions } from "./_user-actions";
import { GridPdfButton } from "@/components/shared/grid-pdf-button";
import { useSSERefresh } from "@/hooks/use-sse-refresh";
import { cn } from "@/lib/utils";

export type UserRow = {
  id: string;
  nome_completo: string;
  matricula: string;
  email: string | null;
  role: "superadmin" | "admin_global" | "admin_reserva" | "armeiro" | "auditor" | "usuario";
  registration_status: "pending_biometric" | "complete" | "inactive" | "impedimento_administrativo";
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

  const bioPending = status === "pending_biometric";
  const totpPending = !totp_configured;
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
          <abbr title="TOTP pendente" className="no-underline">
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

function UserCard({
  user,
  currentUserId,
  selected,
  onToggle,
  onUserUpdated,
}: {
  user: UserRow;
  currentUserId: string;
  selected: boolean;
  onToggle: (id: string) => void;
  onUserUpdated: (u: Partial<UserRow> & { id: string }) => void;
}) {
  return (
    <div
      data-testid="usuario-card"
      className={cn(
        "rounded-2xl bg-card p-4 flex flex-col gap-3 transition-all",
        selected && "ring-2 ring-primary"
      )}
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(user.id)}
          className="size-4 rounded accent-primary mt-1 shrink-0"
          aria-label={`Selecionar ${user.nome_completo}`}
        />
        {user.foto_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.foto_url}
            alt={user.nome_completo}
            className="w-10 h-10 rounded-full object-cover shrink-0 ring-1 ring-border"
          />
        ) : (
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0"
            style={{ backgroundColor: "#1B3A8C" }}
            aria-hidden="true"
          >
            {getInitials(user.nome_completo)}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">
            {[user.posto, user.nome_de_guerra].filter(Boolean).join(" ") || user.nome_completo}
          </p>
          <p className="text-xs text-muted-foreground font-mono">{user.matricula}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <RoleBadge role={user.role} />
        <AccountStatusBadge user={user} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{formatDate(user.created_at)}</span>
        <UserRowActions user={user} currentUserId={currentUserId} onUserUpdated={onUserUpdated} />
      </div>
    </div>
  );
}

interface Props {
  initialUsers: UserRow[];
  currentUserId: string;
  searchQuery?: string;
}

export function UsersTable({ initialUsers, currentUserId, searchQuery }: Props) {
  const [users, setUsers] = useState<UserRow[]>(initialUsers);
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [displayLimit, setDisplayLimit] = useState(10);
  const [showLimitMenu, setShowLimitMenu] = useState(false);

  // Sync from server after router.refresh() re-renders the parent Server Component.
  useEffect(() => {
    setUsers(initialUsers);
  }, [initialUsers]);

  useSSERefresh("admin-profiles-grid");

  function handleUserUpdated(updated: Partial<UserRow> & { id: string }) {
    setUsers((prev) =>
      prev.map((u) => (u.id === updated.id ? { ...u, ...updated } : u))
    );
  }

  const filtered = useMemo(() => users.filter((u) => {
    if (!searchQuery) return true;
    const term = searchQuery.toLowerCase();
    return (
      u.nome_completo.toLowerCase().includes(term) ||
      u.matricula.toLowerCase().includes(term) ||
      (u.nome_de_guerra ?? "").toLowerCase().includes(term) ||
      (u.posto ?? "").toLowerCase().includes(term)
    );
  }), [users, searchQuery]);

  const displayed = useMemo(() => filtered.slice(0, displayLimit), [filtered, displayLimit]);
  const hasMore = filtered.length > displayLimit;
  const someSelected = selectedIds.size > 0;
  const allDisplayedSel = displayed.length > 0 && displayed.every((u) => selectedIds.has(u.id));
  const someDisplayedSel = displayed.some((u) => selectedIds.has(u.id));

  function toggleItem(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allDisplayedSel) displayed.forEach((u) => next.delete(u.id));
      else displayed.forEach((u) => next.add(u.id));
      return next;
    });
  }

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
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{filtered.length} usuário{filtered.length !== 1 ? "s" : ""}</span>
        <div className="flex items-center gap-2">
          <GridPdfButton
            printTargetId="admin-usuarios-print"
            label="Exportar"
            disabled={!someSelected}
            selectedCount={selectedIds.size}
          />
          <div className="flex rounded-xl border border-border overflow-hidden">
            <button type="button" onClick={() => setViewMode("cards")} title="Ver em cards"
              className={cn("px-3 py-2 transition-colors", viewMode === "cards" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted/60")}>
              <LayoutGrid className="size-4" />
            </button>
            <button type="button" onClick={() => setViewMode("table")} title="Ver em grade"
              className={cn("px-3 py-2 transition-colors", viewMode === "table" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted/60")}>
              <Table2 className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div id="admin-usuarios-print">
        {viewMode === "cards" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {displayed.map((u) => (
              <UserCard
                key={u.id}
                user={u}
                currentUserId={currentUserId}
                selected={selectedIds.has(u.id)}
                onToggle={toggleItem}
                onUserUpdated={handleUserUpdated}
              />
            ))}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border hover:bg-transparent">
                <TableHead className="pl-5 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={allDisplayedSel}
                    ref={(el) => { if (el) el.indeterminate = someDisplayedSel && !allDisplayedSel; }}
                    onChange={toggleAll}
                    className="size-4 rounded accent-primary"
                    aria-label="Selecionar todos"
                  />
                </TableHead>
                <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
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
              {displayed.map((u) => (
                <TableRow
                  key={u.id}
                  className={cn("border-b border-border/60 hover:bg-muted/40 transition-colors", selectedIds.has(u.id) && "bg-primary/5")}
                >
                  <TableCell className="pl-5 py-3 w-8">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(u.id)}
                      onChange={() => toggleItem(u.id)}
                      className="size-4 rounded accent-primary"
                      aria-label={`Selecionar ${u.nome_completo}`}
                    />
                  </TableCell>
                  <TableCell className="py-3">
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
                    <span className="text-sm font-mono text-muted-foreground">{u.matricula}</span>
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
                    <span className="text-xs text-muted-foreground">{formatDate(u.created_at)}</span>
                  </TableCell>
                  <TableCell className="pr-5 py-3">
                    <UserRowActions user={u} currentUserId={currentUserId} onUserUpdated={handleUserUpdated} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Ver mais */}
      {hasMore && (
        <div className="relative flex justify-end">
          <button
            data-testid="btn-ver-mais"
            type="button"
            onClick={() => setShowLimitMenu((v) => !v)}
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted/60 transition-colors"
          >
            <ChevronDown className="size-4" />
            Ver mais
          </button>
          {showLimitMenu && (
            <div className="absolute right-0 bottom-full mb-1 z-10 rounded-xl border border-border bg-card shadow-md overflow-hidden min-w-40">
              {[20, 30].map((n) => (
                <button
                  key={n}
                  data-testid={`btn-limit-${n}`}
                  type="button"
                  onClick={() => { setShowLimitMenu(false); setDisplayLimit(n); }}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted/60 transition-colors"
                >
                  Mostrar {n} registros
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
