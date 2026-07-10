"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import {
  X, Fingerprint, KeyRound, Shield, ShieldCheck,
  Loader2, AlertCircle, Clock, CheckCircle2, RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { csrfHeaders } from "@/lib/csrf";
import { friendlyApiError } from "@/lib/api-error";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";
const IDENTITY_TTL_MS = 120_000;

type AuthMode = "totp" | "biometria" | "manual";

type LendingPreview = {
  id: string;
  quantidade: number;
  issued_at: string;
  movement_id: string | null;
  material_type: { nome: string; categoria: string } | null;
};

type IdentifiedProfile = {
  id: string;
  nome_completo: string;
  matricula: string;
  posto: string | null;
  foto_url: string | null;
};

async function getAuthHeaders(): Promise<HeadersInit> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return {
    "Content-Type": "application/json",
    ...(csrfHeaders() as Record<string, string>),
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
  preselectedIds?: string[];
  onSuccess: () => void;
  role: string;
  militaryMatricula?: string;
}

export function DesarmamentoModal({ open, onClose, preselectedIds = [], onSuccess, role, militaryMatricula }: Props) {
  const [phase, setPhase] = useState<"identify" | "confirm">("identify");
  const [authMode, setAuthMode] = useState<AuthMode>("totp");
  const [matricula, setMatricula] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<IdentifiedProfile | null>(null);
  const [activeLendings, setActiveLendings] = useState<LendingPreview[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [identifiedAt, setIdentifiedAt] = useState<number>(0);
  const [ttlRemaining, setTtlRemaining] = useState(IDENTITY_TTL_MS);
  const [submitting, setSubmitting] = useState(false);
  const [observacoes, setObservacoes] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [manualMilitarSearch, setManualMilitarSearch] = useState("");

  const canManual = role === "admin_global";

  // Reset when opened
  useEffect(() => {
    if (open) {
      setPhase("identify");
      setAuthMode("totp");
      setMatricula(militaryMatricula ?? "");
      setTotpCode("");
      setError("");
      setProfile(null);
      setActiveLendings([]);
      setSelectedIds(new Set());
      setObservacoes("");
    }
  }, [open, militaryMatricula]);

  // TTL countdown
  useEffect(() => {
    if (phase !== "confirm" || !identifiedAt) return;
    intervalRef.current = setInterval(() => {
      const remaining = IDENTITY_TTL_MS - (Date.now() - identifiedAt);
      setTtlRemaining(Math.max(0, remaining));
      if (remaining <= 0) {
        clearInterval(intervalRef.current!);
        setError("Sessão de identificação expirada. Identifique o usuário novamente.");
      }
    }, 500);
    return () => clearInterval(intervalRef.current!);
  }, [phase, identifiedAt]);

  const applyPreselected = useCallback((lendings: LendingPreview[], ids: string[]) => {
    if (ids.length > 0) {
      const activePreselected = lendings.filter((l) => ids.includes(l.id)).map((l) => l.id);
      setSelectedIds(new Set(activePreselected));
    } else {
      setSelectedIds(new Set(lendings.map((l) => l.id)));
    }
  }, []);

  function handleSuccess(lendingsResult: LendingPreview[], profResult: IdentifiedProfile) {
    setProfile(profResult);
    setActiveLendings(lendingsResult);
    applyPreselected(lendingsResult, preselectedIds);
    setIdentifiedAt(Date.now());
    setTtlRemaining(IDENTITY_TTL_MS);
    setPhase("confirm");
  }

  async function handleIdentify() {
    setLoading(true);
    setError("");
    try {
      const headers = await getAuthHeaders();
      let body: Record<string, string>;

      if (authMode === "totp") {
        if (!matricula) { setError("Informe a matrícula."); return; }
        if (totpCode.length !== 6) { setError("O código deve ter 6 dígitos."); return; }
        body = { mode: "totp", matricula, code: totpCode };
      } else if (authMode === "biometria") {
        body = { mode: "biometria" };
      } else {
        if (!manualMilitarSearch) { setError("Informe o ID do militar."); return; }
        body = { mode: "manual", military_id: manualMilitarSearch };
      }

      const res = await fetch(`${BFF_URL}/api/lendings/identify`, {
        method: "POST", credentials: "include",
        headers, body: JSON.stringify(body),
      });
      const data = await res.json() as {
        profile?: IdentifiedProfile;
        active_lendings?: LendingPreview[];
        error?: string;
        retry_after_seconds?: number;
      };

      if (!res.ok) {
        let msg = data.error ?? "Erro ao identificar.";
        if (data.retry_after_seconds) msg += ` Aguarde ${Math.ceil(data.retry_after_seconds / 60)} min.`;
        setError(msg);
        return;
      }

      handleSuccess(data.active_lendings ?? [], data.profile!);
    } catch {
      setError("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (selectedIds.size === 0) { toast.error("Selecione ao menos um item para devolver."); return; }
    if (ttlRemaining <= 0) { setError("Sessão expirada. Identifique novamente."); setPhase("identify"); return; }
    setSubmitting(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${BFF_URL}/api/lendings/bulk-return`, {
        method: "POST", credentials: "include",
        headers, body: JSON.stringify({
          lending_ids: Array.from(selectedIds),
          ...(observacoes.trim() ? { notes: observacoes.trim() } : {}),
        }),
      });
      const data = await res.json() as { returned?: number; skipped?: number; error?: string };
      if (!res.ok) {
        console.error("[desarmamento] falha ao registrar devolução em lote", { status: res.status, error: data.error });
        toast.error(friendlyApiError(res.status, data.error, "Erro ao registrar devolução."));
        return;
      }
      const kept = activeLendings.length - (data.returned ?? 0);
      toast.success(
        data.returned === 1
          ? "1 item devolvido com sucesso"
          : `${data.returned} itens devolvidos${kept > 0 ? ` · ${kept} permanece ativo` : ""}`
      );
      onSuccess();
    } catch (err) {
      console.error("[desarmamento] erro de conexão ao registrar devolução", err);
      toast.error("Erro de conexão. Tente novamente.");
    } finally {
      setSubmitting(false);
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

  const ttlSeconds = Math.ceil(ttlRemaining / 1000);
  const ttlMin = Math.floor(ttlSeconds / 60);
  const ttlSec = ttlSeconds % 60;
  const ttlExpired = ttlRemaining <= 0;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-10 w-full sm:max-w-md bg-card rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90dvh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <RotateCcw className="size-4 text-primary" />
            <h3 className="font-semibold text-sm">Receber Material</h3>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-5" />
          </button>
        </div>

        {phase === "identify" ? (
          <div className="p-5 space-y-4 overflow-y-auto">
            {/* Mode tabs */}
            <div className="flex rounded-xl border border-border overflow-hidden">
              {([
                { value: "totp" as AuthMode, label: "Código TOTP", icon: KeyRound },
                { value: "biometria" as AuthMode, label: "Biometria", icon: Fingerprint },
                ...(canManual ? [{ value: "manual" as AuthMode, label: "Manual", icon: Shield }] : []),
              ]).map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => { setAuthMode(value); setError(""); }}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors",
                    authMode === value
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground hover:bg-muted/60"
                  )}
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              ))}
            </div>

            {/* TOTP form */}
            {authMode === "totp" && (
              <div className="space-y-3">
                {militaryMatricula ? (
                  <div className="flex items-center gap-2 rounded-xl bg-primary/5 border border-primary/20 px-3 py-2.5">
                    <Shield className="size-3.5 text-primary shrink-0" />
                    <span className="text-xs text-muted-foreground">
                      Identificando Mat. <strong className="text-foreground">{militaryMatricula}</strong>
                    </span>
                  </div>
                ) : (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Matrícula do Usuário</label>
                    <input
                      type="text"
                      value={matricula}
                      onChange={(e) => setMatricula(e.target.value)}
                      placeholder="Ex: 1234567"
                      className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                      autoComplete="off"
                    />
                  </div>
                )}
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Código do App (6 dígitos)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    value={totpCode}
                    onChange={(e) => { setTotpCode(e.target.value.replace(/\D/g, "")); setError(""); }}
                    placeholder="000000"
                    className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-center text-2xl font-mono tracking-widest outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                  />
                </div>
              </div>
            )}

            {/* Biometria */}
            {authMode === "biometria" && (
              <div className="text-center space-y-3 py-2">
                <div className="size-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <Fingerprint className="size-8 text-primary" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Peça ao usuário para apoiar o dedo no leitor e clique em Capturar.
                </p>
              </div>
            )}

            {/* Manual */}
            {authMode === "manual" && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">ID do Usuário (UUID)</label>
                <input
                  type="text"
                  value={manualMilitarSearch}
                  onChange={(e) => setManualMilitarSearch(e.target.value)}
                  placeholder="Cole o ID do perfil..."
                  className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                />
                <p className="text-xs text-muted-foreground">
                  Modo manual — disponível apenas para admin global.
                </p>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-xl px-3 py-2">
                <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            <Button className="w-full" onClick={handleIdentify} disabled={loading}>
              {loading && <Loader2 className="size-4 animate-spin mr-2" />}
              {loading ? "Identificando..." : authMode === "biometria" ? "Capturar Digital" : "Identificar →"}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col overflow-hidden">
            {/* Military card */}
            <div className="px-5 py-3 border-b shrink-0">
              <div className="flex items-center gap-3">
                {profile?.foto_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={profile.foto_url} alt={profile.nome_completo} className="size-12 rounded-full object-cover" />
                ) : (
                  <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-sm font-bold text-primary">{profile?.nome_completo?.slice(0, 2).toUpperCase()}</span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck className="size-4 text-emerald-600 shrink-0" />
                    <p className="text-sm font-semibold truncate">
                      {profile?.posto ? `${profile.posto} ` : ""}
                      {profile?.nome_completo}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Mat. {profile?.matricula} · Verificado via {authMode === "totp" ? "TOTP" : authMode === "biometria" ? "Biometria" : "Manual"}
                  </p>
                </div>
                {!ttlExpired && (
                  <div className={cn(
                    "flex items-center gap-1 text-xs font-mono shrink-0",
                    ttlSeconds <= 30 ? "text-destructive" : "text-muted-foreground"
                  )}>
                    <Clock className="size-3" />
                    {ttlMin}:{String(ttlSec).padStart(2, "0")}
                  </div>
                )}
              </div>
            </div>

            {/* Items list */}
            <div className="overflow-y-auto flex-1 divide-y divide-border">
              {activeLendings.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                  Nenhum material ativo encontrado para este usuário.
                </div>
              ) : (
                activeLendings.map((lending) => {
                  const checked = selectedIds.has(lending.id);
                  return (
                    <label key={lending.id} className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-muted/40 transition-colors">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleItem(lending.id)}
                        className="size-4 rounded border-border accent-primary cursor-pointer"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{lending.material_type?.nome ?? "—"}</p>
                        <p className="text-xs text-muted-foreground capitalize">{lending.material_type?.categoria ?? "—"} · ×{lending.quantidade}</p>
                      </div>
                      {checked ? (
                        <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                      ) : (
                        <div className="size-4 shrink-0" />
                      )}
                    </label>
                  );
                })
              )}
            </div>

            {/* Observações */}
            <div className="px-5 pt-3 pb-2 border-t shrink-0">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Observações (opcional)
              </label>
              <textarea
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                placeholder="Ex: Equipamento devolvido com desgaste na mira..."
                rows={2}
                maxLength={500}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm resize-none outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                data-testid="textarea-observacoes"
              />
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t shrink-0 space-y-3">
              {ttlExpired && (
                <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-xl px-3 py-2">
                  <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
                  Sessão expirada. Identifique o usuário novamente.
                </div>
              )}

              {error && !ttlExpired && (
                <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-xl px-3 py-2">
                  <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              {activeLendings.length > 0 && (
                <p className="text-xs text-center text-muted-foreground">
                  Devolvendo {selectedIds.size} de {activeLendings.length}{" "}
                  {activeLendings.length - selectedIds.size > 0
                    ? `· ${activeLendings.length - selectedIds.size} permanece ativo`
                    : ""}
                </p>
              )}

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setPhase("identify")} disabled={submitting}>
                  Voltar
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleConfirm}
                  disabled={submitting || ttlExpired || selectedIds.size === 0 || activeLendings.length === 0}
                >
                  {submitting && <Loader2 className="size-4 animate-spin mr-2" />}
                  {submitting ? "Registrando..." : `Confirmar Recebimento${selectedIds.size > 0 ? ` · ${selectedIds.size}` : ""}`}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
