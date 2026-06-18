"use client";

import { useState } from "react";
import { Shield, CheckCircle2, Loader2, AlertCircle, User, Plus, Minus, MapPin } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { csrfHeaders } from "@/lib/csrf";
import { createClient } from "@/lib/supabase/client";
import { LOCAIS_ARMAMENTO } from "@/lib/locais-armamento";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

interface Material {
  id: string;
  nome: string;
  categoria: string;
}

interface MilitaryInfo {
  military_nome: string;
  military_posto: string;
  military_matricula: string;
}

interface SelectedItem {
  material_type_id: string;
  nome: string;
  quantity: number;
}

type Phase = "identify" | "confirm" | "select-material" | "success";

export function VerifyTOTPDialog() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("identify");
  const [matricula, setMatricula] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [military, setMilitary] = useState<MilitaryInfo | null>(null);
  const [militaryId, setMilitaryId] = useState<string | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [selected, setSelected] = useState<Map<string, SelectedItem>>(new Map());
  const [local, setLocal] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setPhase("identify");
    setMatricula("");
    setTotpCode("");
    setLoading(false);
    setError(null);
    setMilitary(null);
    setMilitaryId(null);
    setMaterials([]);
    setSelected(new Map());
    setLocal("");
    setSubmitting(false);
  }

  async function handleVerify() {
    if (!matricula || totpCode.length < 6) {
      setError("Preencha a matrícula e o código de 6 dígitos.");
      return;
    }
    setLoading(true);
    setError(null);

    try {
      // Get Supabase Bearer token so BFF accepts the request in all environments
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const authHeader: Record<string, string> = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};

      // 1. Lookup military_id + profile by matricula (Reserva de Armamento-only endpoint)
      const profileRes = await fetch(
        `${BFF_URL}/api/ssa/lookup-military?matricula=${encodeURIComponent(matricula)}`,
        { credentials: "include", headers: { ...authHeader } }
      );
      if (profileRes.status === 404) {
        setError("Matrícula não encontrada.");
        return;
      }
      if (!profileRes.ok) {
        setError("Erro ao buscar militar. Tente novamente.");
        return;
      }
      const profileData = await profileRes.json();
      const mid = profileData.id as string;

      // 2. Validate TOTP (also Reserva de Armamento-only)
      const valRes = await fetch(`${BFF_URL}/api/totp/validate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeader, ...csrfHeaders() },
        body: JSON.stringify({ military_id: mid, token: totpCode }),
      });
      const valBody = await valRes.json();

      if (valRes.status === 429) {
        setError(`Militar bloqueado por tentativas excessivas. Aguarde ${valBody.retry_after_seconds ?? 60}s.`);
        return;
      }
      if (valRes.status === 404) {
        setError("Este militar não possui código TOTP configurado. Peça ao militar para acessar o app e configurar o código de acesso em Perfil → Código de Acesso.");
        return;
      }
      if (!valRes.ok || !valBody.valid) {
        setError(valBody.error ?? "Código inválido. Solicite ao militar que gere um novo código.");
        return;
      }

      setMilitaryId(mid);
      setMilitary({
        military_nome: profileData.nome_completo,
        military_posto: profileData.posto,
        military_matricula: profileData.matricula,
      });

      // 3. Load available materials
      const matRes = await fetch(`${BFF_URL}/api/ssa/available-materials`, {
        credentials: "include",
        headers: { ...authHeader },
      });
      const matData: Material[] = matRes.ok ? await matRes.json() : [];
      setMaterials(matData.filter((m) => (m as Material & { disponivel?: boolean }).disponivel !== false));

      setPhase("confirm");
    } catch {
      setError("Sem conexão com o servidor.");
    } finally {
      setLoading(false);
    }
  }

  function toggleMaterial(mat: Material) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(mat.id)) {
        next.delete(mat.id);
      } else {
        next.set(mat.id, { material_type_id: mat.id, nome: mat.nome, quantity: 1 });
      }
      return next;
    });
  }

  function adjustQty(id: string, delta: number) {
    setSelected((prev) => {
      const next = new Map(prev);
      const item = next.get(id);
      if (!item) return prev;
      const newQty = item.quantity + delta;
      if (newQty < 1) return prev;
      next.set(id, { ...item, quantity: newQty });
      return next;
    });
  }

  async function handleDirectIssue() {
    if (!militaryId || selected.size === 0) return;
    setSubmitting(true);
    setError(null);

    try {
      // Single atomic Modo A endpoint: validate TOTP + create + deliver in one call
      const res = await fetch(`${BFF_URL}/api/ssa/modo-a`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({
          military_id: militaryId,
          totp_token: totpCode,
          local: local || undefined,
          items: Array.from(selected.values()).map((i) => ({
            material_type_id: i.material_type_id,
            quantity: i.quantity,
          })),
        }),
      });

      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Erro ao registrar saída.");
        return;
      }

      setPhase("success");
      toast.success("Saída registrada com sucesso!");
    } catch {
      setError("Sem conexão com o servidor.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setTimeout(reset, 300);
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            data-testid="btn-verificar-codigo"
            className="gap-1.5"
          />
        }
      >
        <Shield className="size-4" />
        Verificar Código
      </DialogTrigger>

      <DialogContent
        data-testid="dialog-verificar-totp"
        showCloseButton={false}
        className="max-w-sm p-6 space-y-4"
      >
        {/* ── Phase: identify ── */}
        {phase === "identify" && (
          <>
            <div>
              <DialogTitle>Verificar Código de Acesso</DialogTitle>
              <DialogDescription className="mt-1">
                Informe a matrícula e o código gerado pelo militar.
              </DialogDescription>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="matricula-input">Matrícula</Label>
                <Input
                  id="matricula-input"
                  data-testid="input-matricula"
                  placeholder="000000"
                  value={matricula}
                  onChange={(e) => setMatricula(e.target.value.replace(/\D/g, ""))}
                  maxLength={10}
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="totp-verify-input">Código TOTP (6 dígitos)</Label>
                <Input
                  id="totp-verify-input"
                  data-testid="input-totp-code"
                  placeholder="000 000"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  maxLength={6}
                  inputMode="numeric"
                  className="text-center text-xl tracking-widest font-mono"
                />
              </div>
            </div>

            {error && (
              <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive flex gap-2">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            <div className="flex gap-2">
              <DialogClose render={<Button variant="outline" className="flex-1" />}>
                Cancelar
              </DialogClose>
              <Button
                className="flex-1"
                data-testid="btn-verificar-submit"
                disabled={loading || matricula.length < 3 || totpCode.length < 6}
                onClick={handleVerify}
              >
                {loading ? <Loader2 className="size-4 animate-spin" /> : "Verificar"}
              </Button>
            </div>
          </>
        )}

        {/* ── Phase: confirm ── */}
        {phase === "confirm" && military && (
          <>
            <div className="text-center space-y-4 py-2">
              <div className="size-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto text-2xl font-bold text-emerald-700">
                {military.military_nome.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
              </div>
              <div>
                <DialogTitle className="text-lg">{military.military_nome}</DialogTitle>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {military.military_posto && `${military.military_posto} · `}Mat. {military.military_matricula}
                </p>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                <CheckCircle2 className="size-3.5" />
                Identidade verificada
              </div>
            </div>

            <Button
              className="w-full h-11 text-base"
              data-testid="btn-saida-direta"
              onClick={() => setPhase("select-material")}
            >
              Armar {military.military_nome.split(" ")[0]}
            </Button>
            <button
              type="button"
              className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={reset}
            >
              Cancelar
            </button>
          </>
        )}

        {/* ── Phase: select-material ── */}
        {phase === "select-material" && military && (
          <>
            <div>
              <DialogTitle>Selecionar Material</DialogTitle>
              <DialogDescription className="mt-1">
                Identidade validada. Selecione o material para saída direta.
              </DialogDescription>
            </div>

            {/* Verified military */}
            <div
              data-testid="militar-verified-name"
              className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 flex items-center gap-3"
            >
              <div className="size-9 rounded-full bg-emerald-100 flex items-center justify-center">
                <User className="size-4 text-emerald-700" />
              </div>
              <div>
                <p className="text-sm font-semibold text-emerald-900">
                  {military.military_posto} {military.military_nome}
                </p>
                <p className="text-xs text-emerald-700">Mat. {military.military_matricula} · TOTP ✓</p>
              </div>
            </div>

            {/* Local de saída */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <MapPin className="size-3" />
                Local de saída (opcional)
              </label>
              <select
                value={local}
                onChange={(e) => setLocal(e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
              >
                <option value="">Selecionar local...</option>
                {LOCAIS_ARMAMENTO.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>

            {/* Material list */}
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {materials.map((mat) => {
                const sel = selected.get(mat.id);
                return (
                  <div
                    key={mat.id}
                    className={`rounded-xl p-2.5 flex items-center gap-2.5 cursor-pointer border text-sm transition-colors ${
                      sel ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                    }`}
                    onClick={() => toggleMaterial(mat)}
                  >
                    <div
                      className={`size-4 rounded-full border-2 shrink-0 ${
                        sel ? "border-primary bg-primary" : "border-muted-foreground/40"
                      }`}
                    />
                    <span className="flex-1 font-medium">{mat.nome}</span>
                    {sel && (
                      <div
                        className="flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button variant="ghost" size="icon-sm" className="size-6"
                          onClick={() => adjustQty(mat.id, -1)}><Minus className="size-3" /></Button>
                        <span className="w-4 text-center font-mono text-xs">{sel.quantity}</span>
                        <Button variant="ghost" size="icon-sm" className="size-6"
                          onClick={() => adjustQty(mat.id, 1)}><Plus className="size-3" /></Button>
                      </div>
                    )}
                  </div>
                );
              })}
              {materials.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhum material disponível.
                </p>
              )}
            </div>

            {error && (
              <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive flex gap-2">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            <Button
              className="w-full"
              data-testid="btn-saida-direta"
              disabled={submitting || selected.size === 0}
              onClick={handleDirectIssue}
            >
              {submitting ? (
                <><Loader2 className="size-4 mr-2 animate-spin" /> Registrando…</>
              ) : (
                "Registrar Saída Direta"
              )}
            </Button>
          </>
        )}

        {/* ── Phase: success ── */}
        {phase === "success" && (
          <>
            <div className="text-center space-y-3 py-4">
              <div className="size-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
                <CheckCircle2 className="size-7 text-emerald-600" />
              </div>
              <div>
                <DialogTitle>Saída Registrada!</DialogTitle>
                <DialogDescription className="mt-1">
                  Lending criado. Material entregue a{" "}
                  <strong>{military?.military_posto} {military?.military_nome}</strong>.
                </DialogDescription>
              </div>
            </div>
            <DialogClose render={<Button className="w-full" />}>
              Concluir
            </DialogClose>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
