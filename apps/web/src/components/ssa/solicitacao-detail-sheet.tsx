"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Clock, CheckCircle2, XCircle, Package, Ban,
  AlertTriangle, X, Loader2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

type Status = "pendente" | "aprovado" | "rejeitado" | "retirado" | "expirado" | "cancelado";

interface Item {
  material_nome_snapshot: string;
  requested_quantity: number;
}

interface Props {
  id: string;
  status: Status;
  items: Item[];
  requested_at: string;
  approved_at?: string | null;
  expires_at?: string | null;
  denial_reason?: string | null;
  armeiro_nota?: string | null;
  children: React.ReactNode;
}

const STATUS_CONFIG: Record<Status, { label: string; icon: React.ReactNode; color: string }> = {
  pendente:  { label: "Aguardando aprovação",      icon: <Clock className="size-4 animate-pulse" />,    color: "text-amber-700" },
  aprovado:  { label: "Aprovado — retire o material", icon: <CheckCircle2 className="size-4" />,         color: "text-emerald-700" },
  rejeitado: { label: "Não aprovado",              icon: <XCircle className="size-4" />,                color: "text-red-700" },
  retirado:  { label: "Material retirado",         icon: <Package className="size-4" />,                color: "text-blue-700" },
  expirado:  { label: "Prazo encerrado",           icon: <Ban className="size-4" />,                    color: "text-muted-foreground" },
  cancelado: { label: "Cancelado",                 icon: <Ban className="size-4" />,                    color: "text-muted-foreground" },
};

// timeZone explícito: sem isso, SSR (edge runtime, UTC) e o browser do
// usuário (America/Recife) produzem strings diferentes → hydration mismatch
// (React error #418).
function fmt(iso: string, opts?: Intl.DateTimeFormatOptions) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    ...opts,
    timeZone: "America/Recife",
  });
}

export function SolicitacaoDetailSheet({
  id, status, items, requested_at, approved_at, expires_at, denial_reason, armeiro_nota, children,
}: Props) {
  const [open, setOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const cfg = STATUS_CONFIG[status];

  async function handleCancel() {
    if (!reason.trim()) { setError("Informe o motivo do cancelamento."); return; }
    setLoading(true);
    setError("");
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
      const res = await fetch(`${BFF_URL}/api/ssa/requests/${id}`, {
        method: "DELETE",
        headers,
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Erro ao cancelar. Tente novamente.");
        return;
      }
      setCancelOpen(false);
      setOpen(false);
      router.refresh();
    } catch {
      setError("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <div onClick={() => setOpen(true)} className="cursor-pointer">
            {children}
          </div>
        </SheetTrigger>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl p-6">
          <SheetHeader className="mb-4">
            <SheetTitle className="text-base">Detalhes da Solicitação</SheetTitle>
          </SheetHeader>

          {/* Status */}
          <div className={`flex items-center gap-2 font-semibold text-sm mb-4 ${cfg.color}`}>
            {cfg.icon}
            {cfg.label}
          </div>

          {/* ID + dates */}
          <div className="space-y-1 text-xs text-muted-foreground mb-5">
            <p className="font-mono">#{id.slice(0, 8).toUpperCase()}</p>
            <p>Solicitado em {fmt(requested_at)}</p>
            {approved_at && <p>Aprovado em {fmt(approved_at)}</p>}
            {expires_at && status === "aprovado" && (
              <p className="text-emerald-700 font-medium">⏱ Retirar até {fmt(expires_at)}</p>
            )}
          </div>

          {/* Items */}
          <div className="mb-5">
            <p className="text-xs font-semibold text-foreground mb-2">Materiais solicitados</p>
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2">
                  <span className="text-sm">{item.material_nome_snapshot}</span>
                  <span className="text-xs text-muted-foreground font-medium">×{item.requested_quantity}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Armeiro note on approved */}
          {armeiro_nota && status === "aprovado" && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 mb-5">
              <p className="text-xs font-semibold text-emerald-700 mb-1">Mensagem do armeiro</p>
              <p className="text-xs text-emerald-800">{armeiro_nota}</p>
            </div>
          )}

          {/* Denial / cancel reason */}
          {denial_reason && (status === "rejeitado" || status === "cancelado") && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 mb-5">
              <p className="text-xs font-semibold text-red-700 mb-1">
                {status === "rejeitado" ? "Motivo da rejeição" : "Motivo do cancelamento"}
              </p>
              <p className="text-xs text-red-800">{denial_reason}</p>
            </div>
          )}

          {/* Cancel action (only for pendente) */}
          {status === "pendente" && (
            <Button
              variant="outline"
              className="w-full border-red-200 text-red-700 hover:bg-red-50"
              onClick={() => { setReason(""); setError(""); setCancelOpen(true); }}
            >
              Cancelar solicitação
            </Button>
          )}
        </SheetContent>
      </Sheet>

      {/* Cancel confirm dialog */}
      {cancelOpen && (
        <div className="fixed inset-0 z-60 flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => !loading && setCancelOpen(false)} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-background p-6 shadow-2xl">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-2 text-red-700">
                <AlertTriangle className="size-4 shrink-0" />
                <p className="font-semibold text-sm">Cancelar solicitação?</p>
              </div>
              {!loading && (
                <button onClick={() => setCancelOpen(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="size-4" />
                </button>
              )}
            </div>

            <p className="text-xs text-muted-foreground mb-4">
              Esta ação não pode ser desfeita. Informe o motivo do cancelamento.
            </p>

            <textarea
              className="w-full rounded-xl border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              rows={3}
              placeholder="Ex: Material não é mais necessário"
              value={reason}
              onChange={(e) => { setReason(e.target.value); setError(""); }}
              disabled={loading}
              maxLength={200}
            />

            {error && <p className="text-xs text-red-600 mt-1">{error}</p>}

            <div className="flex gap-2 mt-4">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setCancelOpen(false)}
                disabled={loading}
              >
                Voltar
              </Button>
              <Button
                className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                onClick={handleCancel}
                disabled={loading}
              >
                {loading ? <Loader2 className="size-4 animate-spin" /> : "Confirmar cancelamento"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
