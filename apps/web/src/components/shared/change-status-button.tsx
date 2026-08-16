"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldAlert, UserCheck, UserX } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf";
import { ApiError, friendlyApiError } from "@/lib/api-error";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

export type RegistrationStatus =
  | "complete"
  | "inactive"
  | "pending_biometric"
  | "impedimento_administrativo";

// Valor sintético aceito só por PATCH /api/profiles/:id/status — nunca
// existe de fato em registration_status no banco. "complete" não pode mais
// ser setado diretamente por aqui (achado real de produção, 2026-08-15:
// deixava o admin declarar biometria capturada sem ela nunca ter existido —
// só a RPC de enrollment biométrico pode legitimamente setar "complete").
// O backend resolve "reactivate" pro estado real (complete/pending_biometric)
// checando se o usuário TEM template biométrico cadastrado.
type StatusAction = RegistrationStatus | "reactivate";

interface Props {
  userId: string;
  userName: string;
  currentStatus: RegistrationStatus;
  // "admin" cobre admin_global/superadmin (aplica impedimento administrativo);
  // "master" cobre armeiro/admin_reserva (só ativa/desativa).
  callerRole: "admin" | "master";
  onSuccess?: (newStatus: RegistrationStatus) => void;
}

const STATUS_LABELS: Record<StatusAction, string> = {
  complete: "Ativo",
  inactive: "Inativo",
  pending_biometric: "Cadastro pendente",
  impedimento_administrativo: "Impedimento Adm.",
  reactivate: "Ativo",
};

export function ChangeStatusButton({
  userId,
  userName,
  currentStatus,
  callerRole,
  onSuccess,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [targetStatus, setTargetStatus] = useState<StatusAction | null>(null);
  const [loading, setLoading] = useState(false);

  // Available transitions
  const options: { status: StatusAction; label: string; icon: React.ReactNode; variant: "default" | "destructive" | "outline" }[] = [
    ...(currentStatus !== "complete"
      ? [{ status: "reactivate" as StatusAction, label: "Ativar conta", icon: <UserCheck className="size-4" />, variant: "default" as const }]
      : []),
    ...(currentStatus !== "inactive"
      ? [{ status: "inactive" as StatusAction, label: "Desativar conta", icon: <UserX className="size-4" />, variant: "destructive" as const }]
      : []),
    ...(callerRole === "admin" && currentStatus !== "impedimento_administrativo"
      ? [{ status: "impedimento_administrativo" as StatusAction, label: "Aplicar Impedimento Adm.", icon: <ShieldAlert className="size-4" />, variant: "destructive" as const }]
      : []),
    ...(callerRole === "admin" && currentStatus === "impedimento_administrativo"
      ? [{ status: "reactivate" as StatusAction, label: "Remover Impedimento", icon: <UserCheck className="size-4" />, variant: "default" as const }]
      : []),
  ].filter((o) => o.status !== currentStatus);

  async function handleConfirm() {
    if (!targetStatus) return;
    setLoading(true);
    try {
      const res = await fetch(`${BFF_URL}/api/profiles/${userId}/status`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ status: targetStatus }),
      });
      const data = await res.json() as { error?: string; status?: RegistrationStatus };
      if (!res.ok) {
        console.error("[change-status-button] falha ao alterar status", { status: res.status, error: data.error });
        throw new ApiError(friendlyApiError(res.status, data.error, "Erro ao alterar status"), res.status);
      }
      // O backend resolve "reactivate" pro estado real (complete ou
      // pending_biometric) — usa o valor DEVOLVIDO na resposta, nunca o
      // sentinel que foi enviado, pro toast e pro callback refletirem o
      // que de fato foi persistido.
      const resolvedStatus = data.status ?? (targetStatus === "reactivate" ? "complete" : targetStatus);

      toast.success(`Status de ${userName} alterado para ${STATUS_LABELS[resolvedStatus]}`);
      onSuccess?.(resolvedStatus);
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  if (options.length === 0) return null;

  return (
    <>
      <div className="flex flex-col gap-1.5">
        {options.map((opt) => (
          <Button
            key={opt.status}
            variant={opt.variant}
            size="sm"
            className="w-full justify-start gap-2"
            onClick={() => { setTargetStatus(opt.status); setOpen(true); }}
          >
            {opt.icon}
            {opt.label}
          </Button>
        ))}
      </div>

      <Dialog open={open} onOpenChange={(v) => { if (!v) setOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {targetStatus === "impedimento_administrativo" && (
                <ShieldAlert className="size-5 text-destructive" />
              )}
              {targetStatus === "inactive" && <UserX className="size-5 text-destructive" />}
              {(targetStatus === "complete" || targetStatus === "pending_biometric" || targetStatus === "reactivate") && (
                <UserCheck className="size-5 text-emerald-600" />
              )}
              Confirmar alteração de status
            </DialogTitle>
          </DialogHeader>

          <div className="text-sm text-muted-foreground space-y-2">
            <p>
              Alterar <strong>{userName}</strong> para{" "}
              <strong>{targetStatus ? STATUS_LABELS[targetStatus] : ""}</strong>?
            </p>
            {targetStatus === "impedimento_administrativo" && (
              <p className="text-destructive">
                O militar não poderá retirar armamento. O armeiro verá um alerta ao tentar
                realizar armamento. Para dúvidas, o militar deve procurar o Departamento de
                Pessoas de sua unidade.
              </p>
            )}
            {targetStatus === "inactive" && (
              <p>O usuário perderá acesso ao sistema. Esta ação pode ser revertida.</p>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button
              variant={
                targetStatus === "complete" || targetStatus === "pending_biometric" || targetStatus === "reactivate"
                  ? "default"
                  : "destructive"
              }
              onClick={handleConfirm}
              disabled={loading}
            >
              {loading && <Loader2 className="size-4 animate-spin mr-1.5" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
