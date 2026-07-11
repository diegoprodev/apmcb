"use client";

import { useMemo, useState, Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Package, Plus, RotateCcw, Search, X, ChevronRight, ChevronDown,
  CheckCircle2, Clock, Shield, Fingerprint, KeyRound,
  LayoutGrid, Table2, CalendarIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DesarmamentoModal } from "./_desarmamento-modal";
import { GridPdfButton } from "@/components/shared/grid-pdf-button";
import { FilterGroupLabel } from "@/components/shared/filter-field";
import { formatDate, formatTime } from "@/lib/format-date";

type LendingRow = {
  id: string;
  quantidade: number;
  status_legacy: string;
  issued_at: string;
  returned_at: string | null;
  local: string | null;
  notes: string | null;
  auth_mode: string | null;
  movement_id: string | null;
  material_type: { nome: string; categoria: string } | null;
  military: { id: string; nome_completo: string; matricula: string; posto: string | null; foto_url: string | null } | null;
  master: { nome_completo: string; matricula: string } | null;
};

type MovementGroup = {
  key: string;
  movement_id: string | null;
  military: LendingRow["military"];
  issued_at: string;
  auth_mode: string | null;
  items: LendingRow[];
  allReturned: boolean;
};

function groupByRetirada(lendings: LendingRow[]): MovementGroup[] {
  const map = new Map<string, MovementGroup>();
  for (const l of lendings) {
    // Truncate to minute to group near-simultaneous single-item issues created before movement_id was always set
    const issuedMin = l.issued_at.slice(0, 16);
    const key = l.movement_id ?? `${l.military?.id ?? "??"}_${issuedMin}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        movement_id: l.movement_id,
        military: l.military,
        issued_at: l.issued_at,
        auth_mode: l.auth_mode,
        items: [],
        allReturned: false,
      });
    }
    map.get(key)!.items.push(l);
  }
  const groups = Array.from(map.values());
  for (const g of groups) {
    g.allReturned = g.items.every((i) => i.status_legacy === "devolvido");
  }
  return groups;
}

const AUTH_ICON: Record<string, React.ElementType> = {
  biometria: Fingerprint,
  totp: KeyRound,
  manual: Shield,
};

export function SaidasClient({
  saidas,
  currentStatus,
  role,
  hasMore,
  currentLimit,
  reserveName,
  armeiroName,
  tenantLogoUrl,
}: {
  saidas: LendingRow[];
  currentStatus: string;
  role: string;
  hasMore: boolean;
  currentLimit: number;
  reserveName?: string;
  armeiroName?: string;
  tenantLogoUrl?: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [desarmamentoOpen, setDesarmamentoOpen] = useState(false);
  const [preselectedIds, setPreselectedIds] = useState<string[]>([]);
  const [militaryMatricula, setMilitaryMatricula] = useState<string | undefined>();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showLimitMenu, setShowLimitMenu] = useState(false);

  const filtered = useMemo(() => {
    let result = saidas;
    const q = search.toLowerCase().trim();
    if (q) {
      result = result.filter((l) => {
        const nome = l.military?.nome_completo?.toLowerCase() ?? "";
        const matricula = l.military?.matricula?.toLowerCase() ?? "";
        const material = l.material_type?.nome?.toLowerCase() ?? "";
        return nome.includes(q) || matricula.includes(q) || material.includes(q);
      });
    }
    if (dateFrom) {
      const from = new Date(dateFrom + "T00:00:00");
      result = result.filter((l) => new Date(l.issued_at) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo + "T23:59:59");
      result = result.filter((l) => new Date(l.issued_at) <= to);
    }
    return result;
  }, [saidas, search, dateFrom, dateTo]);

  const groups = useMemo(() => groupByRetirada(filtered), [filtered]);

  const someSelected = selectedIds.size > 0;
  const selectedGroupKeys = useMemo(
    () => groups.filter((g) => g.items.some((i) => selectedIds.has(i.id))).map((g) => g.key),
    [groups, selectedIds]
  );

  const hasFilters = search || dateFrom || dateTo;

  function clearFilters() {
    setSearch("");
    setDateFrom("");
    setDateTo("");
  }

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

  function toggleAllTable() {
    const allIds = groups.flatMap((g) => g.items.map((i) => i.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSel = allIds.every((id) => next.has(id));
      if (allSel) allIds.forEach((id) => next.delete(id));
      else allIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function openReceberGrupo(group: MovementGroup) {
    const activeIds = group.items.filter((i) => i.status_legacy === "ativo").map((i) => i.id);
    setPreselectedIds(activeIds);
    setMilitaryMatricula(group.military?.matricula ?? undefined);
    setDesarmamentoOpen(true);
  }

  const statusTabs = [
    { value: "", label: "Todas" },
    { value: "ativo", label: "Ativas" },
    { value: "devolvido", label: "Devolvidas" },
  ];

  const canManage = role === "armeiro" || role === "admin_global" || role === "admin_reserva";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Saídas de Material</h2>
          <p className="text-muted-foreground text-sm mt-0.5">
            Controle de saídas e devoluções do almoxarifado
          </p>
        </div>
        <div className="flex items-center gap-2">
          <GridPdfButton
            printTargetId="saidas-print"
            label="Exportar"
            reportTitle="SAÍDAS DE MATERIAL"
            selectedCount={selectedIds.size}
            selectedGroupKeys={someSelected ? selectedGroupKeys : undefined}
            disabled={!someSelected}
            reserveName={reserveName}
            armeiroName={armeiroName}
            tenantLogoUrl={tenantLogoUrl}
            selectedData={someSelected ? groups.filter((g) => selectedGroupKeys.includes(g.key)).map((g) => g.key) : undefined}
          />
          <button
            type="button"
            onClick={() => { setPreselectedIds([]); setDesarmamentoOpen(true); }}
            className="inline-flex items-center gap-1.5 border border-border bg-white dark:bg-card text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/10 hover:border-primary/40 transition-colors"
          >
            <RotateCcw className="size-4" />
            Receber Material
          </button>
          <Link
            href="/reserva/saidas/nova"
            className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus className="size-4" />
            Nova Saída
          </Link>
        </div>
      </div>

      {/* Seleção counter */}
      {someSelected && (
        <div className="flex items-center gap-2 text-sm text-primary font-medium">
          <span>{selectedIds.size} selecionado{selectedIds.size !== 1 ? "s" : ""}</span>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
          >
            <X className="size-3" /> Limpar seleção
          </button>
        </div>
      )}

      {/* Filters row */}
      <div className="flex flex-col gap-2">
        {/* Search + status tabs + view toggle */}
        <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, matrícula ou material..."
              className="w-full rounded-xl border border-input bg-white dark:bg-card pl-9 pr-9 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
            />
            {search && (
              <button type="button" onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex rounded-xl border border-border overflow-hidden">
              {statusTabs.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => router.push(tab.value ? `/reserva/saidas?status=${tab.value}` : "/reserva/saidas")}
                  className={cn(
                    "px-4 py-2 text-sm font-medium transition-colors",
                    currentStatus === tab.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-white dark:bg-card text-muted-foreground hover:bg-primary/10"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {/* Cards / Table toggle */}
            <div className="flex rounded-xl border border-border overflow-hidden">
              <button
                type="button"
                onClick={() => setViewMode("cards")}
                title="Ver em cards agrupados"
                className={cn(
                  "px-3 py-2 transition-colors",
                  viewMode === "cards" ? "bg-primary text-primary-foreground" : "bg-white dark:bg-card text-muted-foreground hover:bg-primary/10"
                )}
              >
                <LayoutGrid className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("table")}
                title="Ver em grade"
                className={cn(
                  "px-3 py-2 transition-colors",
                  viewMode === "table" ? "bg-primary text-primary-foreground" : "bg-white dark:bg-card text-muted-foreground hover:bg-primary/10"
                )}
              >
                <Table2 className="size-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Date filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <FilterGroupLabel
            icon={<CalendarIcon className="size-3.5" />}
            label="Período:"
            tooltip="Filtra as saídas pela data de retirada do material, dentro do intervalo informado."
          />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-lg border border-input bg-white dark:bg-card px-3 py-1.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
            aria-label="Data de início"
          />
          <span className="text-xs text-muted-foreground">até</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border border-input bg-white dark:bg-card px-3 py-1.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
            aria-label="Data de fim"
          />
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="size-3" />
              Limpar
            </button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {filtered.length} registro{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Content — wrapped for PDF export */}
      <div id="saidas-print">
        {groups.length === 0 ? (
          <div className="rounded-2xl bg-card p-10 text-center" style={{ boxShadow: "var(--shadow-card)" }}>
            <Package className="size-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm font-medium">Nenhuma saída encontrada</p>
            <p className="text-xs text-muted-foreground mt-1">
              {hasFilters ? "Tente outros filtros" : "Registre a primeira saída de material"}
            </p>
          </div>
        ) : viewMode === "cards" ? (
          <div className="space-y-3">
            {groups.map((group) => (
              <GroupCard
                key={group.key}
                group={group}
                canManage={canManage}
                onReceber={(ids, mat) => { setPreselectedIds(ids); setMilitaryMatricula(mat); setDesarmamentoOpen(true); }}
                selectedIds={selectedIds}
                onToggleGroup={toggleGroup}
                onToggleItem={toggleItem}
              />
            ))}
          </div>
        ) : (
          <SaidasTable
            groups={groups}
            canManage={canManage}
            onReceber={(ids, mat) => { setPreselectedIds(ids); setMilitaryMatricula(mat); setDesarmamentoOpen(true); }}
            selectedIds={selectedIds}
            onToggleItem={toggleItem}
            onToggleAll={toggleAllTable}
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
            className="flex items-center gap-2 rounded-xl border border-border bg-white dark:bg-card px-4 py-2 text-sm font-medium hover:bg-primary/10 hover:border-primary/40 transition-colors"
          >
            <ChevronDown className="size-4" />
            Ver mais
          </button>
          {showLimitMenu && (
            <div className="absolute right-0 bottom-full mb-1 z-10 rounded-xl border border-border bg-card shadow-md overflow-hidden min-w-[180px]">
              {[20, 30].map((n) => (
                <button
                  key={n}
                  data-testid={`btn-limit-${n}`}
                  type="button"
                  onClick={() => {
                    setShowLimitMenu(false);
                    router.push(`/reserva/saidas?limit=${n}${currentStatus ? `&status=${currentStatus}` : ""}`);
                  }}
                  className="block w-full px-5 py-2.5 text-sm text-left hover:bg-primary/10 transition-colors"
                >
                  Mostrar {n} registros
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <DesarmamentoModal
        open={desarmamentoOpen}
        onClose={() => { setDesarmamentoOpen(false); setMilitaryMatricula(undefined); }}
        preselectedIds={preselectedIds}
        onSuccess={() => {
          setDesarmamentoOpen(false);
          setMilitaryMatricula(undefined);
          router.refresh();
        }}
        role={role}
        militaryMatricula={militaryMatricula}
      />
    </div>
  );
}

function GroupCard({
  group,
  canManage,
  onReceber,
  selectedIds,
  onToggleGroup,
  onToggleItem,
}: {
  group: MovementGroup;
  canManage: boolean;
  onReceber: (ids: string[], militaryMatricula?: string) => void;
  selectedIds: Set<string>;
  onToggleGroup: (group: MovementGroup) => void;
  onToggleItem: (id: string) => void;
}) {
  const AuthIcon = AUTH_ICON[group.auth_mode ?? "manual"] ?? Shield;
  const activeCount = group.items.filter((i) => i.status_legacy === "ativo").length;
  const allSelected = group.items.every((i) => selectedIds.has(i.id));
  const someSelected = group.items.some((i) => selectedIds.has(i.id));
  const formattedDate =
    formatDate(group.issued_at, { day: "2-digit", month: "short", year: "numeric" }) +
    " · " +
    formatTime(group.issued_at);

  return (
    <div
      data-testid="saidas-group"
      data-group-key={group.key}
      className="rounded-2xl bg-card overflow-hidden"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
          onChange={() => onToggleGroup(group)}
          onClick={(e) => e.stopPropagation()}
          className="rounded border-border size-5 cursor-pointer shrink-0 accent-primary relative z-10"
          aria-label="Selecionar grupo"
        />
        {group.military?.foto_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={group.military.foto_url}
            alt={group.military.nome_completo}
            className="size-9 rounded-full object-cover shrink-0"
          />
        ) : (
          <div className="size-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-primary">
              {group.military?.nome_completo?.slice(0, 2).toUpperCase() ?? "??"}
            </span>
          </div>
        )}
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
          {!group.allReturned && canManage && (
            <button
              type="button"
              onClick={() => {
                const activeIds = group.items.filter((i) => i.status_legacy === "ativo").map((i) => i.id);
                onReceber(activeIds, group.military?.matricula ?? undefined);
              }}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary bg-primary/8 hover:bg-primary/15 border border-primary/20 px-2.5 py-1 rounded-lg transition-colors"
            >
              <RotateCcw className="size-3" />
              Receber
            </button>
          )}
        </div>
      </div>

      <div className="divide-y divide-border">
        {group.items.map((item) => (
          <div key={item.id} data-testid="saidas-item" className="flex items-center gap-3 px-4 py-2.5">
            <input
              type="checkbox"
              checked={selectedIds.has(item.id)}
              onChange={() => onToggleItem(item.id)}
              onClick={(e) => e.stopPropagation()}
              className="rounded border-border size-5 cursor-pointer shrink-0 accent-primary relative z-10"
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
                  item.status_legacy === "ativo"
                    ? "text-amber-700 bg-amber-50"
                    : "text-emerald-700 bg-emerald-50"
                )}>
                  {item.status_legacy === "ativo" ? "Ativo" : "Devolvido"}
                </span>
                {item.status_legacy !== "ativo" && item.returned_at && (
                  <span className="text-[10px] text-muted-foreground">
                    {formatTime(item.returned_at)}
                  </span>
                )}
              </div>
            </div>
            {item.status_legacy === "ativo" && canManage ? (
              <button
                type="button"
                title="Receber este item"
                onClick={() => onReceber([item.id], group.military?.matricula ?? undefined)}
                className="p-1 rounded hover:bg-primary/10 text-muted-foreground/40 hover:text-primary transition-colors shrink-0"
              >
                <ChevronRight className="size-4" />
              </button>
            ) : (
              <ChevronRight className="size-4 text-muted-foreground/20 shrink-0" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SaidasTable({
  groups,
  canManage,
  onReceber,
  selectedIds,
  onToggleItem,
  onToggleAll,
}: {
  groups: MovementGroup[];
  canManage: boolean;
  onReceber: (ids: string[], militaryMatricula?: string) => void;
  selectedIds: Set<string>;
  onToggleItem: (id: string) => void;
  onToggleAll: () => void;
}) {
  const allIds = groups.flatMap((g) => g.items.map((i) => i.id));
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
  const someSelected = allIds.some((id) => selectedIds.has(id));

  return (
    <div className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                  onChange={onToggleAll}
                  className="rounded border-border size-4 cursor-pointer accent-primary"
                  aria-label="Selecionar todos"
                />
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Data</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Usuário</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Material</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Qtd</th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
              {canManage && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const groupIds = group.items.map((i) => i.id);
              const groupSel = groupIds.every((id) => selectedIds.has(id));
              const formattedDate = formatDate(group.issued_at, { day: "2-digit", month: "2-digit", year: "numeric" });
              const formattedTime = formatTime(group.issued_at);
              const colSpanCount = canManage ? 6 : 5;
              return (
                <Fragment key={group.key}>
                  {/* Group separator row */}
                  <tr className="bg-muted/20 border-t border-border">
                    <td className="px-4 py-1.5">
                      <input
                        type="checkbox"
                        checked={groupSel}
                        onChange={() => {
                          const allIn = groupIds.every((id) => selectedIds.has(id));
                          if (allIn) {
                            groupIds.forEach((id) => onToggleItem(id));
                          } else {
                            groupIds.filter((id) => !selectedIds.has(id)).forEach((id) => onToggleItem(id));
                          }
                        }}
                        className="rounded border-border size-4 cursor-pointer accent-primary"
                      />
                    </td>
                    <td colSpan={colSpanCount} className="px-2 py-1.5">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="font-mono">{formattedDate} · {formattedTime}</span>
                        {group.military && (
                          <span className="font-semibold text-foreground">
                            {group.military.posto ? `${group.military.posto} ` : ""}{group.military.nome_completo}
                            <span className="font-normal text-muted-foreground ml-1">({group.military.matricula})</span>
                          </span>
                        )}
                        <span className="ml-auto text-[10px]">{group.items.length} item{group.items.length !== 1 ? "s" : ""}</span>
                      </div>
                    </td>
                  </tr>
                  {/* Item rows */}
                  {group.items.map((item) => {
                    const isAtivo = item.status_legacy === "ativo";
                    return (
                      <tr key={item.id} className={cn("border-t border-border/40 hover:bg-muted/20 transition-colors", selectedIds.has(item.id) && "bg-primary/5")}>
                        <td className="px-4 py-2.5 pl-8">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(item.id)}
                            onChange={() => onToggleItem(item.id)}
                            className="rounded border-border size-4 cursor-pointer accent-primary"
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
                            isAtivo ? "text-amber-700 bg-amber-50 border border-amber-200" : "text-emerald-700 bg-emerald-50 border border-emerald-200"
                          )}>
                            {isAtivo ? "Ativo" : "Devolvido"}
                          </span>
                        </td>
                        {canManage && (
                          <td className="px-4 py-2.5 text-right">
                            {isAtivo && (
                              <button
                                type="button"
                                onClick={() => onReceber([item.id], group.military?.matricula ?? undefined)}
                                className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                              >
                                Receber
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
