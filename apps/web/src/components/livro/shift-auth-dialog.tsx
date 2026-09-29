"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SelfTotpHint } from "@/components/shared/self-totp-hint";
import { Loader2, KeyRound, Fingerprint } from "lucide-react";
import { BiometricCaptureDialog, type BiometricResult } from "@/components/biometric/biometric-capture-dialog";

export type ShiftAuthMode = "totp" | "biometria";

interface ShiftAuthDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  confirmVariant?: "default" | "destructive";
  confirmDisabled?: boolean;
  submitting: boolean;
  onConfirm: (authMode: ShiftAuthMode, totpToken?: string, biometricProofId?: string) => void;
  onCancel: () => void;
  children?: React.ReactNode;
  /** "open" -> purpose open_shift, documentId null (nenhum turno existe ainda). "close" -> purpose close_shift, documentId=shiftId. */
  variant: "open" | "close";
  shiftId?: string;
  reserveId: string;
  canCapture: boolean;
  currentUserId: string;
  simulatorEnabled?: boolean;
}

/**
 * Reusable auth dialog for shift operations.
 * Shows two tabs: TOTP (6-digit code) and Biometria (ZKTeco capture).
 * Calls onConfirm with the chosen auth mode and token.
 */
export function ShiftAuthDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmVariant = "default",
  confirmDisabled = false,
  submitting,
  onConfirm,
  onCancel,
  children,
  variant,
  shiftId,
  reserveId,
  canCapture,
  currentUserId,
  simulatorEnabled,
}: ShiftAuthDialogProps) {
  const [authTab, setAuthTab] = useState<ShiftAuthMode>("totp");
  const [totpToken, setTotpToken] = useState("");

  function resetState() {
    setTotpToken("");
    setAuthTab("totp");
  }

  function handleCancel() {
    resetState();
    onCancel();
  }

  function handleTotpConfirm() {
    if (totpToken.length !== 6) return;
    onConfirm("totp", totpToken);
    resetState();
  }

  function handleBiometricResult(result: BiometricResult) {
    if (result.proof?.result === "success") {
      onConfirm("biometria", undefined, result.proof.id);
      // Não chama resetState() aqui — voltar authTab pra "totp" desmontaria
      // (TabsContent) a própria tela de sucesso do BiometricCaptureDialog
      // antes do usuário vê-la, e antes de onConfirm (assíncrono) terminar.
    }
    // onResult só dispara no branch de sucesso do BiometricCaptureDialog —
    // falha/expirado/cancelamento nunca chamam esta função; ele mesmo mostra
    // seu estado de erro e "Tentar novamente" internamente.
  }

  // Reseta authTab/totpToken quando o dialog fecha, por QUALQUER caminho —
  // TOTP e cancelamento já resetam nos próprios pontos; isto cobre o pai
  // fechando via `open=false` direto (sem passar por handleCancel). Ajuste de
  // estado durante o render na transição de `open` (padrão do React para
  // "resetar estado quando uma prop muda"), sem setState dentro de efeito.
  // Só age em open:true→false, não interfere com a tela de sucesso do
  // BiometricCaptureDialog (nesse ponto o Dialog já está fechando).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) resetState();
  }

  const totpValid = totpToken.length === 6 && /^\d{6}$/.test(totpToken);

  // Turno por digital é 1:1 com o próprio armeiro (o servidor recusa desafio
  // sem ele): sem reserva ou sem usuário, a captura nem é montada — mesmo
  // padrão do SignDialog.
  const biometricUnavailableReason = !reserveId
    ? variant === "open"
      ? "Selecione a reserva para usar a biometria."
      : "Não foi possível identificar a reserva do turno. Use o código dinâmico."
    : !currentUserId
      ? "Não foi possível preparar a biometria agora. Use o código dinâmico ou recarregue a página."
      : null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {children && <div className="py-2">{children}</div>}

        <Tabs value={authTab} onValueChange={(v) => setAuthTab(v as ShiftAuthMode)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="totp" className="flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5" />
              Código dinâmico
            </TabsTrigger>
            <TabsTrigger value="biometria" className="flex items-center gap-1.5">
              <Fingerprint className="h-3.5 w-3.5" />
              Biometria
            </TabsTrigger>
          </TabsList>

          <TabsContent value="totp" className="space-y-3 mt-3">
            <SelfTotpHint onUse={setTotpToken} />
            <div className="space-y-1.5">
              <Label htmlFor="shift-totp-input">
                Código dinâmico do seu autenticador
              </Label>
              <Input
                id="shift-totp-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="000000"
                value={totpToken}
                onChange={(e) => setTotpToken(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => { if (e.key === "Enter" && totpValid && !submitting) handleTotpConfirm(); }}
                className="text-center text-xl tracking-[0.5em] font-mono"
                autoComplete="one-time-code"
                data-testid="shift-totp-input"
              />
            </div>
          </TabsContent>

          <TabsContent value="biometria" className="mt-3">
            {biometricUnavailableReason ? (
              <div className="flex flex-col items-center gap-3 py-3 rounded-xl border border-dashed border-border bg-muted/30">
                <Fingerprint className="size-12 text-muted-foreground" />
                <p className="text-xs text-muted-foreground text-center">
                  {biometricUnavailableReason}
                </p>
              </div>
            ) : (
              <div className="flex justify-center py-2">
                <BiometricCaptureDialog
                  reserveId={reserveId}
                  canCapture={canCapture}
                  simulatorEnabled={simulatorEnabled}
                  // Turno é autoautenticação: no simulador, a digital
                  // simulada é sempre a do próprio armeiro.
                  simulationUserId={currentUserId}
                  purpose={variant === "open" ? "open_shift" : "close_shift"}
                  expectedUserId={currentUserId}
                  documentId={variant === "close" ? shiftId : undefined}
                  buttonLabel={confirmLabel}
                  onResult={handleBiometricResult}
                />
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={submitting}>
            Cancelar
          </Button>
          {authTab === "totp" && (
            <Button
              variant={confirmVariant}
              onClick={handleTotpConfirm}
              disabled={submitting || !totpValid || confirmDisabled}
              data-testid="shift-auth-confirm"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {confirmLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
