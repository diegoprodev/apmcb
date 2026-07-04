"use client";

import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface GridPdfButtonProps {
  selectedCount?: number;
  printTargetId: string;
  label?: string;
  disabled?: boolean;
  selectedGroupKeys?: string[];
  // Enterprise header
  reportTitle?: string;
  reserveName?: string;
  armeiroName?: string;
  tenantLogoUrl?: string;
  // Raw data for integrity hash
  selectedData?: unknown[];
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function formatDateTime(d: Date): string {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function GridPdfButton({
  selectedCount,
  printTargetId,
  label = "Exportar PDF",
  disabled,
  selectedGroupKeys,
  reportTitle = "RELATÓRIO",
  reserveName,
  armeiroName,
  tenantLogoUrl,
  selectedData,
}: GridPdfButtonProps) {
  const [printing, setPrinting] = useState(false);

  async function handlePrint() {
    const el = document.getElementById(printTargetId);
    if (!el) return;
    setPrinting(true);
    try {
      const clone = el.cloneNode(true) as HTMLElement;

      if (selectedGroupKeys && selectedGroupKeys.length > 0) {
        const allGroups = Array.from(clone.querySelectorAll("[data-group-key]"));
        for (const g of allGroups) {
          if (!selectedGroupKeys.includes(g.getAttribute("data-group-key") ?? "")) {
            g.remove();
          }
        }
      }

      // Remove interactive controls from print clone
      for (const el of Array.from(clone.querySelectorAll("button, input[type='checkbox']"))) {
        el.remove();
      }

      const now = new Date();
      const hashInput = JSON.stringify({
        data: selectedData ?? selectedGroupKeys ?? [],
        ts: now.toISOString(),
      });
      const hash = (await sha256Hex(hashInput)).slice(0, 16).toUpperCase();

      const logoHtml = tenantLogoUrl
        ? `<img src="${tenantLogoUrl}" alt="Logo" style="height:48px;object-fit:contain;" />`
        : `<div style="width:48px;height:48px;background:#1e40af;border-radius:8px;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:18px;">A</div>`;

      const headerHtml = `
        <div class="pdf-header">
          <div class="pdf-header-logo">${logoHtml}</div>
          <div class="pdf-header-meta">
            <div class="pdf-title">${reportTitle}</div>
            ${reserveName ? `<div class="pdf-meta-row">Reserva: <strong>${reserveName}</strong></div>` : ""}
            ${armeiroName ? `<div class="pdf-meta-row">Armeiro: <strong>${armeiroName}</strong></div>` : ""}
            <div class="pdf-meta-row">Emitido em: <strong>${formatDateTime(now)}</strong></div>
            <div class="pdf-meta-row">Total: <strong>${selectedCount ?? 0} registro(s)</strong></div>
          </div>
        </div>
        <hr class="pdf-divider" />
      `;

      const footerHtml = `
        <hr class="pdf-divider" />
        <div class="pdf-footer">
          <div>Hash de integridade: <code>SHA256-${hash}</code></div>
          <div class="pdf-footer-sub">Documento gerado automaticamente pelo Sistema de Controle de Bens Sensíveis</div>
        </div>
      `;

      const pageStyles = `
        * { box-sizing: border-box; }
        body { font-family: system-ui, -apple-system, sans-serif; font-size: 12px; padding: 24px; color: #111; margin: 0; }
        .pdf-header { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 12px; }
        .pdf-header-logo { flex-shrink: 0; }
        .pdf-header-meta { flex: 1; }
        .pdf-title { font-size: 16px; font-weight: 700; color: #1e3a5f; letter-spacing: 0.02em; margin-bottom: 6px; }
        .pdf-meta-row { font-size: 11px; color: #555; margin: 2px 0; }
        .pdf-divider { border: none; border-top: 2px solid #1e3a5f; margin: 10px 0; }
        .pdf-footer { font-size: 10px; color: #777; display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
        .pdf-footer code { font-family: monospace; background: #f5f5f5; padding: 2px 4px; border-radius: 3px; font-size: 10px; }
        .pdf-footer-sub { color: #aaa; }
        table { width: 100%; border-collapse: collapse; margin: 8px 0; }
        th, td { border: 1px solid #e0e0e0; padding: 6px 10px; text-align: left; font-size: 11px; }
        th { background: #f0f4f8; font-weight: 600; color: #1e3a5f; }
        tr:nth-child(even) { background: #fafafa; }
        @media print {
          body { padding: 12px; }
          .pdf-header, .pdf-footer { display: flex !important; }
        }
      `;

      const win = window.open("", "_blank", "width=960,height=720");
      if (!win) { setPrinting(false); return; }

      win.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>${reportTitle}</title>
  <style>${pageStyles}</style>
</head>
<body>
  ${headerHtml}
  ${clone.outerHTML}
  ${footerHtml}
</body>
</html>`);
      win.document.close();
      win.focus();

      // Wait for images to load before printing
      await new Promise<void>((resolve) => {
        const imgs = Array.from(win.document.images);
        if (imgs.length === 0) { resolve(); return; }
        let loaded = 0;
        const check = () => { if (++loaded >= imgs.length) resolve(); };
        imgs.forEach((img) => {
          if (img.complete) check();
          else { img.onload = check; img.onerror = check; }
        });
        setTimeout(resolve, 2000);
      });

      win.print();
      win.close();
    } finally {
      setPrinting(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handlePrint}
      className="gap-1.5"
      disabled={disabled || printing}
    >
      {printing ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
      {label}
      {selectedCount != null && selectedCount > 0 && (
        <span className="ml-1 rounded-full bg-primary/10 text-primary text-[10px] font-bold px-1.5 py-0.5">
          {selectedCount}
        </span>
      )}
    </Button>
  );
}
