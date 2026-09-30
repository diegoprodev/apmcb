import { createHash } from "node:crypto";

// ARTIFACT hash: SHA-256 (hex) dos BYTES exatos de um arquivo final (ex.: o
// PDF entregue/persistido). Não re-serializa nada — recebe só bytes.
//
// Diferente do content hash (hashDocument, lib/document-hash.ts), que cobre a
// representação canônica do conteúdo lógico. Os dois não são intercambiáveis:
// o mesmo conteúdo pode gerar PDFs com bytes diferentes (data de geração,
// fontes, versão do gerador).
//
// R-01B: primitive implementada e testada; ainda não integrada a nenhum
// fluxo (integração adiada para Document Signing & Evidence v1).
export function artifactSha256(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("artifactSha256: esperado Uint8Array/Buffer com os bytes do artefato");
  }
  return createHash("sha256").update(bytes).digest("hex");
}
