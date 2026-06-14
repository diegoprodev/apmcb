"use client";

/**
 * Modal — Cadastrar Militar
 *
 * Registra um militar no sistema interno SEM criar credenciais de login.
 * O militar aparece na lista e pode ter materiais associados, mas NÃO tem
 * acesso ao sistema. O acesso é provisionado separadamente via "Criar Login".
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from "@/components/ui/select";
import { Loader2, CheckCircle2, ShieldOff } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

const ROLES = [
  { value: "military", label: "Militar" },
  { value: "master", label: "Armeiro" },
  { value: "admin", label: "Admin" },
];

const POSTOS = [
  "Cadete", "Aluno", "Aspirante", "Tenente", "Capitão",
  "Major", "Tenente-Coronel", "Coronel",
];

export function CadastrarMilitarDialog({ open, onClose }: Props) {
  const router = useRouter();

  const [nomeCompleto, setNomeCompleto] = useState("");
  const [matricula, setMatricula] = useState("");
  const [posto, setPosto] = useState("");
  const [role, setRole] = useState<"admin" | "master" | "military">("military");
  const [unidade, setUnidade] = useState("");
  const [telefone, setTelefone] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  function reset() {
    setNomeCompleto(""); setMatricula(""); setPosto("");
    setRole("military"); setUnidade(""); setTelefone(""); setDone(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleCadastrar() {
    if (!nomeCompleto.trim() || !matricula.trim()) {
      toast.error("Nome completo e matrícula são obrigatórios");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/admin/militares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome_completo: nomeCompleto.trim(),
          matricula: matricula.trim(),
          posto: posto || null,
          role,
          unidade: unidade.trim() || null,
          telefone: telefone.trim() || null,
        }),
      });

      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Erro ao cadastrar militar");

      setDone(true);
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao cadastrar militar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Cadastrar Militar</DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="py-8 flex flex-col items-center gap-4 text-center">
            <CheckCircle2 className="size-12 text-emerald-500" />
            <div>
              <p className="font-semibold text-base">Militar cadastrado com sucesso!</p>
              <p className="text-sm text-muted-foreground mt-1">
                O militar foi registrado no sistema.
                Use <span className="font-semibold text-foreground">"Criar Login"</span> para
                provisionar acesso ao sistema quando necessário.
              </p>
            </div>
            <Button onClick={handleClose} className="mt-2">Fechar</Button>
          </div>
        ) : (
          <>
            {/* Aviso de contexto */}
            <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-4 py-3">
              <ShieldOff className="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                Este cadastro <strong>não cria credenciais de login</strong>. O militar ficará
                registrado no sistema para controle de materiais. Acesso pode ser provisionado
                depois via <strong>"Criar Login"</strong>.
              </p>
            </div>

            <div className="space-y-4 py-1">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                  <Label htmlFor="cm-nome">Nome completo *</Label>
                  <Input
                    id="cm-nome"
                    value={nomeCompleto}
                    onChange={(e) => setNomeCompleto(e.target.value)}
                    disabled={loading}
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cm-matricula">Matrícula *</Label>
                  <Input
                    id="cm-matricula"
                    value={matricula}
                    onChange={(e) => setMatricula(e.target.value)}
                    disabled={loading}
                    placeholder="Ex: 20250001"
                    className="font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="cm-posto">Posto</Label>
                  <Select
                    value={posto || "nenhum"}
                    onValueChange={(v) => setPosto(v === "nenhum" ? "" : (v ?? ""))}
                    disabled={loading}
                  >
                    <SelectTrigger id="cm-posto">
                      <span className="truncate">{posto || "Sem posto"}</span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nenhum">Sem posto</SelectItem>
                      {POSTOS.map((p) => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="cm-role">Papel</Label>
                  <Select
                    value={role}
                    onValueChange={(v) => { if (v) setRole(v as typeof role); }}
                    disabled={loading}
                  >
                    <SelectTrigger id="cm-role">
                      <span className="truncate">{ROLES.find(r => r.value === role)?.label ?? role}</span>
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="cm-unidade">Unidade</Label>
                  <Input
                    id="cm-unidade"
                    value={unidade}
                    onChange={(e) => setUnidade(e.target.value)}
                    disabled={loading}
                    placeholder="1ª Cia, APMCB..."
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cm-telefone">Telefone</Label>
                  <Input
                    id="cm-telefone"
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    disabled={loading}
                    placeholder="(83) 9 9999-9999"
                  />
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={handleClose} disabled={loading}>
                Cancelar
              </Button>
              <Button
                onClick={handleCadastrar}
                disabled={loading || !nomeCompleto.trim() || !matricula.trim()}
              >
                {loading ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null}
                Cadastrar
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
