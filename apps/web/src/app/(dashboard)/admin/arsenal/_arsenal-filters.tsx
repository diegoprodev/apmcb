"use client";

import { useState, useMemo } from "react";
import { Search, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Package } from "lucide-react";
import { MaterialRowActions } from "./_arsenal-actions";

type MaterialRow = {
  id: string;
  nome: string;
  categoria: string;
  quantidade_total: number;
  quantidade_disponivel: number;
  quantidade_em_uso: number;
};

const CATEGORIA_LABELS: Record<string, string> = {
  arma:        "Arma",
  equipamento: "Equipamento",
  farda:       "Fardamento",
  acessorio:   "Acessório",
  outro:       "Outro",
};

function StockStatusBadge({ disponivel }: { disponivel: number }) {
  if (disponivel === 0) {
    return (
      <span className="badge-danger text-[11px] font-semibold px-2.5 py-0.5 rounded-full">
        Crítico
      </span>
    );
  }
  if (disponivel <= 3) {
    return (
      <span className="badge-warning text-[11px] font-semibold px-2.5 py-0.5 rounded-full">
        Atenção
      </span>
    );
  }
  return (
    <span className="badge-success text-[11px] font-semibold px-2.5 py-0.5 rounded-full">
      Disponível
    </span>
  );
}

function AvailabilityBar({ total, emUso }: { total: number; emUso: number }) {
  const pct = total > 0 ? Math.round((emUso / total) * 100) : 0;
  const color = pct >= 100 ? "#DC2626" : pct >= 75 ? "#D97706" : "#1B3A8C";
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[11px] text-muted-foreground w-8 text-right tabular-nums">
        {pct}%
      </span>
    </div>
  );
}

export function ArsenalTable({ rows }: { rows: MaterialRow[] }) {
  const [search, setSearch] = useState("");
  const [categoria, setCategoria] = useState("todas");

  const categorias = useMemo(() => {
    const unique = [...new Set(rows.map((r) => r.categoria))].sort();
    return unique;
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    if (categoria && categoria !== "todas") {
      list = list.filter((m) => m.categoria === categoria);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((m) => m.nome.toLowerCase().includes(q));
    }
    return list;
  }, [rows, search, categoria]);

  return (
    <div
      className="rounded-2xl bg-card overflow-hidden"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-3 p-4 border-b border-border">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Buscar material..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="arsenal-search"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Filter className="size-4 text-muted-foreground" />
          <Select value={categoria} onValueChange={setCategoria}>
            <SelectTrigger className="w-44" data-testid="arsenal-categoria-filter">
              <SelectValue placeholder="Todas categorias" />
            </SelectTrigger>
            <SelectContent className="bg-background">
              <SelectItem value="todas">Todas categorias</SelectItem>
              {categorias.map((c) => (
                <SelectItem key={c} value={c}>
                  {CATEGORIA_LABELS[c] ?? c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="p-12 text-center">
          <Package className="size-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">
            {rows.length === 0 ? "Nenhum material cadastrado" : "Nenhum material encontrado"}
          </p>
          {rows.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">Tente ajustar os filtros</p>
          )}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="border-b border-border hover:bg-transparent">
              <TableHead className="pl-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Material
              </TableHead>
              <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">
                Categoria
              </TableHead>
              <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">
                Total
              </TableHead>
              <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">
                Disponível
              </TableHead>
              <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">
                Em uso
              </TableHead>
              <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">
                Ocupação
              </TableHead>
              <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Status
              </TableHead>
              <TableHead className="pr-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">
                Ações
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((m) => (
              <TableRow
                key={m.id}
                className="border-b border-border/60 hover:bg-muted/40 transition-colors"
                data-testid="arsenal-row"
              >
                <TableCell className="pl-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: "rgba(27,58,140,0.08)", color: "#1B3A8C" }}
                    >
                      <Package className="size-3.5" />
                    </div>
                    <span className="text-sm font-medium text-foreground">{m.nome}</span>
                  </div>
                </TableCell>
                <TableCell className="py-3 hidden sm:table-cell">
                  <span className="text-sm text-muted-foreground">
                    {CATEGORIA_LABELS[m.categoria] ?? m.categoria}
                  </span>
                </TableCell>
                <TableCell className="py-3 text-right">
                  <span className="text-sm font-medium tabular-nums">{m.quantidade_total}</span>
                </TableCell>
                <TableCell className="py-3 text-right">
                  <span className="text-sm font-semibold tabular-nums" style={{ color: "#166534" }}>
                    {m.quantidade_disponivel}
                  </span>
                </TableCell>
                <TableCell className="py-3 text-right">
                  <span className="text-sm font-semibold tabular-nums" style={{ color: "#92400E" }}>
                    {m.quantidade_em_uso}
                  </span>
                </TableCell>
                <TableCell className="py-3 hidden md:table-cell">
                  <AvailabilityBar total={m.quantidade_total} emUso={m.quantidade_em_uso} />
                </TableCell>
                <TableCell className="py-3">
                  <StockStatusBadge disponivel={m.quantidade_disponivel} />
                </TableCell>
                <TableCell className="pr-5 py-3">
                  <MaterialRowActions material={{
                    id: m.id,
                    nome: m.nome,
                    categoria: m.categoria,
                    quantidade_total: m.quantidade_total,
                    quantidade_em_uso: m.quantidade_em_uso,
                  }} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
