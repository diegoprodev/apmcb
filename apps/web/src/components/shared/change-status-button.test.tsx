// Achado 2026-09-30: o BFF passou a recusar que armeiro/admin_reserva
// ("master") mude a situação de quem está em impedimento administrativo —
// só o administrador aplica e só ele retira. A tela oferecia "Ativar conta"
// e "Desativar conta" para um impedido, e as duas derrubariam o impedimento.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ChangeStatusButton } from "./change-status-button";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

afterEach(cleanup);

function renderButton(callerRole: "admin" | "master", currentStatus: Parameters<typeof ChangeStatusButton>[0]["currentStatus"]) {
  return render(
    <ChangeStatusButton userId="u1" userName="Fulano" currentStatus={currentStatus} callerRole={callerRole} />,
  );
}

describe("ChangeStatusButton — impedimento só o administrador altera", () => {
  it("master diante de impedido: nenhuma ação, e explica o porquê (feedback imediato)", () => {
    renderButton("master", "impedimento_administrativo");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("Somente o administrador pode remover o impedimento.")).toBeInTheDocument();
  });

  it("admin diante de impedido: oferece 'Remover Impedimento'", () => {
    renderButton("admin", "impedimento_administrativo");
    expect(screen.getByRole("button", { name: /Remover Impedimento/i })).toBeInTheDocument();
  });

  it("master diante de inativo: continua podendo ativar", () => {
    renderButton("master", "inactive");
    expect(screen.getByRole("button", { name: /Ativar conta/i })).toBeInTheDocument();
  });
});
