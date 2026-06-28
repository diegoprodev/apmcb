"use client";

import { useState } from "react";
import { Plus, ShieldCheck, Tag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import {
  MATERIAL_VALIDITY_ALERT_DAYS,
  createMaterialCategoryProfile,
  type MaterialCategoryProfile,
} from "@/lib/material-metadata";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

type CategoryManagerProps = {
  initialCategories: MaterialCategoryProfile[];
  canManage: boolean;
};

async function getBearerHeaders(): Promise<Record<string, string>> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  return headers;
}

function CategoryDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (category: MaterialCategoryProfile) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [profile, setProfile] = useState(createMaterialCategoryProfile(""));
  const [loading, setLoading] = useState(false);

  function updateName(value: string) {
    setName(value);
    const next = createMaterialCategoryProfile(value || "Outro");
    setProfile((current) => ({
      ...next,
      description: current.description,
      requires_caliber: next.requires_caliber,
      requires_validity: next.requires_validity,
      default_has_serial_numbers: next.default_has_serial_numbers,
      validity_alert_days: next.validity_alert_days,
      requires_vehicle_fields: next.requires_vehicle_fields,
    }));
  }

  function toggleAlertDay(day: number) {
    setProfile((current) => {
      const exists = current.validity_alert_days.includes(day);
      return {
        ...current,
        validity_alert_days: exists
          ? current.validity_alert_days.filter((item) => item !== day)
          : [...current.validity_alert_days, day].sort((a, b) => b - a),
      };
    });
  }

  async function submit() {
    if (!name.trim()) {
      toast.error("Informe o nome da categoria");
      return;
    }
    setLoading(true);
    try {
      const headers = await getBearerHeaders();
      const res = await fetch(`${BFF_URL}/api/categories`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          nome: name.trim(),
          description: description.trim() || null,
          requires_caliber: profile.requires_caliber,
          requires_validity: profile.requires_validity,
          default_has_serial_numbers: profile.default_has_serial_numbers,
          validity_alert_days: profile.requires_validity ? profile.validity_alert_days : [],
          requires_vehicle_fields: profile.requires_vehicle_fields,
        }),
      });
      const data = await res.json() as { error?: string; category?: MaterialCategoryProfile };
      if (!res.ok || !data.category) throw new Error(data.error ?? "Erro ao criar categoria");
      onCreated(data.category);
      toast.success("Categoria criada");
      setName("");
      setDescription("");
      setProfile(createMaterialCategoryProfile(""));
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao criar categoria");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Nova categoria</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_170px]">
            <div className="space-y-1.5">
              <Label htmlFor="category-name">Nome</Label>
              <Input
                id="category-name"
                value={name}
                onChange={(event) => updateName(event.target.value)}
                placeholder="Ex: Coletes balisticos"
                disabled={loading}
              />
            </div>
            <div className="rounded-xl border border-border bg-muted/30 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Preset</p>
              <p className="mt-1 text-sm font-semibold">{profile.slug || "outro"}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="category-description">Descricao opcional</Label>
            <Textarea
              id="category-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Uso operacional, restricao ou padrao interno..."
              disabled={loading}
              rows={2}
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {[
              ["requires_caliber", "Exige calibre"],
              ["default_has_serial_numbers", "Controla numero de serie"],
              ["requires_validity", "Exige validade"],
              ["requires_vehicle_fields", "Exige dados de veiculo"],
            ].map(([key, label]) => (
              <label key={key} className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(profile[key as keyof MaterialCategoryProfile])}
                  onChange={(event) => setProfile((current) => ({
                    ...current,
                    [key]: event.target.checked,
                    validity_alert_days: key === "requires_validity" && event.target.checked && current.validity_alert_days.length === 0
                      ? [...MATERIAL_VALIDITY_ALERT_DAYS]
                      : current.validity_alert_days,
                  }))}
                  disabled={loading}
                  className="size-4"
                />
                {label}
              </label>
            ))}
          </div>

          {profile.requires_validity && (
            <div className="rounded-xl border border-border bg-muted/20 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Alertas de validade</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {MATERIAL_VALIDITY_ALERT_DAYS.map((day) => (
                  <label key={day} className="flex min-h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm">
                    <input
                      type="checkbox"
                      checked={profile.validity_alert_days.includes(day)}
                      onChange={() => toggleAlertDay(day)}
                      disabled={loading}
                      className="size-4"
                    />
                    {day === 365 ? "1 ano" : day === 180 ? "6 meses" : "90 dias"}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button onClick={submit} disabled={loading}>
            <Plus className="size-4" />
            Criar categoria
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CategoryManager({ initialCategories, canManage }: CategoryManagerProps) {
  const [categories, setCategories] = useState(initialCategories);
  const [open, setOpen] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function deactivate(category: MaterialCategoryProfile) {
    if (!category.id) return;
    setLoadingId(category.id);
    try {
      const headers = await getBearerHeaders();
      const res = await fetch(`${BFF_URL}/api/categories/${category.id}`, { method: "DELETE", headers });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Erro ao desativar categoria");
      setCategories((current) => current.filter((item) => item.id !== category.id));
      toast.success("Categoria desativada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao desativar categoria");
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card" style={{ boxShadow: "var(--shadow-card)" }}>
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold">Categorias operacionais</h3>
          <p className="text-sm text-muted-foreground">Defina quais campos aparecem ao cadastrar materiais.</p>
        </div>
        {canManage ? (
          <Button size="sm" onClick={() => setOpen(true)} className="gap-1.5">
            <Plus className="size-4" />
            Nova categoria
          </Button>
        ) : null}
      </div>

      <div className="divide-y divide-border">
        {categories.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Nenhuma categoria cadastrada.</div>
        ) : categories.map((category) => (
          <div key={`${category.id ?? category.slug}-${category.nome}`} className="grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Tag className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{category.nome}</p>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                    {category.slug}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                  {category.requires_caliber && <span className="rounded-full bg-muted px-2 py-0.5">calibre</span>}
                  {category.default_has_serial_numbers && <span className="rounded-full bg-muted px-2 py-0.5">serie</span>}
                  {category.requires_validity && <span className="rounded-full bg-muted px-2 py-0.5">validade</span>}
                  {category.requires_vehicle_fields && <span className="rounded-full bg-muted px-2 py-0.5">veiculo</span>}
                  {!category.requires_caliber && !category.default_has_serial_numbers && !category.requires_validity && !category.requires_vehicle_fields && (
                    <span className="rounded-full bg-muted px-2 py-0.5">sem campos obrigatorios</span>
                  )}
                </div>
              </div>
            </div>
            {canManage ? (
              <Button
                variant="ghost"
                size="sm"
                className="justify-self-start text-destructive hover:bg-destructive/10 hover:text-destructive md:justify-self-end"
                onClick={() => deactivate(category)}
                disabled={loadingId === category.id}
              >
                <Trash2 className="size-4" />
                Desativar
              </Button>
            ) : (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="size-4" />
                Somente leitura
              </div>
            )}
          </div>
        ))}
      </div>

      <CategoryDialog
        open={open}
        onClose={() => setOpen(false)}
        onCreated={(category) => setCategories((current) => [...current, category].sort((a, b) => a.nome.localeCompare(b.nome)))}
      />
    </div>
  );
}
