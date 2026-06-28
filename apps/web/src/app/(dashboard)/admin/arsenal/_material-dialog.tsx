"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { MATERIAL_VALIDITY_ALERT_DAYS, normalizeMaterialCategory } from "@/lib/material-metadata";
import { Camera, Loader2, Upload } from "lucide-react";

interface MaterialData {
  id?: string;
  nome: string;
  categoria: string;
  categoria_slug?: string | null;
  quantidade_total: number;
  descricao?: string | null;
  calibre?: string | null;
  has_serial_numbers?: boolean | null;
  requires_validity?: boolean | null;
  validity_alert_days?: number[] | null;
  photo_url?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  material?: MaterialData | null;
}

type ItemRow = {
  numero_serie: string;
  validade_item: string;
  descricao_adicional: string;
};

const CATEGORIAS_PADRAO = [
  "Arma",
  "Colete",
  "Radio",
  "Equipamento",
  "Farda",
  "Acessorio",
  "Outro",
];

const CATEGORIA_CUSTOM = "__custom__";

function makeRows(count: number, previous: ItemRow[]) {
  const safeCount = Math.max(1, Math.min(100, count));
  return Array.from({ length: safeCount }, (_, index) => previous[index] ?? {
    numero_serie: "",
    validade_item: "",
    descricao_adicional: "",
  });
}

