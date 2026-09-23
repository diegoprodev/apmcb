"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Fingerprint, Loader2, RefreshCw, Search, TimerReset, XCircle } from "lucide-react";
import { toast } from "sonner";
import { ApiError, friendlyApiError } from "@/lib/api-error";
import { bffFetch } from "@/lib/bff-client";
import { formatTime } from "@/lib/format-date";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type CaptureState = "idle" | "pending" | "success" | "failure" | "expired" | "retry";
export type BiometricPurpose =
  | "identify"
  | "enroll"
  | "confirm_saida_militar"
  | "return"
  | "open_shift"
  | "close_shift"
  | "sign_cautela_armeiro"
  | "sign_cautela_militar"
  | "handover_sign_exit"
  | "handover_sign_entry";

interface BiometricCaptureDialogProps {
  reserveId: string;
  canCapture: boolean;
  simulatorEnabled?: boolean;
  simulationUserId?: string;
  purpose?: BiometricPurpose;
  expectedUserId?: string;
  documentType?: string;
  documentId?: string;
  documentHash?: string;
  buttonLabel?: string;
  fingerIndex?: number;
  onResult?: (result: BiometricResult) => void;
}

interface ChallengeResponse {
  challenge?: {
    id: string;
    expires_at: string;
    status: string;
  };
  error?: string;
}

export interface BiometricResult {
  challenge: {
    id: string;
    status: string;
    expires_at: string;
    consumed_at: string | null;
  };
  proof: {
    id: string;
    result: string;
    failure_reason: string | null;
    match_score: number | null;
    finger_index: number | null;
    created_at: string;
  } | null;
  matched_user: {
    id: string;
    nome_completo: string;
    nome_de_guerra: string | null;
    matricula: string;
    posto: string | null;
    role: string;
    registration_status: string;
  } | null;
  error?: string;
}

const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_FAILURES = 5;

