"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Filter, ChevronDown, ChevronUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface FilterPanelProps {
  materiais: { id: string; nome: string; categoria: string }[];
  militares: { id: string; nome_completo: string; matricula: string; posto: string }[];
  postos: string[];
}

export function FilterPanel({ materiais, militares, postos }: FilterPanelProps) {
  const router = useRouter();
  const sp = useSearchParams();
  const [advanced, setAdvanced] = useState(false);

  const [from, setFrom] = useState(sp.get("from") ?? "");
  const [to, setTo] = useState(sp.get("to") ?? "");
  const [status, setStatus] = useState(sp.get("status") ?? "");
  const [materialId, setMaterialId] = useState(sp.get("material_id") ?? "");
  const [militaryId, setMilitaryId] = useState(sp.get("military_id") ?? "");
  const [posto, setPosto] = useState(sp.get("posto") ?? "");

  function apply() {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (status) params.set("status", status);
    if (materialId) params.set("material_id", materialId);
    if (militaryId) params.set("military_id", militaryId);
    if (posto) params.set("posto", posto);
    router.push(`/reserva/relatorios?${params.toString()}`);
  }

  function reset() {
    setFrom(""); setTo(""); setStatus(""); setMaterialId(""); setMilitaryId(""); setPosto("");
    router.push("/reserva/relatorios");
  }

  const hasFilters = from || to || status || materialId || militaryId || posto;

  return (
    <div className="rounded-2xl bg-card p-5 space-y-4 print:hidden" style={{ boxShadow: "var(--shadow-card)" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Filter className="size-4 text-primary" />
          <span className="text-sm font-semibold">Filtros</span>
          {hasFilters && (
            <span className="text-[10px] font-bold bg-primary text-primary-foreground rounded-full px-2 py-0.5">ativo</span>
          )}
        </div>
        <button
          onClick={() => setAdvanced(!advanced)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {advanced ? "Ocultar avançados" : "Filtros avançados"}
          {advanced ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs">De</Label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Até</Label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Status</Label>
          <Select value={status || "todos"} onValueChange={v => { if (v) setStatus(v === "todos" ? "" : v); }}>
            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="ativo">Ativo</SelectItem>
              <SelectItem value="devolvido">Devolvido</SelectItem>
              <SelectItem value="perdido">Perdido</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {advanced && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-border">
          <div className="space-y-1.5">
            <Label className="text-xs">Material</Label>
            <Select value={materialId || "todos"} onValueChange={v => { if (v) setMaterialId(v === "todos" ? "" : v); }}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {materiais.map(m => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Militar</Label>
            <Select value={militaryId || "todos"} onValueChange={v => { if (v) setMilitaryId(v === "todos" ? "" : v); }}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {militares.map(m => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.nome_completo} <span className="font-mono text-xs">{m.matricula}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Posto</Label>
            <Select value={posto || "todos"} onValueChange={v => { if (v) setPosto(v === "todos" ? "" : v); }}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {postos.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" onClick={apply} className="h-8 text-xs px-4">Aplicar filtros</Button>
        {hasFilters && (
          <Button size="sm" variant="ghost" onClick={reset} className="h-8 text-xs gap-1">
            <X className="size-3" />Limpar
          </Button>
        )}
      </div>
    </div>
  );
}
