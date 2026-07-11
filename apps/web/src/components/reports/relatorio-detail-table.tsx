"use client";

import type { ReactNode } from "react";
import { ChevronDown, FileText } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GridRowCheckbox, GridSelectAll } from "@/components/shared/grid-row-checkbox";
import { GridPdfButton } from "@/components/shared/grid-pdf-button";
import { usePaginatedSelection } from "@/components/shared/use-paginated-selection";
import type { CautelaRow, LivroRow, SaidaRow } from "./types";
import { CAUTELA_STATUS_LABELS, EVENT_TYPE_LABELS } from "./types";

interface ReportMeta {
  printTargetId: string;
  reportTitle: string;
  armeiroName?: string;
  reserveName?: string;
}

type DetailTableProps = ReportMeta &
  (
    | { tipo: "saidas"; rows: SaidaRow[] }
    | { tipo: "cautelas"; rows: CautelaRow[] }
    | { tipo: "livro"; rows: LivroRow[] }
  );

function statusBadgeClass(kind: "success" | "warning" | "danger" | "in-use"): string {
  const base = "text-[10px] font-semibold rounded-full px-2 py-0.5";
  if (kind === "success") return `badge-success ${base}`;
  if (kind === "warning") return `badge-warning ${base}`;
  if (kind === "danger") return `badge-danger ${base}`;
  return `badge-in-use ${base}`;
}

function fmtDate(v: string | null | undefined): string {
  return v ? new Date(v).toLocaleDateString("pt-BR") : "—";
}

function fmtDateTime(v: string | null | undefined): string {
  return v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
}

/** Casca comum (paginação "Ver mais" 10/20/30 + seleção + exportação em PDF) reutilizada
 * pelas três variantes de tabela — evita triplicar essa lógica de estado. */
