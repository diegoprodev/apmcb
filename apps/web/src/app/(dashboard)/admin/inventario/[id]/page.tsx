"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, CheckCircle2, AlertTriangle, UserCheck, ClipboardList, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { csrfHeaders } from "@/lib/csrf";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

interface ItemCheck {
  id: string;
  material_type_id: string;
  qtd_esperada: number;
  qtd_contada: number | null;
  status: string;
  divergencia_desc?: string;
  material?: { nome: string; tipo: string };
}

interface ReserveCheck {
  id: string;
  reserve_id: string;
  responsavel_id?: string;
  armeiro_id?: string;
  status: string;
  observacao?: string;
  signature_id?: string;
  concluido_at?: string;
  items: ItemCheck[];
}

interface Campaign {
  id: string;
  nome: string;
  descricao?: string;
  status: string;
  prazo_fim: string;
  document_hash?: string;
}

export default function InventarioDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [checks, setChecks] = useState<ReserveCheck[]>([]);
  const [loading, setLoading] = useState(true);

  // Sign dialog
  const [signDialog, setSignDialog] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [observacao, setObservacao] = useState("");
  const [signing, setSigning] = useState(false);

  // Item check dialog
  const [checkDialog, setCheckDialog] = useState<{ rcId: string; item: ItemCheck } | null>(null);
  const [qtdContada, setQtdContada] = useState("");
  const [divDesc, setDivDesc] = useState("");
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BFF_URL}/api/inventory/campaigns/${id}`, { credentials: "include" });
      if (!res.ok) { toast.error("Falha ao carregar campanha"); return; }
      const data = await res.json();
      setCampaign(data.campaign);
      setChecks(data.reserve_checks ?? []);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function handleClose() {
    const res = await fetch(`${BFF_URL}/api/inventory/campaigns/${id}/close`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error ?? "Erro ao fechar campanha"); return; }
    toast.success("Campanha concluída — PDF gerado");
    load();
  }

  async function handleSign() {
    if (!signDialog) return;
    if (totpCode.length !== 6) { toast.error("Código TOTP deve ter 6 dígitos"); return; }
    setSigning(true);
    try {
      const res = await fetch(`${BFF_URL}/api/inventory/reserve-checks/${signDialog}/sign`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ totp_code: totpCode, observacao: observacao || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Erro ao assinar"); return; }
      toast.success("Conferência assinada");
      setSignDialog(null); setTotpCode(""); setObservacao("");
      load();
    } finally {
      setSigning(false);
    }
  }

  async function handleItemCheck() {
    if (!checkDialog) return;
    const qtd = parseInt(qtdContada);
    if (isNaN(qtd) || qtd < 0) { toast.error("Quantidade inválida"); return; }
    setChecking(true);
    try {
      const res = await fetch(`${BFF_URL}/api/inventory/reserve-checks/${checkDialog.rcId}/items/${checkDialog.item.id}/check`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ qtd_contada: qtd, divergencia_desc: divDesc || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Erro ao conferir item"); return; }
      toast.success("Item conferido");
      setCheckDialog(null); setQtdContada(""); setDivDesc("");
      load();
    } finally {
      setChecking(false);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-[200px]"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  }

  if (!campaign) return <div className="p-6 text-muted-foreground">Campanha não encontrada.</div>;

  const allSigned = checks.every((rc) => !!rc.signature_id);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}><ArrowLeft className="size-4" /></Button>
        <div>
          <h1 className="text-lg font-semibold">{campaign.nome}</h1>
          <p className="text-xs text-muted-foreground">Prazo: {new Date(campaign.prazo_fim).toLocaleDateString("pt-BR")} · Status: {campaign.status}</p>
        </div>
        <div className="ml-auto flex gap-2">
          {campaign.status === "em_andamento" && allSigned && (
            <Button size="sm" onClick={handleClose}>Fechar campanha</Button>
          )}
          {campaign.status === "concluido" && campaign.document_hash && (
            <Button size="sm" variant="outline" onClick={() => window.open(`${BFF_URL}/api/inventory/campaigns/${id}/pdf`, "_blank")}>
              <Download className="size-4 mr-1" />PDF
            </Button>
          )}
        </div>
      </div>

      {campaign.descricao && <p className="text-sm text-muted-foreground">{campaign.descricao}</p>}

      {/* Reserve checks */}
      {checks.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground text-sm">
          <ClipboardList className="size-7 mx-auto mb-2 opacity-40" />
          Nenhuma reserva atribuída. Inicie a campanha primeiro.
        </div>
      ) : (
        <div className="space-y-4">
          {checks.map((rc) => {
            const total = rc.items.length;
            const conf  = rc.items.filter((i) => i.status === "conforme").length;
            const div   = rc.items.filter((i) => i.status === "divergencia").length;
            const pend  = rc.items.filter((i) => i.status === "pendente").length;

            return (
              <div key={rc.id} className="rounded-xl border bg-card overflow-hidden">
                {/* Reserve header */}
                <div className="flex items-center gap-2 p-3 bg-muted/50 border-b">
                  <ClipboardList className="size-4 text-muted-foreground shrink-0" />
                  <span className="font-medium text-sm flex-1">Reserve: {rc.reserve_id.slice(0, 8)}…</span>
                  {rc.signature_id
                    ? <Badge variant="default" className="flex items-center gap-1 text-[10px]"><CheckCircle2 className="size-3" />Assinada</Badge>
                    : rc.status === "divergencia"
                      ? <Badge variant="destructive" className="text-[10px]">Com divergência</Badge>
                      : <Badge variant="secondary" className="text-[10px]">{rc.status}</Badge>
                  }
                  <span className="text-xs text-muted-foreground">{conf}/{total} conf · {div} div · {pend} pend</span>
                  {!rc.signature_id && campaign.status === "em_andamento" && (
                    <Button size="sm" variant="outline" className="text-xs h-7 ml-2"
                      onClick={() => { setSignDialog(rc.id); setTotpCode(""); setObservacao(""); }}>
                      <UserCheck className="size-3 mr-1" />Assinar
                    </Button>
                  )}
                </div>

                {/* Items */}
                <div className="divide-y">
                  {rc.items.map((item) => {
                    const isDiv = item.status === "divergencia";
                    const isConf = item.status === "conforme";
                    return (
                      <div key={item.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                        {isConf
                          ? <CheckCircle2 className="size-4 text-green-600 shrink-0" />
                          : isDiv
                            ? <AlertTriangle className="size-4 text-destructive shrink-0" />
                            : <div className="size-4 rounded-full border border-muted-foreground shrink-0" />
                        }
                        <span className="flex-1 truncate">{item.material?.nome ?? item.material_type_id.slice(0, 8)}</span>
                        <span className="text-muted-foreground text-xs">Esperado: {item.qtd_esperada}</span>
                        {item.qtd_contada != null
                          ? <span className={`text-xs font-medium ${isDiv ? "text-destructive" : "text-green-700"}`}>Contado: {item.qtd_contada}</span>
                          : null
                        }
                        {isDiv && item.divergencia_desc && (
                          <span className="text-xs text-destructive truncate max-w-[140px]" title={item.divergencia_desc}>{item.divergencia_desc}</span>
                        )}
                        {!rc.signature_id && campaign.status === "em_andamento" && (
                          <Button size="sm" variant="ghost" className="text-xs h-7"
                            onClick={() => { setCheckDialog({ rcId: rc.id, item }); setQtdContada(String(item.qtd_contada ?? item.qtd_esperada)); setDivDesc(item.divergencia_desc ?? ""); }}>
                            {item.status === "pendente" ? "Conferir" : "Editar"}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Sign dialog */}
      <Dialog open={!!signDialog} onOpenChange={(o) => !o && setSignDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Assinar conferência</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Código TOTP (6 dígitos)</Label>
              <Input inputMode="numeric" maxLength={6} placeholder="000000" value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
            </div>
            <div className="space-y-1.5">
              <Label>Observação (opcional)</Label>
              <Input placeholder="Ex: Sem divergências encontradas" value={observacao}
                onChange={(e) => setObservacao(e.target.value)} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setSignDialog(null)}>Cancelar</Button>
              <Button onClick={handleSign} disabled={signing}>
                {signing ? <Loader2 className="size-4 animate-spin" /> : "Assinar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Item check dialog */}
      <Dialog open={!!checkDialog} onOpenChange={(o) => !o && setCheckDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Conferir item</DialogTitle>
          </DialogHeader>
          {checkDialog && (
            <div className="space-y-4 mt-2">
              <p className="text-sm"><span className="font-medium">{checkDialog.item.material?.nome ?? "Item"}</span> — Esperado: {checkDialog.item.qtd_esperada}</p>
              <div className="space-y-1.5">
                <Label>Quantidade contada *</Label>
                <Input type="number" min={0} value={qtdContada}
                  onChange={(e) => setQtdContada(e.target.value)} />
              </div>
              {parseInt(qtdContada) !== checkDialog.item.qtd_esperada && (
                <div className="space-y-1.5">
                  <Label className="text-destructive">Justificativa da divergência *</Label>
                  <Input placeholder="Descreva o motivo da divergência" value={divDesc}
                    onChange={(e) => setDivDesc(e.target.value)} />
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setCheckDialog(null)}>Cancelar</Button>
                <Button onClick={handleItemCheck} disabled={checking}>
                  {checking ? <Loader2 className="size-4 animate-spin" /> : "Confirmar"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
