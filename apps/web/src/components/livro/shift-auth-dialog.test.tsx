// Mesma classe de achado CRÍTICO já corrigido em SignDialog (nenhum teste
// cobria o plumbing de props pro BiometricCaptureDialog, e um caller
// esqueceu de passar documentHash, quebrando 100% da assinatura via
// biometria em silêncio). ShiftAuthDialog recebeu o mesmo tratamento
// (BiometricCaptureDialog real, props reserveId/expectedUserId/documentId
// por variant open/close) e tinha zero cobertura — este arquivo fecha essa
// lacuna antes que o mesmo bug se repita aqui.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ShiftAuthDialog } from "./shift-auth-dialog";
import type { BiometricResult } from "@/components/biometric/biometric-capture-dialog";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/bff-client", () => ({
  bffFetch: vi.fn().mockResolvedValue({ ok: false, status: 404, data: {} }),
}));

vi.mock("@/components/biometric/biometric-capture-dialog", () => ({
  BiometricCaptureDialog: (props: {
    reserveId?: string; expectedUserId?: string; documentId?: string; purpose?: string; canCapture?: boolean; simulationUserId?: string;
    onResult?: (r: BiometricResult) => void;
  }) => (
    <div data-testid="mock-biometric-capture">
      <span data-testid="mock-bio-props">
        {JSON.stringify({
          reserveId: props.reserveId, expectedUserId: props.expectedUserId,
          documentId: props.documentId, purpose: props.purpose, canCapture: props.canCapture, simulationUserId: props.simulationUserId,
        })}
      </span>
      <button data-testid="mock-bio-success" onClick={() => props.onResult?.({
        challenge: { id: "ch-1", status: "completed", expires_at: "", consumed_at: null },
        proof: { id: "proof-1", result: "success", failure_reason: null, match_score: 0.99, finger_index: 1, created_at: "" },
        matched_user: null,
      })}>trigger-success</button>
      <button data-testid="mock-bio-failure" onClick={() => props.onResult?.({
        challenge: { id: "ch-1", status: "completed", expires_at: "", consumed_at: null },
        proof: { id: "proof-2", result: "failure", failure_reason: "sem correspondência", match_score: 0.1, finger_index: 1, created_at: "" },
        matched_user: null,
      })}>trigger-failure</button>
    </div>
  ),
}));

afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); });

function openBiometriaTab() {
  fireEvent.click(screen.getByRole("tab", { name: /Biometria/i }));
}

