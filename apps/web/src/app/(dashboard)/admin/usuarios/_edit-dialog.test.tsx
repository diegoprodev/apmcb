// BAIXO de code review (2ª revisão confirmatória do fix ALTO original): dos
// 4 lugares que usam o padrão "AlertDialog aninhado em DialogContent", só
// este ("Alterar e-mail de acesso?") ficou sem teste de rede — os outros 3
// (arsenal, criar-armeiro, cadastrar-militar) já tinham. Fechando a lacuna
// pra equalizar cobertura entre os 4.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditUserDialog, type UserData } from "./_edit-dialog";

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

// role: "superadmin" não está em nenhum teto de invite-ceiling.ts — mantém
// canEditRole=false (sem RoleSelect) e needsReserveSelection=false (sem
// busca de reservas), simplificando o fixture pro que este teste cobre.
const USER: UserData = {
  id: "user-1",
  nome_completo: "Beltrano Souza",
  matricula: "20250003",
  email: "beltrano.velho@pmpb.pb.gov.br",
  role: "superadmin",
  registration_status: "complete",
  posto: null,
  nome_de_guerra: null,
  unidade: null,
  telefone: null,
};

const NEW_EMAIL = "beltrano.novo@pmpb.pb.gov.br";

async function openEmailChangeConfirm() {
  render(
    <EditUserDialog
      open
      onClose={vi.fn()}
      user={USER}
      currentUserId="other-user-id"
      callerRole="admin_global"
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Alterar" }));
  fireEvent.change(screen.getByLabelText("Novo e-mail *"), { target: { value: NEW_EMAIL } });
  fireEvent.click(screen.getByRole("button", { name: /salvar alterações/i }));

  expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  expect(screen.getByText("Alterar e-mail de acesso?")).toBeInTheDocument();
}

describe("EditUserDialog — 'Alterar e-mail de acesso?' (AlertDialog aninhado em DialogContent)", () => {
  it("Cancelar fecha só o AlertDialog — o Dialog de edição continua aberto, PATCH não é chamado", async () => {
    await openEmailChangeConfirm();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByText("Editar Usuário")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("Confirmar chama PATCH /api/profiles/:id, depois sendLoginInvite com o novo e-mail, e fecha o dialog", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    mocks.sendLoginInvite.mockResolvedValue({ ok: true });
    const onClose = vi.fn();

    render(
      <EditUserDialog open onClose={onClose} user={USER} currentUserId="other-user-id" callerRole="admin_global" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Alterar" }));
    fireEvent.change(screen.getByLabelText("Novo e-mail *"), { target: { value: NEW_EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: /salvar alterações/i }));
    await screen.findByRole("alertdialog");

    fireEvent.click(screen.getByRole("button", { name: /confirmar alteração/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain(`/api/profiles/${USER.id}`);
    expect(init.method).toBe("PATCH");

    await waitFor(() => expect(mocks.sendLoginInvite).toHaveBeenCalledWith(
      expect.objectContaining({ email: NEW_EMAIL, existingUserId: USER.id }),
    ));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.refresh).toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("erro no PATCH mantém o AlertDialog aberto pra retry — não fecha, não chama sendLoginInvite, não navega", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "E-mail já em uso" }),
    });
    const onClose = vi.fn();

    render(
      <EditUserDialog open onClose={onClose} user={USER} currentUserId="other-user-id" callerRole="admin_global" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Alterar" }));
    fireEvent.change(screen.getByLabelText("Novo e-mail *"), { target: { value: NEW_EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: /salvar alterações/i }));
    await screen.findByRole("alertdialog");

    fireEvent.click(screen.getByRole("button", { name: /confirmar alteração/i }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    // setPendingEmailChange(null) só roda no sucesso de doSave (achado de
    // code review desta rodada) — em erro, o AlertDialog continua montado
    // com o e-mail pendente ainda guardado, pronto pra um novo clique em
    // "Confirmar alteração" sem o usuário reabrir o fluxo inteiro.
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(mocks.sendLoginInvite).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
