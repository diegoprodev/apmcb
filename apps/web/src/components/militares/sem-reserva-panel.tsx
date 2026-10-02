"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, LayoutGrid, Loader2, Search, Table2, User, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { GridPdfButton } from "@/components/shared/grid-pdf-button";
import { ListPagination, type PageSize } from "@/components/shared/list-pagination";
import { cn } from "@/lib/utils";
import { csrfHeaders } from "@/lib/csrf";
import { friendlyApiError } from "@/lib/api-error";
import { fetchReserveTargets, type ReserveTarget } from "./import-militares-dialog";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";
const SEARCH_DEBOUNCE_MS = 300; // guardrails §15: debounce de 300ms em filtros de API

interface SemReservaMilitar {
  id: string; nome_completo: string; matricula: string; posto: string | null; email: string | null;
  invite_sent_at: string | null; account_activated_at: string | null;
}

const INVITE_TOAST: Record<string, string> = {
  sent: "Adicionado à reserva e convite enviado por e-mail.",
  failed: "Adicionado à reserva, mas o convite não pôde ser enviado — reenvie pela lista de usuários.",
  already_active: "Adicionado à reserva (a conta já está ativa).",
  no_email: "Adicionado à reserva. Sem e-mail cadastrado — informe o e-mail para enviar o convite.",
};

/**
 * Filtro "Militares sem reserva" no padrão das listas do app: busca (debounce), visualização em
 * cards ou grade, paginação 10/20/30/50 (no servidor), seleção + exportação em PDF (só quem pode
 * exportar — o armeiro não) e o botão "Adicionar à reserva ▾" por linha. A LISTA de militares sem reserva
 * é do tenant inteiro para os três papéis; as reservas de DESTINO vêm do BFF: admin global = todas do
 * tenant, admin da reserva = as que administra, armeiro = as suas.
 */
