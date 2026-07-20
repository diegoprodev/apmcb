import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  canonicalDeviceRequest,
  isTimestampWithinSkew,
  verifyDeviceRequestSignature,
  type CanonicalRequestInput,
} from "../lib/biometric-device-auth.ts";

function route(name: string) {
  return readFileSync(resolve(process.cwd(), "src", "routes", name), "utf8").replace(/\r\n/g, "\n");
}
function indexFile() {
  return readFileSync(resolve(process.cwd(), "src", "index.ts"), "utf8").replace(/\r\n/g, "\n");
}
function middlewareFile(name: string) {
  return readFileSync(resolve(process.cwd(), "src", "middleware", name), "utf8").replace(/\r\n/g, "\n");
}

function keyPair() {
  return generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

function requestInput(patch: Partial<CanonicalRequestInput> = {}): CanonicalRequestInput {
  return {
    method: "GET",
    pathWithQuery: "/api/biometric-bridge/challenges/next?reserve_id=abc",
    bodyUtf8: "",
    timestamp: new Date().toISOString(),
    nonce: "n-" + Math.random().toString(36).slice(2),
    deviceId: "44444444-4444-4444-8444-444444444444",
    ...patch,
  };
}

describe("canonicalDeviceRequest", () => {
  it("normaliza o método para maiúsculo e junta os campos com \\n na ordem do contrato", () => {
    const canonical = canonicalDeviceRequest(requestInput({ method: "get" }));
    const lines = canonical.split("\n");
    assert.equal(lines.length, 6);
    assert.equal(lines[0], "GET");
  });

  it("SHA256 do body vazio é o hash canônico da string vazia (contrato BODY_UTF8_OR_EMPTY)", () => {
    const canonical = canonicalDeviceRequest(requestInput({ bodyUtf8: "" }));
    // sha256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    assert.ok(canonical.includes("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"));
  });

  it("body diferente produz canonical_request diferente (integridade do body coberta pela assinatura)", () => {
    const a = canonicalDeviceRequest(requestInput({ bodyUtf8: '{"a":1}' }));
    const b = canonicalDeviceRequest(requestInput({ bodyUtf8: '{"a":2}' }));
    assert.notEqual(a, b);
  });
});

describe("verifyDeviceRequestSignature", () => {
  it("aceita assinatura Ed25519 válida do canonical request", () => {
    const { publicKey, privateKey } = keyPair();
    const input = requestInput();
    const signature = sign(null, Buffer.from(canonicalDeviceRequest(input)), privateKey).toString("base64");
    assert.equal(verifyDeviceRequestSignature(input, publicKey, signature), true);
  });

  it("rejeita quando qualquer campo do canonical request é adulterado após assinar", () => {
    const { publicKey, privateKey } = keyPair();
    const input = requestInput();
    const signature = sign(null, Buffer.from(canonicalDeviceRequest(input)), privateKey).toString("base64");

    assert.equal(verifyDeviceRequestSignature({ ...input, pathWithQuery: "/api/biometric-bridge/pair" }, publicKey, signature), false);
    assert.equal(verifyDeviceRequestSignature({ ...input, bodyUtf8: "tampered" }, publicKey, signature), false);
    assert.equal(verifyDeviceRequestSignature({ ...input, nonce: "different-nonce" }, publicKey, signature), false);
    assert.equal(verifyDeviceRequestSignature({ ...input, deviceId: "55555555-5555-4555-8555-555555555555" }, publicKey, signature), false);
  });

  it("rejeita assinatura de uma chave diferente (device impostor)", () => {
    const legit = keyPair();
    const impostor = keyPair();
    const input = requestInput();
    const signature = sign(null, Buffer.from(canonicalDeviceRequest(input)), impostor.privateKey).toString("base64");
    assert.equal(verifyDeviceRequestSignature(input, legit.publicKey, signature), false);
  });

  it("rejeita assinatura malformada sem lançar exceção (fail-closed)", () => {
    const { publicKey } = keyPair();
    assert.equal(verifyDeviceRequestSignature(requestInput(), publicKey, "not-base64-signature!!"), false);
    assert.equal(verifyDeviceRequestSignature(requestInput(), "not-a-pem-key", "AAAA"), false);
  });
});

describe("isTimestampWithinSkew", () => {
  const now = Date.parse("2026-07-16T12:00:00.000Z");

  it("aceita timestamp exatamente agora", () => {
    assert.equal(isTimestampWithinSkew("2026-07-16T12:00:00.000Z", 60, now), true);
  });

  it("aceita timestamp na borda da janela (inclusive)", () => {
    assert.equal(isTimestampWithinSkew("2026-07-16T12:01:00.000Z", 60, now), true);
    assert.equal(isTimestampWithinSkew("2026-07-16T11:59:00.000Z", 60, now), true);
  });

  it("rejeita timestamp fora da janela, passado ou futuro", () => {
    assert.equal(isTimestampWithinSkew("2026-07-16T12:01:01.000Z", 60, now), false);
    assert.equal(isTimestampWithinSkew("2026-07-16T11:58:59.000Z", 60, now), false);
  });

  it("rejeita timestamp não parseável (fail-closed, nunca lança)", () => {
    assert.equal(isTimestampWithinSkew("not-a-date", 60, now), false);
    assert.equal(isTimestampWithinSkew("", 60, now), false);
  });
});

describe("wiring estático — rotas bridge-facing fora do wildcard de authMiddleware (auditoria CRITICAL C1)", () => {
  it("app.route('/api/biometric-bridge', ...) existe e authMiddleware nunca é aplicado a esse path", () => {
    const file = indexFile();
    assert.match(
      file,
      /app\.route\("\/api\/biometric-bridge",\s*biometricBridgeRoutes\)/,
      "biometricBridgeRoutes deve estar montada em /api/biometric-bridge",
    );
    assert.equal(
      file.includes('app.use("/api/biometric-bridge'),
      false,
      "nenhum app.use(...) deve mirar /api/biometric-bridge — authMiddleware nunca pode rodar antes de deviceAuthMiddleware",
    );
    // wildcard existente continua restrito ao path irmão /api/biometric/*, que
    // não casa com /api/biometric-bridge/* (sem barra em comum) — confirma
    // que a proteção do C1 não depende só de ordem de registro no Hono.
    assert.match(file, /app\.use\("\/api\/biometric\/\*",\s*authMiddleware\)/);
  });

  it("rotas bridge-facing usam deviceAuthMiddleware, nunca roleGuard/authMiddleware", () => {
    const file = route("biometric-bridge.ts");
    for (const path of ["/heartbeat", "/challenges/next", "/templates/sync", "/challenges/:id/proof", "/challenges/:id/enrollment"]) {
      const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`"${escaped}",\\s*deviceAuthMiddleware`);
      assert.match(file, regex, `${path} deve usar deviceAuthMiddleware`);
    }
    assert.equal(file.includes("roleGuard"), false, "rotas bridge-facing não têm usuário logado — roleGuard não se aplica");
  });

  it("POST /pair é o único endpoint bridge-facing sem deviceAuthMiddleware (device ainda não existe)", () => {
    const file = route("biometric-bridge.ts");
    assert.match(file, /biometricBridgeRoutes\.post\("\/pair",\s*async/, "POST /pair não deve exigir deviceAuthMiddleware");
  });

  it("rate limiter tem bucket dedicado para /api/biometric-bridge/*, chaveado por device_id — não IP", () => {
    const file = middlewareFile("rate-limit.ts");
    assert.match(file, /rateLimitBiometricBridge/, "bucket dedicado rateLimitBiometricBridge deve existir");
    assert.match(
      file,
      /path\.startsWith\("\/api\/biometric-bridge\/"\)/,
      "routeRateLimiter deve despachar /api/biometric-bridge/* para o bucket dedicado",
    );
    assert.match(
      file,
      /c\.req\.header\("x-bridge-device-id"\)/,
      "bucket do bridge deve chavear por X-Bridge-Device-Id, não por IP (poll+heartbeat de vários devices atrás do mesmo NAT)",
    );
  });
});

describe("wiring estático — enrollment nunca loga template_data", () => {
  it("biometric-bridge.ts não passa body/template_data cru para nenhuma chamada de log", () => {
    const file = route("biometric-bridge.ts");
    const logCalls = [...file.matchAll(/log[?.]?\??\.(?:info|warn|error|debug)\(([\s\S]*?)\)/g)].map((m) => m[1]);
    for (const call of logCalls) {
      assert.equal(/\btemplate_data\b/.test(call), false, `chamada de log não deve incluir template_data: ${call.slice(0, 120)}`);
      assert.equal(/\bencrypted_template_data\b/.test(call), false, `chamada de log não deve incluir encrypted_template_data: ${call.slice(0, 120)}`);
    }
  });
});
