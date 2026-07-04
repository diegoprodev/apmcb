"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Shield, Plus, Minus, ChevronRight, CheckCircle2, AlertCircle,
  Loader2, WifiOff, Lock, Info, Search, ChevronDown, Users,
} from "lucide-react";
import {
  Sheet, SheetTrigger, SheetContent, SheetHeader,
  SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TOTPDisplay } from "@/components/ui/totp-display";
import { csrfHeaders } from "@/lib/csrf";
import { createClient } from "@/lib/supabase/client";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

type Step = "reserve" | "motivo" | "materials" | "totp" | "success";

interface Reserve {
  id: string;
  nome: string;
  acronym: string;
  allow_remote_requests: boolean;
  is_member: boolean;
}

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
  activeRequest?: { status: string } | null;
}

const CATEGORIA_LABEL: Record<string, string> = {
  arma: "Arma",
  farda: "Farda",
  acessorio: "Acessório",
  equipamento: "Equipamento",
};

const MOTIVO_SUGGESTIONS = [
  "Serviço extra determinado pelo superior hierárquico",
  "Escala de serviço extraordinário",
  "Treinamento em outra unidade",
  "Designação temporária para missão especial",
  "Substituição de militar da unidade",
];

export function SolicitarArmamentoSheet({ children, activeRequest }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("reserve");

  // Reserve combobox
  const [reserves, setReserves] = useState<Reserve[]>([]);
  const [reserveSearch, setReserveSearch] = useState("");
  const [comboOpen, setComboOpen] = useState(false);
  const [selectedReserve, setSelectedReserve] = useState<Reserve | null>(null);
  const [loadingReserves, setLoadingReserves] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);

  // Motivo
  const [remoteReason, setRemoteReason] = useState("");

  // Materials
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialSearch, setMaterialSearch] = useState("");
  const [loadingMaterials, setLoadingMaterials] = useState(false);
  const [selected, setSelected] = useState<Map<string, SelectedItem>>(new Map());

  // TOTP + submit
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

  async function loadReserves() {
    setLoadingReserves(true);
    try {
      const authHeader = await getBearerHeader();
      const res = await fetch(`${BFF_URL}/api/reserves/mine`, {
        credentials: "include",
        headers: authHeader,
      });
      if (!res.ok) throw new Error();
      const body = await res.json() as { reserves?: Reserve[] };
      const list = body.reserves ?? [];
      setReserves(list);
      if (list.length === 1) {
        selectReserve(list[0]);
      } else {
        setStep("reserve");
      }
    } catch {
      setStep("materials");
    } finally {
      setLoadingReserves(false);
    }
  }

  function selectReserve(r: Reserve) {
    setSelectedReserve(r);
    setComboOpen(false);
    setReserveSearch("");
    const isExternal = !r.is_member;
    if (isExternal) {
      setStep("motivo");
    } else {
      setStep("materials");
    }
  }

  async function loadMaterials(reserveId?: string) {
    setLoadingMaterials(true);
    setError(null);
    setBffDown(false);
    try {
      const authHeader = await getBearerHeader();
      const url = new URL(`${BFF_URL}/api/ssa/available-materials`);
      if (reserveId) url.searchParams.set("reserve_id", reserveId);
      const res = await fetch(url.toString(), {
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

  // Close combobox when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setComboOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (open) loadReserves();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (step === "materials") loadMaterials(selectedReserve?.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selectedReserve?.id]);

  function reset() {
    setStep("reserve");
    setReserves([]);
    setSelectedReserve(null);
    setReserveSearch("");
    setComboOpen(false);
    setRemoteReason("");
    setMaterialSearch("");
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
      const newQty = Math.min(10, Math.max(1, item.quantity + delta));
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
      const isExternal = selectedReserve && !selectedReserve.is_member;
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
          reserve_id: selectedReserve?.id,
          remote_reason: isExternal ? remoteReason.trim() : undefined,
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

  // Filtered reserves for combobox
  const filteredReserves = useMemo(() => {
    const q = reserveSearch.toLowerCase().trim();
    if (!q) return reserves;
    return reserves.filter(
      (r) =>
        r.nome.toLowerCase().includes(q) ||
        r.acronym.toLowerCase().includes(q)
    );
  }, [reserves, reserveSearch]);

  // Filtered + grouped materials
  const filteredMaterials = useMemo(() => {
    const q = materialSearch.toLowerCase().trim();
    if (!q) return materials;
    return materials.filter((m) => m.nome.toLowerCase().includes(q));
  }, [materials, materialSearch]);

  const grouped = useMemo(
    () =>
      filteredMaterials.reduce<Record<string, Material[]>>((acc, m) => {
        acc[m.categoria] = acc[m.categoria] ?? [];
        acc[m.categoria].push(m);
        return acc;
      }, {}),
    [filteredMaterials]
  );

  const disponiveisCount = materials.filter((m) => m.disponivel).length;
  const motivoValid = remoteReason.trim().length >= 10;

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
              {(step === "reserve" || loadingReserves) && "Solicitação Remota"}
              {step === "motivo" && "Motivo da Solicitação"}
              {step === "materials" && "Requisitar Armamento"}
              {step === "totp" && "Confirmar Identidade"}
              {step === "success" && "Solicitação Enviada"}
            </SheetTitle>
          </div>
          {step === "reserve" && (
            <SheetDescription className="text-muted-foreground">
              Escolha a Reserva de Armamento para sua solicitação.
            </SheetDescription>
          )}
          {step === "motivo" && (
            <SheetDescription className="text-muted-foreground">
              Informe o motivo para solicitar nesta reserva externa.
            </SheetDescription>
          )}
          {step === "materials" && (
            <SheetDescription className="text-muted-foreground">
              {selectedReserve && <span className="font-medium text-foreground">{selectedReserve.nome} · </span>}
              Selecione os materiais e informe a quantidade.
            </SheetDescription>
          )}
          {step === "totp" && (
            <SheetDescription className="text-muted-foreground">
              Use o código abaixo para validar sua identidade.
            </SheetDescription>
          )}
        </SheetHeader>

        {/* ── Step: Reserve (Combobox) ── */}
        {(step === "reserve" || loadingReserves) && (
          <div className="flex-1 overflow-y-auto space-y-3 py-2" data-testid="ssa-step-reserve">
            {loadingReserves && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* Active request blocker */}
            {!loadingReserves && activeRequest && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-4 flex gap-3">
                <Info className="size-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Solicitação já em andamento</p>
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                    Você tem uma solicitação{" "}
                    <strong>{activeRequest.status === "aprovado" ? "aprovada aguardando retirada" : "pendente de aprovação"}</strong>.
                    Aguarde a conclusão antes de fazer uma nova.
                  </p>
                </div>
              </div>
            )}

            {/* Combobox */}
            {!loadingReserves && !activeRequest && reserves.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">Reserva de Armamento</Label>

                {/* Combobox trigger + dropdown */}
                <div ref={comboRef} className="relative">
                  <button
                    type="button"
                    data-testid="ssa-reserve-combobox"
                    onClick={() => setComboOpen((v) => !v)}
                    className="w-full rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-2 text-left hover:border-primary/50 transition-colors"
                  >
                    <span className={["flex-1 text-sm truncate", selectedReserve ? "text-foreground" : "text-muted-foreground"].join(" ")}>
                      {selectedReserve ? `${selectedReserve.nome} (${selectedReserve.acronym})` : "Selecione uma reserva..."}
                    </span>
                    <ChevronDown className={["size-4 text-muted-foreground shrink-0 transition-transform", comboOpen ? "rotate-180" : ""].join(" ")} />
                  </button>

                  {comboOpen && (
                    <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-xl border border-border bg-popover shadow-lg overflow-hidden">
                      {/* Search inside dropdown */}
                      <div className="p-2 border-b border-border">
                        <div className="relative">
                          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                          <input
                            data-testid="ssa-reserve-search"
                            autoFocus
                            type="text"
                            placeholder="Buscar por nome ou sigla..."
                            value={reserveSearch}
                            onChange={(e) => setReserveSearch(e.target.value)}
                            className="w-full pl-8 pr-3 py-2 text-sm bg-transparent border-0 outline-none placeholder:text-muted-foreground text-foreground"
                          />
                        </div>
                      </div>

                      {/* Options list */}
                      <div className="max-h-56 overflow-y-auto">
                        {filteredReserves.length === 0 ? (
                          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                            Nenhuma reserva encontrada
                          </div>
                        ) : (
                          filteredReserves.map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              data-testid={`ssa-reserve-option-${r.id}`}
                              onClick={() => selectReserve(r)}
                              className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/60 transition-colors text-left"
                            >
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">{r.nome}</p>
                                {r.acronym && (
                                  <p className="text-xs text-muted-foreground">{r.acronym}</p>
                                )}
                              </div>
                              {r.is_member && (
                                <span
                                  data-testid="badge-membro"
                                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary shrink-0"
                                >
                                  <Users className="size-2.5 inline mr-0.5" />Membro
                                </span>
                              )}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {reserves.length === 0 && (
                  <p
                    data-testid="ssa-reserves-empty"
                    className="text-sm text-muted-foreground text-center py-8"
                  >
                    Nenhuma reserva disponível para solicitação remota.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Step: Motivo (externo) ── */}
        {step === "motivo" && (
          <div className="flex-1 overflow-y-auto space-y-4 py-2" data-testid="ssa-step-motivo">
            <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-3 flex gap-2">
              <Info className="size-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                Você está solicitando em uma reserva fora da sua unidade.{" "}
                <strong>Informe o motivo</strong> para que o armeiro possa avaliar.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm text-foreground">
                Motivo da solicitação <span className="text-destructive">*</span>
              </Label>
              <Textarea
                data-testid="ssa-motivo-textarea"
                placeholder="Ex: Serviço extra determinado pelo superior hierárquico..."
                value={remoteReason}
                onChange={(e) => setRemoteReason(e.target.value)}
                maxLength={500}
                rows={4}
                className="resize-none bg-background"
              />
              <p className="text-xs text-muted-foreground text-right">
                {remoteReason.length}/500 · mínimo 10 caracteres
              </p>
            </div>

            {/* Suggestions */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Sugestões rápidas:</p>
              {MOTIVO_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setRemoteReason(s)}
                  className="w-full text-left text-xs px-3 py-2 rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-colors text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Step: Materials ── */}
        {step === "materials" && (
          <div className="flex-1 overflow-y-auto space-y-4 py-2" data-testid="ssa-step-materials">

            {loadingMaterials && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {!loadingMaterials && bffDown && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-4 flex gap-3">
                <WifiOff className="size-5 text-destructive shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-destructive">Servidor indisponível</p>
                  <p className="text-xs text-muted-foreground">
                    Não foi possível conectar ao servidor BFF.
                  </p>
                  <button
                    className="text-xs text-primary underline cursor-pointer"
                    onClick={() => loadMaterials(selectedReserve?.id)}
                  >
                    Tentar novamente
                  </button>
                </div>
              </div>
            )}

            {!loadingMaterials && error && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive flex gap-2">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            {!loadingMaterials && !bffDown && (
              <>
                {/* Search input (RR-06) */}
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    data-testid="ssa-material-search"
                    type="text"
                    placeholder="Buscar material..."
                    value={materialSearch}
                    onChange={(e) => setMaterialSearch(e.target.value)}
                    className="pl-9 bg-background"
                  />
                </div>

                {/* Results */}
                {filteredMaterials.length === 0 && materials.length > 0 && (
                  <p
                    data-testid="ssa-materials-empty"
                    className="text-sm text-muted-foreground text-center py-8"
                  >
                    Nenhum material encontrado para &ldquo;{materialSearch}&rdquo;.
                  </p>
                )}

                {materials.length === 0 && (
                  <div
                    data-testid="ssa-materials-empty"
                    className="text-center py-12 text-muted-foreground text-sm"
                  >
                    Nenhum material cadastrado no almoxarifado.
                  </div>
                )}

                {filteredMaterials.length > 0 && (
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
                              data-testid={`ssa-material-item-${mat.id}`}
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

                              {!unavailable && !sel && (
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 shrink-0">
                                  Disponível
                                </span>
                              )}

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
              </>
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
                A Reserva de Armamento foi notificada e irá responder em breve.
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
          {(step === "reserve" || loadingReserves) && activeRequest && (
            <Button
              variant="outline"
              className="w-full cursor-pointer"
              onClick={() => handleOpenChange(false)}
            >
              Fechar
            </Button>
          )}

          {step === "motivo" && (
            <div className="w-full space-y-2">
              <Button
                className="w-full cursor-pointer"
                data-testid="btn-motivo-next"
                disabled={!motivoValid}
                onClick={() => setStep("materials")}
              >
                Próximo
                <ChevronRight className="size-4 ml-1" />
              </Button>
              <Button
                variant="ghost"
                className="w-full cursor-pointer"
                onClick={() => { setStep("reserve"); setSelectedReserve(null); setRemoteReason(""); }}
              >
                ← Mudar reserva
              </Button>
            </div>
          )}

          {step === "materials" && (
            <div className="w-full space-y-2">
              <Button
                className="w-full cursor-pointer"
                data-testid="btn-step-next"
                disabled={selected.size === 0 || bffDown}
                onClick={() => setStep("totp")}
              >
                Avançar — {selected.size} item{selected.size !== 1 ? "s" : ""} selecionado{selected.size !== 1 ? "s" : ""}
                <ChevronRight className="size-4 ml-1" />
              </Button>
              {(reserves.length > 1 || (selectedReserve && !selectedReserve.is_member)) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full cursor-pointer"
                  onClick={() => {
                    if (selectedReserve && !selectedReserve.is_member) {
                      setStep("motivo");
                    } else {
                      setStep("reserve");
                    }
                  }}
                >
                  ← Voltar
                </Button>
              )}
            </div>
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
