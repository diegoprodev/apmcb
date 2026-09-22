// Achado MÉDIO de code review (revisão do lote de paginação/seleção/PDF/
// detalhe desta página): zero cobertura automatizada pra tudo isso — o
// próprio código já reconhece, em comentário, que "PDF sem seleção
// exportando só a página" é um achado CRÍTICO conhecido (já visto no
// Almoxarifado) fácil de reintroduzir silenciosamente numa regressão
// futura, mas nada protegia isso aqui. Cobre: paginação "Ver mais",
// seleção refletida no botão de PDF, abrir detalhe ao clicar na linha (sem
// abrir ao clicar no checkbox), e o fix de staleness do dialog de detalhe
// sob SSE/reload (re-deriva de `cautelas`, não guarda snapshot por valor).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CautelasClient } from "./_cautelas-client";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "tok" } } }) },
  }),
}));

// useSSERefresh abre EventSource real e depende de next/navigation
// (useRouter) — no-op aqui, o realtime em si não é o que este arquivo testa.
vi.mock("@/hooks/use-sse-refresh", () => ({
  useSSERefresh: () => {},
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

function makeCautela(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? "c-1",
    status: "ativa",
    motivo_emissao: "Uso pessoal do serviço",
    condicao_emissao: "bom",
    data_emissao: "2026-08-20T10:00:00Z",
    prazo_proxima_conferencia: null,
    armeiro_signature_id: "sig-armeiro-1",
    militar_signature_id: "sig-militar-1",
    movement_id: null,
    item: { id: "item-1", identificador_principal: "SN-001", status_operacional: "cautelado", material_type: { nome: "Pistola", categoria: "arma" } },
    militar: { id: "mil-1", nome_completo: "Fulano de Tal", matricula: "10001", posto: "Sd" },
    armeiro: { id: "arm-1", nome_completo: "Armeiro Um", matricula: "20001" },
    ...overrides,
  };
}

function makeManyCautelas(n: number) {
  return Array.from({ length: n }, (_, i) => makeCautela({
    id: `c-${i}`,
    item: { id: `item-${i}`, identificador_principal: `SN-${i}`, status_operacional: "cautelado", material_type: { nome: `Material ${i}`, categoria: "arma" } },
  }));
}

// GET /api/auth/me (resolve role) e GET /api/cautelamentos (lista) são as 2
// chamadas do useEffect inicial — a ordem bate com a leitura do arquivo real.
function mockInitialLoad(cautelas: unknown[], role = "armeiro") {
  (global.fetch as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ cautelamentos: cautelas }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ user: { role } }) });
}

describe("CautelasClient — paginação 'Ver mais'", () => {
  it("mostra 10 por padrão e expande pra 20 ao escolher no menu 'Ver mais'", async () => {
    mockInitialLoad(makeManyCautelas(15));
    render(<CautelasClient />);

    await waitFor(() => expect(screen.getAllByTestId("cautela-row")).toHaveLength(10));
    expect(screen.getByText("Mostrando 10 de 15")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("btn-ver-mais"));
    fireEvent.click(screen.getByTestId("btn-limit-20"));

    await waitFor(() => expect(screen.getAllByTestId("cautela-row")).toHaveLength(15));
  });

  it("sem 'Ver mais' quando há 10 ou menos cautelas", async () => {
    mockInitialLoad(makeManyCautelas(5));
    render(<CautelasClient />);

    await waitFor(() => expect(screen.getAllByTestId("cautela-row")).toHaveLength(5));
    expect(screen.queryByTestId("btn-ver-mais")).not.toBeInTheDocument();
  });
});

