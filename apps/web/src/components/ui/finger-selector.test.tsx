import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FingerSelector, fingerName } from "./finger-selector";

afterEach(cleanup);

describe("fingerName", () => {
  it("nomeia os 10 dedos sem expor número (1-5 direita, 6-10 esquerda)", () => {
    expect(fingerName(1)).toBe("Polegar direito");
    expect(fingerName(5)).toBe("Mínimo direito");
    expect(fingerName(6)).toBe("Polegar esquerdo");
    expect(fingerName(7)).toBe("Indicador esquerdo");
    expect(fingerName(10)).toBe("Mínimo esquerdo");
  });
});

describe("FingerSelector", () => {
  it("mão esquerda aparece à esquerda da tela e a direita à direita", () => {
    const { container } = render(<FingerSelector value={null} onChange={vi.fn()} />);
    const labels = [...container.querySelectorAll("text")].map((t) => ({ text: t.textContent, x: Number(t.getAttribute("x")) }));
    const esquerda = labels.find((l) => l.text === "Mão esquerda")!;
    const direita = labels.find((l) => l.text === "Mão direita")!;
    expect(esquerda.x).toBeLessThan(direita.x);
  });

  it("clicar num dedo devolve o índice certo das duas mãos", () => {
    const onChange = vi.fn();
    render(<FingerSelector value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Indicador esquerdo" }));
    fireEvent.click(screen.getByRole("button", { name: "Polegar direito" }));
    expect(onChange).toHaveBeenNthCalledWith(1, 7);
    expect(onChange).toHaveBeenNthCalledWith(2, 1);
  });

  it("dedo cadastrado é sinalizado e o selecionado mostra o nome (nunca o número)", () => {
    render(<FingerSelector value={7} onChange={vi.fn()} registeredFingers={[10]} />);
    expect(screen.getByRole("button", { name: "Mínimo esquerdo — cadastrado" })).toBeInTheDocument();
    expect(screen.getByText(/Indicador esquerdo selecionado/)).toBeInTheDocument();
    expect(screen.queryByText(/Dedo 7/)).not.toBeInTheDocument();
  });

  it("somente leitura: só mostra os dedos cadastrados, sem botões nem seleção", () => {
    render(<FingerSelector readOnly registeredFingers={[7, 2]} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByRole("img", { name: "Indicador esquerdo — cadastrado" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Indicador direito — cadastrado" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Médio direito" })).toBeInTheDocument();
    expect(screen.getByText("2 dedos cadastrados")).toBeInTheDocument();
  });

  it("desabilitado não dispara onChange", () => {
    const onChange = vi.fn();
    render(<FingerSelector value={null} onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole("button", { name: "Médio direito" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
