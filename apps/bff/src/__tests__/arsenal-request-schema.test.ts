import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { RequestSchema, materialPhotoPathSchema } from "../lib/arsenal-request-schema.ts";

// Bug real de produção reportado pelo usuário (armeiro, 2026-08-27): TODA
// solicitação de adição de material COM foto falhava com 400 ZodError —
// sem foto, funcionava normal. Causa raiz: `photo_url` aqui recebe o path
// relativo devolvido por POST /api/arsenal/material-photo (bucket privado
// material-photos, ex: "materials/<uuid>.webp") — NUNCA uma URL pública,
// mesmo padrão já documentado em OcorrenciaSchema.foto_url neste mesmo
// arquivo — mas o schema usava `z.string().url()`, que rejeita qualquer
// path relativo. Sem teste nenhum cobrindo isso antes (achado do usuário:
// "não teve testes?" — não tinha).
const RELATIVE_PHOTO_PATH = "materials/3fbe9e0a-1a2b-4c3d-9e0f-1a2b3c4d5e6f.webp";
const LEGACY_PUBLIC_URL = "https://jepitcrkicwmvzrmllpn.supabase.co/storage/v1/object/public/material-photos/materials/legacy.webp";

function baseBatchItem(overrides: Record<string, unknown> = {}) {
  return {
    nome: "Colete balístico",
    categoria: "equipamento",
    quantidade_total: 5,
    ...overrides,
  };
}

function read(path: string) {
  const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
  return readFileSync(resolve(repositoryRoot, path), "utf8").replace(/\r\n/g, "\n");
}

describe("RequestSchema (POST /api/arsenal/requests) — regressão de photo_url", () => {
  it("aceita photo_url como path relativo do Storage, no item de topo (fluxo de item único)", () => {
    const result = RequestSchema.safeParse({
      type: "material_addition",
      nome: "Colete balístico",
      categoria: "equipamento",
      quantidade_total: 5,
      photo_url: RELATIVE_PHOTO_PATH,
    });
    assert.equal(result.success, true, JSON.stringify(result.success ? null : result.error.issues));
  });

  it("aceita photo_url como path relativo do Storage, dentro de batch[] (fluxo real usado por material-detail-sheet.tsx)", () => {
    const result = RequestSchema.safeParse({
      type: "material_addition",
      batch: [baseBatchItem({ photo_url: RELATIVE_PHOTO_PATH })],
    });
    assert.equal(result.success, true, JSON.stringify(result.success ? null : result.error.issues));
  });

  it("sem foto (photo_url ausente) continua funcionando — não regride o caminho que já passava", () => {
    const result = RequestSchema.safeParse({
      type: "material_addition",
      batch: [baseBatchItem()],
    });
    assert.equal(result.success, true, JSON.stringify(result.success ? null : result.error.issues));
  });

  it("continua rejeitando photo_url vazio (string vazia não é um path válido)", () => {
    const result = RequestSchema.safeParse({
      type: "material_addition",
      batch: [baseBatchItem({ photo_url: "" })],
    });
    assert.equal(result.success, false);
  });

  it("continua rejeitando photo_url que não seja string (ex: number)", () => {
    const result = RequestSchema.safeParse({
      type: "material_addition",
      batch: [baseBatchItem({ photo_url: 12345 })],
    });
    assert.equal(result.success, false);
  });

  // Achado MÉDIO de code review (revisão do fix): faltavam os limites do
  // teto de tamanho e o formato legado suportado por resolvePhotoUrl.
  it("aceita exatamente 500 caracteres (limite superior)", () => {
    const path = "materials/" + "a".repeat(490); // 10 + 490 = 500
    assert.equal(path.length, 500);
    const result = RequestSchema.safeParse({
      type: "material_addition",
      batch: [baseBatchItem({ photo_url: path })],
    });
    assert.equal(result.success, true, JSON.stringify(result.success ? null : result.error.issues));
  });

  it("rejeita 501 caracteres (acima do limite)", () => {
    const path = "materials/" + "a".repeat(491); // 501
    const result = RequestSchema.safeParse({
      type: "material_addition",
      batch: [baseBatchItem({ photo_url: path })],
    });
    assert.equal(result.success, false);
  });

  it("aceita URL pública legada completa — formato documentado e suportado por apps/web/src/lib/storage.ts (resolvePhotoUrl)", () => {
    const result = RequestSchema.safeParse({
      type: "material_addition",
      batch: [baseBatchItem({ photo_url: LEGACY_PUBLIC_URL })],
    });
    assert.equal(result.success, true, JSON.stringify(result.success ? null : result.error.issues));
  });
});

