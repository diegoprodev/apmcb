import { formatDateOnly } from "@/lib/format-date";
import { normalizeMaterialCategory } from "@/lib/material-metadata";

/**
 * SSOT da "linha de identificação" de um material do inventário/arsenal.
 *
 * Achado real do dono (2026-09-09): na grade do Almoxarifado o cabeçalho do
 * grupo mostrava a CATEGORIA ("VEICULO") e cada linha do grupo mostrava só
 * `material_types.nome` — que nesse acervo é um rótulo genérico ("VIATURA").
 * Resultado: duas viaturas distintas ficavam visualmente IDÊNTICAS, e o
 * rótulo repetido da linha parecia um segundo cabeçalho de categoria ("é
 * VEÍCULO ou VIATURA?"). O dado que identifica o item de verdade — placa,
 * modelo, calibre, nº de série, validade — já existia no banco
 * (material_types / material_availability) e simplesmente nunca era exibido
 * na listagem.
 *
 * Este módulo é a ÚNICA fonte da regra "o que identifica um material desta
 * categoria", para que grade, tabela, PDF, sheet de detalhe, seletor de
 * saída e solicitação de armamento nunca divirjam. Nenhum componente deve
 * reimplementar o `if (é veículo) ... else if (é arma) ...`.
 *
 * A regra é dirigida pelas CAPACIDADES da categoria (requires_vehicle_fields,
 * requires_validity, has_serial_numbers, calibre) — que é como o banco
 * modela o assunto — e só cai no slug (normalizeMaterialCategory) como
 * desempate para dados legados cadastrados antes das flags.
 */

export type MaterialIdentityInput = {
  nome?: string | null;
  categoria?: string | null;
  categoria_slug?: string | null;
  descricao?: string | null;
  calibre?: string | null;
  has_serial_numbers?: boolean | null;
  requires_validity?: boolean | null;
  requires_vehicle_fields?: boolean | null;
  vehicle_plate?: string | null;
  vehicle_color?: string | null;
  vehicle_year?: number | null;
  vehicle_model?: string | null;
  quantidade_total?: number | null;
  /** Só quando o chamador conhece a unidade física exata (ex.: material
   *  unitário, ou uma linha de cautela/manutenção que já é 1 item). */
  numero_serie?: string | null;
  /** Idem: validade da unidade, quando há uma só. */
  validade_item?: string | null;
};

/** `code` é um identificador literal (placa, série, calibre) — a UI o
 *  renderiza em chip monoespaçado, que é o que o olho procura ao varrer a
 *  lista. `text` é descritivo (modelo, cor/ano, contagem, descrição). */
export type MaterialIdentityPart = {
  key: string;
  value: string;
  kind: "code" | "text";
  /** Texto íntegro quando `value` foi truncado — vai no atributo title. */
  title?: string;
};

const DEFAULT_MAX_PARTS = 3;
const DESCRIPTION_MAX_CHARS = 72;

function text(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Placa brasileira para exibição. O cadastro guarda a placa já normalizada
 * (só alfanumérico, maiúscula — ver validateMaterialMetadata), então aqui
 * só reintroduzimos o hífen do padrão ANTIGO (AAA-1234). O padrão Mercosul
 * (AAA1A23) é escrito sem hífen por norma, e qualquer coisa fora dos dois
 * padrões é devolvida normalizada, nunca descartada — placa de dado legado
 * ainda identifica o veículo melhor do que nada.
 */
export function formatVehiclePlate(raw: string | null | undefined): string | null {
  const normalized = text(raw)?.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (!normalized) return null;
  if (/^[A-Z]{3}\d{4}$/.test(normalized)) return `${normalized.slice(0, 3)}-${normalized.slice(3)}`;
  return normalized;
}

function categorySlug(m: MaterialIdentityInput): string {
  const explicit = text(m.categoria_slug);
  if (explicit) return explicit.toLowerCase();
  const label = text(m.categoria);
  return label ? normalizeMaterialCategory(label).slug : "";
}

function truncate(value: string): { value: string; title?: string } {
  if (value.length <= DESCRIPTION_MAX_CHARS) return { value };
  return { value: `${value.slice(0, DESCRIPTION_MAX_CHARS).trimEnd()}…`, title: value };
}

/**
 * Partes de identificação, em ordem de poder discriminante (o que separa
 * dois itens da mesma categoria vem primeiro). Corta em `maxParts` para a
 * linha nunca virar um parágrafo — o resto fica no sheet de detalhe.
 */
export function getMaterialIdentityParts(
  m: MaterialIdentityInput,
  opts?: { maxParts?: number }
): MaterialIdentityPart[] {
  const maxParts = opts?.maxParts ?? DEFAULT_MAX_PARTS;
  if (maxParts <= 0) return [];

  const slug = categorySlug(m);
  const parts: MaterialIdentityPart[] = [];

  const plate = formatVehiclePlate(m.vehicle_plate);
  const model = text(m.vehicle_model);
  const color = text(m.vehicle_color);
  const year = Number.isFinite(m.vehicle_year) ? String(m.vehicle_year) : null;
  const isVehicle = m.requires_vehicle_fields === true || slug === "veiculo" || !!plate || !!model;

  if (isVehicle) {
    if (plate) parts.push({ key: "placa", value: plate, kind: "code" });
    if (model) parts.push({ key: "modelo", value: model, kind: "text" });
    const colorYear = [color, year].filter(Boolean).join(" ");
    if (colorYear) parts.push({ key: "cor_ano", value: colorYear, kind: "text" });
  }

  // Unidade física conhecida (material unitário, linha de cautela): a série
  // é o identificador mais forte que existe — vem antes do calibre.
  const serial = text(m.numero_serie);
  if (serial) parts.push({ key: "serie", value: `Nº ${serial}`, kind: "code" });

  const calibre = text(m.calibre);
  if (calibre && (m.requires_validity !== true || slug === "arma")) {
    parts.push({ key: "calibre", value: `Cal. ${calibre}`, kind: "code" });
  }

  const total = Number.isFinite(m.quantidade_total) ? Number(m.quantidade_total) : null;
  const tracksUnits = m.has_serial_numbers === true || m.requires_validity === true;

  if (tracksUnits && !serial) {
    const validade = m.requires_validity === true && total === 1 ? text(m.validade_item) : null;
    if (validade) {
      parts.push({ key: "validade", value: `Validade ${formatDateOnly(validade)}`, kind: "text" });
    } else if (total !== null && total > 1) {
      // Séries diferentes por unidade não cabem na linha (nem ajudam a
      // varredura visual) — a contagem sinaliza "abra o detalhe para ver as
      // unidades", que é onde as séries de fato estão.
      parts.push({ key: "unidades", value: `${total} unidades`, kind: "text" });
    }
  }

  // Descrição é o último recurso: só quando nada específico identificou o
  // material (caso das categorias livres criadas pelo tenant).
  if (parts.length === 0) {
    const descricao = text(m.descricao);
    if (descricao) {
      const { value, title } = truncate(descricao);
      parts.push({ key: "descricao", value, kind: "text", ...(title ? { title } : {}) });
    }
  }

  return parts.slice(0, maxParts);
}

/**
 * Versão em texto puro da identificação — para PDF, CSV, `aria-label`,
 * `title` e qualquer contexto sem marcação. A UI rica deve usar
 * `getMaterialIdentityParts` e estilizar cada parte.
 */
export function formatMaterialIdentity(
  m: MaterialIdentityInput,
  opts?: { maxParts?: number }
): string {
  return getMaterialIdentityParts(m, opts).map((p) => p.value).join(" · ");
}
