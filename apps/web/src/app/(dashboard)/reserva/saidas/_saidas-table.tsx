"use client";

import { useState } from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ReturnButton } from "./_return-button";
import { LendingDetailSheet, type SaidaRow } from "./_lending-detail-sheet";

interface Props {
  saidas: SaidaRow[];
}

export function SaidasTable({ saidas }: Props) {
  const [selected, setSelected] = useState<SaidaRow | null>(null);

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow className="border-b border-border hover:bg-transparent">
            <TableHead className="pl-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Material
            </TableHead>
            <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">
              Militar
            </TableHead>
            <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-center">
              Qtd
            </TableHead>
            <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">
              Data Saída
            </TableHead>
            <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">
              Local
            </TableHead>
            <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">
              Devolução
            </TableHead>
            <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Status
            </TableHead>
            <TableHead className="pr-5 py-3 w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {saidas.map((s) => (
            <TableRow
              key={s.id}
              data-testid={`saida-row-${s.id}`}
              className="border-b border-border/60 hover:bg-muted/40 transition-colors cursor-pointer"
              onClick={() => setSelected(s)}
            >
              <TableCell className="pl-5 py-3">
                <p className="font-medium text-sm">{s.material_type?.nome ?? "—"}</p>
                <p className="text-xs text-muted-foreground capitalize">
                  {s.material_type?.categoria ?? "—"}
                </p>
              </TableCell>
              <TableCell className="py-3 hidden sm:table-cell">
                <p className="text-sm font-medium">{s.military?.nome_completo ?? "—"}</p>
                <p className="font-mono text-xs text-muted-foreground">{s.military?.matricula ?? "—"}</p>
              </TableCell>
              <TableCell className="py-3 text-center text-sm">{s.quantidade}</TableCell>
              <TableCell className="py-3 hidden md:table-cell text-xs text-muted-foreground">
                {s.issued_at ? new Date(s.issued_at).toLocaleDateString("pt-BR") : "—"}
              </TableCell>
              <TableCell className="py-3 hidden md:table-cell text-xs text-muted-foreground">
                {s.local ?? "—"}
              </TableCell>
              <TableCell className="py-3 hidden md:table-cell text-xs text-muted-foreground">
                {s.returned_at ? new Date(s.returned_at).toLocaleDateString("pt-BR") : "—"}
              </TableCell>
              <TableCell className="py-3">
                <span
                  className={
                    s.status === "ativo"
                      ? "badge-in-use text-xs px-2 py-0.5 rounded-full font-medium"
                      : "badge-success text-xs px-2 py-0.5 rounded-full font-medium"
                  }
                >
                  {s.status === "ativo" ? "Ativo" : "Devolvido"}
                </span>
              </TableCell>
              <TableCell
                className="pr-5 py-3"
                onClick={(e) => e.stopPropagation()}
              >
                {s.status === "ativo" && (
                  <ReturnButton
                    saidaId={s.id}
                    materialNome={s.material_type?.nome ?? "material"}
                  />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <LendingDetailSheet
        saida={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
