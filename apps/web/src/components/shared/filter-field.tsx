"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface FilterFieldProps {
  /** Ícone opcional exibido antes do rótulo (ex: Building2, Tag, CircleDot). */
  icon?: ReactNode;
  /** Rótulo compacto exibido acima do campo (Fitts's Law: alvo de clique claro e próximo do controle). */
  label: string;
  /**
   * Texto explicativo mostrado no tooltip azul ao passar o mouse sobre o ícone de ajuda —
   * mesmo padrão visual dos ícones nos KpiCards (fundo `rgba(27,58,140,0.08)`, cor `#1B3A8C`).
   * Omitir quando o campo for autoexplicativo (ex: campo único "Buscar...").
   */
  tooltip?: string;
  /** Associa o <Label> ao id do controle interno (acessibilidade — não obrigatório). */
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Casca padrão (SSOT) para campos de painéis de filtro em todo o sistema.
 *
 * Aplica as 5 leis de UX (Jon Yablonski):
 * - Lei da Proximidade: espaçamento reduzido entre label e controle (gap-1) e
 *   entre campos irmãos (o container do painel deve usar gap-2/gap-3, não gap-4).
 * - Miller's Law: agrupa visualmente label + tooltip + controle como uma unidade.
 * - Fitts's Law: ícone de ajuda com área de toque adequada (size-3 + padding do botão).
 * - Jakob's Law: tooltip com o mesmo componente (`@/components/ui/tooltip`) já usado
 *   no restante do sistema (sidebar, nexus).
 * - Aesthetic-Usability Effect: hierarquia tipográfica compacta (text-xs font-medium)
 *   consistente em todos os filtros, sem "respiração" excessiva.
 *
 * Não define lógica de filtro — apenas apresentação. O controle real (Select, input,
 * ComboBox etc.) é passado como children e permanece inalterado.
 */
export function FilterField({ icon, label, tooltip, htmlFor, className, children }: FilterFieldProps) {
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center gap-1">
        <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground gap-1">
          {icon}
          {label}
        </Label>
        {tooltip && (
          <TooltipProvider delay={200}>
            <Tooltip>
              <TooltipTrigger
                type="button"
                aria-label={`Sobre o filtro ${label}`}
                className="inline-flex shrink-0 text-primary/60 hover:text-primary transition-colors"
              >
                <Info className="size-3" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-56">
                {tooltip}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      {children}
    </div>
  );
}

interface FilterGroupLabelProps {
  /** Ícone opcional exibido antes do texto (ex: CalendarIcon, Filter). */
  icon?: ReactNode;
  /** Texto curto do rótulo (ex: "Período:", "Categoria:"). */
  label: string;
  /** Texto explicativo do tooltip. Omitir quando autoexplicativo. */
  tooltip?: string;
  className?: string;
}

/**
 * Variante inline de {@link FilterField} para barras de filtro horizontais
 * (toolbar com ícone + rótulo curto + controles ao lado, ex: "Período: [de] até [até]").
 * Mesmo padrão de tooltip azul, sem forçar o empilhamento vertical label/controle.
 */
export function FilterGroupLabel({ icon, label, tooltip, className }: FilterGroupLabelProps) {
  return (
    <div className={cn("flex items-center gap-1.5 text-xs text-muted-foreground font-medium shrink-0", className)}>
      {icon}
      <span>{label}</span>
      {tooltip && (
        <TooltipProvider delay={200}>
          <Tooltip>
            <TooltipTrigger
              type="button"
              aria-label={`Sobre o filtro ${label}`}
              className="inline-flex shrink-0 text-primary/60 hover:text-primary transition-colors"
            >
              <Info className="size-3" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-56">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}
