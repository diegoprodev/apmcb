"use client";

import { useState } from "react";
import {
  Plus, ShieldCheck, Pencil, Trash2,
  Crosshair, Shield, Truck, Radio, Headphones, Flashlight,
  Package, Wrench, Battery, Camera, Compass, Map, Lock, Key,
  Shirt, Smartphone, Zap, BookOpen, Binoculars, Tag,
} from "lucide-react";
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

// ── 20 ícones militares ────────────────────────────────────────────────────
export const MILITARY_ICONS = [
  { key: "crosshair",   label: "Arma de fogo",         Icon: Crosshair  },
  { key: "shield",      label: "Colete balístico",      Icon: Shield     },
  { key: "truck",       label: "Veículo / Viatura",     Icon: Truck      },
  { key: "radio",       label: "Rádio comunicador",     Icon: Radio      },
  { key: "headphones",  label: "Headset / Fone",        Icon: Headphones },
  { key: "flashlight",  label: "Lanterna",              Icon: Flashlight },
  { key: "package",     label: "Material geral",        Icon: Package    },
  { key: "wrench",      label: "Ferramentas",           Icon: Wrench     },
  { key: "battery",     label: "Equipamento eletrônico",Icon: Battery    },
  { key: "camera",      label: "Câmera / Vigilância",   Icon: Camera     },
  { key: "compass",     label: "Bússola / Navegação",   Icon: Compass    },
  { key: "map",         label: "Mapa",                  Icon: Map        },
  { key: "lock",        label: "Cofre / Segurança",     Icon: Lock       },
  { key: "key",         label: "Chave",                 Icon: Key        },
  { key: "shirt",       label: "Farda / Uniforme",      Icon: Shirt      },
  { key: "smartphone",  label: "Celular tático",        Icon: Smartphone },
  { key: "zap",         label: "Equipamento de choque", Icon: Zap        },
  { key: "book-open",   label: "Documentos / Manuais",  Icon: BookOpen   },
  { key: "binoculars",  label: "Binóculos",             Icon: Binoculars },
  { key: "tag",         label: "Outro",                 Icon: Tag        },
] as const;

export type MilitaryIconKey = typeof MILITARY_ICONS[number]["key"];

export function getCategoryIcon(key?: string | null) {
  return MILITARY_ICONS.find((m) => m.key === key) ?? MILITARY_ICONS.find((m) => m.key === "tag")!;
}

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