export function BiometricCaptureDialog({
  reserveId,
  canCapture,
  simulatorEnabled = false,
  simulationUserId,
  purpose = "identify",
  expectedUserId,
  documentType,
  documentId,
  documentHash,
  buttonLabel = "Identificar usuário",
  fingerIndex,
  onResult,
}: BiometricCaptureDialogProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<CaptureState>("idle");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [result, setResult] = useState<BiometricResult | null>(null);
  const [bridgeAvailable, setBridgeAvailable] = useState(false);
  const pollRef = useRef<number | null>(null);
  const pollRunRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    if (!canCapture || !reserveId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBridgeAvailable(false);
      return () => { mounted = false; };
    }
    if (simulatorEnabled) {
      setBridgeAvailable(true);
      return () => { mounted = false; };
    }
    void bffFetch("GET", `/api/biometric/devices?reserve_id=${encodeURIComponent(reserveId)}`, undefined, 8_000)
      .then((response) => {
        if (!mounted) return;
        const devices = (response.data as { devices?: Array<{ status?: string }> }).devices ?? [];
        setBridgeAvailable(response.ok && devices.some((device) => device.status === "active"));
      })
      .catch(() => {
        if (mounted) setBridgeAvailable(false);
      });
    return () => { mounted = false; };
  }, [canCapture, reserveId, simulatorEnabled]);

  useEffect(() => {
    return () => stopPolling();
  }, []);

  async function fetchResult(id: string) {
    const res = await bffFetch("GET", `/api/biometric/challenges/${id}/result`, undefined, 8_000);
    const data = res.data as BiometricResult;
    if (!res.ok) {
      const error = new ApiError(friendlyApiError(res.status, data.error, "Erro ao buscar resultado biométrico."), res.status);
      const retryAfterSeconds = (res.data as { retry_after_seconds?: number }).retry_after_seconds;
      throw Object.assign(error, { retryAfterMs: typeof retryAfterSeconds === "number" ? retryAfterSeconds * 1_000 : undefined });
    }

    if (data.challenge.status === "expired") {
      setState("expired");
      return data;
    }
    if (data.proof?.result === "success") {
      setResult(data);
      setState("success");
      onResult?.(data);
      return data;
    }
    if (data.proof?.result === "failure" || data.proof?.result === "error") {
      setResult(data);
      setState("failure");
      return data;
    }
    return data;
  }

  function stopPolling() {
    pollRunRef.current += 1;
    if (pollRef.current) {
      window.clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }

  // Polling sequencial (o próximo só é agendado quando o anterior termina):
  // com setInterval, respostas lentas do BFF (~1-3s) empilhavam requests em
  // paralelo e estouravam o rate limit (429) — erro visto no gate de
  // hardware. Falha transitória (rede/429) NÃO derruba o estado da tela:
  // só depois de várias seguidas o usuário vê "Tentar novamente".
  function startPolling(id: string) {
    stopPolling();
    const run = pollRunRef.current;
    let failures = 0;

    const tick = async () => {
      if (run !== pollRunRef.current) return;
      let delay = POLL_INTERVAL_MS;
      try {
        const data = await fetchResult(id);
        if (run !== pollRunRef.current) return;
        failures = 0;
        if (data.proof || data.challenge.status === "expired") return;
      } catch (error) {
        if (run !== pollRunRef.current) return;
        failures += 1;
        const retryAfterMs = (error as { retryAfterMs?: number }).retryAfterMs;
        if (retryAfterMs) delay = Math.max(delay, retryAfterMs);
        if (failures >= MAX_POLL_FAILURES) {
          console.warn("[biometric] acompanhamento interrompido após falhas seguidas", error);
          setState("retry");
          return;
        }
      }
      pollRef.current = window.setTimeout(tick, delay);
    };

    pollRef.current = window.setTimeout(tick, POLL_INTERVAL_MS);
  }

  async function completeSimulator(id: string) {
    if (!simulatorEnabled || !simulationUserId) return;
    if (purpose === "enroll") {
      const res = await bffFetch("POST", `/api/biometric/simulator/challenges/${id}/enroll`, {
        finger_index: fingerIndex ?? 1,
        quality: 95,
        liveness_passed: true,
      });
      if (!res.ok) {
        throw new ApiError(friendlyApiError(res.status, res.data.error, "Erro ao cadastrar biometria."), res.status);
      }
      return;
    }
    const res = await bffFetch("POST", `/api/biometric/simulator/challenges/${id}/complete`, {
      matched_user_id: simulationUserId,
      result: "success",
      match_score: 0.98,
      finger_index: 1,
      liveness_passed: true,
    });
    if (!res.ok) {
      throw new ApiError(friendlyApiError(res.status, res.data.error, "Erro ao executar o teste biométrico."), res.status);
    }
  }

  async function startCapture() {
    if (!canCapture || !bridgeAvailable) {
      toast.error("Nenhum leitor biométrico ativo nesta reserva.");
      return;
    }

    setOpen(true);
    setState("pending");
    setResult(null);
    setExpiresAt(null);

    try {
      const res = await bffFetch("POST", "/api/biometric/challenges", {
        reserve_id: reserveId,
        purpose,
        expected_user_id: expectedUserId ?? null,
        document_type: documentType ?? null,
        document_id: documentId ?? null,
        document_hash: documentHash ?? null,
      });
      const data = res.data as ChallengeResponse;
      if (!res.ok || !data.challenge) {
        throw new ApiError(friendlyApiError(res.status, data.error, "Erro ao iniciar identificação biométrica."), res.status);
      }

      setExpiresAt(data.challenge.expires_at);
      startPolling(data.challenge.id);

      if (simulatorEnabled) {
        await completeSimulator(data.challenge.id);
        await fetchResult(data.challenge.id);
        // O simulador já resolveu o desafio de forma síncrona acima — sem
        // isto, o polling armado por startPolling() (1.5s) acha o mesmo
        // proof "success" de novo e chama onResult() uma 2ª vez, disparando
        // um POST duplicado de consumo da prova no caller (SignDialog etc).
        stopPolling();
      }
    } catch (error) {
      console.error("[biometric] capture failed", error);
      setState("retry");
      toast.error(error instanceof ApiError ? error.message : "Falha de conexão com o servidor biométrico.");
    }
  }

  function retry() {
    setState("idle");
    void startCapture();
  }

  const statusCopy: Record<CaptureState, { title: string; detail: string }> = {
    idle: {
      title: "Pronto para identificar",
      detail: "Inicie a captura quando o usuário estiver presente no leitor.",
    },
    pending: {
      title: "Aguardando dedo no leitor",
      detail: expiresAt
        ? `Siga as instruções na janela do leitor. Você tem até as ${formatTime(expiresAt)}.`
        : "Siga as instruções na janela do leitor.",
    },
    success: {
      title: "Usuário identificado",
      detail: result?.matched_user
        ? `${result.matched_user.posto ?? ""} ${result.matched_user.nome_completo}`.trim()
        : "Identidade confirmada.",
    },
    failure: {
      title: "Identificação recusada",
      detail: result?.proof?.failure_reason ?? "O leitor não conseguiu confirmar a identidade.",
    },
    expired: {
      title: "Tempo esgotado",
      detail: "O tempo de captura terminou. Gere uma nova tentativa.",
    },
    retry: {
      title: "Tentativa interrompida",
      detail: "Verifique o leitor local e tente novamente.",
    },
  };

  return (
    <>
      <Button
        type="button"
        size="lg"
        onClick={startCapture}
        disabled={!canCapture || !bridgeAvailable || state === "pending"}
        data-testid="btn-biometric-identify"
      >
        <Search className="size-4" />
        {buttonLabel}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg" data-testid="biometric-capture-dialog">
          <DialogHeader>
            <DialogTitle>{statusCopy[state].title}</DialogTitle>
            <DialogDescription>{statusCopy[state].detail}</DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border bg-muted/30 p-5 text-center" data-testid={`biometric-state-${state}`}>
            {state === "pending" && <Loader2 className="mx-auto size-10 animate-spin text-primary" />}
            {state === "success" && <CheckCircle2 className="mx-auto size-10 text-emerald-600" />}
            {state === "failure" && <XCircle className="mx-auto size-10 text-red-600" />}
            {state === "expired" && <TimerReset className="mx-auto size-10 text-amber-600" />}
            {(state === "idle" || state === "retry") && <Fingerprint className="mx-auto size-10 text-primary" />}

            <div className="mt-4 space-y-1 text-sm">
              {result?.matched_user && (
                <>
                  <p className="font-semibold">{result.matched_user.nome_completo}</p>
                  <p className="text-muted-foreground">
                    {result.matched_user.posto ?? "Usuário"} · Mat. {result.matched_user.matricula}
                  </p>
                </>
              )}
            </div>
          </div>

          <DialogFooter>
            {(state === "retry" || state === "expired" || state === "failure") && (
              <Button type="button" onClick={retry} data-testid="btn-biometric-retry">
                <RefreshCw className="size-4" />
                Tentar novamente
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
