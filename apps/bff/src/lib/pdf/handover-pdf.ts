import { PDFDocument } from "pdf-lib";
import type { TurnSnapshot } from "../snapshot";
import {
  loadTenantBranding, embedFonts, drawHeader, section, field, fieldMultiline, divider,
  drawFooter, ensureSpace, truncateToWidth, WEB_PUBLIC_URL, PDF_PAGE_SIZE,
  type PageCursor,
} from "./pdf-theme";

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
  tenantId?: string | null;
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

const STATUS_LABEL: Record<string, string> = {
  aguardando_assinatura_saida: "Aguardando assinatura de saída",
  aguardando_atribuicao: "Aguardando atribuição",
  aguardando_assinatura_entrada: "Aguardando assinatura de entrada",
  concluido: "Concluída",
  divergencia: "Com divergência",
  vencido: "Vencida",
  cancelado: "Cancelada",
};

const MARGIN = 50;
const CONTENT_WIDTH = PDF_PAGE_SIZE[0] - MARGIN * 2;
// Reserva espaço suficiente pro rodapé fixo (QR de 56pt + 2 linhas de
// texto, desenhado em y=76 → topo em ~132) antes de decidir paginar.
const MIN_Y = 140;
const CONTINUATION_TITLE = "Andrômeda — Termo de Passagem de Turno — continuação";