export function SemReservaPanel({ canExport = true }: { canExport?: boolean }) {
  const [open, setOpen] = useState(false);
  const [militares, setMilitares] = useState<SemReservaMilitar[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [targets, setTargets] = useState<ReserveTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [targetsFailed, setTargetsFailed] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(10);
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const reqId = useRef(0);
  const targetsLoaded = useRef(false);
  const lastQ = useRef("");

  useEffect(() => {
    const t = setTimeout(() => {
      const next = searchInput.trim();
      if (next === lastQ.current) return; // sem mudança real (inclui a execução inicial): não mexe na página
      lastQ.current = next; setQ(next); setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    const mine = ++reqId.current;
    setLoading(true); setFailed(false); setTargetsFailed(false);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (q) params.set("q", q);
      const [listRes, t] = await Promise.all([
        fetch(`${BFF_URL}/api/admin/militares/sem-reserva?${params}`, { credentials: "include" }),
        targetsLoaded.current ? Promise.resolve(null) : fetchReserveTargets(),
      ]);
      if (mine !== reqId.current) return; // resposta de uma busca anterior
      if (!listRes.ok) {
        console.error("[militares] falha ao listar militares sem reserva", { status: listRes.status });
        setFailed(true);
        return;
      }
      const body = (await listRes.json()) as { militares?: SemReservaMilitar[]; total?: number; page?: number };
      if (typeof body.page === "number" && body.page !== page) setPage(body.page); // o servidor ajustou (página além do fim)
      setMilitares(body.militares ?? []);
      setTotal(body.total ?? 0);
      setSelectedIds(new Set()); // a exportação imprime só a página exibida: seleção não atravessa páginas
      if (t) { targetsLoaded.current = true; setTargets(t.reserves); }
      else if (!targetsLoaded.current) setTargetsFailed(true);
    } catch (err) {
      if (mine !== reqId.current) return;
      console.error("[militares] falha ao listar militares sem reserva", { error: err instanceof Error ? err.message : String(err) });
      setFailed(true);
    } finally {
      if (mine === reqId.current) setLoading(false);
    }
  }, [page, pageSize, q]);

  // Só consulta o BFF com o painel aberto (a lista é do tenant inteiro).
  useEffect(() => { if (open) void load(); }, [open, load]);

  async function add(m: SemReservaMilitar, reserve: ReserveTarget) {
    setAddingId(m.id);
    try {
      const res = await fetch(`${BFF_URL}/api/admin/militares/${m.id}/add-to-reserve`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ reserve_id: reserve.id }),
      });
      const data = await res.json().catch(() => ({})) as { invite?: string; error?: string };
      if (!res.ok) {
        console.error("[militares] falha ao adicionar à reserva", { status: res.status, error: data.error });
        toast.error(friendlyApiError(res.status, data.error, "Não foi possível adicionar à reserva"));
        return;
      }
      toast.success(`${m.nome_completo}: ${INVITE_TOAST[data.invite ?? ""] ?? "Adicionado à reserva."}`);
      void load(); // recarrega a página atual (total e itens corretos)
    } finally {
      setAddingId(null);
    }
  }

  function toggle(id: string) {
    setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  const list = militares ?? [];
  const allSel = list.length > 0 && list.every((m) => selectedIds.has(m.id));
  const someSel = list.some((m) => selectedIds.has(m.id));
  function toggleAll() {
    setSelectedIds(allSel ? new Set() : new Set(list.map((m) => m.id)));
  }

  const addMenu = (m: SemReservaMilitar) => (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={addingId === m.id || targets.length === 0}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex h-8 items-center gap-1 rounded-md border border-input px-3 text-xs hover:bg-accent disabled:opacity-50 outline-none"
        aria-label={`Adicionar ${m.nome_completo} à reserva`}
      >
        {addingId === m.id ? <Loader2 className="size-3.5 animate-spin" /> : null}
        Adicionar à reserva <ChevronDown className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {targets.map((t) => (
          <DropdownMenuItem key={t.id} disabled={t.admin_state !== "ok"} onClick={() => void add(m, t)}>
            {t.nome}
            {t.admin_state === "pending_invite" ? " — aguardando o aceite do convite do administrador" : t.admin_state === "no_admin" ? " — sem administrador" : ""}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <section aria-label="Militares sem reserva" className="space-y-3">
      <Button
        variant={open ? "default" : "outline"}
        size="sm"
        className="gap-1.5"
        onClick={() => { setFailed(false); setOpen((o) => !o); }}
        aria-pressed={open}
        data-testid="filtro-sem-reserva"
      >
        <Users className="size-4" />
        Sem reserva{total !== null ? ` (${total})` : ""}
      </Button>

      {open && (
        <div className="rounded-2xl bg-card p-4" style={{ boxShadow: "var(--shadow-card)" }}>
          {/* Toolbar: busca + total + visualização + exportação */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 mb-3">
            <div className="relative flex-1 w-full sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Buscar por nome, matrícula ou e-mail..."
                aria-label="Buscar militares sem reserva"
                className="w-full rounded-xl border border-border bg-card pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              {searchInput && (
                <button type="button" onClick={() => setSearchInput("")} aria-label="Limpar busca"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            {total !== null && <span className="text-xs text-muted-foreground hidden sm:block">{total} militar{total !== 1 ? "es" : ""}</span>}
            <div className="flex items-center gap-2 ml-auto">
              {canExport && (
                <GridPdfButton
                  printTargetId="sem-reserva-print"
                  label="Exportar"
                  reportTitle="Militares sem reserva"
                  disabled={selectedIds.size === 0}
                  selectedCount={selectedIds.size}
                  selectedGroupKeys={[...selectedIds]}
                />
              )}
              <div className="flex rounded-xl border border-border overflow-hidden">
                <button type="button" onClick={() => setViewMode("cards")} title="Ver em cards" aria-label="Ver em cards" aria-pressed={viewMode === "cards"}
                  className={cn("px-3 py-2 transition-colors", viewMode === "cards" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted/60")}>
                  <LayoutGrid className="size-4" />
                </button>
                <button type="button" onClick={() => setViewMode("table")} title="Ver em grade" aria-label="Ver em grade" aria-pressed={viewMode === "table"}
                  className={cn("px-3 py-2 transition-colors", viewMode === "table" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted/60")}>
                  <Table2 className="size-4" />
                </button>
              </div>
            </div>
          </div>

          {targetsFailed && !failed && (
            <p className="text-xs text-amber-600 mb-2" role="status">
              Não foi possível carregar as reservas de destino — o botão "Adicionar à reserva" fica indisponível.{" "}
              <button type="button" className="underline" onClick={() => void load()}>Tentar de novo</button>
            </p>
          )}
          {failed && (
            <p className="text-sm text-destructive" role="alert">
              Não foi possível carregar os militares sem reserva.{" "}
              <button type="button" className="underline" onClick={() => void load()}>Tentar de novo</button>
            </p>
          )}
          {loading && militares === null && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Carregando…</p>}

          {!failed && militares && list.length === 0 && (
            <div className="py-10 text-center">
              <User className="size-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm font-medium text-muted-foreground">
                {q ? `Nenhum resultado para "${q}"` : "Todos os militares já são membros de alguma reserva"}
              </p>
              {q && <button type="button" onClick={() => setSearchInput("")} className="mt-2 text-xs text-primary hover:underline">Limpar busca</button>}
            </div>
          )}

          {!failed && list.length > 0 && (
            <div id="sem-reserva-print" aria-busy={loading} className={cn(loading && "opacity-60 transition-opacity")}>
              {viewMode === "cards" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {list.map((m) => (
                    <div key={m.id} data-group-key={m.id}
                      className={cn("rounded-xl border border-border p-3 flex flex-col gap-2", selectedIds.has(m.id) && "bg-primary/5")}>
                      <div className="flex items-start gap-2">
                        <input type="checkbox" checked={selectedIds.has(m.id)} onChange={() => toggle(m.id)}
                          className="mt-1 size-4 rounded accent-primary" aria-label={`Selecionar ${m.nome_completo}`} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{m.nome_completo}</p>
                          <p className="text-xs text-muted-foreground font-mono truncate">{m.matricula}{m.posto ? ` · ${m.posto}` : ""}</p>
                          <p className="text-xs text-muted-foreground truncate">{m.email ?? "Sem e-mail cadastrado"}</p>
                        </div>
                      </div>
                      <div className="print:hidden">{addMenu(m)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl overflow-hidden border border-border">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="px-4 py-3 w-8">
                            <input type="checkbox" checked={allSel} ref={(el) => { if (el) el.indeterminate = someSel && !allSel; }}
                              onChange={toggleAll} className="size-4 rounded accent-primary" aria-label="Selecionar todos" />
                          </th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label">Nome</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label">Matrícula</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label hidden sm:table-cell">Posto</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label hidden md:table-cell">E-mail</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label print:hidden">Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((m, i) => (
                          <tr key={m.id} data-group-key={m.id}
                            className={cn(i < list.length - 1 && "border-b border-border/60", selectedIds.has(m.id) && "bg-primary/5")}>
                            <td className="px-4 py-3">
                              <input type="checkbox" checked={selectedIds.has(m.id)} onChange={() => toggle(m.id)}
                                className="size-4 rounded accent-primary" aria-label={`Selecionar ${m.nome_completo}`} />
                            </td>
                            <td className="px-4 py-3 font-medium text-foreground">{m.nome_completo}</td>
                            <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{m.matricula}</td>
                            <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{m.posto ?? "—"}</td>
                            <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{m.email ?? "—"}</td>
                            <td className="px-4 py-3 text-right print:hidden">{addMenu(m)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {total !== null && total > 0 && (
            <ListPagination
              page={page}
              pageSize={pageSize}
              total={total}
              disabled={loading}
              onPageChange={setPage}
              onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
              testIdPrefix="sr"
            />
          )}
        </div>
      )}
    </section>
  );
}
