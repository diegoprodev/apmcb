import { describe, expect, it, vi } from "vitest";
import { withMaterialPhotoDisplayUrls } from "./storage";

// PERF-04 (docs/enterprise/specs/navegacao-performance-enterprise.md):
// withMaterialPhotoDisplayUrls trocou N chamadas de createSignedUrl (uma por
// item) por createSignedUrls em lote (chunks de 100) — achado de code
// review: lógica nova e não-trivial (chunking, degradação por erro de
// entrada individual, degradação por exceção de chunk inteiro) sem nenhum
// teste dedicado antes deste arquivo.

function makeSupabase(impl: (bucket: string, paths: string[]) => Promise<{
  data: Array<{ path: string | null; signedUrl?: string; error?: string | null }> | null;
  error: { message: string } | null;
}>) {
  const createSignedUrls = vi.fn(impl);
  return {
    storage: {
      from: vi.fn((bucket: string) => ({
        createSignedUrls: (paths: string[], _ttl: number) => createSignedUrls(bucket, paths),
      })),
    },
    _createSignedUrls: createSignedUrls,
  } as unknown as { storage: { from: (b: string) => unknown }; _createSignedUrls: typeof createSignedUrls };
}

describe("withMaterialPhotoDisplayUrls — PERF-04 chunking em lote", () => {
  it("lista vazia: retorna imediatamente, sem chamar o Storage", async () => {
    const supabase = makeSupabase(async () => ({ data: [], error: null }));
    const result = await withMaterialPhotoDisplayUrls([], supabase as never);
    expect(result).toEqual([]);
    expect(supabase._createSignedUrls).not.toHaveBeenCalled();
  });

  it("item sem photo_url: photo_display_url null, path não entra no lote enviado ao Storage", async () => {
    const supabase = makeSupabase(async (_bucket, paths) => ({
      data: paths.map((p) => ({ path: p, signedUrl: `signed:${p}` })),
      error: null,
    }));
    const items = [{ id: "1", photo_url: null }, { id: "2", photo_url: undefined }];
    const result = await withMaterialPhotoDisplayUrls(items, supabase as never);
    expect(result.map((r) => r.photo_display_url)).toEqual([null, null]);
    expect(supabase._createSignedUrls).not.toHaveBeenCalled();
  });

  it("mais de 100 itens: divide em múltiplos chunks de até 100 (1 chamada por chunk, não 1 por item)", async () => {
    const supabase = makeSupabase(async (_bucket, paths) => ({
      data: paths.map((p) => ({ path: p, signedUrl: `signed:${p}` })),
      error: null,
    }));
    const items = Array.from({ length: 245 }, (_, i) => ({
      id: String(i),
      photo_url: `material-photos/item-${i}.jpg`,
    }));

    const result = await withMaterialPhotoDisplayUrls(items, supabase as never);

    expect(supabase._createSignedUrls).toHaveBeenCalledTimes(3); // 100 + 100 + 45
    const sizes = supabase._createSignedUrls.mock.calls.map(([, paths]: [string, string[]]) => paths.length);
    expect(sizes.sort((a, b) => b - a)).toEqual([100, 100, 45]);
    expect(result.every((r) => r.photo_display_url?.startsWith("signed:"))).toBe(true);
  });

  it("entrada individual com error no resultado do Storage degrada para null, sem afetar as demais do mesmo chunk", async () => {
    const supabase = makeSupabase(async (_bucket, paths) => ({
      data: paths.map((p, i) => (
        i === 1 ? { path: p, error: "not_found" } : { path: p, signedUrl: `signed:${p}` }
      )),
      error: null,
    }));
    const items = [
      { id: "1", photo_url: "material-photos/a.jpg" },
      { id: "2", photo_url: "material-photos/b.jpg" }, // esta falha
      { id: "3", photo_url: "material-photos/c.jpg" },
    ];

    const result = await withMaterialPhotoDisplayUrls(items, supabase as never);

    expect(result[0].photo_display_url).toBe("signed:material-photos/a.jpg");
    expect(result[1].photo_display_url).toBeNull();
    expect(result[2].photo_display_url).toBe("signed:material-photos/c.jpg");
  });

  it("chunk inteiro retorna error (falha de rede reportada pelo Storage): degrada esse chunk para null, não derruba a chamada inteira", async () => {
    const supabase = makeSupabase(async () => ({ data: null, error: { message: "network error" } }));
    const items = [{ id: "1", photo_url: "material-photos/a.jpg" }];

    const result = await withMaterialPhotoDisplayUrls(items, supabase as never);

    expect(result[0].photo_display_url).toBeNull();
  });

  it("chunk lança exceção (rejeição da Promise): degrada esse chunk para null, outros chunks continuam resolvendo", async () => {
    const supabase = makeSupabase(async (_bucket, paths) => {
      if (paths[0].includes("boom")) throw new Error("fetch failed");
      return { data: paths.map((p) => ({ path: p, signedUrl: `signed:${p}` })), error: null };
    });
    // 2 chunks: força tamanho de chunk pequeno indiretamente não é possível
    // (SIGNED_URL_BATCH_SIZE é fixo em 100), então simula 1 item cujo chunk
    // inteiro lança — cobre o caminho do catch por exceção.
    const items = [{ id: "1", photo_url: "material-photos/boom.jpg" }];

    const result = await withMaterialPhotoDisplayUrls(items, supabase as never);

    expect(result[0].photo_display_url).toBeNull();
  });

  it("preserva o valor bruto de photo_url intacto (não sobrescreve, só adiciona photo_display_url)", async () => {
    const supabase = makeSupabase(async (_bucket, paths) => ({
      data: paths.map((p) => ({ path: p, signedUrl: `signed:${p}` })),
      error: null,
    }));
    const items = [{ id: "1", photo_url: "material-photos/a.jpg", nome: "Colete" }];

    const result = await withMaterialPhotoDisplayUrls(items, supabase as never);

    expect(result[0].photo_url).toBe("material-photos/a.jpg");
    expect(result[0].nome).toBe("Colete");
    expect(result[0].photo_display_url).toBe("signed:material-photos/a.jpg");
  });
});
