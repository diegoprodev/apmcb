import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn(), parse: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess, warning: vi.fn() } }));
vi.mock("@/lib/csrf", () => ({ csrfHeaders: () => ({}) }));
vi.mock("@/lib/militares-import", async (orig) => ({ ...(await orig<typeof import("@/lib/militares-import")>()), parseImportFile: mocks.parse }));

import { ImportMilitaresButton } from "./import-militares-dialog";

const R1 = { id: "r1", nome: "Alfa", acronym: "A", admin_state: "ok" };
const R2 = { id: "r2", nome: "Bravo", acronym: "B", admin_state: "ok" };
const RP = { id: "rp", nome: "Pendente", acronym: "P", admin_state: "pending_invite" };
const ROWS = [{ nome_completo: "Fulano Silva", email: "f@x.co", matricula: "1", posto: null }];

let calls: Array<{ url: string; body?: unknown }> = [];
let importStatus = 200;
function stubFetch(targets: unknown[], defaultReserve: string | null) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/reserve-targets")) return { ok: true, status: 200, json: async () => ({ reserves: targets, default_reserve_id: defaultReserve }) };
    if (url.endsWith("/militares/import")) {
      return importStatus === 200
        ? { ok: true, status: 200, json: async () => ({ results: [{ line: 1, matricula: "1", email: "f@x.co", status: "created_invited", message: "ok" }] }) }
        : { ok: false, status: 409, json: async () => ({ error: "Esta reserva ainda não está disponível: o convite do administrador da reserva ainda não foi aceito." }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }));
}
async function open() {
  render(<ImportMilitaresButton />);
  fireEvent.click(screen.getByTestId("btn-importar-usuarios"));
  await waitFor(() => expect(screen.getByLabelText(/Adicionar como membro de/)).toBeTruthy());
}
async function pickFile(result: unknown = { rows: ROWS, errors: [], missingColumns: [] }) {
  mocks.parse.mockResolvedValueOnce(result);
  const input = screen.getByTestId("import-file-input") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "usuarios.csv")] } });
  await waitFor(() => expect(screen.getByTestId("btn-confirmar-importacao")).toBeTruthy());
}

afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); importStatus = 200; });

describe("ImportMilitaresButton", () => {
  it("pré-seleciona a reserva oficial do importador, lista as demais e desabilita as sem admin ativo", async () => {
    stubFetch([R1, R2, RP], "r2");
    await open();
    const sel = screen.getByLabelText(/Adicionar como membro de/) as HTMLSelectElement;
    expect(sel.value).toBe("r2");
    const opts = Array.from(sel.options).map((o) => [o.value, o.disabled]);
    expect(opts).toEqual([["", false], ["r1", false], ["r2", false], ["rp", true]]);
    expect(screen.getByRole("note").textContent).toMatch(/convite por e-mail automaticamente/);
  });

  it("uma única reserva já vem escolhida; sem reservas só 'Sem reserva'", async () => {
    stubFetch([R1], null);
    await open();
    expect((screen.getByLabelText(/Adicionar como membro de/) as HTMLSelectElement).value).toBe("r1");
    cleanup();
    stubFetch([], null);
    await open();
    expect((screen.getByLabelText(/Adicionar como membro de/) as HTMLSelectElement).options.length).toBe(1);
  });

  it("envia {reserve_id, rows} ao BFF e mostra o resultado por linha", async () => {
    stubFetch([R1, R2], "r1");
    await open();
    await pickFile();
    fireEvent.click(screen.getByTestId("btn-confirmar-importacao"));
    await waitFor(() => expect(screen.getByLabelText("Resultado da importação")).toBeTruthy());
    const post = calls.find((c) => c.url.endsWith("/militares/import"))!;
    expect(post.body).toEqual({ reserve_id: "r1", rows: ROWS });
    expect(screen.getByText("Cadastrado e convite enviado")).toBeTruthy();
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("sem reserva escolhida: reserve_id null (nenhum convite)", async () => {
    stubFetch([R1, R2], null);
    await open();
    await pickFile();
    fireEvent.click(screen.getByTestId("btn-confirmar-importacao"));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/militares/import"))).toBe(true));
    expect(calls.find((c) => c.url.endsWith("/militares/import"))!.body).toMatchObject({ reserve_id: null });
    expect(screen.getByRole("note").textContent).toMatch(/Sem reserva/);
  });

  it("colunas mínimas ausentes: mostra o erro e bloqueia o envio", async () => {
    stubFetch([R1], "r1");
    await open();
    mocks.parse.mockResolvedValueOnce({ rows: [], errors: [], missingColumns: ["e-mail"] });
    fireEvent.change(screen.getByTestId("import-file-input"), { target: { files: [new File(["x"], "a.csv")] } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/e-mail/));
    expect((screen.getByTestId("btn-confirmar-importacao") as HTMLButtonElement).disabled).toBe(true);
  });

  it("falha no meio dos blocos: as linhas não processadas aparecem como 'Não processado' (nada some em silêncio)", async () => {
    importStatus = 500;
    stubFetch([R1], "r1");
    await open();
    await pickFile();
    fireEvent.click(screen.getByTestId("btn-confirmar-importacao"));
    await waitFor(() => expect(screen.getByLabelText("Resultado da importação")).toBeTruthy());
    expect(screen.getByText("Não processado")).toBeTruthy();
  });

  it("erro amigável do BFF (convite do admin pendente) vira toast e as linhas ficam como não processadas", async () => {
    importStatus = 409;
    stubFetch([R1], "r1");
    // stubFetch redefine a resposta a partir de importStatus (lido na chamada)
    await open();
    await pickFile();
    fireEvent.click(screen.getByTestId("btn-confirmar-importacao"));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(String(mocks.toastError.mock.calls[0][0])).toMatch(/convite do administrador/);
    // nada é marcado como importado: as linhas aparecem só como "Não processado"
    await waitFor(() => expect(screen.getByText("Não processado")).toBeTruthy());
    expect(screen.queryByText("Cadastrado e convite enviado")).toBeNull();
  });
});
