"use client";

import { useState, useEffect, useMemo } from "react";
import { Users, LayoutGrid, Table2, ChevronDown, Filter, ChevronUp, X } from "lucide-react";
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
import { FilterField } from "@/components/shared/filter-field";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { usePaginatedSelection } from "@/components/shared/use-paginated-selection";
import { useSSERefresh } from "@/hooks/use-sse-refresh";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format-date";
import { ProfileAvatar } from "@/components/profile-avatar";
import { ROLE_LABELS } from "@/lib/invite-ceiling";
import { classifyAccountStatus, minutesSince } from "@/lib/account-status";

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
  reserve_id: string | null;
  reserve_nome: string | null;
};

function AccountStatusBadge({ user }: { user: UserRow }) {
  const { registration_status: status, invite_sent_at } = user;

  if (status === "inactive") {
    return <span className="badge-danger text-[11px] font-semibold px-2.5 py-0.5 rounded-full">Inativo</span>;
  }

  const { bioPending, totpPending, accountActive, inviteExpired, inviteSent, noInvite, allComplete } = classifyAccountStatus(user);
  if (allComplete) {
    return <span className="badge-success text-[11px] font-semibold px-2.5 py-0.5 rounded-full">Completo</span>;
  }

  const pendingCount = [bioPending, totpPending, noInvite || inviteSent || inviteExpired].filter(Boolean).length;

  return (
    <div className="flex flex-col gap-1" title={[
      bioPending ? "Biometria pendente" : null,
      totpPending ? "Código dinâmico pendente" : null,
      noInvite ? "Sem convite" : inviteExpired ? "Convite expirado" : inviteSent ? `Convite enviado (${minutesSince(invite_sent_at)} min)` : null,
    ].filter(Boolean).join(" · ")}>
      <span className="text-[10px] text-muted-foreground font-medium">{pendingCount} pendência{pendingCount !== 1 ? "s" : ""}</span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {bioPending && (
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Bio</span>
        )}
        {totpPending && (
          <abbr title="Código dinâmico pendente" className="no-underline">
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 cursor-help">Dinâmico</span>
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
  const style: Record<string, React.CSSProperties> = {
    admin_global:  { backgroundColor: "#DBEAFE", color: "#1D4ED8" },
    admin_reserva: { backgroundColor: "#DBEAFE", color: "#1D4ED8" },
    armeiro:       { backgroundColor: "#EDE9FE", color: "#5B21B6" },
    auditor:       { backgroundColor: "#FEF3C7", color: "#92400E" },
    usuario:       { backgroundColor: "#F3F4F6", color: "#374151" },
    superadmin:    { backgroundColor: "#DBEAFE", color: "#1D4ED8" },
  };
  return (
    <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full" style={style[role] ?? {}}>
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

function UserCard({
  user,
  currentUserId,
  callerRole,
  selected,
  onToggle,
  onUserUpdated,
}: {
  user: UserRow;
  currentUserId: string;
  callerRole: "admin_global" | "admin_reserva" | "armeiro";
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
        <ProfileAvatar
          profileId={user.id}
          photoPath={user.foto_url}
          name={user.nome_completo}
          className="h-10 w-10 shrink-0 ring-1 ring-border"
        />
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
        {user.reserve_nome && (
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{user.reserve_nome}</span>
        )}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{formatDate(user.created_at)}</span>
        <UserRowActions user={user} currentUserId={currentUserId} callerRole={callerRole} onUserUpdated={onUserUpdated} />
      </div>
    </div>
  );
}

interface Props {
  initialUsers: UserRow[];
  currentUserId: string;
  callerRole?: "admin_global" | "admin_reserva" | "armeiro";
  reserves?: { id: string; nome: string }[];
  searchQuery?: string;
}

const PENDENCIA_OPTIONS = [
  { value: "biometria", label: "Biometria pendente" },
  { value: "totp", label: "Código dinâmico pendente" },
  { value: "sem_login", label: "Sem login/convite" },
  { value: "convite_expirado", label: "Convite expirado" },
  { value: "inativo", label: "Inativo" },
];

export function UsersTable({ initialUsers, currentUserId, callerRole = "admin_global", reserves = [], searchQuery }: Props) {
  const [users, setUsers] = useState<UserRow[]>(initialUsers);
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [advanced, setAdvanced] = useState(false);
  const [roleFilter, setRoleFilter] = useState("");
  const [reserveFilter, setReserveFilter] = useState("");
  const [unidadeFilter, setUnidadeFilter] = useState("");
  const [pendenciaFilter, setPendenciaFilter] = useState("");

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

  const roleOptions = useMemo(() => (
    [...new Set(users.map((u) => u.role))].map((r) => ({ value: r, label: ROLE_LABELS[r] ?? r }))
  ), [users]);
  const unidadeOptions = useMemo(() => (
    [...new Set(users.map((u) => u.unidade).filter(Boolean))]
      .sort((a, b) => (a as string).localeCompare(b as string, "pt-BR"))
      .map((u) => ({ value: u as string, label: u as string }))
  ), [users]);
  const reserveOptions = useMemo(() => (
    reserves.map((r) => ({ value: r.id, label: r.nome }))
  ), [reserves]);

  const filtered = useMemo(() => users.filter((u) => {
    if (searchQuery) {
      const term = searchQuery.toLowerCase();
      const matchesSearch =
        u.nome_completo.toLowerCase().includes(term) ||
        u.matricula.toLowerCase().includes(term) ||
        (u.nome_de_guerra ?? "").toLowerCase().includes(term) ||
        (u.posto ?? "").toLowerCase().includes(term);
      if (!matchesSearch) return false;
    }
    if (roleFilter && u.role !== roleFilter) return false;
    if (reserveFilter && u.reserve_id !== reserveFilter) return false;
    if (unidadeFilter && u.unidade !== unidadeFilter) return false;
    if (pendenciaFilter) {
      const flags = classifyAccountStatus(u);
      if (pendenciaFilter === "biometria" && !flags.bioPending) return false;
      if (pendenciaFilter === "totp" && !flags.totpPending) return false;
      if (pendenciaFilter === "sem_login" && !flags.noInvite) return false;
      if (pendenciaFilter === "convite_expirado" && !flags.inviteExpired) return false;
      if (pendenciaFilter === "inativo" && u.registration_status !== "inactive") return false;
    }
    return true;
  }), [users, searchQuery, roleFilter, reserveFilter, unidadeFilter, pendenciaFilter]);

  const {
    setDisplayLimit,
    showLimitMenu, setShowLimitMenu,
    displayed, hasMore,
    selectedIds, toggleItem, toggleAll, clearSelection,
    allDisplayedSel, someDisplayedSel,
  } = usePaginatedSelection(filtered);
  const someSelected = selectedIds.size > 0;

  // Sem isto, selecionar usuários e depois trocar um filtro deixava itens
  // selecionados-mas-invisíveis (fora de `filtered`) — o botão de exportar
  // PDF usa `selectedIds.size`, então podia exportar usuários que não
  // estão mais na tela (achado de code review).
  useEffect(() => {
    clearSelection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, roleFilter, reserveFilter, unidadeFilter, pendenciaFilter]);

  const hasActiveFilters = !!(roleFilter || reserveFilter || unidadeFilter || pendenciaFilter);

  function resetFilters() {
    setRoleFilter(""); setReserveFilter(""); setUnidadeFilter(""); setPendenciaFilter("");
  }

  const filterPanel = (
    <div className="rounded-2xl bg-card p-4 space-y-3" style={{ boxShadow: "var(--shadow-card)" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Filter className="size-4 text-primary" />
          <span className="text-sm font-semibold">Filtros</span>
          {hasActiveFilters && (
            <span className="text-[10px] font-bold bg-primary text-primary-foreground rounded-full px-2 py-0.5">ativo</span>
          )}
        </div>
        <button
          onClick={() => setAdvanced(!advanced)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {advanced ? "Ocultar avançados" : "Filtros avançados"}
          {advanced ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        </button>
      </div>

      {advanced && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 rounded-xl bg-muted/30 p-3">
          <FilterField label="Papel" tooltip="Filtra pelo papel/permissão atual do usuário.">
            <SearchableSelect
              testId="filter-papel"
              options={roleOptions}
              value={roleFilter}
              onChange={setRoleFilter}
              placeholder="Todos"
              allLabel="Todos"
            />
          </FilterField>
          {reserveOptions.length > 0 && (
            <FilterField label="Reserva" tooltip="Filtra pelos usuários vinculados a uma reserva/departamento específico.">
              <SearchableSelect
                testId="filter-reserva"
                options={reserveOptions}
                value={reserveFilter}
                onChange={setReserveFilter}
                placeholder="Todas"
                allLabel="Todas"
              />
            </FilterField>
          )}
          <FilterField label="Unidade" tooltip="Filtra pela unidade/local de trabalho cadastrado no perfil.">
            <SearchableSelect
              testId="filter-unidade"
              options={unidadeOptions}
              value={unidadeFilter}
              onChange={setUnidadeFilter}
              placeholder="Todas"
              allLabel="Todas"
            />
          </FilterField>
          <FilterField label="Pendência" tooltip="Filtra por usuários com uma pendência específica de cadastro ou acesso.">
            <SearchableSelect
              testId="filter-pendencia"
              options={PENDENCIA_OPTIONS}
              value={pendenciaFilter}
              onChange={setPendenciaFilter}
              placeholder="Todas"
              allLabel="Todas"
            />
          </FilterField>
        </div>
      )}

      {hasActiveFilters && (
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={resetFilters}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-3" />Limpar filtros
          </button>
        </div>
      )}
    </div>
  );

  if (filtered.length === 0) {
    return (
      <div className="space-y-3">
        {filterPanel}
        <div className="p-12 text-center">
          <Users className="size-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">
            {searchQuery || hasActiveFilters
              ? "Nenhum resultado para os filtros aplicados"
              : "Nenhum usuário cadastrado"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {filterPanel}

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
                callerRole={callerRole}
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
                <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden lg:table-cell">
                  Reserva
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
                      <ProfileAvatar
                        profileId={u.id}
                        photoPath={u.foto_url}
                        name={u.nome_completo}
                        className="h-8 w-8 shrink-0 ring-1 ring-border"
                      />
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
                  <TableCell className="py-3 hidden lg:table-cell">
                    <span className="text-sm text-foreground">
                      {u.reserve_nome ?? <span className="text-muted-foreground">—</span>}
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
                    <UserRowActions user={u} currentUserId={currentUserId} callerRole={callerRole} onUserUpdated={handleUserUpdated} />
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
