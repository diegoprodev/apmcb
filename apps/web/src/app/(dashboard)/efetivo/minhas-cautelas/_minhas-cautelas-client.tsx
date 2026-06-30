"use client";

import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Package2, Clock, FileText, AlertCircle } from "lucide-react";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

export interface Cautela {
  id: string;
  status: string;
  motivo_emissao: string;
  condicao_emissao: string;
  data_emissao: string;
  prazo_proxima_conferencia?: string | null;
  armeiro_signature_id?: string | null;
  militar_signature_id?: string | null;
  item: {
    id: string;
    numero_serie?: string | null;
    material_type: { nome: string; categoria: string };
  };
  armeiro: { nome_completo: string; matricula: string };
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  ativa:       { label: "Ativa",       color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" },
  devolvida:   { label: "Devolvida",   color: "bg-gray-500/10 text-gray-500 border-gray-500/30" },
  substituida: { label: "Substituída", color: "bg-blue-500/10 text-blue-600 border-blue-500/30" },
  em_revisao:  { label: "Em revisão",  color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30" },
  cancelada:   { label: "Cancelada",   color: "bg-red-500/10 text-red-600 border-red-500/30" },
};

async function getToken(): Promise<string> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? "";
}

interface Props {
  initialCautelas: Cautela[];
}

export function MinhasCautelasClient({ initialCautelas }: Props) {
  async function downloadPdf(id: string) {
    const token = await getToken();
    const res = await fetch(`${BFF_URL}/api/cautelamentos/${id}/pdf`, {
      credentials: "include",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { toast.error("Erro ao gerar PDF"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cautela-${id.slice(0, 8)}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (initialCautelas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
        <Package2 className="size-10 opacity-30" />
        <p className="text-sm">Você não possui cautelas ativas</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {initialCautelas.map((c) => (
        <div
          key={c.id}
          className="rounded-xl border border-border bg-card p-4 space-y-3"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm text-foreground truncate">
                  {c.item.material_type.nome}
                </span>
                {c.item.numero_serie && (
                  <span className="text-xs text-muted-foreground font-mono">
                    #{c.item.numero_serie}
                  </span>
                )}
                <Badge
                  variant="outline"
                  className={`text-[10px] font-medium ${STATUS_CONFIG[c.status]?.color ?? ""}`}
                >
                  {STATUS_CONFIG[c.status]?.label ?? c.status}
                </Badge>
                {!c.armeiro_signature_id && (
                  <Badge variant="outline" className="text-[10px] bg-yellow-500/10 text-yellow-600 border-yellow-500/30">
                    Aguard. assinatura armeiro
                  </Badge>
                )}
                {c.armeiro_signature_id && !c.militar_signature_id && (
                  <Badge variant="outline" className="text-[10px] bg-orange-500/10 text-orange-600 border-orange-500/30">
                    Aguard. sua assinatura
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1 truncate">{c.motivo_emissao}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => downloadPdf(c.id)} className="h-7 px-2 text-xs gap-1 shrink-0">
              <FileText className="size-3.5" />
              PDF
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Clock className="size-3.5 shrink-0" />
              <span suppressHydrationWarning>Desde {new Date(c.data_emissao).toLocaleDateString("pt-BR")}</span>
            </div>
            <div className="text-muted-foreground truncate">
              Emitido por: {c.armeiro.nome_completo}
            </div>
            {c.prazo_proxima_conferencia && (
              <div className="flex items-center gap-1.5 text-yellow-600 col-span-2">
                <AlertCircle className="size-3.5 shrink-0" />
                <span suppressHydrationWarning>
                  Conferência em:{" "}
                  {new Date(c.prazo_proxima_conferencia).toLocaleDateString("pt-BR")}
                </span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
