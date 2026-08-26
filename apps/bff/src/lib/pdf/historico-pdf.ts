import { PDFDocument } from "pdf-lib";
import {
  loadTenantBranding, embedFonts, drawHeader, drawTable, drawFooter, safeDrawText,
  fmtDate, fmtDateTime, fmtCivilDate, GRAY_TEXT, type TableRow,
} from "./pdf-theme";

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
  tenantId: string | null;
  tenantName?: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  ativo: "Ativo",
  devolvido: "Devolvido",
  perdido: "Perdido",
};

// A4 paisagem — mantido do original (tabela larga com 8 colunas cabe melhor
// deitada que em retrato); drawHeader/drawTable/drawFooter usam
// page.getSize() e não constantes fixas, então funcionam normalmente aqui.
const PAGE_W = 841.89;
const PAGE_H = 595.28;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_W - MARGIN * 2;
const ROWS_PER_PAGE = 22;

export async function generateHistoricoPdf(data: HistoricoPdfData): Promise<Uint8Array> {
  const branding = await loadTenantBranding(data.tenantId);
  const pdf = await PDFDocument.create();
  const fonts = await embedFonts(pdf);

  const columns = [
    { key: "material", label: "MATERIAL", width: 161 },
    { key: "categoria", label: "CATEGORIA", width: 90 },
    { key: "reserva", label: "RESERVA", width: 120 },
    { key: "armeiro", label: "ARMEIRO", width: 130 },
    { key: "saida", label: "SAÍDA", width: 78 },
    { key: "devolucao", label: "DEVOLUÇÃO", width: 78 },
    { key: "status", label: "STATUS", width: 66 },
    { key: "qtd", label: "QTD", width: 39 },
  ];

  const rows: TableRow[] = data.lendings.map((row) => ({
    cells: {
      material: row.material_type?.nome ?? "—",
      categoria: row.material_type?.categoria ?? "—",
      reserva: row.reserve?.nome ?? "—",
      armeiro: row.master?.nome_completo ?? "—",
      saida: fmtDate(row.issued_at),
      devolucao: fmtDate(row.returned_at),
      status: STATUS_LABEL[row.status_legacy] ?? row.status_legacy,
      qtd: String(row.quantidade ?? 1),
    },
  }));

  const filterParts: string[] = [];
  if (data.filters.reserva) filterParts.push(`Reserva: ${data.filters.reserva}`);
  if (data.filters.categoria) filterParts.push(`Categoria: ${data.filters.categoria}`);
  if (data.filters.status) filterParts.push(`Status: ${STATUS_LABEL[data.filters.status] ?? data.filters.status}`);
  // Achado de code review: from/to são datas civis (YYYY-MM-DD) vindas de
  // query params, não instantes — fmtDate (America/Recife) desloca 1 dia
  // pra trás de forma determinística. fmtCivilDate faz parsing textual sem
  // passar por Date/timezone.
  if (data.filters.from) filterParts.push(`De: ${fmtCivilDate(data.filters.from)}`);
  if (data.filters.to) filterParts.push(`Até: ${fmtCivilDate(data.filters.to)}`);
  if (filterParts.length === 0) filterParts.push("Sem filtros — todos os registros");

  const milLine = [
    data.military.posto ? `${data.military.posto} ` : "",
    data.military.nome_completo,
    ` · Mat.: ${data.military.matricula}`,
  ].join("");

  // Paginação própria (não drawTable/ensureSpace): ROWS_PER_PAGE fixo já
  // garante que cada fatia cabe numa página landscape — drawContinuationBar/
  // ensureSpace do tema compartilhado são fixados em retrato (PAGE_WIDTH/
  // PAGE_HEIGHT de pdf-theme.ts), então não servem aqui sem adaptação.
  const totalPages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));

  for (let p = 0; p < totalPages; p++) {
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    let y = await drawHeader(pdf, page, {
      title: "Andrômeda — Histórico de Saídas de Material",
      subtitle: data.tenantName ?? undefined,
      margin: MARGIN,
      branding, fonts,
    });

    safeDrawText(page, milLine, { x: MARGIN, y, size: 9, font: fonts.bold, color: branding.primaryColor });
    y -= 13;
    // "—" é o separador padrão já usado no resto do sistema (rodapé,
    // títulos) — mantido por consistência mesmo depois do fix de
    // SAFE_TEXT_PATTERN em pdf-theme.ts (que corrigiu a causa raiz: "|"
    // também passou a sobreviver à sanitização, mas "—" já era o padrão).
    safeDrawText(page, `Filtros: ${filterParts.join("  —  ")}`, { x: MARGIN, y, size: 8, font: fonts.regular, color: GRAY_TEXT });
    y -= 11;
    safeDrawText(
      page,
      `Gerado em: ${fmtDateTime(data.generatedAt)}   —   Página ${p + 1}/${totalPages}   —   Total: ${rows.length} registro${rows.length !== 1 ? "s" : ""}`,
      { x: MARGIN, y, size: 7.5, font: fonts.regular, color: GRAY_TEXT },
    );
    y -= 14;

    const sliceStart = p * ROWS_PER_PAGE;
    const rowsOnPage = rows.slice(sliceStart, sliceStart + ROWS_PER_PAGE);

    // Achado de code review: o guard `if (rowsOnPage.length > 0)` pulava
    // drawTable inteiro quando o militar não tem histórico — o original
    // desenhava o cabeçalho de coluna incondicionalmente, então "sem
    // registros" se lia como tabela vazia; sem ele, o PDF parecia
    // truncado/quebrado (cabeçalho + "Total: 0" + rodapé, sem tabela
    // nenhuma). drawTable com rows:[] já desenha só o cabeçalho de coluna
    // e não paginaria (nenhuma linha, nunca ultrapassa minY).
    {
      const result = drawTable({
        page, x: MARGIN, y, width: CONTENT_WIDTH,
        columns, rows: rowsOnPage,
        rowHeight: 15, fonts, branding,
        minY: 40,
        // Nunca deveria disparar: ROWS_PER_PAGE já é dimensionado pra caber
        // no espaço disponível da página landscape. Fail-fast em vez de
        // desenhar uma página fora do padrão (sem drawContinuationBar
        // landscape-aware) se essa invariante um dia for violada.
        newPage: () => {
          throw new Error("historico-pdf: linhas na página excederam o espaço previsto por ROWS_PER_PAGE");
        },
        newPageStartY: PAGE_H - MARGIN,
      });
      if (rowsOnPage.length === 0) {
        safeDrawText(result.page, "Nenhum registro encontrado para os filtros aplicados.", {
          x: MARGIN, y: result.y - 14, size: 9, font: fonts.regular, color: GRAY_TEXT,
        });
      }
    }

    drawFooter(page, { margin: MARGIN, y: 20, branding, fonts });
  }

  return pdf.save();
}
