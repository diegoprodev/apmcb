import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  ipPrefix,
  regiaoLabel,
  uaFamily,
  deviceHash,
  recordLoginDevice,
  RESET_TOMBSTONE_HASH,
  type LoginDeviceDeps,
} from "../lib/login-device.ts";

const PEPPER = "test-login-device-pepper-32-bytes-min!!";
const USER = "11111111-1111-1111-1111-111111111111";

describe("login-device — ipPrefix / regiaoLabel", () => {
  it("v4 → /24", () => {
    assert.equal(ipPrefix("191.2.3.4"), "191.2.3.0/24");
    assert.equal(ipPrefix("10.0.0.255"), "10.0.0.0/24");
  });
  it("v6 pleno → /48", () => {
    assert.equal(ipPrefix("2001:0db8:abcd:1234:0:0:0:1"), "2001:db8:abcd::/48");
  });
  it("v6 comprimido (::) → /48 correto", () => {
    assert.equal(ipPrefix("2001:db8:abcd:1234::1"), "2001:db8:abcd::/48");
    assert.equal(ipPrefix("2001:db8::1"), "2001:db8:0::/48");
    assert.equal(ipPrefix("fe80::1"), "fe80:0:0::/48");
  });
  it("v4-mapeado (::ffff:) → trata como v4", () => {
    assert.equal(ipPrefix("::ffff:191.2.3.4"), "191.2.3.0/24");
  });
  it("null / vazio / local / lixo → null", () => {
    assert.equal(ipPrefix(null), null);
    assert.equal(ipPrefix(""), null);
    assert.equal(ipPrefix("::1"), null);
    assert.equal(ipPrefix("127.0.0.1"), null);
    assert.equal(ipPrefix("not-an-ip"), null);
    assert.equal(ipPrefix("999.999.999.999"), null);
    assert.equal(ipPrefix("1:2:3:4:5:6:7:8:9"), null);
  });
  it("regiaoLabel mascara o último octeto v4 e nunca devolve IP cheio", () => {
    assert.equal(regiaoLabel("191.2.3.0/24"), "191.2.3.x");
    assert.equal(regiaoLabel("2001:db8:abcd::/48"), "2001:db8:abcd::/48");
    assert.equal(regiaoLabel(null), undefined);
    assert.doesNotMatch(regiaoLabel("191.2.3.0/24")!, /\d+\.\d+\.\d+\.\d+/);
  });
});

describe("login-device — uaFamily", () => {
  it("extrai navegador + SO de um UA comum", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    assert.equal(uaFamily(ua), "Chrome em Windows");
  });
  it("iPhone Safari", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    assert.equal(uaFamily(ua), "Safari em iOS");
  });
  it("Edge é detectado antes de Chrome", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
    assert.equal(uaFamily(ua), "Edge em Windows");
  });
  it("null / vazio / lixo → rótulo genérico, nunca lança", () => {
    assert.equal(uaFamily(null), "dispositivo desconhecido");
    assert.equal(uaFamily(""), "dispositivo desconhecido");
    assert.equal(uaFamily("()()()<<>>"), "dispositivo desconhecido");
  });
  it("trunca UA gigante", () => {
    assert.ok(uaFamily("x".repeat(5000)).length <= 80);
  });
});

describe("login-device — deviceHash", () => {
  before(() => {
    process.env.LOGIN_DEVICE_HASH_PEPPER = PEPPER;
  });
  after(() => {
    delete process.env.LOGIN_DEVICE_HASH_PEPPER;
  });

  it("determinístico, hex de 64 chars", () => {
    const a = deviceHash(USER, "Chrome em Windows", "191.2.3.0/24");
    const b = deviceHash(USER, "Chrome em Windows", "191.2.3.0/24");
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
  });
  it("muda com o pepper", () => {
    const a = deviceHash(USER, "Chrome em Windows", "191.2.3.0/24");
    process.env.LOGIN_DEVICE_HASH_PEPPER = "outro-pepper-completamente-diferente!!";
    const b = deviceHash(USER, "Chrome em Windows", "191.2.3.0/24");
    process.env.LOGIN_DEVICE_HASH_PEPPER = PEPPER;
    assert.notEqual(a, b);
  });
  it("nunca contém o IP cru como substring", () => {
    const h = deviceHash(USER, "Chrome em Windows", "191.2.3.0/24");
    assert.doesNotMatch(h, /191\.2\.3/);
  });
  it("lança sem pepper ou com pepper fraco", () => {
    delete process.env.LOGIN_DEVICE_HASH_PEPPER;
    assert.throws(() => deviceHash(USER, "x", ""));
    process.env.LOGIN_DEVICE_HASH_PEPPER = "curto";
    assert.throws(() => deviceHash(USER, "x", ""));
    process.env.LOGIN_DEVICE_HASH_PEPPER = PEPPER;
  });
});

