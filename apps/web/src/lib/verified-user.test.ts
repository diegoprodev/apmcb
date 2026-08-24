import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// PERF-01 (docs/enterprise/specs/navegacao-performance-enterprise.md), §8:
// teste unitário mandatório do cache de fetchVerifiedUserId — (a) mesmo
// cookie dentro da janela de 10s faz 1 única chamada de rede; (b) cookies
// diferentes nunca compartilham entrada; (c) resultado null/erro nunca é
// cacheado; (d) eviction ao ultrapassar 500 entradas.
//
// vi.resetModules() a cada teste: o Map de cache é estado de módulo
// (por design — mesmo padrão de isolate do Cloudflare Worker que o cache
// real usa em produção), então precisa recarregar o módulo do zero pra
// cada teste não vazar estado entre eles.

async function loadFetchVerifiedUserId() {
  vi.resetModules();
  const mod = await import("./verified-user");
  return mod.fetchVerifiedUserId;
}

describe("fetchVerifiedUserId — cache de 10s do PERF-01", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("(a) duas chamadas com o MESMO cookie dentro de 10s fazem 1 única chamada de rede", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user: { id: "user-a" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const fetchVerifiedUserId = await loadFetchVerifiedUserId();

    const first = await fetchVerifiedUserId("cookie-a");
    const second = await fetchVerifiedUserId("cookie-a");

    expect(first).toBe("user-a");
    expect(second).toBe("user-a");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("(b) cookies DIFERENTES nunca compartilham entrada de cache", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ user: { id: "user-a" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ user: { id: "user-b" } }) });
    vi.stubGlobal("fetch", fetchMock);
    const fetchVerifiedUserId = await loadFetchVerifiedUserId();

    const forA = await fetchVerifiedUserId("cookie-a");
    const forB = await fetchVerifiedUserId("cookie-b");

    expect(forA).toBe("user-a");
    expect(forB).toBe("user-b");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("(c) resultado null (BFF não-ok) nunca é cacheado — cada chamada refaz o fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);
    const fetchVerifiedUserId = await loadFetchVerifiedUserId();

    const first = await fetchVerifiedUserId("cookie-a");
    const second = await fetchVerifiedUserId("cookie-a");

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("(c) resultado null (falha de rede/timeout) nunca é cacheado — cada chamada refaz o fetch", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network timeout"));
    vi.stubGlobal("fetch", fetchMock);
    const fetchVerifiedUserId = await loadFetchVerifiedUserId();

    const first = await fetchVerifiedUserId("cookie-a");
    const second = await fetchVerifiedUserId("cookie-a");

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("expira após 10s — a próxima chamada com o mesmo cookie refaz o fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user: { id: "user-a" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const fetchVerifiedUserId = await loadFetchVerifiedUserId();

    await fetchVerifiedUserId("cookie-a");
    vi.advanceTimersByTime(10_001);
    await fetchVerifiedUserId("cookie-a");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("(d) ao ultrapassar 500 entradas, o Map é limpo e a próxima chamada pra qualquer chave faz fetch de novo", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
      const cookieHeader = (opts.headers as Record<string, string>).cookie;
      return { ok: true, json: async () => ({ user: { id: cookieHeader } }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const fetchVerifiedUserId = await loadFetchVerifiedUserId();

    // Cacheia cookie-0 primeiro, depois popula mais 500 entradas distintas
    // (cookie-1..cookie-500) — a 500ª inserção adicional (size já em 500
    // antes dela) dispara o clear() completo do Map, inclusive de cookie-0,
    // conforme verified-user.ts: `if (cache.size >= 500) cache.clear()`
    // avaliado ANTES do `set()`.
    await fetchVerifiedUserId("cookie-0");
    for (let i = 1; i <= 500; i++) {
      await fetchVerifiedUserId(`cookie-${i}`);
    }
    fetchMock.mockClear();

    // Se o clear não tivesse rodado, cookie-0 ainda estaria cacheado (0 fetches).
    await fetchVerifiedUserId("cookie-0");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
