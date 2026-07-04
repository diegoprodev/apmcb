"use client";

import { useState, useMemo } from "react";
import {
  Package, Search, X, CalendarIcon, LayoutGrid, Table2,
  CheckCircle2, Clock, Shield, Fingerprint, KeyRound,
  RotateCcw, Loader2, Building2, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GridPdfButton } from "@/components/shared/grid-pdf-button";
import { createClient } from "@/lib/supabase/client";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

async function getBearerToken(): Promise<string> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? "";
}

type LendingRow = {
  id: string;
  quantidade: number;
  status_legacy: string;
  issued_at: string;
  returned_at: string | null;
  local: string | null;
  notes: string | null;
  auth_mode: string | null;
  material_request_id: string | null;
  movement_id: string | null;
  material_type: { nome: string; categoria: string } | null;
  military: { id: string; nome_completo: string; matricula: string; posto: string | null; foto_url: string | null } | null;
  master: { nome_completo: string; matricula: string } | null;
};

type MovementGroup = {
  key: string;
  military: LendingRow["military"];
  issued_at: string;
  auth_mode: string | null;
  items: LendingRow[];
  allReturned: boolean;
};

const AUTH_ICON: Record<string, React.ElementType> = {
  biometria: Fingerprint,
  totp: KeyRound,
  manual: Shield,
};

function groupByRetirada(lendings: LendingRow[]): MovementGroup[] {
  const map = new Map<string, MovementGroup>();
  for (const l of lendings) {
    const issuedMin = l.issued_at.slice(0, 16);
    const key = l.movement_id ?? `${l.military?.id ?? "??"}_${issuedMin}`;
    if (!map.has(key)) {
      map.set(key, { key, military: l.military, issued_at: l.issued_at, auth_mode: l.auth_mode, items: [], allReturned: false });
    }
    map.get(key)!.items.push(l);
  }
  const groups = Array.from(map.values());
  for (const g of groups) g.allReturned = g.items.every((i) => i.status_legacy === "devolvido");
  return groups;
}

interface Props {
  orgUnits: { id: string; nome: string }[];
  reserves: { id: string; nome: string; acronym: string; org_unit_id: string | null }[];
}

