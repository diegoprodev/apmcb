// Achado ALTO de code review (revisão confirmatória do fix do bug de
// aninhamento AlertDialog/Dialog): o AlertDialog genérico tinha teste
// (alert-dialog.test.tsx), mas nenhum dos 3 fluxos de PRODUÇÃO migrados de
// window.confirm tinha cobertura — nem unitária, nem e2e. Este arquivo cobre
// o fluxo "Desativar material?" (o único dos 3 sem Dialog pai — pode ser
// testado isolado sem a fixture de aninhamento).
//
// Mock de next/navigation e @/lib/bff-client seguindo o mesmo padrão já
// provado em (dashboard)/layout.test.tsx (vi.hoisted + vi.mock).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ArsenalClient } from "./_arsenal-client";
import type { ArsenalMaterialItem } from "@/lib/arsenal-status";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  bffFetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/bff-client", () => ({
  bffFetch: mocks.bffFetch,
}));

afterEach(cleanup);
// Achado ao rodar pela 1ª vez: sem isto, `mocks.refresh`/`mocks.bffFetch`
// acumulavam chamadas de um teste pro próximo (são os mesmos vi.fn(),
// declarados uma vez via vi.hoisted) — 2 dos 4 testes davam falso-positivo/
// falso-negativo por contagem contaminada.
beforeEach(() => { vi.clearAllMocks(); });

function makeMaterial(overrides: Partial<ArsenalMaterialItem> = {}): ArsenalMaterialItem {
  return {
    id: "mat-1",
    nome: "Colete balístico",
    categoria: "equipamento",
    quantidade_total: 10,
    quantidade_disponivel: 8,
    quantidade_armada: 2,
    category_id: "cat-1",
    quantidade_em_uso_fisico: 0,
    categoria_ativa: true,
    ...overrides,
  };
}

