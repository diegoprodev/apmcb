"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Fingerprint, KeyRound, RefreshCw, ShieldCheck, ShieldOff, Usb } from "lucide-react";
import { toast } from "sonner";
import { ApiError, friendlyApiError } from "@/lib/api-error";
import { bffFetch } from "@/lib/bff-client";
import {
  BiometricBridgeStatus,
  type BridgeStatus,
} from "@/components/biometric/biometric-bridge-status";
import {
  BiometricCaptureDialog,
  type BiometricResult,
} from "@/components/biometric/biometric-capture-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface BiometricConsoleClientProps {
  reserveOptions: { id: string; nome: string }[];
  simulationUserId: string;
  /** admin_reserva/admin_global — só esses papéis podem revogar bridges (mesmo teto do BFF, roleGuard em POST /devices/:id/revoke). */
  canRevokeDevices: boolean;
}

interface BiometricDevice {
  id: string;
  reserve_id: string;
  device_name: string;
  sdk_vendor: string | null;
  sdk_version: string | null;
  bridge_version: string | null;
  status: "active" | "revoked" | string;
  is_simulator: boolean;
  paired_at: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
}

interface DevicesResponse {
  devices?: BiometricDevice[];
  simulator_available?: boolean;
  error?: string;
}

const DEVICE_STATUS_LABEL: Record<string, string> = {
  active: "Ativo",
  revoked: "Revogado",
  pending: "Pendente",
  suspended: "Suspenso",
};

function deviceStatusLabel(status: string): string {
  const label = DEVICE_STATUS_LABEL[status];
  if (!label && process.env.NODE_ENV !== "production") {
    console.warn(`[biometric] status de dispositivo sem tradução: "${status}"`);
  }
  return label ?? `Status: ${status}`;
}

function bridgeStatus(devices: BiometricDevice[]): BridgeStatus {
  if (devices.length === 0) return "missing";
  const active = devices.find((device) => device.status === "active");
  if (!active && devices.some((device) => device.status === "revoked")) return "revoked";
  if (!active) return "missing";
  if (active.is_simulator) return "simulator";
  if (!active.last_seen_at) return "offline";
  const lastSeenMs = new Date(active.last_seen_at).getTime();
  if (!Number.isFinite(lastSeenMs) || Date.now() - lastSeenMs > 5 * 60_000) return "offline";
  return "active";
}

interface PairingCodeResponse {
  pairing_code?: string;
  expires_at?: string;
  reserve_id?: string;
  error?: string;
}

