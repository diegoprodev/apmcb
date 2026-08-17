import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { getAuditClientIp } from "../lib/audit-client-ip.ts";
import { scheduleBiometricDeviceLastIpUpdate } from "../lib/biometric-device-client-ip.ts";

const helperPath = resolve(process.cwd(), "src", "lib", "audit-client-ip.ts");
const repoRoot = resolve(process.cwd(), "..", "..");

function source(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

function flushPromises(): Promise<void> {
  return new Promise((resolvePromise) => setImmediate(resolvePromise));
}

describe("getAuditClientIp — helper canônico", () => {
  it("existe como fonte única de IP de auditoria", () => {
    assert.equal(existsSync(helperPath), true, "src/lib/audit-client-ip.ts deve existir");
    const source = readFileSync(helperPath, "utf8");
    assert.match(source, /export function getAuditClientIp\(/);
  });

  it("aceita um IPv4 normalizado em X-Real-IP", () => {
    const request = new Request("https://api.example.test", {
      headers: { "x-real-ip": "203.0.113.10" },
    });
    assert.equal(getAuditClientIp(request), "203.0.113.10");
  });

  it("aceita um IPv6 normalizado em X-Real-IP", () => {
    const request = new Request("https://api.example.test", {
      headers: { "x-real-ip": "2001:db8::1" },
    });
    assert.equal(getAuditClientIp(request), "2001:db8::1");
  });

  it("ignora X-Forwarded-For único ou em cadeia", () => {
    const single = new Request("https://api.example.test", {
      headers: { "x-forwarded-for": "203.0.113.10" },
    });
    const chain = new Request("https://api.example.test", {
      headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.2" },
    });
    assert.equal(getAuditClientIp(single), null);
    assert.equal(getAuditClientIp(chain), null);
  });

  it("ignora CF-Connecting-IP bruto mesmo quando sintaticamente válido", () => {
    const request = new Request("https://api.example.test", {
      headers: { "cf-connecting-ip": "203.0.113.10" },
    });
    assert.equal(getAuditClientIp(request), null);
  });

  it("retorna null para header ausente ou vazio", () => {
    assert.equal(getAuditClientIp(new Request("https://api.example.test")), null);
    assert.equal(
      getAuditClientIp(new Request("https://api.example.test", { headers: { "x-real-ip": "   " } })),
      null,
    );
  });

  it("rejeita IPv4 com porta, IPv6 malformado e string arbitrária", () => {
    for (const value of ["203.0.113.10:443", "2001:db8:::1", "not-an-ip"]) {
      const request = new Request("https://api.example.test", {
        headers: { "x-real-ip": value },
      });
      assert.equal(getAuditClientIp(request), null, `deveria rejeitar ${value}`);
    }
  });

  it("registra warning sanitizado para valor inválido sem expor o header", () => {
    const warnings: Array<{ bindings: Record<string, unknown>; message: string }> = [];
    const request = new Request("https://api.example.test", {
      headers: { "x-real-ip": "203.0.113.10, 10.0.0.2" },
    });

    assert.equal(
      getAuditClientIp(request, {
        warn(bindings, message) {
          warnings.push({ bindings, message });
        },
      }),
      null,
    );

    assert.deepEqual(warnings, [{
      bindings: { category: "invalid_x_real_ip" },
      message: "audit.client_ip.invalid",
    }]);
    assert.doesNotMatch(JSON.stringify(warnings), /203\.0\.113\.10|10\.0\.0\.2/);
  });

  it("usa somente X-Real-IP quando headers forjados também estão presentes", () => {
    const request = new Request("https://api.example.test", {
      headers: {
        "x-real-ip": "2001:db8::1",
        "x-forwarded-for": "198.51.100.9, 10.0.0.2",
        "cf-connecting-ip": "192.0.2.55",
      },
    });
    assert.equal(getAuditClientIp(request), "2001:db8::1");
  });
});

describe("wiring do IP de auditoria", () => {
  it("audit_events e auth usam exclusivamente o helper canônico", () => {
    const audit = source("apps/bff/src/middleware/audit.ts");
    const auth = source("apps/bff/src/routes/auth.ts");

    assert.match(audit, /getAuditClientIp\(c\.req\.raw,\s*c\.get\("log"\)\)/);
    assert.match(auth, /getAuditClientIp\(c\.req\.raw,\s*c\.get\("log"\)\)/);
    assert.doesNotMatch(audit, /header\("x-forwarded-for"\)|header\("cf-connecting-ip"\)/i);
    assert.doesNotMatch(auth, /header\("x-forwarded-for"\)|header\("cf-connecting-ip"\)/i);
  });

  it("biometric_devices.last_ip recebe somente IP validado pelo helper", () => {
    const middleware = source("apps/bff/src/middleware/biometric-device-auth.ts");

    assert.match(middleware, /scheduleBiometricDeviceLastIpUpdate\(\{/);
    assert.doesNotMatch(middleware, /header\("x-forwarded-for"\)|header\("cf-connecting-ip"\)/i);
    assert.match(middleware, /update: \(clientIp\) =>/);
  });
});

describe("biometric_devices.last_ip", () => {
  it("atualiza somente quando recebe IP válido e diferente", async () => {
    const updates: string[] = [];
    const log = { warn() {} };

    for (const value of [undefined, "", "203.0.113.10, 10.0.0.2", "random"]) {
      scheduleBiometricDeviceLastIpUpdate({
        request: new Request("https://api.example.test", {
          headers: value === undefined ? undefined : { "x-real-ip": value },
        }),
        currentIp: null,
        deviceId: "device-1",
        log,
        update: async (ip) => {
          updates.push(ip);
          return { error: null };
        },
      });
    }

    scheduleBiometricDeviceLastIpUpdate({
      request: new Request("https://api.example.test", {
        headers: { "x-real-ip": "2001:db8::1" },
      }),
      currentIp: null,
      deviceId: "device-1",
      log,
      update: async (ip) => {
        updates.push(ip);
        return { error: null };
      },
    });
    await flushPromises();

    assert.deepEqual(updates, ["2001:db8::1"]);
  });

  it("falha síncrona ou assíncrona do update permanece non-blocking", async () => {
    const warnings: string[] = [];
    const log = {
      warn(_bindings: Record<string, unknown>, message: string) {
        warnings.push(message);
      },
    };
    const request = new Request("https://api.example.test", {
      headers: { "x-real-ip": "203.0.113.10" },
    });

    assert.doesNotThrow(() => {
      scheduleBiometricDeviceLastIpUpdate({
        request,
        currentIp: null,
        deviceId: "device-sync",
        log,
        update: () => {
          throw new Error("network failure");
        },
      });
    });
    scheduleBiometricDeviceLastIpUpdate({
      request,
      currentIp: null,
      deviceId: "device-async",
      log,
      update: async () => ({ error: { message: "database failure" } }),
    });
    await flushPromises();

    assert.deepEqual(warnings, [
      "biometric_bridge.device_auth.last_ip_update_failure",
      "biometric_bridge.device_auth.last_ip_update_failure",
    ]);
  });
});

describe("trust boundary versionada", () => {
  it("confia somente nos 22 CIDRs oficiais Cloudflare e normaliza CF-Connecting-IP", () => {
    const realIp = source("infra/nginx/cloudflare-realip.conf");
    const ranges = [...realIp.matchAll(/^\s*set_real_ip_from\s+(\S+);/gm)].map((match) => match[1]);

    assert.deepEqual(ranges, [
      "173.245.48.0/20",
      "103.21.244.0/22",
      "103.22.200.0/22",
      "103.31.4.0/22",
      "141.101.64.0/18",
      "108.162.192.0/18",
      "190.93.240.0/20",
      "188.114.96.0/20",
      "197.234.240.0/22",
      "198.41.128.0/17",
      "162.158.0.0/15",
      "104.16.0.0/13",
      "104.24.0.0/14",
      "172.64.0.0/13",
      "131.0.72.0/22",
      "2400:cb00::/32",
      "2606:4700::/32",
      "2803:f800::/32",
      "2405:b500::/32",
      "2405:8100::/32",
      "2a06:98c0::/29",
      "2c0f:f248::/32",
    ]);
    assert.match(realIp, /^\s*real_ip_header\s+CF-Connecting-IP;/m);
    assert.match(realIp, /^\s*real_ip_recursive\s+on;/m);
    assert.doesNotMatch(realIp, /^\s*set_real_ip_from\s+(?:0\.0\.0\.0\/0|::\/0);/m);
  });

  it("sobrescreve a cadeia encaminhada e não entrega headers Cloudflare brutos ao BFF", () => {
    const nginx = source("infra/nginx/api.apmcb.pmpb.online.conf");
    const normalizedRealIp = nginx.match(/proxy_set_header X-Real-IP \$remote_addr;/g) ?? [];
    const normalizedXff = nginx.match(/proxy_set_header X-Forwarded-For \$remote_addr;/g) ?? [];
    const clearedCf = nginx.match(/proxy_set_header CF-Connecting-IP "";/g) ?? [];
    const clearedForwarded = nginx.match(/proxy_set_header Forwarded "";/g) ?? [];

    assert.equal(normalizedRealIp.length, 2);
    assert.equal(normalizedXff.length, 2);
    assert.equal(clearedCf.length, 2);
    assert.equal(clearedForwarded.length, 2);
    assert.doesNotMatch(nginx, /\$proxy_add_x_forwarded_for/);
  });

  // Timeout maior que o default (5s): este teste faz vários spawnSync reais
  // de bash.exe (Git Bash no Windows) pra rodar o script de verificação —
  // lançar um interpretador MSYS2 do zero múltiplas vezes é ordens de
  // magnitude mais lento que em CI Linux nativo (~25-30s medidos aqui),
  // sem relação com a lógica do teste em si (achado real, não regressão
  // desta sessão: script/teste pré-existentes, nunca tocados aqui).
  it("checker read-only rejeita CIDR ausente, regra pública e SSH não preservado", { timeout: 60_000 }, () => {
    const checker = resolve(repoRoot, "infra", "scripts", "check-cloudflare-origin-firewall.sh");
    const realIp = resolve(repoRoot, "infra", "nginx", "cloudflare-realip.conf");
    const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
    const toBashPath = (path: string) => process.platform === "win32"
      ? path.replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`).replaceAll("\\", "/")
      : path;
    const ranges = [...source("infra/nginx/cloudflare-realip.conf")
      .matchAll(/^\s*set_real_ip_from\s+(\S+);/gm)]
      .map((match) => match[1]);
    const tempDir = mkdtempSync(resolve(tmpdir(), "apmcb-ufw-check-"));

    const run = (lines: string[]) => {
      const statusFile = resolve(tempDir, "ufw-status.txt");
      writeFileSync(statusFile, `${lines.join("\n")}\n`, "utf8");
      return spawnSync(bash, [toBashPath(checker), toBashPath(realIp)], {
        env: { ...process.env, UFW_STATUS_FILE: toBashPath(statusFile) },
        encoding: "utf8",
      });
    };
    const desired = [
      "Status: active",
      "Logging: on (low)",
      "Default: deny (incoming), allow (outgoing), deny (routed)",
      "22/tcp LIMIT IN Anywhere",
      ...ranges.flatMap((cidr, index) => [
        index % 2 === 0 ? `80/tcp ALLOW IN ${cidr}` : `80/tcp ALLOW ${cidr}`,
        index % 2 === 0 ? `443/tcp ALLOW ${cidr}` : `443/tcp ALLOW IN ${cidr}`,
      ]),
    ];

    try {
      assert.equal(run(desired).status, 0);
      assert.notEqual(run(desired.filter((line) => line !== `443/tcp ALLOW ${ranges[0]}`)).status, 0);
      for (const publicRule of [
        "443/tcp ALLOW IN Anywhere",
        "443/tcp (v6) ALLOW IN Anywhere (v6)",
        "80 ALLOW Anywhere",
        "80,443/tcp ALLOW IN Anywhere",
        "Nginx Full ALLOW IN Anywhere",
        "Anywhere ALLOW IN Anywhere",
      ]) {
        const result = run([...desired, publicRule]);
        assert.notEqual(result.status, 0, `deveria rejeitar: ${publicRule}\n${result.stderr}`);
      }
      assert.notEqual(run(desired.map((line) => line.startsWith("Default:")
        ? "Default: allow (incoming), allow (outgoing), deny (routed)"
        : line)).status, 0);
      assert.notEqual(run(desired.filter((line) => !line.startsWith("22/tcp "))).status, 0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
