"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, ChevronDown, Loader2, Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import {
  MATERIAL_VALIDITY_ALERT_DAYS,
  createMaterialCategoryProfile,
  type MaterialCategoryProfile,
} from "@/lib/material-metadata";

interface MaterialData {
  id?: string;
  category_id?: string | null;
  nome: string;
  categoria: string;
  categoria_slug?: string | null;
  quantidade_total: number;
  descricao?: string | null;
  calibre?: string | null;
  has_serial_numbers?: boolean | null;
  requires_validity?: boolean | null;
  requires_vehicle_fields?: boolean | null;
  validity_alert_days?: number[] | null;
  vehicle_plate?: string | null;
  vehicle_color?: string | null;
  vehicle_year?: number | null;
  vehicle_model?: string | null;
  photo_url?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  material?: MaterialData | null;
  categories: MaterialCategoryProfile[];
}

type ItemRow = {
  numero_serie: string;
  validade_item: string;
  descricao_adicional: string;
};

function makeRows(count: number, previous: ItemRow[]) {
  const safeCount = Math.max(1, Math.min(100, count));
  return Array.from({ length: safeCount }, (_, index) => previous[index] ?? {
    numero_serie: "",
    validade_item: "",
    descricao_adicional: "",
  });
}

function optionKey(category: MaterialCategoryProfile) {
  return category.id ?? `${category.slug}-${category.nome}`;
}

