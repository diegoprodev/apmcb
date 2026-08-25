// Vive em __tests__/integration/ (não em __tests__/ direto) pelo mesmo
// motivo de auth-me-real-handler.test.ts: pdf-theme.ts importa
// services/supabase.ts sem extensão de arquivo, e `node --experimental-
// strip-types` (usado por `npm test`) não resolve isso — só bun (runtime
// real do projeto) resolve. Os testes abaixo são unitários de verdade
// (funções puras, sem tocar banco) apesar de rodarem via `test:integration`.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { hexToRgb, tint, truncateToWidth, drawTable, sanitizeText, loadTenantBranding, wrapText, fieldMultiline, ensureSpace, drawHeader, type TenantBranding } from "../../lib/pdf/pdf-theme.ts";

// PNG 1x1 transparente válido — só precisa ser aceito por pdf.embedPng(),
// conteúdo visual é irrelevante pros testes de cache abaixo.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

// Mock mínimo do client Supabase — loadTenantBranding recebe um segundo
// parâmetro opcional `client` justamente para permitir isto (achado de code
// review: a função não tinha nenhum teste cobrindo o branch de erro, que é
// o branch que o fix "loga em vez de descartar silenciosamente" adicionou).
function mockSupabase(result: { data: unknown; error: { message: string } | null }) {
  const calls: { table?: string; column?: string; tenantId?: string } = {};
  return {
    calls,
    client: {
      from(table: string) {
        calls.table = table;
        return {
          select() {
            return this;
          },
          eq(col: string, val: string) {
            calls.column = col;
            calls.tenantId = val;
            return this;
          },
          async maybeSingle() {
            return result;
          },
        };
      },
    } as unknown as Parameters<typeof loadTenantBranding>[1],
  };
}

describe("loadTenantBranding", () => {
  it("tenantId nulo/undefined não consulta o banco e devolve defaults", async () => {
    const { client, calls } = mockSupabase({ data: null, error: null });
    const branding = await loadTenantBranding(null, client);
    assert.equal(calls.table, undefined, "não deveria ter chamado o client");
    assert.equal(branding.primaryHex, "#0f172a");
    assert.equal(branding.secondaryHex, "#3b82f6");
    // Sem logo do tenant, cai no PNG estático de fallback (não null) —
    // mesmo comportamento de loadLogoBytes(null) já coberto indiretamente
    // pelos testes visuais desta fase.
    assert.ok(branding.logoBytes, "deveria ter carregado o logo de fallback estático");
  });

  it("erro do Supabase cai nos defaults (sem lançar) — branch do fix de code review", async () => {
    const { client } = mockSupabase({ data: null, error: { message: "connection timeout" } });
    const branding = await loadTenantBranding("tenant-1", client);
    assert.equal(branding.primaryHex, "#0f172a");
    assert.equal(branding.secondaryHex, "#3b82f6");
  });

  it("tenant sem linha em tenant_branding (data null, sem erro) cai nos defaults", async () => {
    const { client } = mockSupabase({ data: null, error: null });
    const branding = await loadTenantBranding("tenant-2", client);
    assert.equal(branding.primaryHex, "#0f172a");
    assert.equal(branding.secondaryHex, "#3b82f6");
  });

  it("dados presentes: usa a cor do tenant, não os defaults", async () => {
    const { client } = mockSupabase({
      data: { primary_hex: "#7c2d12", secondary_hex: "#f59e0b", tenant_logo_url: null, reserve_logo_url: null },
      error: null,
    });
    const branding = await loadTenantBranding("tenant-3", client);
    assert.equal(branding.primaryHex, "#7c2d12");
    assert.equal(branding.secondaryHex, "#f59e0b");
  });

  it("prioridade de logo: reserve_logo_url vence quando ambos presentes", async () => {
    const { client } = mockSupabase({
      data: { primary_hex: "#0f172a", secondary_hex: "#3b82f6", tenant_logo_url: "https://x/tenant.png", reserve_logo_url: "https://x/reserve.png" },
      error: null,
    });
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response(null, { status: 404 });
    }) as typeof fetch;
    try {
      await loadTenantBranding("tenant-4", client);
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.deepEqual(requestedUrls, ["https://x/reserve.png"], "deveria ter tentado buscar reserve_logo_url, não tenant_logo_url");
  });

  it("prioridade de logo: cai para tenant_logo_url quando reserve_logo_url ausente", async () => {
    const { client } = mockSupabase({
      data: { primary_hex: "#0f172a", secondary_hex: "#3b82f6", tenant_logo_url: "https://x/tenant.png", reserve_logo_url: null },
      error: null,
    });
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response(null, { status: 404 });
    }) as typeof fetch;
    try {
      await loadTenantBranding("tenant-5", client);
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.deepEqual(requestedUrls, ["https://x/tenant.png"]);
  });

  it("passa o tenantId correto para .eq() filtrando pela coluna tenant_id", async () => {
    const { client, calls } = mockSupabase({ data: null, error: null });
    await loadTenantBranding("tenant-xyz", client);
    assert.equal(calls.table, "tenant_branding");
    assert.equal(calls.column, "tenant_id", "deveria filtrar pela coluna tenant_id, não outra");
    assert.equal(calls.tenantId, "tenant-xyz");
  });
});

