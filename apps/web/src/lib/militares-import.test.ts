import { describe, it, expect } from "vitest";
import { parseImportMatrix } from "./militares-import";

describe("parseImportMatrix", () => {
  it("lê cabeçalho com sinônimos/acentos/ordem diferente e normaliza e-mail", () => {
    const r = parseImportMatrix([["Matrícula", "E-mail", "Nome Completo", "Graduação"], ["123", " FULANO@X.com ", " Fulano Silva ", "Soldado"]]);
    expect(r.missingColumns).toEqual([]);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([{ nome_completo: "Fulano Silva", email: "fulano@x.com", matricula: "123", posto: "Soldado" }]);
  });
  it("exige nome, e-mail e matrícula: coluna ausente é reportada e nada é importado", () => {
    const r = parseImportMatrix([["nome", "matricula"], ["Fulano", "1"]]);
    expect(r.missingColumns).toEqual(["e-mail"]);
    expect(r.rows).toEqual([]);
  });
  it("posto é opcional", () => {
    const r = parseImportMatrix([["nome", "email", "matricula"], ["Fulano Silva", "a@b.co", "9"]]);
    expect(r.rows[0].posto).toBeNull();
  });
  it("linhas inválidas viram erro com o número da linha da planilha; as boas seguem", () => {
    const r = parseImportMatrix([["nome", "email", "matricula"], ["", "a@b.co", "1"], ["Fulano Silva", "invalido", "2"], ["Beltrano Souza", "b@b.co", "3 4"], ["Ok Pessoa", "ok@b.co", "4"]]);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(r.errors[0].message).toContain("nome");
    expect(r.errors[1].message).toContain("e-mail");
    expect(r.errors[2].message).toContain("matrícula");
    expect(r.rows.map((x) => x.matricula)).toEqual(["4"]);
  });
  it("duplicata no arquivo (matrícula ou e-mail) é erro na 2ª ocorrência; linhas vazias são ignoradas", () => {
    const r = parseImportMatrix([["nome", "email", "matricula"], ["Um Dois", "a@b.co", "1"], ["", "", ""], ["Tres Quatro", "c@b.co", "1"], ["Cinco Seis", "A@b.co", "5"]]);
    expect(r.rows.map((x) => x.matricula)).toEqual(["1"]);
    expect(r.errors.map((e) => e.line)).toEqual([4, 5]);
  });
  it("arquivo vazio: pede as colunas mínimas", () => {
    expect(parseImportMatrix([]).missingColumns).toEqual(["nome", "e-mail", "matrícula"]);
  });
});

describe("parseImportMatrix — espelha o servidor", () => {
  it("rejeita nome/posto que começam com fórmula, nome >200, posto >60 e e-mail >254", () => {
    const long = "a".repeat(201);
    const r = parseImportMatrix([["nome", "email", "matricula", "posto"],
      ["=HYPERLINK(1)", "a@b.co", "1", ""], [long, "b@b.co", "2", ""], ["Nome Ok", "c@b.co", "3", "=x"], ["Nome Ok", `${"a".repeat(250)}@b.co`, "4", ""], ["Nome Ok", "d@b.co", "5", "b".repeat(61)]]);
    expect(r.rows).toEqual([]);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6]);
  });
});
