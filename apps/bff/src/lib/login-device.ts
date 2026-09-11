import { createHmac } from "node:crypto";
import { baseLogger, type Logger } from "./logger.ts";
import { sendEmail, type SendResult } from "../services/email.ts";
import { renderTemplate } from "./email-templates/index.ts";
import { primeiroNome } from "./primeiro-nome.ts";
import { persistEmailLog, persistEmailFailureAudit } from "./email-log.ts";
import type { EmailLogRow } from "./email-orchestrator.ts";

// Fase 3 — fingerprint de dispositivo de login + disparo do alerta `new_login`.
//
// Chamado de forma NÃO-aguardada (`void`) após `session.save()` em
// routes/auth.ts (login e exchange). Tudo aqui é best-effort: `recordLoginDevice`
// tem try/catch cobrindo o corpo inteiro — nenhuma falha de banco, HMAC ou envio
// pode derrubar (ou sequer atrasar) o fluxo de autenticação.
//
// Fail-CLOSED em direção ao alerta: um erro de leitura no banco NÃO pode fazer
// um device novo parecer conhecido/primeiro (isso silenciaria o alerta). Toda
// dep de leitura lança em erro → o try/catch externo devolve "skipped" +
// `login_device.error` (visível), sem enviar nada de errado.
//
// Privacidade: `device_hash` = HMAC(LOGIN_DEVICE_HASH_PEPPER, user_id|ua|prefix).
// O IP completo NUNCA entra no hash, no banco ou no e-mail — só o prefixo /24
// (v4) ou /48 (v6). Ver plano §3 D17 e a migration.

const RECENT_ACTIVATION_MS = 120_000;
const PEPPER_MIN_LEN = 16;
const UA_MAX = 80;
// Teto de alertas `new_login` por usuário/hora. Assinantes móveis rotacionam o
// /24 público (cada /24 novo + mesma família de UA = device novo); sem teto, um
// único usuário no 4G pode disparar dezenas de e-mails/dia e comer a cota do
// Resend (compartilhada com o SMTP de AUTH do Supabase). `security` NÃO some em
// silêncio: ao estourar, loga `login_device.alert_throttled` (nível error).
const ALERT_HOURLY_CAP = 3;
// Marcador plantado por `resetLoginDevices` (Fase 1) para que uma conta cujos
// devices foram zerados por troca de senha NÃO seja confundida com conta nova
// (count 0 → "primeiro device", sem alerta). Com o tombstone, count >= 1 e o
// próximo login real dispara o re-alerta pretendido.
export const RESET_TOMBSTONE_HASH = "reset-tombstone";

// ─── IP ─────────────────────────────────────────────────────────────────────

// `getAuditClientIp` já devolve só IP válido ou null; estes são guardas extras
// para IPs locais/loopback que aparecem em dev e em health checks.
const LOCAL_IPS = new Set(["::1", "127.0.0.1", "0.0.0.0"]);

/** Expande `::` num endereço IPv6 para 8 hextets (sem zero-fill de cada hextet). */
function expandV6(raw: string): string[] | null {
  const parts = raw.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  if (parts.length === 1) {
    return head.length === 8 ? head : null;
  }
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...Array(missing).fill("0"), ...tail];
}

/**
 * Prefixo de rede estável para o fingerprint: /24 em IPv4, /48 em IPv6.
 * `null` quando o IP é ausente, local ou inválido — nesse caso o device é
 * gravado sem a dimensão de rede e o e-mail sai sem "região".
 */
export function ipPrefix(ip: string | null | undefined): string | null {
  let raw = (ip ?? "").trim().toLowerCase();
  if (!raw || LOCAL_IPS.has(raw)) return null;

  // IPv4-mapeado (::ffff:1.2.3.4) → trata como IPv4.
  const mapped = raw.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) raw = mapped[1];

  if (raw.includes(":")) {
    const hextets = expandV6(raw);
    if (!hextets || !hextets.every((h) => /^[0-9a-f]{1,4}$/.test(h))) return null;
    const head = hextets.slice(0, 3).map((h) => h.replace(/^0+(?=.)/, ""));
    return `${head.join(":")}::/48`;
  }

  const octets = raw.split(".");
  if (octets.length !== 4) return null;
  const nums = octets.map((o) => Number(o));
  if (!nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return null;
  return `${nums[0]}.${nums[1]}.${nums[2]}.0/24`;
}

/** Rótulo humano do prefixo para o e-mail. Nunca devolve um IP completo. */
export function regiaoLabel(prefix: string | null): string | undefined {
  if (!prefix) return undefined;
  if (prefix.includes(":")) return prefix;
  return prefix.replace(/\.0\/24$/, ".x");
}

// ─── User-Agent ─────────────────────────────────────────────────────────────

