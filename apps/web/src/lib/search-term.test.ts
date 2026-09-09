import { describe, it, expect } from "vitest";
import { sanitizeSearchTerm } from "./search-term";

describe("sanitizeSearchTerm", () => {
  it("passa nome, matrícula e e-mail intactos (`.` `@` `-` `_` são literais no ilike)", () => {
    expect(sanitizeSearchTerm("Silva Santos")).toBe("Silva Santos");
    expect(sanitizeSearchTerm("526690-1")).toBe("526690-1");
    expect(sanitizeSearchTerm("joao.silva@pmpb.pb.gov.br")).toBe("joao.silva@pmpb.pb.gov.br");
    expect(sanitizeSearchTerm("nome_de.guerra+tag@x.com")).toBe("nome_de.guerra+tag@x.com");
  });

  it("remove vírgula, parênteses e barra (quebram o parser do .or do PostgREST)", () => {
    expect(sanitizeSearchTerm("x,role.eq.admin_global")).toBe("x role.eq.admin_global");
    expect(sanitizeSearchTerm("a)or(b")).toBe("a or b");
    expect(sanitizeSearchTerm("a\\b")).toBe("a b");
  });

  it("colapsa espaços e apara", () => {
    expect(sanitizeSearchTerm("  a   b  ")).toBe("a b");
  });

  it("limita o comprimento", () => {
    expect(sanitizeSearchTerm("a".repeat(200)).length).toBe(80);
    expect(sanitizeSearchTerm("a".repeat(200), 10).length).toBe(10);
  });

  it("string vazia / só metacaracteres → vazio", () => {
    expect(sanitizeSearchTerm("")).toBe("");
    expect(sanitizeSearchTerm(",,,()")).toBe("");
  });
});
