"use client";

import { AlertTriangle, CheckCircle2, Radio, ShieldAlert, Usb, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format-date";

export type BridgeStatus = "active" | "missing" | "revoked" | "offline" | "simulator";

export interface BiometricBridgeStatusProps {
  status: BridgeStatus;
  deviceName?: string | null;
  lastSeenAt?: string | null;
}

const statusConfig: Record<BridgeStatus, {
  label: string;
  description: string;
  badge: string;
  tone: string;
  icon: React.ComponentType<{ className?: string }>;
}> = {
  active: {
    label: "Leitor conectado",
    description: "Leitor local pareado e pronto para identificação.",
    badge: "Conectado",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-900",
    icon: CheckCircle2,
  },
  missing: {
    label: "Leitor não configurado",
    description: "Configure o leitor local da reserva antes de capturar biometria.",
    badge: "Atenção",
    tone: "border-amber-200 bg-amber-50 text-amber-950",
    icon: AlertTriangle,
  },
  revoked: {
    label: "Leitor revogado",
    description: "O dispositivo desta reserva foi revogado e não pode confirmar identificações.",
    badge: "Revogado",
    tone: "border-red-200 bg-red-50 text-red-950",
    icon: ShieldAlert,
  },
  offline: {
    label: "Leitor sem contato",
    description: "A configuração existe, mas não há atividade recente do leitor.",
    badge: "Desconectado",
    tone: "border-slate-200 bg-slate-50 text-slate-900",
    icon: WifiOff,
  },
  simulator: {
    label: "Modo de teste",
    description: "Ambiente de validação sem hardware real. Indisponível em produção.",
    badge: "Teste",
    tone: "border-sky-200 bg-sky-50 text-sky-950",
    icon: Radio,
  },
};

export function BiometricBridgeStatus({ status, deviceName, lastSeenAt }: BiometricBridgeStatusProps) {
  const config = statusConfig[status];
  const Icon = config.icon;
  const lastSeen = lastSeenAt ? formatDateTime(lastSeenAt) : "sem leitura recente";

  return (
    <section
      className={`rounded-lg border p-4 ${config.tone}`}
      data-testid="biometric-bridge-status"
      data-status={status}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/70">
            <Icon className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">{config.label}</h2>
              <Badge variant="outline" className="bg-white/70 text-[11px]">
                {config.badge}
              </Badge>
            </div>
            <p className="mt-1 text-sm opacity-85">{config.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2 text-xs">
          <Usb className="size-4" />
          <div className="min-w-0">
            <p className="max-w-56 truncate font-medium">{deviceName ?? "Nenhum dispositivo"}</p>
            <p className="opacity-70">{lastSeen}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
