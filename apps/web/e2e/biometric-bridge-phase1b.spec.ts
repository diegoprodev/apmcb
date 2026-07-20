/**
 * APMCB — Biometric Bridge Phase 1B (bridge Windows real, device-auth)
 *
 * Integração local sem hardware: simula um bridge real via um par de chaves
 * Ed25519 gerado no próprio teste, reimplementando a MESMA canonicalização
 * usada pelo BFF (apps/bff/src/lib/biometric-device-auth.ts e
 * biometric-proof.ts) — é o mesmo trabalho que o bridge C# real fará, então
 * também serve como prova de que a spec é implementável de forma independente.
 * Se aqueles arquivos mudarem o contrato de canonicalização, este teste
 * PRECISA acompanhar.
 *
 * PB01: POST /api/biometric/pairing-codes (admin) cria código one-time
 * PB02: POST /api/biometric-bridge/pair consome o código; ignora tenant/reserve do cliente
 * PB03: reusar o mesmo pairing_code falha (one-time) — 410
 * PB04 (CRITICAL, achado de auditoria C1): heartbeat com SÓ device-auth,
 *      sem cookie/Authorization, retorna 200 — prova que authMiddleware não
 *      intercepta as rotas bridge-facing
 * PB05: device-auth rejeita nonce repetido (replay)
 * PB06: fluxo completo identify — challenge → claim → proof → result mostra usuário
 * PB07: device revogado não consegue mais heartbeat
 */

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { generateKeyPairSync, sign, createHash, randomBytes } from "node:crypto";
import { BFF_URL, USERS } from "./harness";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function loginToken(email: string, password: string): Promise<string> {
  const { data, error } = await sb().auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Login failed: ${error?.message}`);
  return data.session.access_token;
}

async function bff(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${BFF_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// ─── Reimplementação da canonicalização do device-auth (biometric-device-auth.ts) ──

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

interface CanonicalRequestInput {
  method: string;
  pathWithQuery: string;
  bodyUtf8: string;
  timestamp: string;
  nonce: string;
  deviceId: string;
}

function canonicalDeviceRequest(input: CanonicalRequestInput): string {
  return [
    input.method.toUpperCase(),
    input.pathWithQuery,
    sha256Hex(input.bodyUtf8),
    input.timestamp,
    input.nonce,
    input.deviceId,
  ].join("\n");
}

// ─── Reimplementação da canonicalização da proof (biometric-proof.ts) ──────────

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function normalize(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, JsonValue> = {};
    for (const key of Object.keys(input).sort()) {
      const child = input[key];
      if (child !== undefined) output[key] = normalize(child);
    }
    return output;
  }
  throw new Error(`Unsupported biometric payload value: ${typeof value}`);
}

function canonicalizeBiometricPayload(payload: unknown): string {
  return JSON.stringify(normalize(payload));
}

// ─── Fake bridge client ─────────────────────────────────────────────────────

class FakeBridge {
  readonly publicKeyPem: string;
  private readonly privateKeyPem: string;
  deviceId = "";

  constructor() {
    const { publicKey, privateKey }: { publicKey: string; privateKey: string } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    this.publicKeyPem = publicKey;
    this.privateKeyPem = privateKey;
  }

  private nonce(): string {
    return randomBytes(16).toString("base64url");
  }

  async request(method: string, path: string, body?: unknown, opts?: { deviceId?: string; nonceOverride?: string }) {
    const bodyUtf8 = body ? JSON.stringify(body) : "";
    const timestamp = new Date().toISOString();
    const nonce = opts?.nonceOverride ?? this.nonce();
    const deviceId = opts?.deviceId ?? this.deviceId;
    const canonicalInput: CanonicalRequestInput = { method, pathWithQuery: path, bodyUtf8, timestamp, nonce, deviceId };
    const signature = sign(null, Buffer.from(canonicalDeviceRequest(canonicalInput)), this.privateKeyPem).toString("base64");

    const res = await fetch(`${BFF_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Bridge-Device-Id": deviceId,
        "X-Bridge-Timestamp": timestamp,
        "X-Bridge-Nonce": nonce,
        "X-Bridge-Signature": signature,
      },
      body: bodyUtf8 || undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data, headers: res.headers };
  }

  signProof(payload: Record<string, unknown>): string {
    return sign(null, Buffer.from(canonicalizeBiometricPayload(payload)), this.privateKeyPem).toString("base64");
  }
}

