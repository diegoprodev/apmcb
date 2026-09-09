import { PDFDocument, rgb } from "pdf-lib";
import {
  loadTenantBranding, embedFonts, drawHeader, section, field, fieldMultiline, divider,
  drawFooter, safeDrawText, WEB_PUBLIC_URL, PDF_PAGE_SIZE, fmtCivilDate, fmtDateTime,
} from "./pdf-theme";
import {
  buildCautelaItemRows, signatureMethodLabel, type SignatureAuthInfo,
} from "./cautela-pdf-content";

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
  tenantId?: string | null;
  // Modalidade de cada assinatura (código dinâmico ou biometria) —
  // document_signatures.{totp_verified,biometric_verified}. Sem isto as
  // linhas de assinatura do PDF saíam sem indicar COMO cada parte assinou.
  signatures?: { armeiro?: SignatureAuthInfo; militar?: SignatureAuthInfo };
}

// Achado de code review: validade_item e prazo_proxima_conferencia são
// colunas DATE (não TIMESTAMPTZ) — fmtDate (America/Recife) desloca 1 dia
// pra trás de forma determinística nesses casos (ver fmtCivilDate em
// pdf-theme.ts). Bug pré-existente (a versão local antiga de fmt() tinha o
// mesmo problema, já em produção), corrigido junto ao consolidar em SSOT.
const fmt = fmtCivilDate;
const fmtDt = fmtDateTime;

const MARGIN = 50;
const CONTENT_WIDTH = PDF_PAGE_SIZE[0] - MARGIN * 2;

export async function generateCautelaPdf(data: CautelaData): Promise<Uint8Array> {
  const branding = await loadTenantBranding(data.tenantId);
  const pdf = await PDFDocument.create();
  const fonts = await embedFonts(pdf);
  const page = pdf.addPage(PDF_PAGE_SIZE);

  let y = await drawHeader(pdf, page, {
    title: "Andrômeda — Termo de Cautela",
    subtitle: "Cautela por Tempo Indeterminado",
    margin: MARGIN,
    branding, fonts,
  });

  y = section(page, { title: "IDENTIFICAÇÃO", y, margin: MARGIN, width: CONTENT_WIDTH, branding, fonts });
  y = field(page, { label: "Número de controle", value: `CAU-${new Date(data.data_emissao).getFullYear()}-${data.id.slice(0, 8).toUpperCase()}`, y, margin: MARGIN, fonts });
  y = field(page, { label: "Data de emissão", value: fmtDt(data.data_emissao), y, margin: MARGIN, fonts });
  y = field(page, { label: "Unidade / Reserva", value: data.reserve?.nome ?? "—", y, margin: MARGIN, fonts });

  y = section(page, { title: "ITEM CAUTELADO", y, margin: MARGIN, width: CONTENT_WIDTH, branding, fonts });
  // Linhas do item (inclui "Quantidade") vêm de buildCautelaItemRows —
  // função pura, testável via `node --test` (cautela-pdf-content.test.ts).
  for (const row of buildCautelaItemRows(data.item, data.condicao_emissao)) {
    y = field(page, { label: row.label, value: row.value, y, margin: MARGIN, fonts });
  }
  if (data.prazo_proxima_conferencia) {
    y = field(page, { label: "Próxima conferência", value: fmt(data.prazo_proxima_conferencia), y, margin: MARGIN, fonts });
  }
  // Achado de code review: motivo_emissao aceita até 500 caracteres no
  // schema (cautelamentos.ts), mas field() com largura padrão ao lado do
  // label só sobrava ~60 chars visíveis antes de truncar — perda
  // silenciosa de informação num documento de custódia de armamento.
  // fieldMultiline usa a largura inteira do conteúdo, em até 3 linhas.
  y = fieldMultiline(page, { label: "Motivo da cautela", value: data.motivo_emissao, y, margin: MARGIN, width: CONTENT_WIDTH, fonts });

  y = section(page, { title: "RESPONSÁVEL PELA GUARDA", y, margin: MARGIN, width: CONTENT_WIDTH, branding, fonts });
  y = field(page, { label: "Nome completo", value: data.militar.nome_completo, y, margin: MARGIN, fonts });
  y = field(page, { label: "Matrícula", value: data.militar.matricula, y, margin: MARGIN, fonts });
  y = field(page, { label: "Cargo", value: data.militar.posto ?? "—", y, margin: MARGIN, fonts });

  y = section(page, { title: "ARMEIRO RESPONSÁVEL PELA EMISSÃO", y, margin: MARGIN, width: CONTENT_WIDTH, branding, fonts });
  y = field(page, { label: "Nome completo", value: data.armeiro.nome_completo, y, margin: MARGIN, fonts });
  y = field(page, { label: "Matrícula", value: data.armeiro.matricula, y, margin: MARGIN, fonts });

  y = section(page, { title: "TERMOS DE RESPONSABILIDADE", y, margin: MARGIN, width: CONTENT_WIDTH, branding, fonts });
  safeDrawText(page, "Declaro que recebi o item acima descrito e me responsabilizo pela sua guarda,", { x: MARGIN, y, size: 9, font: fonts.regular, color: rgb(0.1, 0.1, 0.1) });
  y -= 14;
  safeDrawText(page, "conservação e uso correto, conforme regulamento interno vigente.", { x: MARGIN, y, size: 9, font: fonts.regular, color: rgb(0.1, 0.1, 0.1) });
  y -= 20;

  y = section(page, { title: "ASSINATURAS", y, margin: MARGIN, width: CONTENT_WIDTH, branding, fonts });
  y -= 14;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + 180, y }, thickness: 0.5, color: rgb(0, 0, 0) });
  page.drawLine({ start: { x: MARGIN + CONTENT_WIDTH - 180, y }, end: { x: MARGIN + CONTENT_WIDTH, y }, thickness: 0.5, color: rgb(0, 0, 0) });
  y -= 12;
  safeDrawText(page, "Armeiro: " + data.armeiro.nome_completo, { x: MARGIN, y, size: 8, font: fonts.regular, color: rgb(0.42, 0.42, 0.42) });
  safeDrawText(page, "Usuário: " + data.militar.nome_completo, { x: MARGIN + CONTENT_WIDTH - 180, y, size: 8, font: fonts.regular, color: rgb(0.42, 0.42, 0.42) });
  y -= 11;
  // Modalidade de cada assinatura — nunca em branco (fallback neutro
  // "Assinatura eletrônica verificada" em signatureMethodLabel).
  safeDrawText(page, signatureMethodLabel(data.signatures?.armeiro), { x: MARGIN, y, size: 7, font: fonts.regular, color: rgb(0.5, 0.5, 0.5) });
  safeDrawText(page, signatureMethodLabel(data.signatures?.militar), { x: MARGIN + CONTENT_WIDTH - 180, y, size: 7, font: fonts.regular, color: rgb(0.5, 0.5, 0.5) });
  y -= 19;

  y = divider(page, { y, margin: MARGIN, width: CONTENT_WIDTH });

  // Achado do usuário: rodapé antes só tinha link em texto, sem QR — agora
  // padronizado com drawFooter (mesmo padrão dos outros documentos), que
  // desenha o QR apontando pra /v/:id (página de verificação humana já
  // existente, não JSON cru — Cautela usa document_signatures via
  // /api/verify/:document_id, cobertura já corrigida na Fase 0 da spec).
  drawFooter(page, {
    margin: MARGIN,
    y: 76,
    hash: data.document_hash,
    verifyUrl: `${WEB_PUBLIC_URL}/v/${data.id}`,
    branding, fonts,
  });

  return pdf.save();
}
