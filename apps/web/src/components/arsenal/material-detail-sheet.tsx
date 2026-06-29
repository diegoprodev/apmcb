"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Minus,
  Package,
  Plus,
  TrendingDown,
  Upload,
  X,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  MATERIAL_VALIDITY_ALERT_DAYS,
  createMaterialCategoryProfile,
  type MaterialCategoryProfile,
} from "@/lib/material-metadata";
import { toast } from "sonner";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

export interface MaterialItem {
  id: string;
  nome: string;
  categoria: string;
  categoria_slug?: string | null;
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

type RequestItemRow = {
  numero_serie: string;
  validade_item: string;
};

function makeRequestRows(count: number, previous: RequestItemRow[]) {
  const safeCount = Math.max(1, Math.min(100, count));
  return Array.from({ length: safeCount }, (_, index) => previous[index] ?? {
    numero_serie: "",
    validade_item: "",
  });
}

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
  const [categories, setCategories] = useState<MaterialCategoryProfile[]>([]);
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState("Arma");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [quantidadeTotal, setQuantidadeTotal] = useState(1);
  const [descricao, setDescricao] = useState("");
  const [calibre, setCalibre] = useState("");
  const [hasSerialNumbers, setHasSerialNumbers] = useState(false);
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [vehicleColor, setVehicleColor] = useState("");
  const [vehicleYear, setVehicleYear] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [validityAlertDays, setValidityAlertDays] = useState<number[]>([...MATERIAL_VALIDITY_ALERT_DAYS]);
  const [itemRows, setItemRows] = useState<RequestItemRow[]>([]);
  const [notes, setNotes] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  const categoryProfile = useMemo(() => {
    const typed = categoria.trim().toLowerCase();
    return categories.find((item) => item.id === categoryId || item.nome.toLowerCase() === typed || item.slug === typed)
      ?? createMaterialCategoryProfile(categoria || "Arma");
  }, [categories, categoryId, categoria]);
  const isWeapon = categoryProfile.requires_caliber;
  const isVest = categoryProfile.requires_validity;
  const isVehicle = categoryProfile.requires_vehicle_fields;
  const needsItemRows = isVest || hasSerialNumbers;

