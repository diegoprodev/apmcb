import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MaterialIdentityLine } from "./material-identity-line";

afterEach(cleanup);

describe("MaterialIdentityLine", () => {
  it("renderiza identificadores literais em chip monoespaçado e o resto em texto secundário", () => {
    render(
      <MaterialIdentityLine
        material={{
          requires_vehicle_fields: true,
          vehicle_plate: "ABC1234",
          vehicle_model: "Hilux SW4",
          vehicle_color: "Prata",
          vehicle_year: 2021,
        }}
      />
    );

    const placa = screen.getByText("ABC-1234");
    expect(placa.className).toContain("font-mono");
    const descritivo = screen.getByText("Hilux SW4 · Prata 2021");
    expect(descritivo.className).not.toContain("font-mono");
  });

  it("não renderiza nada quando o material não tem identificação própria", () => {
    const { container } = render(<MaterialIdentityLine material={{ nome: "Cinto" }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("preserva a descrição íntegra no title quando ela é truncada", () => {
    const longa = "B".repeat(120);
    render(<MaterialIdentityLine material={{ descricao: longa }} />);
    expect(screen.getByTitle(longa)).toBeInTheDocument();
  });

  it("respeita maxParts para caber em linhas estreitas", () => {
    render(
      <MaterialIdentityLine
        maxParts={1}
        material={{ requires_vehicle_fields: true, vehicle_plate: "ABC1234", vehicle_model: "Hilux" }}
      />
    );
    expect(screen.getByText("ABC-1234")).toBeInTheDocument();
    expect(screen.queryByText("Hilux")).not.toBeInTheDocument();
  });
});
