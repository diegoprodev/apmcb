import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(process.cwd(), "..", "..");
const read = (relPath: string) => readFileSync(resolve(repoRoot, relPath), "utf8");

// Regressão do incidente de 502/CORS em POST /api/session/mode: nginx
// (sempre na frente do BFF em produção) e o Hono secureHeaders() do BFF
// definiam X-Frame-Options/Strict-Transport-Security/Referrer-Policy com
// valores DIVERGENTES na mesma resposta — comportamento indefinido no
// browser. A correção final: Hono mantém os DEFAULTS de secureHeaders()
// intactos (protege acesso direto ao BFF sem nginx, ex: dev local em
// localhost:3001); nginx usa proxy_hide_header pra remover a versão do
// Hono desses 3 headers ANTES de adicionar a sua própria via add_header.
// Este teste documenta essa decisão de forma executável — evita que
// alguém desfaça um dos dois lados sem entender a relação entre eles.
describe("Security headers — SSOT entre nginx e Hono secureHeaders()", () => {
  it("BFF chama secureHeaders() sem desligar os headers que o nginx sobrescreve", () => {
    const index = read("apps/bff/src/index.ts");
    assert.match(
      index,
      /app\.use\("\*",\s*secureHeaders\(\)\);/,
      "secureHeaders() deve rodar com os defaults do Hono intactos — proteção de fallback para acesso direto ao BFF sem nginx. " +
        "Se X-Frame-Options/Strict-Transport-Security/Referrer-Policy precisam ser diferentes, a mudança deve ser feita no nginx " +
        "(infra/nginx/api.apmcb.pmpb.online.conf), não desligando aqui — senão o BFF fica sem proteção nenhuma em dev local.",
    );
  });

  it("nginx esconde de nginx os 3 headers que ele mesmo re-adiciona, em toda location que faz proxy_pass", () => {
    const conf = read("infra/nginx/api.apmcb.pmpb.online.conf");
    const hiddenHeaders = ["X-Frame-Options", "Strict-Transport-Security", "Referrer-Policy"];

    // Cada location com proxy_pass precisa esconder os 3 headers do upstream
    // antes de repassar — senão volta a duplicar com valor divergente.
    const locationBlocks = [...conf.matchAll(/location\s+[^\{]+\{([\s\S]*?)\n {4}\}/g)].map((m) => m[1]);
    const proxyLocations = locationBlocks.filter((block) => block.includes("proxy_pass"));

    assert.ok(proxyLocations.length >= 2, "esperava ao menos 2 locations com proxy_pass (/health e /api/)");

    for (const block of proxyLocations) {
      for (const header of hiddenHeaders) {
        assert.ok(
          block.includes(`proxy_hide_header ${header};`),
          `location com proxy_pass sem "proxy_hide_header ${header};" — a resposta voltaria a ter esse header duplicado (Hono + nginx)`,
        );
      }
    }
  });

  it("nginx continua sendo a fonte de X-Frame-Options: DENY (mais estrito que o default SAMEORIGIN do Hono)", () => {
    const conf = read("infra/nginx/api.apmcb.pmpb.online.conf");
    assertContains(conf, 'add_header X-Frame-Options "DENY" always;', "X-Frame-Options: DENY deve continuar vindo do nginx");
  });
});

function assertContains(file: string, snippet: string, message: string) {
  assert.ok(file.includes(snippet), message);
}