describe("sanitizeText", () => {
  it("preserva letras acentuadas, dígitos e pontuação pt-BR", () => {
    const input = "Situação: 128 itens, cautela nº 3 — em análise (ok).";
    assert.equal(sanitizeText(input), input);
  });

  it("substitui emoji por '?'", () => {
    const result = sanitizeText("faltou energia 😀 na reserva");
    assert.ok(!result.includes("😀"));
    assert.ok(result.includes("?"));
  });

  it("string vazia retorna vazia", () => {
    assert.equal(sanitizeText(""), "");
  });

  it("string só de emoji vira só '?'", () => {
    assert.equal(sanitizeText("🎉🎊"), "??");
  });
});

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

describe("wrapText", () => {
  let font: PDFFont;

  before(async () => {
    const pdf = await PDFDocument.create();
    font = await pdf.embedFont(StandardFonts.Helvetica);
  });

  it("texto curto vira 1 linha só", () => {
    const lines = wrapText("abc def", font, 9, 500, 3);
    assert.deepEqual(lines, ["abc def"]);
  });

  it("string vazia retorna array vazio", () => {
    assert.deepEqual(wrapText("", font, 9, 500, 3), []);
  });

  it("texto que preenche exatamente maxLines sem sobra não trunca a última linha", () => {
    // 3 palavras que não cabem juntas na mesma linha (maxWidth pequeno o
    // bastante pra forçar 1 palavra por linha), maxLines=3 — nada deveria
    // ficar de fora, então a última linha não deve ganhar "…".
    const w = font.widthOfTextAtSize("palavra", 9);
    const lines = wrapText("palavra palavra palavra", font, 9, w + 2, 3);
    assert.equal(lines.length, 3);
    assert.ok(!lines[2].includes("…"), "não deveria truncar quando tudo coube");
  });

  it("texto que excede maxLines trunca a última linha com reticências", () => {
    const w = font.widthOfTextAtSize("palavra", 9);
    const lines = wrapText("palavra palavra palavra palavra palavra", font, 9, w + 2, 3);
    assert.equal(lines.length, 3);
    assert.ok(lines[2].includes("…"), "deveria sinalizar que sobrou conteúdo");
  });

  it("achado de code review: uma única palavra maior que maxWidth não vaza da coluna — é fragmentada em várias linhas", () => {
    const longToken = "a".repeat(200); // ex: hash/URL sem espaço
    const maxWidth = 100;
    const lines = wrapText(longToken, font, 9, maxWidth, 5);
    assert.ok(lines.length > 1, "deveria ter fragmentado o token em múltiplas linhas");
    for (const line of lines) {
      const w = font.widthOfTextAtSize(line, 9);
      assert.ok(w <= maxWidth, `linha "${line}" (${w}pt) ultrapassa maxWidth (${maxWidth}pt)`);
    }
  });

  it("palavra gigante cercada de texto normal: nem a palavra gigante nem as vizinhas vazam", () => {
    const longToken = "b".repeat(150);
    const maxWidth = 80;
    const lines = wrapText(`antes ${longToken} depois`, font, 9, maxWidth, 6);
    for (const line of lines) {
      assert.ok(font.widthOfTextAtSize(line, 9) <= maxWidth, `linha "${line}" ultrapassa maxWidth`);
    }
  });

  it("respeita maxLines mesmo quando a palavra gigante sozinha precisaria de mais linhas", () => {
    const longToken = "c".repeat(500);
    const lines = wrapText(longToken, font, 9, 50, 2);
    assert.equal(lines.length, 2);
    for (const line of lines) {
      assert.ok(font.widthOfTextAtSize(line, 9) <= 50);
    }
  });
});

