// Achado ALTO de code review (revisão confirmatória do fix do bug de
// aninhamento AlertDialog/Dialog): nenhum dos 3 fluxos de PRODUÇÃO migrados
// de window.confirm tinha cobertura. Este arquivo cobre "Reenviar convite?"
// em CadastrarUsuarioDialog (modo "existente") — o 3º caso, e o único dos 2
// com Dialog pai que ainda não tinha teste (o outro, _edit-dialog.tsx, seria
// o par natural mas está fora do escopo desta rodada de correção).
//
// Único fluxo de rede acionado por este teste é doProvisionarExistente ->
// sendLoginInvite (mockado direto, mais simples que mockar fetch cru — o
// próprio módulo já é a fronteira de rede documentada em send-login-invite.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CadastrarUsuarioDialog } from "./_cadastrar-militar-dialog";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastError: vi.fn(),
  sendLoginInvite: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/send-login-invite", () => ({
  sendLoginInvite: mocks.sendLoginInvite,
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

const PROFILE = {
  id: "prof-1",
  nome_completo: "Ciclana da Silva",
  matricula: "20250002",
  posto: "Cb",
  unidade: "2ª Cia",
  email: "ciclana@pmpb.pb.gov.br",
  // 5 min atrás — dentro da janela de <10min que dispara a confirmação.
  invite_sent_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  account_activated_at: null,
  role: "usuario",
};

async function openResendConfirm() {
  render(<CadastrarUsuarioDialog open onClose={vi.fn()} />);

  fireEvent.click(screen.getByTestId("cm-mode-existente"));

  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: true,
    json: async () => [PROFILE],
  });
  fireEvent.change(screen.getByTestId("cm-search-input"), { target: { value: "ciclana" } });

  await waitFor(() => expect(screen.getByTestId("cm-search-result")).toBeInTheDocument(), { timeout: 2000 });
  fireEvent.click(screen.getByTestId("cm-search-result"));

  await waitFor(() => expect(screen.getByText(/Convite enviado há/)).toBeInTheDocument());

  fireEvent.click(screen.getByTestId("cm-submit-btn"));
  expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
}

describe("CadastrarUsuarioDialog — 'Reenviar convite?' (AlertDialog aninhado em DialogContent)", () => {
  it("Cancelar fecha só o AlertDialog — o Dialog de cadastro continua aberto, sendLoginInvite não é chamado", async () => {
    await openResendConfirm();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    // O Dialog pai (Cadastrar Usuário) continua na tela — a regressão ALTO
    // original fechava os dois juntos no Escape; aqui confirmamos o
    // equivalente pelo clique em Cancelar (fluxo real de produto).
    expect(screen.getByTestId("cadastrar-usuario-dialog")).toBeInTheDocument();
    expect(mocks.sendLoginInvite).not.toHaveBeenCalled();
  });

  it("Confirmar chama sendLoginInvite com os dados do perfil selecionado e mostra a tela de sucesso", async () => {
    mocks.sendLoginInvite.mockResolvedValue({ ok: true });
    await openResendConfirm();

    fireEvent.click(screen.getByRole("button", { name: "Reenviar" }));

    await waitFor(() => expect(mocks.sendLoginInvite).toHaveBeenCalledWith(
      expect.objectContaining({ existingUserId: PROFILE.id, email: PROFILE.email }),
    ));
    await waitFor(() => expect(screen.getByText("Convite enviado com sucesso!")).toBeInTheDocument());
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("erro em sendLoginInvite mantém o AlertDialog aberto pra retry, sem navegar pra tela de sucesso", async () => {
    mocks.sendLoginInvite.mockResolvedValue({ ok: false, message: "Erro ao enviar convite" });
    await openResendConfirm();

    fireEvent.click(screen.getByRole("button", { name: "Reenviar" }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    // showResendConfirm só é limpo no sucesso (achado de code review desta
    // rodada) — em erro, o diálogo continua aberto pra o usuário tentar de
    // novo sem precisar reabrir o fluxo de busca inteiro.
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.queryByText("Convite enviado com sucesso!")).not.toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