// ─── Setup ──────────────────────────────────────────────────────────────────

let adminToken = "";
let armeiroToken = "";
let tenantId = "";
let reserveId = "";
let reserveIdB = "";
let militarId = "";

test.beforeAll(async () => {
  adminToken = await loginToken(USERS.admin.email, USERS.admin.password);
  armeiroToken = await loginToken(USERS.reserva.email, USERS.reserva.password);

  const supa = sb();
  const { data: armProfile } = await supa.from("profiles").select("id, default_tenant_id")
    .eq("matricula", USERS.reserva.matricula).single();
  tenantId = armProfile?.default_tenant_id ?? "";

  const { data: membership } = await supa.from("reserve_memberships")
    .select("reserve_id").eq("user_id", armProfile?.id).limit(1).maybeSingle();
  reserveId = membership?.reserve_id ?? "";

  // Segunda reserva do mesmo tenant, diferente de reserveId — usada só pelo
  // teste PB08 (colisão cross-reserve de device_name). Não depende de
  // nenhum vínculo de admin_reserva com ela: admin_global já tem acesso a
  // qualquer reserva do próprio tenant (actorCanAccessReserve).
  const { data: reserves } = await supa.from("reserves")
    .select("id").eq("tenant_id", tenantId).neq("id", reserveId).limit(1);
  reserveIdB = reserves?.[0]?.id ?? "";

  const { data: milProfile } = await supa.from("profiles").select("id")
    .eq("matricula", USERS.efetivo.matricula).single();
  militarId = milProfile?.id ?? "";
});

test.describe.configure({ mode: "serial" });

