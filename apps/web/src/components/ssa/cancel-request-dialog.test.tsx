// Primeiro teste de componente (@testing-library/react) deste repo — a
// dependência já estava instalada e configurada (vitest.config.ts +
// src/test/setup.ts), nunca usada. Achado de code review (MÉDIO-6): o
// contrato de CancelRequestDialog.onConfirm (throw mantém o dialog aberto e
// preserva o motivo digitado; resolve fecha e limpa) é consumido por
// SolicitacaoDetailSheet e SolicitacaoStatusCard, mas nenhum teste
// automatizado garantia isso — só verificado por leitura manual do código.
// O caminho real de submit (via bffFetch + BFF real) depende de sessão TOTP
// e não é alcançável em E2E sem ela (achado de infra pré-existente,
// documentado no CHANGELOG); testar o contrato aqui, com um `onConfirm`
// mockado, cobre exatamente a parte que os dois call sites realmente
// dependem estar correta, sem precisar de rede/browser real.
//
// fireEvent (não @testing-library/user-event, que não é dependência deste
// projeto) — dispara os eventos DOM reais que o componente escuta
// (onChange/onClick), suficiente pra este contrato.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CancelRequestDialog } from "./cancel-request-dialog";

const SHORT_REASON = "curto";
const VALID_REASON = "motivo com mais de dez caracteres";

// vitest.config.ts não usa `test.globals: true`, então o auto-cleanup do
// @testing-library/react (que depende de `afterEach` global) não roda
// sozinho aqui — sem isto, cada `render()` empilhava DOM do teste anterior
// e getByTestId passava a achar múltiplos elementos.
afterEach(cleanup);

describe("CancelRequestDialog", () => {
  it("botão de confirmar começa desabilitado e só habilita com >=10 caracteres", () => {
    render(<CancelRequestDialog open onOpenChange={() => {}} onConfirm={vi.fn()} />);

    const reasonInput = screen.getByTestId("ssa-cancel-reason");
    const confirmBtn = screen.getByTestId("btn-confirm-cancel");
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(reasonInput, { target: { value: SHORT_REASON } });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(reasonInput, { target: { value: VALID_REASON } });
    expect(confirmBtn).toBeEnabled();
  });

  it("onConfirm recebe o motivo já sem espaços nas pontas", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<CancelRequestDialog open onOpenChange={() => {}} onConfirm={onConfirm} />);

    fireEvent.change(screen.getByTestId("ssa-cancel-reason"), {
      target: { value: `  ${VALID_REASON}  ` },
    });
    fireEvent.click(screen.getByTestId("btn-confirm-cancel"));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(VALID_REASON));
  });

  it("onConfirm rejeitando mantém o dialog aberto, preserva o motivo e mostra o erro", async () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn().mockRejectedValue(new Error("Erro ao cancelar solicitação."));
    render(<CancelRequestDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} />);

    fireEvent.change(screen.getByTestId("ssa-cancel-reason"), { target: { value: VALID_REASON } });
    fireEvent.click(screen.getByTestId("btn-confirm-cancel"));

    await screen.findByText("Erro ao cancelar solicitação.");
    // Não fechou por conta própria — quem decide fechar em erro é o caller,
    // via onOpenChange, que aqui nunca deveria ter sido chamado com false.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByTestId("ssa-cancel-reason")).toHaveValue(VALID_REASON);
  });

  it("onConfirm resolvendo fecha o dialog (via onOpenChange) e limpa o motivo", async () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<CancelRequestDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} />);

    fireEvent.change(screen.getByTestId("ssa-cancel-reason"), { target: { value: VALID_REASON } });
    fireEvent.click(screen.getByTestId("btn-confirm-cancel"));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("motivo curto nunca chama onConfirm (botão permanece desabilitado)", () => {
    const onConfirm = vi.fn();
    render(<CancelRequestDialog open onOpenChange={() => {}} onConfirm={onConfirm} />);

    expect(screen.getByTestId("btn-confirm-cancel")).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
