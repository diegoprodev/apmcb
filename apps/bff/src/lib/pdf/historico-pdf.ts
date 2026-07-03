import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

export interface HistoricoLending {
  id: string;
  status_legacy: string;
  issued_at: string | null;
  returned_at: string | null;
  quantidade: number | null;
  movement_id: string | null;
  material_type: { id?: string; nome: string; categoria: string } | null;
  master: { nome_completo: string; posto?: string | null } | null;
  reserve: { id?: string; nome: string } | null;
}

export interface HistoricoPdfData {
  military: { nome_completo: string; matricula: string; posto?: string | null };
  lendings: HistoricoLending[];
  filters: {
    reserva?: string | null;
    categoria?: string | null;
    from?: string | null;
    to?: string | null;
    status?: string | null;
  };
  generatedAt: string;
  tenantLogoUrl?: string | null;
  tenantName?: string | null;
}

const fmtDt = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("pt-BR") : "—";

const statusLabel = (s: string) => {
  if (s === "ativo") return "Ativo";
  if (s === "devolvido") return "Devolvido";
  if (s === "perdido") return "Perdido";
  return s;
};

export async function generateHistoricoPdf(data: HistoricoPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();

  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontReg  = await pdf.embedFont(StandardFonts.Helvetica);

  const black  = rgb(0, 0, 0);
  const gray   = rgb(0.45, 0.45, 0.45);
  const blue   = rgb(0.1, 0.18, 0.55);
  const white  = rgb(1, 1, 1);
  const lightBg = rgb(0.94, 0.95, 0.98);
  const rowAlt  = rgb(0.97, 0.97, 0.99);
  const red     = rgb(0.75, 0.1, 0.1);
  const green   = rgb(0.1, 0.55, 0.2);

  const margin = 40;
  const pageW  = 841.89; // A4 landscape
  const pageH  = 595.28;

  // ── Logo do tenant ───────────────────────────────────────────────────────
  let logoImage: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  if (data.tenantLogoUrl) {
    try {
      const res  = await fetch(data.tenantLogoUrl);
      const buf  = await res.arrayBuffer();
      const mime = res.headers.get("content-type") ?? "";
      if (mime.includes("png") || data.tenantLogoUrl.endsWith(".png")) {
        logoImage = await pdf.embedPng(buf);
      } else {
        logoImage = await pdf.embedJpg(buf);
      }
    } catch {
      logoImage = null;
    }
  }

  // ── Paginação ────────────────────────────────────────────────────────────
  const ROWS_PER_PAGE = 22;
  const pages = Math.max(1, Math.ceil(data.lendings.length / ROWS_PER_PAGE));

  for (let p = 0; p < pages; p++) {
    const page = pdf.addPage([pageW, pageH]);
    let y = pageH - margin;

    // Logo
    if (logoImage) {
      const logoDims = logoImage.scaleToFit(60, 36);
      page.drawImage(logoImage, { x: margin, y: y - logoDims.height + 10, width: logoDims.width, height: logoDims.height });
    }

    // Header block
    const headerX = logoImage ? margin + 72 : margin;
    page.drawText("HISTÓRICO DE SAÍDAS DE MATERIAL", {
      x: headerX, y, size: 14, font: fontBold, color: blue,
    });
    y -= 16;
    if (data.tenantName) {
      page.drawText(data.tenantName, { x: headerX, y, size: 9, font: fontReg, color: gray });
      y -= 12;
    }

    // Linha divisória
    page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.8, color: blue });
    y -= 10;

    // Info do militar
    const milLine = [
      data.military.posto ? `${data.military.posto} ` : "",
      data.military.nome_completo,
      ` · Mat.: ${data.military.matricula}`,
    ].join("");
    page.drawText(milLine, { x: margin, y, size: 9, font: fontBold, color: black });
    y -= 12;

    // Filtros aplicados
    const filterParts: string[] = [];
    if (data.filters.reserva)  filterParts.push(`Reserva: ${data.filters.reserva}`);
    if (data.filters.categoria) filterParts.push(`Categoria: ${data.filters.categoria}`);
    if (data.filters.status)   filterParts.push(`Status: ${statusLabel(data.filters.status)}`);
    if (data.filters.from)     filterParts.push(`De: ${fmtDt(data.filters.from)}`);
    if (data.filters.to)       filterParts.push(`Até: ${fmtDt(data.filters.to)}`);
    if (filterParts.length === 0) filterParts.push("Sem filtros — todos os registros");

    page.drawText(`Filtros: ${filterParts.join("  |  ")}`, {
      x: margin, y, size: 8, font: fontReg, color: gray,
    });
    y -= 10;

    page.drawText(
      `Gerado em: ${new Date(data.generatedAt).toLocaleString("pt-BR", { timeZone: "America/Recife" })}   |   Página ${p + 1}/${pages}   |   Total: ${data.lendings.length} registro${data.lendings.length !== 1 ? "s" : ""}`,
      { x: margin, y, size: 7.5, font: fontReg, color: gray },
    );
    y -= 14;

    // ── Cabeçalho da tabela ─────────────────────────────────────────────────
    const cols = [
      { label: "MATERIAL",   x: margin,       w: 140 },
      { label: "CATEGORIA",  x: margin + 142, w: 80  },
      { label: "RESERVA",    x: margin + 224, w: 110 },
      { label: "ARMEIRO",    x: margin + 336, w: 120 },
      { label: "SAÍDA",      x: margin + 458, w: 70  },
      { label: "DEVOLUÇÃO",  x: margin + 530, w: 70  },
      { label: "STATUS",     x: margin + 602, w: 58  },
      { label: "QTD",        x: margin + 662, w: 30  },
    ];

    const headerRowH = 16;
    page.drawRectangle({ x: margin, y: y - headerRowH + 4, width: pageW - 2 * margin, height: headerRowH, color: blue });
    for (const col of cols) {
      page.drawText(col.label, { x: col.x + 3, y: y - 9, size: 7.5, font: fontBold, color: white });
    }
    y -= headerRowH + 2;

    // ── Linhas de dados ──────────────────────────────────────────────────────
    const sliceStart = p * ROWS_PER_PAGE;
    const sliceEnd   = Math.min(sliceStart + ROWS_PER_PAGE, data.lendings.length);
    const rowsOnPage = data.lendings.slice(sliceStart, sliceEnd);
    const rowH = 14;

    rowsOnPage.forEach((row, idx) => {
      const bg = idx % 2 === 0 ? white : rowAlt;
      page.drawRectangle({ x: margin, y: y - rowH + 4, width: pageW - 2 * margin, height: rowH, color: bg });

      const textY = y - 8;
      const trunc = (s: string, max: number) => s.length > max ? s.slice(0, max - 1) + "…" : s;

      page.drawText(trunc(row.material_type?.nome ?? "—", 24),       { x: cols[0].x + 3, y: textY, size: 8, font: fontReg, color: black });
      page.drawText(trunc(row.material_type?.categoria ?? "—", 13),  { x: cols[1].x + 3, y: textY, size: 8, font: fontReg, color: gray });
      page.drawText(trunc(row.reserve?.nome ?? "—", 18),              { x: cols[2].x + 3, y: textY, size: 8, font: fontReg, color: black });
      page.drawText(trunc(row.master?.nome_completo ?? "—", 20),      { x: cols[3].x + 3, y: textY, size: 8, font: fontReg, color: black });
      page.drawText(fmtDt(row.issued_at),                             { x: cols[4].x + 3, y: textY, size: 8, font: fontReg, color: gray });
      page.drawText(fmtDt(row.returned_at),                           { x: cols[5].x + 3, y: textY, size: 8, font: fontReg, color: gray });

      const statusColor = row.status_legacy === "devolvido" ? green
        : row.status_legacy === "perdido" ? red : blue;
      page.drawText(statusLabel(row.status_legacy), { x: cols[6].x + 3, y: textY, size: 7.5, font: fontBold, color: statusColor });
      page.drawText(String(row.quantidade ?? 1),    { x: cols[7].x + 3, y: textY, size: 8, font: fontReg, color: gray });

      y -= rowH;
    });

    // Borda inferior da tabela
    page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.4, color: rgb(0.8, 0.8, 0.85) });
    y -= 8;

    // Footer
    page.drawText(
      "Documento gerado eletronicamente — Plataforma de Governança de Bens Sensíveis · APMCB",
      { x: margin, y: 20, size: 7, font: fontReg, color: gray },
    );
  }

  return pdf.save();
}
