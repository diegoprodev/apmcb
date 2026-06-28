"use client";

import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportToXlsx } from "@/lib/export-xlsx";

interface LendingRow {
  id: string;
  issued_at: string;
  returned_at: string | null;
  status: string;
  quantidade: number;
  notes: string | null;
  local: string | null;
  military: { nome_completo: string; matricula: string; posto: string } | null;
  material_type: { nome: string; categoria: string; calibre?: string | null } | null;
}

const HEADERS = [
  "Data Saida",
  "Militar",
  "Matricula",
  "Posto",
  "Material",
  "Categoria",
  "Calibre",
  "Qtd",
  "Local",
  "Status",
  "Data Devolucao",
];

function toRows(data: LendingRow[]) {
  return data.map((row) => [
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
  ]);
}

export function ExportButtons({ data, title }: { data: LendingRow[]; title: string }) {
  const dateTag = new Date().toISOString().split("T")[0];
  const filename = `${title}_${dateTag}`;

  function exportCSV() {
    const rows = toRows(data);
    const csv = [HEADERS, ...rows].map((csvRow) => csvRow.map((cell) => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${filename}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleExcelExport() {
    const rows = toRows(data);
    await exportToXlsx([HEADERS, ...rows], filename);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <Button size="sm" variant="outline" onClick={exportCSV} className="h-8 text-xs gap-1.5">
        <Download className="size-3.5" />CSV
      </Button>
      <Button size="sm" variant="outline" onClick={handleExcelExport} className="h-8 text-xs gap-1.5">
        <FileSpreadsheet className="size-3.5" />Excel
      </Button>
      <Button size="sm" variant="outline" onClick={() => window.print()} className="h-8 text-xs gap-1.5">
        <Printer className="size-3.5" />PDF / Imprimir
      </Button>
    </div>
  );
}
