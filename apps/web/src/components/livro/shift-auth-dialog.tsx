"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, KeyRound, Fingerprint } from "lucide-react";

export type ShiftAuthMode = "totp" | "biometria";

interface ShiftAuthDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  confirmVariant?: "default" | "destructive";
  confirmDisabled?: boolean;
  submitting: boolean;
  onConfirm: (authMode: ShiftAuthMode, totpToken?: string) => void;
  onCancel: () => void;
  children?: React.ReactNode;
  /**
   * O SDK ZKTeco em produção é um stub (verify() sempre retorna false) e o BFF
   * roda num VPS sem leitor USB conectado — a aba de biometria hoje é uma
   * autenticação que sempre falha. Mantida oculta até o SDK real estar
   * integrado; controlado por NEXT_PUBLIC_BIOMETRIC_ENABLED no caller.
   */
  biometricAvailable?: boolean;
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
  biometricAvailable = false,
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

  // Biometric capture happens server-side (ZKTeco SDK) during the shift action itself.
  // Clicking "Confirmar com Digital" directly triggers the action with auth_mode=biometria.
  // The BFF captures the fingerprint ONCE in the shift open/close handler.
  function handleBioConfirm() {
    onConfirm("biometria");
    resetState();
  }

  const totpValid = totpToken.length === 6 && /^\d{6}$/.test(totpToken);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {children && <div className="py-2">{children}</div>}

        <Tabs value={authTab} onValueChange={(v) => setAuthTab(v as ShiftAuthMode)}>
          {biometricAvailable && (
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="totp" className="flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5" />
                TOTP
              </TabsTrigger>
              <TabsTrigger value="biometria" className="flex items-center gap-1.5">
                <Fingerprint className="h-3.5 w-3.5" />
                Biometria
              </TabsTrigger>
            </TabsList>
          )}

          <TabsContent value="totp" className="space-y-3 mt-3">
            <div className="space-y-1.5">
              <Label htmlFor="shift-totp-input">
                Código TOTP do seu autenticador
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
              <p className="text-xs text-muted-foreground">
                Toque em &quot;Meu Perfil&quot; para ver seu código de acesso atual e digite-o abaixo para confirmar.
              </p>
            </div>
          </TabsContent>

          {biometricAvailable && <TabsContent value="biometria" className="mt-3">
            <div className="flex flex-col items-center gap-3 py-4">
              <div className={`rounded-full p-5 transition-colors ${submitting ? "bg-blue-500/20 animate-pulse" : "bg-muted"}`}>
                <Fingerprint className={`h-10 w-10 ${submitting ? "text-blue-500" : "text-muted-foreground"}`} />
              </div>
              <p className="text-sm text-center text-muted-foreground">
                {submitting
                  ? "Aguardando leitura biométrica... coloque o dedo no leitor."
                  : "Clique no botão abaixo e coloque seu dedo no leitor biométrico quando solicitado."}
              </p>
              <p className="text-xs text-center text-muted-foreground/70">
                O leitor será ativado ao confirmar a ação.
              </p>
            </div>
          </TabsContent>}
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={submitting}>
            Cancelar
          </Button>
          {!biometricAvailable || authTab === "totp" ? (
            <Button
              variant={confirmVariant}
              onClick={handleTotpConfirm}
              disabled={submitting || !totpValid || confirmDisabled}
              data-testid="shift-auth-confirm"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {confirmLabel}
            </Button>
          ) : (
            <Button
              variant={confirmVariant}
              onClick={handleBioConfirm}
              disabled={submitting || confirmDisabled}
              data-testid="shift-auth-bio-confirm"
            >
              {submitting
                ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Capturando...</>
                : <><Fingerprint className="h-4 w-4 mr-1" /> {confirmLabel}</>}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
