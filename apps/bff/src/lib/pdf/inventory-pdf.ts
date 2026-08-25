import { PDFDocument } from "pdf-lib";
import {
  loadTenantBranding, embedFonts, drawHeader, section, field, divider,
  drawTable, drawFooter, drawContinuationBar, ensureSpace, fieldMultiline,
  truncateToWidth, WEB_PUBLIC_URL,
  PDF_PAGE_SIZE, PDF_PAGE_HEIGHT, CONTINUATION_BAR_HEIGHT,
  type TableRow, type PageCursor,
} from "./pdf-theme";

export interface InventoryReserveCheck {
  reserve_nome: string;
  reserve_acronym: string;
  responsavel_nome: string;
  armeiro_nome?: string;
  status: string;
  observacao?: string;
  concluido_at?: string;
  items: {
    material_nome: string;
    qtd_esperada: number;
    qtd_contada: number | null;
    status: string;
    divergencia_desc?: string;
    conferido_por_nome?: string;
  }[];
}

export interface InventoryCampaignData {
  id: string;
  nome: string;
  descricao?: string;
  tenant_nome: string;
  prazo_inicio?: string;
  prazo_fim: string;
  criado_por_nome: string;
  document_hash: string;
  created_at: string;
  reserve_checks: InventoryReserveCheck[];
  tenantId: string | null;
}

