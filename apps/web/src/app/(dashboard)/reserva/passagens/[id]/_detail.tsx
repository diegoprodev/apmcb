"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, ArrowRightLeft, CheckCircle2, Clock, AlertTriangle, Timer,
  Loader2, KeyRound, UserCheck, Users, FileText, ShieldCheck, ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { csrfHeaders } from "@/lib/csrf";
import { friendlyApiError } from "@/lib/api-error";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

type HandoverStatus =
  | "aguardando_assinatura_saida"
  | "aguardando_atribuicao"
  | "aguardando_assinatura_entrada"
  | "concluido"
  | "divergencia"
  | "vencido"
  | "cancelado";

interface Handover {
  id: string;
  status: HandoverStatus;
  created_at: string;
  updated_at: string;
  prazo_assumcao: string | null;
  observacao_saindo: string | null;
  observacao_entrada: string | null;
  divergencia_descricao: string | null;
  document_hash: string | null;
  report_snapshot: Record<string, unknown> | null;
  saindo: { id: string; nome_completo: string; matricula: string } | null;
  entrando: { id: string; nome_completo: string; matricula: string } | null;
  reserve: { id: string; nome: string; acronym: string } | null;
  saindo_sig: { id: string; signed_at: string } | null;
  entrada_sig: { id: string; signed_at: string } | null;
}

interface ArmProps {
  id: string;
  nome_completo: string;
  matricula: string;
  posto: string | null;
}

interface Props {
  handoverId: string;
  token: string;
  currentUserId: string;
  role: string;
  armeiroList: ArmProps[];
}

const STATUS_LABELS: Record<HandoverStatus, string> = {
  aguardando_assinatura_saida:    "Aguardando assinatura do saindo",
  aguardando_atribuicao:          "Aguardando atribuição do entrante",
  aguardando_assinatura_entrada:  "Aguardando assinatura do entrante",
  concluido:                      "Concluído",
  divergencia:                    "Divergência registrada",
  vencido:                        "Prazo vencido",
  cancelado:                      "Cancelado",
};

const STATUS_COLOR: Record<HandoverStatus, string> = {
  aguardando_assinatura_saida:    "bg-amber-500/10 text-amber-600 border-amber-500/30",
  aguardando_atribuicao:          "bg-primary/10 text-primary border-primary/30",
  aguardando_assinatura_entrada:  "bg-amber-500/10 text-amber-600 border-amber-500/30",
  concluido:                      "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  divergencia:                    "bg-destructive/10 text-destructive border-destructive/30",
  vencido:                        "bg-destructive/10 text-destructive border-destructive/30",
  cancelado:                      "bg-muted/40 text-muted-foreground border-border",
};

const fmtDt = (d: string) =>
  new Date(d).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZone: "America/Recife",
  });

