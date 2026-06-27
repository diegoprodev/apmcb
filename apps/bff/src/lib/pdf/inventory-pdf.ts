import { PDFDocument, rgb, StandardFonts, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";

const BFF_PUBLIC_URL = process.env.BFF_PUBLIC_URL ?? "https://api.apmcb.pmpb.online";

function drawQrCode(page: PDFPage, url: string, x: number, y: number, size: number): void {
  const qr = QRCode.create(url, { errorCorrectionLevel: "L" });
  const m = qr.modules;
  const cell = size / m.size;
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (m.data[r * m.size + c]) {
        page.drawRectangle({ x: x + c * cell, y: y - (r + 1) * cell, width: cell, height: cell, color: rgb(0, 0, 0) });
      }
    }
  }
}

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
}

export async function generateInventoryPdf(data: InventoryCampaignData): Promise<Uint8Array> {
  const doc  = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const W = 595, M = 40;
  const verifyUrl = `${BFF_PUBLIC_URL}/api/inventory/verify/${data.id}?hash=${data.document_hash}`;

  // ── Capa ────────────────────────────────────────────────────────────────
  let page = doc.addPage([W, 841]);
  let y = 790;

  page.drawRectangle({ x: 0, y: 800, width: W, height: 41, color: rgb(0.06, 0.09, 0.16) });
  page.drawText("RELATÓRIO DE INVENTÁRIO PERIÓDICO", { x: M, y: 815, size: 14, font: bold, color: rgb(1, 1, 1) });

  y = 760;
  page.drawText(data.tenant_nome.toUpperCase(), { x: M, y, size: 11, font: bold, color: rgb(0.06, 0.09, 0.16) });
  y -= 18;
  page.drawText(`Campanha: ${data.nome}`, { x: M, y, size: 10, font });
  if (data.descricao) { y -= 14; page.drawText(data.descricao, { x: M, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) }); }
  y -= 20;

  const metaLines = [
    `Criado por: ${data.criado_por_nome}`,
    `Prazo: ${data.prazo_inicio ? new Date(data.prazo_inicio).toLocaleDateString("pt-BR") + " até " : ""}${new Date(data.prazo_fim).toLocaleDateString("pt-BR")}`,
    `Gerado em: ${new Date().toLocaleString("pt-BR")}`,
    `Reserves conferidas: ${data.reserve_checks.length}`,
  ];
  for (const line of metaLines) {
    page.drawText(line, { x: M, y, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
    y -= 13;
  }

  // QR de verificação
  try {
    drawQrCode(page, verifyUrl, W - 100, 740, 70);
    page.drawText("Verificar autenticidade", { x: W - 105, y: 660, size: 7, font, color: rgb(0.5, 0.5, 0.5) });
  } catch { /* QR opcional */ }

  // Hash
  y -= 20;
  page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 22, color: rgb(0.97, 0.97, 0.97) });
  page.drawText(`Hash: ${data.document_hash}`, { x: M + 4, y: y + 2, size: 7, font, color: rgb(0.4, 0.4, 0.4) });
  y -= 30;

  // Separador
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  y -= 20;

  // ── Sumário de reserves ──────────────────────────────────────────────────
  page.drawText("RESUMO POR RESERVA", { x: M, y, size: 10, font: bold, color: rgb(0.06, 0.09, 0.16) });
  y -= 16;

  for (const rc of data.reserve_checks) {
    const total = rc.items.length;
    const conf  = rc.items.filter((i) => i.status === "conforme").length;
    const div   = rc.items.filter((i) => i.status === "divergencia").length;
    const pend  = rc.items.filter((i) => i.status === "pendente").length;
    const dot   = rc.status === "concluido" ? "●" : rc.status === "divergencia" ? "◆" : "○";
    page.drawText(`${dot} ${rc.reserve_acronym} — ${rc.reserve_nome}`, { x: M, y, size: 9, font: bold });
    y -= 12;
    page.drawText(
      `   Responsável: ${rc.responsavel_nome} | Armeiro: ${rc.armeiro_nome ?? "—"} | Conformes: ${conf}/${total} | Divergentes: ${div} | Pendentes: ${pend}`,
      { x: M, y, size: 8, font, color: rgb(0.4, 0.4, 0.4) }
    );
    y -= 18;
    if (y < 80) { page = doc.addPage([W, 841]); y = 790; }
  }

  // ── Detalhes por reserve ─────────────────────────────────────────────────
  for (const rc of data.reserve_checks) {
    page = doc.addPage([W, 841]);
    y = 790;

    page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 22, color: rgb(0.06, 0.09, 0.16) });
    page.drawText(`RESERVA: ${rc.reserve_acronym} — ${rc.reserve_nome}`, { x: M + 4, y: y + 2, size: 10, font: bold, color: rgb(1, 1, 1) });
    y -= 26;

    page.drawText(`Responsável: ${rc.responsavel_nome}`, { x: M, y, size: 9, font });
    y -= 13;
    if (rc.armeiro_nome) { page.drawText(`Armeiro designado: ${rc.armeiro_nome}`, { x: M, y, size: 9, font }); y -= 13; }
    if (rc.observacao)   { page.drawText(`Observação: ${rc.observacao}`, { x: M, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) }); y -= 13; }
    if (rc.concluido_at) { page.drawText(`Concluído em: ${new Date(rc.concluido_at).toLocaleString("pt-BR")}`, { x: M, y, size: 9, font }); y -= 13; }
    y -= 8;

    // Cabeçalho tabela
    page.drawRectangle({ x: M, y: y - 3, width: W - 2 * M, height: 16, color: rgb(0.9, 0.9, 0.9) });
    page.drawText("Material", { x: M + 2, y, size: 8, font: bold });
    page.drawText("Esperado", { x: M + 260, y, size: 8, font: bold });
    page.drawText("Contado",  { x: M + 320, y, size: 8, font: bold });
    page.drawText("Status",   { x: M + 380, y, size: 8, font: bold });
    y -= 16;

    for (const item of rc.items) {
      if (y < 80) { page = doc.addPage([W, 841]); y = 790; }

      const statusColor = item.status === "conforme" ? rgb(0.1, 0.5, 0.2)
        : item.status === "divergencia" ? rgb(0.7, 0.1, 0.1)
        : rgb(0.5, 0.5, 0.5);

      page.drawText(item.material_nome.slice(0, 40), { x: M + 2, y, size: 8, font });
      page.drawText(String(item.qtd_esperada), { x: M + 260, y, size: 8, font });
      page.drawText(item.qtd_contada != null ? String(item.qtd_contada) : "—", { x: M + 320, y, size: 8, font });
      page.drawText(item.status.toUpperCase(), { x: M + 380, y, size: 8, font: bold, color: statusColor });
      y -= 13;

      if (item.divergencia_desc) {
        page.drawText(`   Divergência: ${item.divergencia_desc}`, { x: M + 2, y, size: 7.5, font, color: rgb(0.7, 0.1, 0.1) });
        y -= 12;
      }
    }

    // Assinatura
    y -= 20;
    page.drawLine({ start: { x: M, y }, end: { x: M + 180, y }, thickness: 0.5, color: rgb(0, 0, 0) });
    y -= 10;
    page.drawText(`Ass.: ${rc.responsavel_nome}`, { x: M, y, size: 8, font });
    page.drawText("Admin. da Reserva", { x: M, y: y - 10, size: 7, font, color: rgb(0.5, 0.5, 0.5) });
  }

  return doc.save();
}