// ── Icon Picker ────────────────────────────────────────────────────────────
function IconPicker({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  return (
    <div>
      <Label className="mb-2 block">Ícone da categoria</Label>
      <div className="grid grid-cols-5 gap-1.5">
        {MILITARY_ICONS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            title={label}
            onClick={() => onChange(key)}
            className={`flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-[10px] transition-colors
              ${value === key
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-muted/20 text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}
          >
            <Icon className="size-4 shrink-0" />
            <span className="leading-tight text-center line-clamp-2">{label.split(" ")[0]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Dialog compartilhado Criar/Editar ─────────────────────────────────────
function CategoryDialog({
  open,
  onClose,
  onSaved,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (category: MaterialCategoryProfile) => void;
  editing?: MaterialCategoryProfile | null;
}) {
  const isEdit = !!editing;
  const [name, setName] = useState(editing?.nome ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [iconKey, setIconKey] = useState(editing?.icon ?? "tag");
  const [profile, setProfile] = useState<MaterialCategoryProfile>(
    editing ?? createMaterialCategoryProfile("")
  );
  const [loading, setLoading] = useState(false);

  // Sync state when editing prop changes (dialog re-opened for another category)
  function resetFor(cat?: MaterialCategoryProfile | null) {
    setName(cat?.nome ?? "");
    setDescription(cat?.description ?? "");
    setIconKey(cat?.icon ?? "tag");
    setProfile(cat ?? createMaterialCategoryProfile(""));
  }

  function updateName(value: string) {
    setName(value);
    if (!isEdit) {
      const next = createMaterialCategoryProfile(value || "Outro");
      setProfile((cur) => ({
        ...next,
        description: cur.description,
        requires_caliber: next.requires_caliber,
        requires_validity: next.requires_validity,
        default_has_serial_numbers: next.default_has_serial_numbers,
        validity_alert_days: next.validity_alert_days,
        requires_vehicle_fields: next.requires_vehicle_fields,
      }));
    }
  }

  function toggleAlertDay(day: number) {
    setProfile((cur) => {
      const exists = cur.validity_alert_days.includes(day);
      return {
        ...cur,
        validity_alert_days: exists
          ? cur.validity_alert_days.filter((d) => d !== day)
          : [...cur.validity_alert_days, day].sort((a, b) => b - a),
      };
    });
  }

  async function submit() {
    if (!name.trim()) { toast.error("Informe o nome da categoria"); return; }
    setLoading(true);
    try {
      const headers = await getBearerHeaders();
      const body = JSON.stringify({
        nome: name.trim(),
        description: description.trim() || null,
        icon: iconKey,
        requires_caliber: profile.requires_caliber,
        requires_validity: profile.requires_validity,
        default_has_serial_numbers: profile.default_has_serial_numbers,
        validity_alert_days: profile.requires_validity ? profile.validity_alert_days : [],
        requires_vehicle_fields: profile.requires_vehicle_fields,
      });

      const url = isEdit
        ? `${BFF_URL}/api/categories/${editing!.id}`
        : `${BFF_URL}/api/categories`;
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, { method, headers, body });
      const data = await res.json() as { error?: string; category?: MaterialCategoryProfile };
      if (!res.ok || !data.category) throw new Error(data.error ?? "Erro ao salvar categoria");

      onSaved(data.category);
      toast.success(isEdit ? "Categoria atualizada" : "Categoria criada");
      onClose();
      resetFor(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao salvar categoria");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) { onClose(); resetFor(null); } }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Editar — ${editing?.nome}` : "Nova categoria"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
            <div className="space-y-1.5">
              <Label htmlFor="cat-name">Nome</Label>
              <Input
                id="cat-name"
                value={name}
                onChange={(e) => updateName(e.target.value)}
                placeholder="Ex: Coletes Balísticos"
                disabled={loading}
              />
            </div>
            <div className="rounded-xl border border-border bg-muted/30 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Slug</p>
              <p className="mt-1 text-sm font-semibold">{profile.slug || "outro"}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cat-desc">Descrição opcional</Label>
            <Textarea
              id="cat-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Uso operacional, restrição ou padrão interno..."
              disabled={loading}
              rows={2}
            />
          </div>

          <IconPicker value={iconKey} onChange={setIconKey} />

          <div className="grid gap-2 sm:grid-cols-2">
            {[
              ["requires_caliber",           "Exige calibre"],
              ["default_has_serial_numbers", "Controla número de série"],
              ["requires_validity",          "Exige validade"],
              ["requires_vehicle_fields",    "Exige dados de veículo"],
            ].map(([key, label]) => (
              <label key={key} className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(profile[key as keyof MaterialCategoryProfile])}
                  onChange={(e) => setProfile((cur) => ({
                    ...cur,
                    [key]: e.target.checked,
                    validity_alert_days:
                      key === "requires_validity" && e.target.checked && cur.validity_alert_days.length === 0
                        ? [...MATERIAL_VALIDITY_ALERT_DAYS]
                        : cur.validity_alert_days,
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
          <Button variant="outline" onClick={() => { onClose(); resetFor(null); }} disabled={loading}>Cancelar</Button>
          <Button onClick={submit} disabled={loading}>
            {isEdit ? <Pencil className="size-4" /> : <Plus className="size-4" />}
            {isEdit ? "Salvar alterações" : "Criar categoria"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── CategoryManager principal ──────────────────────────────────────────────
export function CategoryManager({ initialCategories, canManage }: CategoryManagerProps) {
  const [categories, setCategories] = useState(initialCategories);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<MaterialCategoryProfile | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function deactivate(cat: MaterialCategoryProfile) {
    if (!cat.id) return;
    setLoadingId(cat.id);
    try {
      const headers = await getBearerHeaders();
      const res = await fetch(`${BFF_URL}/api/categories/${cat.id}`, { method: "DELETE", headers });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Erro ao desativar categoria");
      setCategories((cur) => cur.filter((c) => c.id !== cat.id));
      toast.success("Categoria desativada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao desativar categoria");
    } finally {
      setLoadingId(null);
    }
  }

  function handleSaved(saved: MaterialCategoryProfile) {
    setCategories((cur) => {
      const exists = cur.findIndex((c) => c.id === saved.id);
      if (exists >= 0) {
        const next = [...cur];
        next[exists] = saved;
        return next.sort((a, b) => a.nome.localeCompare(b.nome));
      }
      return [...cur, saved].sort((a, b) => a.nome.localeCompare(b.nome));
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card" style={{ boxShadow: "var(--shadow-card)" }}>
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold">Categorias operacionais</h3>
          <p className="text-sm text-muted-foreground">
            Defina quais campos e ícones aparecem ao cadastrar materiais.
          </p>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="size-4" />
            Nova categoria
          </Button>
        )}
      </div>

      <div className="divide-y divide-border">
        {categories.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Nenhuma categoria cadastrada.</div>
        ) : categories.map((cat) => {
          const { Icon } = getCategoryIcon(cat.icon);
          return (
            <div
              key={`${cat.id ?? cat.slug}-${cat.nome}`}
              className="grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center"
            >
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{cat.nome}</p>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                      {cat.slug}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                    {cat.requires_caliber             && <span className="rounded-full bg-muted px-2 py-0.5">calibre</span>}
                    {cat.default_has_serial_numbers   && <span className="rounded-full bg-muted px-2 py-0.5">série</span>}
                    {cat.requires_validity            && <span className="rounded-full bg-muted px-2 py-0.5">validade</span>}
                    {cat.requires_vehicle_fields      && <span className="rounded-full bg-muted px-2 py-0.5">veículo</span>}
                    {!cat.requires_caliber && !cat.default_has_serial_numbers && !cat.requires_validity && !cat.requires_vehicle_fields && (
                      <span className="rounded-full bg-muted px-2 py-0.5">sem campos obrigatórios</span>
                    )}
                  </div>
                </div>
              </div>

              {canManage ? (
                <div className="flex items-center gap-2 justify-start md:justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setEditTarget(cat)}
                    disabled={loadingId === cat.id}
                  >
                    <Pencil className="size-3.5" />
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive gap-1.5"
                    onClick={() => deactivate(cat)}
                    disabled={loadingId === cat.id}
                  >
                    <Trash2 className="size-3.5" />
                    Desativar
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="size-4" />
                  Somente leitura
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Criar */}
      <CategoryDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={handleSaved}
        editing={null}
      />

      {/* Editar */}
      <CategoryDialog
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={(saved) => { handleSaved(saved); setEditTarget(null); }}
        editing={editTarget}
      />
    </div>
  );
}
