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

describe("GridPdfButton — armeiroLabel", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="print-target"><table><tbody><tr><td>x</td></tr></tbody></table></div>';
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
