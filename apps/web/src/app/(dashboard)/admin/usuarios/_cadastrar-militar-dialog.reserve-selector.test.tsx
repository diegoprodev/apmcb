// SP2 Task 5 — seletor de reserva obrigatório no cadastro quando o caller
// está em matriz (activeReserveId null). Mesmo mocking de
// _cadastrar-militar-dialog.test.tsx (o par existente pro fluxo "existente").
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CadastrarUsuarioDialog } from "./_cadastrar-militar-dialog";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/send-login-invite", () => ({ sendLoginInvite: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}));
vi.mock("@/lib/csrf", () => ({ csrfHeaders: () => ({}) }));

const RESERVES = [
  { id: "res-a", nome: "APMCB" },
  { id: "res-b", nome: "CFAP" },
];

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ user_id: "novo-user-1" }) })));
});

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/Nome completo/), { target: { value: "Fulano de Tal" } });
  fireEvent.change(screen.getByLabelText(/Matrícula/), { target: { value: "20250099" } });
}

describe("CadastrarUsuarioDialog — seletor de reserva (SP2)", () => {
  it("NÃO mostra seletor quando o caller tem reserva ativa", () => {
    render(<CadastrarUsuarioDialog open onClose={vi.fn()} activeReserveId="res-a" reserveOptions={RESERVES} />);
    expect(screen.queryByTestId("cm-reserva-select")).toBeNull();
  });

  it("NÃO mostra seletor quando não há reserveOptions (armeiro/admin_reserva)", () => {
    render(<CadastrarUsuarioDialog open onClose={vi.fn()} activeReserveId={null} reserveOptions={[]} />);
    expect(screen.queryByTestId("cm-reserva-select")).toBeNull();
  });

  it("mostra seletor obrigatório quando caller em matriz com opções", () => {
    render(<CadastrarUsuarioDialog open onClose={vi.fn()} activeReserveId={null} reserveOptions={RESERVES} />);
    expect(screen.getByTestId("cm-reserva-select")).toBeInTheDocument();
  });

  it("bloqueia o submit sem reserva selecionada — botão desabilitado, sem fetch", async () => {
    render(<CadastrarUsuarioDialog open onClose={vi.fn()} activeReserveId={null} reserveOptions={RESERVES} />);
    fillRequiredFields();
    expect(screen.getByTestId("cm-submit-btn")).toBeDisabled();
    fireEvent.click(screen.getByTestId("cm-submit-btn"));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("envia reserve_id escolhido no body de POST /militares", async () => {
    render(<CadastrarUsuarioDialog open onClose={vi.fn()} activeReserveId={null} reserveOptions={RESERVES} />);
    fillRequiredFields();
    fireEvent.change(screen.getByTestId("cm-reserva-select"), { target: { value: "res-b" } });
    fireEvent.click(screen.getByTestId("cm-submit-btn"));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.reserve_id).toBe("res-b");
  });

  it("com reserva ativa, envia essa reserva sem precisar de seletor", async () => {
    render(<CadastrarUsuarioDialog open onClose={vi.fn()} activeReserveId="res-a" reserveOptions={RESERVES} />);
    fillRequiredFields();
    fireEvent.click(screen.getByTestId("cm-submit-btn"));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.reserve_id).toBe("res-a");
  });
});
