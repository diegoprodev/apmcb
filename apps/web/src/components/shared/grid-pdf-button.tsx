"use client";

import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";

interface GridPdfButtonProps {
  selectedCount?: number;
  printTargetId: string;
  label?: string;
  disabled?: boolean;
  selectedGroupKeys?: string[];
}

export function GridPdfButton({ selectedCount, printTargetId, label = "Exportar PDF", disabled, selectedGroupKeys }: GridPdfButtonProps) {
  function handlePrint() {
    const el = document.getElementById(printTargetId);
    if (!el) return;

    let html = el.innerHTML;
    if (selectedGroupKeys && selectedGroupKeys.length > 0) {
      const clone = el.cloneNode(true) as HTMLElement;
      const allGroups = Array.from(clone.querySelectorAll("[data-group-key]"));
      for (const g of allGroups) {
        if (!selectedGroupKeys.includes(g.getAttribute("data-group-key") ?? "")) {
          g.remove();
        }
      }
      html = clone.innerHTML;
    }

    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) return;
    const styles = Array.from(document.styleSheets)
      .map((s) => {
        try { return Array.from(s.cssRules).map((r) => r.cssText).join("\n"); } catch { return ""; }
      })
      .join("\n");
    win.document.write(`
      <html><head><title>Relatório</title><style>
        body { font-family: system-ui, sans-serif; font-size: 12px; padding: 20px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
        th { background: #f5f5f5; font-weight: 600; }
        ${styles}
      </style></head>
      <body>${html}</body></html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 400);
  }

  return (
    <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1.5" disabled={disabled}>
      <FileDown className="size-4" />
      {label}
      {selectedCount != null && selectedCount > 0 && (
        <span className="ml-1 rounded-full bg-primary/10 text-primary text-[10px] font-bold px-1.5 py-0.5">
          {selectedCount}
        </span>
      )}
    </Button>
  );
}