async function bffFetch(method: string, path: string, token: string, body?: unknown) {
  const headers = new Headers(csrfHeaders());
  headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${BFF_URL}${path}`, {
    method,
    credentials: "include",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export function HandoverDetail({ handoverId, token, currentUserId, role, armeiroList }: Props) {
  const router = useRouter();
  const [handover, setHandover] = useState<Handover | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [signing, setSigning] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assigneeId, setAssigneeId] = useState("");
  const [assignQuery, setAssignQuery] = useState("");
  const [showAssignList, setShowAssignList] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { ok, data, status } = await bffFetch("GET", `/api/handovers/${handoverId}`, token);
      if (!ok) {
        setError(status === 404 ? "Passagem não encontrada" : (data.error ?? "Erro ao carregar"));
        return;
      }
      const h = data.handover as Handover;
      setHandover({
        ...h,
        saindo:    Array.isArray(h.saindo)    ? h.saindo[0] ?? null    : h.saindo,
        entrando:  Array.isArray(h.entrando)  ? h.entrando[0] ?? null  : h.entrando,
        reserve:   Array.isArray(h.reserve)   ? h.reserve[0] ?? null   : h.reserve,
        saindo_sig: Array.isArray(h.saindo_sig) ? h.saindo_sig[0] ?? null : h.saindo_sig,
        entrada_sig: Array.isArray(h.entrada_sig) ? h.entrada_sig[0] ?? null : h.entrada_sig,
      });
    } catch {
      setError("Sem conexão com o servidor");
    } finally {
      setLoading(false);
    }
  }, [handoverId, token]);

  useEffect(() => { void load(); }, [load]);

  async function handleSignExit() {
    if (totpCode.length !== 6) { toast.error("Digite o código TOTP (6 dígitos)"); return; }
    setSigning(true);
    try {
      const { ok, data, status } = await bffFetch("POST", `/api/handovers/${handoverId}/sign-exit`, token, { totp_token: totpCode });
      if (!ok) {
        console.error("[passagens] falha ao assinar saída", { status, error: data.error });
        toast.error(friendlyApiError(status, data.error, "Erro ao assinar"));
        return;
      }
      toast.success("Assinatura registrada — aguardando atribuição do entrante");
      setTotpCode("");
      await load();
    } finally { setSigning(false); }
  }

  async function handleSignEntry() {
    if (totpCode.length !== 6) { toast.error("Digite o código TOTP (6 dígitos)"); return; }
    setSigning(true);
    try {
      const { ok, data, status } = await bffFetch("POST", `/api/handovers/${handoverId}/sign-entry`, token, { totp_token: totpCode });
      if (!ok) {
        console.error("[passagens] falha ao assinar entrada", { status, error: data.error });
        toast.error(friendlyApiError(status, data.error, "Erro ao assinar"));
        return;
      }
      toast.success("Passagem de serviço concluída com sucesso!");
      setTotpCode("");
      await load();
    } finally { setSigning(false); }
  }

  async function handleAssign() {
    if (!assigneeId) { toast.error("Selecione o armeiro entrante"); return; }
    setAssigning(true);
    try {
      const { ok, data, status } = await bffFetch("POST", `/api/handovers/${handoverId}/assign-entry`, token, { entrando_id: assigneeId });
      if (!ok) {
        console.error("[passagens] falha ao atribuir armeiro entrante", { status, error: data.error });
        toast.error(friendlyApiError(status, data.error, "Erro ao atribuir"));
        return;
      }
      toast.success("Armeiro entrante atribuído");
      setAssigneeId("");
      setAssignQuery("");
      await load();
    } finally { setAssigning(false); }
  }

  const filteredArmeiroList = armeiroList.filter((a) => {
    const q = assignQuery.toLowerCase();
    return !q || a.nome_completo.toLowerCase().includes(q) || a.matricula.toLowerCase().includes(q);
  }).filter((a) => a.id !== handover?.saindo?.id); // can't assign the same person

  const selectedArmeiro = armeiroList.find((a) => a.id === assigneeId);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !handover) {
    return (
      <div className="p-6 space-y-4">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="size-4" /> Voltar
        </button>
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-6 text-center">
          <AlertTriangle className="size-8 text-destructive mx-auto mb-2" />
          <p className="text-sm text-destructive font-medium">{error ?? "Passagem não encontrada"}</p>
        </div>
      </div>
    );
  }

  const isSaindo   = handover.saindo?.id === currentUserId;
  const isEntrando = handover.entrando?.id === currentUserId;
  const isAdmin    = ["admin_reserva", "admin_global", "superadmin"].includes(role);
  const statusStyle = STATUS_COLOR[handover.status] ?? STATUS_COLOR.cancelado;

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-2xl mx-auto">
      {/* Back */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-4" /> Passagens de Serviço
      </button>

      {/* Header card */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4" style={{ boxShadow: "var(--shadow-card)" }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <ArrowRightLeft className="size-5 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-sm text-foreground">
                {handover.reserve?.acronym ?? "—"} — Passagem de Serviço
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Aberta em {fmtDt(handover.created_at)}
              </p>
            </div>
          </div>
          <Badge variant="outline" className={`text-xs font-medium shrink-0 ${statusStyle}`}>
            {STATUS_LABELS[handover.status]}
          </Badge>
        </div>

        {/* Partes */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-muted/40 p-3 space-y-1">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Saindo</p>
            <p className="text-sm font-medium text-foreground">{handover.saindo?.nome_completo ?? "—"}</p>
            <p className="text-xs text-muted-foreground">{handover.saindo?.matricula ?? ""}</p>
            <div className={`flex items-center gap-1 text-xs mt-1 ${handover.saindo_sig ? "text-emerald-600" : "text-orange-500"}`}>
              {handover.saindo_sig
                ? <><ShieldCheck className="size-3" /> Assinou {fmtDt(handover.saindo_sig.signed_at)}</>
                : <><ShieldAlert className="size-3" /> Assinatura pendente</>}
            </div>
          </div>
          <div className="rounded-xl bg-muted/40 p-3 space-y-1">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Entrante</p>
            {handover.entrando
              ? <>
                <p className="text-sm font-medium text-foreground">{handover.entrando.nome_completo}</p>
                <p className="text-xs text-muted-foreground">{handover.entrando.matricula}</p>
                <div className={`flex items-center gap-1 text-xs mt-1 ${handover.entrada_sig ? "text-emerald-600" : "text-blue-500"}`}>
                  {handover.entrada_sig
                    ? <><ShieldCheck className="size-3" /> Assinou {fmtDt(handover.entrada_sig.signed_at)}</>
                    : <><ShieldAlert className="size-3" /> Assinatura pendente</>}
                </div>
              </>
              : <p className="text-xs text-muted-foreground italic mt-1">Aguardando atribuição</p>
            }
          </div>
        </div>

        {/* Observações */}
        {handover.observacao_saindo && (
          <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-3 space-y-1">
            <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wider">Observação do saindo</p>
            <p className="text-sm text-foreground">{handover.observacao_saindo}</p>
          </div>
        )}
        {handover.prazo_assumcao && ["aguardando_assinatura_entrada", "vencido"].includes(handover.status) && (
          <div className="flex items-center gap-2 text-sm">
            <Timer className="size-4 text-orange-500 shrink-0" />
            <span className="text-muted-foreground">Prazo para assumção:</span>
            <span className={handover.status === "vencido" ? "text-destructive font-medium" : "text-foreground font-medium"}>
              {fmtDt(handover.prazo_assumcao)}
            </span>
          </div>
        )}

        {/* Hash */}
        {handover.document_hash && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground border-t border-border pt-3">
            <FileText className="size-3.5 shrink-0" />
            <span className="font-mono break-all">{handover.document_hash}</span>
          </div>
        )}
      </div>

      {/* Ação: Armeiro saindo assina */}
      {handover.status === "aguardando_assinatura_saida" && isSaindo && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 space-y-4" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-amber-600" />
            <p className="text-sm font-semibold text-amber-700">Sua assinatura é necessária para iniciar a passagem</p>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Código TOTP (6 dígitos)</Label>
            <Input
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              inputMode="numeric"
              maxLength={6}
              className="text-center text-2xl font-mono tracking-[0.4em] max-w-[160px]"
              onKeyDown={(e) => e.key === "Enter" && handleSignExit()}
            />
          </div>
          <Button
            onClick={handleSignExit}
            disabled={signing || totpCode.length !== 6}
            className="gap-2"
          >
            {signing ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            Assinar e Passar Serviço
          </Button>
        </div>
      )}

      {/* Ação: Admin atribui entrante */}
      {handover.status === "aguardando_atribuicao" && isAdmin && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5 space-y-4" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="flex items-center gap-2">
            <Users className="size-4 text-primary" />
            <p className="text-sm font-semibold text-primary">Atribuir armeiro entrante</p>
          </div>
          <div className="space-y-2 relative">
            <Label className="text-xs">Buscar armeiro</Label>
            <Input
              value={selectedArmeiro ? `${selectedArmeiro.nome_completo} · ${selectedArmeiro.matricula}` : assignQuery}
              onChange={(e) => { setAssignQuery(e.target.value); setAssigneeId(""); setShowAssignList(true); }}
              onFocus={() => setShowAssignList(true)}
              placeholder="Nome ou matrícula do armeiro entrante..."
              className="text-sm"
            />
            {showAssignList && !selectedArmeiro && (
              <div className="absolute z-50 w-full mt-1 rounded-xl border border-border bg-card shadow-lg max-h-48 overflow-y-auto">
                {filteredArmeiroList.length === 0
                  ? <p className="p-3 text-xs text-muted-foreground text-center">Nenhum armeiro encontrado</p>
                  : filteredArmeiroList.slice(0, 10).map((a) => (
                    <button
                      key={a.id}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 transition-colors"
                      onClick={() => { setAssigneeId(a.id); setAssignQuery(""); setShowAssignList(false); }}
                    >
                      <span className="font-medium">{a.posto ? `${a.posto} ` : ""}{a.nome_completo}</span>
                      <span className="text-xs text-muted-foreground ml-2">{a.matricula}</span>
                    </button>
                  ))
                }
              </div>
            )}
          </div>
          <Button onClick={handleAssign} disabled={assigning || !assigneeId} className="gap-2">
            {assigning ? <Loader2 className="size-4 animate-spin" /> : <UserCheck className="size-4" />}
            Atribuir Entrante
          </Button>
        </div>
      )}

      {/* Ação: Armeiro entrante assina */}
      {handover.status === "aguardando_assinatura_entrada" && isEntrando && (
        <div className="rounded-2xl border border-blue-500/30 bg-blue-500/5 p-5 space-y-4" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-blue-600" />
            <p className="text-sm font-semibold text-blue-700">Assine para assumir o serviço</p>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Código TOTP (6 dígitos)</Label>
            <Input
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              inputMode="numeric"
              maxLength={6}
              className="text-center text-2xl font-mono tracking-[0.4em] max-w-[160px]"
              onKeyDown={(e) => e.key === "Enter" && handleSignEntry()}
            />
          </div>
          <Button
            onClick={handleSignEntry}
            disabled={signing || totpCode.length !== 6}
            className="gap-2"
          >
            {signing ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            Assinar e Assumir Serviço
          </Button>
        </div>
      )}

      {/* Estado: Concluído */}
      {handover.status === "concluido" && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 flex items-center gap-3">
          <CheckCircle2 className="size-5 text-emerald-600 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-emerald-700">Passagem concluída</p>
            <p className="text-xs text-emerald-600/80 mt-0.5">Ambas as assinaturas foram coletadas com sucesso.</p>
          </div>
        </div>
      )}

      {/* Estado: Vencido */}
      {handover.status === "vencido" && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 flex items-center gap-3">
          <Clock className="size-5 text-destructive shrink-0" />
          <div>
            <p className="text-sm font-semibold text-destructive">Passagem vencida</p>
            <p className="text-xs text-destructive/80 mt-0.5">O prazo expirou sem conclusão. Registre uma nova passagem.</p>
          </div>
        </div>
      )}

      {/* Snapshot do turno */}
      {handover.report_snapshot && Object.keys(handover.report_snapshot).length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5 space-y-3" style={{ boxShadow: "var(--shadow-card)" }}>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Snapshot do turno</p>
          <pre className="text-xs text-foreground bg-muted/40 rounded-xl p-3 overflow-auto max-h-48 leading-relaxed">
            {JSON.stringify(handover.report_snapshot, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