describe("CautelasClient — seleção via checkbox reflete no botão de PDF", () => {
  it("sem seleção nenhuma, botão de PDF não mostra contador", async () => {
    mockInitialLoad(makeManyCautelas(3));
    render(<CautelasClient />);
    await waitFor(() => expect(screen.getAllByTestId("cautela-row")).toHaveLength(3));

    const pdfButton = screen.getByTestId("btn-export-cautelas-pdf");
    expect(within(pdfButton).queryByText(/^[0-9]+$/)).not.toBeInTheDocument();
  });

  it("selecionar um item mostra '1' no botão de PDF — exporta só o marcado, não a lista inteira", async () => {
    mockInitialLoad(makeManyCautelas(3));
    render(<CautelasClient />);
    await waitFor(() => expect(screen.getAllByTestId("cautela-row")).toHaveLength(3));

    const checkboxes = screen.getAllByRole("checkbox").filter((el) => el.getAttribute("aria-label") !== null || el.closest("thead") === null);
    // Primeiro checkbox de linha (grade mode é o default — cada card tem 1 checkbox aria-labeled).
    fireEvent.click(checkboxes.find((el) => el.getAttribute("aria-label")?.startsWith("Selecionar cautela")) ?? checkboxes[0]);

    const pdfButton = screen.getByTestId("btn-export-cautelas-pdf");
    await waitFor(() => expect(within(pdfButton).getByText("1")).toBeInTheDocument());
  });
});

describe("CautelasClient — badge de status reflete pendência de assinatura", () => {
  it("mostra 'Em revisão' (não 'Ativa') quando falta a assinatura do usuário", async () => {
    const cautela = makeCautela({ armeiro_signature_id: "sig-armeiro-1", militar_signature_id: null });
    mockInitialLoad([cautela]);
    render(<CautelasClient />);
    // Pendente não aparece na aba "Ativa" (default) — só em "Em revisão".
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ cautelamentos: [cautela] }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Em revisão" }));
    await waitFor(() => expect(screen.getAllByTestId("cautela-row")).toHaveLength(1));

    const row = screen.getByTestId("cautela-row");
    expect(within(row).getByText("Em revisão")).toBeInTheDocument();
    expect(within(row).queryByText("Ativa")).not.toBeInTheDocument();
  });

  it("mostra 'Ativa' só quando as duas assinaturas estão presentes", async () => {
    mockInitialLoad([makeCautela({ armeiro_signature_id: "sig-armeiro-1", militar_signature_id: "sig-militar-1" })]);
    render(<CautelasClient />);
    await waitFor(() => expect(screen.getAllByTestId("cautela-row")).toHaveLength(1));

    const row = screen.getByTestId("cautela-row");
    expect(within(row).getByText("Ativa")).toBeInTheDocument();
    expect(within(row).queryByText("Em revisão")).not.toBeInTheDocument();
  });

  it("bloco de pendência de assinatura some quando a cautela já está totalmente ativa", async () => {
    mockInitialLoad([makeCautela({ armeiro_signature_id: "sig-armeiro-1", militar_signature_id: "sig-militar-1" })]);
    render(<CautelasClient />);
    await waitFor(() => expect(screen.getAllByTestId("cautela-row")).toHaveLength(1));

    expect(screen.queryByText("Acautelador assinou")).not.toBeInTheDocument();
    expect(screen.queryByText("Usuário assinou")).not.toBeInTheDocument();
  });
});

describe("CautelasClient — aba 'Em revisão'", () => {
  it("filtra só as cautelas com assinatura pendente; aba 'Ativa' mostra só as completas", async () => {
    const cautelas = [
      makeCautela({ id: "c-completa", armeiro_signature_id: "sig-a", militar_signature_id: "sig-m" }),
      makeCautela({ id: "c-pendente", armeiro_signature_id: "sig-a", militar_signature_id: null }),
    ];
    mockInitialLoad(cautelas);
    render(<CautelasClient />);
    // Carga inicial (aba "Ativa" default): só a completa passa no filtro.
    await waitFor(() => expect(screen.getAllByTestId("cautela-row")).toHaveLength(1));
    expect(within(screen.getByTestId("cautela-row")).getByText("Ativa")).toBeInTheDocument();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ cautelamentos: cautelas }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Em revisão" }));
    await waitFor(() => expect(screen.getAllByTestId("cautela-row")).toHaveLength(1));
    expect(within(screen.getByTestId("cautela-row")).getByText("Em revisão")).toBeInTheDocument();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ cautelamentos: cautelas }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Ativa" }));
    await waitFor(() => expect(screen.getAllByTestId("cautela-row")).toHaveLength(1));
    expect(within(screen.getByTestId("cautela-row")).getByText("Ativa")).toBeInTheDocument();
  });
});

