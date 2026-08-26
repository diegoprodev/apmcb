import { PDFDocument, rgb, type RGB, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import QRCode from "qrcode";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { supabase } from "../../services/supabase";
import { logger } from "../logger";

// Hoje a URL de verificação da Cautela estava hardcoded direto em
// cautela-pdf.ts — centraliza aqui, mesmo padrão de BFF_PUBLIC_URL já usado
// nos outros geradores (livro-pdf.ts, handover-pdf.ts, inventory-pdf.ts).
export const WEB_PUBLIC_URL = process.env.WEB_PUBLIC_URL ?? "https://apmcb.pmpb.online";

// ── Datas ────────────────────────────────────────────────────────────────
// Achado de code review (retrofit do 5º gerador, historico-pdf.ts): cada
// gerador tinha sua própria cópia byte-a-byte de fmt/fmtDt, e a cópia de
// historico-pdf.ts divergia — sem `timeZone: "America/Recife"` (usava o TZ
// do processo do VPS), então o mesmo evento podia aparecer com data
// diferente entre o histórico e os outros 4 documentos perto da meia-noite.
// Consolidado aqui como SSOT; os 5 geradores importam em vez de duplicar.
export const fmtDate = (d?: string | null): string => {
  if (!d) return "—";
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("pt-BR", { timeZone: "America/Recife" });
};

export const fmtDateTime = (d?: string | null): string => {
  if (!d) return "—";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", {
    timeZone: "America/Recife",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

// Achado de code review (follow-up da consolidação acima): fmtDate aplica
// timeZone: "America/Recife" (UTC-3) a QUALQUER string — correto pra
// TIMESTAMPTZ (instante real, ex: created_at/data_emissao), mas incorreto
// pra colunas DATE puras (ex: validade_item, prazo_proxima_conferencia,
// os filtros ?from=/?to= do histórico): "2026-08-24" vira meia-noite UTC,
// que em Recife (UTC-3) já é 23/08 — desloca 1 dia pra trás sempre, 100%
// determinístico, não é edge case de fuso. Já era bug pré-existente em
// cautela-pdf.ts antes desta consolidação (usava a mesma lógica local);
// virou também regressão nova em historico-pdf.ts (filtros From/To) ao
// consolidar sem essa distinção. fmtCivilDate faz parsing puramente
// textual (sem passar por Date/timezone) pra esses casos.
export const fmtCivilDate = (d?: string | null): string => {
  if (!d) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : fmtDate(d);
};

const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets");
const FALLBACK_LOGO_PATH = join(ASSETS_DIR, "apmcb-logo.png");
const FONT_PATHS = {
  regular: join(ASSETS_DIR, "fonts", "inter-regular.woff"),
  medium: join(ASSETS_DIR, "fonts", "inter-medium.woff"),
  bold: join(ASSETS_DIR, "fonts", "inter-bold.woff"),
};

// ── Cor ──────────────────────────────────────────────────────────────────

export function hexToRgb(hex: string): RGB {
  const clean = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    throw new Error(`hexToRgb: "${hex}" não é um hex de 6 dígitos válido`);
  }
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

// Mistura uma cor com branco — usado para fundos de seção/linha claros a
// partir da cor do tenant, sem precisar calcular contraste (ver regra de
// contraste fixa abaixo).
export function tint(color: RGB, amount: number): RGB {
  const mix = (c: number) => c + (1 - c) * amount;
  return rgb(mix(color.red), mix(color.green), mix(color.blue));
}

const WHITE = rgb(1, 1, 1);
const BLACK_TEXT = rgb(0.1, 0.1, 0.1);
// Exportado — historico-pdf.ts usa pra linhas de texto livre (filtros,
// info do militar) que não se encaixam no padrão label:value de field().
export const GRAY_TEXT = rgb(0.42, 0.42, 0.42);

// ── Branding do tenant ───────────────────────────────────────────────────

export interface TenantBranding {
  primaryColor: RGB;
  secondaryColor: RGB;
  primaryHex: string;
  secondaryHex: string;
  logoBytes: ArrayBuffer | Buffer | null;
  logoIsJpg: boolean;
}

const DEFAULT_PRIMARY_HEX = "#0f172a";
const DEFAULT_SECONDARY_HEX = "#3b82f6";

async function loadLogoBytes(logoUrl?: string | null): Promise<{ bytes: ArrayBuffer | Buffer; isJpg: boolean } | null> {
  if (logoUrl) {
    try {
      // Timeout explícito: este módulo agora é SSOT de branding para todos
      // os geradores de PDF — uma resposta pendurada do Storage travaria a
      // geração de qualquer um dos 5 documentos indefinidamente, não só um.
      const res = await fetch(logoUrl, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const bytes = await res.arrayBuffer();
        const mime = res.headers.get("content-type") ?? "";
        return { bytes, isJpg: !mime.includes("png") && !logoUrl.endsWith(".png") };
      }
      logger.error("pdf_theme.logo_fetch_not_ok", { logo_url: logoUrl, status: res.status });
    } catch (err) {
      logger.error("pdf_theme.logo_fetch_failure", { logo_url: logoUrl, error: err instanceof Error ? err.message : String(err) });
    }
  }
  try {
    const bytes = await readFile(FALLBACK_LOGO_PATH);
    return { bytes, isJpg: false };
  } catch {
    return null;
  }
}

// Client mínimo exigido por loadTenantBranding — permite injetar um mock
// nos testes sem tocar no singleton de services/supabase.ts (achado de code
// review: a função não tinha nenhum teste cobrindo o branch de erro do
// Supabase, exatamente o branch que o fix "loga em vez de descartar
// silenciosamente" adicionou).
type SupabaseLike = { from: typeof supabase.from };

// Busca cor e logo do tenant em tenant_branding, com fallback pros defaults
// atuais e prioridade reserva→tenant→estático pro logo (regra nova desta
// spec — hoje layout.tsx:250 no frontend só usa reserve_logo_url ?? null,
// nem busca tenant_logo_url; os dois campos já coexistem na tabela desde a
// migration original, então esta prioridade é a leitura natural do schema,
// não a replicação de um padrão já validado em produção).
export async function loadTenantBranding(
  tenantId: string | null | undefined,
  client: SupabaseLike = supabase,
): Promise<TenantBranding> {
  let primaryHex = DEFAULT_PRIMARY_HEX;
  let secondaryHex = DEFAULT_SECONDARY_HEX;
  let logoUrl: string | null = null;

  if (tenantId) {
    const { data, error } = await client
      .from("tenant_branding")
      .select("primary_hex, secondary_hex, tenant_logo_url, reserve_logo_url")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    // Achado de code review: sem checar `error`, uma falha real (RLS,
    // timeout, coluna renomeada) caía nos mesmos defaults de "tenant sem
    // branding configurado" — sem log, indistinguível em produção de um
    // tenant que legitimamente nunca configurou cor/logo.
    if (error) {
      logger.error("pdf_theme.branding_query_failure", { tenant_id: tenantId, error: error.message });
    } else if (data) {
      primaryHex = data.primary_hex ?? DEFAULT_PRIMARY_HEX;
      secondaryHex = data.secondary_hex ?? DEFAULT_SECONDARY_HEX;
      logoUrl = data.reserve_logo_url ?? data.tenant_logo_url ?? null;
    }
  }

  const logo = await loadLogoBytes(logoUrl);
  return {
    primaryColor: hexToRgb(primaryHex),
    secondaryColor: hexToRgb(secondaryHex),
    primaryHex,
    secondaryHex,
    logoBytes: logo?.bytes ?? null,
    logoIsJpg: logo?.isJpg ?? false,
  };
}

// ── Fontes ───────────────────────────────────────────────────────────────

export interface ThemeFonts {
  regular: PDFFont;
  medium: PDFFont;
  bold: PDFFont;
}

// Hierarquia tipográfica real (pesos distintos), não só variação de tamanho
// da mesma Helvetica padrão do pdf-lib.
export async function embedFonts(pdf: PDFDocument): Promise<ThemeFonts> {
  pdf.registerFontkit(fontkit);
  const [regularBytes, mediumBytes, boldBytes] = await Promise.all([
    readFile(FONT_PATHS.regular),
    readFile(FONT_PATHS.medium),
    readFile(FONT_PATHS.bold),
  ]);
  // Achado de code review: subset:false (default do pdf-lib) embute a
  // fonte Inter inteira (~100KB/peso) em todo PDF gerado, mesmo usando só
  // uma fração dos glifos (texto em pt-BR não usa nem 10% do charset da
  // Inter). subset:true reduz pra ~11KB/peso, medido — pdf-lib calcula o
  // subset automaticamente a partir do texto de fato desenhado.
  const [regular, medium, bold] = await Promise.all([
    pdf.embedFont(regularBytes, { subset: true }),
    pdf.embedFont(mediumBytes, { subset: true }),
    pdf.embedFont(boldBytes, { subset: true }),
  ]);
  return { regular, medium, bold };
}

// ── QR code ──────────────────────────────────────────────────────────────

// Defesa preventiva: fontes customizadas embutidas via fontkit (Inter, não
// as 14 fontes padrão WinAnsi do pdf-lib) podem, dependendo da versão de
// pdf-lib/fontkit, lançar exceção em drawText() ao encontrar um code point
// sem glifo mapeado (emoji, símbolos exóticos, scripts fora do subset Latin
// baixado) — texto livre digitado por usuário (ex: descrição de
// ocorrência/evento manual) pode conter isso. Com as versões atualmente
// fixadas no package.json, o comportamento observado é substituição
// silenciosa por glifo de fallback, não exceção — mas sanitizar aqui evita
// tanto um upgrade futuro reintroduzir esse risco quanto glifos "tofu"
// visíveis num documento de custódia de armamento. O try/catch em
// safeDrawText é rede de segurança adicional para o restante dos casos
// (ex: \p{L} de um script fora do subset da fonte).
//
// Achado de code review (retrofit do 6º gerador, historico-pdf.ts): a
// versão original era um ALLOWLIST (\p{L}\p{N}\p{P}\p{Zs} só) — bloqueava
// qualquer coisa fora dessas 4 categorias, incluindo símbolos que a Inter
// renderiza normalmente (confirmado medindo a fonte: "|", "=", "+", "°",
// "$" têm glifo real, categoria Unicode Símbolo, não Pontuação) e quebras
// de linha (categoria Controle) — um "\n" digitado numa textarea virava
// "?" grudando a palavra seguinte (wrapText divide por \s+ DEPOIS de
// sanitizar, então o "?" no lugar do \n deixa de ser separador). Isso já
// afetava em produção: motivo_emissao da Cautela, observações/divergência
// da Passagem de Turno, e a própria URL de verificação do Inventário no
// rodapé (o "=" de "?hash=" virava "?"). Trocado para BLOCKLIST: bloqueia
// só o que é conhecidamente arriscado (controle/formatação/não-atribuído e
// as faixas de emoji/pictogramas, que a Inter de fato não cobre — mantém a
// defesa que os testes existentes de "substitui emoji por ?" verificam),
// deixando passar todo o resto (letras, números, pontuação, símbolos
// comuns). Quebras de linha são normalizadas para espaço ANTES do
// blocklist (não bloqueadas como "?"), preservando o separador de palavras
// que wrapText espera.
const SAFE_TEXT_PATTERN = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\u{2600}-\u{27BF}\u{1F000}-\u{1FFFF}]/gu;

export function sanitizeText(text: string): string {
  return text.replace(/[\r\n\t]+/g, " ").replace(SAFE_TEXT_PATTERN, "?");
}

export function safeDrawText(page: PDFPage, text: string, opts: Parameters<PDFPage["drawText"]>[1]): void {
  const sanitized = sanitizeText(text);
  try {
    page.drawText(sanitized, opts);
  } catch (err) {
    logger.error("pdf_theme.draw_text_failure", { error: err instanceof Error ? err.message : String(err) });
    try {
      page.drawText("?".repeat(Math.min(sanitized.length, 40)), opts);
    } catch {
      // último recurso: nem "?" desenhou — segue sem essa linha de texto
      // em vez de derrubar a geração do documento inteiro.
    }
  }
}

export function drawQrCode(page: PDFPage, url: string, x: number, y: number, totalSize: number): void {
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

// ── Blocos de desenho ────────────────────────────────────────────────────
// Todas as funções abaixo são puras em relação a `y`: recebem a posição
// atual e retornam a nova posição — sem depender de closure compartilhada,
// para funcionar igual em qualquer gerador que tenha sua própria variável
// local de `y`.

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const HEADER_HEIGHT = 64;

interface HeaderOptions {
  title: string;
  subtitle?: string;
  margin: number;
  branding: TenantBranding;
  fonts: ThemeFonts;
}

// Achado de code review (inventory-pdf.ts, único gerador que chama
// drawHeader mais de uma vez no mesmo PDFDocument — 1x por reserva
// conferida): pdf-lib não deduplica embedPng/embedJpg — cada chamada cria
// um XObject novo, mesmo para bytes idênticos. Um documento com N reservas
// embutia o mesmo logo N vezes (custo de CPU decodificando de novo +
// tamanho de arquivo inflado). Cache por PDFDocument evita reembuti-lo mais
// de uma vez por documento. Chaveado também pelos bytes do logo (não só
// pelo PDFDocument) — drawHeader é função pública, nada impede um chamador
// futuro passar brandings diferentes no mesmo doc (ex: logo por reserva,
// para o qual loadTenantBranding já tem a prioridade reserve>tenant
// pronta); sem isso, o segundo branding usaria silenciosamente o logo do
// primeiro. Memoiza também `null` (falha de embed) — sem isso, um logo
// corrompido era reprocessado (e logado) N vezes no mesmo documento.
const logoImageCache = new WeakMap<PDFDocument, Map<ArrayBuffer | Buffer, PDFImage | null>>();

// Faixa de cor sólida no topo (primaryColor) + logo à esquerda + título em
// branco. Regra de contraste fixa: texto sobre cor dinâmica é sempre branco
// fixo, nunca outra cor dinâmica — evita a classe inteira de "cor clara
// sobre fundo claro" sem precisar calcular contraste matematicamente.
export async function drawHeader(pdf: PDFDocument, page: PDFPage, opts: HeaderOptions): Promise<number> {
  const { title, subtitle, margin, branding, fonts } = opts;
  const { width, height } = page.getSize();

  page.drawRectangle({ x: 0, y: height - HEADER_HEIGHT, width, height: HEADER_HEIGHT, color: branding.primaryColor });

  let logoWidth = 0;
  if (branding.logoBytes) {
    let perDoc = logoImageCache.get(pdf);
    if (!perDoc) {
      perDoc = new Map();
      logoImageCache.set(pdf, perDoc);
    }
    let logoImage = perDoc.get(branding.logoBytes);
    if (logoImage === undefined) {
      try {
        logoImage = branding.logoIsJpg
          ? await pdf.embedJpg(branding.logoBytes)
          : await pdf.embedPng(branding.logoBytes);
      } catch (err) {
        // segue sem logo — mesma tolerância de cautela-pdf.ts hoje, mas
        // logado pra diagnosticar "por que o logo do tenant X sumiu"
        logger.error("pdf_theme.logo_embed_failure", { error: err instanceof Error ? err.message : String(err) });
        logoImage = null;
      }
      perDoc.set(branding.logoBytes, logoImage);
    }
    if (logoImage) {
      try {
        const dims = logoImage.scaleToFit(40, 40);
        page.drawImage(logoImage, { x: margin, y: height - HEADER_HEIGHT / 2 - dims.height / 2, width: dims.width, height: dims.height });
        logoWidth = dims.width + 14;
      } catch (err) {
        logger.error("pdf_theme.logo_draw_failure", { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  const textX = margin + logoWidth;
  const maxTitleWidth = width - textX - margin;
  safeDrawText(page, truncateToWidth(title, fonts.bold, 15, maxTitleWidth), { x: textX, y: height - 30, size: 15, font: fonts.bold, color: WHITE });
  if (subtitle) {
    safeDrawText(page, truncateToWidth(subtitle, fonts.regular, 9, maxTitleWidth), { x: textX, y: height - 47, size: 9, font: fonts.regular, color: tint(branding.primaryColor, 0.65) });
  }

  return height - HEADER_HEIGHT - 18;
}

interface SectionOptions {
  title: string;
  y: number;
  margin: number;
  width: number;
  branding: TenantBranding;
  fonts: ThemeFonts;
}

export function section(page: PDFPage, opts: SectionOptions): number {
  const { title, y, margin, width, branding, fonts } = opts;
  const bg = tint(branding.secondaryColor, 0.88);
  page.drawRectangle({ x: margin, y: y - 4, width, height: 18, color: bg });
  safeDrawText(page, truncateToWidth(title, fonts.bold, 10, width - 8), { x: margin + 4, y: y, size: 10, font: fonts.bold, color: branding.primaryColor });
  return y - 22;
}

export function field(page: PDFPage, opts: { label: string; value: string; y: number; margin: number; fonts: ThemeFonts; labelWidth?: number; maxWidth?: number }): number {
  const { label, value, y, margin, fonts, labelWidth = 130, maxWidth = 400 } = opts;
  safeDrawText(page, label + ":", { x: margin, y, size: 9, font: fonts.medium, color: GRAY_TEXT });
  safeDrawText(page, truncateToWidth(value, fonts.regular, 9, maxWidth - labelWidth), { x: margin + labelWidth, y, size: 9, font: fonts.regular, color: BLACK_TEXT });
  return y - 14;
}

// Quebra um único token sem espaço (hash, URL, CJK sem separador — qualquer
// coisa mais larga que maxWidth sozinha) em fragmentos que cabem, por
// largura real (mesma busca binária de truncateToWidth, sem reticências —
// cada fragmento vira uma linha própria em wrapText, não uma palavra
// truncada isoladamente).
function splitOversizedToken(token: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const chunks: string[] = [];
  let rest = token;
  while (rest.length > 0 && font.widthOfTextAtSize(rest, size) > maxWidth) {
    let lo = 1, hi = rest.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (font.widthOfTextAtSize(rest.slice(0, mid), size) <= maxWidth) lo = mid; else hi = mid - 1;
    }
    chunks.push(rest.slice(0, lo));
    rest = rest.slice(lo);
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

// Quebra por palavra (não por caractere) em até `maxLines` linhas que cabem
// em `maxWidth`. Achado de code review: a v1 empurrava uma palavra que não
// coubesse sozinha (hash, URL, CJK sem espaço) direto pra `current` sem
// checar sua largura — o texto vazava da coluna sem aviso, exatamente a
// classe de bug que esta função foi criada pra evitar. Agora toda palavra
// maior que maxWidth é fragmentada via splitOversizedToken, cada fragmento
// ocupando sua própria linha. A última linha é truncada por largura real
// (com reticências) quando ainda sobra palavra não incluída em maxLines.
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number, maxLines: number): string[] {
  const clean = sanitizeText(text);
  const words = clean.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let wordIdx = 0;

  outer:
  for (; wordIdx < words.length; wordIdx++) {
    const word = words[wordIdx];
    if (font.widthOfTextAtSize(word, size) > maxWidth) {
      if (current) {
        if (lines.length >= maxLines) break outer;
        lines.push(current);
        current = "";
      }
      for (const chunk of splitOversizedToken(word, font, size, maxWidth)) {
        if (lines.length >= maxLines) break outer;
        lines.push(chunk);
      }
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (lines.length >= maxLines) break outer;
      lines.push(current);
      current = word;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
    wordIdx = words.length;
  }

  // Achado de code review (do próprio teste escrito para esta função): se a
  // última linha já cabe perfeitamente em maxWidth mas ainda sobra palavra
  // fora dela, truncateToWidth() não adiciona "…" (ela não precisa cortar
  // nada "por largura") — o corte fica invisível pro leitor, que não tem
  // como saber que o texto continua. forceEllipsis() sempre marca reticências
  // quando SABEMOS que sobrou conteúdo, mesmo sem precisar cortar caracteres.
  if (lines.length >= maxLines && wordIdx < words.length && lines.length > 0) {
    lines[lines.length - 1] = forceEllipsis(lines[lines.length - 1], font, size, maxWidth);
  }
  return lines.slice(0, maxLines);
}

function forceEllipsis(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text + "…", size) <= maxWidth) return text + "…";
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (font.widthOfTextAtSize(text.slice(0, mid) + "…", size) <= maxWidth) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, lo) + "…";
}

// Campo com valor potencialmente longo (motivo, observação, descrição de
// divergência) — label numa linha, valor quebrado em até `maxLines` linhas
// ocupando `width` inteiro, em vez de truncar em 1 linha estreita ao lado
// do label (achado de code review: motivo_emissao de cautela aceita até
// 500 caracteres no schema, mas só ~60 sobreviviam truncados ao lado do
// label — perda silenciosa de informação num documento de custódia).
export function fieldMultiline(page: PDFPage, opts: { label: string; value: string; y: number; margin: number; width: number; fonts: ThemeFonts; maxLines?: number }): number {
  const { label, value, y, margin, width, fonts, maxLines = 3 } = opts;
  safeDrawText(page, label + ":", { x: margin, y, size: 9, font: fonts.medium, color: GRAY_TEXT });
  let ny = y - 13;
  for (const line of wrapText(value, fonts.regular, 9, width - 10, maxLines)) {
    safeDrawText(page, line, { x: margin + 10, y: ny, size: 9, font: fonts.regular, color: BLACK_TEXT });
    ny -= 12;
  }
  return ny - 2;
}

export function divider(page: PDFPage, opts: { y: number; margin: number; width: number }): number {
  const { y, margin, width } = opts;
  page.drawLine({ start: { x: margin, y }, end: { x: margin + width, y }, thickness: 0.5, color: rgb(0.82, 0.82, 0.82) });
  return y - 12;
}

// Trunca por largura real de fonte (busca binária), não por contagem de
// caracteres — mesma técnica já usada em livro-pdf.ts hoje. Sanitiza antes
// de medir: widthOfTextAtSize() lança a mesma exceção de glifo ausente que
// drawText() (ver safeDrawText acima) — medir o texto cru quebraria aqui
// antes mesmo de chegar no desenho.
export function truncateToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const clean = sanitizeText(text);
  if (font.widthOfTextAtSize(clean, size) <= maxWidth) return clean;
  let lo = 0, hi = clean.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = clean.slice(0, mid) + "…";
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) lo = mid; else hi = mid - 1;
  }
  return clean.slice(0, lo) + "…";
}

export interface TableColumn {
  label: string;
  width: number;
  key: string;
}

export interface TableRow {
  cells: Record<string, string>;
  // Linha de detalhe indentada opcional abaixo da linha principal — para
  // descrição longa de evento, divergência de inventário, etc. Variante
  // explícita, não wrapping multi-linha implícito (v1 é altura fixa).
  detail?: string;
}

interface DrawTableOptions {
  page: PDFPage;
  x: number;
  y: number;
  width: number;
  columns: TableColumn[];
  rows: TableRow[];
  rowHeight: number;
  fonts: ThemeFonts;
  branding: TenantBranding;
  minY: number; // abaixo disso, pagina
  newPage: () => PDFPage; // chamado quando precisa paginar; deve devolver a nova página já com header desenhado se aplicável
  newPageStartY: number; // y inicial da tabela na página nova (após header/repeat de cabeçalho de coluna)
}

// Tabela real com colunas: cabeçalho colorido + linhas zebradas + altura
// fixa (v1 não faz wrapping multi-linha — célula que não cabe é truncada
// por largura real via truncateToWidth). Generaliza o padrão já usado em
// historico-pdf.ts.
export function drawTable(opts: DrawTableOptions): { page: PDFPage; y: number } {
  const { x, columns, rows, rowHeight, fonts, branding, minY, newPage, newPageStartY } = opts;
  const width = opts.width;
  let page = opts.page;
  let y = opts.y;

  // Achado de code review: sem esta checagem, um `newPageStartY`/`minY`
  // mal configurado faz CADA linha de uma página nova ultrapassar `minY`
  // silenciosamente (sobrepondo rodapé/QR) — erro de configuração do
  // chamador vira documento corrompido visualmente, sem nenhum aviso.
  // Roda incondicionalmente (fail-fast), mesmo quando esta chamada nunca
  // chegaria a paginar de fato — os 3 parâmetros são obrigatórios, então
  // todo chamador real precisa fornecer valores consistentes de qualquer
  // forma.
  if (newPageStartY - minY < rowHeight) {
    throw new Error(`drawTable: newPageStartY (${newPageStartY}) - minY (${minY}) menor que rowHeight (${rowHeight}) — não cabe nem uma linha em página nova`);
  }

  const drawColumnHeader = (p: PDFPage, headerY: number) => {
    p.drawRectangle({ x, y: headerY - rowHeight + 4, width, height: rowHeight, color: branding.secondaryColor });
    let cx = x;
    for (const col of columns) {
      safeDrawText(p, truncateToWidth(col.label, fonts.bold, 8, col.width - 8), { x: cx + 4, y: headerY - rowHeight + 9, size: 8, font: fonts.bold, color: WHITE });
      cx += col.width;
    }
  };

  drawColumnHeader(page, y);
  y -= rowHeight;

  rows.forEach((row, idx) => {
    const needed = row.detail ? rowHeight * 2 : rowHeight;
    if (y - needed < minY) {
      page = newPage();
      y = newPageStartY;
      drawColumnHeader(page, y);
      y -= rowHeight;
    }

    const bg = idx % 2 === 0 ? WHITE : tint(branding.secondaryColor, 0.95);
    page.drawRectangle({ x, y: y - rowHeight + 4, width, height: rowHeight, color: bg });

    let cx = x;
    for (const col of columns) {
      const raw = row.cells[col.key] ?? "";
      const truncated = truncateToWidth(raw, fonts.regular, 8, col.width - 8);
      safeDrawText(page, truncated, { x: cx + 4, y: y - rowHeight + 9, size: 8, font: fonts.regular, color: BLACK_TEXT });
      cx += col.width;
    }
    y -= rowHeight;

    if (row.detail) {
      const detailTruncated = truncateToWidth(row.detail, fonts.regular, 7, width - 16);
      safeDrawText(page, detailTruncated, { x: x + 12, y: y - 7 + 9, size: 7, font: fonts.regular, color: GRAY_TEXT });
      y -= rowHeight;
    }
  });

  return { page, y };
}

// ── Rodapé ───────────────────────────────────────────────────────────────

interface FooterOptions {
  margin: number;
  y: number;
  hash?: string | null;
  verifyUrl?: string | null;
  branding: TenantBranding;
  fonts: ThemeFonts;
}

// Rodapé padronizado — "Andrômeda" (nome do sistema, sempre) + hash + QR de
// verificação, quando houver.
export function drawFooter(page: PDFPage, opts: FooterOptions): void {
  const { margin, y, hash, verifyUrl, branding, fonts } = opts;
  const { width } = page.getSize();
  let textY = y;

  if (verifyUrl) {
    const qrSize = 56;
    const qrX = width - margin - qrSize;
    const qrY = y + qrSize;
    drawQrCode(page, verifyUrl, qrX, qrY, qrSize);
    const verifyLabelWidth = fonts.regular.widthOfTextAtSize("Verificar", 7);
    safeDrawText(page, "Verificar", { x: qrX + qrSize / 2 - verifyLabelWidth / 2, y: y - 10, size: 7, font: fonts.regular, color: GRAY_TEXT });
  }

  safeDrawText(page, "Andrômeda", { x: margin, y: textY, size: 8, font: fonts.bold, color: branding.primaryColor });
  safeDrawText(page, " — Plataforma de Governança de Bens Sensíveis", { x: margin + fonts.bold.widthOfTextAtSize("Andrômeda", 8), y: textY, size: 8, font: fonts.regular, color: GRAY_TEXT });
  textY -= 12;

  if (hash) {
    safeDrawText(page, `Hash: ${hash.slice(0, 32)}${hash.length > 32 ? "…" : ""}`, { x: margin, y: textY, size: 7, font: fonts.regular, color: GRAY_TEXT });
    textY -= 11;
  }
  if (verifyUrl) {
    safeDrawText(page, truncateToWidth(`Verifique em: ${verifyUrl}`, fonts.regular, 7, width - margin * 2 - 60), { x: margin, y: textY, size: 7, font: fonts.regular, color: branding.primaryColor });
  }
}

export interface PageCursor {
  page: PDFPage;
  y: number;
}

export const CONTINUATION_BAR_HEIGHT = 28;

// Exportada (além de usada internamente por ensureSpace) para geradores que
// paginam via drawTable diretamente (não via ensureSpace) — ex:
// inventory-pdf.ts, onde uma reserva com muitos itens pode fazer drawTable
// criar páginas novas por conta própria; sem chamar isto no callback
// `newPage`, essas páginas ficavam sem identificar a que reserva pertencem.
export function drawContinuationBar(page: PDFPage, title: string, margin: number, branding: TenantBranding, fonts: ThemeFonts): void {
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - CONTINUATION_BAR_HEIGHT, width: PAGE_WIDTH, height: CONTINUATION_BAR_HEIGHT, color: branding.primaryColor });
  safeDrawText(page, truncateToWidth(title, fonts.medium, 8, PAGE_WIDTH - margin * 2), {
    x: margin, y: PAGE_HEIGHT - CONTINUATION_BAR_HEIGHT / 2 - 3, size: 8, font: fonts.medium, color: WHITE,
  });
}

