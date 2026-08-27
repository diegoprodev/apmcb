"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Package, SlidersHorizontal, LayoutGrid, List, ChevronDown, Trash2, Loader2, ShieldCheck } from "lucide-react";
import { MaterialDetailSheet, type MaterialItem } from "@/components/arsenal/material-detail-sheet";
import { GridSearchInput } from "@/components/shared/grid-search-input";
import { GridSortHead } from "@/components/shared/grid-sort-head";
import { GridPdfButton } from "@/components/shared/grid-pdf-button";
import { GridRowCheckbox, GridSelectAll } from "@/components/shared/grid-row-checkbox";
import { usePaginatedSelection } from "@/components/shared/use-paginated-selection";
import { FilterGroupLabel } from "@/components/shared/filter-field";
import { useGridState } from "@/components/shared/use-grid-state";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { getMaterialStockStatus, type ArsenalMaterialItem } from "@/lib/arsenal-status";
import { bffFetch } from "@/lib/bff-client";
import { useLastTruthy } from "@/hooks/use-last-truthy";
import { useConfirm } from "@/hooks/use-confirm";
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

const GRADE_CATEGORY_LIMIT = 15;

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

type CautelaEditItem = {
  id: string;
  identificador_principal: string;
  numero_serie: string | null;
  validade_item: string | null;
  status_operacional: string;
  cautela_elegivel: boolean;
};