export function MaterialDialog({ open, onClose, material }: Props) {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState("");
  const [categoriaCustom, setCategoriaCustom] = useState("");
  const [descricao, setDescricao] = useState("");
  const [calibre, setCalibre] = useState("");
  const [hasSerialNumbers, setHasSerialNumbers] = useState(false);
  const [validityAlertDays, setValidityAlertDays] = useState<number[]>([...MATERIAL_VALIDITY_ALERT_DAYS]);
  const [itemRows, setItemRows] = useState<ItemRow[]>([]);
  const [quantidadeTotal, setQuantidadeTotal] = useState(1);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isEdit = !!material?.id;
  const isCustomCategoria = categoria === CATEGORIA_CUSTOM;
  const categoriaFinal = isCustomCategoria ? categoriaCustom.trim() : categoria;
  const categoryMeta = useMemo(
    () => normalizeMaterialCategory(categoriaFinal || "outro"),
    [categoriaFinal]
  );
  const isWeapon = categoriaFinal.length > 0 && categoryMeta.slug === "arma";
  const isVest = categoriaFinal.length > 0 && categoryMeta.slug === "colete";
  const needsItemRows = isVest || hasSerialNumbers;

  useEffect(() => {
    if (material) {
      setNome(material.nome ?? "");
      const standard = CATEGORIAS_PADRAO.find(
        (item) => item.toLowerCase() === (material.categoria ?? "").toLowerCase()
      );
      setCategoria(standard ?? CATEGORIA_CUSTOM);
      setCategoriaCustom(standard ? "" : (material.categoria ?? ""));
      setDescricao(material.descricao ?? "");
      setCalibre(material.calibre ?? "");
      setHasSerialNumbers(Boolean(material.has_serial_numbers));
      setValidityAlertDays(material.validity_alert_days?.length ? material.validity_alert_days : [...MATERIAL_VALIDITY_ALERT_DAYS]);
      setQuantidadeTotal(material.quantidade_total ?? 1);
      setPhotoUrl(material.photo_url ?? null);
      setPhotoFile(null);
      setItemRows([]);
    } else {
      setNome("");
      setCategoria("");
      setCategoriaCustom("");
      setDescricao("");
      setCalibre("");
      setHasSerialNumbers(false);
      setValidityAlertDays([...MATERIAL_VALIDITY_ALERT_DAYS]);
      setQuantidadeTotal(1);
      setPhotoUrl(null);
      setPhotoFile(null);
      setItemRows([]);
    }
  }, [material, open]);

  useEffect(() => {
    if (!needsItemRows) {
      setItemRows([]);
      return;
    }
    setItemRows((previous) => makeRows(quantidadeTotal, previous));
  }, [needsItemRows, quantidadeTotal]);

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
    const safeName = `${crypto.randomUUID()}.${ext}`;
    const path = `materials/${safeName}`;
    const { error } = await supabase.storage
      .from("material-photos")
      .upload(path, photoFile, { cacheControl: "3600", upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from("material-photos").getPublicUrl(path);
    return { photo_url: data.publicUrl, photo_storage_path: path };
  }

  async function handleSave() {
    if (!nome.trim() || !categoriaFinal) {
      toast.error("Preencha nome e categoria");
      return;
    }
    if (isWeapon && !calibre.trim()) {
      toast.error("Informe o calibre da arma");
      return;
    }
    if (isVest && itemRows.some((row) => !row.validade_item)) {
      toast.error("Informe a validade do colete");
      return;
    }

    setLoading(true);
    try {
      const uploaded = await uploadPhoto();
      const payload = {
        nome: nome.trim(),
        categoria: categoriaFinal,
        categoria_slug: categoryMeta.slug,
        quantidade_total: quantidadeTotal,
        descricao: descricao.trim() || null,
        calibre: isWeapon ? calibre.trim() : null,
        has_serial_numbers: hasSerialNumbers,
        requires_validity: isVest,
        validity_alert_days: isVest ? validityAlertDays : [],
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

      toast.success(isEdit ? "Material atualizado com sucesso" : "Material adicionado ao almoxarifado");
      onClose();
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erro ao salvar material";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-h-[88dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Material" : "Adicionar Material"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <div className="space-y-1.5">
              <Label htmlFor="mat-nome">Nome *</Label>
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
              <Label htmlFor="mat-qtd">Quantidade *</Label>
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

          <div className="space-y-1.5">
            <Label htmlFor="mat-categoria">Categoria *</Label>
            <Select value={categoria} onValueChange={(value) => setCategoria(value ?? "")} disabled={loading}>
              <SelectTrigger id="mat-categoria">
                <SelectValue placeholder="Selecionar ou criar categoria..." />
              </SelectTrigger>
              <SelectContent className="bg-background">
                {CATEGORIAS_PADRAO.map((item) => (
                  <SelectItem key={item} value={item}>{item}</SelectItem>
                ))}
                <SelectItem value={CATEGORIA_CUSTOM}>Nova categoria...</SelectItem>
              </SelectContent>
            </Select>
            {isCustomCategoria && (
              <Input
                placeholder="Digite a categoria"
                value={categoriaCustom}
                onChange={(event) => setCategoriaCustom(event.target.value)}
                disabled={loading}
                className="mt-1.5"
              />
            )}
          </div>

          {isWeapon && (
            <div className="space-y-1.5">
              <Label htmlFor="mat-calibre">Calibre *</Label>
              <Input
                id="mat-calibre"
                value={calibre}
                onChange={(event) => setCalibre(event.target.value)}
                placeholder="Ex: 9mm, .40, 5.56"
                disabled={loading}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="mat-descricao">Descricao (opcional)</Label>
            <Input
              id="mat-descricao"
              value={descricao}
              onChange={(event) => setDescricao(event.target.value)}
              placeholder="Observacao operacional, modelo ou lote..."
              disabled={loading}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mat-foto">Foto do material (opcional)</Label>
            <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3">
              <div className="flex size-12 items-center justify-center overflow-hidden rounded-lg border border-border bg-background text-muted-foreground">
                {photoFile || photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photoFile ? URL.createObjectURL(photoFile) : photoUrl ?? ""}
                    alt="Previa"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Camera className="size-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">
                  Upload ou camera do dispositivo quando disponivel.
                </p>
                <Input
                  id="mat-foto"
                  aria-label="Foto do material"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  disabled={loading}
                  onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)}
                  className="mt-2"
                />
              </div>
              <Upload className="size-4 text-muted-foreground" />
            </div>
          </div>

          <label className="flex items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={hasSerialNumbers}
              onChange={(event) => setHasSerialNumbers(event.target.checked)}
              disabled={loading}
              className="size-4"
            />
            Controlar numero de serie
          </label>

          {isVest && (
            <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
              <p className="text-sm font-semibold text-amber-900">Validade obrigatoria para colete</p>
              <div className="flex flex-wrap gap-2">
                {MATERIAL_VALIDITY_ALERT_DAYS.map((day) => (
                  <label key={day} className="flex items-center gap-2 rounded-lg bg-background px-2.5 py-1.5 text-xs">
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
            <div className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Unidades fisicas</p>
                <span className="text-xs text-muted-foreground">{itemRows.length} unidade(s)</span>
              </div>
              <div className="space-y-2">
                {itemRows.map((row, index) => (
                  <div key={index} className="grid gap-2 sm:grid-cols-[110px_1fr_150px]">
                    <div className="flex h-9 items-center text-xs font-medium text-muted-foreground">
                      Unidade {index + 1}
                    </div>
                    <Input
                      value={row.numero_serie}
                      onChange={(event) => updateRow(index, "numero_serie", event.target.value)}
                      placeholder="Numero de serie"
                      disabled={loading || !hasSerialNumbers}
                    />
                    {isVest && (
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

          {isEdit && (
            <p className="text-xs text-muted-foreground">
              Atencao: reduzir o total nao devolve unidades em uso.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button onClick={handleSave} disabled={loading || !nome.trim() || !categoriaFinal}>
            {loading ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
            {isEdit ? "Salvar alteracoes" : "Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
