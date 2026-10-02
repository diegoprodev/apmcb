import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
vi.mock("@/lib/csrf", () => ({ csrfHeaders: () => ({}) }));

import { SemReservaPanel } from "./sem-reserva-panel";

const mk = (i: number) => ({ id: `m${i}`, nome_completo: `Militar ${String(i).padStart(2, "0")}`, matricula: `${100 + i}`, posto: i % 2 ? "Sd" : null, email: i === 2 ? null : `m${i}@x.co`, invite_sent_at: null, account_activated_at: null });
const ALL = Array.from({ length: 25 }, (_, i) => mk(i + 1));
const TARGETS = [
  { id: "r1", nome: "Alfa", acronym: "A", admin_state: "ok" },
  { id: "rp", nome: "Pendente", acronym: "P", admin_state: "pending_invite" },
];
let calls: Array<{ url: string; method?: string; body?: unknown }> = [];
let addResponse: { ok: boolean; status: number; body: unknown };
let removed: Set<string>;
let targetsOk = true;
beforeEach(() => {
  vi.clearAllMocks(); calls = []; removed = new Set(); targetsOk = true;
  addResponse = { ok: true, status: 200, body: { ok: true, invite: "sent" } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes("/militares/sem-reserva")) {
      const u = new URL(url, "http://x");
      const reqPage = Number(u.searchParams.get("page")); const size = Number(u.searchParams.get("page_size")); const q = (u.searchParams.get("q") ?? "").toLowerCase();
      const rows = ALL.filter((m) => !removed.has(m.id) && (!q || m.nome_completo.toLowerCase().includes(q) || m.matricula.includes(q)));
      const page = Math.min(reqPage, Math.max(1, Math.ceil(rows.length / size))); // o servidor ajusta a página além do fim
      return { ok: true, status: 200, json: async () => ({ militares: rows.slice((page - 1) * size, page * size), total: rows.length, page, page_size: size }) };
    }
    if (url.endsWith("/reserve-targets")) return targetsOk ? { ok: true, status: 200, json: async () => ({ reserves: TARGETS, default_reserve_id: "r1" }) } : { ok: false, status: 500, json: async () => ({}) };
    if (url.endsWith("/add-to-reserve")) {
      if (addResponse.ok) removed.add(url.split("/militares/")[1].split("/")[0]);
      return { ok: addResponse.ok, status: addResponse.status, json: async () => addResponse.body };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }));
});
afterEach(cleanup);

const sem = (u: string) => calls.filter((c) => c.url.includes("/militares/sem-reserva")).map((c) => new URL(c.url, "http://x").searchParams);
async function openPanel(props: { canExport?: boolean } = {}) {
  render(<SemReservaPanel {...props} />);
  expect(calls).toEqual([]); // nada é carregado até o painel abrir
  fireEvent.click(screen.getByTestId("filtro-sem-reserva"));
  await waitFor(() => expect(screen.getByTestId("filtro-sem-reserva").textContent).toContain("(25)"));
}

