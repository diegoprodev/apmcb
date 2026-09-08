import type { EmailCategory } from "./email-templates/index.ts";

// Rate limit de e-mail transacional — APPLICATION-LEVEL (plano §D14): o
// middleware `createRateLimiter` responde 429 direto, incompatível com "sempre
// 200 ao caller" (D16) e "security segue tentando" (O7). Aqui só devolvemos um
// booleano + retryAfter; a decisão (barrar `lifecycle`, logar e seguir em
// `security`) é do orquestrador em routes/internal.ts.
//
// Janela deslizante em memória, chave = categoria (bucket global). Tráfego vem
// de poucos IPs de egress da CF — por-IP não protege e pode auto-DoS.

interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();

export function __resetEmailBuckets(): void {
  buckets.clear();
}

export interface BucketResult {
  allowed: boolean;
  retryAfterSec: number;
}

export function checkEmailBucket(
  category: EmailCategory,
  max: number,
  windowMs: number,
  now: number = Date.now(),
): BucketResult {
  const key = `email:${category}`;
  const windowStart = now - windowMs;
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => t > windowStart);
  buckets.set(key, bucket);

  if (bucket.timestamps.length >= max) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket.timestamps[0] + windowMs - now) / 1000));
    return { allowed: false, retryAfterSec };
  }

  bucket.timestamps.push(now);
  return { allowed: true, retryAfterSec: 0 };
}
