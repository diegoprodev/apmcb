// Achado de review (2026-09-22): armeiroLabel (novo prop, permite o
// relatório de cautelas dizer "Acautelador" em vez de "Armeiro" no cabeçalho
// do PDF, sem afetar saídas/livro que continuam "Armeiro") não tinha nenhuma
// cobertura — uma regressão futura (ex.: alguém remove o prop achando dead
// code) não teria teste vermelho pra pegar.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GridPdfButton } from "./grid-pdf-button";

afterEach(cleanup);

function makeFakeWindow() {
  const doc = document.implementation.createHTMLDocument("");
  return {
    document: doc,
    documentElement: doc.documentElement,
    focus: vi.fn(),
    close: vi.fn(),
    print: vi.fn(),
  };
}

// Monta o alvo de impressão via createElement, sem atribuição direta de
// marcação — scanner OWASP do BFF (src/__tests__/owasp-input-safety-harness
// .test.ts) varre TODO apps/web/src procurando sinks de XSS por regex
// (bate até em menções dentro de comentário) e não distingue setup de teste
// de código de app para arquivos fora de __tests__/ (padrão co-localizado
// .test.tsx, usado por todo componente React deste projeto).
function buildPrintTarget(): HTMLElement {
  const container = document.createElement("div");
  container.id = "print-target";
  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.textContent = "x";
  tr.appendChild(td);
  tbody.appendChild(tr);
  table.appendChild(tbody);
  container.appendChild(table);
  return container;
}

describe("GridPdfButton — armeiroLabel", () => {
  beforeEach(() => {
    document.body.replaceChildren(buildPrintTarget());
  });

  it("usa 'Armeiro' por padrão quando armeiroLabel não é passado", async () => {
    const fakeWin = makeFakeWindow();
    vi.stubGlobal("open", vi.fn(() => fakeWin));

    render(<GridPdfButton printTargetId="print-target" armeiroName="Fulano" testId="btn-pdf" />);
    fireEvent.click(screen.getByTestId("btn-pdf"));
    await vi.waitFor(() => expect(fakeWin.document.body.textContent).toContain("Armeiro:"));
    expect(fakeWin.document.body.textContent).not.toContain("Acautelador:");
  });

  it("usa o rótulo custom quando armeiroLabel é passado (relatório de cautelas)", async () => {
    const fakeWin = makeFakeWindow();
    vi.stubGlobal("open", vi.fn(() => fakeWin));

    render(
      <GridPdfButton
        printTargetId="print-target"
        armeiroName="Fulano"
        armeiroLabel="Acautelador"
        testId="btn-pdf"
      />
    );
    fireEvent.click(screen.getByTestId("btn-pdf"));
    await vi.waitFor(() => expect(fakeWin.document.body.textContent).toContain("Acautelador:"));
    expect(fakeWin.document.body.textContent).not.toContain("Armeiro:");
  });
});
