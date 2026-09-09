// Cobre a ação de card "Enviar/Reenviar e-mail de acesso" (SendAccessAction),
// usada dentro de UserRowActions em /admin/usuarios e /reserva/militares.
//
// Fronteira de rede: sendLoginInvite (mockado direto — é o módulo que já
// encapsula o POST /api/admin/users/enviar-acesso, tratado como caixa preta).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SendAccessAction, type SendAccessTarget } from "./_send-access-action";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  sendLoginInvite: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess, warning: vi.fn() },
}));

vi.mock("@/lib/send-login-invite", () => ({
  sendLoginInvite: mocks.sendLoginInvite,
}));

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const BASE: SendAccessTarget = {
  id: "user-1",
  nome_completo: "Cadete Teste",
  email: "cadete@apmcb.dev",
  role: "usuario",
  registration_status: "pending_biometric",
  totp_configured: false,
  invite_sent_at: null,
  account_activated_at: null,
};

function renderAction(over: Partial<SendAccessTarget> = {}, callerRole = "admin_global") {
  return render(<SendAccessAction user={{ ...BASE, ...over }} callerRole={callerRole} />);
}

describe("SendAccessAction", () => {
  it("card 'Sem acesso' (sem convite) mostra 'Enviar' e chama o endpoint com { existingUserId, email }", async () => {
    mocks.sendLoginInvite.mockResolvedValue({ ok: true });
    renderAction();

    fireEvent.click(screen.getByTestId("send-access-btn"));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByTestId("send-access-email-static")).toHaveTextContent("cadete@apmcb.dev");

    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(mocks.sendLoginInvite).toHaveBeenCalledWith({
      email: "cadete@apmcb.dev",
      existingUserId: "user-1",
    }));
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("E-mail de acesso enviado"));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("'complete' SEM account_activated_at (enrollado presencialmente, nunca logou) AINDA mostra 'Enviar'", () => {
    renderAction({ registration_status: "complete", totp_configured: true });
    expect(screen.getByTestId("send-access-btn")).toBeInTheDocument();
  });

  it("conta com login registrado (account_activated_at) NÃO renderiza a ação", () => {
    renderAction({ registration_status: "complete", account_activated_at: new Date().toISOString() });
    expect(screen.queryByTestId("send-access-btn")).not.toBeInTheDocument();
  });

  it("conta inativa NÃO renderiza a ação", () => {
    renderAction({ registration_status: "inactive" });
    expect(screen.queryByTestId("send-access-btn")).not.toBeInTheDocument();
  });

  it("acima do teto de privilégio (armeiro -> admin_global) NÃO renderiza a ação", () => {
    renderAction({ role: "admin_global" }, "armeiro");
    expect(screen.queryByTestId("send-access-btn")).not.toBeInTheDocument();
  });

  it("dentro do teto (admin_reserva -> armeiro) renderiza a ação", () => {
    renderAction({ role: "armeiro" }, "admin_reserva");
    expect(screen.getByTestId("send-access-btn")).toBeInTheDocument();
  });

  it("convite já enviado => rótulo 'Reenviar'", async () => {
    mocks.sendLoginInvite.mockResolvedValue({ ok: true });
    renderAction({ invite_sent_at: new Date(Date.now() - 3 * 60_000).toISOString() });

    fireEvent.click(screen.getByTestId("send-access-btn"));
    expect(await screen.findByRole("button", { name: "Reenviar" })).toBeInTheDocument();
  });

  it("429 (debounce) => toast de aguardar e o diálogo continua aberto", async () => {
    mocks.sendLoginInvite.mockResolvedValue({ ok: false, status: 429, message: "qualquer coisa" });
    renderAction();

    fireEvent.click(screen.getByTestId("send-access-btn"));
    fireEvent.click(await screen.findByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(
      "Aguarde alguns segundos antes de enviar de novo.",
    ));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("erro 500 => mensagem amigável do helper, diálogo aberto, sem refresh", async () => {
    mocks.sendLoginInvite.mockResolvedValue({ ok: false, status: 500, message: "Erro ao enviar o e-mail de acesso" });
    renderAction();

    fireEvent.click(screen.getByTestId("send-access-btn"));
    fireEvent.click(await screen.findByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Erro ao enviar o e-mail de acesso"));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("falha de rede (sendLoginInvite rejeita) => 'Erro de conexão'", async () => {
    mocks.sendLoginInvite.mockRejectedValue(new Error("boom"));
    renderAction();

    fireEvent.click(screen.getByTestId("send-access-btn"));
    fireEvent.click(await screen.findByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Erro de conexão. Tente novamente."));
  });

  it("perfil com e-mail sintético (@apmcb.sistema) pede o e-mail antes de enviar", async () => {
    mocks.sendLoginInvite.mockResolvedValue({ ok: true });
    renderAction({ email: "20250003.interno@apmcb.sistema" });

    fireEvent.click(screen.getByTestId("send-access-btn"));
    const input = await screen.findByTestId("send-access-email");
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();

    fireEvent.change(input, { target: { value: "real@orgao.gov.br" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Enviar" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(mocks.sendLoginInvite).toHaveBeenCalledWith({
      email: "real@orgao.gov.br",
      existingUserId: "user-1",
    }));
  });

  it("perfil sem e-mail nenhum também pede o e-mail primeiro", async () => {
    renderAction({ email: null });
    fireEvent.click(screen.getByTestId("send-access-btn"));
    expect(await screen.findByTestId("send-access-email")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
  });

  it("duplo clique em 'Enviar' dispara sendLoginInvite uma única vez", async () => {
    let resolve!: (v: unknown) => void;
    mocks.sendLoginInvite.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderAction();

    fireEvent.click(screen.getByTestId("send-access-btn"));
    const btn = await screen.findByRole("button", { name: "Enviar" });
    fireEvent.click(btn);
    fireEvent.click(btn);

    resolve({ ok: true });
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    expect(mocks.sendLoginInvite).toHaveBeenCalledTimes(1);
  });
});