export function AdminSaidasClient({ orgUnits, reserves }: Props) {
  const [selectedOrgUnit, setSelectedOrgUnit] = useState<string>("");
  const [selectedReserve, setSelectedReserve] = useState<string>("");
  const [saidas, setSaidas] = useState<LendingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "ativo" | "devolvido">("");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [displayLimit, setDisplayLimit] = useState(10);
  const [showLimitMenu, setShowLimitMenu] = useState(false);

  const filteredReserves = useMemo(
    () => selectedOrgUnit ? reserves.filter((r) => r.org_unit_id === selectedOrgUnit) : reserves,
    [reserves, selectedOrgUnit]
  );

  async function loadSaidas(reserveId: string) {
    setLoading(true);
    setError(null);
    setSaidas([]);
    setSelectedIds(new Set());
    setDisplayLimit(10);
    try {
      const token = await getBearerToken();
      const params = new URLSearchParams({ reserveId });
      if (statusFilter) params.set("status", statusFilter);
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      const res = await fetch(`${BFF_URL}/api/admin/saidas?${params}`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(e.error ?? "Erro ao carregar saídas");
      }
      const json = await res.json() as { saidas: LendingRow[] };
      setSaidas(json.saidas);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }

  function handleReserveChange(reserveId: string) {
    setSelectedReserve(reserveId);
    if (reserveId) loadSaidas(reserveId);
    else setSaidas([]);
  }

  function handleOrgUnitChange(orgUnitId: string) {
    setSelectedOrgUnit(orgUnitId);
    setSelectedReserve("");
    setSaidas([]);
    setSelectedIds(new Set());
  }

  const filtered = useMemo(() => {
    let result = saidas;
    const q = search.toLowerCase().trim();
    if (q) {
      result = result.filter((l) =>
        (l.military?.nome_completo?.toLowerCase() ?? "").includes(q) ||
        (l.military?.matricula?.toLowerCase() ?? "").includes(q) ||
        (l.material_type?.nome?.toLowerCase() ?? "").includes(q)
      );
    }
    if (dateFrom) {
      const from = new Date(dateFrom + "T00:00:00");
      result = result.filter((l) => new Date(l.issued_at) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo + "T23:59:59");
      result = result.filter((l) => new Date(l.issued_at) <= to);
    }
    if (statusFilter) {
      result = result.filter((l) => l.status_legacy === statusFilter);
    }
    return result;
  }, [saidas, search, dateFrom, dateTo, statusFilter]);

  const allGroups = useMemo(() => groupByRetirada(filtered), [filtered]);
  const groups = useMemo(() => allGroups.slice(0, displayLimit), [allGroups, displayLimit]);
  const hasMore = allGroups.length > displayLimit;
  const hasFilters = search || dateFrom || dateTo || statusFilter;

  const selectedReserveName = reserves.find((r) => r.id === selectedReserve)?.nome;

  const someSelected = selectedIds.size > 0;
  const selectedGroupKeys = useMemo(
    () => allGroups.filter((g) => g.items.some((i) => selectedIds.has(i.id))).map((g) => g.key),
    [allGroups, selectedIds]
  );

  function toggleGroup(group: MovementGroup) {
    const ids = group.items.map((i) => i.id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSel = ids.every((id) => next.has(id));
      if (allSel) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }

  function toggleItem(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Monitor de Saídas</h2>
          <p className="text-muted-foreground text-sm mt-0.5">
            Visualize saídas de qualquer reserva do seu tenant
          </p>
        </div>
        {selectedReserve && (
          <GridPdfButton
            printTargetId="admin-saidas-print"
            label="Exportar PDF"
            disabled={!someSelected}
            selectedCount={selectedIds.size}
            selectedGroupKeys={someSelected ? selectedGroupKeys : undefined}
          />
        )}
      </div>

      {/* Reserve selector */}
      <div className="rounded-2xl bg-card p-4 space-y-3" style={{ boxShadow: "var(--shadow-card)" }}>
        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Building2 className="size-4" />
          Selecionar Reserva
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">Departamento</label>
            <select
              value={selectedOrgUnit}
              onChange={(e) => handleOrgUnitChange(e.target.value)}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
            >
              <option value="">Todos os departamentos</option>
              {orgUnits.map((u) => (
                <option key={u.id} value={u.id}>{u.nome}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">Reserva</label>
            <select
              value={selectedReserve}
              onChange={(e) => handleReserveChange(e.target.value)}
              disabled={filteredReserves.length === 0}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors disabled:opacity-50"
            >
              <option value="">Selecionar reserva...</option>
              {filteredReserves.map((r) => (
                <option key={r.id} value={r.id}>{r.nome} ({r.acronym})</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* No reserve selected */}
      {!selectedReserve && !loading && (
        <div className="rounded-2xl bg-card p-10 text-center" style={{ boxShadow: "var(--shadow-card)" }}>
          <Building2 className="size-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium">Selecione uma reserva</p>
          <p className="text-xs text-muted-foreground mt-1">Escolha o departamento e a reserva acima para visualizar as saídas</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Saidas content */}
      {selectedReserve && !loading && !error && (
        <>
          {/* Filters */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nome, matrícula ou material..."
                  className="w-full rounded-xl border border-input bg-card pl-9 pr-9 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                />
                {search && (
                  <button type="button" onClick={() => setSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X className="size-4" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Status filter */}
                <div className="flex rounded-xl border border-border overflow-hidden">
                  {(["", "ativo", "devolvido"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setStatusFilter(s)}
                      className={cn(
                        "px-4 py-2 text-sm font-medium transition-colors",
                        statusFilter === s ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted/60"
                      )}
                    >
                      {s === "" ? "Todas" : s === "ativo" ? "Ativas" : "Devolvidas"}
                    </button>
                  ))}
                </div>
                {/* View toggle */}
                <div className="flex rounded-xl border border-border overflow-hidden">
                  <button type="button" onClick={() => setViewMode("cards")} title="Ver em cards agrupados"
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

            <div className="flex flex-wrap gap-2 items-center">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                <CalendarIcon className="size-3.5" />
                Período:
              </div>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className="rounded-lg border border-input bg-card px-3 py-1.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                aria-label="Data de início" />
              <span className="text-xs text-muted-foreground">até</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className="rounded-lg border border-input bg-card px-3 py-1.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                aria-label="Data de fim" />
              {hasFilters && (
                <button type="button" onClick={() => { setSearch(""); setDateFrom(""); setDateTo(""); setStatusFilter(""); }}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <X className="size-3" />
                  Limpar
                </button>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {filtered.length} registro{filtered.length !== 1 ? "s" : ""} — {selectedReserveName}
              </span>
            </div>
          </div>

          {/* Results */}
          <div id="admin-saidas-print">
            {groups.length === 0 ? (
              <div className="rounded-2xl bg-card p-10 text-center" style={{ boxShadow: "var(--shadow-card)" }}>
                <Package className="size-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm font-medium">Nenhuma saída encontrada</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {hasFilters ? "Tente outros filtros" : "Nenhuma saída registrada nesta reserva"}
                </p>
              </div>
            ) : viewMode === "cards" ? (
              <div className="space-y-3">
                {groups.map((group) => (
                  <AdminGroupCard
                    key={group.key}
                    group={group}
                    selectedIds={selectedIds}
                    onToggleGroup={toggleGroup}
                    onToggleItem={toggleItem}
                  />
                ))}
              </div>
            ) : (
              <AdminSaidasTable
                groups={groups}
                selectedIds={selectedIds}
                onToggleItem={toggleItem}
                onToggleGroup={toggleGroup}
              />
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
                <div className="absolute right-0 bottom-full mb-1 z-10 rounded-xl border border-border bg-card shadow-md overflow-hidden min-w-[160px]">
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
        </>
      )}
    </div>
  );
}

function AdminGroupCard({
  group,
  selectedIds,
  onToggleGroup,
  onToggleItem,
}: {
  group: MovementGroup;
  selectedIds: Set<string>;
  onToggleGroup: (g: MovementGroup) => void;
  onToggleItem: (id: string) => void;
}) {
  const AuthIcon = AUTH_ICON[group.auth_mode ?? "manual"] ?? Shield;
  const activeCount = group.items.filter((i) => i.status_legacy === "ativo").length;
  const formattedDate = new Date(group.issued_at).toLocaleDateString("pt-BR", {
    day: "2-digit", month: "short", year: "numeric",
  });
  const allSel = group.items.every((i) => selectedIds.has(i.id));
  const someSel = group.items.some((i) => selectedIds.has(i.id));

  return (
    <div
      data-testid="admin-saidas-group"
      data-group-key={group.key}
      className="rounded-2xl bg-card overflow-hidden"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <input
          type="checkbox"
          checked={allSel}
          ref={(el) => { if (el) el.indeterminate = someSel && !allSel; }}
          onChange={() => onToggleGroup(group)}
          onClick={(e) => e.stopPropagation()}
          className="size-5 rounded accent-primary shrink-0 cursor-pointer relative z-10"
          aria-label="Selecionar grupo"
        />
        <div className="size-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <span className="text-xs font-bold text-primary">
            {group.military?.nome_completo?.slice(0, 2).toUpperCase() ?? "??"}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">
            {group.military?.posto ? `${group.military.posto} ` : ""}
            {group.military?.nome_completo ?? "—"}
          </p>
          <p className="text-xs text-muted-foreground">
            Mat. {group.military?.matricula ?? "—"} · {formattedDate}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span title={`Verificado via ${group.auth_mode ?? "manual"}`}>
            <AuthIcon className="size-4 text-muted-foreground" />
          </span>
          {group.allReturned ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
              <CheckCircle2 className="size-3" /> Devolvido
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
              <Clock className="size-3" /> {activeCount} ativo{activeCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
      <div className="divide-y divide-border">
        {group.items.map((item) => (
          <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
            <input
              type="checkbox"
              checked={selectedIds.has(item.id)}
              onChange={() => onToggleItem(item.id)}
              onClick={(e) => e.stopPropagation()}
              className="size-5 rounded accent-primary shrink-0 cursor-pointer relative z-10"
              aria-label={`Selecionar ${item.material_type?.nome ?? "item"}`}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{item.material_type?.nome ?? "—"}</p>
              <p className="text-xs text-muted-foreground capitalize">{item.material_type?.categoria ?? "—"}</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs text-muted-foreground">×{item.quantidade}</span>
              <div className="flex flex-col items-end gap-0.5">
                <span className={cn(
                  "text-[11px] font-medium px-1.5 py-0.5 rounded",
                  item.status_legacy === "ativo" ? "text-amber-700 bg-amber-50" : "text-emerald-700 bg-emerald-50"
                )}>
                  {item.status_legacy === "ativo" ? "Ativo" : "Devolvido"}
                </span>
                {item.status_legacy !== "ativo" && item.returned_at && (
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(item.returned_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
              </div>
            </div>
            <RotateCcw className="size-4 text-muted-foreground/20 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminSaidasTable({
  groups,
  selectedIds,
  onToggleItem,
  onToggleGroup,
}: {
  groups: MovementGroup[];
  selectedIds: Set<string>;
  onToggleItem: (id: string) => void;
  onToggleGroup: (g: MovementGroup) => void;
}) {
  const allIds = groups.flatMap((g) => g.items.map((i) => i.id));
  const allSel = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
  const someSel = allIds.some((id) => selectedIds.has(id));

  function toggleAll() {
    if (allSel) {
      const next = new Set(selectedIds);
      allIds.forEach((id) => next.delete(id));
      // We can't call parent setter directly — use per-group toggle pattern
      groups.forEach((g) => onToggleGroup(g));
    } else {
      groups.forEach((g) => {
        const ids = g.items.map((i) => i.id);
        if (!ids.every((id) => selectedIds.has(id))) onToggleGroup(g);
      });
    }
  }

  const rows = groups.flatMap((g) => g.items.map((item) => ({ group: g, item })));

  return (
    <div className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-4 py-3 w-8">
                <input
                  type="checkbox"
                  checked={allSel}
                  ref={(el) => { if (el) el.indeterminate = someSel && !allSel; }}
                  onChange={toggleAll}
                  className="size-4 rounded accent-primary"
                  aria-label="Selecionar todos"
                />
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Data</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Usuário</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Material</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Qtd</th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Armeiro</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(({ group, item }) => {
              const formattedDate = new Date(group.issued_at).toLocaleDateString("pt-BR", {
                day: "2-digit", month: "2-digit", year: "numeric",
              });
              const isAtivo = item.status_legacy === "ativo";
              return (
                <tr key={item.id} className={cn("hover:bg-muted/20 transition-colors", selectedIds.has(item.id) && "bg-primary/5")}>
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() => onToggleItem(item.id)}
                      className="size-4 rounded accent-primary"
                      aria-label={`Selecionar ${item.material_type?.nome ?? "item"}`}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono whitespace-nowrap">{formattedDate}</td>
                  <td className="px-4 py-2.5">
                    <p className="font-medium truncate max-w-40">
                      {group.military?.posto ? `${group.military.posto} ` : ""}
                      {group.military?.nome_completo ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono">{group.military?.matricula ?? "—"}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="font-medium truncate max-w-40">{item.material_type?.nome ?? "—"}</p>
                    <p className="text-xs text-muted-foreground capitalize">{item.material_type?.categoria ?? "—"}</p>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{item.quantidade}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={cn(
                      "text-[11px] font-medium px-2 py-0.5 rounded-full",
                      isAtivo
                        ? "text-amber-700 bg-amber-50 border border-amber-200"
                        : "text-emerald-700 bg-emerald-50 border border-emerald-200"
                    )}>
                      {isAtivo ? "Ativo" : "Devolvido"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground truncate max-w-32">
                    {item.master?.nome_completo ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
