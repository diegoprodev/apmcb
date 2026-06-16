"use client";

import React, { useState, useEffect } from "react";
import { Shield, Plus, Minus, ChevronRight, CheckCircle2, AlertCircle, Loader2, WifiOff, Lock } from "lucide-react";
import {
  Sheet, SheetTrigger, SheetContent, SheetHeader,
  SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TOTPDisplay } from "@/components/ui/totp-display";
import { csrfHeaders } from "@/lib/csrf";
import { createClient } from "@/lib/supabase/client";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

type Step = "materials" | "totp" | "success";

interface Material {
  id: string;
  nome: string;
  categoria: string;
  disponivel: boolean;
}

interface SelectedItem {
  material_type_id: string;
  nome: string;
  categoria: string;
  quantity: number;
}

interface Props {
  children: React.ReactNode;
}

const CATEGORIA_LABEL: Record<string, string> = {
  arma: "Arma",
  farda: "Farda",
  acessorio: "Acessório",
  equipamento: "Equipamento",
};

export function SolicitarArmamentoSheet({ children }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("materials");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loadingMaterials, setLoadingMaterials] = useState(false);
  const [selected, setSelected] = useState<Map<string, SelectedItem>>(new Map());
  const [totpToken, setTotpToken] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bffDown, setBffDown] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);

  async function getBearerHeader(): Promise<HeadersInit> {
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      return session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};
    } catch {
      return {};
    }
  }

  async function loadMaterials() {
    setLoadingMaterials(true);
    setError(null);
    setBffDown(false);
    try {
      const authHeader = await getBearerHeader();
      const res = await fetch(`${BFF_URL}/api/ssa/available-materials`, {
        credentials: "include",
        headers: authHeader,
      });
      if (!res.ok) throw new Error("Falha ao carregar materiais.");
      const data: Material[] = await res.json();
      setMaterials(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erro ao carregar materiais.";
      if (msg.toLowerCase().includes("fetch") || msg.toLowerCase().includes("network") || msg.toLowerCase().includes("failed")) {
        setBffDown(true);
      } else {
        setError(msg);
      }
    } finally {
      setLoadingMaterials(false);
    }
  }

  useEffect(() => {
    if (open && step === "materials") {
      loadMaterials();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function reset() {
    setStep("materials");
    setSelected(new Map());
    setTotpToken("");
    setNotes("");
    setError(null);
    setBffDown(false);
    setRequestId(null);
    setSubmitting(false);
    setMaterials([]);
  }

  function handleOpenChange(val: boolean) {
    setOpen(val);
    if (!val) setTimeout(reset, 300);
  }

  function toggleMaterial(mat: Material) {
    if (!mat.disponivel) return;
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(mat.id)) {
        next.delete(mat.id);
      } else {
        next.set(mat.id, {
          material_type_id: mat.id,
          nome: mat.nome,
          categoria: mat.categoria,
          quantity: 1,
        });
      }
      return next;
    });
  }

  function adjustQuantity(id: string, delta: number) {
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

  async function handleSubmit() {
    setError(null);
    if (!totpToken || totpToken.length !== 6) {
      setError("Digite o código de 6 dígitos exibido acima.");
      return;
    }

    setSubmitting(true);
    try {
      const authHeader = await getBearerHeader();
      const res = await fetch(`${BFF_URL}/api/ssa/requests`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders(), ...authHeader },
        body: JSON.stringify({
          items: Array.from(selected.values()).map((i) => ({
            material_type_id: i.material_type_id,
            quantity: i.quantity,
          })),
          totp_token: totpToken,
          notes: notes.trim() || undefined,
        }),
      });

      const body = await res.json() as { error?: string; request_id?: string };

      if (!res.ok) {
        setError(body.error ?? "Falha ao enviar solicitação.");
        return;
      }

      setRequestId(body.request_id ?? null);
      setStep("success");
    } catch {
      setError("Sem conexão com o servidor.");
    } finally {
      setSubmitting(false);
    }
  }

  const grouped = materials.reduce<Record<string, Material[]>>((acc, m) => {
    acc[m.categoria] = acc[m.categoria] ?? [];
    acc[m.categoria].push(m);
    return acc;
  }, {});

  const disponiveisCount = materials.filter((m) => m.disponivel).length;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>{children as React.ReactElement}</SheetTrigger>

      <SheetContent
        side="right"
        className="w-full sm:max-w-md flex flex-col bg-background text-foreground border-l border-border"
      >
        <SheetHeader className="pb-2 shrink-0">
          <div className="flex items-center gap-2">
            <Shield className="size-5 text-primary" />
            <SheetTitle className="text-foreground">
              {step === "materials" && "Requisitar Armamento"}
              {step === "totp" && "Confirmar Identidade"}
              {step === "success" && "Solicitação Enviada"}
            </SheetTitle>
          </div>
          {step === "materials" && (
            <SheetDescription className="text-muted-foreground">
              Selecione os materiais e informe a quantidade desejada.
            </SheetDescription>
          )}
          {step === "totp" && (
            <SheetDescription className="text-muted-foreground">
              Use o código abaixo para validar sua identidade.
            </SheetDescription>
          )}
        </SheetHeader>

        {/* ── Step: Materials ── */}
        {step === "materials" && (
          <div className="flex-1 overflow-y-auto space-y-4 py-2" data-testid="ssa-step-materials">

            {/* Loading */}
            {loadingMaterials && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* BFF unreachable */}
            {!loadingMaterials && bffDown && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-4 flex gap-3">
                <WifiOff className="size-5 text-destructive shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-destructive">Servidor indisponível</p>
                  <p className="text-xs text-muted-foreground">
                    Não foi possível conectar ao servidor BFF. Verifique se o DNS{" "}
                    <span className="font-mono">api.apmcb.pmpb.online</span> está configurado e tente novamente.
                  </p>
                  <button
                    className="text-xs text-primary underline cursor-pointer"
                    onClick={loadMaterials}
                  >
                    Tentar novamente
                  </button>
                </div>
              </div>
            )}

            {/* Generic error */}
            {!loadingMaterials && error && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive flex gap-2">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            {/* Materials list */}
            {!loadingMaterials && !bffDown && materials.length > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {disponiveisCount} de {materials.length} itens disponíveis
                  </p>
                </div>

                {Object.entries(grouped).map(([cat, items]) => (
                  <div key={cat} className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-0.5">
                      {CATEGORIA_LABEL[cat] ?? cat}
                    </p>
                    {items.map((mat) => {
                      const sel = selected.get(mat.id);
                      const unavailable = !mat.disponivel;
                      return (
                        <div
                          key={mat.id}
                          data-testid="material-card"
                          role="button"
                          tabIndex={unavailable ? -1 : 0}
                          onClick={() => toggleMaterial(mat)}
                          onKeyDown={(e) => e.key === "Enter" && toggleMaterial(mat)}
                          className={[
                            "rounded-xl p-3 flex items-center gap-3 border transition-colors",
                            unavailable
                              ? "border-border bg-muted/40 opacity-60 cursor-not-allowed"
                              : sel
                              ? "border-primary bg-primary/5 cursor-pointer"
                              : "border-border bg-card cursor-pointer hover:border-primary/50 hover:bg-primary/5",
                          ].join(" ")}
                        >
                          {/* Selector circle or lock */}
                          {unavailable ? (
                            <Lock className="size-4 text-muted-foreground shrink-0" />
                          ) : (
                            <div
                              className={[
                                "size-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                                sel ? "border-primary bg-primary" : "border-muted-foreground/40",
                              ].join(" ")}
                            >
                              {sel && <CheckCircle2 className="size-3 text-white" />}
                            </div>
                          )}

                          {/* Name + status */}
                          <div className="flex-1 min-w-0">
                            <p className={[
                              "text-sm font-medium truncate",
                              unavailable ? "text-muted-foreground" : "text-foreground",
                            ].join(" ")}>
                              {mat.nome}
                            </p>
                            {unavailable && (
                              <p className="text-[10px] text-muted-foreground">Indisponível</p>
                            )}
                          </div>

                          {/* Status badge */}
                          {!unavailable && !sel && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 shrink-0">
                              Disponível
                            </span>
                          )}

                          {/* Quantity stepper (only when selected) */}
                          {sel && (
                            <div
                              className="flex items-center gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => adjustQuantity(mat.id, -1)}
                                className="size-7 rounded-lg bg-muted hover:bg-primary/10 hover:text-primary flex items-center justify-center cursor-pointer transition-colors"
                              >
                                <Minus className="size-3" />
                              </button>
                              <span className="w-6 text-center text-sm font-bold">
                                {sel.quantity}
                              </span>
                              <button
                                type="button"
                                onClick={() => adjustQuantity(mat.id, 1)}
                                className="size-7 rounded-lg bg-muted hover:bg-primary/10 hover:text-primary flex items-center justify-center cursor-pointer transition-colors"
                              >
                                <Plus className="size-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}

                <p className="text-[11px] text-muted-foreground text-center pb-4">
                  Quantidades em estoque não são exibidas por segurança operacional.
                </p>
              </>
            )}

            {!loadingMaterials && !bffDown && !error && materials.length === 0 && (
              <div className="text-center py-12 text-muted-foreground text-sm">
                Nenhum material cadastrado no arsenal.
              </div>
            )}
          </div>
        )}

        {/* ── Step: TOTP ── */}
        {step === "totp" && (
          <div className="flex-1 overflow-y-auto space-y-4 py-2">
            <TOTPDisplay />

            <div className="rounded-xl bg-card border border-border p-3 space-y-1.5">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Materiais solicitados
              </p>
              {Array.from(selected.values()).map((item) => (
                <div key={item.material_type_id} className="flex justify-between text-sm">
                  <span className="text-foreground">{item.nome}</span>
                  <span className="font-medium text-muted-foreground">× {item.quantity}</span>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="totp-input" className="text-foreground">Digite o código acima</Label>
              <Input
                id="totp-input"
                data-testid="totp-input"
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000 000"
                value={totpToken}
                onChange={(e) => setTotpToken(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="text-center text-xl tracking-widest font-mono bg-background"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes" className="text-foreground">Observação (opcional)</Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={300}
                placeholder="Ex: Saída para instrução de campanha"
                className="bg-background"
              />
            </div>

            {error && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive flex gap-2">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                {error}
              </div>
            )}
          </div>
        )}

        {/* ── Step: Success ── */}
        {step === "success" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center py-8">
            <div className="size-16 rounded-full bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center">
              <CheckCircle2 className="size-8 text-emerald-600" />
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold text-lg text-foreground">Solicitação Enviada!</h3>
              <p className="text-sm text-muted-foreground">
                a Reserva de Armamento foi notificado e irá responder em breve.
              </p>
            </div>
            {requestId && (
              <p className="text-[11px] text-muted-foreground font-mono bg-muted rounded-lg px-3 py-1.5">
                #{requestId.slice(0, 8).toUpperCase()}
              </p>
            )}
            <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-200 text-left">
              <strong>Atenção:</strong> Após a aprovação, você terá{" "}
              <strong>6 horas</strong> para retirar o material. Fique atento à notificação.
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <SheetFooter className="pt-2 shrink-0">
          {step === "materials" && (
            <Button
              className="w-full cursor-pointer"
              data-testid="btn-step-next"
              disabled={selected.size === 0 || bffDown}
              onClick={() => setStep("totp")}
            >
              Avançar — {selected.size} item{selected.size !== 1 ? "s" : ""} selecionado{selected.size !== 1 ? "s" : ""}
              <ChevronRight className="size-4 ml-1" />
            </Button>
          )}
          {step === "totp" && (
            <div className="w-full space-y-2">
              <Button
                className="w-full cursor-pointer"
                data-testid="btn-submit-request"
                disabled={submitting || totpToken.length < 6}
                onClick={handleSubmit}
              >
                {submitting ? (
                  <><Loader2 className="size-4 mr-2 animate-spin" />Enviando...</>
                ) : (
                  "Enviar Solicitação"
                )}
              </Button>
              <Button
                variant="ghost"
                className="w-full cursor-pointer"
                onClick={() => { setStep("materials"); setError(null); }}
              >
                Voltar
              </Button>
            </div>
          )}
          {step === "success" && (
            <Button
              variant="outline"
              className="w-full cursor-pointer"
              onClick={() => handleOpenChange(false)}
            >
              Fechar
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
