import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Normaliza CRLF→LF: mesmo racional do idor-write-scope.test.ts — um
// checkout Windows com core.autocrlf=true materializa as rotas com CRLF, o
// que quebra comparação por índice/.includes() por causa da quebra de
// linha, não por regressão real.
const route = (name: string) =>
  readFileSync(resolve(process.cwd(), "src", "routes", name), "utf8").replace(/\r\n/g, "\n");

function sliceBetween(file: string, startMarker: string, endMarker: string, label: string): string {
  const start = file.indexOf(startMarker);
  assert.ok(start > -1, `could not locate start marker for ${label}: ${startMarker}`);
  const end = file.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `could not locate end marker for ${label}: ${endMarker}`);
  return file.slice(start, end);
}

// Regressão real de produção (2026-07-21, matrícula 000003): uma saída de
// armamento registrada pela tela real "Nova Saída" (apps/web/.../saidas/nova/_form.tsx,
// que chama POST /api/lendings/batch) não apareceu na linha do tempo do
// Livro Digital do turno ativo do armeiro. Causa raiz: POST /api/lendings/batch
// nunca chamava logShiftEvent — só a rota singular legada POST /api/lendings/
// (não usada por nenhuma tela de produção, só por e2e) tinha a chamada, e
// ainda assim com o eventType errado ("cautela_emitida" em vez de
// "saida_autorizada"). O mesmo gap existia em POST /api/lendings/bulk-return
// (rota real da devolução, usada por _desarmamento-modal.tsx).
//
// Estes testes são assertivos por posição de string (mesmo padrão de
// idor-write-scope.test.ts) porque esta suíte roda sem banco real — o
// objetivo é travar a regressão de "rota de custódia sem integração com o
// Livro Digital" no nível de código-fonte, não reexecutar a lógica.
describe("Livro Digital — logShiftEvent deve estar amarrado nas rotas reais de custódia", () => {
  it("POST /api/lendings/batch (rota real de saída) chama logShiftEvent com saida_autorizada", () => {
    const file = route("lendings.ts");
    const handler = sliceBetween(
      file,
      'lendingRoutes.post(\n  "/batch",',
      'lendingRoutes.post(\n  "/",',
      "POST /api/lendings/batch",
    );
    assert.ok(
      handler.includes("logShiftEvent("),
      "POST /api/lendings/batch precisa chamar logShiftEvent — sem isso, saídas registradas pela tela 'Nova Saída' nunca aparecem na linha do tempo do turno ativo do armeiro",
    );
    assert.ok(
      handler.includes('eventType: "saida_autorizada"'),
      "POST /api/lendings/batch deve logar eventType saida_autorizada (não cautela_emitida — lendings e cautelamentos são fluxos distintos)",
    );
  });

  it("POST /api/lendings/bulk-return (rota real de devolução) chama logShiftEvent com saida_devolvida", () => {
    const file = route("lendings.ts");
    const handler = sliceBetween(
      file,
      'lendingRoutes.post(\n  "/bulk-return",',
      'lendingRoutes.patch(\n  "/:id/return",',
      "POST /api/lendings/bulk-return",
    );
    assert.ok(
      handler.includes("logShiftEvent("),
      "POST /api/lendings/bulk-return precisa chamar logShiftEvent — sem isso, devoluções registradas pelo modal de desarmamento nunca aparecem no Livro Digital",
    );
    assert.ok(
      handler.includes('eventType: "saida_devolvida"'),
      "POST /api/lendings/bulk-return deve logar eventType saida_devolvida",
    );
    assert.ok(
      handler.includes('"SHIFT_REQUIRED"'),
      "POST /api/lendings/bulk-return deve exigir turno ativo do armeiro (mesmo guard de /batch e POST /) — sem isso, devoluções sem turno aberto nunca geram evento no Livro Digital, silenciosamente",
    );
  });

  it("POST /api/cautelamentos (emissão e devolução) continua chamando logShiftEvent", () => {
    const file = route("cautelamentos.ts");
    assert.ok(file.includes('eventType: "cautela_emitida"'), "cautelamentos deve continuar logando cautela_emitida");
    assert.ok(file.includes('eventType: "cautela_devolvida"'), "cautelamentos deve continuar logando cautela_devolvida");
  });

  it("PATCH /api/ocorrencias/:id continua chamando logShiftEvent ao resolver/improceder", () => {
    const file = route("ocorrencias.ts");
    assert.ok(file.includes('eventType: "ocorrencia_registrada"'), "ocorrencias deve continuar logando ocorrencia_registrada");
  });
});
