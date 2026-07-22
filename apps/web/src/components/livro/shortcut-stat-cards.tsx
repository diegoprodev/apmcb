"use client";

import { cn } from "@/lib/utils";

export type ShortcutFilter = "all" | "pending" | "cautela";

interface ShortcutStatCardsProps {
  eventos: number;
  pendencias: number;
  cautelas: number;
  activeFilter: ShortcutFilter;
  onSelect: (filter: ShortcutFilter) => void;
}

// Cards de atalho de verdade — achado 1.2 do spec de redesign: antes eram
// <div> decorativos sem onClick, violação direta do princípio do CLAUDE.md
// ("cards de atalho: contagens em tempo real eliminam navegação
// desnecessária"). Semântica de <button>, não <div onClick> (guia de design
// system, seção 18).
export function ShortcutStatCards({ eventos, pendencias, cautelas, activeFilter, onSelect }: ShortcutStatCardsProps) {
  const cards: Array<{ filter: ShortcutFilter; value: number; label: string; valueClass?: string }> = [
    { filter: "all", value: eventos, label: "Eventos" },
    { filter: "pending", value: pendencias, label: "Pendências", valueClass: "text-orange-600" },
    { filter: "cautela", value: cautelas, label: "Cautelas", valueClass: "text-blue-600" },
  ];

  return (
    <div className="grid grid-cols-3 gap-3">
      {cards.map(card => (
        <button
          key={card.filter}
          type="button"
          onClick={() => onSelect(activeFilter === card.filter ? "all" : card.filter)}
          aria-pressed={card.filter !== "all" && activeFilter === card.filter}
          className={cn(
            "rounded-xl border bg-card p-3 text-center transition-colors hover:bg-accent/30",
            activeFilter === card.filter && card.filter !== "all" && "ring-2 ring-primary",
          )}
        >
          <div className={cn("text-2xl font-bold", card.valueClass)}>{card.value}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{card.label}</div>
        </button>
      ))}
    </div>
  );
}
