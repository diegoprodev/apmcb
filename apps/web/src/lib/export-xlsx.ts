import { sanitizeCell } from "@/lib/spreadsheet-safe";

export async function exportToXlsx(rows: (string | number)[][], filename: string) {
  const { utils, writeFile } = await import("xlsx");
  const ws = utils.aoa_to_sheet(rows.map((r) => r.map(sanitizeCell)));
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, "Relatório");
  writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}
