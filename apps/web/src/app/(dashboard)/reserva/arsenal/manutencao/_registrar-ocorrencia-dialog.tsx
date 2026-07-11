"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileQuestion, Loader2, Lock, Search, ShieldAlert, Truck, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ComboBox } from "@/components/shared/combobox";
import { bffFetch } from "@/lib/bff-client";
import { ApiError, friendlyApiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { OCORRENCIA_GROUPS, STATUS_LABEL, type ManutencaoStatus } from "@/lib/material-item-status";

type AvailableItem = {
  id: string;
  identificador_principal: string;
  material_type: { nome: string; categoria: string } | null;
  reserve: { nome: string; acronym: string } | null;
};

const OPTION_ICON: Record<ManutencaoStatus, LucideIcon> = {
  avariado: Wrench,
  manutencao: Wrench,
  extraviado: FileQuestion,
  furtado: ShieldAlert,
  em_pericia: Search,
  bloqueado: Lock,
  em_transito: Truck,
  aguardando_baixa: Wrench,
};

// Supabase-js às vezes retorna a relação embutida como array — normaliza,
// mesmo padrão já usado em reserva/cautelas/_cautelas-client.tsx.
function firstOrSelf<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * Botão + modal para registrar que um item do estoque (nunca retirado) foi
 * encontrado com problema numa conferência física: dano, perda (extravio ou
 * furto) ou pendência administrativa (perícia/bloqueio/trânsito). Sem isso
 * não havia nenhum caminho para um item mudar de status fora do fluxo de
 * devolução de saída/cautela — ver PATCH /api/arsenal/items/:id/ocorrencia.
 *
 * Nota de design: o agrupamento em 3 categorias (Dano/Perda/Administrativo) e
 * a exigência do nº de B.O. para "Furtado" são decisão de implementação desta
 * entrega — documentado no relatório final para revisão do dono do produto.
 */
export function RegistrarOcorrenciaButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [items, setItems] = useState<AvailableItem[]>([]);
  const [selected, setSelected] = useState<AvailableItem | null>(null);
  const [novoStatus, setNovoStatus] = useState<ManutencaoStatus>("avariado");
  const [motivo, setMotivo] = useState("");
  const [numeroBo, setNumeroBo] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function openDialog() {
    setOpen(true);
    setSelected(null);
    setNovoStatus("avariado");
    setMotivo("");
    setNumeroBo("");
    setLoadingItems(true);
    try {
      // Via BFF, não client Supabase direto: a sessão sb-* vira HttpOnly
      // ~100ms após o login (ver auth/exchange/page.tsx), então o SDK do
      // browser nunca tem um JWT de usuário pra anexar nas próprias chamadas
      // a *.supabase.co depois do redirect — a query sempre rodava como anon
      // e a RLS corretamente devolvia vazio (bug silencioso, confirmado via
      // trace de rede: Authorization enviado era a própria anon key).
      const { ok, data } = await bffFetch("GET", "/api/arsenal/items/disponiveis");
      if (!ok) throw new Error("Falha ao buscar materiais disponíveis");
      setItems(
        (Array.isArray(data) ? data : []).map((i: AvailableItem) => ({
          ...i,
          material_type: firstOrSelf(i.material_type),
          reserve: firstOrSelf(i.reserve),
        }))
      );
    } catch (error) {
      console.error("[registrar-ocorrencia] falha ao buscar itens disponíveis", error);
      toast.error("Erro ao carregar materiais disponíveis. Tente novamente.");
    } finally {
      setLoadingItems(false);
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next && submitting) return;
    setOpen(next);
  }

  const motivoValido = motivo.trim().length >= 5;
  const isFurtado = novoStatus === "furtado";
  const numeroBoValido = !isFurtado || numeroBo.trim().length >= 3;
  const canSubmit = !!selected && motivoValido && numeroBoValido && !submitting;

  async function handleSubmit() {
    if (!selected || !motivoValido || !numeroBoValido) return;
    setSubmitting(true);
    try {
      const { ok, status, data } = await bffFetch("PATCH", `/api/arsenal/items/${selected.id}/ocorrencia`, {
        novo_status: novoStatus,
        motivo: motivo.trim(),
        numero_bo: isFurtado ? numeroBo.trim() : undefined,
      });
      if (!ok) throw new ApiError(friendlyApiError(status, data.error, "Erro ao registrar ocorrência"), status);

      toast.success(`Ocorrência registrada — item ${STATUS_LABEL[novoStatus].toLowerCase()}`);
      setOpen(false);
      router.refresh();
    } catch (error) {
      console.error("[registrar-ocorrencia] falha ao registrar ocorrência", error);
      toast.error(error instanceof ApiError ? error.message : "Erro de conexão. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={openDialog}
        data-testid="manutencao-registrar-ocorrencia-btn"
      >
        <AlertTriangle className="size-4" />
        Registrar ocorrência
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-lg" data-testid="manutencao-ocorrencia-dialog">
          <DialogHeader>
            <DialogTitle>Registrar ocorrência de material</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Material</Label>
              <ComboBox<AvailableItem>
                items={items}
                selected={selected}
                onSelect={setSelected}
                placeholder={loadingItems ? "Carregando materiais..." : "Buscar por identificador ou nome..."}
                getLabel={(i) => `${i.material_type?.nome ?? "Material"} — ${i.identificador_principal}`}
                getSecondary={(i) => i.reserve?.nome ?? ""}
                disabled={loadingItems}
              />
              {!loadingItems && items.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhum material disponível encontrado.</p>
              )}
            </div>

            <div className="space-y-2.5">
              <Label>Tipo de ocorrência</Label>
              {OCORRENCIA_GROUPS.map((group) => (
                <div key={group.label} className="space-y-1">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{group.label}</p>
                  <div className={cn("grid gap-2", group.options.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
                    {group.options.map((opt) => {
                      const Icon = OPTION_ICON[opt.value];
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          data-testid={`ocorrencia-tipo-${opt.value}`}
                          onClick={() => setNovoStatus(opt.value)}
                          className={cn(
                            "flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-sm font-medium transition-colors",
                            novoStatus === opt.value
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:border-primary/40"
                          )}
                        >
                          <Icon className="size-4" />
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {isFurtado && (
              <div className="space-y-1.5">
                <Label htmlFor="ocorrencia-numero-bo">Número do B.O.</Label>
                <Input
                  id="ocorrencia-numero-bo"
                  data-testid="ocorrencia-numero-bo-input"
                  value={numeroBo}
                  onChange={(e) => setNumeroBo(e.target.value)}
                  placeholder="Nº do Boletim de Ocorrência policial"
                />
                {!numeroBoValido && (
                  <p className="text-xs text-destructive">Obrigatório para itens furtados.</p>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="ocorrencia-motivo">Motivo / descrição</Label>
              <Textarea
                id="ocorrencia-motivo"
                data-testid="ocorrencia-motivo-input"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Descreva o que foi constatado (mínimo 5 caracteres)..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter className="mt-1">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit} data-testid="ocorrencia-submit-btn" className="gap-1.5">
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