/** Família grosseira do navegador + SO, ex.: "Chrome em Windows". Nunca lança. */
export function uaFamily(ua: string | null | undefined): string {
  const s = (ua ?? "").slice(0, 400);
  if (!s.trim()) return "dispositivo desconhecido";

  const browser =
    /\bEdg(?:e|A|iOS)?\//.test(s) ? "Edge"
    : /\bOPR\/|\bOpera\//.test(s) ? "Opera"
    : /\bFirefox\/|\bFxiOS\//.test(s) ? "Firefox"
    : /\bChrome\/|\bCriOS\//.test(s) ? "Chrome"
    : /\bSafari\//.test(s) ? "Safari"
    : null;

  const os =
    /\bWindows NT\b/.test(s) ? "Windows"
    : /\biPhone\b|\biPad\b|\biPod\b|\bCPU (?:iPhone )?OS\b/.test(s) ? "iOS"
    : /\bAndroid\b/.test(s) ? "Android"
    : /\bMac OS X\b|\bMacintosh\b/.test(s) ? "macOS"
    : /\bLinux\b/.test(s) ? "Linux"
    : null;

  const label =
    browser && os ? `${browser} em ${os}`
    : browser ? browser
    : os ? os
    : "dispositivo desconhecido";
  return label.slice(0, UA_MAX);
}

// ─── Hash ───────────────────────────────────────────────────────────────────

/** HMAC-SHA256(pepper, userId|uaFamily|ipPrefix). Lança sem um pepper forte. */
export function deviceHash(userId: string, ua: string, prefix: string): string {
  const pepper = process.env.LOGIN_DEVICE_HASH_PEPPER;
  if (!pepper || pepper.length < PEPPER_MIN_LEN) {
    throw new Error("LOGIN_DEVICE_HASH_PEPPER ausente ou fraco");
  }
  return createHmac("sha256", pepper).update(`${userId}|${ua}|${prefix}`).digest("hex");
}

// ─── Timestamp ──────────────────────────────────────────────────────────────