describe("CautelasClient — rótulo 'Acautelador' (não 'Armeiro')", () => {
  it("badge de pendência de assinatura usa 'Acautelador', nunca 'Armeiro'", async () => {
    const cautela = makeCautela({ armeiro_signature_id: null, militar_signature_id: null });
    mockInitialLoad([cautela]);
    render(<CautelasClient />);
    // Cautela pendente não aparece na aba "Ativa" (default) — só em "Todas"/"Em revisão".
    // Trocar de aba dispara um novo GET /api/cautelamentos (filterStatus muda).
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ cautelamentos: [cautela] }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Todas" }));
    await waitFor(() => expect(screen.getAllByTestId("cautela-row")).toHaveLength(1));

    const row = screen.getByTestId("cautela-row");
    expect(within(row).getByText("Acautelador pendente")).toBeInTheDocument();
    expect(within(row).queryByText("Armeiro pendente")).not.toBeInTheDocument();
  });
});

describe("CautelasClient — dialog de detalhe", () => {
  it("clicar no card abre o detalhe; clicar no checkbox não abre nada", async () => {
    mockInitialLoad([makeCautela()]);
    render(<CautelasClient />);
    await waitFor(() => expect(screen.getAllByTestId("cautela-row")).toHaveLength(1));

    fireEvent.click(screen.getByLabelText("Selecionar cautela de Pistola"));
    expect(screen.queryByText("Militar responsável")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("cautela-row"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Militar responsável")).toBeInTheDocument();
    expect(within(dialog).getByText("Sd Fulano de Tal")).toBeInTheDocument();
  });

  it("reflete dado atualizado após reload — não fica preso no snapshot de quando abriu (fix de staleness sob SSE)", async () => {
    const pendente = makeCautela({ militar_signature_id: null });
    mockInitialLoad([pendente]);
    render(<CautelasClient />);
    // Pendente não aparece na aba "Ativa" (default) — usa "Todas" pra ver ela.
    // mockImplementation (não mockResolvedValueOnce) porque abrir o dialog de
    // detalhe/trocar de aba pode disparar fetches extras cuja ordem exata não
    // é o que este teste verifica — só que o GET de cautelamentos sempre
    // reflita o estado atual de `current`.
    let current = [pendente];
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/cautelamentos") && !url.includes("/api/cautelamentos/")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ cautelamentos: current }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ user: { role: "armeiro" } }) });
    });
    fireEvent.click(screen.getByRole("button", { name: "Todas" }));
    await waitFor(() => expect(screen.getAllByTestId("cautela-row")).toHaveLength(1));

    fireEvent.click(screen.getByTestId("cautela-row"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Usuário pendente")).toBeInTheDocument();

    // Simula o realtime/refresh manual recarregando com a assinatura do
    // militar já feita em outra aba.
    current = [makeCautela({ militar_signature_id: "sig-militar-1" })];
    fireEvent.click(screen.getByTestId("btn-refresh-cautelas"));

    // O dialog continua aberto (mesma cautela, mesmo id) e agora reflete o
    // dado novo — não fica preso no snapshot de "pendente" de quando abriu.
    // Com as duas assinaturas presentes a cautela vira "Ativa" de verdade —
    // o bloco de pendência (que só existe em "em_revisao") some por completo,
    // não fica "OK/OK" pendurado (decisão de produto 2026-09-22).
    await waitFor(() => expect(within(dialog).getByText("Ativa")).toBeInTheDocument());
    expect(within(dialog).queryByText("Usuário pendente")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Usuário assinou")).not.toBeInTheDocument();
  });
});
