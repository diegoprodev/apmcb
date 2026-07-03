"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  User, Fingerprint, CheckCircle2, AlertTriangle,
  Loader2, Package, ShieldCheck, Mail, MailCheck, MailX, ShieldAlert,
  CircleCheck, CircleX, Clock, LayoutGrid, Table2, ChevronDown,
} from "lucide-react";
import { GridPdfButton } from "@/components/shared/grid-pdf-button";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { FingerSelector } from "@/components/ui/finger-selector";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { UserRowActions } from "@/app/(dashboard)/admin/usuarios/_user-actions";
import { ChangeStatusButton, type RegistrationStatus } from "@/components/shared/change-status-button";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

export interface MilitarRow {
  id: string;
  nome_completo: string;
  matricula: string;
  posto: string | null;
  foto_url: string | null;
  email: string | null;
  nome_de_guerra: string | null;
  unidade: string | null;
  telefone: string | null;
  registration_status: RegistrationStatus;
  totp_configured: boolean;
  registeredFingers: number[];
  activeCount: number;
  invite_sent_at: string | null;
  account_activated_at: string | null;
}

function getInitials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

function StatusBadge({ status }: { status: RegistrationStatus }) {
  switch (status) {
    case "complete":
      return (
        <span className="badge-success text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5 inline-flex items-center gap-1">
          <CircleCheck className="size-3" />Ativo
        </span>
      );
    case "inactive":
      return (
        <span className="badge-danger text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5 inline-flex items-center gap-1">
          <CircleX className="size-3" />Inativo
        </span>
      );
    case "impedimento_administrativo":
      return (
        <span
          className="text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5 inline-flex items-center gap-1"
          style={{ background: "var(--severity-danger-bg, #fee2e2)", color: "var(--severity-danger-fg, #991b1b)" }}
        >
          <ShieldAlert className="size-3" />Impedimento Adm.
        </span>
      );
    case "pending_biometric":
    default:
      return (
        <span className="badge-warning text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5 inline-flex items-center gap-1">
          <Clock className="size-3" />Cadastro Pendente
        </span>
      );
  }
}

