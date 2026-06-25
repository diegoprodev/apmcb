import { createHash } from "crypto";

interface SignatureProofParams {
  document_hash: string;
  signer_id: string;
  signed_at: string; // ISO string
  ip: string;
}

export function computeSignatureProof(params: SignatureProofParams): string {
  const sortedKeys = Object.keys(params).sort() as (keyof SignatureProofParams)[];
  const ordered: Record<string, string> = {};
  for (const k of sortedKeys) ordered[k] = params[k];
  return createHash("sha256").update(JSON.stringify(ordered), "utf8").digest("hex");
}
