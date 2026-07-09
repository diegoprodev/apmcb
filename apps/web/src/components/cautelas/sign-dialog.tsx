"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { bffFetch } from "@/lib/bff-client";
import { toast } from "sonner";
import { Fingerprint, KeyRound, ShieldCheck, Loader2 } from "lucide-react";

export type SignRole = "armeiro" | "militar";
type AuthMethod = "totp" | "biometria";

interface SignDialogProps {
  open: boolean;
  cautelaId: string;
  role: SignRole;
  onClose: () => void;
  onDone: () => void;
}

export function SignDialog({ open, cautelaId, role, onClose, onDone }: SignDialogProps) {
  const [method, setMethod] = useState<AuthMethod>("totp");
  const [totpCode, setTotpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [bioCapturing, setBioCapturing] = useState(false);

  const endpoint = role === "armeiro"
    ? `/api/cautelamentos/${cautelaId}/sign-armeiro`
    : `/api/cautelamentos/${cautelaId}/sign-militar`;
  const roleLabel = role === "armeiro" ? "Armeiro" : "Individual";

  async function handleTotp() {
    if (totpCode.length !== 6) { toast.error("Digite os 6 dígitos do código TOTP"); return; }
    setLoading(true);
    try {
      const { ok, data } = await bffFetch("POST", endpoint, { totp_token: totpCode });
      if (!ok) { toast.error(data.error ?? "Falha na assinatura"); return; }
      toast.success(`Assinatura do ${roleLabel} registrada via TOTP`);
      setTotpCode("");
      onDone();
    } finally { setLoading(false); }
  }

  async function handleBiometria() {
    setBioCapturing(true);
    try {
      const { ok, data } = await bffFetch("POST", endpoint, { use_biometric: true });
      if (!ok) { toast.error(data.error ?? "Falha na captura biométrica"); return; }
      toast.success(`Assinatura do ${roleLabel} registrada via biometria`);
      onDone();
    } finally { setBioCapturing(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Assinatura — {roleLabel}</DialogTitle>
          <DialogDescription>Escolha o método de verificação de identidade</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setMethod("totp")}
            className={`flex flex-col items-center gap-2 rounded-xl border p-3 text-sm font-medium transition-colors ${method === "totp" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}>
            <KeyRound className="size-5" /> TOTP
          </button>
          <button onClick={() => setMethod("biometria")}
            className={`flex flex-col items-center gap-2 rounded-xl border p-3 text-sm font-medium transition-colors ${method === "biometria" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}>
            <Fingerprint className="size-5" /> Biometria
          </button>
        </div>
        {method === "totp" ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Código TOTP (6 dígitos)</Label>
              <Input value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000" inputMode="numeric" maxLength={6}
                className="text-center text-2xl font-mono tracking-[0.4em]"
                autoFocus onKeyDown={(e) => e.key === "Enter" && handleTotp()} />
            </div>
            <Button className="w-full" onClick={handleTotp} disabled={loading || totpCode.length !== 6}>
              {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : <ShieldCheck className="size-4 mr-2" />}
              Assinar com TOTP
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-col items-center gap-3 py-3 rounded-xl border border-dashed border-border bg-muted/30">
              <Fingerprint className={`size-12 ${bioCapturing ? "animate-pulse text-primary" : "text-muted-foreground"}`} />
              <p className="text-xs text-muted-foreground text-center">
                {bioCapturing ? "Aguardando captura no leitor biométrico..." : "Posicione o dedo no leitor biométrico e clique em capturar"}
              </p>
            </div>
            <Button className="w-full" onClick={handleBiometria} disabled={bioCapturing}>
              {bioCapturing ? <Loader2 className="size-4 animate-spin mr-2" /> : <Fingerprint className="size-4 mr-2" />}
              {bioCapturing ? "Capturando..." : "Capturar Biometria"}
            </Button>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={loading || bioCapturing}>Cancelar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