function MilitarSheet({
  militar,
  callerRole,
  open,
  onClose,
  onStatusChange,
}: {
  militar: MilitarRow;
  callerRole: "admin" | "master";
  open: boolean;
  onClose: () => void;
  onStatusChange: (id: string, newStatus: RegistrationStatus) => void;
}) {
  const router = useRouter();
  const [fingerIndex, setFingerIndex] = useState<number | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [registeredFingers, setRegisteredFingers] = useState<number[]>(militar.registeredFingers);
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteSentAt, setInviteSentAt] = useState<string | null>(militar.invite_sent_at);
  const [currentStatus, setCurrentStatus] = useState<RegistrationStatus>(militar.registration_status);

  const isPending = currentStatus === "pending_biometric";
  const hasAccount = !!militar.account_activated_at;
  const isImpedido = currentStatus === "impedimento_administrativo";

  async function handleSendInvite() {
    if (!militar.email) {
      toast.error("Configure o e-mail do usuário antes de enviar o convite.");
      return;
    }
    setInviteSending(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: militar.email,
          existing_user_id: militar.id,
          method: "magic_link",
        }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Erro ao enviar convite");
      setInviteSentAt(new Date().toISOString());
      toast.success("Link de cadastro enviado para " + militar.email);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar convite");
    } finally {
      setInviteSending(false);
    }
  }

  async function handleCapture() {
    if (fingerIndex === null) { toast.error("Selecione o dedo para captura"); return; }
    setCapturing(true);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;

      const res = await fetch(`${BFF_URL}/biometric/register`, {
        method: "POST",
        headers,
        body: JSON.stringify({ userId: militar.id, fingerIndex }),
      });

      const data = await res.json() as { ok?: boolean; quality?: number; error?: string };
      if (!res.ok) { toast.error(data.error ?? "Erro ao capturar biometria"); return; }

      toast.success(`Dedo ${fingerIndex} registrado${data.quality !== undefined ? ` (qualidade ${data.quality}%)` : ""}`);
      setRegisteredFingers((prev) => [...new Set([...prev, fingerIndex])]);
      setFingerIndex(null);
      router.refresh();
    } catch {
      toast.error("Erro de conexão com o leitor biométrico");
    } finally {
      setCapturing(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-2xl px-4 pb-8 pt-6 sm:px-8">
        <SheetHeader className="mb-5 text-left">
          <SheetTitle>Identificação Biométrica</SheetTitle>
        </SheetHeader>

        {/* Profile card */}
        <div className="flex items-center gap-4 mb-5">
          {militar.foto_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={militar.foto_url} alt={militar.nome_completo}
              className="w-16 h-16 rounded-2xl object-cover shrink-0 ring-2 ring-border" />
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-xl font-bold shrink-0">
              {getInitials(militar.nome_completo) || <User className="size-6" />}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-lg leading-tight">{militar.nome_completo}</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {militar.posto ? `${militar.posto} · ` : ""}
              <span className="font-mono text-xs">{militar.matricula}</span>
            </p>
            {militar.activeCount > 0 && (
              <div className="flex items-center gap-1.5 mt-1 text-xs text-amber-700">
                <Package className="size-3" />
                {militar.activeCount} material{militar.activeCount !== 1 ? "is" : ""} em uso
              </div>
            )}
          </div>
        </div>

        {/* Status da Conta — account registration status */}
        <div className="mb-4 rounded-xl border border-border bg-muted/20 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/60">
            <div className="flex items-center gap-2">
              {isImpedido ? (
                <ShieldAlert className="size-4 text-destructive shrink-0" />
              ) : currentStatus === "complete" ? (
                <CircleCheck className="size-4 text-emerald-600 shrink-0" />
              ) : currentStatus === "inactive" ? (
                <CircleX className="size-4 text-destructive shrink-0" />
              ) : (
                <Clock className="size-4 text-amber-600 shrink-0" />
              )}
              <div>
                <p className="text-xs font-semibold text-foreground">Status da Conta</p>
                <p className={`text-xs mt-0.5 ${
                  isImpedido
                    ? "text-destructive font-medium"
                    : currentStatus === "complete"
                    ? "text-emerald-700"
                    : currentStatus === "inactive"
                    ? "text-destructive"
                    : "text-amber-700"
                }`}>
                  {currentStatus === "complete" && "Ativo — acesso liberado"}
                  {currentStatus === "inactive" && "Inativo — sem acesso ao sistema"}
                  {currentStatus === "impedimento_administrativo" && "Impedimento Administrativo — armamento bloqueado"}
                  {currentStatus === "pending_biometric" && "Cadastro pendente — biometria incompleta"}
                </p>
              </div>
            </div>
          </div>
          {isImpedido && (
            <div className="px-3 py-2 bg-destructive/5">
              <p className="text-xs text-destructive">
                Este usuário está impedido de retirar armamento. Para dúvidas, procure o Departamento de Pessoas de sua unidade.
              </p>
            </div>
          )}
          <div className="px-3 py-3">
            <ChangeStatusButton
              userId={militar.id}
              userName={militar.nome_completo}
              currentStatus={currentStatus}
              callerRole={callerRole}
              onSuccess={(newStatus) => {
                setCurrentStatus(newStatus);
                onStatusChange(militar.id, newStatus);
              }}
            />
          </div>
        </div>

        {/* Status banner — conta de acesso */}
        {hasAccount ? (
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 mb-3">
            <MailCheck className="size-4 text-emerald-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-emerald-800">Conta ativa</p>
              <p className="text-xs text-emerald-700 mt-0.5">
                Ativada em {formatDateTime(militar.account_activated_at)}
              </p>
            </div>
          </div>
        ) : !militar.email ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 mb-3">
            <MailX className="size-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-800">Sem e-mail cadastrado</p>
              <p className="text-xs text-amber-700 mt-0.5">
                Edite o perfil para adicionar o e-mail antes de enviar o convite.
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-muted/30 px-3 py-3 mb-3 space-y-2">
            <div className="flex items-center gap-2">
              <Mail className="size-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {inviteSentAt ? "Conta não criada" : "Sem conta de acesso"}
                </p>
                {inviteSentAt ? (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Último convite enviado em {formatDateTime(inviteSentAt)} · {militar.email}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Nenhum convite enviado · {militar.email}
                  </p>
                )}
              </div>
            </div>
            <Button
              size="sm"
              variant={inviteSentAt ? "outline" : "default"}
              className="w-full"
              onClick={handleSendInvite}
              disabled={inviteSending}
            >
              {inviteSending ? (
                <><Loader2 className="size-3.5 animate-spin mr-1.5" />Enviando...</>
              ) : inviteSentAt ? (
                <><Mail className="size-3.5 mr-1.5" />Reenviar link de cadastro</>
              ) : (
                <><Mail className="size-3.5 mr-1.5" />Enviar link para cadastro de conta</>
              )}
            </Button>
          </div>
        )}

        {/* Status banner — biometria */}
        {isPending || registeredFingers.length === 0 ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 mb-3">
            <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800">Biometria pendente</p>
              <p className="text-xs text-amber-700 mt-0.5">
                Nenhum dedo cadastrado. Peça ao usuário para apoiar o dedo no leitor.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 mb-3">
            <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
            <p className="text-sm font-medium text-emerald-800">
              {registeredFingers.length} dedo{registeredFingers.length !== 1 ? "s" : ""} cadastrado{registeredFingers.length !== 1 ? "s" : ""}
            </p>
          </div>
        )}

        {/* Status banner — TOTP */}
        {!militar.totp_configured ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 mb-5">
            <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800">
                <abbr title="TOTP — Código de Verificação Temporal: número de 6 dígitos que muda a cada 30 segundos, necessário para retirar material" className="cursor-help underline decoration-dotted">TOTP</abbr>
                {" "}não configurado
              </p>
              <p className="text-xs text-amber-700 mt-0.5">
                Peça ao usuário para acessar o app, ir em Perfil e configurar o Código de Acesso.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 mb-5">
            <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
            <p className="text-sm font-medium text-emerald-800">Código TOTP configurado</p>
          </div>
        )}

        {/* Finger selector */}
        <div className="space-y-3 mb-6">
          <p className="text-sm font-semibold">
            {registeredFingers.length === 0 ? "Selecionar dedo para cadastrar" : "Dedos cadastrados / Adicionar mais"}
          </p>
          <p className="text-xs text-muted-foreground">
            {registeredFingers.length > 0
              ? "Dedos em verde já estão cadastrados. Selecione outro para adicionar ou recapturar."
              : "Selecione o dedo e clique em Capturar Biometria."}
          </p>
          <div className="flex justify-center py-2 overflow-x-auto">
            <FingerSelector
              value={fingerIndex}
              onChange={setFingerIndex}
              disabled={capturing}
              registeredFingers={registeredFingers}
            />
          </div>
        </div>

        {/* Capture button */}
        <Button
          className="w-full h-12 text-base"
          onClick={handleCapture}
          disabled={capturing || fingerIndex === null}
        >
          {capturing ? (
            <><Loader2 className="size-4 animate-spin mr-2" />Aguardando leitura do dedo {fingerIndex}...</>
          ) : fingerIndex === null ? (
            <><Fingerprint className="size-5 mr-2" />Selecione um dedo acima</>
          ) : (
            <><Fingerprint className="size-5 mr-2" />
              {registeredFingers.includes(fingerIndex) ? `Recapturar dedo ${fingerIndex}` : `Capturar dedo ${fingerIndex}`}
            </>
          )}
        </Button>

        {registeredFingers.length > 0 && (
          <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border/60">
            <ShieldCheck className="size-4 text-emerald-600 shrink-0" />
            <p className="text-xs text-muted-foreground">
              Dedos registrados:{" "}
              <span className="font-medium text-foreground">{registeredFingers.sort((a, b) => a - b).join(", ")}</span>
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function MilitarCard({
  militar,
  currentUserId,
  selected,
  onToggle,
  onSelect,
  onUserUpdated,
}: {
  militar: MilitarRow;
  currentUserId: string;
  selected: boolean;
  onToggle: (id: string) => void;
  onSelect: (m: MilitarRow) => void;
  onUserUpdated: (u: Partial<MilitarRow> & { id: string }) => void;
}) {
  const initials = getInitials(militar.nome_completo);
  const isPending = militar.registration_status === "pending_biometric";
  return (
    <div
      data-testid="militar-card"
      className={cn(
        "rounded-2xl bg-card p-4 flex flex-col gap-3 cursor-pointer transition-all hover:shadow-md",
        selected && "ring-2 ring-primary"
      )}
      style={{ boxShadow: "var(--shadow-card)" }}
      onClick={() => onSelect(militar)}
    >
      <div className="flex items-start gap-3">
        <div onClick={(e) => { e.stopPropagation(); onToggle(militar.id); }}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(militar.id)}
            className="size-4 rounded accent-primary mt-1 shrink-0"
            aria-label={`Selecionar ${militar.nome_completo}`}
          />
        </div>
        {militar.foto_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={militar.foto_url} alt={militar.nome_completo}
            className="w-10 h-10 rounded-full object-cover shrink-0 ring-1 ring-border" />
        ) : (
          <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-sm font-bold shrink-0">
            {initials || <User className="size-4" />}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{militar.nome_completo}</p>
          <p className="text-xs text-muted-foreground font-mono">{militar.matricula}</p>
          {militar.posto && <p className="text-xs text-muted-foreground">{militar.posto}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <StatusBadge status={militar.registration_status} />
        {isPending || militar.registeredFingers.length === 0 ? (
          <span className="badge-warning text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5">Bio Pendente</span>
        ) : !militar.totp_configured ? (
          <span className="badge-warning text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5">TOTP Pendente</span>
        ) : (
          <span className="badge-success text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5">Completo</span>
        )}
        {militar.activeCount > 0 && (
          <span className="badge-in-use text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5">{militar.activeCount} em uso</span>
        )}
      </div>
      <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
        <UserRowActions
          user={{ ...militar, role: "usuario" }}
          currentUserId={currentUserId}
          onUserUpdated={onUserUpdated}
        />
      </div>
    </div>
  );
}

export function MilitaresTable({
  militares: initialMilitares,
  currentUserId,
  callerRole,
}: {
  militares: MilitarRow[];
  currentUserId: string;
  callerRole: "admin" | "master";
}) {
  const [militares, setMilitares] = useState<MilitarRow[]>(initialMilitares);
  const [selected, setSelected] = useState<MilitarRow | null>(null);
  const [photoLightbox, setPhotoLightbox] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [displayLimit, setDisplayLimit] = useState(10);
  const [showLimitMenu, setShowLimitMenu] = useState(false);

  const displayed = useMemo(() => militares.slice(0, displayLimit), [militares, displayLimit]);
  const hasMore = militares.length > displayLimit;
  const someSelected = selectedIds.size > 0;
  const allDisplayedSel = displayed.length > 0 && displayed.every((m) => selectedIds.has(m.id));
  const someDisplayedSel = displayed.some((m) => selectedIds.has(m.id));

  function handleUserUpdated(updated: Partial<MilitarRow> & { id: string }) {
    setMilitares((prev) =>
      prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m))
    );
  }

  function handleStatusChange(id: string, newStatus: RegistrationStatus) {
    handleUserUpdated({ id, registration_status: newStatus });
    if (selected?.id === id) {
      setSelected((prev) => prev ? { ...prev, registration_status: newStatus } : prev);
    }
  }

  function toggleItem(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allDisplayedSel) displayed.forEach((m) => next.delete(m.id));
      else displayed.forEach((m) => next.add(m.id));
      return next;
    });
  }

  return (
    <>
      {photoLightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setPhotoLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoLightbox}
            alt="Foto do militar"
            className="max-w-[90vw] max-h-[90vh] rounded-2xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="text-xs text-muted-foreground">{militares.length} militar{militares.length !== 1 ? "es" : ""}</span>
        <div className="flex items-center gap-2">
          <GridPdfButton
            printTargetId="militares-print"
            label="Exportar"
            disabled={!someSelected}
            selectedCount={selectedIds.size}
          />
          <div className="flex rounded-xl border border-border overflow-hidden">
            <button type="button" onClick={() => setViewMode("cards")} title="Ver em cards"
              className={cn("px-3 py-2 transition-colors", viewMode === "cards" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted/60")}>
              <LayoutGrid className="size-4" />
            </button>
            <button type="button" onClick={() => setViewMode("table")} title="Ver em grade"
              className={cn("px-3 py-2 transition-colors", viewMode === "table" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted/60")}>
              <Table2 className="size-4" />
            </button>
          </div>
        </div>
      </div>

      <div id="militares-print">
        {viewMode === "cards" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {displayed.map((m) => (
              <MilitarCard
                key={m.id}
                militar={m}
                currentUserId={currentUserId}
                selected={selectedIds.has(m.id)}
                onToggle={toggleItem}
                onSelect={setSelected}
                onUserUpdated={handleUserUpdated}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 w-8">
                      <input
                        type="checkbox"
                        checked={allDisplayedSel}
                        ref={(el) => { if (el) el.indeterminate = someDisplayedSel && !allDisplayedSel; }}
                        onChange={toggleAll}
                        className="size-4 rounded accent-primary"
                        aria-label="Selecionar todos"
                      />
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label">Nome</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label">Matrícula</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label hidden sm:table-cell">Posto</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label">Biometria</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label">Em uso</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-label">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {displayed.map((m, i) => {
                    const initials = getInitials(m.nome_completo);
                    const isPending = m.registration_status === "pending_biometric";
                    return (
                      <tr
                        key={m.id}
                        onClick={() => setSelected(m)}
                        className={cn(
                          "cursor-pointer hover:bg-primary/5 transition-colors",
                          i < displayed.length - 1 ? "border-b border-border/60" : "",
                          selectedIds.has(m.id) && "bg-primary/5"
                        )}
                      >
                        <td className="px-4 py-3" onClick={(e) => { e.stopPropagation(); toggleItem(m.id); }}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(m.id)}
                            onChange={() => toggleItem(m.id)}
                            className="size-4 rounded accent-primary"
                            aria-label={`Selecionar ${m.nome_completo}`}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {m.foto_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={m.foto_url} alt={m.nome_completo}
                                className="w-9 h-9 rounded-lg object-cover shrink-0 ring-1 ring-border cursor-zoom-in hover:ring-2 hover:ring-primary/50 transition-all"
                                onClick={(e) => { e.stopPropagation(); setPhotoLightbox(m.foto_url!); }} />
                            ) : (
                              <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                                {initials || <User className="size-4" />}
                              </div>
                            )}
                            <span className="font-medium text-foreground">{m.nome_completo}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{m.matricula}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={m.registration_status} />
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground hidden sm:table-cell">{m.posto ?? "—"}</td>
                        <td className="px-4 py-3">
                          {isPending || m.registeredFingers.length === 0 ? (
                            <span className="badge-warning text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5">Bio Pendente</span>
                          ) : !m.totp_configured ? (
                            <abbr title="TOTP pendente" className="no-underline">
                              <span className="badge-warning text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5 cursor-help">TOTP Pendente</span>
                            </abbr>
                          ) : (
                            <span className="badge-success text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5">Completo</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {m.activeCount > 0 ? (
                            <span className="badge-in-use text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5">{m.activeCount}</span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <UserRowActions
                            user={{ ...m, role: "usuario" }}
                            currentUserId={currentUserId}
                            onUserUpdated={handleUserUpdated}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Ver mais */}
      {hasMore && (
        <div className="relative flex justify-end mt-3">
          <button
            data-testid="btn-ver-mais"
            type="button"
            onClick={() => setShowLimitMenu((v) => !v)}
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted/60 transition-colors"
          >
            <ChevronDown className="size-4" />
            Ver mais
          </button>
          {showLimitMenu && (
            <div className="absolute right-0 bottom-full mb-1 z-10 rounded-xl border border-border bg-card shadow-md overflow-hidden min-w-40">
              {[20, 30].map((n) => (
                <button
                  key={n}
                  data-testid={`btn-limit-${n}`}
                  type="button"
                  onClick={() => { setShowLimitMenu(false); setDisplayLimit(n); }}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted/60 transition-colors"
                >
                  Mostrar {n} registros
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {selected && (
        <MilitarSheet
          key={selected.id}
          militar={selected}
          callerRole={callerRole}
          open={!!selected}
          onClose={() => setSelected(null)}
          onStatusChange={handleStatusChange}
        />
      )}
    </>
  );
}