export function MaterialDialog({ open, onClose, material, categories }: Props) {
  const router = useRouter();
  const [categoryOptions, setCategoryOptions] = useState(categories);
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState("");
  const [descricao, setDescricao] = useState("");
  const [calibre, setCalibre] = useState("");
  const [hasSerialNumbers, setHasSerialNumbers] = useState(false);
  const [validityAlertDays, setValidityAlertDays] = useState<number[]>([...MATERIAL_VALIDITY_ALERT_DAYS]);
  const [itemRows, setItemRows] = useState<ItemRow[]>([]);
  const [quantidadeTotal, setQuantidadeTotal] = useState(1);
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [vehicleColor, setVehicleColor] = useState("");
  const [vehicleYear, setVehicleYear] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isEdit = !!material?.id;
  const selectedCategory = useMemo(() => {
    if (categoryId) return categoryOptions.find((item) => item.id === categoryId) ?? null;
    const typed = categoria.trim().toLowerCase();
    return categoryOptions.find((item) => item.nome.toLowerCase() === typed || item.slug === typed) ?? null;
  }, [categoryId, categoryOptions, categoria]);
  const categoryProfile = selectedCategory ?? createMaterialCategoryProfile(categoria || "Outro");
  const requiresCaliber = categoryProfile.requires_caliber;
  const requiresValidity = categoryProfile.requires_validity;
  const requiresVehicle = categoryProfile.requires_vehicle_fields;
  const needsItemRows = requiresValidity || hasSerialNumbers;

  useEffect(() => {
    setCategoryOptions(categories);
  }, [categories]);

  useEffect(() => {
    if (material) {
      const matched = categories.find((item) =>
        item.id === material.category_id || item.slug === material.categoria_slug || item.nome === material.categoria
      );
      setNome(material.nome ?? "");
      setCategoryId(matched?.id ?? material.category_id ?? null);
      setCategoria(matched?.nome ?? material.categoria ?? "");
      setDescricao(material.descricao ?? "");
      setCalibre(material.calibre ?? "");
      setHasSerialNumbers(Boolean(material.has_serial_numbers));
      setValidityAlertDays(material.validity_alert_days?.length ? material.validity_alert_days : [...MATERIAL_VALIDITY_ALERT_DAYS]);
      setQuantidadeTotal(material.quantidade_total ?? 1);
      setVehiclePlate(material.vehicle_plate ?? "");
      setVehicleColor(material.vehicle_color ?? "");
      setVehicleYear(material.vehicle_year ? String(material.vehicle_year) : "");
      setVehicleModel(material.vehicle_model ?? "");
      setPhotoUrl(material.photo_url ?? null);
      setPhotoFile(null);
      setItemRows([]);
    } else {
      const firstCategory = categories.find((item) => item.slug === "arma") ?? categories[0] ?? createMaterialCategoryProfile("Arma");
      setNome("");
      setCategoryId(firstCategory.id);
      setCategoria(firstCategory.nome);
      setDescricao("");
      setCalibre("");
      setHasSerialNumbers(firstCategory.default_has_serial_numbers);
      setValidityAlertDays(firstCategory.requires_validity ? firstCategory.validity_alert_days : [...MATERIAL_VALIDITY_ALERT_DAYS]);
      setQuantidadeTotal(1);
      setVehiclePlate("");
      setVehicleColor("");
      setVehicleYear("");
      setVehicleModel("");
      setPhotoUrl(null);
      setPhotoFile(null);
      setItemRows([]);
    }
  }, [material, open, categories]);

  useEffect(() => {
    if (!needsItemRows) {
      setItemRows([]);
      return;
    }
    setItemRows((previous) => makeRows(quantidadeTotal, previous));
  }, [needsItemRows, quantidadeTotal]);

  function setCategoryByText(value: string) {
    const nextProfile = createMaterialCategoryProfile(value || "Outro");
    const matched = categoryOptions.find((item) =>
      item.nome.toLowerCase() === value.trim().toLowerCase() || item.slug === nextProfile.slug
    );
    setCategoria(value);
    setCategoryId(matched?.id ?? null);
    const active = matched ?? nextProfile;
    setHasSerialNumbers(active.default_has_serial_numbers);
    if (active.requires_validity) setValidityAlertDays(active.validity_alert_days.length ? active.validity_alert_days : [...MATERIAL_VALIDITY_ALERT_DAYS]);
  }

  function selectCategoryOption(option: MaterialCategoryProfile) {
    setCategoria(option.nome);
    setCategoryId(option.id);
    setHasSerialNumbers(option.default_has_serial_numbers);
    setValidityAlertDays(option.requires_validity ? option.validity_alert_days : []);
    setShowCategoryMenu(false);
  }

  function createLocalCategory() {
    if (!categoria.trim()) {
      toast.error("Digite o nome da categoria");
      return;
    }
    const profile = createMaterialCategoryProfile(categoria);
    const exists = categoryOptions.some((item) => item.slug === profile.slug);
    if (!exists) setCategoryOptions((current) => [...current, profile].sort((a, b) => a.nome.localeCompare(b.nome)));
    setCategoria(profile.nome);
    setCategoryId(profile.id);
    setHasSerialNumbers(profile.default_has_serial_numbers);
    setValidityAlertDays(profile.requires_validity ? profile.validity_alert_days : []);
    toast.success("Categoria pronta para este material");
  }

  function updateRow(index: number, field: keyof ItemRow, value: string) {
    setItemRows((rows) => rows.map((row, rowIndex) => (
      rowIndex === index ? { ...row, [field]: value } : row
    )));
  }

  function toggleAlertDay(day: number) {
    setValidityAlertDays((days) =>
      days.includes(day) ? days.filter((item) => item !== day) : [...days, day].sort((a, b) => b - a)
    );
  }

  async function uploadPhoto() {
    if (!photoFile) return { photo_url: photoUrl, photo_storage_path: null };
    const supabase = createClient();
    const ext = photoFile.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `materials/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from("material-photos")
      .upload(path, photoFile, { cacheControl: "3600", upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from("material-photos").getPublicUrl(path);
    return { photo_url: data.publicUrl, photo_storage_path: path };
  }

  async function handleSave() {
    if (!nome.trim() || !categoria.trim()) {
      toast.error("Preencha nome e categoria");
      return;
    }
    if (requiresCaliber && !calibre.trim()) {
      toast.error("Informe o calibre da arma");
      return;
    }
    if (requiresVehicle && (!vehiclePlate.trim() || !vehicleModel.trim())) {
      toast.error("Informe placa e modelo do veiculo");
      return;
    }
    if (requiresValidity && itemRows.some((row) => !row.validade_item)) {
      toast.error("Informe a validade das unidades");
      return;
    }

    setLoading(true);
    try {
      const uploaded = await uploadPhoto();
      const payload = {
        category_id: categoryProfile.id,
        nome: nome.trim(),
        categoria: categoria.trim(),
        categoria_slug: categoryProfile.slug,
        quantidade_total: quantidadeTotal,
        descricao: descricao.trim() || null,
        calibre: requiresCaliber ? calibre.trim() : null,
        has_serial_numbers: hasSerialNumbers,
        requires_validity: requiresValidity,
        requires_vehicle_fields: requiresVehicle,
        validity_alert_days: requiresValidity ? validityAlertDays : [],
        vehicle_plate: requiresVehicle ? vehiclePlate.trim() : null,
        vehicle_color: requiresVehicle ? vehicleColor.trim() || null : null,
        vehicle_year: requiresVehicle && vehicleYear ? Number(vehicleYear) : null,
        vehicle_model: requiresVehicle ? vehicleModel.trim() : null,
        items: needsItemRows ? itemRows.map((row) => ({
          numero_serie: row.numero_serie.trim() || null,
          validade_item: row.validade_item || null,
          descricao_adicional: row.descricao_adicional.trim() || null,
        })) : [],
        ...uploaded,
      };
      const res = await fetch("/api/admin/almoxarifado", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEdit ? { id: material!.id, ...payload } : payload),
      });

      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Erro ao salvar material");

      toast.success(isEdit ? "Material atualizado" : "Material adicionado");
      onClose();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar material");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-h-[94dvh] max-w-5xl overflow-y-auto p-5 sm:p-6">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar material" : "Adicionar material"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-1 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="rounded-xl border border-border bg-muted/10 p-4 lg:col-span-2">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Identificacao</h3>
                <p className="text-xs text-muted-foreground">Categoria define os campos obrigatorios.</p>
              </div>
              <span className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
                {categoryProfile.slug}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
              <div className="space-y-1.5">
                <Label htmlFor="mat-nome">Nome</Label>
                <Input
                  id="mat-nome"
                  value={nome}
                  onChange={(event) => setNome(event.target.value)}
                  placeholder="Ex: Pistola Glock G17"
                  disabled={loading}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mat-qtd">Qtd.</Label>
                <Input
                  id="mat-qtd"
                  type="number"
                  min={1}
                  value={quantidadeTotal}
                  onChange={(event) => setQuantidadeTotal(Math.max(1, Number(event.target.value)))}
                  disabled={loading}
                />
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_44px]">
              <div className="relative space-y-1.5">
                <Label htmlFor="mat-categoria">Categoria</Label>
                <div className="flex h-10 overflow-hidden rounded-lg border border-input bg-background focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
                  <input
                    id="mat-categoria"
                    role="combobox"
                    aria-expanded={showCategoryMenu}
                    aria-controls="mat-categorias-menu"
                    value={categoria}
                    onChange={(event) => setCategoryByText(event.target.value)}
                    onFocus={() => setShowCategoryMenu(true)}
                    placeholder="Digite ou escolha uma categoria"
                    disabled={loading}
                    className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
                  />
                  <button
                    type="button"
                    aria-label="Abrir categorias"
                    className="flex w-10 items-center justify-center border-l border-border text-muted-foreground hover:bg-muted"
                    onClick={() => setShowCategoryMenu((open) => !open)}
                    disabled={loading}
                  >
                    <ChevronDown className="size-4" />
                  </button>
                </div>
                {showCategoryMenu && (
                  <div id="mat-categorias-menu" className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
                    {categoryOptions.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-muted-foreground">Nenhuma categoria criada</p>
                    ) : categoryOptions.map((item) => (
                      <button
                        key={optionKey(item)}
                        type="button"
                        className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectCategoryOption(item)}
                      >
                        <span>{item.nome}</span>
                        <span className="text-[11px] text-muted-foreground">{item.slug}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button
                type="button"
                aria-label="Criar categoria"
                className="mt-6 size-10"
                size="icon"
                variant="outline"
                onClick={createLocalCategory}
                disabled={loading}
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </section>

          <section className="grid content-start gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
            {requiresCaliber && (
              <div className="space-y-1.5">
                <Label htmlFor="mat-calibre">Calibre</Label>
                <Input
                  id="mat-calibre"
                  value={calibre}
                  onChange={(event) => setCalibre(event.target.value)}
                  placeholder="9mm, .40, 5.56"
                  disabled={loading}
                />
              </div>
            )}

            {requiresVehicle && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="mat-placa">Placa</Label>
                  <Input id="mat-placa" value={vehiclePlate} onChange={(event) => setVehiclePlate(event.target.value)} placeholder="ABC1D23" disabled={loading} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mat-modelo">Modelo</Label>
                  <Input id="mat-modelo" value={vehicleModel} onChange={(event) => setVehicleModel(event.target.value)} placeholder="Hilux, Ranger..." disabled={loading} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mat-cor">Cor</Label>
                  <Input id="mat-cor" value={vehicleColor} onChange={(event) => setVehicleColor(event.target.value)} placeholder="Branca" disabled={loading} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mat-ano">Ano</Label>
                  <Input id="mat-ano" type="number" value={vehicleYear} onChange={(event) => setVehicleYear(event.target.value)} placeholder="2024" disabled={loading} />
                </div>
              </>
            )}

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="mat-descricao">Descricao opcional</Label>
              <Textarea
                id="mat-descricao"
                value={descricao}
                onChange={(event) => setDescricao(event.target.value)}
                placeholder="Modelo, lote, caracteristica ou observacao operacional..."
                disabled={loading}
                rows={2}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="mat-foto">Foto opcional</Label>
              <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/20 p-3">
                <div className="flex size-14 items-center justify-center overflow-hidden rounded-xl border border-border bg-background text-muted-foreground">
                  {photoFile || photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoFile ? URL.createObjectURL(photoFile) : photoUrl ?? ""} alt="Previa" className="h-full w-full object-cover" />
                  ) : (
                    <Camera className="size-5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">Upload ou camera do dispositivo quando disponivel.</p>
                  <label className="mt-2 inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted">
                    <Upload className="size-4" />
                    Selecionar foto
                    <Input
                      id="mat-foto"
                      aria-label="Foto do material"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      capture="environment"
                      disabled={loading}
                      onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)}
                      className="sr-only"
                    />
                  </label>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-muted/10 p-4 lg:col-span-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-background px-3 text-sm">
                <input
                  type="checkbox"
                  checked={hasSerialNumbers}
                  onChange={(event) => setHasSerialNumbers(event.target.checked)}
                  disabled={loading}
                  className="size-4"
                />
                Controlar numero de serie
              </label>
              {requiresValidity && (
                <div className="rounded-xl border border-border bg-background px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Alertas de validade</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {MATERIAL_VALIDITY_ALERT_DAYS.map((day) => (
                      <label key={day} className="flex items-center gap-1.5 text-xs">
                        <input
                          type="checkbox"
                          checked={validityAlertDays.includes(day)}
                          onChange={() => toggleAlertDay(day)}
                          disabled={loading}
                          className="size-3.5"
                        />
                        {day === 365 ? "1 ano" : day === 180 ? "6 meses" : "90 dias"}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {needsItemRows && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Unidades fisicas</p>
                  <span className="text-xs text-muted-foreground">{itemRows.length} unidade(s)</span>
                </div>
                <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                  {itemRows.map((row, index) => (
                    <div key={index} className="grid gap-2 sm:grid-cols-[82px_1fr_150px]">
                      <span className="flex h-10 items-center text-xs font-medium text-muted-foreground">Unid. {index + 1}</span>
                      <Input
                        value={row.numero_serie}
                        onChange={(event) => updateRow(index, "numero_serie", event.target.value)}
                        placeholder="Numero de serie"
                        disabled={loading || !hasSerialNumbers}
                      />
                      {requiresValidity && (
                        <Input
                          type="date"
                          value={row.validade_item}
                          onChange={(event) => updateRow(index, "validade_item", event.target.value)}
                          disabled={loading}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>

        <DialogFooter className="mt-1">
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="size-4 animate-spin" />}
            {isEdit ? "Salvar alteracoes" : "Adicionar material"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