function DetailTableShell<T extends { id: string }>({
  title,
  rows,
  meta,
  renderHeaderCells,
  renderRowCells,
}: {
  title: string;
  rows: T[];
  meta: ReportMeta;
  renderHeaderCells: () => ReactNode;
  renderRowCells: (row: T) => ReactNode;
}) {
  const {
    hasMore, showLimitMenu, setShowLimitMenu, setDisplayLimit,
    displayed, selectedIds, toggleItem, toggleAll, allDisplayedSel, someDisplayedSel,
  } = usePaginatedSelection(rows);

  const selectedRows = rows.filter((r) => selectedIds.has(r.id));

  return (
    <div className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
      <div className="px-5 py-4 border-b flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{rows.length} registros</span>
          <GridPdfButton
            printTargetId={meta.printTargetId}
            label="Exportar PDF"
            disabled={selectedIds.size === 0}
            selectedCount={selectedIds.size}
            selectedGroupKeys={[...selectedIds]}
            reportTitle={meta.reportTitle}
            armeiroName={meta.armeiroName}
            reserveName={meta.reserveName}
            selectedData={selectedRows}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="p-10 text-center">
          <FileText className="size-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm font-medium">Nenhum registro encontrado</p>
          <p className="text-xs text-muted-foreground mt-1">Ajuste os filtros para ver resultados</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table id={meta.printTargetId}>
              <TableHeader>
                <TableRow>
                  <GridSelectAll
                    checked={allDisplayedSel}
                    indeterminate={someDisplayedSel && !allDisplayedSel}
                    onChange={toggleAll}
                  />
                  {renderHeaderCells()}
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayed.map((row) => (
                  <TableRow key={row.id} data-group-key={row.id}>
                    <GridRowCheckbox checked={selectedIds.has(row.id)} onChange={() => toggleItem(row.id)} />
                    {renderRowCells(row)}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {hasMore && (
            <div className="relative flex justify-end px-5 py-3 border-t border-border">
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
                <div className="absolute right-5 bottom-full mb-1 z-10 rounded-xl border border-border bg-card shadow-md overflow-hidden min-w-40">
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

function SaidasDetailTable({ rows, meta }: { rows: SaidaRow[]; meta: ReportMeta }) {
  return (
    <DetailTableShell
      title="Saídas — Detalhado"
      rows={rows}
      meta={meta}
      renderHeaderCells={() => (
        <>
          <TableHead>Data</TableHead>
          <TableHead>Militar</TableHead>
          <TableHead className="hidden sm:table-cell">Posto</TableHead>
          <TableHead>Material</TableHead>
          <TableHead className="text-center">Qtd</TableHead>
          <TableHead className="hidden md:table-cell">Local</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden md:table-cell">Devolução</TableHead>
        </>
      )}
      renderRowCells={(l) => (
        <>
          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(l.issued_at)}</TableCell>
          <TableCell>
            <p className="text-sm font-medium">{l.military?.nome_completo ?? "—"}</p>
            <p className="font-mono text-[10px] text-muted-foreground">{l.military?.matricula ?? ""}</p>
          </TableCell>
          <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">{l.military?.posto ?? "—"}</TableCell>
          <TableCell className="text-sm">{l.material_type?.nome ?? "—"}</TableCell>
          <TableCell className="text-center text-sm">{l.quantidade ?? 1}</TableCell>
          <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{l.local ?? "—"}</TableCell>
          <TableCell>
            <span className={statusBadgeClass(l.status === "devolvido" ? "success" : l.status === "ativo" ? "in-use" : "danger")}>
              {l.status === "devolvido" ? "Devolvido" : l.status === "ativo" ? "Ativo" : l.status}
            </span>
          </TableCell>
          <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{fmtDate(l.returned_at)}</TableCell>
        </>
      )}
    />
  );
}

function CautelasDetailTable({ rows, meta }: { rows: CautelaRow[]; meta: ReportMeta }) {
  return (
    <DetailTableShell
      title="Cautelas — Detalhado"
      rows={rows}
      meta={meta}
      renderHeaderCells={() => (
        <>
          <TableHead>Emissão</TableHead>
          <TableHead>Militar</TableHead>
          <TableHead className="hidden sm:table-cell">Posto</TableHead>
          <TableHead>Material</TableHead>
          <TableHead className="hidden md:table-cell">Condição emissão</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden md:table-cell">Condição devolução</TableHead>
          <TableHead className="hidden md:table-cell">Devolução</TableHead>
        </>
      )}
      renderRowCells={(c) => {
        const kind = c.status === "devolvida" || c.status === "substituida" ? "success"
          : c.status === "em_revisao" ? "warning"
          : c.status === "cancelada" ? "danger"
          : "in-use";
        return (
          <>
            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(c.data_emissao)}</TableCell>
            <TableCell>
              <p className="text-sm font-medium">{c.militar?.nome_completo ?? "—"}</p>
              <p className="font-mono text-[10px] text-muted-foreground">{c.militar?.matricula ?? ""}</p>
            </TableCell>
            <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">{c.militar?.posto ?? "—"}</TableCell>
            <TableCell className="text-sm">
              {c.item?.material_type?.nome ?? "—"}
              {c.item?.identificador_principal && (
                <span className="text-xs text-muted-foreground ml-1">#{c.item.identificador_principal}</span>
              )}
            </TableCell>
            <TableCell className="hidden md:table-cell text-xs text-muted-foreground capitalize">{c.condicao_emissao}</TableCell>
            <TableCell>
              <span className={statusBadgeClass(kind)}>{CAUTELA_STATUS_LABELS[c.status] ?? c.status}</span>
            </TableCell>
            <TableCell className="hidden md:table-cell text-xs text-muted-foreground capitalize">{c.condicao_devolucao ?? "—"}</TableCell>
            <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{fmtDate(c.data_devolucao)}</TableCell>
          </>
        );
      }}
    />
  );
}

function LivroDetailTable({ rows, meta }: { rows: LivroRow[]; meta: ReportMeta }) {
  return (
    <DetailTableShell
      title="Livro de Serviço — Detalhado"
      rows={rows}
      meta={meta}
      renderHeaderCells={() => (
        <>
          <TableHead>Data/Hora</TableHead>
          <TableHead>Tipo de evento</TableHead>
          <TableHead>Usuário</TableHead>
          <TableHead className="hidden sm:table-cell">Material</TableHead>
          <TableHead className="hidden md:table-cell">Descrição</TableHead>
          <TableHead>Status</TableHead>
        </>
      )}
      renderRowCells={(e) => (
        <>
          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDateTime(e.happened_at)}</TableCell>
          <TableCell className="text-sm">{EVENT_TYPE_LABELS[e.event_type] ?? e.event_type}</TableCell>
          <TableCell>
            <div className="flex items-center gap-2">
              {e.actor?.foto_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={e.actor.foto_url} alt="" className="size-7 rounded-full object-cover shrink-0" />
              ) : (
                <div className="size-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-semibold shrink-0">
                  {(e.actor?.nome_completo ?? "—").slice(0, 2).toUpperCase()}
                </div>
              )}
              <div>
                <p className="text-sm font-medium">{e.actor?.nome_completo ?? "—"}</p>
                <p className="font-mono text-[10px] text-muted-foreground">{e.actor?.matricula ?? ""}</p>
              </div>
            </div>
          </TableCell>
          <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">{e.material_nome ?? "—"}</TableCell>
          <TableCell className="hidden md:table-cell text-xs text-muted-foreground max-w-75">{e.description}</TableCell>
          <TableCell>
            {e.is_pending ? (
              <span className={statusBadgeClass(e.resolved_at ? "success" : "warning")}>
                {e.resolved_at ? "Resolvido" : "Pendente"}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </TableCell>
        </>
      )}
    />
  );
}

export function RelatorioDetailTable(props: DetailTableProps) {
  const { printTargetId, reportTitle, armeiroName, reserveName } = props;
  const meta: ReportMeta = { printTargetId, reportTitle, armeiroName, reserveName };

  if (props.tipo === "cautelas") return <CautelasDetailTable rows={props.rows} meta={meta} />;
  if (props.tipo === "livro") return <LivroDetailTable rows={props.rows} meta={meta} />;
  return <SaidasDetailTable rows={props.rows} meta={meta} />;
}
