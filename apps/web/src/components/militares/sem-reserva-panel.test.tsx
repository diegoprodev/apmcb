import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
vi.mock("@/lib/csrf", () => ({ csrfHeaders: () => ({}) }));

import { SemReservaPanel } from "./sem-reserva-panel";

const M1 = { id: "m1", nome_completo: "Fulano Silva", matricula: "100", posto: "Sd", email: "f@x.co", invite_sent_at: null, account_activated_at: null };
const M2 = { id: "m2", nome_completo: "Beltrano Souza", matricula: "200", posto: null, email: null, invite_sent_at: null, account_activated_at: null };
const TARGETS = [
  { id: "r1", nome: "Alfa", acronym: "A", admin_state: "ok" },
  { id: "rp", nome: "Pendente", acronym: "P", admin_state: "pending_invite" },
];
let calls: Array<{ url: string; method?: string; body?: unknown }> = [];
let addResponse: { ok: boolean; status: number; body: unknown } = { ok: true, status: 200, body: { ok: true, invite: "sent" } };
beforeEach(() => {
  vi.clearAllMocks(); calls = [];
  addResponse = { ok: true, status: 200, body: { ok: true, invite: "sent" } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/militares/sem-reserva")) return { ok: true, status: 200, json: async () => ({ militares: [M1, M2] }) };
    if (url.endsWith("/reserve-targets")) return { ok: true, status: 200, json: async () => ({ reserves: TARGETS, default_reserve_id: "r1" }) };
    if (url.endsWith("/add-to-reserve")) return { ok: addResponse.ok, status: addResponse.status, json: async () => addResponse.body };
    return { ok: false, status: 404, json: async () => ({}) };
  }));
});
afterEach(cleanup);

describe("SemReservaPanel", () => {
  it("mostra a contagem no filtro e, ao abrir, lista os militares sem reserva", async () => {
    render(<SemReservaPanel />);
    expect(calls).toEqual([]); // nada é carregado até o painel abrir
    fireEvent.click(screen.getByTestId("filtro-sem-reserva"));
    await waitFor(() => expect(screen.getByTestId("filtro-sem-reserva").textContent).toContain("(2)"));
    expect(screen.getByText("Fulano Silva")).toBeTruthy();
    expect(screen.getAllByText(/Adicionar à reserva/).length).toBe(2);
  });

  it("dropdown 'Adicionar à reserva': escolhe a reserva, chama o BFF, avisa que o convite foi enviado e remove da lista", async () => {
    render(<SemReservaPanel />);
    fireEvent.click(screen.getByTestId("filtro-sem-reserva"));
    await waitFor(() => expect(screen.getByTestId("filtro-sem-reserva").textContent).toContain("(2)"));
    fireEvent.click(screen.getByLabelText("Adicionar Fulano Silva à reserva"));
    fireEvent.click(await screen.findByText("Alfa"));
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    const post = calls.find((c) => c.url.endsWith("/militares/m1/add-to-reserve"))!;
    expect(post.method).toBe("POST");
    expect(post.body).toEqual({ reserve_id: "r1" });
    expect(String(mocks.toastSuccess.mock.calls[0][0])).toMatch(/convite enviado/);
    await waitFor(() => expect(screen.queryByText("Fulano Silva")).toBeNull());
    expect(screen.getByTestId("filtro-sem-reserva").textContent).toContain("(1)");
  });

  it("reserva com convite do admin pendente aparece desabilitada com o motivo", async () => {
    render(<SemReservaPanel />);
    fireEvent.click(screen.getByTestId("filtro-sem-reserva"));
    await waitFor(() => expect(screen.getByTestId("filtro-sem-reserva").textContent).toContain("(2)"));
    fireEvent.click(screen.getByLabelText("Adicionar Fulano Silva à reserva"));
    const item = await screen.findByText(/Pendente — aguardando o aceite do convite do administrador/);
    expect(item.closest("[aria-disabled='true'],[data-disabled]")).not.toBeNull();
  });

  it("erro do BFF vira toast amigável e o militar continua na lista", async () => {
    addResponse = { ok: false, status: 409, body: { error: "Esta reserva ainda não está disponível: o convite do administrador da reserva ainda não foi aceito." } };
    render(<SemReservaPanel />);
    fireEvent.click(screen.getByTestId("filtro-sem-reserva"));
    await waitFor(() => expect(screen.getByTestId("filtro-sem-reserva").textContent).toContain("(2)"));
    fireEvent.click(screen.getByLabelText("Adicionar Fulano Silva à reserva"));
    fireEvent.click(await screen.findByText("Alfa"));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(String(mocks.toastError.mock.calls[0][0])).toMatch(/convite do administrador/);
    expect(screen.getByText("Fulano Silva")).toBeTruthy();
  });

  it("sem e-mail cadastrado: avisa que falta o e-mail para o convite", async () => {
    addResponse = { ok: true, status: 200, body: { ok: true, invite: "no_email" } };
    render(<SemReservaPanel />);
    fireEvent.click(screen.getByTestId("filtro-sem-reserva"));
    await waitFor(() => expect(screen.getByTestId("filtro-sem-reserva").textContent).toContain("(2)"));
    fireEvent.click(screen.getByLabelText("Adicionar Beltrano Souza à reserva"));
    fireEvent.click(await screen.findByText("Alfa"));
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    expect(String(mocks.toastSuccess.mock.calls[0][0])).toMatch(/Sem e-mail cadastrado/);
  });
});