/** Painel de edição (CAU-08). Cenário A (rastreio individual — número de
 * série ou validade): checklist por unidade — elegibilidade é POR ITEM, não
 * mais "todas automaticamente" (achado do usuário: gestão às vezes quer
 * disponibilizar só alguns itens específicos do acervo). Cenário B (material
 * bulk): checkbox + quantidade, validada no backend contra quantidade_total
 * e contra quantos itens sintéticos ainda podem ser removidos com segurança. */
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
  const [items, setItems] = useState<CautelaEditItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loadingItems, setLoadingItems] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!material) return;
    setHabilitada(!!material.cautela_habilitada);
    setQuantidade(material.quantidade_cautela && material.quantidade_cautela > 0 ? material.quantidade_cautela : 1);
    setItems([]);
    setSelectedIds(new Set());

    if (!scenarioA) return;
    let cancelled = false;
    setLoadingItems(true);
    bffFetch("GET", `/api/arsenal/${material.id}/items`)
      .then(({ ok, status, data }) => {
        if (cancelled) return;
        if (!ok) {
          toast.error(friendlyApiError(status, data.error, "Erro ao carregar unidades do material"));
          return;
        }
        const rows = (data as CautelaEditItem[]) ?? [];
        setItems(rows);
        const alreadyEligible = rows.filter((r) => r.cautela_elegivel).map((r) => r.id);
        // Nenhuma unidade marcada ainda e cautela nunca foi habilitada pra
        // este material: pré-marca todas (mesmo default intuitivo de antes
        // — "todas as unidades", que o usuário desmarca se quiser reduzir),
        // em vez de abrir um checklist vazio confuso na primeira vez.
        setSelectedIds(new Set(
          alreadyEligible.length === 0 && !material.cautela_habilitada
            ? rows.map((r) => r.id)
            : alreadyEligible
        ));
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[arsenal-client] erro de conexao ao carregar unidades", err);
        toast.error("Erro de conexão ao carregar unidades do material");
      })
      .finally(() => { if (!cancelled) setLoadingItems(false); });
    return () => { cancelled = true; };
  }, [material, scenarioA]);

  if (!material) return null;

  function toggleItem(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }

  async function handleSave() {
    if (habilitada && !scenarioA && (quantidade < 1 || quantidade > material!.quantidade_total)) {
      toast.error(`Informe uma quantidade entre 1 e ${material!.quantidade_total}`);
      return;
    }
    if (habilitada && scenarioA && selectedIds.size === 0) {
      toast.error("Marque ao menos uma unidade como disponível para cautela");
      return;
    }
    setSaving(true);
    try {
      const { ok, status, data } = await bffFetch("PATCH", `/api/arsenal/${material!.id}`, {
        cautela_habilitada: habilitada,
        quantidade_cautela: habilitada && !scenarioA ? quantidade : undefined,
        eligible_item_ids: habilitada && scenarioA ? Array.from(selectedIds) : undefined,
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
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">Unidades disponíveis para cautela</p>
                <span className="text-xs text-muted-foreground">{selectedIds.size} de {items.length}</span>
              </div>
              {loadingItems ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Carregando unidades...
                </div>
              ) : items.length === 0 ? (
                <p className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  Nenhuma unidade cadastrada para este material.
                </p>
              ) : (
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                  {items.map((item) => (
                    <label key={item.id} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-muted/30">
                      <input
                        type="checkbox"
                        data-testid={`cautela-edit-item-${item.id}`}
                        checked={selectedIds.has(item.id)}
                        onChange={(e) => toggleItem(item.id, e.target.checked)}
                        disabled={saving}
                        className="size-3.5"
                      />
                      {item.numero_serie || item.identificador_principal}
                      {item.validade_item && (
                        <span className="text-muted-foreground">— validade {item.validade_item}</span>
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>
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

  // Achado real (relatado pelo usuário): clicar num KpiCard do dashboard
  // (page.tsx) navega via <Link href="/reserva/arsenal?estoque=esgotado">
  // — mesma rota, só querystring muda. O App Router NÃO desmonta este
  // client component nessa navegação (é a mesma page), então o `useState`
  // acima (inicializado só 1x, no 1º mount) nunca reagia a essa mudança de
  // URL — a UI ficava presa no filtro do 1º carregamento, mesmo com a URL
  // já refletindo o clique no card. Sincroniza sempre que searchParams
  // mudar, não só no mount.
  useEffect(() => {
    setStockFilter(initialStock);
    if (initialStock !== "all") setFiltersOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialStock]);
  const [viewMode, setViewMode] = useState<ViewMode>("grade");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Achado MÉDIO de code review (DRY/SSOT): useConfirm<T>() extrai o par
  // useState+abrir/cancelar repetido em 5 arquivos — ver hook pra detalhes.
  const { pending: materialToDelete, request: requestDeleteMaterial, cancel: cancelDeleteMaterial } = useConfirm<ArsenalMaterialItem>();
  const lastMaterialToDelete = useLastTruthy(materialToDelete);
  const [editingCautela, setEditingCautela] = useState<ArsenalMaterialItem | null>(null);
  // Achado real do usuário (2026-08-24): a paginação/seleção implementada
  // hoje só se aplica ao modo LISTA — o modo GRADE (padrão, o que o usuário
  // sempre vê primeiro) continuava sem NENHUM limite, renderizando
  // categorias inteiras de uma vez (ex: 410 itens em "Acessório" sozinho),
  // causando scroll gigante E travando o main thread por segundos na
  // montagem inicial (confirmado via trace de performance: ~2s sem nenhum
  // frame desenhado). Fix: cada categoria no modo grade mostra só os
  // primeiros GRADE_CATEGORY_LIMIT itens por padrão, com "Ver mais" por
  // categoria — paginação por categoria, não da lista total (evita o
  // problema já discutido de cortar categorias inteiras de forma
  // inconsistente ao paginar antes de agrupar).
  //
  // Achado de code review: "Ver mais" expandindo a categoria INTEIRA de uma
  // vez (ex: os 395 itens restantes de Acessório) reintroduzia o mesmo
  // travamento de main thread que este fix existe pra eliminar — só que
  // disparado por um clique em vez do carregamento inicial. Por isso o
  // limite é incremental por categoria (Map<categoria, limite atual>, cada
  // clique soma +GRADE_CATEGORY_LIMIT), mesmo padrão "Ver mais" 10→20→30
  // já usado no modo lista, nunca "tudo de uma vez".
  const [categoryLimits, setCategoryLimits] = useState<Map<string, number>>(new Map());
  function expandCategory(cat: string) {
    setCategoryLimits((prev) => {
      const next = new Map(prev);
      next.set(cat, (prev.get(cat) ?? GRADE_CATEGORY_LIMIT) + GRADE_CATEGORY_LIMIT);
      return next;
    });
  }
  // Achado de code review: colapsar uma categoria expandida ("Ver menos")
  // pode esconder itens que o usuário tinha marcado além do limite padrão
  // (ex: expandiu, selecionou o item #18 de 20, colapsou de volta pra 15) —
  // sem isso, `selectedIds` mantinha um id "fantasma" sem nenhum checkbox
  // visível pra desmarcar, deixando o contador do PDF inconsistente com a
  // tela. Remove da seleção os itens que ficarão ocultos pelo novo limite.
  function collapseCategory(cat: string, itens: ArsenalMaterialItem[]) {
    const hiddenIds = itens.slice(GRADE_CATEGORY_LIMIT).map((m) => m.id);
    deselectIds(hiddenIds);
    setCategoryLimits((prev) => {
      const next = new Map(prev);
      next.delete(cat);
      return next;
    });
  }

  function handleDeleteMaterial(m: ArsenalMaterialItem) {
    if (m.quantidade_em_uso_fisico > 0) return; // botão já vem desabilitado nesse caso
    // Achado de code review: sem este guard, confirmar a exclusão de A
    // (DELETE em voo, deletingId=A) e, com o modal já fechado, clicar em
    // excluir B disparava um segundo DELETE concorrente — o `finally` do
    // primeiro request reabilitava o botão de B antes do request dele
    // terminar. Mesmo guard que _biometric-console-client.tsx já tem em
    // revokeDevice.
    if (deletingId) return;
    requestDeleteMaterial(m);
  }

  async function confirmDeleteMaterial() {
    const m = materialToDelete;
    if (!m) return;
    // Defesa em profundidade (achado MÉDIO de code review): handleDeleteMaterial
    // já bloqueia abrir um 2º AlertDialog enquanto deletingId estiver setado,
    // então isto não é alcançável pelo fluxo normal de clique — mas fecha a
    // mesma lacuna diretamente aqui, caso confirmDeleteMaterial venha a ser
    // chamado de outro lugar no futuro sem passar por aquele guard.
    if (deletingId) return;
    cancelDeleteMaterial();
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

  // Paginação "Ver mais" (10→20→30→50→100) + seleção via checkbox para
  // exportação em PDF — mesmo hook/padrão já usado em
  // admin/usuarios/_users-table.tsx e components/reports/relatorio-detail-
  // table.tsx (achado do usuário: Almoxarifado não tinha nenhum dos dois,
  // sempre renderizava a lista inteira e exportava tudo sem seleção). A
  // PAGINAÇÃO "Ver mais" (displayLimit/hasMore) só se aplica ao modo
  // "lista" (tabela) abaixo — no modo "grade" os materiais são agrupados
  // por categoria, onde uma paginação linear cortaria categorias de forma
  // inconsistente (algumas cheias, outras vazias sem motivo visível pro
  // usuário). Modo grade tem sua PRÓPRIA paginação incremental por
  // categoria (ver `categoryLimits` abaixo, achado real do usuário:
  // renderizar uma categoria inteira de 410 itens de uma vez travava o
  // main thread por ~2s). A SELEÇÃO (`selectedIds`/`toggleItem`), porém, é
  // compartilhada pelos dois modos — cada card do grade e cada linha da
  // lista têm seu próprio checkbox, ambos gravando no mesmo Set.
  const {
    displayLimit, setDisplayLimit, showLimitMenu, setShowLimitMenu,
    displayed, hasMore, selectedIds, toggleItem, toggleAll, deselectIds,
    allDisplayedSel, someDisplayedSel,
  } = usePaginatedSelection(filtered);
  const selectedRows = useMemo(
    () => filtered.filter((m) => selectedIds.has(m.id)),
    [filtered, selectedIds]
  );

  // Achado de code review (auto-revisão, subagente indisponível por rate
  // limit no momento): checkbox de seleção agora existe nos DOIS modos
  // (grade e lista, não só lista) — o comportamento antigo aqui
  // ("clearSelection() sempre que sair do modo lista") ficou ASSIMÉTRICO:
  // selecionar no grade e trocar pra lista preservava a seleção, mas
  // selecionar na lista e voltar pro grade a perdia, sem motivo. Removido
  // por completo — a seleção agora persiste livremente entre os dois
  // modos, já que ambos sabem exibi-la. Itens que saem de `filtered` por
  // mudança de busca/filtro/mutação de dados (ex: desativar um material
  // selecionado) continuam sendo removidos da seleção automaticamente
  // dentro de usePaginatedSelection.

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
          <GridPdfButton
            printTargetId="arsenal-armeiro-print"
            label="PDF"
            reportTitle="ALMOXARIFADO"
            // Sem seleção: exporta tudo (a tabela/lista oculta com
            // `filtered` inteiro — sempre completa, independente da
            // paginação visível de qualquer um dos dois modos). Com
            // seleção (checkbox existe nos dois modos): exporta só os
            // marcados — `data-group-key` está presente nos cards do modo
            // grade e nas linhas do modo lista.
            disabled={filtered.length === 0}
            selectedCount={selectedIds.size > 0 ? selectedIds.size : undefined}
            selectedGroupKeys={selectedIds.size > 0 ? [...selectedIds] : undefined}
            selectedData={selectedIds.size > 0 ? selectedRows : undefined}
          />
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
        <div className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Nenhum material encontrado</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <GridSelectAll checked={allDisplayedSel} indeterminate={someDisplayedSel && !allDisplayedSel} onChange={toggleAll} className="pl-5" />
                      <GridSortHead<MaterialItemFlat> field="nome" currentSort={{ field: sortField, dir: sortDir }} onSort={toggleSort} label="Material" />
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
                    {displayed.map((m) => {
                      const status = getMaterialStockStatus(m);
                      return (
                        <tr key={m.id} data-group-key={m.id} onClick={() => setSelected(m)} className="border-b border-border/60 hover:bg-primary/5 transition-colors cursor-pointer" data-testid="arsenal-material-row">
                          <GridRowCheckbox checked={selectedIds.has(m.id)} onChange={() => toggleItem(m.id)} className="pl-5" />
                          <td className="px-4 py-3">
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
              </div>

              {/* Achado CRÍTICO de code review: a tabela acima só renderiza
                  `displayed` (a página atual, ex. 10 de 50) — antes da
                  paginação, "PDF sem seleção" exportava a lista FILTRADA
                  inteira; com a tabela visível como printTargetId, passou a
                  exportar só a página atual, silenciosamente incompleto.
                  Tabela oculta, sempre com TODOS os itens de `filtered`
                  (não só `displayed`), existe só para servir de alvo de
                  impressão — GridPdfButton clona este id, nunca o visível.
                  Sem onClick/botões de ação (o clone os remove de qualquer
                  forma — grid-pdf-button.tsx remove todo `button` do clone),
                  mas mantém `data-group-key` em cada linha para o filtro por
                  seleção continuar funcionando quando o usuário marcar
                  itens específicos. */}
              <table id="arsenal-armeiro-print" className="hidden w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground pl-5">Material</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Categoria</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Disponível</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Em Uso</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground pr-5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((m) => {
                    const status = getMaterialStockStatus(m);
                    return (
                      <tr key={m.id} data-group-key={m.id}>
                        <td className="px-4 py-3 pl-5">{m.nome}</td>
                        <td className="px-4 py-3 capitalize">{CATEGORIA_LABEL[m.categoria] ?? m.categoria}</td>
                        <td className="px-4 py-3">{m.quantidade_disponivel}</td>
                        <td className="px-4 py-3">{m.quantidade_armada ?? 0}</td>
                        <td className="px-4 py-3 pr-5">
                          {status === "esgotado" ? "Crítico" : status === "baixo" ? "Baixo" : "Regular"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {hasMore && (
                <div className="relative flex items-center justify-between px-5 py-3 border-t border-border">
                  <span className="text-xs text-muted-foreground">
                    Mostrando {displayed.length} de {filtered.length}
                  </span>
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
                    <div className="absolute right-5 top-full mt-1 z-10 rounded-xl border border-border bg-card shadow-md overflow-hidden min-w-40">
                      {[20, 30, 50, 100].map((n) => (
                        <button
                          key={n}
                          data-testid={`btn-limit-${n}`}
                          type="button"
                          onClick={() => { setShowLimitMenu(false); setDisplayLimit(n); }}
                          className={cn(
                            "w-full text-left px-4 py-2.5 text-sm hover:bg-muted/60 transition-colors",
                            displayLimit === n && "text-primary font-medium"
                          )}
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
      ) : (
        /* Grade mode — grouped cards */
        Object.keys(grouped).length === 0 ? (
          <div className="rounded-2xl bg-card p-10 text-center text-muted-foreground text-sm" style={{ boxShadow: "var(--shadow-card)" }}>
            Nenhum material encontrado
          </div>
        ) : (
          <div className="space-y-3">
            {Object.entries(grouped).map(([cat, itens]) => {
              const limit = categoryLimits.get(cat) ?? GRADE_CATEGORY_LIMIT;
              const expanded = categoryLimits.has(cat);
              const visibleItens = itens.slice(0, limit);
              const hiddenCount = itens.length - visibleItens.length;
              return (
              <div key={cat} className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{CATEGORIA_LABEL[cat] ?? cat}</h3>
                  <span className="text-xs text-muted-foreground">{itens.length} item{itens.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="divide-y divide-border/60">
                  {visibleItens.map((m) => {
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
                      <div key={m.id} role="button" tabIndex={0} data-group-key={m.id}
                        onClick={() => setSelected(m)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(m); } }}
                        data-testid="arsenal-material-row"
                        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-primary/5 transition-colors cursor-pointer text-left">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(m.id)}
                          onChange={() => toggleItem(m.id)}
                          onClick={(e) => e.stopPropagation()}
                          // Achado de code review: o card pai tem seu próprio
                          // onKeyDown (Enter/Espaço abrem o detalhe, já que é
                          // um `role="button"` navegável por teclado). Sem
                          // isolar o keydown aqui, dar Espaço com foco no
                          // checkbox borbulha pro card, que chama
                          // `preventDefault()` — isso suprime a ativação
                          // nativa do checkbox pelo navegador (que ocorre no
                          // keyup) e abre o detalhe em vez de marcar.
                          onKeyDown={(e) => e.stopPropagation()}
                          aria-label={`Selecionar ${m.nome}`}
                          className="size-4 rounded border-border accent-primary cursor-pointer shrink-0"
                        />
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
                {hiddenCount > 0 && (
                  <button
                    type="button"
                    data-testid={`btn-ver-mais-categoria-${cat}`}
                    aria-expanded={expanded}
                    onClick={() => expandCategory(cat)}
                    className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium text-primary border-t border-border hover:bg-primary/5 transition-colors"
                  >
                    <ChevronDown className="size-4" />
                    Ver mais {Math.min(hiddenCount, GRADE_CATEGORY_LIMIT)} de {hiddenCount} {hiddenCount === 1 ? "item restante" : "itens restantes"}
                  </button>
                )}
                {expanded && (
                  <button
                    type="button"
                    data-testid={`btn-ver-menos-categoria-${cat}`}
                    aria-expanded={expanded}
                    onClick={() => collapseCategory(cat, itens)}
                    className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium text-muted-foreground border-t border-border hover:bg-muted/40 transition-colors"
                  >
                    Ver menos
                  </button>
                )}
              </div>
              );
            })}
          </div>
        )
      )}

      {/* Achado CRÍTICO de code review: assim como no modo lista (ver
          comentário na tabela oculta acima), o alvo de impressão não pode
          ser o container visível — no modo grade ele agora só renderiza
          `visibleItens` (paginado por categoria), então "PDF sem seleção"
          exportaria só as primeiras GRADE_CATEGORY_LIMIT unidades de cada
          categoria, silenciosamente incompleto, num sistema de controle de
          armamento onde isso é grave. Container oculto próprio, sempre com
          TODOS os itens de `filtered` (via `grouped`, sem corte nenhum),
          existe só pra servir de alvo de impressão do modo grade. */}
      {viewMode === "grade" && Object.keys(grouped).length > 0 && (
        <div id="arsenal-armeiro-print" className="hidden">
          {Object.entries(grouped).map(([cat, itens]) => (
            <div key={cat}>
              <h3>{CATEGORIA_LABEL[cat] ?? cat}</h3>
              <table>
                <tbody>
                  {itens.map((m) => (
                    <tr key={m.id} data-group-key={m.id}>
                      <td>{m.nome}</td>
                      <td>{m.quantidade_disponivel}</td>
                      <td>{m.quantidade_armada ?? 0}</td>
                      <td>{m.quantidade_total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
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

      <AlertDialog open={!!materialToDelete} onOpenChange={(next) => { if (!next) cancelDeleteMaterial(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar material?</AlertDialogTitle>
            {/* useLastTruthy (achado BAIXO): mantém o nome visível durante o
                fade-out — materialToDelete já virou null nesse momento. */}
            <AlertDialogDescription>
              {lastMaterialToDelete && (
                <>Desativar &quot;{lastMaterialToDelete.nome}&quot;? O material sai das listas operacionais sem apagar histórico.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteMaterial}>Desativar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
