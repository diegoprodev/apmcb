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
    reserveId?: string; expectedUserId?: string; documentId?: string; purpose?: string;
    onResult?: (r: BiometricResult) => void;
  }) => (
    <div data-testid="mock-biometric-capture">
      <span data-testid="mock-bio-props">
        {JSON.stringify({
          reserveId: props.reserveId, expectedUserId: props.expectedUserId,
          documentId: props.documentId, purpose: props.purpose,
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

  it("sem reserveId: mostra fallback e nunca monta o BiometricCaptureDialog", () => {
    render(
      <ShiftAuthDialog
        open title="Assumir Turno" confirmLabel="Assumir Turno" submitting={false}
        onConfirm={vi.fn()} onCancel={vi.fn()}
        variant="open" reserveId="" canCapture={false} currentUserId="user-1"
      />
    );
    openBiometriaTab();
    expect(screen.getByText(/Biometria indisponível/i)).toBeInTheDocument();
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
