"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Package, SlidersHorizontal, LayoutGrid, List, ChevronDown, Trash2, Loader2, ShieldCheck } from "lucide-react";
import { MaterialDetailSheet, type MaterialItem } from "@/components/arsenal/material-detail-sheet";
import { GridSearchInput } from "@/components/shared/grid-search-input";
import { GridSortHead } from "@/components/shared/grid-sort-head";
import { GridPdfButton } from "@/components/shared/grid-pdf-button";
import { FilterGroupLabel } from "@/components/shared/filter-field";
import { useGridState } from "@/components/shared/use-grid-state";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getMaterialStockStatus, type ArsenalMaterialItem } from "@/lib/arsenal-status";
import { bffFetch } from "@/lib/bff-client";
import { friendlyApiError } from "@/lib/api-error";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const CATEGORIA_LABEL: Record<string, string> = {
  arma: "Arma", farda: "Farda", acessorio: "Acessório",
  equipamento: "Equipamento", outro: "Outro",
};

const STOCK_FILTER_VALUES = ["all", "ok", "baixo", "esgotado"] as const;
type StockFilter = typeof STOCK_FILTER_VALUES[number];
const STOCK_FILTER_LABEL: Record<StockFilter, string> = {
  all: "Todos", ok: "Regular", baixo: "Baixo", esgotado: "Esgotado",
};

function isStockFilter(v: string | null): v is StockFilter {
  return !!v && (STOCK_FILTER_VALUES as readonly string[]).includes(v);
}

type ViewMode = "grade" | "lista";
type MaterialItemFlat = ArsenalMaterialItem;

/** Botão de desativação direta (canManageDirectly) reaproveitado nas duas
 * vistas (lista/grade). O tooltip avisa PROATIVAMENTE, no hover, quantos
 * itens físicos ficariam bloqueando a desativação — em vez de só descobrir
 * isso no 409 depois do clique — e o botão já vem desabilitado nesse caso
 * (quantidade_em_uso_fisico vem de page.tsx, mesma contagem que o BFF usa
 * para decidir o 409 em DELETE /api/arsenal/:id). */
function DeleteMaterialButton({
  material,
  deleting,
  onDelete,
}: {
  material: ArsenalMaterialItem;
  deleting: boolean;
  onDelete: () => void;
}) {
  const blocked = material.quantidade_em_uso_fisico > 0;
  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger
          type="button"
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); onDelete(); }}
          disabled={deleting || blocked}
          aria-label={`Desativar ${material.nome}`}
          data-testid="btn-delete-material"
          className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-56">
          {blocked
            ? `${material.quantidade_em_uso_fisico} ite${material.quantidade_em_uso_fisico === 1 ? "m" : "ns"} físico(s) em uso — não pode ser desativado`
            : "Desativar material"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** CAU-08 (docs/enterprise/specs/cautela-eligibility-quantity-enterprise.md):
 * até a criação do material, cautela_habilitada/quantidade_cautela só podiam
 * ser decididos na hora do cadastro — este botão abre o painel de edição
 * pra materiais já cadastrados, mesmo padrão visual do DeleteMaterialButton
 * acima. */
function CautelaEditButton({
  material,
  onClick,
}: {
  material: ArsenalMaterialItem;
  onClick: () => void;
}) {
  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger
          type="button"
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); onClick(); }}
          aria-label={`Editar elegibilidade de cautela de ${material.nome}`}
          data-testid="btn-edit-cautela"
          className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
        >
          <ShieldCheck className="size-4" />
        </TooltipTrigger>
        <TooltipContent side="top">Editar elegibilidade para cautela</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Painel de edição (CAU-08) — mesma UI de checkbox+quantidade do cadastro
 * (material-detail-sheet.tsx AddMaterialRequestForm), reaproveitada aqui pra
 * nunca divergir sobre o que "elegível para cautela" significa entre criar e
 * editar. Cenário A (rastreio individual — número de série ou validade): só
 * o checkbox, sem quantidade — todas as unidades já cadastradas ficam
 * elegíveis (mesma decisão de produto do CAU-02). Cenário B (material bulk):
 * checkbox + quantidade, validada no backend contra quantidade_total e
 * contra quantos itens sintéticos ainda podem ser removidos com segurança. */