export async function generateHandoverPdf(data: HandoverData): Promise<Uint8Array> {
  const branding = await loadTenantBranding(data.tenantId);
  const pdf = await PDFDocument.create();
  const fonts = await embedFonts(pdf);
  let page = pdf.addPage(PDF_PAGE_SIZE);

  // Achado de code review (Fase 3, gerador irmão livro-pdf.ts): o título
  // aqui dizia literalmente "Andrômeda — Livro Digital de Serviço" — texto
  // copiado por engano do outro gerador. Corrigido para o título real deste
  // documento.
  let y = await drawHeader(pdf, page, {
    title: "Andrômeda — Termo de Passagem de Turno",
    subtitle: `${data.reserve.acronym} — ${data.reserve.nome}`,
    margin: MARGIN,
    branding, fonts,
  });

  // Achado de code review: seções eram desenhadas incondicionalmente na
  // posição y que sobrasse do bloco anterior — um handover com armeiro
  // entrante + observações longas + snapshot com bastante conteúdo podia
  // ter uma seção (ex: "Cautelas Ativas") desenhada tão perto do fim da
  // página que sobrepunha o próprio QR code de verificação no rodapé.
  // ensureSpace() pagina (com faixa de continuação identificável) sempre
  // que o bloco a seguir não cabe mais no espaço restante.
  const paginate = (cursor: PageCursor, neededHeight: number): PageCursor =>
    ensureSpace(pdf, cursor, neededHeight, { minY: MIN_Y, continuationTitle: CONTINUATION_TITLE, margin: MARGIN, branding, fonts });

  ({ page, y } = paginate({ page, y }, 14));
  y = field(page, {
    label: "Passagem", value: `${data.id.slice(0, 8).toUpperCase()} · Status: ${STATUS_LABEL[data.status] ?? data.status}`,
    y, margin: MARGIN, fonts,
  });
  ({ page, y } = paginate({ page, y }, 14));
  y = field(page, { label: "Registrada em", value: fmtDt(data.created_at), y, margin: MARGIN, fonts });
  y = divider(page, { y, margin: MARGIN, width: CONTENT_WIDTH });

  // Bloco ARMEIRO SAINDO: seção(22) + 3 campos(42) + observação opcional
  // (~51 em até 3 linhas) — reserva o pior caso pra não partir o bloco
  // entre seção e primeiro campo.
  const saindoBlockHeight = 22 + 42 + (data.observacao_saindo ? 51 : 0);
  ({ page, y } = paginate({ page, y }, saindoBlockHeight));
  y = section(page, { title: "ARMEIRO SAINDO", y, margin: MARGIN, width: CONTENT_WIDTH, branding, fonts });
  y = field(page, { label: "Nome completo", value: data.saindo.nome_completo, y, margin: MARGIN, fonts });
  y = field(page, { label: "Matrícula", value: data.saindo.matricula, y, margin: MARGIN, fonts });
  y = field(page, { label: "Assinatura", value: fmtDt(data.saindo_assinatura_at), y, margin: MARGIN, fonts });
  if (data.observacao_saindo) {
    y = fieldMultiline(page, { label: "Observação", value: data.observacao_saindo, y, margin: MARGIN, width: CONTENT_WIDTH, fonts });
  }

  if (data.entrando) {
    const entrandoBlockHeight = 22 + 42 + (data.observacao_entrada ? 51 : 0);
    ({ page, y } = paginate({ page, y }, entrandoBlockHeight));
    y = section(page, { title: "ARMEIRO ENTRANTE", y, margin: MARGIN, width: CONTENT_WIDTH, branding, fonts });
    y = field(page, { label: "Nome completo", value: data.entrando.nome_completo, y, margin: MARGIN, fonts });
    y = field(page, { label: "Matrícula", value: data.entrando.matricula, y, margin: MARGIN, fonts });
    y = field(page, { label: "Assinatura", value: fmtDt(data.entrada_assinatura_at), y, margin: MARGIN, fonts });
    if (data.observacao_entrada) {
      y = fieldMultiline(page, { label: "Observação", value: data.observacao_entrada, y, margin: MARGIN, width: CONTENT_WIDTH, fonts });
    }
  }

  if (data.divergencia_descricao) {
    ({ page, y } = paginate({ page, y }, 22 + 63));
    y = section(page, { title: "DIVERGÊNCIA REGISTRADA", y, margin: MARGIN, width: CONTENT_WIDTH, branding, fonts });
    y = fieldMultiline(page, { label: "Descrição", value: data.divergencia_descricao, y, margin: MARGIN, width: CONTENT_WIDTH, fonts, maxLines: 4 });
  }

  // Renomeações (mesmo achado do usuário já aplicado no Livro Digital):
  // "SNAPSHOT" era termo em inglês; "Acervo" não deixava claro que é a
  // contagem de itens físicos da reserva, não de tipos de material.
  ({ page, y } = paginate({ page, y }, 22 + 84));
  y = section(page, { title: "SITUAÇÃO DO ARSENAL NA PASSAGEM", y, margin: MARGIN, width: CONTENT_WIDTH, branding, fonts });
  y = field(page, { label: "Data de referência", value: fmtDt(data.snapshot.data_referencia), y, margin: MARGIN, fonts });
  y = field(page, { label: "Itens no arsenal", value: String(data.snapshot.carga_total.total), y, margin: MARGIN, fonts });
  y = field(page, { label: "Cautelas ativas", value: String(data.snapshot.cautelas_ativas.length), y, margin: MARGIN, fonts });
  y = field(page, { label: "Saídas ativas", value: String(data.snapshot.saidas_ativas.length), y, margin: MARGIN, fonts });
  y = field(page, { label: "Solicitações pendentes", value: String(data.snapshot.solicitacoes_pendentes), y, margin: MARGIN, fonts });
  y = field(page, { label: "Ocorrências abertas", value: String(data.snapshot.ocorrencias_abertas), y, margin: MARGIN, fonts });

  const porTipoEntries = Object.entries(data.snapshot.carga_total.por_tipo);
  if (porTipoEntries.length > 0) {
    ({ page, y } = paginate({ page, y }, 22 + 14));
    y = section(page, { title: "ITENS POR TIPO", y, margin: MARGIN, width: CONTENT_WIDTH, branding, fonts });
    // Achado de code review: a v1 truncava a lista silenciosamente quando
    // não cabia mais na página — agora pagina item a item (mesmo padrão do
    // resto do documento), nenhum tipo de material desaparece do documento.
    for (const [tipo, qty] of porTipoEntries) {
      ({ page, y } = paginate({ page, y }, 14));
      // Achado de code review: mesmo bug do label de "Cautelas Ativas"
      // abaixo — `tipo` vem de material_type.nome (até 80 chars no schema
      // de categories.ts), e field() só trunca o valor, não o label.
      const label = truncateToWidth(tipo, fonts.regular, 9, 116);
      y = field(page, { label, value: String(qty), y, margin: MARGIN, fonts });
    }
  }

  if (data.snapshot.cautelas_ativas.length > 0) {
    ({ page, y } = paginate({ page, y }, 22 + 14));
    y = section(page, { title: "CAUTELAS ATIVAS NO MOMENTO DA PASSAGEM", y, margin: MARGIN, width: CONTENT_WIDTH, branding, fonts });
    for (const c of data.snapshot.cautelas_ativas) {
      ({ page, y } = paginate({ page, y }, 14));
      // Achado de code review: field() só trunca o VALOR, não o label —
      // material_descricao (até 80 chars no schema) usado cru como label
      // podia invadir visualmente a coluna do valor. Trunca explicitamente
      // antes de passar pro field().
      const label = truncateToWidth(c.material_descricao, fonts.medium, 9, 190);
      y = field(page, { label, value: `${c.militar_nome} (emitido ${fmt(c.data_emissao)})`, y, margin: MARGIN, fonts, labelWidth: 200 });
    }
  }

  drawFooter(page, {
    margin: MARGIN,
    y: 76,
    hash: data.document_hash,
    verifyUrl: `${WEB_PUBLIC_URL}/v/passagem/${data.id}`,
    branding, fonts,
  });

  return pdf.save();
}