describe("fieldMultiline", () => {
  let pdf: PDFDocument;
  let fonts: { regular: PDFFont; medium: PDFFont; bold: PDFFont };

  before(async () => {
    pdf = await PDFDocument.create();
    const f = await pdf.embedFont(StandardFonts.Helvetica);
    const b = await pdf.embedFont(StandardFonts.HelveticaBold);
    fonts = { regular: f, medium: f, bold: b };
  });

  it("retorna um y menor a cada linha desenhada (avança verticalmente)", () => {
    const page = pdf.addPage([595, 842]);
    const longText = "Motivo de teste ".repeat(20); // força múltiplas linhas
    const y = fieldMultiline(page, { label: "Motivo", value: longText, y: 700, margin: 50, width: 495, fonts });
    assert.ok(y < 700, "y deveria ter avançado (diminuído) após desenhar o campo");
  });

  it("texto curto ainda avança pelo menos 1 linha", () => {
    const page = pdf.addPage([595, 842]);
    const y = fieldMultiline(page, { label: "Motivo", value: "curto", y: 700, margin: 50, width: 495, fonts });
    assert.ok(y < 700);
  });
});

describe("ensureSpace", () => {
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

  const makeOpts = () => ({ minY: 140, continuationTitle: "Continuação de teste", margin: 50, branding, fonts });

  it("não pagina quando o bloco cabe no espaço restante", () => {
    const page = pdf.addPage([595, 842]);
    const cursor = ensureSpace(pdf, { page, y: 700 }, 50, makeOpts());
    assert.equal(cursor.page, page, "não deveria ter criado página nova");
    assert.equal(cursor.y, 700, "y não deveria mudar quando não pagina");
  });

  it("pagina quando o bloco não cabe, criando página nova com y reiniciado", () => {
    const page = pdf.addPage([595, 842]);
    const before = pdf.getPageCount();
    const opts = makeOpts();
    const cursor = ensureSpace(pdf, { page, y: 160 }, 50, opts);
    assert.notEqual(cursor.page, page, "deveria ter criado página nova");
    assert.equal(pdf.getPageCount(), before + 1);
    assert.ok(cursor.y > opts.minY, "y da página nova deveria estar bem acima de minY");
  });

  it("no limite exato (y - needed === minY) não pagina", () => {
    const page = pdf.addPage([595, 842]);
    const cursor = ensureSpace(pdf, { page, y: 190 }, 50, makeOpts()); // 190-50=140=minY
    assert.equal(cursor.page, page, "no limite exato ainda cabe, não deveria paginar");
  });

  it("logo abaixo do limite (y - needed === minY - 1) pagina", () => {
    const page = pdf.addPage([595, 842]);
    const cursor = ensureSpace(pdf, { page, y: 189 }, 50, makeOpts()); // 189-50=139<140
    assert.notEqual(cursor.page, page, "1pt abaixo do limite já deveria paginar");
  });
});

