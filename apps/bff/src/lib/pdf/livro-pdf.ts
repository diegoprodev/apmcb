import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";

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

interface LivroEvent {
  happened_at: string;
  event_type: string;
  description: string;
  event_hash: string;
  prev_hash: string | null;
  actor_nome: string | null;
  actor_matricula: string | null;
}

// Shape real gravado por generateOpeningSnapshot() (shifts.ts) — NÃO é o
// TurnSnapshot de lib/snapshot.ts (usado só em handovers.ts). São dois
// geradores de snapshot distintos no código; este PDF segue o que o
// Livro Digital de fato grava em service_shifts.opening/closing_snapshot.
interface ShiftSnapshot {
  generated_at: string;
  total_itens: number;
  por_status: Record<string, number>;
  cautelas_ativas: number;
  saidas_abertas: number;
}

interface LivroData {
  id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  reserve: { nome: string; acronym: string };
  armeiro: { nome_completo: string; matricula: string; posto: string | null };
  opening_snapshot: ShiftSnapshot | null;
  closing_snapshot: ShiftSnapshot | null;
  events: LivroEvent[];
}

const EVENT_LABEL: Record<string, string> = {
  turno_assumido:         "Turno Assumido",
  cautela_emitida:        "Cautela Emitida",
  cautela_devolvida:      "Cautela Devolvida",
  saida_autorizada:       "Saída Autorizada",
  saida_devolvida:        "Saída Devolvida",
  ocorrencia_registrada:  "Ocorrência",
  solicitacao_aprovada:   "Solicitação Aprovada",
  solicitacao_negada:     "Solicitação Negada",
  inventario_divergencia: "Divergência Inventário",
  turno_encerrado:        "Turno Encerrado",
  evento_manual:          "Registro Manual",
};

const fmtDt = (d?: string | null) =>
  d
    ? new Date(d).toLocaleString("pt-BR", {
        timeZone: "America/Recife",
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : "—";

export async function generateLivroPdf(data: LivroData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  let page = pdf.addPage([595, 842]); // A4
  const fontBold   = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontNormal = await pdf.embedFont(StandardFonts.Helvetica);
  const margin = 50;
  let y = page.getSize().height - margin;

  const drawLine = (yPos: number) => {
    page.drawLine({
      start: { x: margin, y: yPos },
      end: { x: page.getSize().width - margin, y: yPos },
      thickness: 0.5,
      color: rgb(0.7, 0.7, 0.7),
    });
  };

  // pdf-lib usa WinAnsiEncoding — texto fora desse charset (emoji, símbolos
  // Unicode raros) lança exceção em drawText(). Sanitiza para não derrubar
  // a exportação inteira por causa de um caractere numa descrição de evento.
  const sanitize = (s: string) => s.replace(/[^ -ÿ]/g, "?");

  const text = (s: string, x: number, yPos: number, bold = false, size = 10) => {
    page.drawText(sanitize(s), { x, y: yPos, font: bold ? fontBold : fontNormal, size, color: rgb(0.1, 0.1, 0.1) });
  };

  // Trunca por largura real (não por contagem de caracteres) para não
  // estourar a margem direita da página.
  const truncateToWidth = (s: string, font: PDFFont, size: number, maxWidth: number): string => {
    const clean = sanitize(s);
    if (font.widthOfTextAtSize(clean, size) <= maxWidth) return clean;
    let lo = 0, hi = clean.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const candidate = clean.slice(0, mid) + "…";
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) lo = mid; else hi = mid - 1;
    }
    return clean.slice(0, lo) + "…";
  };

  function ensureSpace(minY: number) {
    if (y >= minY) return;
    page = pdf.addPage([595, 842]);
    y = page.getSize().height - margin;
  }

  // Header
  text("APMCB — Livro Digital de Serviço", margin, y, true, 14);
  y -= 20;
  text(`${data.reserve.acronym} — ${data.reserve.nome}`, margin, y);
  y -= 8;
  text(`Turno ${data.id.slice(0, 8).toUpperCase()} · Status: ${data.status === "ativo" ? "Em andamento" : "Encerrado"}`, margin, y, false, 8);
  y -= 15;
  drawLine(y);
  y -= 15;

  // Armeiro
  text("ARMEIRO RESPONSÁVEL", margin, y, true, 11);
  y -= 14;
  text(`${data.armeiro.posto ?? ""} ${data.armeiro.nome_completo}   Matrícula: ${data.armeiro.matricula}`, margin, y);
  y -= 12;
  text(`Abertura: ${fmtDt(data.started_at)}    Encerramento: ${fmtDt(data.ended_at)}`, margin, y);
  y -= 18;

  // Snapshots
  if (data.opening_snapshot) {
    drawLine(y);
    y -= 15;
    text("SNAPSHOT DE ABERTURA", margin, y, true, 11);
    y -= 14;
    text(`Acervo total: ${data.opening_snapshot.total_itens} · Cautelas ativas: ${data.opening_snapshot.cautelas_ativas} · Saídas abertas: ${data.opening_snapshot.saidas_abertas}`, margin, y);
    y -= 18;
  }
  if (data.closing_snapshot) {
    drawLine(y);
    y -= 15;
    text("SNAPSHOT DE ENCERRAMENTO", margin, y, true, 11);
    y -= 14;
    text(`Acervo total: ${data.closing_snapshot.total_itens} · Cautelas ativas: ${data.closing_snapshot.cautelas_ativas} · Saídas abertas: ${data.closing_snapshot.saidas_abertas}`, margin, y);
    y -= 18;
  }

  // Timeline de eventos
  drawLine(y);
  y -= 15;
  text(`LINHA DO TEMPO (${data.events.length} evento${data.events.length !== 1 ? "s" : ""})`, margin, y, true, 11);
  y -= 14;

  const maxTextWidth = page.getSize().width - margin * 2 - 10;
  for (const ev of data.events) {
    ensureSpace(140);
    const label = EVENT_LABEL[ev.event_type] ?? ev.event_type;
    const actor = ev.actor_nome
      ? ` — ${ev.actor_nome}${ev.actor_matricula ? ` (${ev.actor_matricula})` : ""}`
      : "";
    text(truncateToWidth(`[${fmtDt(ev.happened_at)}] ${label}${actor}`, fontBold, 9, maxTextWidth), margin, y, true, 9);
    y -= 11;
    text(truncateToWidth(ev.description, fontNormal, 8, maxTextWidth - 10), margin + 10, y, false, 8);
    y -= 10;
    text(`hash: ${ev.event_hash.slice(0, 24)}…`, margin + 10, y, false, 7);
    y -= 13;
  }

  // Footer com QR de verificação (última página)
  ensureSpace(140);
  const qrSize = 60;
  const qrX = page.getSize().width - margin - qrSize;
  const qrY = margin + 10 + qrSize;
  const verifyUrl = `${BFF_PUBLIC_URL}/api/public/shifts/${data.id}/verify`;
  const rootHash = data.events.length > 0 ? data.events[data.events.length - 1].event_hash : "—";

  drawLine(margin + qrSize + 20);
  drawQrCode(page, verifyUrl, qrX, qrY, qrSize);
  text("Verificar", qrX + qrSize / 2 - 14, margin + 8, false, 7);

  text(`Gerado em ${fmtDt(new Date().toISOString())}`, margin, margin + qrSize + 10, false, 8);
  text(`Hash raiz: ${rootHash.slice(0, 40)}${rootHash.length > 40 ? "…" : ""}`, margin, margin + qrSize - 4, false, 7);

  const bytes = await pdf.save();
  return bytes;
}
