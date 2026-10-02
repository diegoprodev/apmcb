import { describe, it, expect } from "vitest";
import { sanitizeCell } from "./spreadsheet-safe";

describe("sanitizeCell", () => {
  it("neutraliza fórmulas (= + - @ tab CR) e preserva texto normal e números", () => {
    for (const bad of ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\t=1", "\r=1"]) expect(sanitizeCell(bad)).toBe(`'${bad}`);
    expect(sanitizeCell("Fulano da Silva")).toBe("Fulano da Silva");
    expect(sanitizeCell("a=b")).toBe("a=b");
    expect(sanitizeCell(42)).toBe(42);
    expect(sanitizeCell(-5)).toBe(-5);
  });
});
