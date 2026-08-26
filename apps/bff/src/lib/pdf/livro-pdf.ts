import { PDFDocument, rgb, type PDFPage } from "pdf-lib";
import {
  loadTenantBranding, embedFonts, drawHeader, section, field, divider,
  drawTable, drawFooter, safeDrawText, WEB_PUBLIC_URL, fmtDateTime,
  PDF_PAGE_SIZE, PDF_PAGE_HEIGHT, PDF_PAGE_WIDTH, type TableRow,
} from "./pdf-theme";
import type { ShiftEventType } from "../shift-events";

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
  tenantId: string | null;
}

// Tipado contra o union real (não Record<string,...>) — se um event_type
// novo for adicionado em lib/shift-events.ts sem atualizar este mapa, o
// compilador avisa em vez de depender só do fallback silencioso em runtime.
const EVENT_LABEL: Record<ShiftEventType, string> = {
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

// Achado de code review: "Encerrado" genérico mascarava o estado
// "encerrado_sem_passagem" (encerramento irregular, sem passagem de turno
// gerada) — mesmo bug já corrigido em /v/turno/[id]/page.tsx (página de
// verificação do mesmo turno), reintroduzido aqui por engano. Mantém os 2
// documentos consistentes: o Livro baixado não pode dizer "Encerrado" liso
// enquanto a página de verificação por QR do mesmo turno mostra alerta.
const STATUS_LABEL: Record<string, string> = {
  ativo: "Em andamento",
  encerrado: "Encerrado",
  encerrado_sem_passagem: "Encerrado (sem passagem de turno)",
};

const fmtDt = fmtDateTime;

const MARGIN = 50;
const CONTENT_WIDTH = PDF_PAGE_SIZE[0] - MARGIN * 2;

export async function generateLivroPdf(data: LivroData): Promise<Uint8Array> {
  const branding = await loadTenantBranding(data.tenantId);
  const pdf = await PDFDocument.create();
  const fonts = await embedFonts(pdf);
  const page = pdf.addPage(PDF_PAGE_SIZE);

  let y = await drawHeader(pdf, page, {
    title: "Andrômeda — Livro Digital de Serviço",
    subtitle: `${data.reserve.acronym} — ${data.reserve.nome}`,
    margin: MARGIN,
    branding, fonts,
  });

  y = field(page, {
    label: "Turno", value: `${data.id.slice(0, 8).toUpperCase()} · Status: ${STATUS_LABEL[data.status] ?? data.status}`,
    y, margin: MARGIN, fonts,
  });
  y = divider(page, { y, margin: MARGIN, width: CONTENT_WIDTH });

  y = section(page, { title: "ARMEIRO RESPONSÁVEL", y, margin: MARGIN, width: CONTENT_WIDTH, branding, fonts });
  y = field(page, { label: "Nome completo", value: `${data.armeiro.posto ?? ""} ${data.armeiro.nome_completo}`.trim(), y, margin: MARGIN, fonts });
  y = field(page, { label: "Matrícula", value: data.armeiro.matricula, y, margin: MARGIN, fonts });
  y = field(page, { label: "Abertura", value: fmtDt(data.started_at), y, margin: MARGIN, fonts });
  y = field(page, { label: "Encerramento", value: fmtDt(data.ended_at), y, margin: MARGIN, fonts });

  // Renomeações (achado do usuário): "SNAPSHOT" era termo em inglês sem
  // tradução na tela; "Acervo total" não deixava claro que é a contagem de
  // itens físicos da reserva (material_items), não de tipos de material.
  if (data.opening_snapshot) {
    y = section(page, { title: "SITUAÇÃO NA ABERTURA DO TURNO", y, margin: MARGIN, width: CONTENT_WIDTH, branding, fonts });
    y = field(page, { label: "Itens no arsenal", value: String(data.opening_snapshot.total_itens), y, margin: MARGIN, fonts });
    y = field(page, { label: "Cautelas ativas", value: String(data.opening_snapshot.cautelas_ativas), y, margin: MARGIN, fonts });
    y = field(page, { label: "Saídas abertas", value: String(data.opening_snapshot.saidas_abertas), y, margin: MARGIN, fonts });
  }
  if (data.closing_snapshot) {
    y = section(page, { title: "SITUAÇÃO NO ENCERRAMENTO DO TURNO", y, margin: MARGIN, width: CONTENT_WIDTH, branding, fonts });
    y = field(page, { label: "Itens no arsenal", value: String(data.closing_snapshot.total_itens), y, margin: MARGIN, fonts });
    y = field(page, { label: "Cautelas ativas", value: String(data.closing_snapshot.cautelas_ativas), y, margin: MARGIN, fonts });
    y = field(page, { label: "Saídas abertas", value: String(data.closing_snapshot.saidas_abertas), y, margin: MARGIN, fonts });
  }

  y = section(page, {
    title: `LINHA DO TEMPO (${data.events.length} evento${data.events.length !== 1 ? "s" : ""})`,
    y, margin: MARGIN, width: CONTENT_WIDTH, branding, fonts,
  });

  const columns = [
    { key: "data", label: "DATA/HORA", width: 78 },
    { key: "evento", label: "EVENTO", width: 105 },
    { key: "ator", label: "RESPONSÁVEL", width: 155 },
    { key: "desc", label: "DESCRIÇÃO", width: 157 },
  ];

  const rows: TableRow[] = data.events.map((ev) => {
    // ev.event_type vem do banco como string solta (não garantida em
    // compile-time) — o cast preserva a checagem exaustiva de
    // EVENT_LABEL contra ShiftEventType na declaração acima, mas permite
    // lookup com fallback seguro para um valor não mapeado em runtime.
    const label = (EVENT_LABEL as Record<string, string>)[ev.event_type] ?? ev.event_type;
    const ator = ev.actor_nome
      ? `${ev.actor_nome}${ev.actor_matricula ? ` (${ev.actor_matricula})` : ""}`
      : "—";
    return {
      cells: {
        data: fmtDt(ev.happened_at),
        evento: label,
        ator,
        desc: ev.description,
      },
      detail: `hash: ${ev.event_hash.slice(0, 32)}…`,
    };
  });

  // Achado de code review: sem isso, uma timeline longa o bastante para
  // paginar (~11-16 eventos, nada incomum numa reserva movimentada) gerava
  // páginas de continuação em branco — sem título, tenant ou identificação
  // do turno. Um documento de custódia de armamento impresso/anexado por
  // e-mail pode ter suas páginas separadas; cada uma precisa se identificar
  // sozinha.
  let continuationPageNumber = 1;
  const CONTINUATION_BAR_HEIGHT = 28;
  const drawContinuationPage = (): PDFPage => {
    continuationPageNumber += 1;
    const newP = pdf.addPage(PDF_PAGE_SIZE);
    newP.drawRectangle({ x: 0, y: PDF_PAGE_HEIGHT - CONTINUATION_BAR_HEIGHT, width: PDF_PAGE_WIDTH, height: CONTINUATION_BAR_HEIGHT, color: branding.primaryColor });
    // Conteúdo interpolado aqui é sempre seguro (UUID do turno + inteiro),
    // mas usa safeDrawText por padronização/defesa em profundidade — se
    // este template um dia ganhar nome de reserva/armeiro, já está protegido.
    safeDrawText(
      newP,
      `Andrômeda — Livro Digital de Serviço — Turno ${data.id.slice(0, 8).toUpperCase()} — continuação (pág. ${continuationPageNumber})`,
      { x: MARGIN, y: PDF_PAGE_HEIGHT - CONTINUATION_BAR_HEIGHT / 2 - 3, size: 8, font: fonts.medium, color: rgb(1, 1, 1) },
    );
    return newP;
  };

  const tableResult = drawTable({
    page, x: MARGIN, y, width: CONTENT_WIDTH,
    columns, rows,
    rowHeight: 16, fonts, branding,
    minY: 130,
    newPage: drawContinuationPage,
    newPageStartY: PDF_PAGE_HEIGHT - CONTINUATION_BAR_HEIGHT - 18,
  });

  const rootHash = data.events.length > 0 ? data.events[data.events.length - 1].event_hash : null;
  drawFooter(tableResult.page, {
    margin: MARGIN,
    y: 60,
    hash: rootHash,
    verifyUrl: `${WEB_PUBLIC_URL}/v/turno/${data.id}`,
    branding, fonts,
  });

  return pdf.save();
}
