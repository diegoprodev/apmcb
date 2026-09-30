// Revisão 2026-09-30: o BFF passou a aplicar o teto de convite (canInvite) a
// QUALQUER edição de outra pessoa e a recusar que armeiro/admin_reserva mexa
// em quem está em impedimento. A tela não pode oferecer ação que vai dar 403
// (mesmo princípio do _edit-dialog: "nunca prometer 403").
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UserRowActions } from "./_user-actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/csrf", () => ({ csrfHeaders: () => ({}) }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}));

afterEach(cleanup);

function renderActions(callerRole: "admin_global" | "admin_reserva" | "armeiro", role: string, registration_status = "complete", id = "alvo-1") {
  return render(
    <UserRowActions
      user={{
        id, nome_completo: "Fulano", email: "f@x.com", role, registration_status,
        activeCount: 0, totp_configured: true, invite_sent_at: null, account_activated_at: "2026-01-01T00:00:00Z",
      } as never}
      currentUserId="eu"
      callerRole={callerRole}
    />,
  );
}

describe("UserRowActions — só oferece o que o servidor permite", () => {
  it("admin_reserva diante de um par admin_reserva: sem Editar e sem Desativar", () => {
    renderActions("admin_reserva", "admin_reserva");
    expect(screen.queryByTitle("Editar")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Desativar")).not.toBeInTheDocument();
  });

  it("admin_reserva diante de um armeiro (dentro do teto): Editar e Desativar disponíveis", () => {
    renderActions("admin_reserva", "armeiro");
    expect(screen.getByTitle("Editar")).toBeInTheDocument();
    expect(screen.getByTitle("Desativar")).toBeEnabled();
  });

  it("admin_reserva diante de um usuário em impedimento: Desativar desabilitado (só o administrador altera)", () => {
    renderActions("admin_reserva", "usuario", "impedimento_administrativo");
    expect(screen.getByRole("button", { name: "Desativar" })).toBeDisabled();
  });

  it("admin_global diante de um usuário em impedimento: Desativar disponível", () => {
    renderActions("admin_global", "usuario", "impedimento_administrativo");
    expect(screen.getByTitle("Desativar")).toBeEnabled();
  });

  it("o próprio operador: pode Editar a si mesmo, mas não se Desativar", () => {
    renderActions("admin_reserva", "admin_reserva", "complete", "eu");
    expect(screen.getByTitle("Editar")).toBeInTheDocument();
    expect(screen.queryByTitle("Desativar")).not.toBeInTheDocument();
  });
});