// Achado de code review (retrofit de inventory-pdf.ts, único gerador que
// chama drawHeader mais de uma vez no mesmo PDFDocument): a primeira versão
// do cache de logo declarava WeakMap<PDFDocument, PDFImage|null> mas nunca
// de fato gravava `null` no branch de falha (o catch acontecia antes do
// set()), e chaveava só pelo PDFDocument, ignorando os bytes do branding —
// os 4 testes abaixo cobrem exatamente os 2 bugs e os 2 comportamentos que
// a documentação do cache afirma.
describe("drawHeader — cache de logo", () => {
  const brandingFor = (logoBytes: Buffer | null): TenantBranding => ({
    primaryColor: hexToRgb("#0f172a"),
    secondaryColor: hexToRgb("#3b82f6"),
    primaryHex: "#0f172a",
    secondaryHex: "#3b82f6",
    logoBytes,
    logoIsJpg: false,
  });

  let fonts: { regular: PDFFont; medium: PDFFont; bold: PDFFont };
  before(async () => {
    const p = await PDFDocument.create();
    const f = await p.embedFont(StandardFonts.Helvetica);
    const b = await p.embedFont(StandardFonts.HelveticaBold);
    fonts = { regular: f, medium: f, bold: b };
  });

  it("N chamadas de drawHeader no mesmo documento com o mesmo branding embutem o logo só 1x", async () => {
    const pdf = await PDFDocument.create();
    let embedCalls = 0;
    const originalEmbedPng = pdf.embedPng.bind(pdf);
    pdf.embedPng = (async (bytes: Uint8Array | ArrayBuffer) => {
      embedCalls++;
      return originalEmbedPng(bytes);
    }) as typeof pdf.embedPng;

    const branding = brandingFor(TINY_PNG);
    for (let i = 0; i < 3; i++) {
      const page = pdf.addPage([595, 842]);
      await drawHeader(pdf, page, { title: `Reserva ${i}`, margin: 40, branding, fonts });
    }
    assert.equal(embedCalls, 1, "deveria ter embutido o logo uma única vez para 3 chamadas no mesmo doc");
  });

  it("documentos distintos não compartilham o cache", async () => {
    const branding = brandingFor(TINY_PNG);

    const pdfA = await PDFDocument.create();
    let callsA = 0;
    const embedA = pdfA.embedPng.bind(pdfA);
    pdfA.embedPng = (async (bytes: Uint8Array | ArrayBuffer) => { callsA++; return embedA(bytes); }) as typeof pdfA.embedPng;
    await drawHeader(pdfA, pdfA.addPage([595, 842]), { title: "A", margin: 40, branding, fonts });

    const pdfB = await PDFDocument.create();
    let callsB = 0;
    const embedB = pdfB.embedPng.bind(pdfB);
    pdfB.embedPng = (async (bytes: Uint8Array | ArrayBuffer) => { callsB++; return embedB(bytes); }) as typeof pdfB.embedPng;
    await drawHeader(pdfB, pdfB.addPage([595, 842]), { title: "B", margin: 40, branding, fonts });

    assert.equal(callsA, 1);
    assert.equal(callsB, 1, "documento novo não deveria herdar o cache do documento anterior");
  });

  it("falha de embed é memoizada — não tenta reembutir um logo corrompido a cada chamada", async () => {
    const pdf = await PDFDocument.create();
    let embedCalls = 0;
    pdf.embedPng = (async () => {
      embedCalls++;
      throw new Error("PNG corrompido");
    }) as typeof pdf.embedPng;

    const branding = brandingFor(TINY_PNG);
    for (let i = 0; i < 3; i++) {
      const page = pdf.addPage([595, 842]);
      // não deve lançar — mesma tolerância de "segue sem logo" de sempre
      await drawHeader(pdf, page, { title: `Reserva ${i}`, margin: 40, branding, fonts });
    }
    assert.equal(embedCalls, 1, "só deveria ter tentado embutir 1x — falha memoizada, sem retry nas chamadas seguintes");
  });

  it("brandings com bytes de logo diferentes no mesmo documento não reusam o cache um do outro", async () => {
    const pdf = await PDFDocument.create();
    let embedCalls = 0;
    const originalEmbedPng = pdf.embedPng.bind(pdf);
    pdf.embedPng = (async (bytes: Uint8Array | ArrayBuffer) => {
      embedCalls++;
      return originalEmbedPng(bytes);
    }) as typeof pdf.embedPng;

    const brandingA = brandingFor(Buffer.from(TINY_PNG)); // cópia — referência distinta, mesmo conteúdo
    const brandingB = brandingFor(Buffer.from(TINY_PNG));

    await drawHeader(pdf, pdf.addPage([595, 842]), { title: "A", margin: 40, branding: brandingA, fonts });
    await drawHeader(pdf, pdf.addPage([595, 842]), { title: "B", margin: 40, branding: brandingB, fonts });

    assert.equal(embedCalls, 2, "bytes com referências distintas não deveriam compartilhar entrada de cache");
  });
});
