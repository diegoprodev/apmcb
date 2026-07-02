"use client";

import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LendingRow {
  id: string;
  issued_at: string;
  returned_at: string | null;
  status: string;
  quantidade: number;
  notes: string | null;
  military: { nome_completo: string; matricula: string; posto: string } | null;
  material_type: { nome: string; categoria: string; calibre?: string | null } | null;
}

export function ExportButtons({ data, title }: { data: LendingRow[]; title: string }) {
  function exportCSV() {
    const headers = ["Data Saida", "Usuário", "Matricula", "Cargo", "Material", "Categoria", "Calibre", "Qtd", "Status", "Data Devolucao"];
    const rows = data.map((row) => [
      row.issued_at ? new Date(row.issued_at).toLocaleDateString("pt-BR") : "",
      row.military?.nome_completo ?? "",
      row.military?.matricula ?? "",
      row.military?.posto ?? "",
      row.material_type?.nome ?? "",
      row.material_type?.categoria ?? "",
      row.material_type?.calibre ?? "",
      String(row.quantidade ?? 1),
      row.status,
      row.returned_at ? new Date(row.returned_at).toLocaleDateString("pt-BR") : "",
    ]);
    const csv = [headers, ...rows].map((csvRow) => csvRow.map((cell) => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${title.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex items-center gap-2 print:hidden">
      <Button size="sm" variant="outline" onClick={exportCSV} className="h-8 text-xs gap-1.5">
        <Download className="size-3.5" />
        CSV
      </Button>
      <Button size="sm" variant="outline" onClick={() => window.print()} className="h-8 text-xs gap-1.5">
        <Printer className="size-3.5" />
        PDF / Imprimir
      </Button>
    </div>
  );
}