// Achado CRÍTICO/ALTO de code review (revisão do fix de photo_url): a
// política de storage.objects do bucket material-photos (migration
// 20260629000001_fix_rls_security_audit.sql) permite QUALQUER usuário
// autenticado (de qualquer tenant) ler qualquer objeto — sem isolamento por
// tenant. Antes deste fix, o bug de `.url()` acidentalmente blindava esse
// problema (upload real sempre falhava, então nenhum path relativo real
// chegava a ser persistido por este fluxo). Corrigindo o bug de verdade
// (photo_url precisa funcionar), a mitigação de curto prazo aplicada é
// bloquear path traversal/injeção de controle — não resolve o isolamento
// por tenant da RLS em si (fix maior, pendente, requer migração de dado
// existente — ver discussão registrada no PR/CHANGELOG).
describe("materialPhotoPathSchema — hardening contra path traversal e injeção", () => {
  it("rejeita path com '..' (tentativa de escapar do prefixo materials/)", () => {
    const result = materialPhotoPathSchema.safeParse("materials/../../../etc/passwd");
    assert.equal(result.success, false);
  });

  it("rejeita path com newline/carriage-return/null byte embutido", () => {
    for (const bad of ["materials/x.webp\n", "materials/x.webp\r", "materials/x\0.webp"]) {
      const result = materialPhotoPathSchema.safeParse(bad);
      assert.equal(result.success, false, `deveria rejeitar: ${JSON.stringify(bad)}`);
    }
  });

  it("aceita path relativo normal", () => {
    const result = materialPhotoPathSchema.safeParse(RELATIVE_PHOTO_PATH);
    assert.equal(result.success, true);
  });
});

// Achado MÉDIO de code review: o teste acima prova que o SCHEMA aceita path
// relativo, mas não prova que routes/arsenal.ts de fato usa este exato
// schema no zValidator da rota /requests — mesmo padrão de leitura estática
// já usado em profile-photo-static-harness.test.ts, pra blindar wiring que
// teste unitário de lógica pura não alcança (ex: alguém reintroduzir um
// RequestSchema inline divergente por engano num merge confuso).
describe("wiring estático — routes/arsenal.ts usa o RequestSchema extraído de verdade", () => {
  it("importa RequestSchema/materialPhotoPathSchema de lib/arsenal-request-schema", () => {
    const source = read("apps/bff/src/routes/arsenal.ts");
    assert.match(source, /import \{ RequestSchema, materialPhotoPathSchema \} from ["']\.\.\/lib\/arsenal-request-schema["']/);
  });

  it("POST /requests valida com RequestSchema (não um schema inline divergente)", () => {
    const source = read("apps/bff/src/routes/arsenal.ts");
    assert.match(source, /zValidator\("json",\s*RequestSchema\)/);
  });

  it("OcorrenciaSchema.foto_url usa materialPhotoPathSchema (SSOT), não um z.string().url()/min/max copiado à mão", () => {
    const source = read("apps/bff/src/routes/arsenal.ts");
    assert.match(source, /foto_url:\s*materialPhotoPathSchema\.optional\(\)/);
    // Regressão específica do bug original: nenhum z.string().url() deve
    // voltar a aparecer neste arquivo pra um campo de foto de material.
    assert.equal(/photo_url:\s*z\.string\(\)\.url\(\)/.test(source), false);
  });
});
