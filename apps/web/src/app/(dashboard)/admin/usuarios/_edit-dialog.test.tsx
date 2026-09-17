// BAIXO de code review (2ª revisão confirmatória do fix ALTO original): dos
// 4 lugares que usam o padrão "AlertDialog aninhado em DialogContent", só
// este ("Alterar e-mail de acesso?") ficou sem teste de rede — os outros 3
// (arsenal, criar-armeiro, cadastrar-militar) já tinham. Fechando a lacuna
// pra equalizar cobertura entre os 4.
//
// Reescrito (2026-09-16) após o fluxo de troca de e-mail virar enterprise
// com duplo opt-in + TOTP do admin (commit 226cbfb,
// docs/enterprise/specs/troca-email-acesso-enterprise.md): não é mais um
// PATCH + sendLoginInvite que efetiva a troca na hora — agora é sempre o
// PATCH de dados gerais seguido de requestEmailChange (POST .../email-change),
// que só cria uma pendência; o e-mail de fato só muda quando o usuário
// confirma pelo link. O AlertDialog também exige TOTP de 6 dígitos do PRÓPRIO
// admin antes de abrir, e mudou de título/texto do botão de confirmação.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditUserDialog, type UserData } from "./_edit-dialog";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  requestEmailChange: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: vi.fn(), warning: mocks.toastWarning },
}));

vi.mock("@/lib/request-email-change", () => ({
  requestEmailChange: mocks.requestEmailChange,
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
const VALID_TOTP = "123456";

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
  fireEvent.change(screen.getByLabelText("Seu código dinâmico (TOTP) *"), { target: { value: VALID_TOTP } });
  fireEvent.click(screen.getByRole("button", { name: /salvar alterações/i }));

  expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  expect(screen.getByText("Solicitar troca de e-mail de acesso?")).toBeInTheDocument();
}

describe("EditUserDialog — 'Solicitar troca de e-mail de acesso?' (AlertDialog aninhado em DialogContent)", () => {
  it("Cancelar fecha só o AlertDialog — o Dialog de edição continua aberto, PATCH não é chamado", async () => {
    await openEmailChangeConfirm();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByText("Editar Usuário")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("Enviar confirmação chama PATCH /api/profiles/:id, depois requestEmailChange com o novo e-mail e o TOTP, e fecha o dialog", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    mocks.requestEmailChange.mockResolvedValue({ ok: true });
    const onClose = vi.fn();

    render(
      <EditUserDialog open onClose={onClose} user={USER} currentUserId="other-user-id" callerRole="admin_global" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Alterar" }));
    fireEvent.change(screen.getByLabelText("Novo e-mail *"), { target: { value: NEW_EMAIL } });
    fireEvent.change(screen.getByLabelText("Seu código dinâmico (TOTP) *"), { target: { value: VALID_TOTP } });
    fireEvent.click(screen.getByRole("button", { name: /salvar alterações/i }));
    await screen.findByRole("alertdialog");

    fireEvent.click(screen.getByRole("button", { name: /enviar confirmação/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain(`/api/profiles/${USER.id}`);
    expect(init.method).toBe("PATCH");

    await waitFor(() => expect(mocks.requestEmailChange).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER.id, newEmail: NEW_EMAIL, totpCode: VALID_TOTP }),
    ));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.refresh).toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("erro no PATCH mantém o AlertDialog aberto pra retry — não chama requestEmailChange, não navega", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "Conflito ao atualizar" }),
    });
    const onClose = vi.fn();

    render(
      <EditUserDialog open onClose={onClose} user={USER} currentUserId="other-user-id" callerRole="admin_global" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Alterar" }));
    fireEvent.change(screen.getByLabelText("Novo e-mail *"), { target: { value: NEW_EMAIL } });
    fireEvent.change(screen.getByLabelText("Seu código dinâmico (TOTP) *"), { target: { value: VALID_TOTP } });
    fireEvent.click(screen.getByRole("button", { name: /salvar alterações/i }));
    await screen.findByRole("alertdialog");

    fireEvent.click(screen.getByRole("button", { name: /enviar confirmação/i }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    // cancelEmailChange() só roda no sucesso completo de doSave (achado de
    // code review desta rodada) — em erro do PATCH, o AlertDialog continua
    // montado com o e-mail pendente ainda guardado, pronto pra um novo
    // clique em "Enviar confirmação" sem o usuário reabrir o fluxo inteiro.
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(mocks.requestEmailChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("erro no requestEmailChange NÃO mantém o AlertDialog aberto — PATCH já teve sucesso, só avisa via toast.warning e fecha", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    mocks.requestEmailChange.mockResolvedValue({ ok: false, message: "Falha ao solicitar troca" });
    const onClose = vi.fn();

    render(
      <EditUserDialog open onClose={onClose} user={USER} currentUserId="other-user-id" callerRole="admin_global" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Alterar" }));
    fireEvent.change(screen.getByLabelText("Novo e-mail *"), { target: { value: NEW_EMAIL } });
    fireEvent.change(screen.getByLabelText("Seu código dinâmico (TOTP) *"), { target: { value: VALID_TOTP } });
    fireEvent.click(screen.getByRole("button", { name: /salvar alterações/i }));
    await screen.findByRole("alertdialog");

    fireEvent.click(screen.getByRole("button", { name: /enviar confirmação/i }));

    await waitFor(() => expect(mocks.requestEmailChange).toHaveBeenCalled());
    await waitFor(() => expect(mocks.toastWarning).toHaveBeenCalled());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.refresh).toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("botão Salvar alterações fica desabilitado sem TOTP válido de 6 dígitos — não chama fetch nem abre o AlertDialog", async () => {
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
    fireEvent.change(screen.getByLabelText("Seu código dinâmico (TOTP) *"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: /salvar alterações/i }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(
      expect.stringMatching(/código dinâmico.*6 dígitos/i),
    ));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
