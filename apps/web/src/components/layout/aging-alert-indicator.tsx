"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { RESERVE_STAFF_ROLES } from "@/lib/aging";

interface AgingAlertIndicatorProps {
  dbRole?: string;
  activeMode?: "usuario";
}

// Indicador de saídas em aberto há 24h+ na navbar (pedido de produto,
// 2026-09-22: "o alerta deve ser no navbar e em um card dentro do dashboard
// e na tela de saidas"). Exclusivo de saídas — nunca cautela. Sem SSE/live
// push como o sino de notificações: o corte de 24h não muda minuto a minuto,
// busca só ao montar já é suficiente.
export function AgingAlertIndicator({ dbRole, activeMode }: AgingAlertIndicatorProps) {
  const router = useRouter();
  const isReserveStaff = activeMode !== "usuario" && !!dbRole && RESERVE_STAFF_ROLES.includes(dbRole);
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch("/api/reserva/aging-count");
      if (res.ok) {
        const d = await res.json();
        setCount(d.count ?? 0);
      }
    } catch {
      // silent — mesmo padrão do NotificationBell (usuário pode ainda não estar logado)
    }
  }, []);

  useEffect(() => {
    if (isReserveStaff) fetchCount(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [isReserveStaff, fetchCount]);

  if (!isReserveStaff || count === 0) return null;

  return (
    <div className="relative group/aging">
      <button
        aria-label={`${count} saída${count > 1 ? "s" : ""} em aberto há mais de 24 horas`}
        onClick={() => router.push("/reserva/saidas?status=ativo")}
        className="relative p-2 rounded-lg hover:bg-red-500/10 transition-colors"
      >
        <AlertTriangle className="size-5 text-red-500" />
        <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white leading-none ring-2 ring-background">
          {count > 9 ? "9+" : count}
        </span>
      </button>
      <span className="pointer-events-none absolute top-full mt-1.5 right-0 z-50 whitespace-nowrap rounded-lg bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground opacity-0 group-hover/aging:opacity-100 transition-opacity duration-150">
        {count} saída{count > 1 ? "s" : ""} em aberto há 24h+
      </span>
    </div>
  );
}
