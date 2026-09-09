// SSOT para baixar um PDF vindo do BFF a partir do navegador.
//
// Bug corrigido: `downloadPdf` (Minhas Cautelas / Cautelas da Reserva) fazia
// `res.blob()` + `<a download>` para QUALQUER resposta 200 — inclusive um
// corpo que não era PDF (fallback offline do service worker, HTML de login
// após expiração de sessão, página de erro de proxy). O arquivo era salvo
// como "cautela-xxxx.pdf" e, ao ser aberto do disco pelo navegador, tentava
// resolver os assets relativos daquele HTML como `file:///…/Downloads/…`,
// gerando no console: "'file:' URLs are treated as unique security origins".
//
// Defesas:
//  1. valida as magic bytes ("%PDF-") antes de disparar o download;
//  2. reconstrói o Blob com `type: "application/pdf"` — o navegador nunca
//     trata o clique como navegação para o corpo cru;
//  3. anexa o <a> ao DOM (exigido pelo Firefox) e só revoga o object URL
//     depois (revogar de forma síncrona aborta o download em andamento).

export class PdfDownloadError extends Error {
  constructor(message = "O servidor não retornou um PDF válido.") {
    super(message);
    this.name = "PdfDownloadError";
  }
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

function looksLikePdf(buf: ArrayBuffer): boolean {
  if (buf.byteLength < PDF_MAGIC.length) return false;
  const head = new Uint8Array(buf, 0, PDF_MAGIC.length);
  return PDF_MAGIC.every((b, i) => head[i] === b);
}

/**
 * Lê o corpo de uma resposta que deveria ser um PDF. Rejeita com
 * PdfDownloadError se o corpo não começar com "%PDF-". Retorna sempre um
 * Blob com type "application/pdf".
 */
export async function readPdfResponse(res: Response): Promise<Blob> {
  const buf = await res.arrayBuffer();
  if (!looksLikePdf(buf)) throw new PdfDownloadError();
  return new Blob([buf], { type: "application/pdf" });
}

/** Dispara o "salvar como" para um Blob de PDF já validado. */
export function savePdfBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoga fora da pilha atual — revogar já cancela downloads em andamento
  // em alguns navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Atalho: valida a resposta e dispara o download. */
export async function downloadPdfResponse(res: Response, filename: string): Promise<void> {
  savePdfBlob(await readPdfResponse(res), filename);
}
