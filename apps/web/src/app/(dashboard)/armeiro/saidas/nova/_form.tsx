"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Package, ChevronLeft } from "lucide-react";
import Link from "next/link";

interface Militar {
  id: string;
  nome_completo: string;
  matricula: string;
  posto: string;
}

interface Material {
  id: string;
  nome: string;
  categoria: string;
  quantidade_disponivel: number;
  quantidade_total: number;
}

export function NovaSaidaForm({
  militares,
  materiais,
  masterId,
}: {
  militares: Militar[];
  materiais: Material[];
  masterId: string;
}) {
  const router = useRouter();
  const [militarId, setMilitarId] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [quantidade, setQuantidade] = useState(1);
  const [notas, setNotas] = useState("");
  const [loading, setLoading] = useState(false);

  const selectedMaterial = materiais.find(m => m.id === materialId);
  const maxQtd = selectedMaterial?.quantidade_disponivel ?? 1;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!militarId || !materialId) {
      toast.error("Selecione o militar e o material");
      return;
    }
    if (quantidade < 1 || quantidade > maxQtd) {
      toast.error(`Quantidade deve ser entre 1 e ${maxQtd}`);
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("lendings").insert({
        material_type_id: materialId,
        military_id: militarId,
        master_id: masterId,
        quantidade,
        notes: notas || null,
        status: "ativo",
        issued_at: new Date().toISOString(),
      });

      if (error) throw error;
      toast.success("Saída registrada com sucesso");
      router.push("/armeiro/saidas");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message ?? "Erro ao registrar saída");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Link
        href="/armeiro/saidas"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
        Voltar para saídas
      </Link>

      <div className="rounded-2xl bg-card p-6 space-y-5" style={{ boxShadow: "var(--shadow-card)" }}>
        <div className="space-y-1.5">
          <Label htmlFor="militar">Militar *</Label>
          <Select value={militarId} onValueChange={(v) => { if (v) setMilitarId(v); }} required>
            <SelectTrigger id="militar" className="w-full">
              <SelectValue placeholder="Selecionar militar..." />
            </SelectTrigger>
            <SelectContent>
              {militares.map(m => (
                <SelectItem key={m.id} value={m.id}>
                  <span className="font-medium">{m.nome_completo}</span>
                  <span className="text-muted-foreground ml-2 font-mono text-xs">{m.matricula}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {militares.length === 0 && (
            <p className="text-xs text-muted-foreground">Nenhum militar com cadastro completo</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="material">Material *</Label>
          <Select
            value={materialId}
            onValueChange={(v) => { setMaterialId(v); setQuantidade(1); }}
            required
          >
            <SelectTrigger id="material" className="w-full">
              <SelectValue placeholder="Selecionar material..." />
            </SelectTrigger>
            <SelectContent>
              {materiais.map(m => (
                <SelectItem key={m.id} value={m.id}>
                  <span className="font-medium">{m.nome}</span>
                  <span className="text-muted-foreground ml-2 text-xs">({m.quantidade_disponivel} disponíveis)</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedMaterial && (
            <div className="flex items-center gap-2 text-xs">
              <Package className="size-3 text-muted-foreground" />
              <span className="text-muted-foreground capitalize">{selectedMaterial.categoria}</span>
              <span className="text-emerald-600 font-medium">{selectedMaterial.quantidade_disponivel} disponíveis</span>
              <span className="text-muted-foreground">/ {selectedMaterial.quantidade_total} total</span>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="quantidade">Quantidade *</Label>
          <Input
            id="quantidade"
            type="number"
            min={1}
            max={maxQtd}
            value={quantidade}
            onChange={e => setQuantidade(Number(e.target.value))}
            className="w-32"
            required
          />
          {selectedMaterial && (
            <p className="text-xs text-muted-foreground">Máximo: {maxQtd}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="notas">Observações (opcional)</Label>
          <Input
            id="notas"
            value={notas}
            onChange={e => setNotas(e.target.value)}
            placeholder="Ex: Para cerimônia do dia 15..."
            className="w-full"
          />
        </div>
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={loading || !militarId || !materialId}>
          {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
          Registrar Saída
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={loading}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
