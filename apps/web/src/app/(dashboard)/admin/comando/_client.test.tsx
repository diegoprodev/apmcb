import { describe, it, expect, vi, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { ComandoClient } from "./_client";

// R-28 / D-02 (docs/auditoria/EVIDENCE_R28.md): o Modo Usuário vive na sessão
// do BFF (cookie apmcb_session) e o BFF não concede staff a Bearer sem sessão.
// O painel autentica só pelo cookie (credentials: "include"), sem Bearer.

afterEach(() => { vi.unstubAllGlobals(); });

describe("ComandoClient — autenticação da chamada ao BFF", () => {
  it("envia o cookie de sessão (credentials: include) em /api/dashboard/command", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ generated_at: new Date().toISOString() }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ComandoClient role="admin_global" reserves={[]} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/dashboard/command");
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).get("authorization")).toBeNull();
  });
});