describe("ShiftAuthDialog — plumbing da prova biométrica pro BiometricCaptureDialog", () => {
  it("abertura de turno: purpose=open_shift, documentId nunca enviado (nenhum turno existe ainda)", () => {
    render(
      <ShiftAuthDialog
        open title="Assumir Turno" confirmLabel="Assumir Turno" submitting={false}
        onConfirm={vi.fn()} onCancel={vi.fn()}
        variant="open" reserveId="reserve-1" canCapture currentUserId="user-1"
      />
    );
    openBiometriaTab();
    const props = JSON.parse(screen.getByTestId("mock-bio-props").textContent!);
    expect(props).toMatchObject({ reserveId: "reserve-1", expectedUserId: "user-1", purpose: "open_shift" });
    expect(props.documentId).toBeUndefined();
  });

  it("encerramento de turno: purpose=close_shift, documentId=shiftId (amarra a prova ao turno concreto)", () => {
    render(
      <ShiftAuthDialog
        open title="Encerrar Turno" confirmLabel="Encerrar Turno" submitting={false}
        onConfirm={vi.fn()} onCancel={vi.fn()}
        variant="close" shiftId="shift-1" reserveId="reserve-1" canCapture currentUserId="user-1"
      />
    );
    openBiometriaTab();
    const props = JSON.parse(screen.getByTestId("mock-bio-props").textContent!);
    expect(props).toMatchObject({ reserveId: "reserve-1", expectedUserId: "user-1", purpose: "close_shift", documentId: "shift-1" });
  });

  // Achado da revisão (2026-09-29): o turno por digital é 1:1 com o próprio
  // armeiro. Sem usuário, a captura mandaria esperado vazio/nulo (o servidor
  // agora recusa). O diálogo nem monta a captura e explica em texto amigável.
  it("sem currentUserId: nunca monta a captura e explica sem termo técnico", () => {
    render(
      <ShiftAuthDialog
        open title="Assumir Turno" confirmLabel="Assumir Turno" submitting={false}
        onConfirm={vi.fn()} onCancel={vi.fn()}
        variant="open" reserveId="reserve-1" canCapture currentUserId=""
      />
    );
    openBiometriaTab();
    expect(screen.queryByTestId("mock-biometric-capture")).not.toBeInTheDocument();
    expect(screen.getByText(/Não foi possível preparar a biometria agora. Use o código dinâmico/)).toBeInTheDocument();
  });

  it("repassa canCapture=false (sem leitor) mesmo com reserva e usuário", () => {
    render(
      <ShiftAuthDialog
        open title="Assumir Turno" confirmLabel="Assumir Turno" submitting={false}
        onConfirm={vi.fn()} onCancel={vi.fn()}
        variant="open" reserveId="reserve-1" canCapture={false} currentUserId="user-1"
      />
    );
    openBiometriaTab();
    const props = JSON.parse(screen.getByTestId("mock-bio-props").textContent!);
    expect(props.canCapture).toBe(false);
    expect(props.expectedUserId).toBe("user-1");
  });

  // Achado da revisão (2026-09-29): o Livro não passava simulationUserId e
  // o simulador ficava em "Aguardando o dedo" para sempre (dev/staging/E2E).
  it("simulador: a digital simulada é sempre a do próprio armeiro (turno é autoautenticação)", () => {
    render(
      <ShiftAuthDialog
        open title="Assumir Turno" confirmLabel="Assumir Turno" submitting={false}
        onConfirm={vi.fn()} onCancel={vi.fn()}
        variant="open" reserveId="reserve-1" canCapture currentUserId="user-1" simulatorEnabled
      />
    );
    openBiometriaTab();
    expect(JSON.parse(screen.getByTestId("mock-bio-props").textContent!).simulationUserId).toBe("user-1");
  });

  // Achado da revisão (2026-09-29): no encerramento não há seletor de
  // reserva — pedir "Selecione a reserva" confundia.
  it("encerramento sem reserva do turno: explica sem mandar selecionar reserva", () => {
    render(
      <ShiftAuthDialog
        open title="Encerrar Turno" confirmLabel="Encerrar Turno" submitting={false}
        onConfirm={vi.fn()} onCancel={vi.fn()}
        variant="close" shiftId="shift-1" reserveId="" canCapture currentUserId="user-1"
      />
    );
    openBiometriaTab();
    expect(screen.getByText("Não foi possível identificar a reserva do turno. Use o código dinâmico.")).toBeInTheDocument();
    expect(screen.queryByText(/Selecione a reserva/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("mock-biometric-capture")).not.toBeInTheDocument();
  });

  // Guarda do reset ao fechar pelo pai (open=false direto), agora sem
  // setState dentro de efeito (lint react-hooks/set-state-in-effect).
  it("fechar pelo pai e reabrir limpa o código digitado e volta à aba de código", () => {
    const props = {
      title: "Assumir Turno", confirmLabel: "Assumir Turno", submitting: false,
      onConfirm: vi.fn(), onCancel: vi.fn(),
      variant: "open" as const, reserveId: "reserve-1", canCapture: true, currentUserId: "user-1",
    };
    const { rerender } = render(<ShiftAuthDialog open {...props} />);
    fireEvent.change(screen.getByTestId("shift-totp-input"), { target: { value: "123456" } });
    openBiometriaTab();

    rerender(<ShiftAuthDialog open={false} {...props} />);
    rerender(<ShiftAuthDialog open {...props} />);

    expect(screen.getByRole("tab", { name: /Código/i })).toHaveAttribute("aria-selected", "true");
    expect((screen.getByTestId("shift-totp-input") as HTMLInputElement).value).toBe("");
  });

  it("sem reserveId: pede a reserva e nunca monta o BiometricCaptureDialog", () => {
    render(
      <ShiftAuthDialog
        open title="Assumir Turno" confirmLabel="Assumir Turno" submitting={false}
        onConfirm={vi.fn()} onCancel={vi.fn()}
        variant="open" reserveId="" canCapture={false} currentUserId="user-1"
      />
    );
    openBiometriaTab();
    expect(screen.getByText(/Selecione a reserva para usar a biometria/i)).toBeInTheDocument();
    expect(screen.queryByTestId("mock-biometric-capture")).not.toBeInTheDocument();
  });

  it("resultado não-success (falha) nunca chama onConfirm", () => {
    const onConfirm = vi.fn();
    render(
      <ShiftAuthDialog
        open title="Assumir Turno" confirmLabel="Assumir Turno" submitting={false}
        onConfirm={onConfirm} onCancel={vi.fn()}
        variant="open" reserveId="reserve-1" canCapture currentUserId="user-1"
      />
    );
    openBiometriaTab();
    fireEvent.click(screen.getByTestId("mock-bio-failure"));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("resultado success chama onConfirm('biometria', undefined, proof.id)", () => {
    const onConfirm = vi.fn();
    render(
      <ShiftAuthDialog
        open title="Assumir Turno" confirmLabel="Assumir Turno" submitting={false}
        onConfirm={onConfirm} onCancel={vi.fn()}
        variant="open" reserveId="reserve-1" canCapture currentUserId="user-1"
      />
    );
    openBiometriaTab();
    fireEvent.click(screen.getByTestId("mock-bio-success"));
    expect(onConfirm).toHaveBeenCalledWith("biometria", undefined, "proof-1");
  });

  it("footer só mostra botão de confirmação na aba TOTP — biometria confirma via BiometricCaptureDialog", () => {
    render(
      <ShiftAuthDialog
        open title="Assumir Turno" confirmLabel="Assumir Turno" submitting={false}
        onConfirm={vi.fn()} onCancel={vi.fn()}
        variant="open" reserveId="reserve-1" canCapture currentUserId="user-1"
      />
    );
    expect(screen.getByTestId("shift-auth-confirm")).toBeInTheDocument();
    openBiometriaTab();
    expect(screen.queryByTestId("shift-auth-confirm")).not.toBeInTheDocument();
  });
});
