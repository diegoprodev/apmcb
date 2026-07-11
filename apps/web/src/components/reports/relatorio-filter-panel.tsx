"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Filter, ChevronDown, ChevronUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AsyncComboBox } from "@/components/shared/async-combobox";
import { SearchableSelect } from "@/components/shared/searchable-select";
import type { MaterialOption, ProfileOption, RecordType } from "./types";

interface RelatorioFilterPanelProps {
  /** Rota da página — ex: "/reserva/relatorios" ou "/admin/relatorios" */
  basePath: string;
  materiais: MaterialOption[];
  postos: string[];
}

async function searchProfiles(query: string): Promise<ProfileOption[]> {
  const res = await fetch(`/api/admin/search-profiles?q=${encodeURIComponent(query)}`, {
    credentials: "include",
  });
  if (!res.ok) return [];
  return res.json();
}

async function lookupProfileById(id: string): Promise<ProfileOption | null> {
  const res = await fetch(`/api/admin/search-profiles?id=${encodeURIComponent(id)}`, {
    credentials: "include",
  });
  if (!res.ok) return null;
  const data: ProfileOption[] = await res.json();
  return data[0] ?? null;
}

const TIPO_OPTIONS: { value: RecordType; label: string }[] = [
  { value: "saidas", label: "Saídas" },
  { value: "cautelas", label: "Cautelas" },
  { value: "livro", label: "Livro de Serviço" },
];