  useEffect(() => {
    let cancelled = false;
    async function loadCategories() {
      try {
        const headers = await getBearerHeaders();
        const res = await fetch(`${BFF_URL}/api/categories`, { headers });
        const data = await res.json() as { categories?: MaterialCategoryProfile[] };
        if (!cancelled) setCategories(data.categories ?? []);
      } catch {
        if (!cancelled) setCategories([]);
      }
    }
    void loadCategories();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!needsItemRows) {
      setItemRows([]);
      return;
    }
    setItemRows((previous) => makeRequestRows(quantidadeTotal, previous));
  }, [needsItemRows, quantidadeTotal]);

  function updateItemRow(index: number, field: keyof RequestItemRow, value: string) {
    setItemRows((rows) => rows.map((row, rowIndex) => (
      rowIndex === index ? { ...row, [field]: value } : row
    )));
  }

  function setCategoryByText(value: string) {
    const profile = createMaterialCategoryProfile(value || "Arma");
    const matched = categories.find((item) =>
      item.nome.toLowerCase() === value.trim().toLowerCase() || item.slug === profile.slug
    );
    const active = matched ?? profile;
    setCategoria(value);
    setCategoryId(active.id);
    setHasSerialNumbers(active.default_has_serial_numbers);
    setValidityAlertDays(active.requires_validity ? active.validity_alert_days : []);
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
      toast.error("Digite a categoria");
      return;
    }
    const profile = createMaterialCategoryProfile(categoria);
    if (!categories.some((item) => item.slug === profile.slug)) {
      setCategories((current) => [...current, profile].sort((a, b) => a.nome.localeCompare(b.nome)));
    }
    setCategoria(profile.nome);
    setCategoryId(profile.id);
    setHasSerialNumbers(profile.default_has_serial_numbers);
    setValidityAlertDays(profile.requires_validity ? profile.validity_alert_days : []);
    toast.success("Categoria adicionada a esta solicitacao");
  }

  function toggleAlertDay(day: number) {
    setValidityAlertDays((days) =>
      days.includes(day) ? days.filter((item) => item !== day) : [...days, day].sort((a, b) => b - a)
    );
  }

  async function handleSubmit() {
    if (!nome.trim() || !categoria.trim()) {
      toast.error("Informe nome e categoria");
      return;
    }
    if (isWeapon && !calibre.trim()) {
      toast.error("Informe o calibre da arma");
      return;
    }
    if (isVehicle && (!vehiclePlate.trim() || !vehicleModel.trim())) {
      toast.error("Informe placa e modelo do veiculo");
      return;
    }
    if (isVest && itemRows.some((row) => !row.validade_item)) {
      toast.error("Informe a validade do colete");
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
          batch: [{
            nome: nome.trim(),
            category_id: categoryProfile.id,
            categoria: categoria.trim(),
            categoria_slug: categoryProfile.slug,
            quantidade_total: quantidadeTotal,
            descricao: descricao.trim() || null,
            calibre: isWeapon ? calibre.trim() : null,
            has_serial_numbers: hasSerialNumbers,
            requires_validity: isVest,
            requires_vehicle_fields: isVehicle,
            validity_alert_days: isVest ? validityAlertDays : [],
            vehicle_plate: isVehicle ? vehiclePlate.trim() : null,
            vehicle_color: isVehicle ? vehicleColor.trim() || null : null,
            vehicle_year: isVehicle && vehicleYear ? Number(vehicleYear) : null,
            vehicle_model: isVehicle ? vehicleModel.trim() : null,
            photo_url: photoUrl ?? undefined,
            items: needsItemRows ? itemRows.map((row) => ({
              numero_serie: row.numero_serie.trim() || null,
              validade_item: row.validade_item || null,
            })) : [],
          }],
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
      <div className="grid gap-2 sm:grid-cols-[1fr_92px]">
        <input
          type="text"
          placeholder="Nome do material"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          disabled={loading}
        />
        <input
          type="number"
          min={1}
          value={quantidadeTotal}
          onChange={(e) => setQuantidadeTotal(Math.max(1, Number(e.target.value)))}
          className="rounded-lg border border-input bg-background px-2 py-2 text-center text-sm outline-none focus:border-primary"
          disabled={loading}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="request-material-category" className="text-xs font-medium text-muted-foreground">
          Categoria
        </label>
        <div className="grid gap-2 sm:grid-cols-[1fr_44px]">
          <div className="relative">
            <div className="flex h-10 overflow-hidden rounded-lg border border-input bg-background focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
              <input
                id="request-material-category"
                role="combobox"
                aria-expanded={showCategoryMenu}
                aria-controls="request-material-category-menu"
                value={categoria}
                onChange={(e) => setCategoryByText(e.target.value)}
                onFocus={() => setShowCategoryMenu(true)}
                placeholder="Arma, Colete, Veiculo, Radio ou outra"
                className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
                disabled={loading}
              />
              <button
                type="button"
                aria-label="Abrir categorias"
                onClick={() => setShowCategoryMenu((open) => !open)}
                disabled={loading}
                className="flex w-10 items-center justify-center border-l border-border text-muted-foreground hover:bg-muted"
              >
                <ChevronDown className="size-4" />
              </button>
            </div>
            {showCategoryMenu && (
              <div id="request-material-category-menu" className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
                {[...categories, createMaterialCategoryProfile("Arma"), createMaterialCategoryProfile("Colete"), createMaterialCategoryProfile("Veiculo"), createMaterialCategoryProfile("Radio")]
                  .filter((item, index, arr) => arr.findIndex((candidate) => candidate.slug === item.slug) === index)
                  .map((item) => (
                    <button
                      key={item.id ?? item.slug}
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
            variant="outline"
            size="icon"
            aria-label="Criar categoria"
            onClick={createLocalCategory}
            disabled={loading}
            className="size-10"
          >
            <Plus className="size-4" />
          </Button>
        </div>
      </div>

      {isWeapon && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Calibre *</label>
          <input
            type="text"
            value={calibre}
            onChange={(e) => setCalibre(e.target.value)}
            placeholder="Ex: 9mm, .40, 5.56"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            disabled={loading}
          />
        </div>
      )}

      {isVehicle && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Placa *</label>
            <input
              type="text"
              value={vehiclePlate}
              onChange={(e) => setVehiclePlate(e.target.value)}
              placeholder="ABC1D23"
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              disabled={loading}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Modelo *</label>
            <input
              type="text"
              value={vehicleModel}
              onChange={(e) => setVehicleModel(e.target.value)}
              placeholder="Hilux, Ranger..."
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              disabled={loading}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Cor</label>
            <input
              type="text"
              value={vehicleColor}
              onChange={(e) => setVehicleColor(e.target.value)}
              placeholder="Branca"
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              disabled={loading}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Ano</label>
            <input
              type="number"
              value={vehicleYear}
              onChange={(e) => setVehicleYear(e.target.value)}
              placeholder="2024"
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              disabled={loading}
            />
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Descricao do material (opcional)</label>
        <input
          type="text"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          maxLength={500}
          placeholder="Modelo, lote ou observacao operacional..."
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          disabled={loading}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="request-material-photo" className="text-xs font-medium text-muted-foreground">
          Foto do material (opcional)
        </label>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex size-11 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
            <Camera className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-muted-foreground">
              {photoFile ? photoFile.name : "Upload ou camera do dispositivo"}
            </p>
            <label className="mt-2 inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted">
              <Upload className="size-4" />
              Selecionar foto
              <input
                id="request-material-photo"
                aria-label="Foto do material"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
                disabled={loading}
                className="sr-only"
              />
            </label>
          </div>
        </div>
      </div>

      <label className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm">
        <input
          type="checkbox"
          checked={hasSerialNumbers}
          onChange={(e) => setHasSerialNumbers(e.target.checked)}
          disabled={loading}
          className="size-4"
        />
        Controlar numero de serie
      </label>

      {isVest && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3">
          <p className="text-xs font-semibold text-amber-900">Validade obrigatoria para colete</p>
          <div className="flex flex-wrap gap-2">
            {MATERIAL_VALIDITY_ALERT_DAYS.map((day) => (
              <label key={day} className="flex items-center gap-1.5 rounded-md bg-background px-2 py-1 text-xs">
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

      {needsItemRows && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase">Unidades fisicas</p>
            <span className="text-xs text-muted-foreground">{itemRows.length}</span>
          </div>
          {itemRows.map((row, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-[76px_1fr_145px]">
              <span className="flex h-9 items-center text-xs text-muted-foreground">Unid. {index + 1}</span>
              <input
                type="text"
                value={row.numero_serie}
                onChange={(e) => updateItemRow(index, "numero_serie", e.target.value)}
                placeholder="Numero de serie"
                disabled={loading || !hasSerialNumbers}
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60"
              />
              {isVest && (
                <input
                  type="date"
                  value={row.validade_item}
                  onChange={(e) => updateItemRow(index, "validade_item", e.target.value)}
                  disabled={loading}
                  className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              )}
            </div>
          ))}
        </div>
      )}

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
