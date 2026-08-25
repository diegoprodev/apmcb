// Vive em __tests__/integration/ (não em __tests__/ direto) pelo mesmo
// motivo de auth-me-real-handler.test.ts: pdf-theme.ts importa
// services/supabase.ts sem extensão de arquivo, e `node --experimental-
// strip-types` (usado por `npm test`) não resolve isso — só bun (runtime
// real do projeto) resolve. Os testes abaixo são unitários de verdade
// (funções puras, sem tocar banco) apesar de rodarem via `test:integration`.
//
// TODO: falta cobertura para loadTenantBranding() em si (a função que
// recebeu o fix de code review "erro do Supabase agora é logado em vez de
// descartado silenciosamente") — precisaria mockar
// supabase.from(...).select(...).eq(...).maybeSingle() para simular
// {data:null, error:{message}} e verificar que loga via logger.error e cai
// nos defaults. Não implementado agora porque o client `supabase` é um
// singleton instanciado no module scope de services/supabase.ts (não
// injetável sem refatorar a assinatura da função) — resolver quando a
// integração nos 5 geradores (próxima fase) tornar essa função crítica o
// bastante para justificar o refactor de testabilidade.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { hexToRgb, tint, truncateToWidth, drawTable, type TenantBranding } from "../../lib/pdf/pdf-theme.ts";

describe("hexToRgb", () => {
  it("converte hex minúsculo corretamente", () => {
    const c = hexToRgb("#000000");
    assert.equal(c.red, 0);
    assert.equal(c.green, 0);
    assert.equal(c.blue, 0);
  });

  it("converte hex maiúsculo corretamente (case-insensitive)", () => {
    const c = hexToRgb("#FFFFFF");
    assert.equal(c.red, 1);
    assert.equal(c.green, 1);
    assert.equal(c.blue, 1);
  });

  it("funciona sem o '#' inicial", () => {
    const c = hexToRgb("3b82f6");
    assert.ok(c.red > 0 && c.red < 1);
  });

  it("lança erro para hex com menos de 6 dígitos", () => {
    assert.throws(() => hexToRgb("#fff"), /não é um hex de 6 dígitos válido/);
  });

  it("lança erro para hex com caracteres inválidos", () => {
    assert.throws(() => hexToRgb("#zzzzzz"), /não é um hex de 6 dígitos válido/);
  });
});

describe("tint", () => {
  it("amount=0 retorna a cor original inalterada", () => {
    const original = hexToRgb("#0f172a");
    const result = tint(original, 0);
    assert.equal(result.red, original.red);
    assert.equal(result.green, original.green);
    assert.equal(result.blue, original.blue);
  });

  it("amount=1 retorna branco puro", () => {
    const result = tint(hexToRgb("#0f172a"), 1);
    assert.equal(result.red, 1);
    assert.equal(result.green, 1);
    assert.equal(result.blue, 1);
  });

  it("amount intermediário fica estritamente entre a cor original e branco", () => {
    const original = hexToRgb("#000000");
    const result = tint(original, 0.5);
    assert.ok(result.red > 0 && result.red < 1);
  });
});

describe("truncateToWidth", () => {
  let font: PDFFont;

  before(async () => {
    const pdf = await PDFDocument.create();
    font = await pdf.embedFont(StandardFonts.Helvetica);
  });

  it("string que cabe na largura retorna inalterada", () => {
    const result = truncateToWidth("abc", font, 10, 1000);
    assert.equal(result, "abc");
  });

  it("string vazia retorna vazia", () => {
    const result = truncateToWidth("", font, 10, 1000);
    assert.equal(result, "");
  });

  it("string que não cabe é truncada com reticências", () => {
    const long = "Este é um texto bem longo que certamente não cabe";
    const result = truncateToWidth(long, font, 10, 60);
    assert.ok(result.endsWith("…"));
    assert.ok(result.length < long.length);
    assert.ok(font.widthOfTextAtSize(result, 10) <= 60);
  });

  it("maxWidth menor que um caractere não trava em loop infinito — retorna só reticências", () => {
    const result = truncateToWidth("qualquer coisa", font, 10, 1);
    assert.equal(result, "…");
  });
});

describe("drawTable", () => {
  const branding: TenantBranding = {
    primaryColor: hexToRgb("#0f172a"),
    secondaryColor: hexToRgb("#3b82f6"),
    primaryHex: "#0f172a",
    secondaryHex: "#3b82f6",
    logoBytes: null,
    logoIsJpg: false,
  };
  let fonts: { regular: PDFFont; medium: PDFFont; bold: PDFFont };
  let pdf: PDFDocument;

  before(async () => {
    pdf = await PDFDocument.create();
    const f = await pdf.embedFont(StandardFonts.Helvetica);
    const b = await pdf.embedFont(StandardFonts.HelveticaBold);
    fonts = { regular: f, medium: f, bold: b };
  });

  it("lança erro se newPageStartY - minY for menor que rowHeight (config inconsistente)", () => {
    const page = pdf.addPage([595, 842]);
    assert.throws(
      () => drawTable({
        page, x: 50, y: 700, width: 495,
        columns: [{ key: "a", label: "A", width: 495 }],
        rows: [{ cells: { a: "1" } }],
        rowHeight: 16, fonts, branding,
        minY: 100, newPage: () => pdf.addPage([595, 842]), newPageStartY: 105,
      }),
      /não cabe nem uma linha em página nova/
    );
  });

  it("não pagina quando todas as linhas cabem no espaço disponível", () => {
    const page = pdf.addPage([595, 842]);
    let newPageCalls = 0;
    const result = drawTable({
      page, x: 50, y: 700, width: 495,
      columns: [{ key: "a", label: "A", width: 495 }],
      rows: [{ cells: { a: "1" } }, { cells: { a: "2" } }],
      rowHeight: 16, fonts, branding,
      minY: 100, newPage: () => { newPageCalls++; return pdf.addPage([595, 842]); }, newPageStartY: 792,
    });
    assert.equal(newPageCalls, 0);
    assert.equal(result.page, page);
  });

  it("pagina quando uma linha ultrapassaria minY", () => {
    const page = pdf.addPage([595, 842]);
    let newPageCalls = 0;
    let newPage: PDFPage | undefined;
    const result = drawTable({
      page, x: 50, y: 115, width: 495, // só ~1 linha de espaço antes de minY
      columns: [{ key: "a", label: "A", width: 495 }],
      rows: [{ cells: { a: "1" } }, { cells: { a: "2" } }, { cells: { a: "3" } }],
      rowHeight: 16, fonts, branding,
      minY: 100, newPage: () => { newPageCalls++; newPage = pdf.addPage([595, 842]); return newPage; }, newPageStartY: 792,
    });
    assert.ok(newPageCalls >= 1, "deveria ter paginado pelo menos uma vez");
    assert.equal(result.page, newPage);
  });

  it("linha com 'detail' ocupa o dobro da altura (2x rowHeight)", () => {
    const page = pdf.addPage([595, 842]);
    const result = drawTable({
      page, x: 50, y: 700, width: 495,
      columns: [{ key: "a", label: "A", width: 495 }],
      rows: [{ cells: { a: "1" }, detail: "detalhe extra" }],
      rowHeight: 16, fonts, branding,
      minY: 100, newPage: () => pdf.addPage([595, 842]), newPageStartY: 792,
    });
    // y inicial 700, menos rowHeight do cabeçalho (16), menos 2x rowHeight da linha com detail
    assert.equal(result.y, 700 - 16 - 32);
  });
});
