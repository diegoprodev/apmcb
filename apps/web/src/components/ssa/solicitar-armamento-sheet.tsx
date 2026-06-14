"use client";

import React, { useState, useEffect } from "react";
import { Shield, Plus, Minus, ChevronRight, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet, SheetTrigger, SheetContent, SheetHeader,
  SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TOTPDisplay } from "@/components/ui/totp-display";

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
  const [requestId, setRequestId] = useState<string | null>(null);

  async function loadMaterials() {
    setLoadingMaterials(true);
    setError(null);
    try {
      const res = await fetch(`${BFF_URL}/api/ssa/available-materials`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Falha ao carregar materiais.");
      const data: Material[] = await res.json();
      setMaterials(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao carregar materiais.");
    } finally {
      setLoadingMaterials(false);
    }
  }

  useEffect(() => {
    if (open && step === "materials") {
      loadMaterials();
    }
  }, [open]);

  function reset() {
    setStep("materials");
    setSelected(new Map());
    setTotpToken("");
    setNotes("");
    setError(null);
    setRequestId(null);
    setSubmitting(false);
  }

  function handleOpenChange(val: boolean) {
    setOpen(val);
    if (!val) setTimeout(reset, 300); // reset after close animation
  }

  function toggleMaterial(mat: Material) {
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
      const res = await fetch(`${BFF_URL}/api/ssa/requests`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: Array.from(selected.values()).map((i) => ({
            material_type_id: i.material_type_id,
            quantity: i.quantity,
          })),
          totp_token: totpToken,
          notes: notes.trim() || undefined,
        }),
      });

      const body = await res.json();

      if (!res.ok) {
        setError(body.error ?? "Falha ao enviar solicitação.");
        return;
      }

      setRequestId(body.request_id);
      setStep("success");
    } catch {
      setError("Sem conexão com o servidor.");
    } finally {
      setSubmitting(false);
    }
  }

  const categoryLabels: Record<string, string> = {
    arma: "Arma",
    farda: "Farda",
    acessorio: "Acessório",
    equipamento: "Equipamento",
  };

  const grouped = materials.reduce<Record<string, Material[]>>((acc, m) => {
    acc[m.categoria] = acc[m.categoria] ?? [];
    acc[m.categoria].push(m);
    return acc;
  }, {});

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>{children as React.ReactElement}</SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col overflow-y-auto">
        <SheetHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Shield className="size-5 text-primary" />
            <SheetTitle>
              {step === "materials" && "Selecionar Material"}
              {step === "totp" && "Confirmar Identidade"}
              {step === "success" && "Solicitação Enviada"}
            </SheetTitle>
          </div>
          {step === "materials" && (
            <SheetDescription>
              Selecione os materiais e informe a quantidade desejada.
            </SheetDescription>
          )}
          {step === "totp" && (
            <SheetDescription>
              Use o código abaixo para validar sua solicitação.
            </SheetDescription>
          )}
        </SheetHeader>

        {/* ── Step: Materials ── */}
        {step === "materials" && (
          <div className="flex-1 overflow-y-auto px-4 space-y-5" data-testid="ssa-step-materials">
            {loadingMaterials && (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loadingMaterials && materials.length === 0 && !error && (
              <div className="text-center py-10 text-muted-foreground text-sm">
                Nenhum material disponível no momento.
              </div>
            )}
            {error && (
              <div className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive flex gap-2">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                {error}
              </div>
            )}
            {Object.entries(grouped).map(([cat, items]) => (
              <div key={cat} className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {categoryLabels[cat] ?? cat}
                </p>
                {items.map((mat) => {
                  const sel = selected.get(mat.id);
                  return (
                    <div
                      key={mat.id}
                      data-testid="material-card"
                      className={`rounded-xl p-3 flex items-center gap-3 cursor-pointer border transition-colors ${
                        sel
                          ? "border-primary bg-primary/5"
                          : "border-border bg-card hover:border-primary/40"
                      }`}
                      onClick={() => toggleMaterial(mat)}
                    >
                      <div
                        className={`size-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          sel ? "border-primary bg-primary" : "border-muted-foreground/40"
                        }`}
                      >
                        {sel && <CheckCircle2 className="size-3 text-white" />}
                      </div>
                      <span className="flex-1 text-sm font-medium">{mat.nome}</span>
                      {sel && (
                        <div
                          className="flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            variant="ghost" size="icon-sm"
                            onClick={() => adjustQuantity(mat.id, -1)}
                            className="size-7"
                          >
                            <Minus className="size-3" />
                          </Button>
                          <span className="w-5 text-center text-sm font-semibold">
                            {sel.quantity}
                          </span>
                          <Button
                            variant="ghost" size="icon-sm"
                            onClick={() => adjustQuantity(mat.id, 1)}
                            className="size-7"
                          >
                            <Plus className="size-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground text-center pb-2">
              Você não visualiza quantidades em estoque. Apenas disponibilidade.
            </p>
          </div>
        )}

        {/* ── Step: TOTP ── */}
        {step === "totp" && (
          <div className="flex-1 overflow-y-auto px-4 space-y-4">
            <TOTPDisplay />

            {/* Summary */}
            <div className="rounded-xl bg-card border border-border p-3 space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Materiais selecionados
              </p>
              {Array.from(selected.values()).map((item) => (
                <div key={item.material_type_id} className="flex justify-between text-sm">
                  <span>{item.nome}</span>
                  <span className="font-medium text-muted-foreground">× {item.quantity}</span>
                </div>
              ))}
            </div>

            {/* TOTP input */}
            <div className="space-y-1.5">
              <Label htmlFor="totp-input">Digite o código acima</Label>
              <Input
                id="totp-input"
                data-testid="totp-input"
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000 000"
                value={totpToken}
                onChange={(e) => setTotpToken(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="text-center text-xl tracking-widest font-mono"
              />
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label htmlFor="notes">Observação para o armeiro (opcional)</Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={300}
                placeholder="Ex: Saída para instrução de campanha"
              />
            </div>

            {error && (
              <div className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive flex gap-2">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                {error}
              </div>
            )}
          </div>
        )}

        {/* ── Step: Success ── */}
        {step === "success" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-4 text-center">
            <div className="size-16 rounded-full bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="size-8 text-emerald-600" />
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold text-lg">Solicitação Enviada!</h3>
              <p className="text-sm text-muted-foreground">
                O armeiro foi notificado e irá responder em breve.
              </p>
            </div>
            {requestId && (
              <p className="text-[11px] text-muted-foreground font-mono bg-muted rounded-lg px-3 py-1.5">
                #{requestId.slice(0, 8).toUpperCase()}
              </p>
            )}
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 text-left">
              <strong>Atenção:</strong> Após a aprovação, você terá{" "}
              <strong>6 horas</strong> para retirar o material. Fique atento à notificação.
            </div>
          </div>
        )}

        {/* ── Footer actions ── */}
        <SheetFooter className="pt-2">
          {step === "materials" && (
            <Button
              className="w-full"
              data-testid="btn-step-next"
              disabled={selected.size === 0}
              onClick={() => setStep("totp")}
            >
              Avançar ({selected.size} selecionado{selected.size !== 1 ? "s" : ""})
              <ChevronRight className="size-4 ml-1" />
            </Button>
          )}
          {step === "totp" && (
            <div className="w-full space-y-2">
              <Button
                className="w-full"
                data-testid="btn-submit-request"
                disabled={submitting || totpToken.length < 6}
                onClick={handleSubmit}
              >
                {submitting ? (
                  <><Loader2 className="size-4 mr-2 animate-spin" /> Enviando...</>
                ) : (
                  "Enviar Solicitação"
                )}
              </Button>
              <Button
                variant="ghost" className="w-full"
                onClick={() => { setStep("materials"); setError(null); }}
              >
                Voltar
              </Button>
            </div>
          )}
          {step === "success" && (
            <Button
              variant="outline"
              className="w-full"
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
