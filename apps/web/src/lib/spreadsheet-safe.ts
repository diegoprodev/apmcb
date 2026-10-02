// Injeção de fórmula em CSV/XLSX: texto que começa com = + - @ (ou tab/CR) é interpretado como fórmula
// pelo Excel/Sheets. Prefixa com apóstrofo para virar texto. Números reais passam intactos.
export function sanitizeCell<T extends string | number>(cell: T): T | string {
  if (typeof cell !== "string") return cell;
  return /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
}
