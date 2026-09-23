// Achado CRÍTICO de code review (revisão do wiring de biometria real em
// SignDialog): `_minhas-cautelas-client.tsx` não passava `documentHash` ao
// SignDialog, quebrando 100% das assinaturas via biometria na tela "Minhas
// Cautelas" (o desafio nascia com document_hash=null, o consumo comparava
// contra o document_hash real da cautela, sempre divergia → 401). Nenhum
// teste existia pra SignDialog — este arquivo cobre o plumbing de props pro
// BiometricCaptureDialog (singular vs lote), o fallback sem reserva/ator
// identificado, e que resultado não-sucesso nunca dispara submissão.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SignDialog } from "./sign-dialog";
import type { BiometricResult } from "@/components/biometric/biometric-capture-dialog";

const mocks = vi.hoisted(() => ({ bffFetch: vi.fn() }));

vi.mock("@/lib/bff-client", () => ({ bffFetch: mocks.bffFetch }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/use-biometric-simulator-available", () => ({
  useBiometricSimulatorAvailable: () => false,
}));

// Mock fino: expõe exatamente as props que importam pro achado CRÍTICO
// (reserveId/expectedUserId/documentId/documentHash/purpose) e dá ao teste
// controle direto sobre o `onResult` que o componente real só chamaria após
// um roundtrip completo com o BFF/bridge biométrico.
vi.mock("@/components/biometric/biometric-capture-dialog", () => ({
  BiometricCaptureDialog: (props: {
    reserveId?: string; expectedUserId?: string; documentId?: string; documentHash?: string;
    purpose?: string; onResult?: (r: BiometricResult) => void;
  }) => (
    <div data-testid="mock-biometric-capture">
      <span data-testid="mock-bio-props">
        {JSON.stringify({
          reserveId: props.reserveId, expectedUserId: props.expectedUserId,
          documentId: props.documentId, documentHash: props.documentHash, purpose: props.purpose,
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
beforeEach(() => {
  vi.clearAllMocks();
  // Default inócuo pro SelfTotpHint (montado por padrão — o dialog abre na
  // aba TOTP) — sem isto ele desestrutura `undefined` e derruba o teste com
  // unhandled rejection, mesmo quando o teste em si só olha pra aba biometria.
  mocks.bffFetch.mockResolvedValue({ ok: false, status: 404, data: {} });
});

function openBiometriaTab() {
  fireEvent.click(screen.getByRole("button", { name: /Biometria/i }));
}

describe("SignDialog — plumbing da prova biométrica pro BiometricCaptureDialog", () => {
  it("cautela singular: reserveId/expectedUserId/documentId/documentHash chegam intactos", () => {
    render(
      <SignDialog
        open cautelaId="c-1" role="militar"
        reserveId="reserve-1" expectedUserId="user-1" documentHash="hash-abc"
        onClose={vi.fn()} onDone={vi.fn()}
      />
    );
    openBiometriaTab();
    const props = JSON.parse(screen.getByTestId("mock-bio-props").textContent!);
    expect(props).toMatchObject({
      reserveId: "reserve-1", expectedUserId: "user-1",
      documentId: "c-1", documentHash: "hash-abc", purpose: "sign_cautela_militar",
    });
  });

  it("assinatura em lote: documentId/documentHash NÃO são enviados (1 prova cobre N cautelas)", () => {
    render(
      <SignDialog
        open cautelaId="c-1" role="armeiro"
        reserveId="reserve-1" expectedUserId="user-1" documentHash="hash-abc"
        batch={{ movementId: "m-1", count: 3 }}
        onClose={vi.fn()} onDone={vi.fn()}
      />
    );
    openBiometriaTab();
    const props = JSON.parse(screen.getByTestId("mock-bio-props").textContent!);
    expect(props.documentId).toBeUndefined();
    expect(props.documentHash).toBeUndefined();
  });

  it("sem reserveId/expectedUserId: mostra fallback e nunca monta o BiometricCaptureDialog", () => {
    render(
      <SignDialog open cautelaId="c-1" role="militar" onClose={vi.fn()} onDone={vi.fn()} />
    );
    openBiometriaTab();
    expect(screen.getByText(/Biometria indisponível/i)).toBeInTheDocument();
    expect(screen.queryByTestId("mock-biometric-capture")).not.toBeInTheDocument();
  });

  it("resultado não-success (falha) NUNCA dispara submissão nem onDone", () => {
    const onDone = vi.fn();
    render(
      <SignDialog
        open cautelaId="c-1" role="militar" reserveId="reserve-1" expectedUserId="user-1"
        onClose={vi.fn()} onDone={onDone}
      />
    );
    openBiometriaTab();
    fireEvent.click(screen.getByTestId("mock-bio-failure"));
    expect(mocks.bffFetch).not.toHaveBeenCalledWith("POST", expect.stringContaining("/sign-"), expect.anything());
    expect(onDone).not.toHaveBeenCalled();
  });

  it("resultado success envia biometric_proof_id certo e chama onDone", async () => {
    mocks.bffFetch.mockResolvedValue({ ok: true, status: 200, data: {} });
    const onDone = vi.fn();
    render(
      <SignDialog
        open cautelaId="c-1" role="militar" reserveId="reserve-1" expectedUserId="user-1"
        onClose={vi.fn()} onDone={onDone}
      />
    );
    openBiometriaTab();
    fireEvent.click(screen.getByTestId("mock-bio-success"));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.bffFetch).toHaveBeenCalledWith(
      "POST", "/api/cautelamentos/c-1/sign-militar", { biometric_proof_id: "proof-1" }
    );
  });
});
