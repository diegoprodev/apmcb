"use client";

import { Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportToXlsx } from "@/lib/export-xlsx";
import type { CautelaRow, LivroRow, SaidaRow } from "./types";
import { CAUTELA_STATUS_LABELS, EVENT_TYPE_LABELS } from "./types";

type ExportProps =
  | { tipo: "saidas"; rows: SaidaRow[] }
  | { tipo: "cautelas"; rows: CautelaRow[] }
  | { tipo: "livro"; rows: LivroRow[] };

function buildTable(props: ExportProps): { headers: string[]; rows: (string | number)[][] } {
  if (props.tipo === "cautelas") {
    return {
      headers: ["Data Emissao", "Militar", "Matricula", "Posto", "Material", "Identificador", "Condicao Emissao", "Status", "Condicao Devolucao", "Data Devolucao"],
      rows: props.rows.map((c) => [
        c.data_emissao ? new Date(c.data_emissao).toLocaleDateString("pt-BR") : "",
        c.militar?.nome_completo ?? "",
        c.militar?.matricula ?? "",
        c.militar?.posto ?? "",
        c.item?.material_type?.nome ?? "",
        c.item?.identificador_principal ?? "",
        c.condicao_emissao ?? "",
        CAUTELA_STATUS_LABELS[c.status] ?? c.status,
        c.condicao_devolucao ?? "",
        c.data_devolucao ? new Date(c.data_devolucao).toLocaleDateString("pt-BR") : "",
      ]),
    };
  }
  if (props.tipo === "livro") {
    return {
      headers: ["Data/Hora", "Tipo de Evento", "Usuario", "Matricula", "Material", "Descricao", "Status", "Resolvido em"],
      rows: props.rows.map((e) => [
        e.happened_at ? new Date(e.happened_at).toLocaleString("pt-BR") : "",
        EVENT_TYPE_LABELS[e.event_type] ?? e.event_type,
        e.actor?.nome_completo ?? "",
        e.actor?.matricula ?? "",
        e.material_nome ?? "",
        e.description ?? "",
        e.is_pending ? (e.resolved_at ? "Resolvido" : "Pendente") : "",
        e.resolved_at ? new Date(e.resolved_at).toLocaleString("pt-BR") : "",
      ]),
    };
  }
  return {
    headers: ["Data Saida", "Usuario", "Matricula", "Posto", "Material", "Categoria", "Calibre", "Qtd", "Local", "Status", "Data Devolucao"],
    rows: props.rows.map((row) => [
      row.issued_at ? new Date(row.issued_at).toLocaleDateString("pt-BR") : "",
      row.military?.nome_completo ?? "",
      row.military?.matricula ?? "",
      row.military?.posto ?? "",
      row.material_type?.nome ?? "",
      row.material_type?.categoria ?? "",
      row.material_type?.calibre ?? "",
      row.quantidade ?? 1,
      row.local ?? "",
      row.status,
      row.returned_at ? new Date(row.returned_at).toLocaleDateString("pt-BR") : "",
    ]),
  };
}

export function RelatorioExportButtons(props: ExportProps & { title: string }) {
  const dateTag = new Date().toISOString().split("T")[0];
  const filename = `${props.title}_${dateTag}`;

  function exportCSV() {
    const { headers, rows } = buildTable(props);
    const csv = [headers, ...rows]
      .map((csvRow) => csvRow.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const BOM = String.fromCharCode(0xfeff);
    const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${filename}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleExcelExport() {
    const { headers, rows } = buildTable(props);
    await exportToXlsx([headers, ...rows], filename);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <Button size="sm" variant="outline" onClick={exportCSV} className="h-8 text-xs gap-1.5" data-testid="btn-export-csv">
        <Download className="size-3.5" />CSV
      </Button>
      <Button size="sm" variant="outline" onClick={handleExcelExport} className="h-8 text-xs gap-1.5" data-testid="btn-export-excel">
        <FileSpreadsheet className="size-3.5" />Excel
      </Button>
    </div>
  );
}
