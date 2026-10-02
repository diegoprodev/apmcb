"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { csrfHeaders } from "@/lib/csrf";
import { friendlyApiError } from "@/lib/api-error";
import {
  IMPORT_MAX_ROWS, IMPORT_TEMPLATE_CSV, parseImportFile,
  type ImportParseResult, type ImportRow,
} from "@/lib/militares-import";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

export interface ReserveTarget { id: string; nome: string; acronym: string | null; admin_state: "ok" | "pending_invite" | "no_admin" }
interface RowResult { line: number; matricula: string; email: string; status: string; message: string }

const STATUS_LABEL: Record<string, string> = {
  created_invited: "Cadastrado e convite enviado",
  created_invite_failed: "Cadastrado — convite não enviado",
  created_no_reserve: "Cadastrado sem reserva",
  exists: "Já cadastrado",
  email_in_use: "E-mail já em uso",
  duplicate_in_file: "Repetido no arquivo",
  blocked: "Reserva indisponível",
  error: "Erro",
  not_processed: "Não processado",
};
const OK_STATUS = new Set(["created_invited", "created_no_reserve"]);

/** Reservas onde o chamador pode adicionar membros (+ a oficial); compartilhado com o painel "sem reserva". */
export async function fetchReserveTargets(): Promise<{ reserves: ReserveTarget[]; defaultReserveId: string | null } | null> {
  try {
    const res = await fetch(`${BFF_URL}/api/admin/reserve-targets`, { credentials: "include" });
    if (!res.ok) {
      console.error("[militares] falha ao carregar reservas", { status: res.status });
      return null;
    }
    const body = (await res.json()) as { reserves?: ReserveTarget[]; default_reserve_id?: string | null };
    return { reserves: body.reserves ?? [], defaultReserveId: body.default_reserve_id ?? null };
  } catch (err) {
    console.error("[militares] falha ao carregar reservas", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export function ImportMilitaresButton() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState<(ImportParseResult & { fileName: string }) | null>(null);
  const [parsing, setParsing] = useState(false);
  const [targets, setTargets] = useState<ReserveTarget[] | null>(null);
  const [reserveId, setReserveId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<RowResult[] | null>(null);

  async function openDialog() {
    setOpen(true);
    setParsed(null); setResults(null);
    const t = await fetchReserveTargets();
    setTargets(t?.reserves ?? []);
    // Reserva oficial do importador; com uma só reserva, ela já vem escolhida.
    setReserveId(t?.defaultReserveId ?? (t && t.reserves.length === 1 && t.reserves[0].admin_state === "ok" ? t.reserves[0].id : ""));
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setParsing(true); setResults(null);
    try {
      setParsed({ ...(await parseImportFile(file)), fileName: file.name });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error("[militares] falha ao ler o arquivo", { error: reason });
      toast.error(reason === "file_too_large" ? "Arquivo grande demais (máx. 5 MB)."
        : reason === "too_many_rows" ? "Arquivo com linhas demais (máx. 5.000). Divida em partes."
        : "Não foi possível ler o arquivo. Use um .csv ou .xlsx válido.");
      setParsed(null);
    } finally {
      setParsing(false);
    }
  }

  async function submit(rows: ImportRow[]) {
    setSubmitting(true);
    const all: RowResult[] = [];
    try {
      for (let i = 0; i < rows.length; i += IMPORT_MAX_ROWS) {
        const res = await fetch(`${BFF_URL}/api/admin/militares/import`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...csrfHeaders() },
          body: JSON.stringify({ reserve_id: reserveId || null, rows: rows.slice(i, i + IMPORT_MAX_ROWS) }),
        });
        const data = await res.json().catch(() => ({})) as { results?: RowResult[]; error?: string };
        if (!res.ok || !data.results) {
          console.error("[militares] falha no import", { status: res.status, error: data.error });
          toast.error(friendlyApiError(res.status, data.error, "Não foi possível importar os usuários"));
          // Linhas não processadas ficam visíveis (e podem ser tentadas de novo): nada some em silêncio.
          for (const [k, row] of rows.slice(i).entries()) {
            all.push({ line: i + k + 1, matricula: row.matricula, email: row.email, status: "not_processed", message: "Não processado — tente importar novamente." });
          }
          break;
        }
        // O BFF numera por bloco: converte para o índice global do arquivo.
        all.push(...data.results.map((r) => ({ ...r, line: r.line + i })));
      }
    } finally {
      setSubmitting(false);
    }
    if (all.length > 0) {
      setResults(all);
      const ok = all.filter((r) => OK_STATUS.has(r.status)).length;
      const semConvite = all.filter((r) => r.status === "created_invite_failed").length;
      toast.success(`${ok} de ${all.length} usuário(s) importado(s).`);
      const naoProcessadas = all.filter((r) => r.status === "not_processed").length;
      if (naoProcessadas > 0) toast.warning(`${naoProcessadas} linha(s) não processada(s) — importe novamente (as já cadastradas aparecem como "Já cadastrado").`);
      if (semConvite > 0) toast.warning(`${semConvite} cadastrado(s) sem convite — reenvie pela lista de usuários.`);
      router.refresh();
    }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([IMPORT_TEMPLATE_CSV], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = "modelo-importacao-usuarios.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  const canSubmit = !!parsed && parsed.rows.length > 0 && !submitting && !results;
  const selectedTarget = targets?.find((t) => t.id === reserveId);

  return (
    <>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={openDialog} data-testid="btn-importar-usuarios">
        <Upload className="size-4" />
        Importar
      </Button>

      <Dialog open={open} onOpenChange={(o) => { if (!submitting) setOpen(o); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Importar usuários (CSV ou XLSX)</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <p className="text-xs text-muted-foreground">
              Colunas mínimas: <strong>nome</strong>, <strong>e-mail</strong> e <strong>matrícula</strong> (posto é opcional).{" "}
              <button type="button" className="underline hover:text-foreground" onClick={downloadTemplate}>Baixar modelo</button>
            </p>

            <div className="space-y-1.5">
              <label htmlFor="import-reserve" className="text-sm font-medium">Adicionar como membro de</label>
              <select
                id="import-reserve"
                value={reserveId}
                onChange={(e) => setReserveId(e.target.value)}
                disabled={submitting || !!results || targets === null}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">Sem reserva (vincular depois)</option>
                {(targets ?? []).map((t) => (
                  <option key={t.id} value={t.id} disabled={t.admin_state !== "ok"}>
                    {t.nome}{t.admin_state === "pending_invite" ? " — aguardando o aceite do convite do administrador" : t.admin_state === "no_admin" ? " — sem administrador" : ""}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground" role="note">
                {selectedTarget
                  ? "Ao importar, cada usuário vira membro desta reserva e recebe o convite por e-mail automaticamente."
                  : "Sem reserva, apenas o cadastro é feito e nenhum convite é enviado. Depois, use o filtro \"Sem reserva\" para adicionar."}
              </p>
            </div>

            <div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                data-testid="import-file-input"
                onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }}
              />
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => fileRef.current?.click()} disabled={parsing || submitting || !!results}>
                {parsing ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
                {parsed ? `Trocar arquivo (${parsed.fileName})` : "Escolher arquivo"}
              </Button>
            </div>

            {parsed && parsed.missingColumns.length > 0 && (
              <p className="text-sm text-red-600" role="alert">
                Colunas obrigatórias ausentes: {parsed.missingColumns.join(", ")}.
              </p>
            )}
            {parsed && parsed.missingColumns.length === 0 && !results && (
              <div className="space-y-2">
                <p className="text-sm">
                  <strong>{parsed.rows.length}</strong> linha(s) válida(s)
                  {parsed.errors.length > 0 && <>, <strong className="text-red-600">{parsed.errors.length}</strong> com problema (serão ignoradas)</>}.
                </p>
                {parsed.errors.length > 0 && (
                  <ul className="max-h-28 overflow-auto text-xs text-red-600 space-y-0.5" aria-label="Linhas com problema">
                    {parsed.errors.map((e) => <li key={e.line}>Linha {e.line}: {e.message}</li>)}
                  </ul>
                )}
              </div>
            )}

            {results && (
              <div className="space-y-2">
                <ul className="max-h-56 overflow-auto text-xs divide-y divide-border rounded-md border border-border" aria-label="Resultado da importação">
                  {results.map((r) => (
                    <li key={`${r.line}-${r.matricula}`} className="flex items-start justify-between gap-3 px-2 py-1.5">
                      <span className="font-mono">{r.matricula} · {r.email}</span>
                      <span className={OK_STATUS.has(r.status) ? "text-emerald-600" : r.status === "created_invite_failed" ? "text-amber-600" : "text-red-600"} title={r.message}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>{results ? "Fechar" : "Cancelar"}</Button>
              {!results && (
                <Button onClick={() => parsed && void submit(parsed.rows)} disabled={!canSubmit} data-testid="btn-confirmar-importacao">
                  {submitting ? <Loader2 className="size-4 animate-spin" /> : `Importar${parsed && parsed.rows.length ? ` ${parsed.rows.length}` : ""}`}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
