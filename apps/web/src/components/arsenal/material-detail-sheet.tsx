"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Minus,
  Package,
  Plus,
  TrendingDown,
  X,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

export interface MaterialItem {
  id: string;
  nome: string;
  categoria: string;
  quantidade_total: number;
  quantidade_disponivel: number;
  quantidade_armada: number;
  photo_url?: string | null;
}

const CATEGORIA_LABEL: Record<string, string> = {
  arma: "Arma",
  farda: "Farda",
  acessorio: "Acessorio",
  equipamento: "Equipamento",
  outro: "Outro",
};

type SheetMode = "detail" | "adjust" | "add" | "deactivate" | "directDeactivate";
interface BatchItem { nome: string; categoria: string; quantidade_total: number }

async function getBearerHeaders(): Promise<Record<string, string>> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  return headers;
}

async function uploadMaterialPhoto(file: File | null) {
  if (!file) return null;
  const supabase = createClient();
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `materials/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("material-photos")
    .upload(path, file, { cacheControl: "3600", upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from("material-photos").getPublicUrl(path);
  return data.publicUrl;
}

export function AddMaterialRequestForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [batch, setBatch] = useState<BatchItem[]>([
    { nome: "", categoria: "arma", quantidade_total: 1 },
  ]);
  const [notes, setNotes] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  const categorias = ["arma", "farda", "acessorio", "equipamento", "outro"];

  function addRow() {
    setBatch((b) => [...b, { nome: "", categoria: "arma", quantidade_total: 1 }]);
  }

  function removeRow(i: number) {
    setBatch((b) => b.filter((_, idx) => idx !== i));
  }

  function updateRow(i: number, field: keyof BatchItem, val: string | number) {
    setBatch((b) => b.map((row, idx) => idx === i ? { ...row, [field]: val } : row));
  }

  async function handleSubmit() {
    const valid = batch.filter((row) => row.nome.trim());
    if (valid.length === 0) {
      toast.error("Informe ao menos um material");
      return;
    }

    setLoading(true);
    try {
      const photoUrl = await uploadMaterialPhoto(photoFile);
      const headers = await getBearerHeaders();
      const res = await fetch(`${BFF_URL}/api/arsenal/requests`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: "material_addition",
          batch: valid.map((item, index) => ({
            ...item,
            ...(index === 0 && photoUrl ? { photo_url: photoUrl } : {}),
          })),
          notes: notes || undefined,
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao enviar solicitacao");
        return;
      }
      toast.success("Solicitacao de adicao enviada ao admin da reserva");
      router.refresh();
      onClose();
    } catch {
      toast.error("Erro de conexao");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {batch.map((row, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center">
            <input
              type="text"
              placeholder="Nome do material"
              value={row.nome}
              onChange={(e) => updateRow(i, "nome", e.target.value)}
              className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              disabled={loading}
            />
            <select
              value={row.categoria}
              onChange={(e) => updateRow(i, "categoria", e.target.value)}
              className="rounded-lg border border-input bg-background px-2 py-2 text-sm outline-none focus:border-primary cursor-pointer"
              disabled={loading}
            >
              {categorias.map((cat) => (
                <option key={cat} value={cat}>{CATEGORIA_LABEL[cat]}</option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              value={row.quantidade_total}
              onChange={(e) => updateRow(i, "quantidade_total", Math.max(1, Number(e.target.value)))}
              className="w-16 rounded-lg border border-input bg-background px-2 py-2 text-sm text-center outline-none focus:border-primary"
              disabled={loading}
            />
            {batch.length > 1 && (
              <button type="button" onClick={() => removeRow(i)} className="text-muted-foreground hover:text-destructive cursor-pointer" disabled={loading}>
                <X className="size-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addRow}
        disabled={loading}
        className="flex items-center gap-1.5 text-xs text-primary hover:underline cursor-pointer disabled:opacity-50"
      >
        <Plus className="size-3" /> Adicionar outro material
      </button>

      <div className="space-y-1.5">
        <label htmlFor="request-material-photo" className="text-xs font-medium text-muted-foreground">
          Foto do material (opcional)
        </label>
        <input
          id="request-material-photo"
          aria-label="Foto do material"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
          disabled={loading}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Observacao (opcional)</label>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={300}
          placeholder="Justificativa ou contexto..."
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          disabled={loading}
        />
      </div>

      <Button className="w-full" onClick={handleSubmit} disabled={loading}>
        {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
        Solicitar aprovacao do admin da reserva
      </Button>
    </div>
  );
}

function AdjustQuantityForm({ material, onClose }: { material: MaterialItem; onClose: () => void }) {
  const router = useRouter();
  const [newQty, setNewQty] = useState(material.quantidade_total);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const delta = newQty - material.quantidade_total;

  async function handleSubmit() {
    if (newQty === material.quantidade_total) {
      toast.error("Nenhuma alteracao");
      return;
    }
    setLoading(true);
    try {
      const headers = await getBearerHeaders();
      const res = await fetch(`${BFF_URL}/api/arsenal/requests`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: "stock_adjustment",
          material_type_id: material.id,
          new_quantity: newQty,
          notes: notes || undefined,
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao enviar solicitacao");
        return;
      }
      toast.success("Solicitacao de ajuste enviada ao admin da reserva");
      router.refresh();
      onClose();
    } catch {
      toast.error("Erro de conexao");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-muted/50 p-3 text-sm space-y-1">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Quantidade atual</span>
          <span className="font-semibold">{material.quantidade_total}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Em uso</span>
          <span>{material.quantidade_armada}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Disponivel</span>
          <span className="text-emerald-600 font-medium">{material.quantidade_disponivel}</span>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium">Nova quantidade total</label>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setNewQty((q) => Math.max(material.quantidade_armada, q - 1))}
            className="size-10 rounded-xl border border-input bg-background flex items-center justify-center hover:bg-muted transition-colors cursor-pointer">
            <Minus className="size-4" />
          </button>
          <input
            type="number"
            min={material.quantidade_armada}
            value={newQty}
            onChange={(e) => setNewQty(Math.max(material.quantidade_armada, Number(e.target.value)))}
            className="flex-1 rounded-xl border border-input bg-background px-3 py-2 text-center text-xl font-bold outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
          <button type="button" onClick={() => setNewQty((q) => q + 1)}
            className="size-10 rounded-xl border border-input bg-background flex items-center justify-center hover:bg-muted transition-colors cursor-pointer">
            <Plus className="size-4" />
          </button>
        </div>
        {delta !== 0 && (
          <p className={`text-xs text-center font-medium ${delta > 0 ? "text-emerald-600" : "text-destructive"}`}>
            {delta > 0 ? `+${delta}` : delta} unidade{Math.abs(delta) !== 1 ? "s" : ""} em relacao ao atual
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Motivo / observacao</label>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={300}
          placeholder="Motivo do ajuste..."
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        />
      </div>

      <Button
        className="w-full"
        onClick={handleSubmit}
        disabled={loading || newQty === material.quantidade_total || newQty < material.quantidade_armada}
      >
        {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
        Solicitar aprovacao do admin da reserva
      </Button>
    </div>
  );
}

function DeactivateMaterialForm({ material, onClose }: { material: MaterialItem; onClose: () => void }) {
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (notes.trim().length < 5) {
      toast.error("Informe uma justificativa com ao menos 5 caracteres");
      return;
    }
    setLoading(true);
    try {
      const headers = await getBearerHeaders();
      const res = await fetch(`${BFF_URL}/api/arsenal/requests`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: "material_deactivation",
          material_type_id: material.id,
          notes: notes.trim(),
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao enviar solicitacao");
        return;
      }
      toast.success("Solicitacao de desativacao enviada ao admin da reserva");
      router.refresh();
      onClose();
    } catch {
      toast.error("Erro de conexao");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm">
        <p className="font-semibold text-destructive">Desativar {material.nome}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          A aprovacao remove o material das listas operacionais sem apagar historico.
        </p>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Justificativa</label>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={300}
          placeholder="Ex: item baixado, obsoleto ou fora de uso..."
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          disabled={loading}
        />
      </div>
      <Button
        variant="outline"
        className="w-full border-destructive/30 text-destructive hover:bg-destructive/5"
        onClick={handleSubmit}
        disabled={loading || notes.trim().length < 5}
      >
        {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
        Solicitar desativacao
      </Button>
    </div>
  );
}

function DirectDeactivateForm({ material, onClose }: { material: MaterialItem; onClose: () => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const hasActiveUse = material.quantidade_armada > 0;

  async function handleSubmit() {
    if (hasActiveUse) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/almoxarifado?id=${material.id}`, { method: "DELETE" });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao desativar material");
        return;
      }
      toast.success("Material desativado");
      router.refresh();
      onClose();
    } catch {
      toast.error("Erro de conexao");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm">
        <p className="font-semibold text-destructive">Desativar {material.nome}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          O material sai das listas operacionais sem apagar historico.
        </p>
      </div>
      {hasActiveUse && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Existem {material.quantidade_armada} unidade(s) em uso. Regularize as devolucoes antes de desativar.
        </div>
      )}
      <Button
        variant="outline"
        className="w-full border-destructive/30 text-destructive hover:bg-destructive/5"
        onClick={handleSubmit}
        disabled={loading || hasActiveUse}
      >
        {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
        Confirmar desativacao
      </Button>
    </div>
  );
}

