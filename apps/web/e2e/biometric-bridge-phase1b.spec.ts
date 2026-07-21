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
 * PB09 (CRÍTICO spec Fase 1C): enrollment com liveness_passed:null passa (JS + RPC SQL);
 *      /tenant-key entrega chave que decifra de verdade o template gravado
 * PB10: enrollment com liveness_passed:false é sempre rejeitado, independente do flag
 * PB07: device revogado não consegue mais heartbeat
 */

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { generateKeyPairSync, sign, createHash, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
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
  const pairedDeviceName = `E2E Fake Bridge ${Date.now()}`;

  test("PB01 — POST /api/biometric/pairing-codes (admin) cria código one-time", async () => {
    if (!reserveId) test.skip(true, "Setup incompleto — sem reserva do armeiro fixture");

    const { status, data } = await bff("POST", "/api/biometric/pairing-codes", adminToken, {
      reserve_id: reserveId,
      device_name: pairedDeviceName,
      expires_in_seconds: 600,
    });
    expect(status, `PB01: ${JSON.stringify(data)}`).toBe(201);
    expect(data.pairing_code).toMatch(/^APMCB-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/);
    expect(data.reserve_id).toBe(reserveId);
    pairingCode = data.pairing_code;
  });

  test("PB02 — POST /api/biometric-bridge/pair consome o código; ignora tenant/reserve do cliente; device_name vem do pairing_code", async () => {
    if (!pairingCode) test.skip(true, "PB01 não gerou código");

    const res = await fetch(`${BFF_URL}/api/biometric-bridge/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pairing_code: pairingCode,
        // device_name REMOVIDO do payload — achado real (spec Fase 1C,
        // seção 2.2): o schema de /pair não aceita mais esse campo; a
        // identidade do device vem exclusivamente do que o admin digitou
        // ao gerar o código em PB01 (device_name: `E2E Fake Bridge ...`).
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

    // Confirma no banco que o device_name gravado é o que o ADMIN digitou
    // em PB01, não um valor inventado pelo bridge (que nem enviou o campo).
    const { data: deviceRow } = await sb().from("biometric_devices")
      .select("device_name").eq("id", data.device_id).single();
    expect(deviceRow?.device_name).toBe(pairedDeviceName);
  });

  test("PB03 — reusar o mesmo pairing_code falha (one-time)", async () => {
    if (!pairingCode) test.skip(true, "PB01 não gerou código");

    const res = await fetch(`${BFF_URL}/api/biometric-bridge/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pairing_code: pairingCode,
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

  // Layout nonce(12)||ciphertext||tag(16) — spec Fase 1C, seção 3.2 (achado A2).
  function encryptTemplate(plaintext: Buffer, keyB64: string): Buffer {
    const key = Buffer.from(keyB64, "base64");
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([nonce, ciphertext, tag]);
  }

  function decryptTemplate(blob: Buffer, keyB64: string): Buffer {
    const key = Buffer.from(keyB64, "base64");
    const nonce = blob.subarray(0, 12);
    const tag = blob.subarray(blob.length - 16);
    const ciphertext = blob.subarray(12, blob.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  test("PB09 (CRÍTICO da spec Fase 1C — achado da 2ª rodada de revisão) — enrollment com liveness_passed:null passa (ambas as camadas, JS e RPC SQL); /tenant-key decifra de verdade", async () => {
    if (!bridge.deviceId || !militarId) test.skip(true, "Setup incompleto");

    // 0. Busca a chave do tenant — endpoint novo, device-auth.
    const tenantKeyRes = await bridge.request("GET", "/api/biometric-bridge/tenant-key");
    expect(tenantKeyRes.status, `tenant-key: ${JSON.stringify(tenantKeyRes.data)}`).toBe(200);
    expect(tenantKeyRes.data.algorithm).toBe("aes-256-gcm");
    const tenantKey = tenantKeyRes.data.tenant_key as string;
    expect(Buffer.from(tenantKey, "base64").length, "chave derivada deve ter 32 bytes (AES-256)").toBe(32);

    // 1. Web (armeiro) cria challenge de enrollment para o militar fixture.
    const created = await bff("POST", "/api/biometric/challenges", armeiroToken, {
      reserve_id: reserveId,
      purpose: "enroll",
      expected_user_id: militarId,
    });
    expect(created.status, `criação de challenge: ${JSON.stringify(created.data)}`).toBe(201);
    const challengeId = created.data.challenge.id;

    // 2. Bridge reivindica a challenge.
    const claimed = await bridge.request("GET", `/api/biometric-bridge/challenges/next?reserve_id=${reserveId}`);
    expect(claimed.status, `claim: ${JSON.stringify(claimed.data)}`).toBe(200);
    expect(claimed.data.challenge?.id).toBe(challengeId);

    // 3. Bridge "captura" um template fake, cifra com a chave do tenant
    // (round-trip real: se a chave estivesse errada, a decifragem no passo
    // 5 falharia com erro de autenticação do GCM, não silenciosamente).
    const plainTemplate = Buffer.from(`fake-fmd-template-${Date.now()}`, "utf8");
    const encryptedBlob = encryptTemplate(plainTemplate, tenantKey);
    const encryptedTemplateData = encryptedBlob.toString("base64");
    const templateHash = `sha256:${createHash("sha256").update(encryptedBlob).digest("hex")}`;

    const proofPayload = {
      challenge_id: challengeId,
      tenant_id: tenantId,
      reserve_id: reserveId,
      device_id: bridge.deviceId,
      actor_id: claimed.data.challenge.actor_id,
      purpose: "enroll",
      matched_user_id: militarId,
      document_type: null,
      document_id: null,
      document_hash: null,
      match_score: 1,
      finger_index: 10,
      // liveness_passed: null — exatamente o cenário do CRÍTICO da spec
      // Fase 1C (leitor sem LFD real). BIOMETRIC_REQUIRE_LIVENESS=false em
      // produção (confirmado via .env do VPS antes de escrever este
      // teste) — este submit só passa se AS DUAS camadas do gate
      // (validateBiometricEnrollment em JS E record_biometric_enrollment
      // no RPC SQL) tratarem null como aceitável. Antes do fix, o RPC
      // rejeitava incondicionalmente mesmo com o JS corrigido — achado
      // real da 2ª rodada de revisão da spec.
      liveness_passed: null,
      sdk_version: "0.0.1-e2e",
      bridge_version: "0.0.1-e2e",
      timestamp: new Date().toISOString(),
    };
    const enrollmentSignedPayload = { ...proofPayload, template_hash: templateHash, format: "nitgen-fmd", quality: 90 };
    const bridgeSignature = bridge.signProof(enrollmentSignedPayload);

    const submitted = await bridge.request("POST", `/api/biometric-bridge/challenges/${challengeId}/enrollment`, {
      proof: proofPayload,
      encrypted_template_data: encryptedTemplateData,
      template_hash: templateHash,
      format: "nitgen-fmd",
      quality: 90,
      bridge_signature: bridgeSignature,
    });
    expect(submitted.status, `enrollment submit: ${JSON.stringify(submitted.data)}`).toBe(201);

    // 4. Confirma no banco que o ciphertext gravado é exatamente o que foi
    // enviado, e que decifra de volta pro plaintext original com a MESMA
    // chave derivada — prova a chave e o layout nonce||ciphertext||tag de
    // ponta a ponta, não só que o BFF aceitou o payload.
    const { data: templateRow } = await sb().from("biometric_templates")
      .select("template_data, template_hash")
      .eq("user_id", militarId).eq("finger_index", 10).single();
    expect(templateRow?.template_hash).toBe(templateHash);
    const storedBlob = Buffer.isBuffer(templateRow?.template_data)
      ? templateRow.template_data
      : Buffer.from(String(templateRow?.template_data).replace(/^\\x/, ""), "hex");
    const decrypted = decryptTemplate(storedBlob, tenantKey);
    expect(decrypted.toString("utf8")).toBe(plainTemplate.toString("utf8"));
  });

  test("PB10 — liveness_passed:false no enrollment é SEMPRE rejeitado, independente de BIOMETRIC_REQUIRE_LIVENESS", async () => {
    if (!bridge.deviceId || !militarId) test.skip(true, "Setup incompleto");

    const created = await bff("POST", "/api/biometric/challenges", armeiroToken, {
      reserve_id: reserveId,
      purpose: "enroll",
      expected_user_id: militarId,
    });
    expect(created.status, `criação de challenge: ${JSON.stringify(created.data)}`).toBe(201);
    const challengeId = created.data.challenge.id;

    const claimed = await bridge.request("GET", `/api/biometric-bridge/challenges/next?reserve_id=${reserveId}`);
    expect(claimed.status).toBe(200);
    expect(claimed.data.challenge?.id).toBe(challengeId);

    const plainTemplate = Buffer.from("fake-fmd-should-not-persist", "utf8");
    const tenantKeyRes = await bridge.request("GET", "/api/biometric-bridge/tenant-key");
    const encryptedBlob = encryptTemplate(plainTemplate, tenantKeyRes.data.tenant_key as string);
    const encryptedTemplateData = encryptedBlob.toString("base64");
    const templateHash = `sha256:${createHash("sha256").update(encryptedBlob).digest("hex")}`;

    const proofPayload = {
      challenge_id: challengeId,
      tenant_id: tenantId,
      reserve_id: reserveId,
      device_id: bridge.deviceId,
      actor_id: claimed.data.challenge.actor_id,
      purpose: "enroll",
      matched_user_id: militarId,
      document_type: null,
      document_id: null,
      document_hash: null,
      match_score: 1,
      finger_index: 9,
      liveness_passed: false,
      sdk_version: "0.0.1-e2e",
      bridge_version: "0.0.1-e2e",
      timestamp: new Date().toISOString(),
    };
    const enrollmentSignedPayload = { ...proofPayload, template_hash: templateHash, format: "nitgen-fmd", quality: 90 };
    const bridgeSignature = bridge.signProof(enrollmentSignedPayload);

    const submitted = await bridge.request("POST", `/api/biometric-bridge/challenges/${challengeId}/enrollment`, {
      proof: proofPayload,
      encrypted_template_data: encryptedTemplateData,
      template_hash: templateHash,
      format: "nitgen-fmd",
      quality: 90,
      bridge_signature: bridgeSignature,
    });
    expect(submitted.status, `liveness_passed:false deveria ser rejeitado, veio: ${JSON.stringify(submitted.data)}`).not.toBe(201);
    expect(String(submitted.data.error ?? "")).toMatch(/liveness/i);
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
    let deviceIdA: string | undefined;

    // Corpo inteiro em try/finally — achado real (2026-07-20): a limpeza
    // (passo 5) só rodava depois de todas as assertions, incluindo a que
    // verifica a própria regressão CRÍTICA de sequestro (passo 4). Se essa
    // assertion falhasse (ex: a regressão voltar a acontecer no futuro), o
    // teste abortava ali e o device ficava órfão — possivelmente com
    // identidade sequestrada — ativo na reserva real, sem revogação. Ao
    // contrário do PB07 (onde o revoke acontece ANTES das assertions, como
    // parte do fluxo testado), aqui a limpeza é posterior — por isso precisa
    // de finally, não do mesmo padrão do PB07.
    try {
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
          public_key: bridgeA.publicKeyPem,
        }),
      });
      const pairADataResp = await pairA.json();
      // Captura ANTES dos expects (achado da 2ª rodada de revisão,
      // 2026-07-20): se pairA.status já for 201 (device real criado no
      // banco) mas uma assertion de sanity-check aqui embaixo falhar, o
      // finally precisa saber o id pra limpar mesmo assim.
      deviceIdA = pairADataResp.device_id as string | undefined;
      expect(pairA.status, `pair A: ${JSON.stringify(pairADataResp)}`).toBe(201);
      expect(pairADataResp.reserve_id).toBe(reserveId);

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
    } finally {
      // 5. Limpeza — achado real (2026-07-20): sem revogar, este teste deixava
      // um device "active" novo (device_name com timestamp, único a cada run)
      // acumulando indefinidamente na reserva REAL do fixture (visível pro
      // armeiro de verdade em /reserva/biometria, poluindo a tela dele a cada
      // execução do CI). Roda mesmo se uma assertion acima falhar.
      if (deviceIdA) {
        await sb().from("biometric_devices")
          .update({ status: "revoked", revoked_at: new Date().toISOString(), revoked_reason: "Limpeza automática pós-teste E2E (PB08)" })
          .eq("id", deviceIdA);
      }
    }
  });
});
