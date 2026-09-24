"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Fingerprint, RefreshCw, Search, TimerReset, WifiOff, XCircle } from "lucide-react";
import { toast } from "sonner";
import { ApiError, friendlyApiError } from "@/lib/api-error";
import { bffFetch } from "@/lib/bff-client";
import { formatTime } from "@/lib/format-date";
import { fingerName } from "@/components/ui/finger-selector";
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

// Motivos técnicos enviados pelo leitor/bridge nunca aparecem crus na tela.
function friendlyFailure(reason: string | null | undefined, isEnroll: boolean): string {
  const r = (reason ?? "").toLowerCase();
  if (r.includes("falso") || r.includes("lfd")) return "Não foi possível validar o dedo. Limpe o dedo e o leitor e tente de novo.";
  if (r.includes("timeout") || r.includes("cancelad")) return "O leitor não recebeu o dedo a tempo. Tente novamente.";
  if (r.includes("desconectado") || r.includes("aberto") || r.includes("leitor")) return "O leitor não respondeu. Confira se ele está conectado e tente de novo.";
  if (isEnroll) return "Não conseguimos registrar a digital. Tente novamente.";
  return "Não encontramos essa digital entre as cadastradas. Tente com o dedo cadastrado ou use o código dinâmico.";
}

const POLL_INTERVAL_MS = 1_000;
const MAX_POLL_FAILURES = 5;

// Depois que o dedo é apoiado a janela do leitor some e o resultado ainda leva
// alguns segundos (bridge + servidor). Em vez de uma tela parada, a espera vira
// fases animadas — a partir de FINGER_WAIT_MS o texto passa a girar entre elas.
const FINGER_WAIT_MS = 6_000;
const PHASE_ROTATE_MS = 1_600;
const PROCESSING_PHASES_IDENTIFY = [
  "Validando seus dados…",
  "Localizando biometria…",
  "Conferindo o cadastro…",
  "Quase lá…",
];
const PROCESSING_PHASES_ENROLL = ["Registrando a digital…", "Protegendo seus dados…", "Quase lá…"];

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
  const [waitedMs, setWaitedMs] = useState(0);

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

  useEffect(() => {
    if (state !== "pending") return;
    const startedAt = Date.now();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWaitedMs(0);
    const timer = window.setInterval(() => setWaitedMs(Date.now() - startedAt), 400);
    return () => window.clearInterval(timer);
  }, [state]);

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

  const isEnroll = purpose === "enroll";
  const processingPhases = isEnroll ? PROCESSING_PHASES_ENROLL : PROCESSING_PHASES_IDENTIFY;
  const processing = state === "pending" && waitedMs >= FINGER_WAIT_MS;
  const enrolledFinger = result?.proof?.finger_index ?? null;
  const statusCopy: Record<CaptureState, { title: string; detail: string }> = {
    idle: {
      title: isEnroll ? "Cadastro da digital" : "Pronto para identificar",
      detail: isEnroll ? "Clique em cadastrar para abrir a janela do leitor." : "Inicie quando a pessoa estiver com o dedo no leitor.",
    },
    pending: processing
      ? {
          title: processingPhases[Math.floor((waitedMs - FINGER_WAIT_MS) / PHASE_ROTATE_MS) % processingPhases.length],
          detail: "Se a janela do leitor ainda estiver aberta, siga as instruções nela.",
        }
      : {
          title: isEnroll ? "Siga a janela do leitor" : "Aguardando o dedo",
          detail: isEnroll
            ? `Escolha o dedo na janela do leitor e siga as instruções. Você tem até as ${expiresAt ? formatTime(expiresAt) : "próximos minutos"}.`
            : `Apoie o dedo no leitor. Você tem até as ${expiresAt ? formatTime(expiresAt) : "próximos minutos"}.`,
        },
    success: {
      title: isEnroll ? "Digital cadastrada" : "Identidade confirmada",
      detail: isEnroll
        ? (enrolledFinger ? `${fingerName(enrolledFinger)} cadastrado com sucesso.` : "Digital cadastrada com sucesso.")
        : "Pode continuar.",
    },
    failure: {
      title: isEnroll ? "Não foi possível cadastrar" : "Digital não reconhecida",
      detail: friendlyFailure(result?.proof?.failure_reason, isEnroll),
    },
    expired: {
      title: "Tempo esgotado",
      detail: "O leitor não recebeu o dedo a tempo. Tente novamente.",
    },
    retry: {
      title: "Conexão interrompida",
      detail: "Não foi possível acompanhar o leitor. Verifique a internet e o leitor e tente novamente.",
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
          <div className="flex flex-col items-center gap-5 pt-3 text-center" data-testid={`biometric-state-${state}`}>
            <div className="relative">
              {state === "pending" && processing && (
                <span aria-hidden className="absolute -inset-1.5 rounded-full border-4 border-primary/15 border-t-primary animate-spin" />
              )}
              <div
                className={`relative flex size-24 items-center justify-center rounded-full ${
                  state === "success" ? "bg-emerald-100 text-emerald-600 animate-[bio-pop_0.5s_ease-out]"
                  : state === "failure" ? "bg-red-100 text-red-600 animate-[bio-shake_0.45s_ease-in-out]"
                  : state === "expired" ? "bg-amber-100 text-amber-600"
                  : state === "retry" ? "bg-muted text-muted-foreground"
                  : "bg-primary/10 text-primary"
                }`}
              >
                {state === "success" && <CheckCircle2 className="size-12" />}
                {state === "failure" && <XCircle className="size-12" />}
                {state === "expired" && <TimerReset className="size-12" />}
                {state === "retry" && <WifiOff className="size-12" />}
                {(state === "idle" || state === "pending") && (
                  <Fingerprint className={`size-12 ${state === "pending" && !processing ? "animate-pulse" : ""}`} />
                )}
              </div>
            </div>

            <DialogHeader className="items-center text-center sm:text-center gap-2">
              <DialogTitle key={statusCopy[state].title} className="text-2xl font-semibold animate-[bio-fade-up_0.3s_ease-out]">
                {statusCopy[state].title}
              </DialogTitle>
              <DialogDescription className="text-base leading-snug">{statusCopy[state].detail}</DialogDescription>
            </DialogHeader>

            {state === "success" && result?.matched_user && (
              <div className="w-full rounded-2xl border bg-muted/30 px-5 py-4 animate-[bio-fade-up_0.4s_ease-out]">
                <p className="text-xl font-bold">{result.matched_user.nome_completo}</p>
                <p className="mt-1 text-base text-muted-foreground">
                  {[result.matched_user.posto, `Mat. ${result.matched_user.matricula}`].filter(Boolean).join(" · ")}
                </p>
              </div>
            )}
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