test.describe("Biometric Bridge Phase 1B — device-auth, pareamento e fluxo completo", () => {
  const bridge = new FakeBridge();
  let pairingCode = "";

  test("PB01 — POST /api/biometric/pairing-codes (admin) cria código one-time", async () => {
    if (!reserveId) test.skip(true, "Setup incompleto — sem reserva do armeiro fixture");

    const { status, data } = await bff("POST", "/api/biometric/pairing-codes", adminToken, {
      reserve_id: reserveId,
      device_name: `E2E Fake Bridge ${Date.now()}`,
      expires_in_seconds: 600,
    });
    expect(status, `PB01: ${JSON.stringify(data)}`).toBe(201);
    expect(data.pairing_code).toMatch(/^APMCB-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/);
    expect(data.reserve_id).toBe(reserveId);
    pairingCode = data.pairing_code;
  });

  test("PB02 — POST /api/biometric-bridge/pair consome o código; ignora tenant/reserve do cliente", async () => {
    if (!pairingCode) test.skip(true, "PB01 não gerou código");

    const res = await fetch(`${BFF_URL}/api/biometric-bridge/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pairing_code: pairingCode,
        device_name: "E2E Fake Bridge",
        public_key: bridge.publicKeyPem,
        sdk_vendor: "fake",
        sdk_version: "0.0.1-e2e",
        bridge_version: "0.0.1-e2e",
        // Client-supplied — o BFF deve IGNORAR e usar o tenant/reserve
        // gravados no próprio pairing_code, não estes valores forjados.
        tenant_id: "00000000-0000-0000-0000-000000000000",
        reserve_id: "00000000-0000-0000-0000-000000000000",
      }),
    });
    const data = await res.json();
    expect(res.status, `PB02: ${JSON.stringify(data)}`).toBe(201);
    expect(data.tenant_id, "tenant_id deve vir do pairing_code, não do body do cliente").toBe(tenantId);
    expect(data.reserve_id, "reserve_id deve vir do pairing_code, não do body do cliente").toBe(reserveId);
    expect(data.device_id).toBeTruthy();
    bridge.deviceId = data.device_id;
  });

  test("PB03 — reusar o mesmo pairing_code falha (one-time)", async () => {
    if (!pairingCode) test.skip(true, "PB01 não gerou código");

    const res = await fetch(`${BFF_URL}/api/biometric-bridge/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pairing_code: pairingCode,
        device_name: "E2E Fake Bridge — segunda tentativa",
        public_key: bridge.publicKeyPem,
      }),
    });
    expect(res.status, "reuso de pairing_code já consumido deve falhar").toBe(410);
  });

  test("PB04 (CRITICAL, achado de auditoria C1) — heartbeat sem cookie/Authorization, só device-auth, retorna 200", async () => {
    if (!bridge.deviceId) test.skip(true, "PB02 não pareou device");

    const { status, data } = await bridge.request("POST", "/api/biometric-bridge/heartbeat", {
      bridge_version: "0.0.1-e2e",
      device_detected: true,
    });
    expect(
      status,
      `PB04: authMiddleware não deve interceptar rotas bridge-facing — esperado 200, got ${status}: ${JSON.stringify(data)}`
    ).toBe(200);
  });

  test("PB05 — device-auth rejeita nonce repetido (replay)", async () => {
    if (!bridge.deviceId) test.skip(true, "PB02 não pareou device");

    const nonceOverride = `fixed-nonce-${Date.now()}`;
    const first = await bridge.request("POST", "/api/biometric-bridge/heartbeat",
      { bridge_version: "0.0.1-e2e", device_detected: true }, { nonceOverride });
    expect(first.status).toBe(200);

    const replay = await bridge.request("POST", "/api/biometric-bridge/heartbeat",
      { bridge_version: "0.0.1-e2e", device_detected: true }, { nonceOverride });
    expect(replay.status, "reenviar o mesmo nonce deve ser rejeitado (anti-replay)").toBe(401);
  });

  test("PB06 — fluxo completo (purpose=identify): challenge → claim → proof → result", async () => {
    if (!bridge.deviceId || !militarId) test.skip(true, "Setup incompleto");

    // 1. Web (armeiro) cria challenge sem expected_user_id — 1:N.
    const created = await bff("POST", "/api/biometric/challenges", armeiroToken, {
      reserve_id: reserveId,
      purpose: "identify",
    });
    expect(created.status, `criação de challenge: ${JSON.stringify(created.data)}`).toBe(201);
    const challengeId = created.data.challenge.id;

    // 2. Bridge faz polling e reivindica a challenge.
    const claimed = await bridge.request("GET", `/api/biometric-bridge/challenges/next?reserve_id=${reserveId}`);
    expect(claimed.status, `claim: ${JSON.stringify(claimed.data)}`).toBe(200);
    expect(claimed.data.challenge?.id).toBe(challengeId);
    expect(claimed.data.challenge?.expected_user_id).toBeNull();

    // 3. Bridge "captura" e envia proof assinada identificando o militar.
    const proofPayload = {
      challenge_id: challengeId,
      tenant_id: tenantId,
      reserve_id: reserveId,
      device_id: bridge.deviceId,
      actor_id: claimed.data.challenge.actor_id,
      purpose: "identify",
      matched_user_id: militarId,
      document_type: null,
      document_id: null,
      document_hash: null,
      match_score: 0.98,
      finger_index: 2,
      liveness_passed: true,
      sdk_version: "0.0.1-e2e",
      bridge_version: "0.0.1-e2e",
      timestamp: new Date().toISOString(),
    };
    const bridgeSignature = bridge.signProof(proofPayload);
    const submitted = await bridge.request("POST", `/api/biometric-bridge/challenges/${challengeId}/proof`, {
      proof: proofPayload,
      bridge_signature: bridgeSignature,
      result: "success",
    });
    expect(submitted.status, `proof submit: ${JSON.stringify(submitted.data)}`).toBe(201);

    // 4. Web consulta o result endpoint (mesmo ator que criou a challenge).
    const result = await bff("GET", `/api/biometric/challenges/${challengeId}/result`, armeiroToken);
    expect(result.status, `result: ${JSON.stringify(result.data)}`).toBe(200);
    expect(result.data.matched_user?.id ?? result.data.proof?.matched_user_id).toBe(militarId);
  });

  test("PB07 — device revogado não consegue mais heartbeat", async () => {
    if (!bridge.deviceId) test.skip(true, "PB02 não pareou device");

    const { error } = await sb().from("biometric_devices")
      .update({ status: "revoked", revoked_at: new Date().toISOString(), revoked_reason: "E2E PB07" })
      .eq("id", bridge.deviceId);
    expect(error).toBeNull();

    const { status } = await bridge.request("POST", "/api/biometric-bridge/heartbeat", {
      bridge_version: "0.0.1-e2e",
      device_detected: true,
    });
    expect(status, "device revogado não deve conseguir autenticar em nenhuma rota bridge-facing").toBe(401);
  });

  // Regressão do CRÍTICO achado em code review (2026-07-19, migration
  // 20260719000001_biometric_bridge_phase1b_security_fixes.sql): o ON
  // CONFLICT (tenant_id, device_name) do RPC consume_biometric_pairing_code
  // não incluía reserve_id no SET — um pairing_code legítimo para a reserva
  // B, usado com o device_name de um device já ativo na reserva A (mesmo
  // tenant), sequestrava a identidade do device de A (public_key
  // substituída, reserve_id de A preservado silenciosamente) sem o ator
  // jamais ter tido autorização sobre A.
  test("PB08 (CRÍTICO, code review 2026-07-19) — pairing_code de outra reserva não sequestra device_name colidente", async () => {
    if (!reserveIdB) test.skip(true, "Tenant sem uma 2ª reserva — fixture insuficiente para este teste");

    const deviceName = `E2E Collision Test ${Date.now()}`;
    const bridgeA = new FakeBridge();
    const bridgeB = new FakeBridge();

    // 1. Pareia normalmente na reserva A.
    const codeA = await bff("POST", "/api/biometric/pairing-codes", adminToken, {
      reserve_id: reserveId,
      device_name: deviceName,
      expires_in_seconds: 600,
    });
    expect(codeA.status, `pairing-code A: ${JSON.stringify(codeA.data)}`).toBe(201);

    const pairA = await fetch(`${BFF_URL}/api/biometric-bridge/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pairing_code: codeA.data.pairing_code,
        device_name: deviceName,
        public_key: bridgeA.publicKeyPem,
      }),
    });
    const pairADataResp = await pairA.json();
    expect(pairA.status, `pair A: ${JSON.stringify(pairADataResp)}`).toBe(201);
    expect(pairADataResp.reserve_id).toBe(reserveId);
    const deviceIdA = pairADataResp.device_id as string;

    // 2. Gera um pairing_code LEGÍTIMO para a reserva B (admin_global tem
    // acesso a qualquer reserva do próprio tenant — actorCanAccessReserve),
    // mas reusa o MESMO device_name do device já ativo em A.
    const codeB = await bff("POST", "/api/biometric/pairing-codes", adminToken, {
      reserve_id: reserveIdB,
      device_name: deviceName,
      expires_in_seconds: 600,
    });
    expect(codeB.status, `pairing-code B: ${JSON.stringify(codeB.data)}`).toBe(201);

    // 3. Tenta parear com o código de B, mesmo device_name — deve ser
    // REJEITADO, não silenciosamente sequestrar o device de A.
    const pairB = await fetch(`${BFF_URL}/api/biometric-bridge/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pairing_code: codeB.data.pairing_code,
        device_name: deviceName,
        public_key: bridgeB.publicKeyPem,
      }),
    });
    const pairBData = await pairB.json();
    expect(pairB.status, `pair B deveria ser rejeitado, veio: ${JSON.stringify(pairBData)}`).not.toBe(201);
    expect(String(pairBData.error ?? "")).toContain("BIOMETRIC_PAIRING_DEVICE_RESERVE_MISMATCH");

    // 4. Confirma no banco: o device de A continua pertencendo à reserva A,
    // com a chave pública original — nada foi sequestrado.
    const { data: deviceRow } = await sb().from("biometric_devices")
      .select("reserve_id, public_key").eq("id", deviceIdA).single();
    expect(deviceRow?.reserve_id).toBe(reserveId);
    expect(deviceRow?.public_key).toBe(bridgeA.publicKeyPem);
  });
});
