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
      />
    );
    const card = await screen.findByTestId("cautela-card");
    expect(card).toHaveTextContent("Em revisão");
    expect(card).not.toHaveTextContent("Ativa");
  });

  it("mostra 'Ativa' quando as duas assinaturas estão presentes", async () => {
    render(
      <MinhasCautelasClient initialCautelas={[makeCautela()]} hasMore={false} currentLimit={10} role="usuario" />
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
