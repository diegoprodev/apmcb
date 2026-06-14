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
  material_type: { nome: string; categoria: string } | null;
}

export function ExportButtons({ data, title }: { data: LendingRow[]; title: string }) {
  function exportCSV() {
    const headers = ["Data Saída", "Militar", "Matrícula", "Posto", "Material", "Categoria", "Qtd", "Status", "Data Devolução"];
    const rows = data.map(r => [
      r.issued_at ? new Date(r.issued_at).toLocaleDateString("pt-BR") : "",
      r.military?.nome_completo ?? "",
      r.military?.matricula ?? "",
      r.military?.posto ?? "",
      r.material_type?.nome ?? "",
      r.material_type?.categoria ?? "",
      String(r.quantidade ?? 1),
      r.status,
      r.returned_at ? new Date(r.returned_at).toLocaleDateString("pt-BR") : "",
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title}_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex items-center gap-2 print:hidden">
      <Button size="sm" variant="outline" onClick={exportCSV} className="h-8 text-xs gap-1.5">
        <Download className="size-3.5" />CSV
      </Button>
      <Button size="sm" variant="outline" onClick={() => window.print()} className="h-8 text-xs gap-1.5">
        <Printer className="size-3.5" />PDF / Imprimir
      </Button>
    </div>
  );
}
