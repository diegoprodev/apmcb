"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList, Loader2, CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

interface ActiveCampaign {
  id: string;
  nome: string;
  status: string;
  prazo_fim: string;
}

export function InventoryCard() {
  const [data, setData] = useState<{ active: ActiveCampaign | null; total: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${BFF_URL}/api/inventory/campaigns`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) { setLoading(false); return; }
        const campaigns: ActiveCampaign[] = d.campaigns ?? [];
        const active = campaigns.find((c) => c.status === "em_andamento") ?? null;
        setData({ active, total: campaigns.length });
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="rounded-xl border bg-card p-5 flex items-center justify-center min-h-[100px]">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  );

  const prazoVencido = data?.active && new Date(data.active.prazo_fim) < new Date();

  return (
    <Link href="/admin/inventario" className="block rounded-xl border bg-card p-5 hover:bg-muted/40 transition-colors">
      <div className="flex items-center gap-2 mb-3">
        <ClipboardList className="size-4 text-primary shrink-0" />
        <span className="text-sm font-semibold">Inventário Periódico</span>
      </div>

      {!data?.active ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="size-4 shrink-0" />
          <span>
            {data?.total === 0 ? "Nenhuma campanha criada" : `${data?.total} campanha(s) · Nenhuma em andamento`}
          </span>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            {prazoVencido
              ? <AlertTriangle className="size-4 text-destructive shrink-0" />
              : <CheckCircle2 className="size-4 text-primary shrink-0" />
            }
            <span className="text-sm font-medium truncate">{data.active.nome}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={prazoVencido ? "destructive" : "default"} className="text-[10px]">
              {prazoVencido ? "Prazo vencido" : "Em andamento"}
            </Badge>
            <span className="text-xs text-muted-foreground">
              até {new Date(data.active.prazo_fim).toLocaleDateString("pt-BR")}
            </span>
          </div>
        </div>
      )}
    </Link>
  );
}