function CautelaEditDialog({
  material,
  onClose,
  onSaved,
}: {
  material: ArsenalMaterialItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const scenarioA = !!(material?.has_serial_numbers || material?.requires_validity);
  const [habilitada, setHabilitada] = useState(false);
  const [quantidade, setQuantidade] = useState(1);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!material) return;
    setHabilitada(!!material.cautela_habilitada);
    setQuantidade(material.quantidade_cautela && material.quantidade_cautela > 0 ? material.quantidade_cautela : 1);
  }, [material]);

  if (!material) return null;

  async function handleSave() {
    if (habilitada && !scenarioA && (quantidade < 1 || quantidade > material!.quantidade_total)) {
      toast.error(`Informe uma quantidade entre 1 e ${material!.quantidade_total}`);
      return;
    }
    setSaving(true);
    try {
      const { ok, status, data } = await bffFetch("PATCH", `/api/arsenal/${material!.id}`, {
        cautela_habilitada: habilitada,
        quantidade_cautela: habilitada && !scenarioA ? quantidade : undefined,
      });
      if (!ok) {
        toast.error(friendlyApiError(status, data.error, "Erro ao salvar elegibilidade de cautela"));
        return;
      }
      toast.success(`Elegibilidade de cautela de ${material!.nome} atualizada`);
      onSaved();
      onClose();
    } catch (err) {
      console.error("[arsenal-client] erro de conexao ao editar cautela", err);
      toast.error("Erro de conexão. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Elegibilidade para cautela</DialogTitle>
          <DialogDescription>{material.nome}</DialogDescription>
        </DialogHeader>

        <label className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm">
          <input
            type="checkbox"
            data-testid="cautela-edit-habilitada"
            checked={habilitada}
            onChange={(e) => setHabilitada(e.target.checked)}
            disabled={saving}
            className="size-4"
          />
          Disponibilizar para cautela
        </label>

        {habilitada && (
          scenarioA ? (
            <p className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              Todas as unidades cadastradas (rastreadas individualmente) ficam elegíveis para cautela.
            </p>
          ) : (
            <div className="space-y-1.5">
              <label htmlFor="cautela-edit-quantidade" className="text-xs font-medium text-muted-foreground">
                Quantidade reservada para cautela
              </label>
              <input
                id="cautela-edit-quantidade"
                data-testid="cautela-edit-quantidade"
                type="number"
                min={1}
                max={material.quantidade_total}
                value={quantidade}
                onChange={(e) => setQuantidade(Number(e.target.value))}
                className="w-full max-w-[160px] rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                disabled={saving}
              />
              <p className="text-[11px] text-muted-foreground">
                Reserva essa quantidade exclusivamente para cautela — o restante continua disponível para saída diária. Máximo: {material.quantidade_total}.
              </p>
            </div>
          )
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button type="button" onClick={handleSave} disabled={saving} data-testid="cautela-edit-save">
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CategoriaDesativadaBadge() {
  return (
    <span
      data-testid="badge-categoria-desativada"
      title="A categoria deste material foi desativada"
      className="shrink-0 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground"
    >
      Categoria desativada
    </span>
  );
}

export function ArsenalClient({
  items,
  canRequest,
  canManageDirectly,
}: {
  items: ArsenalMaterialItem[];
  canRequest: boolean;
  canManageDirectly: boolean;
}) {
  const router = useRouter();
  // Cards do dashboard (page.tsx: "Disponiveis" -> ?estoque=ok, "Baixo
  // estoque" -> ?estoque=baixo, "Esgotados" -> ?estoque=esgotado) navegam
  // pra cá já com o filtro na URL — mesmo padrão de
  // efetivo/historico/_historico-client.tsx para ?status=. Validado contra
  // STOCK_FILTER_VALUES para nunca aceitar um valor arbitrário da querystring
  // como estado interno.
  const searchParams = useSearchParams();
  const rawInitialStock = searchParams.get("estoque");
  const initialStock: StockFilter = isStockFilter(rawInitialStock) ? rawInitialStock : "all";

  const [catFilter, setCatFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState<StockFilter>(initialStock);
  const [selected, setSelected] = useState<ArsenalMaterialItem | null>(null);
  // Começa aberto quando chega com um filtro de estoque pré-selecionado (via
  // card do dashboard) — painel fechado esconderia o motivo da lista já vir
  // filtrada.
  const [filtersOpen, setFiltersOpen] = useState(initialStock !== "all");
  const [viewMode, setViewMode] = useState<ViewMode>("grade");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingCautela, setEditingCautela] = useState<ArsenalMaterialItem | null>(null);

  async function handleDeleteMaterial(m: ArsenalMaterialItem) {
    if (m.quantidade_em_uso_fisico > 0) return; // botão já vem desabilitado nesse caso
    const confirmed = window.confirm(
      `Desativar "${m.nome}"? O material sai das listas operacionais sem apagar histórico.`
    );
    if (!confirmed) return;
    setDeletingId(m.id);
    try {
      const { ok, status, data } = await bffFetch("DELETE", `/api/arsenal/${m.id}`);
      if (!ok) {
        console.error("[arsenal-client] falha ao desativar material", { status, error: data.error });
        toast.error(friendlyApiError(status, data.error, "Erro ao desativar material"));
        return;
      }
      toast.success(`${m.nome} desativado`);
      router.refresh();
    } catch (err) {
      console.error("[arsenal-client] erro de conexao ao desativar material", err);
      toast.error("Erro de conexão. Tente novamente.");
    } finally {
      setDeletingId(null);
    }
  }

  const categories = useMemo(
    () => ["all", ...Array.from(new Set(items.map((m) => m.categoria)))],
    [items]
  );

  const grid = useGridState<MaterialItemFlat>(items, {
    searchFields: ["nome", "categoria"],
    defaultSort: { field: "nome", dir: "asc" },
  });

  const { searchText, setSearchText, sortField, sortDir, toggleSort, processedData } = grid;

  const filtered = useMemo(() => {
    return processedData.filter((m) => {
      if (catFilter !== "all" && m.categoria !== catFilter) return false;
      if (stockFilter !== "all" && getMaterialStockStatus(m) !== stockFilter) return false;
      return true;
    });
  }, [processedData, catFilter, stockFilter]);

  const grouped = useMemo(() =>
    filtered.reduce<Record<string, ArsenalMaterialItem[]>>((acc, m) => {
      const cat = m.categoria ?? "outro";
      acc[cat] = acc[cat] ?? [];
      acc[cat].push(m);
      return acc;
    }, {}),
  [filtered]);

  const hasActiveFilters = catFilter !== "all" || stockFilter !== "all";

  return (
    <>
      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <GridSearchInput
          value={searchText}
          onChange={setSearchText}
          placeholder="Buscar material..."
          className="flex-1"
        />
        <div className="flex items-center gap-2 shrink-0">
          <GridPdfButton printTargetId="arsenal-armeiro-print" label="PDF" />
          <div className="flex rounded-xl border border-border overflow-hidden">
            <button type="button" onClick={() => setViewMode("grade")} title="Ver em grade"
              className={cn("px-2.5 py-2 transition-colors", viewMode === "grade" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted/60")}>
              <LayoutGrid className="size-4" />
            </button>
            <button type="button" onClick={() => setViewMode("lista")} title="Ver em lista"
              className={cn("px-2.5 py-2 transition-colors", viewMode === "lista" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted/60")}>
              <List className="size-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            title="Mostrar/ocultar filtros"
            className={cn(
              "flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
              hasActiveFilters ? "border-primary bg-primary/5 text-primary" : "border-border bg-card text-muted-foreground hover:bg-muted/60"
            )}
          >
            <SlidersHorizontal className="size-4" />
            Filtros
            {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
          </button>
        </div>
      </div>

      {/* Expanded filters — dropdowns nativos (antes: fileiras de pills),
          mesmo padrão de <select> já usado em
          efetivo/historico/_historico-client.tsx (FilterField). Os tooltips
          continuam vindo de FilterGroupLabel — só o controle visual mudou. */}
      {filtersOpen && (
        <div className="flex flex-wrap gap-3 rounded-xl border border-border bg-card p-3">
          <div className="flex flex-wrap gap-1.5 items-center">
            <FilterGroupLabel
              label="Categoria:"
              tooltip="Filtra os materiais exibidos pela categoria cadastrada no almoxarifado."
              className="mr-1"
            />
            <div className="relative">
              <select
                value={catFilter}
                onChange={(e) => setCatFilter(e.target.value)}
                data-testid="arsenal-categoria-select"
                aria-label="Filtrar por categoria"
                className="h-8 appearance-none rounded-lg border border-input bg-white dark:bg-card pl-2.5 pr-7 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer"
              >
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat === "all" ? "Todas" : CATEGORIA_LABEL[cat] ?? cat}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 items-center">
            <FilterGroupLabel
              label="Estoque:"
              tooltip="Filtra pela situação do estoque: Regular (acima de 20% disponível), Baixo (20% ou menos) ou Esgotado (nenhuma unidade disponível)."
              className="mr-1"
            />
            <div className="relative">
              <select
                value={stockFilter}
                onChange={(e) => setStockFilter(e.target.value as StockFilter)}
                data-testid="arsenal-estoque-select"
                aria-label="Filtrar por situação de estoque"
                className="h-8 appearance-none rounded-lg border border-input bg-white dark:bg-card pl-2.5 pr-7 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer"
              >
                {STOCK_FILTER_VALUES.map((s) => (
                  <option key={s} value={s}>{STOCK_FILTER_LABEL[s]}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            </div>
          </div>
          {hasActiveFilters && (
            <button type="button" onClick={() => { setCatFilter("all"); setStockFilter("all"); }}
              className="text-xs text-destructive hover:underline cursor-pointer ml-auto">
              Limpar filtros
            </button>
          )}
        </div>
      )}

      {(searchText || hasActiveFilters) && (
        <p className="text-xs text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? "material encontrado" : "materiais encontrados"}
        </p>
      )}

      {/* Lista mode */}
      {viewMode === "lista" ? (
        <div id="arsenal-armeiro-print" className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Nenhum material encontrado</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <GridSortHead<MaterialItemFlat> field="nome" currentSort={{ field: sortField, dir: sortDir }} onSort={toggleSort} label="Material" className="pl-5" />
                  <GridSortHead<MaterialItemFlat> field="categoria" currentSort={{ field: sortField, dir: sortDir }} onSort={toggleSort} label="Categoria" className="hidden sm:table-cell" />
                  <GridSortHead<MaterialItemFlat> field="quantidade_disponivel" currentSort={{ field: sortField, dir: sortDir }} onSort={toggleSort} label="Disponível" />
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Em Uso</th>
                  <th className={cn("px-4 py-2.5 text-left text-xs font-medium text-muted-foreground", !canManageDirectly && "pr-5")}>Status</th>
                  {canManageDirectly && (
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground pr-5">Ações</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => {
                  const status = getMaterialStockStatus(m);
                  return (
                    <tr key={m.id} onClick={() => setSelected(m)} className="border-b border-border/60 hover:bg-primary/5 transition-colors cursor-pointer" data-testid="arsenal-material-row">
                      <td className="px-4 py-3 pl-5">
                        <div className="flex items-center gap-2">
                          <div className="size-7 rounded-lg bg-primary/8 flex items-center justify-center shrink-0 overflow-hidden">
                            {m.photo_display_url ? <img src={m.photo_display_url} alt="" className="h-full w-full object-cover" /> : <Package className="size-3.5 text-primary" />}
                          </div>
                          <span className="font-medium truncate">{m.nome}</span>
                          {!m.categoria_ativa && <CategoriaDesativadaBadge />}
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground capitalize">{CATEGORIA_LABEL[m.categoria] ?? m.categoria}</td>
                      <td className="px-4 py-3 font-semibold tabular-nums text-emerald-700">{m.quantidade_disponivel}</td>
                      <td className="px-4 py-3 tabular-nums text-amber-700">{m.quantidade_armada ?? 0}</td>
                      <td className={cn("px-4 py-3", !canManageDirectly && "pr-5")}>
                        <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full",
                          status === "esgotado" ? "bg-destructive/10 text-destructive" :
                          status === "baixo" ? "bg-amber-50 text-amber-700" :
                          "bg-emerald-50 text-emerald-700")}>
                          {status === "esgotado" ? "Crítico" : status === "baixo" ? "Baixo" : "Regular"}
                        </span>
                      </td>
                      {canManageDirectly && (
                        <td className="px-4 py-3 pr-5 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex items-center gap-1">
                            <CautelaEditButton material={m} onClick={() => setEditingCautela(m)} />
                            <DeleteMaterialButton
                              material={m}
                              deleting={deletingId === m.id}
                              onDelete={() => handleDeleteMaterial(m)}
                            />
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        /* Grade mode — grouped cards */
        Object.keys(grouped).length === 0 ? (
          <div className="rounded-2xl bg-card p-10 text-center text-muted-foreground text-sm" style={{ boxShadow: "var(--shadow-card)" }}>
            Nenhum material encontrado
          </div>
        ) : (
          <div className="space-y-3" id="arsenal-armeiro-print">
            {Object.entries(grouped).map(([cat, itens]) => (
              <div key={cat} className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{CATEGORIA_LABEL[cat] ?? cat}</h3>
                  <span className="text-xs text-muted-foreground">{itens.length} item{itens.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="divide-y divide-border/60">
                  {itens.map((m) => {
                    const pct = m.quantidade_total > 0 ? Math.round((m.quantidade_disponivel / m.quantidade_total) * 100) : 0;
                    const status = getMaterialStockStatus(m);
                    const dotColor = status === "esgotado" ? "bg-destructive" : status === "baixo" ? "bg-amber-500" : "bg-emerald-500";
                    const numColor = status === "esgotado" ? "text-destructive" : status === "baixo" ? "text-amber-600" : "text-emerald-600";
                    return (
                      // div (não button) — precisa comportar um <button> de
                      // ação de deletar aninhado (canManageDirectly), o que
                      // seria HTML inválido dentro de um <button> pai.
                      // role="button" + tabIndex + onKeyDown preservam a
                      // acessibilidade de teclado que o <button> original tinha.
                      <div key={m.id} role="button" tabIndex={0}
                        onClick={() => setSelected(m)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(m); } }}
                        data-testid="arsenal-material-row"
                        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-primary/5 transition-colors cursor-pointer text-left">
                        <div className="relative shrink-0">
                          <div className="size-10 overflow-hidden rounded-xl border border-border bg-muted/40 flex items-center justify-center text-muted-foreground">
                            {m.photo_display_url ? <img src={m.photo_display_url} alt="" className="h-full w-full object-cover" /> : <Package className="size-4" />}
                          </div>
                          <span className={cn("absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card", dotColor)} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-medium truncate">{m.nome}</p>
                            {!m.categoria_ativa && <CategoriaDesativadaBadge />}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5">
                            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden max-w-20">
                              <div className={cn("h-full rounded-full", dotColor)} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-[11px] text-muted-foreground">{pct}%</span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold">
                            <span className={numColor}>{m.quantidade_disponivel}</span>
                            <span className="text-muted-foreground font-normal text-xs"> / {m.quantidade_total}</span>
                          </p>
                          {m.quantidade_armada > 0 && (
                            <p className="text-[10px] text-muted-foreground">{m.quantidade_armada} em uso</p>
                          )}
                        </div>
                        {canManageDirectly && (
                          <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <CautelaEditButton material={m} onClick={() => setEditingCautela(m)} />
                            <DeleteMaterialButton
                              material={m}
                              deleting={deletingId === m.id}
                              onDelete={() => handleDeleteMaterial(m)}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      <MaterialDetailSheet
        material={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
        canRequest={canRequest}
        canManageDirectly={canManageDirectly}
      />

      <CautelaEditDialog
        material={editingCautela}
        onClose={() => setEditingCautela(null)}
        onSaved={() => router.refresh()}
      />
    </>
  );
}
