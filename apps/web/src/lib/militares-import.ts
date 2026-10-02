// Import de militares por CSV/XLSX: leitura no navegador, validação espelhada do BFF
// (POST /api/admin/militares/import) e junção em linhas {nome_completo, email, matricula, posto?}.
// Mínimo obrigatório: nome, e-mail e matrícula.

export interface ImportRow { nome_completo: string; email: string; matricula: string; posto?: string | null }
export interface ImportParseError { line: number; message: string }
export interface ImportParseResult { rows: ImportRow[]; errors: ImportParseError[]; missingColumns: string[] }

// Blocos pequenos por requisição (o import é sequencial e envia e-mails): o BFF aceita até 50.
export const IMPORT_MAX_ROWS = 20;
export const IMPORT_FILE_MAX_BYTES = 5 * 1024 * 1024; // teto do arquivo lido no navegador
export const IMPORT_TOTAL_MAX_ROWS = 2000; // = teto da lista "Sem reserva" (import sem reserva não pode estourá-la)

const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const ALIASES: Record<keyof ImportRow, string[]> = {
  nome_completo: ["nome", "nome completo", "nome do militar", "militar"],
  email: ["email", "e mail", "correio", "email de acesso"],
  matricula: ["matricula", "mat", "matricula militar", "numero de matricula"],
  posto: ["posto", "graduacao", "posto graduacao", "posto grad"],
};
const REQUIRED: Array<keyof ImportRow> = ["nome_completo", "email", "matricula"];
const LABEL: Record<keyof ImportRow, string> = { nome_completo: "nome", email: "e-mail", matricula: "matrícula", posto: "posto" };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FORMULA_RE = /^[=+\-@\t\r]/;
const MATRICULA_RE = /^[A-Za-z0-9][A-Za-z0-9.\-/]*$/;

/** Converte a matriz de células (1ª linha = cabeçalho) em linhas validadas. */
export function parseImportMatrix(matrix: unknown[][]): ImportParseResult {
  const empty = (r: unknown[]) => r.every((c) => String(c ?? "").trim() === "");
  // Guarda a linha original da planilha (as vazias contam para o número exibido).
  const indexed = matrix.map((r, idx) => ({ r, line: idx + 1 })).filter(({ r }) => Array.isArray(r) && !empty(r));
  const data = indexed.map((x) => x.r);
  if (data.length === 0) return { rows: [], errors: [], missingColumns: REQUIRED.map((k) => LABEL[k]) };

  const header = data[0].map(norm);
  const col: Partial<Record<keyof ImportRow, number>> = {};
  for (const key of Object.keys(ALIASES) as Array<keyof ImportRow>) {
    const idx = header.findIndex((h) => ALIASES[key].includes(h));
    if (idx >= 0) col[key] = idx;
  }
  const missingColumns = REQUIRED.filter((k) => col[k] === undefined).map((k) => LABEL[k]);
  if (missingColumns.length > 0) return { rows: [], errors: [], missingColumns };

  const rows: ImportRow[] = [];
  const errors: ImportParseError[] = [];
  const seenMat = new Set<string>();
  const seenMail = new Set<string>();
  indexed.slice(1).forEach(({ r, line }) => {
    const nome = String(r[col.nome_completo!] ?? "").trim();
    const email = String(r[col.email!] ?? "").trim().toLowerCase();
    const matricula = String(r[col.matricula!] ?? "").trim();
    const posto = col.posto !== undefined ? String(r[col.posto] ?? "").trim() : "";
    const problems: string[] = [];
    if (nome.length < 2) problems.push("nome ausente");
    else if (nome.length > 200) problems.push("nome muito longo");
    else if (FORMULA_RE.test(nome)) problems.push("nome não pode começar com = + - @");
    if (!EMAIL_RE.test(email) || email.length > 254) problems.push("e-mail inválido");
    if (posto.length > 60) problems.push("posto muito longo");
    else if (FORMULA_RE.test(posto)) problems.push("posto não pode começar com = + - @");
    if (!matricula || !MATRICULA_RE.test(matricula) || matricula.length > 30) problems.push("matrícula inválida");
    if (problems.length === 0 && (seenMat.has(matricula.toLowerCase()) || seenMail.has(email))) problems.push("matrícula ou e-mail repetido no arquivo");
    if (problems.length > 0) { errors.push({ line, message: problems.join(", ") }); return; }
    seenMat.add(matricula.toLowerCase()); seenMail.add(email);
    rows.push({ nome_completo: nome, email, matricula, posto: posto || null });
  });
  return { rows, errors, missingColumns: [] };
}

/** Lê .csv ou .xlsx (primeira planilha) no navegador. */
export async function parseImportFile(file: File): Promise<ImportParseResult> {
  if (file.size > IMPORT_FILE_MAX_BYTES) throw new Error("file_too_large");
  const { read, utils } = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = read(buf, { type: "array", raw: true, codepage: 65001 });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { rows: [], errors: [], missingColumns: REQUIRED.map((k) => LABEL[k]) };
  const matrix = utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
  if (matrix.length > IMPORT_TOTAL_MAX_ROWS + 1) throw new Error("too_many_rows");
  return parseImportMatrix(matrix);
}

/** Modelo de planilha para download (CSV, com BOM para o Excel). */
export const IMPORT_TEMPLATE_CSV = "﻿nome;email;matricula;posto\nFulano de Tal;fulano@exemplo.com;1234567;Soldado\n";
