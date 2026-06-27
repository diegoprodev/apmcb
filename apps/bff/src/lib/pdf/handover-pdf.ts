import { PDFDocument, rgb, StandardFonts, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import type { TurnSnapshot } from "../snapshot";

const BFF_PUBLIC_URL = process.env.BFF_PUBLIC_URL ?? "https://api.apmcb.pmpb.online";

function drawQrCode(page: PDFPage, url: string, x: number, y: number, totalSize: number): void {
  const qr = QRCode.create(url, { errorCorrectionLevel: "L" });
  const modules = qr.modules;
  const cellSize = totalSize / modules.size;
  for (let row = 0; row < modules.size; row++) {
    for (let col = 0; col < modules.size; col++) {
      if (modules.data[row * modules.size + col]) {
        page.drawRectangle({
          x: x + col * cellSize,
          y: y - (row + 1) * cellSize,
          width: cellSize,
          height: cellSize,
          color: rgb(0, 0, 0),
        });
      }
    }
  }
}

interface HandoverData {
  id: string;
  document_hash: string;
  created_at: string;
  reserve: { nome: string; acronym: string };
  saindo: { nome_completo: string; matricula: string };
  entrando?: { nome_completo: string; matricula: string } | null;
  observacao_saindo?: string | null;
  observacao_entrada?: string | null;
  divergencia_descricao?: string | null;
  status: string;
  snapshot: TurnSnapshot;
  saindo_assinatura_at?: string | null;
  entrada_assinatura_at?: string | null;
}

const fmt = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Recife" }) : "—";

const fmtDt = (d?: string | null) =>
  d
    ? new Date(d).toLocaleString("pt-BR", {
        timeZone: "America/Recife",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export async function generateHandoverPdf(data: HandoverData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4

  const fontBold   = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontNormal = await pdf.embedFont(StandardFonts.Helvetica);

  const { width, height } = page.getSize();
  const margin = 50;
  let y = height - margin;

  const drawLine = (yPos: number) => {
    page.drawLine({
      start: { x: margin, y: yPos },
      end: { x: width - margin, y: yPos },
      thickness: 0.5,
      color: rgb(0.7, 0.7, 0.7),
    });
  };

  const text = (s: string, x: number, yPos: number, bold = false, size = 10) => {
    page.drawText(s, {
      x, y: yPos,
      font: bold ? fontBold : fontNormal,
      size,
      color: rgb(0.1, 0.1, 0.1),
    });
  };

  // Header
  text("APMCB — Livro Digital de Serviço", margin, y, true, 14);
  y -= 20;
  text(`${data.reserve.acronym} — ${data.reserve.nome}`, margin, y, false, 10);
  y -= 8;
  text(`Hash: ${data.document_hash}`, margin, y, false, 8);
  y -= 15;
  drawLine(y);
  y -= 15;

  // Armeiros
  text("ARMEIRO SAINDO", margin, y, true, 11);
  y -= 14;
  text(`Nome: ${data.saindo.nome_completo}   Matrícula: ${data.saindo.matricula}`, margin, y);
  y -= 12;
  text(`Assinatura: ${fmtDt(data.saindo_assinatura_at)}`, margin, y);
  if (data.observacao_saindo) {
    y -= 12;
    text(`Observação: ${data.observacao_saindo}`, margin, y);
  }
  y -= 18;

  if (data.entrando) {
    text("ARMEIRO ENTRANTE", margin, y, true, 11);
    y -= 14;
    text(`Nome: ${data.entrando.nome_completo}   Matrícula: ${data.entrando.matricula}`, margin, y);
    y -= 12;
    text(`Assinatura: ${fmtDt(data.entrada_assinatura_at)}`, margin, y);
    if (data.observacao_entrada) {
      y -= 12;
      text(`Observação: ${data.observacao_entrada}`, margin, y);
    }
    y -= 18;
  }

  if (data.divergencia_descricao) {
    drawLine(y);
    y -= 12;
    text("DIVERGÊNCIA REGISTRADA", margin, y, true, 11);
    y -= 14;
    text(data.divergencia_descricao.slice(0, 180), margin, y);
    y -= 15;
  }

  // Snapshot
  drawLine(y);
  y -= 15;
  text("SNAPSHOT DO TURNO", margin, y, true, 11);
  y -= 14;
  text(`Data de referência: ${fmtDt(data.snapshot.data_referencia)}`, margin, y);
  y -= 12;
  text(`Total de itens no acervo: ${data.snapshot.carga_total.total}`, margin, y);
  y -= 12;
  text(`Cautelas ativas: ${data.snapshot.cautelas_ativas.length}`, margin, y);
  y -= 12;
  text(`Saídas ativas: ${data.snapshot.saidas_ativas.length}`, margin, y);
  y -= 12;
  text(`SSA pendentes: ${data.snapshot.solicitacoes_pendentes}`, margin, y);
  y -= 12;
  text(`Ocorrências abertas: ${data.snapshot.ocorrencias_abertas}`, margin, y);

  // Carga por tipo
  y -= 15;
  text("Acervo por tipo:", margin, y, true);
  for (const [tipo, qty] of Object.entries(data.snapshot.carga_total.por_tipo)) {
    y -= 12;
    if (y < 100) break;
    text(`  • ${tipo}: ${qty}`, margin, y);
  }

  // Cautelas listing (primeiras 5)
  if (data.snapshot.cautelas_ativas.length > 0) {
    y -= 18;
    drawLine(y);
    y -= 12;
    text("CAUTELAS ATIVAS (snapshot)", margin, y, true);
    for (const c of data.snapshot.cautelas_ativas.slice(0, 5)) {
      y -= 12;
      if (y < 100) break;
      text(`  ${c.material_descricao} — ${c.militar_nome} (emitido ${fmt(c.data_emissao)})`, margin, y);
    }
    if (data.snapshot.cautelas_ativas.length > 5) {
      y -= 12;
      text(`  ... e mais ${data.snapshot.cautelas_ativas.length - 5} cautela(s)`, margin, y);
    }
  }

  // Footer com QR de verificação
  const qrSize = 60;
  const qrX = width - margin - qrSize;
  const qrY = margin + 10 + qrSize;
  const verifyUrl = `${BFF_PUBLIC_URL}/api/handovers/${data.id}/verify`;

  drawLine(margin + qrSize + 20);
  drawQrCode(page, verifyUrl, qrX, qrY, qrSize);
  text("Verificar", qrX + qrSize / 2 - 14, margin + 8, false, 7);

  text(`Gerado em ${fmtDt(new Date().toISOString())} · Passagem ${data.id.slice(0, 8).toUpperCase()}`, margin, margin + qrSize + 10, false, 8);
  text(`Status: ${data.status}`, margin, margin + qrSize - 4, false, 8);
  text(`Hash: ${data.document_hash.slice(0, 32)}...`, margin, margin + qrSize - 16, false, 7);

  const bytes = await pdf.save();
  return bytes;
}
