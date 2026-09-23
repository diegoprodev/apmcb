// Bug "Minhas Cautelas": uma cautela aparecia com o badge verde "Ativa" ao
// MESMO tempo que "Aguard. sua assinatura" — o badge de status usava o
// `status` cru do banco ("ativa" desde a emissão, antes de qualquer
// assinatura). Regra correta: só é "Ativa" com as DUAS assinaturas
// (armeiro + militar); enquanto qualquer uma estiver pendente, o status
// exibido E filtrado é "Em revisão".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  MinhasCautelasClient,
  deriveCautelaDisplayStatus,
  type Cautela,
} from "./_minhas-cautelas-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/use-biometric-simulator-available", () => ({
  useBiometricSimulatorAvailable: () => false,
}));
// Default inócuo (404) pro SelfTotpHint dentro do SignDialog, que monta na
// aba TOTP por padrão assim que o dialog abre — sem isto o teste que abre o
// dialog (abaixo) derruba com unhandled rejection ao tentar `fetch` uma URL
// relativa fora de um browser real.
vi.mock("@/lib/bff-client", () => ({
  bffFetch: vi.fn().mockResolvedValue({ ok: false, status: 404, data: {} }),
}));

// Achado CRÍTICO de code review: esta página não passava `documentHash` ao
// SignDialog (a interface `Cautela` local nem declarava o campo) — o
// desafio biométrico nascia com document_hash=null e o consumo, que compara
// contra o document_hash REAL da cautela, sempre divergia (401). Mock fino
// só pra capturar o que chega ao BiometricCaptureDialog, sem simular o
// roundtrip completo do bridge.
vi.mock("@/components/biometric/biometric-capture-dialog", () => ({
  BiometricCaptureDialog: (props: { documentHash?: string; reserveId?: string }) => (
    <span data-testid="mock-bio-document-hash">{props.documentHash ?? ""}</span>
  ),
}));

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

function makeCautela(overrides: Partial<Cautela> = {}): Cautela {
  return {
    id: "c-1",
    status: "ativa",
    motivo_emissao: "Uso pessoal",
    condicao_emissao: "bom",
    data_emissao: "2026-08-20T10:00:00Z",
    prazo_proxima_conferencia: null,
    armeiro_signature_id: "sig-armeiro",
    militar_signature_id: "sig-militar",
    reserve_id: "reserve-1",
    document_hash: "hash-real-da-cautela",
    item: { id: "i-1", numero_serie: "SN1", material_type: { nome: "Baterias", categoria: "equipamento" } },
    armeiro: { nome_completo: "Armeiro Um", matricula: "20001" },
    ...overrides,
  };
}

describe("deriveCautelaDisplayStatus", () => {
  it("'ativa' com as duas assinaturas continua 'ativa'", () => {
    expect(deriveCautelaDisplayStatus(makeCautela())).toBe("ativa");
  });

  it("'ativa' sem a assinatura do militar vira 'em_revisao'", () => {
    expect(deriveCautelaDisplayStatus(makeCautela({ militar_signature_id: null }))).toBe("em_revisao");
  });

  it("'ativa' sem a assinatura do armeiro vira 'em_revisao'", () => {
    expect(deriveCautelaDisplayStatus(makeCautela({ armeiro_signature_id: null }))).toBe("em_revisao");
  });

  it("status terminal (devolvida) é preservado mesmo sem assinaturas", () => {
    expect(
      deriveCautelaDisplayStatus(makeCautela({ status: "devolvida", armeiro_signature_id: null, militar_signature_id: null }))
    ).toBe("devolvida");
  });
});

describe("MinhasCautelasClient — badge de status", () => {
  it("mostra 'Em revisão' e NÃO 'Ativa' quando a assinatura do militar está pendente", async () => {
    render(
      <MinhasCautelasClient
        initialCautelas={[makeCautela({ militar_signature_id: null })]}
        hasMore={false}
        currentLimit={10}
        role="usuario"
        userId="user-1"
      />
    );
    const card = await screen.findByTestId("cautela-card");
    expect(card).toHaveTextContent("Em revisão");
    expect(card).not.toHaveTextContent("Ativa");
  });

  it("mostra 'Ativa' quando as duas assinaturas estão presentes", async () => {
    render(
      <MinhasCautelasClient
        initialCautelas={[makeCautela()]}
        hasMore={false}
        currentLimit={10}
        role="usuario"
        userId="user-1"
      />
    );
    const card = await screen.findByTestId("cautela-card");
    expect(card).toHaveTextContent("Ativa");
    expect(card).not.toHaveTextContent("Em revisão");
  });
});

describe("MinhasCautelasClient — abas de filtro", () => {
  it("aba 'Ativas' exclui pendentes de assinatura; 'Em revisão' as inclui", async () => {
    render(
      <MinhasCautelasClient
        initialCautelas={[
          makeCautela({ id: "assinada", militar_signature_id: "s" }),
          makeCautela({ id: "pendente", militar_signature_id: null, item: { id: "i2", numero_serie: "SN2", material_type: { nome: "Rádio", categoria: "comunicação" } } }),
        ]}
        hasMore={false}
        currentLimit={10}
        role="usuario"
        userId="user-1"
      />
    );
    await waitFor(() => expect(screen.getAllByTestId("cautela-card")).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "Ativas" }));
    await waitFor(() => expect(screen.getAllByTestId("cautela-card")).toHaveLength(1));
    expect(screen.getByTestId("cautela-card")).toHaveTextContent("Baterias");

    fireEvent.click(screen.getByRole("button", { name: "Em revisão" }));
    await waitFor(() => expect(screen.getAllByTestId("cautela-card")).toHaveLength(1));
    expect(screen.getByTestId("cautela-card")).toHaveTextContent("Rádio");
  });
});

describe("MinhasCautelasClient — SignDialog recebe o document_hash real da cautela", () => {
  it("regressão: sem isso o desafio biométrico nasce com document_hash=null e o consumo sempre diverge (401)", async () => {
    render(
      <MinhasCautelasClient
        initialCautelas={[makeCautela({ militar_signature_id: null })]}
        hasMore={false}
        currentLimit={10}
        role="usuario"
        userId="user-1"
      />
    );
    fireEvent.click(await screen.findByRole("button", { name: /Assinar/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Biometria/i }));
    expect(await screen.findByTestId("mock-bio-document-hash")).toHaveTextContent("hash-real-da-cautela");
  });
});