// Fluxo de pareamento — spec Fase 1C, seção 6 (achado A5): device_name é
// escolhido AQUI, pelo admin, no momento de gerar o código — nunca mais
// pelo bridge em si. É o nome que vai identificar o leitor permanentemente
// na lista abaixo, na auditoria e na revogação.
function PairDeviceDialog({ reserveId, reserveName, onCodeGenerated }: {
  reserveId: string;
  reserveName: string;
  // Achado MÉDIO de code review (2026-07-21): renomeado de "onPaired" —
  // dispara quando o CÓDIGO é gerado, não quando o bridge de fato consome
  // e pareia (isso acontece minutos depois, em outra máquina, fora do
  // controle desta tela). O nome antigo dava a entender que a lista de
  // devices seria atualizada automaticamente após o pareamento real, o
  // que não acontece — fora de escopo desta fase (spec seção 6/10).
  onCodeGenerated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [code, setCode] = useState<{ pairing_code: string; expires_at: string } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!code) return;
    function tick() {
      const remaining = Math.max(0, Math.round((new Date(code!.expires_at).getTime() - Date.now()) / 1000));
      setSecondsLeft(remaining);
    }
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [code]);

  function reset() {
    setDeviceName("");
    setCode(null);
    setSecondsLeft(0);
    setCopied(false);
  }

  // Achado CRÍTICO de code review (2026-07-21): "Cancelar"/"Fechar" no
  // rodapé chamam setOpen(false) diretamente — isso NÃO passa por
  // onOpenChange (só Esc/backdrop/ícone "X" passam, confirmado contra o
  // código-fonte do @base-ui/react), então reset() nunca rodava nesses 2
  // botões. Reabrir o dialog depois mostrava o código antigo (de uma
  // reserva possivelmente diferente da que a descrição passou a exibir) em
  // vez do formulário — dado de reserva errada na tela, num sistema de
  // custódia de armamento. Fix: fechar SEMPRE por esta função, que reseta
  // e aborta qualquer POST em voo antes de fechar.
  function closeAndReset() {
    abortRef.current?.abort();
    setOpen(false);
    reset();
  }

  async function generateCode() {
    if (submitting) return;
    const name = deviceName.trim();
    if (!name) return;
    setSubmitting(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await bffFetch("POST", "/api/biometric/pairing-codes", {
        reserve_id: reserveId,
        device_name: name,
      }, undefined, controller.signal);
      if (controller.signal.aborted) return;
      const data = res.data as PairingCodeResponse;
      if (!res.ok || !data.pairing_code || !data.expires_at) {
        throw new ApiError(friendlyApiError(res.status, data.error, "Erro ao gerar o código de pareamento."), res.status);
      }
      // Achado BAIXO de code review (2026-07-22): sem seedar secondsLeft
      // aqui, ele começava do valor antigo (0, de reset()) por 1 frame até
      // o useEffect([code]) rodar — nesse frame, `expired` computava true e
      // a UI piscava "Código expirado" antes de corrigir sozinha.
      setSecondsLeft(Math.max(0, Math.round((new Date(data.expires_at).getTime() - Date.now()) / 1000)));
      setCode({ pairing_code: data.pairing_code, expires_at: data.expires_at });
      onCodeGenerated();
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error("[biometric] pairing code failed", error);
      toast.error(error instanceof ApiError ? error.message : "Falha ao gerar o código de pareamento.");
    } finally {
      // Achado CRÍTICO de code review (2026-07-22): a guarda
      // `if (!controller.signal.aborted)` aqui deixava submitting=true PARA
      // SEMPRE quando o dialog fechava com um POST em voo (Esc/backdrop/X —
      // os únicos caminhos ainda habilitados, já que "Cancelar" ficava
      // disabled durante o submit, outro CRÍTICO corrigido abaixo). O botão
      // "Gerar código" ficava travado em "Gerando…" pelo resto da sessão,
      // mesmo reabrindo o dialog. setSubmitting(false) é seguro mesmo com o
      // dialog já fechado/resetado — não depender do abort ter "funcionado"
      // de verdade (ver também o achado ALTO sobre bffFetch não aceitar
      // AbortSignal).
      setSubmitting(false);
    }
  }

  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.pairing_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Achado MÉDIO de code review (2026-07-22): contexto não-seguro ou
      // permissão negada faz writeText rejeitar — sem isto, o usuário não
      // recebia nenhum sinal de que copiar falhou.
      toast.error("Não foi possível copiar. Copie o código manualmente.");
    }
  }

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const expired = code !== null && secondsLeft <= 0;

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)} data-testid="btn-biometric-pair-new">
        <KeyRound className="size-4" />
        Parear novo leitor
      </Button>

      <Dialog open={open} onOpenChange={(next) => { if (!next) { closeAndReset(); } else { setOpen(next); } }}>
        <DialogContent data-testid="pair-device-dialog">
          <DialogHeader>
            <DialogTitle>Parear novo leitor</DialogTitle>
            <DialogDescription>
              {code
                ? `Digite este código no APMCB Bridge, no computador da reserva "${reserveName}".`
                : `Dê um nome pro leitor — ele vai aparecer assim na lista de leitores de "${reserveName}".`}
            </DialogDescription>
          </DialogHeader>

          {!code ? (
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="pair-device-name">Nome do leitor</Label>
                <Input
                  id="pair-device-name"
                  value={deviceName}
                  onChange={(event) => setDeviceName(event.target.value)}
                  placeholder="Ex: Leitor — Sala de Armas"
                  maxLength={120}
                  autoFocus
                  data-testid="input-pair-device-name"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3 py-2 text-center" aria-live="polite">
              <button
                type="button"
                onClick={copyCode}
                className="w-full rounded-lg border bg-muted/40 px-4 py-3 font-mono text-2xl font-semibold tracking-wider transition-colors hover:bg-muted/70"
                data-testid="pair-device-code"
                title="Clique para copiar"
                aria-label={`Código de pareamento ${code.pairing_code} — clique para copiar`}
              >
                {code.pairing_code}
              </button>
              <p className="text-xs text-muted-foreground">{copied ? "Copiado!" : "Toque no código para copiar"}</p>
              <p className={`text-sm ${expired ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                {expired
                  ? "Código expirado — gere um novo."
                  : `Expira em ${minutes}:${seconds.toString().padStart(2, "0")}`}
              </p>
            </div>
          )}

          <DialogFooter>
            {!code ? (
              <>
                {/* Achado CRÍTICO de code review (2026-07-22): disabled={submitting}
                aqui contradizia o propósito do próprio botão — "Cancelar" existe
                justamente para interromper um request em voo, então não pode
                ficar desabilitado durante ele. Com isso desabilitado, o único
                jeito de fechar durante o submit virava Esc/backdrop/X, que é
                exatamente o caminho que expunha o CRÍTICO do submitting travado
                acima. */}
                <Button type="button" variant="outline" onClick={closeAndReset}>Cancelar</Button>
                <Button type="button" onClick={generateCode} disabled={submitting || !deviceName.trim()} data-testid="btn-pair-generate-code">
                  {submitting ? "Gerando…" : "Gerar código"}
                </Button>
              </>
            ) : expired ? (
              <>
                <Button type="button" variant="outline" onClick={closeAndReset}>Fechar</Button>
                <Button type="button" onClick={reset} data-testid="btn-pair-retry">
                  Gerar novo código
                </Button>
              </>
            ) : (
              <Button type="button" onClick={closeAndReset}>Fechar</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function BiometricConsoleClient({ reserveOptions, simulationUserId, canRevokeDevices }: BiometricConsoleClientProps) {
  const [selectedReserveId, setSelectedReserveId] = useState<string | null>(reserveOptions[0]?.id ?? null);
  const [devices, setDevices] = useState<BiometricDevice[]>([]);
  const [simulatorAvailable, setSimulatorAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState<BiometricResult | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const selectedReserve = reserveOptions.find((reserve) => reserve.id === selectedReserveId) ?? null;
  const reserveId = selectedReserve?.id ?? null;
  const status = useMemo(() => bridgeStatus(devices), [devices]);
  const primaryDevice = devices.find((device) => device.status === "active") ?? devices[0] ?? null;
  const simulatorEnabled = status === "simulator" && simulatorAvailable;
  const canCapture = !!reserveId && (status === "active" || simulatorEnabled);

  async function loadDevices() {
    if (!reserveId) return;
    setLoading(true);
    try {
      const res = await bffFetch("GET", `/api/biometric/devices?reserve_id=${reserveId}`);
      const data = res.data as DevicesResponse;
      if (!res.ok) {
        throw new ApiError(friendlyApiError(res.status, data.error, "Erro ao listar os leitores biométricos."), res.status);
      }
      setDevices(data.devices ?? []);
      setSimulatorAvailable(data.simulator_available === true);
    } catch (error) {
      console.error("[biometric] devices failed", error);
      toast.error(error instanceof ApiError ? error.message : "Falha ao carregar os leitores biométricos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reserveId]);

  async function revokeDevice(device: BiometricDevice) {
    if (revokingId) return;
    const confirmed = window.confirm(
      `Revogar o leitor "${device.device_name}"? Ele para de funcionar imediatamente e não pode ser reativado — só uma nova configuração cria um leitor novo. Use se o computador/leitor foi perdido ou roubado.`
    );
    if (!confirmed) return;

    setRevokingId(device.id);
    try {
      const res = await bffFetch("POST", `/api/biometric/devices/${device.id}/revoke`, { reason: "Revogado via console /reserva/biometria" });
      if (!res.ok) {
        throw new ApiError(friendlyApiError(res.status, res.data.error, "Erro ao revogar o leitor biométrico."), res.status);
      }
      toast.success(`Leitor "${device.device_name}" revogado.`);
      await loadDevices();
    } catch (error) {
      console.error("[biometric] revoke failed", error);
      toast.error(error instanceof ApiError ? error.message : "Falha ao revogar o leitor biométrico.");
    } finally {
      setRevokingId(null);
    }
  }

  if (!reserveId) {
    return (
      <div className="space-y-4" data-testid="biometric-console-no-reserve">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Biometria da Reserva</h1>
          <p className="mt-1 text-sm text-muted-foreground">Nenhuma reserva vinculada ao seu usuário.</p>
        </div>
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950">
          <div className="flex gap-3">
            <AlertTriangle className="size-5 shrink-0" />
            <p className="text-sm">Peça para um administrador vincular seu usuário a uma reserva antes de usar biometria.</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="biometric-console-ready">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Biometria da Reserva</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Identificação presencial de usuários em {selectedReserve?.nome ?? "reserva selecionada"}.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {reserveOptions.length > 1 && (
            <select
              className="h-9 rounded-lg border bg-background px-3 text-sm"
              value={selectedReserveId ?? ""}
              onChange={(event) => {
                setSelectedReserveId(event.target.value);
                setDevices([]);
                setSimulatorAvailable(false);
                setLastResult(null);
              }}
              data-testid="select-biometric-reserve"
            >
              {reserveOptions.map((reserve) => (
                <option key={reserve.id} value={reserve.id}>{reserve.nome}</option>
              ))}
            </select>
          )}
          <Button type="button" variant="outline" onClick={loadDevices} disabled={loading} data-testid="btn-biometric-refresh">
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      <BiometricBridgeStatus
        status={status}
        deviceName={primaryDevice?.device_name}
        lastSeenAt={primaryDevice?.last_seen_at}
      />

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-lg border bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Fingerprint className="size-5 text-primary" />
                <h2 className="text-base font-semibold">Identificar usuário pela digital</h2>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Peça para o usuário colocar o dedo no leitor. O sistema reconhece automaticamente.
              </p>
            </div>
            {simulatorEnabled && <Badge variant="outline">Teste</Badge>}
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <BiometricCaptureDialog
              reserveId={reserveId}
              canCapture={canCapture}
              simulatorEnabled={simulatorEnabled}
              simulationUserId={simulationUserId}
              onResult={setLastResult}
            />
            {!canCapture && (
              <p className="text-sm text-muted-foreground" data-testid="biometric-capture-disabled">
                {status === "simulator" && !simulatorAvailable
                  ? "Modo de teste ativado, mas indisponível neste ambiente."
                  : "Configure ou reative um leitor antes de iniciar."}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-lg border bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }} data-testid="biometric-last-result">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" />
            <h2 className="text-base font-semibold">Última identificação</h2>
          </div>
          {lastResult?.matched_user ? (
            <div className="mt-4 space-y-2">
              <p className="text-sm font-semibold">{lastResult.matched_user.nome_completo}</p>
              <p className="text-xs text-muted-foreground">
                {lastResult.matched_user.posto ?? "Usuário"} · Mat. {lastResult.matched_user.matricula}
              </p>
              <Badge variant="outline">Confirmação {lastResult.proof?.id.slice(0, 8)}</Badge>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">Nenhuma identificação nesta tela ainda.</p>
          )}
        </div>
      </section>

      <section className="rounded-lg border bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Usb className="size-5 text-primary" />
            <h2 className="text-base font-semibold">Leitores da reserva</h2>
          </div>
          {canRevokeDevices && (
            <PairDeviceDialog
              reserveId={reserveId}
              reserveName={selectedReserve?.nome ?? "reserva selecionada"}
              onCodeGenerated={loadDevices}
            />
          )}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {devices.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="biometric-devices-empty">
              Nenhum leitor biométrico configurado.
            </p>
          ) : devices.map((device) => (
            <article key={device.id} className="rounded-lg border bg-background p-3" data-testid="biometric-device-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{device.device_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {device.sdk_vendor?.toUpperCase() ?? "Leitor"} · {device.bridge_version ?? "sem versão"}
                  </p>
                </div>
                <Badge variant="outline">{device.is_simulator ? "Teste" : deviceStatusLabel(device.status)}</Badge>
              </div>
              {canRevokeDevices && !device.is_simulator && device.status === "active" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full text-destructive hover:text-destructive"
                  onClick={() => revokeDevice(device)}
                  disabled={revokingId === device.id}
                  data-testid={`btn-biometric-revoke-${device.id}`}
                >
                  <ShieldOff className="size-3.5" />
                  {revokingId === device.id ? "Revogando…" : "Revogar leitor"}
                </Button>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
