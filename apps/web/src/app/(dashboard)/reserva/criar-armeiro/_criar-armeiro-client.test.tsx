// Cobre "Reenviar e-mail de acesso?" (AlertDialog) em CriarArmeiroClient.
//
// O fluxo novo: doCreate → (militar já selecionado) → sendLoginInvite →
// bffFetch("POST", "/api/admin/users/enviar-acesso"). Como NEXT_PUBLIC_BFF_URL
// é "" no teste, o bffFetch chama fetch("/api/admin/users/enviar-acesso").
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

  await waitFor(() => expect(screen.getByText(PROFILE.nome_completo)).toBeInTheDocument(), { timeout: 2000 });
  fireEvent.click(screen.getByText(PROFILE.nome_completo));
  await waitFor(() => expect(screen.getByText(/E-mail de acesso enviado há/)).toBeInTheDocument());
}

describe("CriarArmeiroClient — 'Reenviar e-mail de acesso?' (AlertDialog)", () => {
  it("Cancelar fecha o diálogo sem chamar o endpoint de acesso", async () => {
    await selectExistingProfile();

    fireEvent.click(screen.getByRole("button", { name: /reenviar e-mail de acesso/i }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledTimes(1); // só a busca (GET)
  });

  it("Confirmar chama POST /api/admin/users/enviar-acesso com user_id e mostra sucesso", async () => {
    await selectExistingProfile();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      headers: { get: () => null },
      json: async () => ({ ok: true, email_sent: true }),
    });

    fireEvent.click(screen.getByRole("button", { name: /reenviar e-mail de acesso/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Reenviar" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    const [, postCall] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(String(postCall[0])).toContain("/api/admin/users/enviar-acesso");
    const body = JSON.parse(postCall[1].body);
    expect(body.user_id).toBe(PROFILE.id);
    expect(body.email).toBe(PROFILE.email);

    await waitFor(() => expect(screen.getByText("E-mail de acesso reenviado!")).toBeInTheDocument());
  });

  it("erro do endpoint mantém o diálogo aberto e mostra toast", async () => {
    await selectExistingProfile();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: { get: () => null },
      json: async () => ({ error: "Internal server error" }),
    });

    fireEvent.click(screen.getByRole("button", { name: /reenviar e-mail de acesso/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Reenviar" }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(screen.queryByText("E-mail de acesso reenviado!")).not.toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});