export function RelatorioFilterPanel({ basePath, materiais, postos }: RelatorioFilterPanelProps) {
  const router = useRouter();
  const sp = useSearchParams();
  const [advanced, setAdvanced] = useState(false);

  const [from, setFrom] = useState(sp.get("from") ?? "");
  const [to, setTo] = useState(sp.get("to") ?? "");
  const [tipo, setTipo] = useState<RecordType>((sp.get("tipo") as RecordType) || "saidas");
  const [status, setStatus] = useState(sp.get("status") ?? "");
  const [materialId, setMaterialId] = useState(sp.get("material_id") ?? "");
  const [categoria, setCategoria] = useState(sp.get("categoria") ?? "");
  const [calibre, setCalibre] = useState(sp.get("calibre") ?? "");
  const [militaryId, setMilitaryId] = useState(sp.get("military_id") ?? "");
  const [selectedMilitary, setSelectedMilitary] = useState<ProfileOption | null>(null);
  const [posto, setPosto] = useState(sp.get("posto") ?? "");

  // Hidrata o chip do AsyncComboBox quando a página recarrega com military_id na URL
  // (o combobox não tem o objeto completo, só o id vindo do query string).
  useEffect(() => {
    const id = sp.get("military_id");
    if (id && !selectedMilitary) {
      void lookupProfileById(id).then((p) => { if (p) setSelectedMilitary(p); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categorias = [...new Map(materiais.map((m) => [
    m.categoria_slug ?? m.categoria,
    { value: m.categoria_slug ?? m.categoria, label: m.categoria },
  ])).values()].sort((a, b) => a.label.localeCompare(b.label));
  const calibres = [...new Set(materiais
    .filter((m) => (m.categoria_slug ?? m.categoria) === "arma")
    .map((m) => m.calibre)
    .filter(Boolean) as string[])].sort();

  const materialOptions = materiais.map((m) => ({ value: m.id, label: m.nome }));
  const categoriaOptions = categorias;
  const calibreOptions = calibres.map((c) => ({ value: c, label: c }));
  const postoOptions = postos.map((p) => ({ value: p, label: p }));

  const showMaterialFilters = tipo === "saidas" || tipo === "cautelas";
  const showUsuarioFilter = tipo === "saidas" || tipo === "cautelas";

  function statusOptions(): { value: string; label: string }[] {
    if (tipo === "cautelas") {
      return [
        { value: "ativa", label: "Ativa" },
        { value: "devolvida", label: "Devolvida" },
        { value: "substituida", label: "Substituída" },
        { value: "em_revisao", label: "Em revisão" },
        { value: "cancelada", label: "Cancelada" },
      ];
    }
    if (tipo === "livro") {
      return [
        { value: "pendente", label: "Pendente" },
        { value: "resolvido", label: "Resolvido" },
      ];
    }
    return [
      { value: "ativo", label: "Ativo" },
      { value: "devolvido", label: "Devolvido" },
      { value: "perdido", label: "Perdido" },
    ];
  }
  const statusLabel = tipo === "livro" ? "Pendência" : "Status";

  function handleTipoChange(v: RecordType) {
    setTipo(v);
    // Vocabulário de status/material/usuário muda por tipo — evita enviar um
    // filtro inválido/sem sentido para o novo tipo selecionado.
    setStatus("");
    setMaterialId("");
    setCategoria("");
    setCalibre("");
    setMilitaryId("");
    setSelectedMilitary(null);
  }

  function apply() {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (tipo !== "saidas") params.set("tipo", tipo);
    if (status) params.set("status", status);
    if (showMaterialFilters) {
      if (materialId) params.set("material_id", materialId);
      if (categoria) params.set("categoria", categoria);
      if (calibre && categoria === "arma") params.set("calibre", calibre);
    }
    if (showUsuarioFilter && militaryId) params.set("military_id", militaryId);
    if (posto) params.set("posto", posto);
    router.push(`${basePath}?${params.toString()}`);
  }

  function reset() {
    setFrom(""); setTo(""); setTipo("saidas"); setStatus("");
    setMaterialId(""); setCategoria(""); setCalibre("");
    setMilitaryId(""); setSelectedMilitary(null); setPosto("");
    router.push(basePath);
  }

  const hasFilters = from || to || tipo !== "saidas" || status || materialId || categoria || calibre || militaryId || posto;

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
          <Label className="text-xs">{statusLabel}</Label>
          <SearchableSelect
            testId="filter-status"
            options={statusOptions()}
            value={status}
            onChange={setStatus}
            placeholder="Todos"
            allLabel="Todos"
          />
        </div>
      </div>

      {advanced && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-border">
          <div className="space-y-1.5">
            <Label className="text-xs">Tipo de Registro</Label>
            <SearchableSelect
              testId="filter-tipo-registro"
              options={TIPO_OPTIONS}
              value={tipo}
              onChange={(v) => handleTipoChange((v || "saidas") as RecordType)}
              placeholder="Saídas"
              allLabel="Saídas"
            />
          </div>
          {showMaterialFilters && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Material</Label>
                <SearchableSelect
                  testId="filter-material"
                  options={materialOptions}
                  value={materialId}
                  onChange={setMaterialId}
                  placeholder="Todos"
                  allLabel="Todos"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Categoria</Label>
                <SearchableSelect
                  testId="filter-categoria"
                  options={categoriaOptions}
                  value={categoria}
                  onChange={(v) => { setCategoria(v); setCalibre(""); }}
                  placeholder="Todas"
                  allLabel="Todas"
                />
              </div>
              {categoria === "arma" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Calibre</Label>
                  <SearchableSelect
                    testId="filter-calibre"
                    options={calibreOptions}
                    value={calibre}
                    onChange={setCalibre}
                    placeholder="Todos"
                    allLabel="Todos"
                  />
                </div>
              )}
            </>
          )}
          {showUsuarioFilter && (
            <div className="space-y-1.5">
              <Label className="text-xs">Usuário</Label>
              <AsyncComboBox<ProfileOption>
                testId="filter-usuario"
                selected={selectedMilitary}
                onSelect={(p) => { setSelectedMilitary(p); setMilitaryId(p?.id ?? ""); }}
                onSearch={searchProfiles}
                placeholder="Buscar por nome ou matrícula..."
                getLabel={(p) => p.nome_completo}
                getSecondary={(p) => p.matricula}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">Posto</Label>
            <SearchableSelect
              testId="filter-posto"
              options={postoOptions}
              value={posto}
              onChange={setPosto}
              placeholder="Todos"
              allLabel="Todos"
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" onClick={apply} className="h-8 text-xs px-4" data-testid="btn-aplicar-filtros">Aplicar filtros</Button>
        {hasFilters && (
          <Button size="sm" variant="ghost" onClick={reset} className="h-8 text-xs gap-1">
            <X className="size-3" />Limpar
          </Button>
        )}
      </div>
    </div>
  );
}
