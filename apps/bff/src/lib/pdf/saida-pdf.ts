import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

interface SaidaData {
  id: string;
  document_hash?: string | null;
  status: string;
  observacao_emissao?: string | null;
  observacao_devolucao?: string | null;
  issued_at?: string | null;
  returned_at?: string | null;
  prazo_devolucao?: string | null;
  item?: {
    numero_serie?: string | null;
    material_type: { nome: string; categoria: string };
  } | null;
  military?: { nome_completo: string; matricula: string; posto?: string | null } | null;
  master?: { nome_completo: string; matricula: string } | null;
  reserve?: { nome: string } | null;
}

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

export async function generateSaidaPdf(data: SaidaData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);

  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontReg = await pdf.embedFont(StandardFonts.Helvetica);

  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);
  const blue = rgb(0.1, 0.2, 0.6);

  const { width, height } = page.getSize();
  const margin = 50;
  let y = height - margin;

  const line = (text: string, size = 11, bold = false, color = black) => {
    page.drawText(text, { x: margin, y, size, font: bold ? fontBold : fontReg, color });
    y -= size + 5;
  };

  const divider = () => {
    y -= 4;
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: gray });
    y -= 8;
  };

  const section = (title: string) => {
    y -= 4;
    page.drawRectangle({ x: margin, y: y - 2, width: width - 2 * margin, height: 18, color: rgb(0.9, 0.92, 0.98) });
    line(title, 10, true, blue);
    y -= 2;
  };

  const field = (label: string, value: string) => {
    page.drawText(label + ": ", { x: margin, y, size: 9, font: fontBold, color: gray });
    page.drawText(value, { x: margin + 140, y, size: 9, font: fontReg, color: black });
    y -= 14;
  };

  // Header
  line("COMPROVANTE DE SAÍDA DIÁRIA", 16, true, blue);
  line("Saída de Material Armado — Turno de Serviço", 10, false, gray);
  y -= 4;
  divider();

  // Identificação
  section("IDENTIFICAÇÃO DA SAÍDA");
  field("Número de controle", `SAI-${data.id.slice(0, 8).toUpperCase()}`);
  field("Status", data.status.toUpperCase());
  field("Data de emissão", fmtDt(data.issued_at));
  field("Prazo de devolução", fmtDt(data.prazo_devolucao));
  if (data.returned_at) field("Data de devolução", fmtDt(data.returned_at));
  field("Unidade / Reserva", data.reserve?.nome ?? "—");
  y -= 4;

  // Item
  section("ITEM EM SAÍDA");
  field("Descrição", data.item?.material_type.nome ?? "—");
  field("Categoria", data.item?.material_type.categoria ?? "—");
  field("Número de série", data.item?.numero_serie ?? "—");
  if (data.observacao_emissao) field("Observação de emissão", data.observacao_emissao);
  if (data.observacao_devolucao) field("Observação de devolução", data.observacao_devolucao);
  y -= 4;

  // Militar
  section("MILITAR RESPONSÁVEL");
  field("Nome completo", data.military?.nome_completo ?? "—");
  field("Matrícula", data.military?.matricula ?? "—");
  field("Posto / Graduação", data.military?.posto ?? "—");
  y -= 4;

  // Armeiro
  section("ARMEIRO DE SERVIÇO");
  field("Nome completo", data.master?.nome_completo ?? "—");
  field("Matrícula", data.master?.matricula ?? "—");
  y -= 10;

  // Assinatura
  divider();
  y -= 8;
  page.drawLine({ start: { x: margin, y }, end: { x: margin + 180, y }, thickness: 0.5, color: black });
  page.drawLine({ start: { x: width - margin - 180, y }, end: { x: width - margin, y }, thickness: 0.5, color: black });
  y -= 14;
  page.drawText("Armeiro: " + (data.master?.nome_completo ?? "—"), { x: margin, y, size: 8, font: fontReg, color: gray });
  page.drawText("Militar: " + (data.military?.nome_completo ?? "—"), { x: width - margin - 180, y, size: 8, font: fontReg, color: gray });
  y -= 24;

  // Autenticidade
  divider();
  if (data.document_hash) {
    line("Hash: " + data.document_hash.slice(0, 32) + "...", 8, false, gray);
    line(`Verifique em: https://apmcb.pmpb.online/v/${data.id}`, 8, false, blue);
  }
  line("Documento gerado eletronicamente pela Plataforma de Governança de Bens Sensíveis.", 8, false, gray);

  return pdf.save();
}
