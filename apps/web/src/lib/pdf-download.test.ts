// Bug: baixar/abrir a cautela em PDF gerava no console
//   "Unsafe attempt to load URL file:///…/Downloads/cautela-*.pdf from frame
//    with URL file:///… 'file:' URLs are treated as unique security origins."
// Causa raiz: `downloadPdf` salvava QUALQUER corpo de resposta 200 como
// "cautela-xxxx.pdf" (fallback offline do service worker, HTML de login após
// expiração de sessão, erro de proxy). Ao abrir esse HTML do disco, o
// navegador tentava carregar os assets relativos como file:///…/Downloads/… .
// Fix: validar as magic bytes ("%PDF-") ANTES de disparar o download, e
// sempre reconstruir o Blob com type "application/pdf" (nunca deixar o
// navegador tratar o clique como navegação).
import { afterEach, describe, expect, it, vi } from "vitest";
import { PdfDownloadError, readPdfResponse, savePdfBlob } from "./pdf-download";

function pdfResponse(body: BodyInit, contentType?: string): Response {
  return new Response(body, contentType ? { headers: { "content-type": contentType } } : undefined);
}

afterEach(() => vi.restoreAllMocks());

describe("readPdfResponse", () => {
  it("aceita um corpo que começa com as magic bytes de PDF", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n");
    const blob = await readPdfResponse(pdfResponse(bytes, "application/pdf"));
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBe(bytes.byteLength);
  });

  it("aceita PDF válido mesmo sem header content-type (magic bytes são a fonte de verdade)", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4 rest of file");
    await expect(readPdfResponse(pdfResponse(bytes))).resolves.toBeInstanceOf(Blob);
  });

  it("rejeita com PdfDownloadError quando o corpo é HTML (fallback do SW / página de login)", async () => {
    const html = "<!doctype html><html><head><script src=\"/_next/x.js\"></script></head><body>login</body></html>";
    await expect(readPdfResponse(pdfResponse(html, "text/html"))).rejects.toBeInstanceOf(PdfDownloadError);
  });

  it("rejeita corpo vazio", async () => {
    await expect(readPdfResponse(pdfResponse(new Uint8Array()))).rejects.toBeInstanceOf(PdfDownloadError);
  });
});

describe("savePdfBlob", () => {
  it("cria um <a download> anexado ao DOM, clica e remove; agenda o revoke", () => {
    vi.useFakeTimers();
    const created: string[] = [];
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => { const u = `blob:mock/${created.length}`; created.push(u); return u; }),
      revokeObjectURL: vi.fn(),
    });
    const clickSpy = vi.fn();
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === "a") el.click = clickSpy;
      return el;
    });

    savePdfBlob(new Blob(["%PDF-"], { type: "application/pdf" }), "cautela-abcd1234.pdf");

    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    // não pode deixar o <a> pendurado no DOM
    expect(document.querySelector("a[download]")).toBeNull();
    // revoke não é síncrono (cortaria o download); acontece depois
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock/0");
    vi.useRealTimers();
  });
});
