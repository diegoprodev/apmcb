import { createHash } from "crypto";
import { canonicalJson } from "./canonical-json.ts";

interface DocumentContent {
  document_type: string;
  document_id: string;
  data: Record<string, unknown>;
}

// CONTENT hash: SHA-256 (hex) do JSON canônico (lib/canonical-json.ts) do
// conteúdo LÓGICO informado pelo caller. NÃO é hash dos bytes do PDF — para
// isso existe artifactSha256 (lib/artifact-hash.ts).
//
// R-01A (docs/auditoria/REMEDIATION_LEDGER.md): a versão anterior usava
// JSON.stringify(content, sortedKeys). O array de replacer funciona como
// allowlist em todos os níveis, então `data` era serializado como {} e o
// hash ignorava todo o conteúdo do documento. Hashes gravados antes desta
// correção não são reproduzíveis por esta função (nenhum fluxo os recalcula
// hoje — ver relatório de R-01).
export function hashDocument(content: DocumentContent): string {
  return createHash("sha256").update(canonicalJson(content), "utf8").digest("hex");
}
