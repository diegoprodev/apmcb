// Achado ALTO de code review (revisão confirmatória do fix do bug de
// aninhamento AlertDialog/Dialog): nenhum dos 3 fluxos de PRODUÇÃO migrados
// de window.confirm tinha cobertura. Este arquivo cobre "Reenviar convite?"
// em CriarArmeiroClient (grupo "lógica embutida" — handleCreate/doCreate).
//
// Este componente usa fetch global (não bffFetch) — mockado diretamente.
// toast (sonner) é mockado pra permitir assert sem precisar montar
// <Toaster/> real (sonner não renderiza nada sem o consumer do store).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CriarArmeiroClient } from "./_criar-armeiro-client";

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

const PROFILE = {
  id: "prof-1",
  nome_completo: "Fulano de Tal",
  matricula: "20250001",
  posto: "Sd",
  unidade: "1ª Cia",
  email: "fulano@pmpb.pb.gov.br",
  // 5 min atrás — dentro da janela de <10min que dispara a confirmação.
  invite_sent_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  account_activated_at: null,
};

async function selectExistingProfile() {
  render(<CriarArmeiroClient callerRole="armeiro" />);
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: true,
    json: async () => [PROFILE],
  });

  fireEvent.change(screen.getByPlaceholderText("Nome ou matrícula..."), {
    target: { value: "fulano" },
  });

  // Debounce de 300ms em handleSearchChange — waitFor com timeout maior que
  // o padrão (1000ms) pra não flakar sob contenção de CI.
  await waitFor(() => expect(screen.getByText(PROFILE.nome_completo)).toBeInTheDocument(), { timeout: 2000 });
  fireEvent.click(screen.getByText(PROFILE.nome_completo));

  // Confirma que a seleção realmente aconteceu (bloco read-only do perfil
  // selecionado substitui o campo de busca).
  await waitFor(() => expect(screen.getByText(/Convite enviado há/)).toBeInTheDocument());
}

describe("CriarArmeiroClient — 'Reenviar convite?' (AlertDialog, fork handleCreate/doCreate)", () => {
  it("Cancelar fecha o diálogo sem chamar POST /api/admin/users", async () => {
    await selectExistingProfile();

    fireEvent.click(screen.getByRole("button", { name: /re-enviar convite/i }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Reenviar convite?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    // Só a chamada de busca (GET) aconteceu — nenhum POST de reenvio.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("Confirmar chama POST /api/admin/users com existing_user_id e mostra a tela de sucesso", async () => {
    await selectExistingProfile();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    fireEvent.click(screen.getByRole("button", { name: /re-enviar convite/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Reenviar" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    const [, postCall] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(postCall[0]).toBe("/api/admin/users");
    const body = JSON.parse(postCall[1].body);
    expect(body.existing_user_id).toBe(PROFILE.id);

    await waitFor(() => expect(screen.getByText("Convite reenviado!")).toBeInTheDocument());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("erro do POST mantém o diálogo aberto (não navega pra tela de sucesso) e mostra toast", async () => {
    await selectExistingProfile();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "Internal server error" }),
    });

    fireEvent.click(screen.getByRole("button", { name: /re-enviar convite/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Reenviar" }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    // Não avançou pra tela de sucesso — showResendConfirm só é limpo no
    // sucesso (achado de code review corrigido nesta mesma rodada).
    expect(screen.queryByText("Convite reenviado!")).not.toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});
