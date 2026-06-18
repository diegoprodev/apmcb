"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldAlert, UserCheck, UserX } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { csrfHeaders } from "@/lib/csrf";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

export type RegistrationStatus =
  | "complete"
  | "inactive"
  | "pending_biometric"
  | "impedimento_administrativo";

interface Props {
  userId: string;
  userName: string;
  currentStatus: RegistrationStatus;
  callerRole: "admin" | "master";
  onSuccess?: (newStatus: RegistrationStatus) => void;
}

const STATUS_LABELS: Record<RegistrationStatus, string> = {
  complete: "Ativo",
  inactive: "Inativo",
  pending_biometric: "Cadastro pendente",
  impedimento_administrativo: "Impedimento Adm.",
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
  const [targetStatus, setTargetStatus] = useState<RegistrationStatus | null>(null);
  const [loading, setLoading] = useState(false);

  // Available transitions
  const options: { status: RegistrationStatus; label: string; icon: React.ReactNode; variant: "default" | "destructive" | "outline" }[] = [
    ...(currentStatus !== "complete"
      ? [{ status: "complete" as RegistrationStatus, label: "Ativar conta", icon: <UserCheck className="size-4" />, variant: "default" as const }]
      : []),
    ...(currentStatus !== "inactive"
      ? [{ status: "inactive" as RegistrationStatus, label: "Desativar conta", icon: <UserX className="size-4" />, variant: "destructive" as const }]
      : []),
    ...(callerRole === "admin" && currentStatus !== "impedimento_administrativo"
      ? [{ status: "impedimento_administrativo" as RegistrationStatus, label: "Aplicar Impedimento Adm.", icon: <ShieldAlert className="size-4" />, variant: "destructive" as const }]
      : []),
    ...(callerRole === "admin" && currentStatus === "impedimento_administrativo"
      ? [{ status: "complete" as RegistrationStatus, label: "Remover Impedimento", icon: <UserCheck className="size-4" />, variant: "default" as const }]
      : []),
  ].filter((o) => o.status !== currentStatus);

  async function handleConfirm() {
    if (!targetStatus) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const authHeader: Record<string, string> = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};

      const res = await fetch(`${BFF_URL}/api/profiles/${userId}/status`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeader, ...csrfHeaders() },
        body: JSON.stringify({ status: targetStatus }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Erro ao alterar status");

      toast.success(`Status de ${userName} alterado para ${STATUS_LABELS[targetStatus]}`);
      onSuccess?.(targetStatus);
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao alterar status");
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
              {(targetStatus === "complete" || targetStatus === "pending_biometric") && (
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
                targetStatus === "complete" || targetStatus === "pending_biometric"
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