/** Formata para pt-BR/Recife; cai num ISO em UTC se o runtime não tiver full-ICU. */
function formatQuando(at: Date): string {
  try {
    return at.toLocaleString("pt-BR", { timeZone: "America/Recife" });
  } catch {
    return `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }
}

// ─── Orquestração ───────────────────────────────────────────────────────────

export interface DeviceRow {
  userId: string;
  hash: string;
  uaFamily: string;
  ipPrefix: string | null;
}

export interface LoginDeviceDeps {
  findDevice: (userId: string, hash: string) => Promise<boolean>;
  touchDevice: (userId: string, hash: string) => Promise<void>;
  countDevices: (userId: string) => Promise<number>;
  /** `true` = a linha foi inserida agora; `false` = já existia (corrida). */
  insertDevice: (row: DeviceRow) => Promise<boolean>;
  /** Alertas `new_login` já enviados a este usuário na última hora. */
  countRecentAlerts: (userId: string) => Promise<number>;
  send: (p: {
    to: string;
    subject: string;
    html: string;
    text: string;
    category: "security" | "lifecycle";
    log?: Logger;
  }) => Promise<SendResult>;
  logEmail: (row: EmailLogRow) => Promise<void>;
  logFailureAudit: (row: {
    template: string;
    category: EmailLogRow["category"];
    error_code: string | null;
    recipient_id: string;
  }) => Promise<void>;
}

function must<T>(res: { data?: T; count?: number | null; error: { message: string } | null }, what: string) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res;
}

function defaultDeps(log: Logger): LoginDeviceDeps {
  const HOUR_MS = 60 * 60 * 1000;
  return {
    findDevice: async (userId, hash) => {
      const { supabase } = await import("../services/supabase.ts");
      const res = must(
        await supabase
          .from("known_login_devices")
          .select("id")
          .eq("user_id", userId)
          .eq("device_hash", hash)
          .maybeSingle(),
        "findDevice",
      );
      return !!res.data;
    },
    touchDevice: async (userId, hash) => {
      const { supabase } = await import("../services/supabase.ts");
      await supabase
        .from("known_login_devices")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("device_hash", hash);
    },
    countDevices: async (userId) => {
      const { supabase } = await import("../services/supabase.ts");
      const res = must(
        await supabase
          .from("known_login_devices")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId),
        "countDevices",
      );
      return res.count ?? 0;
    },
    insertDevice: async (row) => {
      const { supabase } = await import("../services/supabase.ts");
      const res = must(
        await supabase
          .from("known_login_devices")
          .upsert(
            {
              user_id: row.userId,
              device_hash: row.hash,
              ua_family: row.uaFamily,
              ip_prefix: row.ipPrefix,
            },
            { onConflict: "user_id,device_hash", ignoreDuplicates: true },
          )
          .select("id"),
        "insertDevice",
      );
      return (res.data?.length ?? 0) > 0;
    },
    countRecentAlerts: async (userId) => {
      const { supabase } = await import("../services/supabase.ts");
      const since = new Date(Date.now() - HOUR_MS).toISOString();
      const res = must(
        await supabase
          .from("email_log")
          .select("id", { count: "exact", head: true })
          .eq("recipient_id", userId)
          .eq("template", "new_login")
          .eq("status", "sent")
          .gte("created_at", since),
        "countRecentAlerts",
      );
      return res.count ?? 0;
    },
    send: sendEmail,
    logEmail: (row) => persistEmailLog(row, log),
    logFailureAudit: (row) =>
      persistEmailFailureAudit(
        { template: row.template, category: row.category, error_code: row.error_code, resource_id: row.recipient_id },
        log,
      ),
  };
}

export interface RecordLoginDeviceParams {
  userId: string;
  ip: string | null;
  userAgent: string | null;
  email: string | null;
  nomeCompleto: string | null;
  /** `profiles.account_activated_at` — suprime o alerta nos 1ºs 120s pós-ativação. */
  accountActivatedAt: string | null;
  /** Instante do login (capturado na rota, não na task diferida). */
  loginAt?: Date;
  log?: Logger;
}

export type RecordLoginDeviceResult = "known" | "new" | "first" | "throttled" | "skipped";

/**
 * `"known"`     device já visto — só atualiza last_seen.
 * `"new"`       device novo — inserido + e-mail `new_login` disparado.
 * `"first"`     inserido SEM e-mail: 1º device (TOFU), logo após ativação, ou
 *               sem endereço de e-mail para notificar.
 * `"throttled"` inserido, e-mail suprimido pelo teto horário — mas logado (error).
 * `"skipped"`   não registrou nada: sem pepper, corrida perdida, ou erro.
 */
export async function recordLoginDevice(
  params: RecordLoginDeviceParams,
  deps?: LoginDeviceDeps,
): Promise<RecordLoginDeviceResult> {
  const log = params.log ?? baseLogger;
  const d = deps ?? defaultDeps(log);
  const loginAt = params.loginAt ?? new Date();

  try {
    if (!process.env.LOGIN_DEVICE_HASH_PEPPER) {
      log.info({ reason: "no_pepper" }, "login_device.skipped");
      return "skipped";
    }

    const ua = uaFamily(params.userAgent);
    const prefix = ipPrefix(params.ip);
    const hash = deviceHash(params.userId, ua, prefix ?? "");

    if (await d.findDevice(params.userId, hash)) {
      await d.touchDevice(params.userId, hash);
      return "known";
    }

    const count = await d.countDevices(params.userId);
    const inserted = await d.insertDevice({ userId: params.userId, hash, uaFamily: ua, ipPrefix: prefix });
    if (!inserted) {
      // Corrida: outro login concorrente já inseriu este mesmo device — deixa
      // ele mandar (ou não) o e-mail; aqui não duplica.
      return "skipped";
    }

    // TOFU: o 1º device conhecido de um usuário nunca gera alerta (ele acabou
    // de logar, sabe que foi ele). `resetLoginDevices` planta um tombstone, então
    // uma conta pós-troca-de-senha tem count >= 1 e cai fora deste caso.
    if (count === 0) return "first";

    const activatedMs = params.accountActivatedAt ? Date.parse(params.accountActivatedAt) : NaN;
    const sinceActivation = Number.isFinite(activatedMs) ? loginAt.getTime() - activatedMs : Infinity;
    if (sinceActivation >= 0 && sinceActivation < RECENT_ACTIVATION_MS) {
      return "first";
    }

    if (!params.email) {
      log.info({ userId: params.userId, reason: "no_recipient_email" }, "login_device.no_email");
      return "first";
    }

    if ((await d.countRecentAlerts(params.userId)) >= ALERT_HOURLY_CAP) {
      // O7: `security` não some em silêncio — device gravado, alerta logado.
      log.error(
        { userId: params.userId, cap: ALERT_HOURLY_CAP },
        "login_device.alert_throttled",
      );
      return "throttled";
    }

    const rendered = renderTemplate(
      "new_login",
      { quando: formatQuando(loginAt), dispositivo: ua, ip_regiao: regiaoLabel(prefix) },
      { baseUrl: (process.env.FRONTEND_URL ?? "https://apmcb.pmpb.online").replace(/\/+$/, ""), logoDataUri: "" },
      { nome: primeiroNome(params.nomeCompleto, "militar"), orgao: null },
    );
    const result = await d.send({
      to: params.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      category: "security",
      log,
    });

    await d.logEmail({
      template: "new_login",
      category: "security",
      recipient_id: params.userId,
      status: result.ok ? "sent" : "failed",
      resend_id: result.ok ? result.id : null,
      error_code: result.ok ? null : result.error,
    });
    if (!result.ok) {
      // É o audit_logs que faz a falha aparecer em GET /api/nexus/errors.
      log.error({ userId: params.userId, error: result.error }, "login_device.send_failed");
      await d.logFailureAudit({
        template: "new_login",
        category: "security",
        error_code: result.error,
        recipient_id: params.userId,
      });
    }

    return "new";
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), userId: params.userId },
      "login_device.error",
    );
    return "skipped";
  }
}
