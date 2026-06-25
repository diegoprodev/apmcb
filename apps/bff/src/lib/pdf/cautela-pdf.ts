import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

interface CautelaData {
  id: string;
  document_hash: string;
  motivo_emissao: string;
  condicao_emissao: string;
  data_emissao: string;
  prazo_proxima_conferencia?: string | null;
  item: {
    numero_serie?: string | null;
    validade_item?: string | null;
    condicao?: string | null;
    material_type: { nome: string; categoria: string };
  };
  militar: { nome_completo: string; matricula: string; posto?: string | null };
  armeiro: { nome_completo: string; matricula: string };
  reserve?: { nome: string; acronym?: string | null } | null;
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

export async function generateCautelaPdf(data: CautelaData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4

  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontReg = await pdf.embedFont(StandardFonts.Helvetica);

  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);
  const blue = rgb(0.1, 0.2, 0.6);

  const { width, height } = page.getSize();
  const margin = 50;
  let y = height - margin;

  const line = (text: string, size = 11, bold = false, color = black, indent = 0) => {
    page.drawText(text, {
      x: margin + indent,
      y,
      size,
      font: bold ? fontBold : fontReg,
      color,
    });
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
    page.drawText(value, { x: margin + 120, y, size: 9, font: fontReg, color: black });
    y -= 14;
  };

  // Cabeçalho
  line("TERMO DE CAUTELA", 16, true, blue);
  line("Cautela por Tempo Indeterminado", 10, false, gray);
  y -= 4;
  divider();

  // Controle
  section("IDENTIFICAÇÃO");
  field("Número de controle", `CAU-${new Date(data.data_emissao).getFullYear()}-${data.id.slice(0, 8).toUpperCase()}`);
  field("Data de emissão", fmtDt(data.data_emissao));
  field("Unidade / Reserva", data.reserve?.nome ?? "—");
  y -= 4;

  // Item
  section("ITEM CAUTELADO");
  field("Descrição", data.item.material_type.nome);
  field("Categoria", data.item.material_type.categoria);
  field("Número de série", data.item.numero_serie ?? "—");
  field("Condição na emissão", data.condicao_emissao);
  field("Motivo da cautela", data.motivo_emissao);
  field("Validade do item", fmt(data.item.validade_item));
  if (data.prazo_proxima_conferencia) {
    field("Próxima conferência", fmt(data.prazo_proxima_conferencia));
  }
  y -= 4;

  // Militar
  section("RESPONSÁVEL PELA GUARDA");
  field("Nome completo", data.militar.nome_completo);
  field("Matrícula", data.militar.matricula);
  field("Posto / Graduação", data.militar.posto ?? "—");
  y -= 4;

  // Armeiro
  section("ARMEIRO RESPONSÁVEL PELA EMISSÃO");
  field("Nome completo", data.armeiro.nome_completo);
  field("Matrícula", data.armeiro.matricula);
  y -= 4;

  // Termos
  section("TERMOS DE RESPONSABILIDADE");
  const termos =
    "Declaro que recebi o item acima descrito e me responsabilizo pela sua guarda,";
  const termos2 = "conservação e uso correto, conforme regulamento interno vigente.";
  line(termos, 9, false, black);
  line(termos2, 9, false, black);
  y -= 10;

  // Assinaturas
  section("ASSINATURAS");
  y -= 8;
  page.drawLine({ start: { x: margin, y }, end: { x: margin + 180, y }, thickness: 0.5, color: black });
  page.drawLine({ start: { x: width - margin - 180, y }, end: { x: width - margin, y }, thickness: 0.5, color: black });
  y -= 14;
  page.drawText("Armeiro: " + data.armeiro.nome_completo, { x: margin, y, size: 8, font: fontReg, color: gray });
  page.drawText("Militar: " + data.militar.nome_completo, { x: width - margin - 180, y, size: 8, font: fontReg, color: gray });
  y -= 20;

  // Hash / verificação
  divider();
  y -= 4;
  line("AUTENTICIDADE", 9, true, gray);
  line("Hash: " + data.document_hash.slice(0, 32) + "...", 8, false, gray);
  line(`Verifique em: https://apmcb.pmpb.online/v/${data.id}`, 8, false, blue);
  line("Documento gerado eletronicamente pela Plataforma de Governança de Bens Sensíveis.", 8, false, gray);

  return pdf.save();
}
