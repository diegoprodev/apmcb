"use client";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { EVENT_TYPE_CONFIG, EVENT_TYPE_PRIMARY_ORDER, type EventType } from "@/lib/livro/event-type-config";

interface EventTypeFilterChipsProps {
  value: EventType | "";
  onChange: (v: EventType | "") => void;
  visibleTypes?: EventType[];
}

// Compartilhado entre armeiro (_livro-client.tsx) e admin
// (_shift-detail-client.tsx) — achado 1.3 do spec de redesign: antes eram
// duas implementações incompatíveis (busca livre só no armeiro; 4 de 11
// tipos hardcoded só no admin). Cobre os 11 tipos reais. Nunca mais de 4
// chips diretos visíveis (guia de design system, seção 15) — o resto fica
// atrás de "Mais tipos".
export function EventTypeFilterChips({ value, onChange, visibleTypes = EVENT_TYPE_PRIMARY_ORDER }: EventTypeFilterChipsProps) {
  const allTypes = Object.keys(EVENT_TYPE_CONFIG) as EventType[];
  const overflowTypes = allTypes.filter(t => !visibleTypes.includes(t));
  const activeInOverflow = value !== "" && overflowTypes.includes(value);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Button
        type="button"
        variant={value === "" ? "default" : "outline"}
        size="sm"
        className="text-xs"
        onClick={() => onChange("")}
      >
        Todos
      </Button>
      {visibleTypes.map(type => {
        const cfg = EVENT_TYPE_CONFIG[type];
        return (
          <Button
            key={type}
            type="button"
            variant={value === type ? "default" : "outline"}
            size="sm"
            className="text-xs"
            onClick={() => onChange(value === type ? "" : type)}
          >
            {cfg.label}
          </Button>
        );
      })}
      {overflowTypes.length > 0 && (
        <DropdownMenu>
          {/* DropdownMenuTrigger já renderiza um <button> (base-ui) — usar
          buttonVariants() para aplicar o estilo de Button sem aninhar
          <button> dentro de <button> (HTML inválido, causava erro de
          hidratação — achado de validação visual 2026-07-21). */}
          <DropdownMenuTrigger
            className={cn(buttonVariants({ variant: activeInOverflow ? "default" : "outline", size: "sm" }), "text-xs")}
          >
            {activeInOverflow ? EVENT_TYPE_CONFIG[value as EventType].label : "Mais tipos"}
            <ChevronDown className="h-3 w-3 ml-1" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {overflowTypes.map(type => (
              <DropdownMenuItem key={type} onClick={() => onChange(value === type ? "" : type)}>
                {EVENT_TYPE_CONFIG[type].label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