export function MaterialDetailSheet({
  material,
  open,
  onClose,
  canRequest = false,
  canManageDirectly = false,
}: {
  material: MaterialItem | null;
  open: boolean;
  onClose: () => void;
  canRequest?: boolean;
  canManageDirectly?: boolean;
}) {
  const [mode, setMode] = useState<SheetMode>("detail");

  if (!material) return null;

  const pct = material.quantidade_total > 0
    ? Math.round((material.quantidade_disponivel / material.quantidade_total) * 100)
    : 0;
  const status = material.quantidade_disponivel === 0 ? "esgotado"
    : pct <= 20 ? "baixo" : "ok";

  const statusColor = status === "esgotado"
    ? "text-destructive" : status === "baixo"
    ? "text-amber-600" : "text-emerald-600";
  const barColor = status === "esgotado"
    ? "bg-destructive" : status === "baixo"
    ? "bg-amber-500" : "bg-emerald-500";

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) { setMode("detail"); onClose(); } }}>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl px-4 pb-8 pt-6 sm:px-6">
        <SheetHeader className="mb-4 text-left">
          {mode !== "detail" && (
            <button type="button" onClick={() => setMode("detail")}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1 cursor-pointer">
              Voltar
            </button>
          )}
          <SheetTitle className="text-base">
            {mode === "detail" ? material.nome
              : mode === "adjust" ? "Solicitar ajuste de estoque"
              : mode === "deactivate" ? "Solicitar desativacao de material"
              : mode === "directDeactivate" ? "Desativar material"
              : "Solicitar adicao de material"}
          </SheetTitle>
          {mode === "detail" && (
            <p className="text-xs text-muted-foreground">
              {CATEGORIA_LABEL[material.categoria] ?? material.categoria}
            </p>
          )}
        </SheetHeader>

        {mode === "detail" && (
          <div className="space-y-5">
            <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3">
              <div className="size-16 overflow-hidden rounded-xl border border-border bg-background flex items-center justify-center text-muted-foreground">
                {material.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={material.photo_url} alt={material.nome} className="h-full w-full object-cover" />
                ) : (
                  <Camera className="size-6" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{material.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {material.photo_url ? "Foto cadastrada" : "Sem foto cadastrada"}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Total", value: material.quantidade_total, icon: <Package className="size-3.5" />, color: "text-primary" },
                { label: "Disponivel", value: material.quantidade_disponivel, icon: <CheckCircle2 className="size-3.5" />, color: "text-emerald-600" },
                { label: "Em uso", value: material.quantidade_armada, icon: <TrendingDown className="size-3.5" />, color: "text-amber-600" },
              ].map(({ label, value, icon, color }) => (
                <div key={label} className="rounded-xl bg-muted/40 p-3 text-center">
                  <div className={`flex justify-center mb-1 ${color}`}>{icon}</div>
                  <p className={`text-2xl font-bold ${color}`}>{value}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Disponibilidade</span>
                <span className={statusColor + " font-medium"}>{pct}%</span>
              </div>
              <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
              </div>
            </div>

            <div className="flex justify-center">
              {status === "esgotado" ? (
                <span className="badge-danger text-xs font-semibold px-3 py-1 rounded-full flex items-center gap-1.5">
                  <AlertTriangle className="size-3" /> Estoque esgotado
                </span>
              ) : status === "baixo" ? (
                <span className="badge-warning text-xs font-semibold px-3 py-1 rounded-full flex items-center gap-1.5">
                  <TrendingDown className="size-3" /> Baixo estoque
                </span>
              ) : (
                <span className="badge-success text-xs font-semibold px-3 py-1 rounded-full flex items-center gap-1.5">
                  <CheckCircle2 className="size-3" /> Estoque regular
                </span>
              )}
            </div>

            {canRequest && (
              <div className="space-y-2 pt-2 border-t border-border/60">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Solicitar ao admin da reserva</p>
                <button
                  type="button"
                  onClick={() => setMode("adjust")}
                  className="w-full flex items-center justify-between rounded-xl border border-border px-4 py-3 text-sm font-medium hover:bg-muted/60 hover:border-primary/40 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <TrendingDown className="size-4 text-amber-600" />
                    Ajustar quantidade de estoque
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
                <button
                  type="button"
                  onClick={() => setMode("add")}
                  className="w-full flex items-center justify-between rounded-xl border border-border px-4 py-3 text-sm font-medium hover:bg-muted/60 hover:border-primary/40 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Plus className="size-4 text-primary" />
                    Solicitar adicao de material
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
                <button
                  type="button"
                  onClick={() => setMode("deactivate")}
                  className="w-full flex items-center justify-between rounded-xl border border-destructive/20 px-4 py-3 text-sm font-medium text-destructive hover:bg-destructive/5 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <X className="size-4" />
                    Solicitar desativacao de material
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
              </div>
            )}

            {canManageDirectly && (
              <div className="space-y-2 pt-2 border-t border-border/60">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Gestao da reserva</p>
                <button
                  type="button"
                  onClick={() => setMode("directDeactivate")}
                  className="w-full flex items-center justify-between rounded-xl border border-destructive/20 px-4 py-3 text-sm font-medium text-destructive hover:bg-destructive/5 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <X className="size-4" />
                    Desativar material
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
              </div>
            )}
          </div>
        )}

        {mode === "adjust" && (
          <AdjustQuantityForm material={material} onClose={() => { setMode("detail"); onClose(); }} />
        )}

        {mode === "add" && (
          <AddMaterialRequestForm onClose={() => { setMode("detail"); onClose(); }} />
        )}

        {mode === "deactivate" && (
          <DeactivateMaterialForm material={material} onClose={() => { setMode("detail"); onClose(); }} />
        )}

        {mode === "directDeactivate" && (
          <DirectDeactivateForm material={material} onClose={() => { setMode("detail"); onClose(); }} />
        )}
      </SheetContent>
    </Sheet>
  );
}