describe("login-device — recordLoginDevice", () => {
  let sent: any[];
  let logged: any[];
  let failureAudits: any[];
  let inserted: any[];
  let touched: number;
  let deviceExists: boolean;
  let deviceCount: number;
  let insertOk: boolean;
  let recentAlerts: number;

  function deps(over: Partial<LoginDeviceDeps> = {}): LoginDeviceDeps {
    return {
      findDevice: async () => deviceExists,
      touchDevice: async () => {
        touched++;
      },
      countDevices: async () => deviceCount,
      insertDevice: async (row) => {
        if (insertOk) inserted.push(row);
        return insertOk;
      },
      countRecentAlerts: async () => recentAlerts,
      send: async (p) => {
        sent.push(p);
        return { ok: true, id: "resend-1" };
      },
      logEmail: async (row) => {
        logged.push(row);
      },
      logFailureAudit: async (row) => {
        failureAudits.push(row);
      },
      ...over,
    };
  }

  const base = {
    userId: USER,
    ip: "191.2.3.4",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    email: "u@ex.com",
    nomeCompleto: "Ana Souza",
    accountActivatedAt: "2020-01-01T00:00:00Z",
    loginAt: new Date("2026-09-10T11:00:00Z"),
  };

  beforeEach(() => {
    sent = [];
    logged = [];
    failureAudits = [];
    inserted = [];
    touched = 0;
    deviceExists = false;
    deviceCount = 3;
    insertOk = true;
    recentAlerts = 0;
    process.env.LOGIN_DEVICE_HASH_PEPPER = PEPPER;
  });
  after(() => {
    delete process.env.LOGIN_DEVICE_HASH_PEPPER;
  });

  it("sem pepper → skipped, nada enviado, não lança", async () => {
    delete process.env.LOGIN_DEVICE_HASH_PEPPER;
    const r = await recordLoginDevice(base, deps());
    assert.equal(r, "skipped");
    assert.equal(sent.length, 0);
    assert.equal(inserted.length, 0);
  });

  it("device conhecido → known, toca last_seen, não envia", async () => {
    deviceExists = true;
    const r = await recordLoginDevice(base, deps());
    assert.equal(r, "known");
    assert.equal(touched, 1);
    assert.equal(sent.length, 0);
    assert.equal(inserted.length, 0);
  });

  it("1º device do usuário (count 0, TOFU) → first, insere, não envia", async () => {
    deviceCount = 0;
    const r = await recordLoginDevice(base, deps());
    assert.equal(r, "first");
    assert.equal(inserted.length, 1);
    assert.equal(sent.length, 0);
  });

  it("device novo logo após ativação (< 120s) → first, insere, não envia", async () => {
    const r = await recordLoginDevice(
      { ...base, accountActivatedAt: "2026-09-10T10:59:00Z" },
      deps(),
    );
    assert.equal(r, "first");
    assert.equal(inserted.length, 1);
    assert.equal(sent.length, 0);
  });

  it("account_activated_at no futuro (clock skew) NÃO suprime o alerta", async () => {
    const r = await recordLoginDevice(
      { ...base, accountActivatedAt: "2027-01-01T00:00:00Z" },
      deps(),
    );
    assert.equal(r, "new");
    assert.equal(sent.length, 1);
  });

  it("device novo, caso geral → new, insere + envia new_login security + email_log", async () => {
    const r = await recordLoginDevice(base, deps());
    assert.equal(r, "new");
    assert.equal(inserted.length, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].category, "security");
    assert.match(String(sent[0].subject), /novo acesso/i);
    assert.equal(logged[0].status, "sent");
    assert.equal(logged[0].template, "new_login");
  });

  it("corrida perdida (insertDevice=false) → skipped, não envia", async () => {
    insertOk = false;
    const r = await recordLoginDevice(base, deps());
    assert.equal(r, "skipped");
    assert.equal(sent.length, 0);
  });

  it("pós-troca-de-senha: tombstone deixa count=1 → device novo dispara alerta", async () => {
    // resetLoginDevices plantou o tombstone; count reflete 1 linha (não é conta nova).
    deviceCount = 1;
    const r = await recordLoginDevice(base, deps());
    assert.equal(r, "new");
    assert.equal(sent.length, 1);
  });

  it("teto horário de alertas atingido → throttled, insere, NÃO envia, loga error", async () => {
    recentAlerts = 3;
    const r = await recordLoginDevice(base, deps());
    assert.equal(r, "throttled");
    assert.equal(inserted.length, 1);
    assert.equal(sent.length, 0);
  });

  it("IP não-confiável → grava sem ip_prefix e e-mail sem região", async () => {
    const r = await recordLoginDevice({ ...base, ip: null }, deps());
    assert.equal(r, "new");
    assert.equal(inserted[0].ipPrefix, null);
    assert.doesNotMatch(String(sent[0].text), /\d+\.\d+\.\d+\.\d+/);
  });

  it("envio falhou → email_log failed + audit durável (Nexus), retorna new (não quebra login)", async () => {
    const r = await recordLoginDevice(
      base,
      deps({ send: async () => ({ ok: false, error: "http_500", retryable: true }) }),
    );
    assert.equal(r, "new");
    assert.equal(logged[0].status, "failed");
    assert.equal(failureAudits.length, 1);
    assert.equal(failureAudits[0].template, "new_login");
  });

  it("erro de banco no findDevice → skipped (fail-closed), não lança, não envia", async () => {
    const r = await recordLoginDevice(
      base,
      deps({
        findDevice: async () => {
          throw new Error("db down");
        },
      }),
    );
    assert.equal(r, "skipped");
    assert.equal(sent.length, 0);
  });

  it("erro de banco no countDevices → skipped (NÃO degrada para 'first')", async () => {
    const r = await recordLoginDevice(
      base,
      deps({
        countDevices: async () => {
          throw new Error("timeout");
        },
      }),
    );
    assert.equal(r, "skipped");
    assert.equal(sent.length, 0);
  });

  it("sem e-mail do destinatário → insere device mas não envia", async () => {
    const r = await recordLoginDevice({ ...base, email: null }, deps());
    assert.equal(r, "first");
    assert.equal(inserted.length, 1);
    assert.equal(sent.length, 0);
  });

  it("não usa RESET_TOMBSTONE_HASH como hash de device real", () => {
    assert.match(RESET_TOMBSTONE_HASH, /^[a-z-]+$/); // não é hex de 64 → nunca colide
  });
});