// Achado de code review: datas vindas do banco (concluido_at/created_at) não
// passam por revalidação de formato — "Invalid Date" impresso no PDF é pior
// que "—" num documento oficial.
const fmt = (d?: string | null) => {
  if (!d) return "—";
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("pt-BR", { timeZone: "America/Recife" });
};
const fmtDt = (d?: string | null) => {
  if (!d) return "—";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", {
    timeZone: "America/Recife",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

const STATUS_LABEL: Record<string, string> = {
  conforme: "Conforme",
  divergencia: "Divergência",
  pendente: "Pendente",
};

const MARGIN = 40;
const CONTENT_WIDTH = PDF_PAGE_SIZE[0] - MARGIN * 2;

export async function generateInventoryPdf(data: InventoryCampaignData): Promise<Uint8Array> {
  const branding = await loadTenantBranding(data.tenantId);
  const pdf = await PDFDocument.create();
  const fonts = await embedFonts(pdf);

  // ── Capa ──────────────────────────────────────────────────────────────
  const cover = pdf.addPage(PDF_PAGE_SIZE);
  let y = await drawHeader(pdf, cover, {
    title: "Andrômeda — Relatório de Inventário Periódico",
    subtitle: data.tenant_nome,
    margin: MARGIN,
    branding, fonts,
  });

  // Achado de code review: sem maxWidth, field() usa o default de 400pt
  // (labelWidth 130 + 270 pro valor) — nome de campanha e de criador cabem
  // em ~58 caracteres e truncavam com ~115pt de margem direita sobrando
  // (a descrição, logo abaixo, já usava CONTENT_WIDTH corretamente).
  y = field(cover, { label: "Campanha", value: data.nome, y, margin: MARGIN, fonts, maxWidth: CONTENT_WIDTH });
  if (data.descricao) {
    y = field(cover, { label: "Descrição", value: data.descricao, y, margin: MARGIN, fonts, maxWidth: CONTENT_WIDTH });
  }
  y = field(cover, { label: "Criado por", value: data.criado_por_nome, y, margin: MARGIN, fonts, maxWidth: CONTENT_WIDTH });
  y = field(cover, {
    label: "Prazo",
    value: `${data.prazo_inicio ? fmt(data.prazo_inicio) + " até " : ""}${fmt(data.prazo_fim)}`,
    y, margin: MARGIN, fonts, maxWidth: CONTENT_WIDTH,
  });
  y = field(cover, { label: "Gerado em", value: fmtDt(new Date().toISOString()), y, margin: MARGIN, fonts });
  y = field(cover, { label: "Reservas conferidas", value: String(data.reserve_checks.length), y, margin: MARGIN, fonts });
  y = divider(cover, { y, margin: MARGIN, width: CONTENT_WIDTH });

  // ── Resumo por reserva ────────────────────────────────────────────────
  y = section(cover, { title: "RESUMO POR RESERVA", y, margin: MARGIN, width: CONTENT_WIDTH, branding, fonts });

  // Achado de code review: CONF./DIV./PEND. só imprimem 1-5 dígitos mas
  // reservavam 135pt somados, espremendo nome do responsável/armeiro
  // (identificação de pessoa, mais crítica de truncar num relatório de
  // custódia de armamento do que um contador).
  const summaryColumns = [
    { key: "reserva", label: "RESERVA", width: 150 },
    { key: "responsavel", label: "RESPONSÁVEL", width: 130 },
    { key: "armeiro", label: "ARMEIRO", width: 119 },
    { key: "conf", label: "CONF.", width: 42 },
    { key: "div", label: "DIV.", width: 34 },
    { key: "pend", label: "PEND.", width: 40 },
  ];
  const summaryRows: TableRow[] = data.reserve_checks.map((rc) => {
    const total = rc.items.length;
    const conf = rc.items.filter((i) => i.status === "conforme").length;
    const div = rc.items.filter((i) => i.status === "divergencia").length;
    const pend = rc.items.filter((i) => i.status === "pendente").length;
    return {
      cells: {
        reserva: `${rc.reserve_acronym} — ${rc.reserve_nome}`,
        responsavel: rc.responsavel_nome,
        armeiro: rc.armeiro_nome ?? "—",
        conf: `${conf}/${total}`,
        div: String(div),
        pend: String(pend),
      },
    };
  });

  if (summaryRows.length > 0) {
    // Achado de code review: sem faixa de continuação aqui, uma campanha
    // com 31+ reservas (cabem ~30 linhas antes de precisar paginar) gerava
    // página(s) extras sem NENHUMA identificação de tenant/campanha — a
    // mesma classe de bug já corrigida no detalhe por reserva abaixo.
    // Alcançável na prática: reserve_ids null cobre todas as reservas
    // ativas do tenant (ver POST /campaigns/:id/start), então qualquer
    // tenant com 31+ reservas ativas estoura isto em toda campanha "geral".
    const summaryContinuationTitle = `Andrômeda — Relatório de Inventário — ${data.nome} — resumo (continuação)`;
    drawTable({
      page: cover, x: MARGIN, y, width: CONTENT_WIDTH,
      columns: summaryColumns, rows: summaryRows,
      rowHeight: 16, fonts, branding,
      // 140 deixava só ~2pt de folga acima do topo real do QR do rodapé
      // (drawFooter em y=76 + qrSize 56 = 132) no pior caso — coincidência
      // numérica frágil com a geometria interna de drawFooter em
      // pdf-theme.ts. Usado só na 1ª página (a única com drawFooter); as
      // páginas de continuação reservam a mesma folga sem precisar dela,
      // troca aceitável por manter um único parâmetro de minY na chamada.
      minY: 140,
      newPage: () => {
        const p = pdf.addPage(PDF_PAGE_SIZE);
        drawContinuationBar(p, summaryContinuationTitle, MARGIN, branding, fonts);
        return p;
      },
      newPageStartY: PDF_PAGE_HEIGHT - CONTINUATION_BAR_HEIGHT - 18,
    });
  }

  const verifyUrl = `${WEB_PUBLIC_URL}/v/inventario/${data.id}?hash=${data.document_hash}`;
  drawFooter(cover, {
    margin: MARGIN, y: 76,
    hash: data.document_hash,
    verifyUrl,
    branding, fonts,
  });

  // ── Detalhe por reserva ───────────────────────────────────────────────
  // Achado de code review: STATUS imprime no máximo "Divergência" (~45pt
  // em 8pt bold) mas reservava 115pt — realocado pra MATERIAL, que disputa
  // espaço com nomes de armamento que costumam incluir modelo e calibre.
  const itemColumns = [
    { key: "material", label: "MATERIAL", width: 305 },
    { key: "esperado", label: "ESPERADO", width: 70 },
    { key: "contado", label: "CONTADO", width: 70 },
    { key: "status", label: "STATUS", width: 70 },
  ];

  for (const rc of data.reserve_checks) {
    const detailPage = pdf.addPage(PDF_PAGE_SIZE);
    let dy = await drawHeader(pdf, detailPage, {
      title: `Reserva: ${rc.reserve_acronym} — ${rc.reserve_nome}`,
      margin: MARGIN,
      branding, fonts,
    });

    dy = field(detailPage, { label: "Responsável", value: rc.responsavel_nome, y: dy, margin: MARGIN, fonts });
    if (rc.armeiro_nome) {
      dy = field(detailPage, { label: "Armeiro designado", value: rc.armeiro_nome, y: dy, margin: MARGIN, fonts });
    }
    if (rc.observacao) {
      dy = field(detailPage, { label: "Observação", value: rc.observacao, y: dy, margin: MARGIN, fonts, maxWidth: CONTENT_WIDTH });
    }
    if (rc.concluido_at) {
      dy = field(detailPage, { label: "Concluído em", value: fmtDt(rc.concluido_at), y: dy, margin: MARGIN, fonts });
    }
    dy = divider(detailPage, { y: dy, margin: MARGIN, width: CONTENT_WIDTH });

    const itemRows: TableRow[] = rc.items.map((item) => ({
      cells: {
        material: item.material_nome,
        esperado: String(item.qtd_esperada),
        contado: item.qtd_contada != null ? String(item.qtd_contada) : "—",
        status: STATUS_LABEL[item.status] ?? item.status,
      },
    }));

    const continuationTitle = `Andrômeda — Relatório de Inventário — ${rc.reserve_acronym} — continuação`;
    let lastPage = detailPage;
    if (itemRows.length > 0) {
      const result = drawTable({
        page: detailPage, x: MARGIN, y: dy, width: CONTENT_WIDTH,
        columns: itemColumns, rows: itemRows,
        rowHeight: 16, fonts, branding,
        minY: 100,
        // Achado de code review: sem a faixa de continuação, uma reserva
        // com itens suficientes pra estourar a página (~30+) gerava
        // páginas extras só com o cabeçalho de coluna da tabela — sem
        // nenhuma indicação de a qual reserva pertenciam, diferente do
        // padrão já usado em livro-pdf.ts/handover-pdf.ts.
        newPage: () => {
          const p = pdf.addPage(PDF_PAGE_SIZE);
          drawContinuationBar(p, continuationTitle, MARGIN, branding, fonts);
          return p;
        },
        newPageStartY: PDF_PAGE_HEIGHT - CONTINUATION_BAR_HEIGHT - 18,
      });
      lastPage = result.page;
      dy = result.y;
    }

    // Achado de code review: divergencia_desc (até 500 caracteres, campo
    // obrigatório quando a contagem diverge — a justificativa mais
    // juridicamente relevante do documento) ia como "linha de detalhe" da
    // tabela, que trunca em 1 linha de ~140 caracteres — perdia ~72% do
    // texto em divergências longas, sem qualquer indicação visual de corte.
    // Renderizado agora como bloco próprio abaixo da tabela, com wrap real
    // via fieldMultiline (mesmo padrão já usado pro motivo_emissao da
    // Cautela).
    const divergentItems = rc.items.filter(
      (item): item is typeof item & { divergencia_desc: string } => !!item.divergencia_desc,
    );
    if (divergentItems.length > 0) {
      let cursor: PageCursor = { page: lastPage, y: dy };
      cursor = ensureSpace(pdf, cursor, 20, { minY: 100, continuationTitle, margin: MARGIN, branding, fonts });
      cursor.y = section(cursor.page, {
        title: "DIVERGÊNCIAS REGISTRADAS", y: cursor.y, margin: MARGIN, width: CONTENT_WIDTH, branding, fonts,
      });
      for (const item of divergentItems) {
        // Pior caso (fieldMultiline com maxLines:3): 13 + 3*12 + 2 = 51pt.
        cursor = ensureSpace(pdf, cursor, 51, { minY: 100, continuationTitle, margin: MARGIN, branding, fonts });
        const label = truncateToWidth(item.material_nome, fonts.medium, 9, CONTENT_WIDTH - 20);
        cursor.y = fieldMultiline(cursor.page, {
          label, value: item.divergencia_desc, y: cursor.y, margin: MARGIN, width: CONTENT_WIDTH, fonts, maxLines: 3,
        });
      }
      lastPage = cursor.page;
      dy = cursor.y;
    }

    // Achado de code review: o guard manual anterior ("if (dy < 70)")
    // duplicava a lógica que ensureSpace já encapsula (violação de DRY
    // contra o módulo SSOT) e, no caminho que nunca dispara hoje mas que a
    // própria mudança futura citada no comentário original poderia abrir,
    // criava uma página sem faixa de continuação — uma folha de assinatura
    // solta, sem identificar reserva nem campanha, no pior artefato
    // possível pra um documento de custódia de armamento.
    let signCursor: PageCursor = { page: lastPage, y: dy };
    signCursor = ensureSpace(pdf, signCursor, 44, { minY: 60, continuationTitle, margin: MARGIN, branding, fonts });
    lastPage = signCursor.page;
    dy = signCursor.y;
    dy -= 20;
    lastPage.drawLine({ start: { x: MARGIN, y: dy }, end: { x: MARGIN + 180, y: dy }, thickness: 0.5, color: branding.primaryColor });
    dy -= 12;
    field(lastPage, { label: "Assinatura", value: rc.responsavel_nome, y: dy, margin: MARGIN, fonts });
  }

  return pdf.save();
}