// Garante espaço vertical suficiente para o próximo bloco de conteúdo antes
// de desenhá-lo — se não houver, cria página nova com uma faixa de
// continuação (cor do tenant + título) e devolve o cursor atualizado.
// Achado de code review (handover-pdf.ts): documentos com múltiplas seções
// condicionais (observações longas, snapshot com muitos itens) desenhavam
// cada bloco incondicionalmente na posição y que sobrou do anterior,
// podendo sobrepor o rodapé/QR de verificação em cenários com bastante
// conteúdo simultâneo — mesma classe de bug já corrigida em livro-pdf.ts
// (lá via drawTable, que pagina linha a linha; aqui generalizado para
// qualquer gerador com seções de tamanho variável desenhadas em sequência).
export function ensureSpace(
  pdf: PDFDocument,
  cursor: PageCursor,
  neededHeight: number,
  opts: { minY: number; continuationTitle: string; margin: number; branding: TenantBranding; fonts: ThemeFonts },
): PageCursor {
  const { minY, continuationTitle, margin, branding, fonts } = opts;
  if (cursor.y - neededHeight >= minY) return cursor;
  const newPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawContinuationBar(newPage, continuationTitle, margin, branding, fonts);
  return { page: newPage, y: PAGE_HEIGHT - CONTINUATION_BAR_HEIGHT - 18 };
}

export const PDF_PAGE_WIDTH = PAGE_WIDTH;
export const PDF_PAGE_HEIGHT = PAGE_HEIGHT;
export const PDF_PAGE_SIZE: [number, number] = [PAGE_WIDTH, PAGE_HEIGHT];
