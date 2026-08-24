"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { bffFetch } from "@/lib/bff-client";
import { toast } from "sonner";
import { friendlyApiError } from "@/lib/api-error";
import { SelfTotpHint } from "@/components/shared/self-totp-hint";
import { Fingerprint, KeyRound, ShieldCheck, Loader2, Info } from "lucide-react";

export type SignRole = "armeiro" | "militar";
type AuthMethod = "totp" | "biometria";

interface SignDialogProps {
  open: boolean;
  cautelaId: string;
  role: SignRole;
  onClose: () => void;
  onDone: () => void;
  /**
   * Achado real (mesmo bug relatado pelo usuário resolvido em openEmitir):
   * o pré-check de turno ativo antes de abrir este dialog cobre o caminho
   * feliz, mas o BFF ainda pode rejeitar com 403 SHIFT_REQUIRED no clique
   * final (race condition — turno encerrado entre o pré-check e o clique).
   * Sem este callback, o erro cairia no toast genérico de baixo, mostrando
   * literalmente "SHIFT_REQUIRED" ao usuário. Quando presente, os handlers
   * de TOTP/biometria fecham este dialog (via onClose) e delegam ao pai
   * mostrar o ShiftRequiredDialog, em vez de exibir o toast genérico.
   */
  onShiftRequired?: () => void;
  /**
   * Achado real de UX/segurança: `role` decide qual endpoint chamar
   * (sign-armeiro vs sign-militar), mas NÃO decide se quem está diante da
   * tela agora é a mesma pessoa cuja assinatura está sendo capturada.
   * Em /efetivo/minhas-cautelas o próprio militar está logado (self-sign,
   * default true) — o hint de "seu código atual" (SelfTotpHint) é
   * correto ali. Em /reserva/cautelas o ARMEIRO abre este dialog com
   * role="militar" só para FACILITAR a assinatura de alguém que pode nem
   * estar logado — aí selfSign=false: mostrar o próprio código do armeiro
   * seria mostrar o código da pessoa errada (o backend valida o TOTP
   * contra o secret do militar_id da cautela, nunca do usuário logado).
   */
  selfSign?: boolean;
  /**
   * Cautela com múltiplos materiais: quando presente, assina TODAS as
   * cautelas do mesmo movement_id com 1 verificação de TOTP/biometria
   * (endpoint /batch/:movementId/sign-*), em vez de uma única cautela por
   * `cautelaId`. Reaproveita o mesmo componente (picker TOTP/biometria é
   * idêntico) em vez de duplicar — só o endpoint chamado e a mensagem de
   * sucesso mudam.
   */
  batch?: { movementId: string; count: number };
}

export function SignDialog({ open, cautelaId, role, onClose, onDone, selfSign = true, batch, onShiftRequired }: SignDialogProps) {
  const [method, setMethod] = useState<AuthMethod>("totp");
  const [totpCode, setTotpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [bioCapturing, setBioCapturing] = useState(false);

  // O componente nunca desmonta entre uma cautela/lote e outro (só alterna
  // `open`) — sem isto, um código parcial digitado e cancelado numa cautela
  // continuaria no campo ao reabrir pra outra. Achado de code review: o
  // fluxo de lote reabre este dialog com mais frequência na mesma sessão de
  // tela (grade → lote → grade → outro lote) do que o fluxo singular.
  useEffect(() => {
    if (open) { setTotpCode(""); setMethod("totp"); }
  }, [open]);

  const endpoint = batch
    ? `/api/cautelamentos/batch/${batch.movementId}/sign-${role === "armeiro" ? "armeiro" : "militar"}`
    : role === "armeiro"
      ? `/api/cautelamentos/${cautelaId}/sign-armeiro`
      : `/api/cautelamentos/${cautelaId}/sign-militar`;
  const roleLabel = role === "armeiro" ? "Armeiro" : "Usuário";
  const successLabel = batch ? `Assinatura de ${batch.count} cautelas` : `Assinatura do ${roleLabel}`;

  async function handleTotp() {
    if (totpCode.length !== 6) { toast.error("Digite os 6 dígitos do código TOTP"); return; }
    setLoading(true);
    try {
      const { ok, data, status } = await bffFetch("POST", endpoint, { totp_token: totpCode });
      if (!ok) {
        console.error("[sign-dialog] falha na assinatura via TOTP", { status, error: data.error });
        if (data.error === "SHIFT_REQUIRED") { onClose(); onShiftRequired?.(); return; }
        toast.error(friendlyApiError(status, data.error, "Falha na assinatura"));
        return;
      }
      toast.success(`${successLabel} registrada via TOTP`);
      setTotpCode("");
      onDone();
    } finally { setLoading(false); }
  }

  async function handleBiometria() {
    setBioCapturing(true);
    try {
      const { ok, data, status } = await bffFetch("POST", endpoint, { use_biometric: true });
      if (!ok) {
        console.error("[sign-dialog] falha na assinatura via biometria", { status, error: data.error });
        if (data.error === "SHIFT_REQUIRED") { onClose(); onShiftRequired?.(); return; }
        toast.error(friendlyApiError(status, data.error, "Falha na captura biométrica"));
        return;
      }
      toast.success(`${successLabel} registrada via biometria`);
      onDone();
    } finally { setBioCapturing(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            Assinatura — {roleLabel}
            {batch && batch.count > 1 && <span className="text-muted-foreground font-normal"> (lote de {batch.count})</span>}
          </DialogTitle>
          <DialogDescription>
            {batch && batch.count > 1
              ? `Escolha o método de verificação — cobre as ${batch.count} cautelas deste lote de uma vez`
              : "Escolha o método de verificação de identidade"}
          </DialogDescription>
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
            {selfSign ? (
              <SelfTotpHint onUse={setTotpCode} />
            ) : (
              <div className="flex gap-2 rounded-lg border border-dashed border-amber-400/50 bg-amber-50 dark:bg-amber-950/20 px-3 py-2.5">
                <Info className="size-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-xs font-medium text-amber-800 dark:text-amber-400">
                    Este código é pessoal do usuário, não do armeiro
                  </p>
                  <p className="text-[11px] text-amber-700/90 dark:text-amber-400/80 leading-snug">
                    Peça ao usuário o código de acesso dinâmico dele (visível no perfil dele) e digite abaixo.
                    Ou peça para ele assinar por biometria, ou pelo próprio app dele em &quot;Minhas Cautelas&quot;.
                  </p>
                </div>
              </div>
            )}
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
