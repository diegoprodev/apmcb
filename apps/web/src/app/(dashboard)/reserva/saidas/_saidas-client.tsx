"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Package, Plus, RotateCcw, Search, X, ChevronRight,
  CheckCircle2, Clock, Shield, Fingerprint, KeyRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DesarmamentoModal } from "./_desarmamento-modal";

type LendingRow = {
  id: string;
  quantidade: number;
  status_legacy: string;
  issued_at: string;
  returned_at: string | null;
  local: string | null;
  notes: string | null;
  auth_mode: string | null;
  movement_id: string | null;
  material_type: { nome: string; categoria: string } | null;
  military: { id: string; nome_completo: string; matricula: string; posto: string | null; foto_url: string | null } | null;
  master: { nome_completo: string; matricula: string } | null;
};

type MovementGroup = {
  key: string;
  movement_id: string | null;
  military: LendingRow["military"];
  issued_at: string;
  auth_mode: string | null;
  items: LendingRow[];
  allReturned: boolean;
};

// Agrupa por retirada: se há movement_id usa ele; senão usa military_id+issued_at
// (itens criados juntos na mesma operação compartilham issued_at idêntico)
function groupByRetirada(lendings: LendingRow[]): MovementGroup[] {
  const map = new Map<string, MovementGroup>();
  for (const l of lendings) {
    const key = l.movement_id ?? `${l.military?.id ?? "??"}_${l.issued_at}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        movement_id: l.movement_id,
        military: l.military,
        issued_at: l.issued_at,
        auth_mode: l.auth_mode,
        items: [],
        allReturned: false,
      });
    }
    map.get(key)!.items.push(l);
  }
  const groups = Array.from(map.values());
  for (const g of groups) {
    g.allReturned = g.items.every((i) => i.status_legacy === "devolvido");
  }
  return groups;
}

const AUTH_ICON: Record<string, React.ElementType> = {
  biometria: Fingerprint,
  totp: KeyRound,
  manual: Shield,
};

export function SaidasClient({
  saidas,
  currentStatus,
  role,
}: {
  saidas: LendingRow[];
  currentStatus: string;
  role: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [desarmamentoOpen, setDesarmamentoOpen] = useState(false);
  const [preselectedIds, setPreselectedIds] = useState<string[]>([]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return saidas;
    return saidas.filter((l) => {
      const nome = l.military?.nome_completo?.toLowerCase() ?? "";
      const matricula = l.military?.matricula?.toLowerCase() ?? "";
      const material = l.material_type?.nome?.toLowerCase() ?? "";
      return nome.includes(q) || matricula.includes(q) || material.includes(q);
    });
  }, [saidas, search]);

  const groups = useMemo(() => groupByRetirada(filtered), [filtered]);

  function openReceberGrupo(group: MovementGroup) {
    const activeIds = group.items.filter((i) => i.status_legacy === "ativo").map((i) => i.id);
    setPreselectedIds(activeIds);
    setDesarmamentoOpen(true);
  }

  const statusTabs = [
    { value: "", label: "Todas" },
    { value: "ativo", label: "Ativas" },
    { value: "devolvido", label: "Devolvidas" },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Saídas de Material</h2>
          <p className="text-muted-foreground text-sm mt-0.5">
            Controle de saídas e devoluções do almoxarifado
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setPreselectedIds([]); setDesarmamentoOpen(true); }}
            className="inline-flex items-center gap-1.5 border border-border bg-card text-sm font-medium px-4 py-2 rounded-lg hover:bg-muted/60 transition-colors"
          >
            <RotateCcw className="size-4" />
            Receber Material
          </button>
          <Link
            href="/reserva/saidas/nova"
            className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus className="size-4" />
            Nova Saída
          </Link>
        </div>
      </div>

      {/* Search + tabs */}
      <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, matrícula ou material..."
            className="w-full rounded-xl border border-input bg-card pl-9 pr-9 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          )}
        </div>
        <div className="flex rounded-xl border border-border overflow-hidden shrink-0">
          {statusTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => router.push(tab.value ? `/reserva/saidas?status=${tab.value}` : "/reserva/saidas")}
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors",
                currentStatus === tab.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:bg-muted/60"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Groups */}
      {groups.length === 0 ? (
        <div className="rounded-2xl bg-card p-10 text-center" style={{ boxShadow: "var(--shadow-card)" }}>
          <Package className="size-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium">Nenhuma saída encontrada</p>
          <p className="text-xs text-muted-foreground mt-1">
            {search ? "Tente outro termo de busca" : "Registre a primeira saída de material"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => {
            const AuthIcon = AUTH_ICON[group.auth_mode ?? "manual"] ?? Shield;
            const activeCount = group.items.filter((i) => i.status_legacy === "ativo").length;
            const formattedDate = new Date(group.issued_at).toLocaleDateString("pt-BR", {
              day: "2-digit", month: "short", year: "numeric",
            });
            return (
              <div
                key={group.key}
                className="rounded-2xl bg-card overflow-hidden"
                style={{ boxShadow: "var(--shadow-card)" }}
              >
                {/* Card header */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                  {group.military?.foto_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={group.military.foto_url}
                      alt={group.military.nome_completo}
                      className="size-9 rounded-full object-cover shrink-0"
                    />
                  ) : (
                    <div className="size-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-primary">
                        {group.military?.nome_completo?.slice(0, 2).toUpperCase() ?? "??"}
                      </span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">
                      {group.military?.posto ? `${group.military.posto} ` : ""}
                      {group.military?.nome_completo ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Mat. {group.military?.matricula ?? "—"} · {formattedDate}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span title={`Verificado via ${group.auth_mode ?? "manual"}`}>
                      <AuthIcon className="size-4 text-muted-foreground" />
                    </span>
                    {group.allReturned ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="size-3" /> Devolvido
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                        <Clock className="size-3" /> {activeCount} ativo{activeCount !== 1 ? "s" : ""}
                      </span>
                    )}
                    {!group.allReturned && (role === "armeiro" || role === "admin_global" || role === "admin_reserva") && (
                      <button
                        type="button"
                        onClick={() => openReceberGrupo(group)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary bg-primary/8 hover:bg-primary/15 border border-primary/20 px-2.5 py-1 rounded-lg transition-colors"
                      >
                        <RotateCcw className="size-3" />
                        Receber
                      </button>
                    )}
                  </div>
                </div>

                {/* Items */}
                <div className="divide-y divide-border">
                  {group.items.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.material_type?.nome ?? "—"}</p>
                        <p className="text-xs text-muted-foreground capitalize">{item.material_type?.categoria ?? "—"}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs text-muted-foreground">×{item.quantidade}</span>
                        <span className={cn(
                          "text-[11px] font-medium px-1.5 py-0.5 rounded",
                          item.status_legacy === "ativo"
                            ? "text-amber-700 bg-amber-50"
                            : "text-emerald-700 bg-emerald-50"
                        )}>
                          {item.status_legacy === "ativo" ? "Ativo" : "Devolvido"}
                        </span>
                      </div>
                      {item.status_legacy === "ativo" && (role === "armeiro" || role === "admin_global" || role === "admin_reserva") ? (
                        <button
                          type="button"
                          title="Receber este item"
                          onClick={() => { setPreselectedIds([item.id]); setDesarmamentoOpen(true); }}
                          className="p-1 rounded hover:bg-primary/10 text-muted-foreground/40 hover:text-primary transition-colors shrink-0"
                        >
                          <ChevronRight className="size-4" />
                        </button>
                      ) : (
                        <ChevronRight className="size-4 text-muted-foreground/20 shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de desarmamento */}
      <DesarmamentoModal
        open={desarmamentoOpen}
        onClose={() => setDesarmamentoOpen(false)}
        preselectedIds={preselectedIds}
        onSuccess={() => {
          setDesarmamentoOpen(false);
          router.refresh();
        }}
        role={role}
      />
    </div>
  );
}
