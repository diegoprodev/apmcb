import { createHmac } from "node:crypto";
import { baseLogger, type Logger } from "./logger.ts";

// Dedup server-side dos e-mails (plano §D15). O `Idempotency-Key` do Resend
// tem janela de só ~24 h e, se derivado de dados previsíveis, um atacante com
// o segredo do endpoint poderia pré-colidir e SUPRIMIR o alerta real. Aqui a
// chave é HMAC com pepper server-side (não pré-colidível) e a unicidade é
// garantida por PRIMARY KEY na tabela `email_dedup`.

export function dedupKey(template: string, recipientId: string, windowTag: string): string {
  const pepper = process.env.EMAIL_DEDUP_PEPPER;
  if (!pepper) throw new Error("EMAIL_DEDUP_PEPPER ausente");
  return createHmac("sha256", pepper).update(`${template}|${recipientId}|${windowTag}`).digest("hex");
}

export interface DedupUpsertResult {
  inserted: boolean;
  error?: string;
}

// Injetável para teste isolado (o default só resolve o singleton Supabase em
// tempo de chamada — mantém o módulo importável sem env de banco).
async function defaultUpsert(key: string): Promise<DedupUpsertResult> {
  const { supabase } = await import("../services/supabase.ts");
  const { data, error } = await supabase
    .from("email_dedup")
    .upsert({ dedup_key: key }, { onConflict: "dedup_key", ignoreDuplicates: true })
    .select("dedup_key");
  return { inserted: (data?.length ?? 0) > 0, error: error?.message };
}

async function defaultRelease(key: string): Promise<void> {
  const { supabase } = await import("../services/supabase.ts");
  await supabase.from("email_dedup").delete().eq("dedup_key", key);
}

export interface DedupDeps {
  upsert: (key: string) => Promise<DedupUpsertResult>;
  release?: (key: string) => Promise<void>;
}

/**
 * Reivindica a chave. `true` = você é o dono deste envio, prossiga.
 * `false` = já foi enviado nesta janela, pule.
 * Erro de banco → `true` (falha em direção ao envio: melhor um e-mail
 * duplicado que um alerta de segurança perdido).
 */
export async function claimDedup(
  key: string,
  log: Logger = baseLogger,
  deps: DedupDeps = { upsert: defaultUpsert },
): Promise<boolean> {
  const { inserted, error } = await deps.upsert(key);
  if (error) {
    log.warn({ err: error }, "email.dedup.error");
    return true;
  }
  return inserted;
}

/** Libera a chave — best-effort, engole erro (é só otimização de retentativa). */
export async function releaseDedup(
  key: string,
  log: Logger = baseLogger,
  deps: DedupDeps = { upsert: defaultUpsert, release: defaultRelease },
): Promise<void> {
  try {
    await (deps.release ?? defaultRelease)(key);
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "email.dedup.release_error");
  }
}