describe("SemReservaPanel — padrão de lista", () => {
  it("abre com 10 por página (padrão), total e intervalo; troca para 20/30/50 e navega", async () => {
    await openPanel();
    expect(screen.getAllByRole("checkbox", { name: /Selecionar Militar/ })).toHaveLength(10);
    expect(screen.getByTestId("sr-range").textContent).toBe("1–10 de 25");
    fireEvent.click(screen.getByTestId("sr-next"));
    await waitFor(() => expect(screen.getByTestId("sr-range").textContent).toBe("11–20 de 25"));
    expect(sem("").at(-1)!.get("page")).toBe("2");
    fireEvent.change(screen.getByTestId("sr-size"), { target: { value: "50" } });
    await waitFor(() => expect(screen.getByTestId("sr-range").textContent).toBe("1–25 de 25"));
    expect(sem("").at(-1)!.get("page_size")).toBe("50");
    expect(sem("").at(-1)!.get("page")).toBe("1");
  });

  it("busca com debounce de 300ms vai ao servidor (q) e volta à página 1; limpar restaura", async () => {
    await openPanel();
    fireEvent.click(screen.getByTestId("sr-next"));
    await waitFor(() => expect(screen.getByTestId("sr-range").textContent).toBe("11–20 de 25"));
    fireEvent.change(screen.getByLabelText("Buscar militares sem reserva"), { target: { value: "Militar 07" } });
    expect(sem("").some((p) => p.get("q"))).toBe(false); // ainda dentro do debounce
    await waitFor(() => expect(sem("").at(-1)!.get("q")).toBe("Militar 07"), { timeout: 2000 });
    await waitFor(() => expect(screen.getByTestId("sr-range").textContent).toBe("1–1 de 1"));
    expect(sem("").at(-1)!.get("page")).toBe("1");
    fireEvent.click(screen.getByLabelText("Limpar busca"));
    await waitFor(() => expect(screen.getByTestId("sr-range").textContent).toBe("1–10 de 25"), { timeout: 2000 });
  });

  it("sem resultados: estado vazio explícito com 'Limpar busca'", async () => {
    await openPanel();
    fireEvent.change(screen.getByLabelText("Buscar militares sem reserva"), { target: { value: "zzz" } });
    await waitFor(() => expect(screen.getByText(/Nenhum resultado para "zzz"/)).toBeTruthy(), { timeout: 2000 });
  });

  it("alterna entre cards e grade (mesmos itens)", async () => {
    await openPanel();
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(screen.getByLabelText("Ver em grade"));
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getAllByRole("checkbox", { name: /Selecionar Militar/ })).toHaveLength(10);
    fireEvent.click(screen.getByLabelText("Ver em cards"));
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("exportação PDF: aparece para quem pode, só habilita com seleção; armeiro (canExport=false) não vê", async () => {
    await openPanel({ canExport: true });
    const exp = screen.getByText("Exportar").closest("button") as HTMLButtonElement;
    expect(exp.disabled).toBe(true);
    fireEvent.click(screen.getAllByRole("checkbox", { name: /Selecionar Militar 01/ })[0]);
    expect((screen.getByText("Exportar").closest("button") as HTMLButtonElement).disabled).toBe(false);
    cleanup(); calls = [];
    await openPanel({ canExport: false });
    expect(screen.queryByText("Exportar")).toBeNull();
  });

  it("seleção não atravessa páginas (a exportação imprime só a página exibida)", async () => {
    await openPanel({ canExport: true });
    fireEvent.click(screen.getAllByRole("checkbox", { name: /Selecionar Militar 01/ })[0]);
    fireEvent.click(screen.getByTestId("sr-next"));
    await waitFor(() => expect(screen.getByTestId("sr-range").textContent).toBe("11–20 de 25"));
    expect((screen.getByText("Exportar").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("dropdown 'Adicionar à reserva': chama o BFF, avisa o convite e recarrega a página (total cai)", async () => {
    await openPanel();
    fireEvent.click(screen.getByLabelText("Adicionar Militar 01 à reserva"));
    fireEvent.click(await screen.findByText("Alfa"));
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    const post = calls.find((c) => c.url.endsWith("/militares/m1/add-to-reserve"))!;
    expect(post.body).toEqual({ reserve_id: "r1" });
    expect(String(mocks.toastSuccess.mock.calls[0][0])).toMatch(/convite enviado/);
    await waitFor(() => expect(screen.getByTestId("filtro-sem-reserva").textContent).toContain("(24)"));
  });

  it("reserva com convite do admin pendente aparece desabilitada com o motivo; erro do BFF vira toast amigável", async () => {
    await openPanel();
    fireEvent.click(screen.getByLabelText("Adicionar Militar 01 à reserva"));
    const item = await screen.findByText(/Pendente — aguardando o aceite do convite do administrador/);
    expect(item.closest("[aria-disabled='true'],[data-disabled]")).not.toBeNull();
    fireEvent.keyDown(document.body, { key: "Escape" });
    addResponse = { ok: false, status: 409, body: { error: "Esta reserva ainda não está disponível: o convite do administrador da reserva ainda não foi aceito." } };
    fireEvent.click(screen.getByLabelText("Adicionar Militar 02 à reserva"));
    fireEvent.click(await screen.findByText("Alfa"));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(String(mocks.toastError.mock.calls[0][0])).toMatch(/convite do administrador/);
  });

  it("adicionar o último item da última página: o painel vai para a página efetiva (sem lista vazia com total>0)", async () => {
    await openPanel();
    fireEvent.change(screen.getByTestId("sr-size"), { target: { value: "20" } });
    await waitFor(() => expect(screen.getByTestId("sr-range").textContent).toBe("1–20 de 25"));
    fireEvent.click(screen.getByTestId("sr-next"));
    await waitFor(() => expect(screen.getByTestId("sr-range").textContent).toBe("21–25 de 25"));
    for (let i = 21; i <= 24; i++) removed.add(`m${i}`); // sobra só m25 na página 2
    fireEvent.click(screen.getByLabelText("Adicionar Militar 25 à reserva"));
    fireEvent.click(await screen.findByText("Alfa"));
    await waitFor(() => expect(screen.getByTestId("sr-range").textContent).toBe("1–20 de 20"));
    expect(screen.queryByText(/Todos os militares já são membros/)).toBeNull();
    expect(screen.getAllByRole("checkbox", { name: /Selecionar Militar/ })).toHaveLength(20);
  });

  it("reservas de destino que não carregaram: aviso com 'Tentar de novo' (o dropdown não fica mudo)", async () => {
    targetsOk = false;
    await openPanel();
    expect(screen.getByRole("status").textContent).toMatch(/reservas de destino/);
    targetsOk = true;
    fireEvent.click(screen.getByText("Tentar de novo"));
    await waitFor(() => expect(screen.queryByText(/reservas de destino/)).toBeNull());
  });

  it("militar sem e-mail: avisa que falta o e-mail para o convite", async () => {
    addResponse = { ok: true, status: 200, body: { ok: true, invite: "no_email" } };
    await openPanel();
    fireEvent.click(screen.getByLabelText("Adicionar Militar 02 à reserva"));
    fireEvent.click(await screen.findByText("Alfa"));
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    expect(String(mocks.toastSuccess.mock.calls[0][0])).toMatch(/Sem e-mail cadastrado/);
  });
});