describe("ArsenalClient — 'Desativar material?' (AlertDialog, grupo simples)", () => {
  it("Cancelar fecha o diálogo sem chamar o BFF", async () => {
    render(<ArsenalClient items={[makeMaterial()]} canRequest={false} canManageDirectly />);

    fireEvent.click(screen.getByTestId("btn-delete-material"));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Desativar material?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(mocks.bffFetch).not.toHaveBeenCalled();
  });

  it("Confirmar chama DELETE /api/arsenal/:id e atualiza a lista em caso de sucesso", async () => {
    mocks.bffFetch.mockResolvedValue({ ok: true, status: 200, data: {}, requestId: "r1" });
    const material = makeMaterial();
    render(<ArsenalClient items={[material]} canRequest={false} canManageDirectly />);

    fireEvent.click(screen.getByTestId("btn-delete-material"));
    fireEvent.click(await screen.findByRole("button", { name: "Desativar" }));

    await waitFor(() => expect(mocks.bffFetch).toHaveBeenCalledWith("DELETE", `/api/arsenal/${material.id}`));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    // Fecha assim que confirma (antes do await) — não fica preso esperando a
    // resposta do BFF; mesmo padrão dos outros itens do "grupo simples".
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("erro do BFF não trava o botão em loading para sempre (deletingId é limpo no finally)", async () => {
    mocks.bffFetch.mockResolvedValue({ ok: false, status: 409, data: { error: "Insufficient stock" }, requestId: "r1" });
    const material = makeMaterial();
    render(<ArsenalClient items={[material]} canRequest={false} canManageDirectly />);

    fireEvent.click(screen.getByTestId("btn-delete-material"));
    fireEvent.click(await screen.findByRole("button", { name: "Desativar" }));

    await waitFor(() => expect(mocks.bffFetch).toHaveBeenCalled());
    // Sem sucesso, router.refresh() não é chamado — a lista velha continua.
    expect(mocks.refresh).not.toHaveBeenCalled();
    // O botão de deletar volta a ficar habilitado (deletingId!==m.id) depois
    // do erro — se o `finally` de confirmDeleteMaterial fosse removido/
    // quebrado, o Loader2 ficaria preso aqui indefinidamente.
    await waitFor(() => expect(screen.getByTestId("btn-delete-material")).not.toBeDisabled());
  });

  it("guarda de concorrência: enquanto um DELETE está em voo, clicar em excluir outro material não abre um 2º diálogo", async () => {
    // Promise que só resolve quando o teste mandar — simula o DELETE de A
    // ainda "em voo" no momento em que o usuário clica em excluir B.
    let resolveDeleteA: (v: { ok: boolean; status: number; data: unknown; requestId: string }) => void = () => {};
    mocks.bffFetch.mockReturnValue(new Promise((resolve) => { resolveDeleteA = resolve; }));

    const matA = makeMaterial({ id: "mat-a", nome: "Colete A" });
    const matB = makeMaterial({ id: "mat-b", nome: "Colete B" });
    render(<ArsenalClient items={[matA, matB]} canRequest={false} canManageDirectly />);

    const deleteButtons = screen.getAllByTestId("btn-delete-material");
    fireEvent.click(deleteButtons[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Desativar" }));

    // Diálogo de A já fechou (grupo simples fecha antes do await), DELETE
    // de A ainda pendente (deletingId === "mat-a").
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    // Achado de code review original: sem o guard `if (deletingId) return;`
    // em handleDeleteMaterial, este clique abriria o AlertDialog de B
    // normalmente, permitindo um 2º DELETE concorrente.
    fireEvent.click(screen.getAllByTestId("btn-delete-material")[1]);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(mocks.bffFetch).toHaveBeenCalledTimes(1);

    resolveDeleteA({ ok: true, status: 200, data: {}, requestId: "r1" });
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());

    // Depois que A termina, B volta a poder ser excluído normalmente.
    fireEvent.click(screen.getAllByTestId("btn-delete-material")[1]);
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  });
});

// Achado real do dono (2026-09-09): na grade, o cabeçalho do grupo mostrava a
// categoria ("VEICULO") e cada linha mostrava só `nome` — que nesse acervo é
// um rótulo genérico ("VIATURA"). Duas viaturas ficavam indistinguíveis, e a
// linha parecia um segundo cabeçalho de categoria. Estes testes travam as
// duas metades do fix: (1) linha de identificação por item, (2) hierarquia
// visual grupo × item.
function viatura(overrides: Partial<ArsenalMaterialItem> = {}): ArsenalMaterialItem {
  return makeMaterial({
    id: "vtr-1",
    nome: "VIATURA",
    categoria: "VEICULO",
    categoria_slug: "veiculo",
    requires_vehicle_fields: true,
    vehicle_plate: "ABC1234",
    vehicle_model: "Hilux SW4",
    vehicle_color: "Prata",
    vehicle_year: 2021,
    ...overrides,
  });
}

describe("ArsenalClient — identificação do item na listagem", () => {
  it("grade: mostra placa e modelo do veículo abaixo do nome", () => {
    render(<ArsenalClient items={[viatura()]} canRequest={false} canManageDirectly={false} />);

    const identity = screen.getByTestId("material-identity");
    expect(identity).toHaveTextContent("ABC-1234");
    expect(identity).toHaveTextContent("Hilux SW4");
  });

  it("grade: duas viaturas de mesmo nome ficam distinguíveis", () => {
    render(
      <ArsenalClient
        items={[
          viatura(),
          viatura({ id: "vtr-2", vehicle_plate: "XYZ5678", vehicle_model: "Ranger", vehicle_color: "Branca", vehicle_year: 2019 }),
        ]}
        canRequest={false}
        canManageDirectly={false}
      />
    );

    const textos = screen.getAllByTestId("material-identity").map((el) => el.textContent);
    expect(textos).toHaveLength(2);
    expect(new Set(textos).size).toBe(2);
  });

  it("lista: a mesma identificação aparece na tabela", () => {
    render(<ArsenalClient items={[viatura()]} canRequest={false} canManageDirectly={false} />);
    fireEvent.click(screen.getByTitle("Ver em lista"));

    expect(screen.getAllByTestId("material-identity")[0]).toHaveTextContent("ABC-1234");
  });

  it("não renderiza a linha de identificação quando não há nada que identifique o material", () => {
    render(<ArsenalClient items={[makeMaterial()]} canRequest={false} canManageDirectly={false} />);
    expect(screen.queryByTestId("material-identity")).not.toBeInTheDocument();
  });

  it("arma serializada com várias unidades mostra calibre e contagem, nunca uma série inventada", () => {
    render(
      <ArsenalClient
        items={[makeMaterial({ nome: "PISTOLA", categoria: "ARMA", categoria_slug: "arma", calibre: ".40", has_serial_numbers: true, quantidade_total: 3 })]}
        canRequest={false}
        canManageDirectly={false}
      />
    );

    const identity = screen.getByTestId("material-identity");
    expect(identity).toHaveTextContent("Cal. .40");
    expect(identity).toHaveTextContent("3 unidades");
  });
});

describe("ArsenalClient — hierarquia grupo × item na grade", () => {
  const doisGrupos = [viatura(), makeMaterial({ id: "col-1", nome: "COLETE", categoria: "COLETE" })];

  it("mostra o cabeçalho de cada categoria quando nenhum filtro de categoria está ativo", () => {
    render(<ArsenalClient items={doisGrupos} canRequest={false} canManageDirectly={false} />);
    expect(screen.getAllByTestId("arsenal-category-header")).toHaveLength(2);
  });

  it("suprime o cabeçalho redundante quando o filtro de categoria deixa um único grupo", () => {
    render(<ArsenalClient items={doisGrupos} canRequest={false} canManageDirectly={false} />);

    fireEvent.click(screen.getByTitle("Mostrar/ocultar filtros"));
    fireEvent.change(screen.getByTestId("arsenal-categoria-select"), { target: { value: "VEICULO" } });

    expect(screen.queryByTestId("arsenal-category-header")).not.toBeInTheDocument();
    // O item filtrado continua visível — some o cabeçalho, não o conteúdo.
    expect(screen.getByTestId("material-identity")).toHaveTextContent("ABC-1234");
  });

  it("mantém o cabeçalho de categoria no alvo oculto de impressão mesmo com filtro ativo", () => {
    const { container } = render(<ArsenalClient items={doisGrupos} canRequest={false} canManageDirectly={false} />);

    fireEvent.click(screen.getByTitle("Mostrar/ocultar filtros"));
    fireEvent.change(screen.getByTestId("arsenal-categoria-select"), { target: { value: "VEICULO" } });

    const printTarget = container.querySelector("#arsenal-armeiro-print");
    expect(printTarget).not.toBeNull();
    expect(printTarget).toHaveTextContent("VEICULO");
    // PDF também precisa identificar o item, não só nomeá-lo.
    expect(printTarget).toHaveTextContent("ABC-1234");
  });
});
