"use client";

import { useEffect, useState } from "react";
import { Users, ShieldCheck, AlertTriangle, LogIn, Building2 } from "lucide-react";
import { toast } from "sonner";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

interface Metrics {
  users: {
    total: number;
    admin: number;
    master: number;
    usuario: number;
    totp_configured: number;
    totp_pct: number;
  };
  security: {
    errors_24h: number;
    login_failures_24h: number;
  };
  tenants: {
    total: number;
    ativos: number;
  };
}

export function MetricsGrid() {
  const [data, setData] = useState<Metrics | null>(null);

  useEffect(() => {
    fetch(`${BFF_URL}/api/nexus/metrics`, { credentials: "include" })
      .then((r) => {
        if (r.status === 401 || r.status === 403) return null; // guard vai redirecionar
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => { if (d) setData(d); })
      .catch(() => toast.error("Falha ao carregar métricas"));
  }, []);

  const cards = [
    {
      icon: Users,
      label: "Usuários",
      value: data?.users.total ?? "—",
      sub: data ? `${data.users.admin} admin · ${data.users.master} armeiro · ${data.users.usuario} cadetes` : "",
      color: "text-blue-400",
      bg: "bg-blue-500/10",
    },
    {
      icon: ShieldCheck,
      label: "TOTP Configurado",
      value: data ? `${data.users.totp_pct}%` : "—",
      sub: data ? `${data.users.totp_configured} de ${data.users.total}` : "",
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
    },
    {
      icon: Building2,
      label: "Tenants Ativos",
      value: data?.tenants.ativos ?? "—",
      sub: data ? `${data.tenants.total} total cadastrado(s)` : "",
      color: "text-indigo-400",
      bg: "bg-indigo-500/10",
    },
    {
      icon: AlertTriangle,
      label: "Erros 24h",
      value: data?.security.errors_24h ?? "—",
      sub: "eventos com erro",
      color: data?.security.errors_24h ? "text-red-400" : "text-gray-400",
      bg: data?.security.errors_24h ? "bg-red-500/10" : "bg-gray-500/10",
    },
    {
      icon: LogIn,
      label: "Falhas de Login 24h",
      value: data?.security.login_failures_24h ?? "—",
      sub: "tentativas bloqueadas",
      color: data?.security.login_failures_24h ? "text-orange-400" : "text-gray-400",
      bg: data?.security.login_failures_24h ? "bg-orange-500/10" : "bg-gray-500/10",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
      {cards.map(({ icon: Icon, label, value, sub, color, bg }) => (
        <div key={label} className="bg-white dark:bg-[#12121A] border border-gray-200 dark:border-[#1E1E2E] rounded-xl p-4 shadow-sm dark:shadow-none">
          <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center mb-3`}>
            <Icon className={`size-4 ${color}`} />
          </div>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{String(value)}</p>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
          {sub && <p className="text-[10px] text-gray-500 dark:text-gray-600 mt-1">{sub}</p>}
        </div>
      ))}
    </div>
  );
}
