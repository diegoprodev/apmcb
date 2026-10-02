import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ListPagination, PAGE_SIZE_OPTIONS } from "./list-pagination";

afterEach(cleanup);
const setup = (over: Partial<Parameters<typeof ListPagination>[0]> = {}) => {
  const onPageChange = vi.fn(); const onPageSizeChange = vi.fn();
  render(<ListPagination page={2} pageSize={10} total={25} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} {...over} />);
  return { onPageChange, onPageSizeChange };
};

describe("ListPagination", () => {
  it("padrão 10/20/30/50", () => { expect([...PAGE_SIZE_OPTIONS]).toEqual([10, 20, 30, 50]); });
  it("mostra o intervalo e a página; anterior/próxima chamam onPageChange", () => {
    const { onPageChange } = setup();
    expect(screen.getByTestId("pg-range").textContent).toBe("11–20 de 25");
    fireEvent.click(screen.getByTestId("pg-prev")); expect(onPageChange).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByTestId("pg-next")); expect(onPageChange).toHaveBeenLastCalledWith(3);
  });
  it("desabilita anterior na 1ª e próxima na última página", () => {
    setup({ page: 1 }); expect((screen.getByTestId("pg-prev") as HTMLButtonElement).disabled).toBe(true);
    cleanup(); setup({ page: 3 }); expect((screen.getByTestId("pg-next") as HTMLButtonElement).disabled).toBe(true);
  });
  it("troca o tamanho da página", () => {
    const { onPageSizeChange } = setup();
    fireEvent.change(screen.getByTestId("pg-size"), { target: { value: "50" } });
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });
  it("lista vazia: 0 registros", () => { setup({ page: 1, total: 0 }); expect(screen.getByTestId("pg-range").textContent).toBe("0 registros"); });
});
