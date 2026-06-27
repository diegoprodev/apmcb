"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { Camera, Loader2, Upload } from "lucide-react";

interface MaterialData {
  id?: string;
  nome: string;
  categoria: string;
  quantidade_total: number;
  photo_url?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  material?: MaterialData | null; // null = create, object = edit
}

const CATEGORIAS_PADRAO = [
  { value: "arma",       label: "Arma" },
  { value: "equipamento",label: "Equipamento" },
  { value: "farda",      label: "Fardamento" },
  { value: "acessorio",  label: "Acessório" },
  { value: "outro",      label: "Outro" },
];

const CATEGORIA_CUSTOM = "__custom__";

export function MaterialDialog({ open, onClose, material }: Props) {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState("");
  const [categoriaCustom, setCategoriaCustom] = useState("");
  const [quantidadeTotal, setQuantidadeTotal] = useState(1);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isEdit = !!material?.id;
  const isCustomCategoria = categoria === CATEGORIA_CUSTOM;
  const categoriaFinal = isCustomCategoria ? categoriaCustom.trim() : categoria;

  // Populate form when editing
  useEffect(() => {
    if (material) {
      setNome(material.nome ?? "");
      const isPadrao = CATEGORIAS_PADRAO.some((c) => c.value === material.categoria);
      setCategoria(isPadrao ? material.categoria : CATEGORIA_CUSTOM);
      setCategoriaCustom(isPadrao ? "" : (material.categoria ?? ""));
      setQuantidadeTotal(material.quantidade_total ?? 1);
      setPhotoUrl(material.photo_url ?? null);
      setPhotoFile(null);
    } else {
      setNome("");
      setCategoria("");
      setCategoriaCustom("");
      setQuantidadeTotal(1);
      setPhotoUrl(null);
      setPhotoFile(null);
    }
  }, [material, open]);

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
    if (quantidadeTotal < 1) {
      toast.error("Quantidade mínima é 1");
      return;
    }

    setLoading(true);
    try {
      const uploaded = await uploadPhoto();
      const res = isEdit
        ? await fetch("/api/admin/almoxarifado", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: material!.id,
              nome: nome.trim(),
              categoria: categoriaFinal,
              quantidade_total: quantidadeTotal,
              ...uploaded,
            }),
          })
        : await fetch("/api/admin/almoxarifado", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              nome: nome.trim(),
              categoria: categoriaFinal,
              quantidade_total: quantidadeTotal,
              ...uploaded,
            }),
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
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Material" : "Adicionar Material"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="mat-nome">Nome *</Label>
            <Input
              id="mat-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: Espadim de oficial"
              disabled={loading}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mat-foto">Foto do material (opcional)</Label>
            <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3">
              <div className="size-12 overflow-hidden rounded-lg border border-border bg-background flex items-center justify-center text-muted-foreground">
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
                  Use upload ou camera do dispositivo quando disponivel.
                </p>
                <Input
                  id="mat-foto"
                  aria-label="Foto do material"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  disabled={loading}
                  onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
                  className="mt-2"
                />
              </div>
              <Upload className="size-4 text-muted-foreground" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mat-categoria">Categoria *</Label>
            <Select
              value={categoria}
              onValueChange={(v) => { if (v) setCategoria(v); }}
              disabled={loading}
            >
              <SelectTrigger id="mat-categoria">
                <SelectValue placeholder="Selecionar categoria..." />
              </SelectTrigger>
              <SelectContent className="bg-background">
                {CATEGORIAS_PADRAO.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
                <SelectItem value={CATEGORIA_CUSTOM}>
                  + Nova categoria...
                </SelectItem>
              </SelectContent>
            </Select>
            {isCustomCategoria && (
              <Input
                placeholder="Digite o nome da categoria"
                value={categoriaCustom}
                onChange={(e) => setCategoriaCustom(e.target.value)}
                disabled={loading}
                autoFocus
                className="mt-1.5"
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mat-qtd">Quantidade total *</Label>
            <Input
              id="mat-qtd"
              type="number"
              min={isEdit ? undefined : 1}
              value={quantidadeTotal}
              onChange={(e) => setQuantidadeTotal(Number(e.target.value))}
              className="w-32"
              disabled={loading}
            />
            {isEdit && (
              <p className="text-xs text-muted-foreground">
                Atenção: reduzir o total não devolve unidades em uso.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button onClick={handleSave} disabled={loading || !nome.trim() || !categoriaFinal}>
            {loading ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null}
            {isEdit ? "Salvar alterações" : "Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
