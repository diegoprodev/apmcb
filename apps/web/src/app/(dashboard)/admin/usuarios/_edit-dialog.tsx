"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";

interface UserData {
  id: string;
  nome_completo: string;
  matricula: string;
  email: string | null;
  role: "admin" | "master" | "military";
  registration_status: "pending_biometric" | "complete" | "inactive";
  posto: string | null;
  unidade: string | null;
  telefone: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  user: UserData | null;
  currentUserId: string;
}

const ROLES = [
  { value: "military", label: "Militar" },
  { value: "master", label: "Armeiro" },
  { value: "admin", label: "Admin" },
];

const STATUSES = [
  { value: "complete", label: "Completo" },
  { value: "pending_biometric", label: "Pendente biometria" },
  { value: "inactive", label: "Inativo" },
];

const POSTOS = [
  "Cadete", "Aluno", "Aspirante", "Tenente", "Capitão",
  "Major", "Tenente-Coronel", "Coronel",
];

export function EditUserDialog({ open, onClose, user, currentUserId }: Props) {
  const router = useRouter();
  const [nomeCompleto, setNomeCompleto] = useState("");
  const [posto, setPosto] = useState("");
  const [role, setRole] = useState<"admin" | "master" | "military">("military");
  const [status, setStatus] = useState<"pending_biometric" | "complete" | "inactive">("complete");
  const [unidade, setUnidade] = useState("");
  const [telefone, setTelefone] = useState("");
  const [loading, setLoading] = useState(false);

  const isSelf = user?.id === currentUserId;

  useEffect(() => {
    if (user) {
      setNomeCompleto(user.nome_completo ?? "");
      setPosto(user.posto ?? "");
      setRole(user.role);
      setStatus(user.registration_status);
      setUnidade(user.unidade ?? "");
      setTelefone(user.telefone ?? "");
    }
  }, [user, open]);

  async function handleSave() {
    if (!nomeCompleto.trim()) {
      toast.error("Nome completo é obrigatório");
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("profiles")
        .update({
          nome_completo: nomeCompleto.trim(),
          posto: posto.trim() || null,
          role,
          registration_status: status,
          unidade: unidade.trim() || null,
          telefone: telefone.trim() || null,
        })
        .eq("id", user!.id);
      if (error) throw error;
      toast.success("Usuário atualizado com sucesso");
      onClose();
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erro ao atualizar usuário";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar Usuário</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Read-only fields */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Matrícula (imutável)</Label>
              <p className="font-mono text-sm bg-muted px-3 py-2 rounded-lg">{user?.matricula}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">E-mail</Label>
              <p className="text-sm bg-muted px-3 py-2 rounded-lg truncate text-muted-foreground">
                {user?.email ?? "—"}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-nome">Nome completo *</Label>
            <Input
              id="edit-nome"
              value={nomeCompleto}
              onChange={(e) => setNomeCompleto(e.target.value)}
              disabled={loading}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-posto">Posto</Label>
              <Select
                value={posto || "__none__"}
                onValueChange={(v) => setPosto(v === "__none__" ? "" : (v ?? ""))}
                disabled={loading}
              >
                <SelectTrigger id="edit-posto">
                  <SelectValue placeholder="Selecionar..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sem posto</SelectItem>
                  {POSTOS.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-role">Papel</Label>
              <Select
                value={role}
                onValueChange={(v) => { if (v) setRole(v as "admin" | "master" | "military"); }}
                disabled={loading || isSelf}
              >
                <SelectTrigger id="edit-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isSelf && (
                <p className="text-xs text-muted-foreground">Não é possível alterar seu próprio papel.</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-unidade">Unidade (local de trabalho)</Label>
            <Input
              id="edit-unidade"
              value={unidade}
              onChange={(e) => setUnidade(e.target.value)}
              disabled={loading}
              placeholder="Ex: 1ª Cia, APMCB, Comando..."
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-telefone">Telefone</Label>
            <Input
              id="edit-telefone"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              disabled={loading}
              placeholder="(83) 9 9999-9999"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-status">Status</Label>
            <Select
              value={status}
              onValueChange={(v) => { if (v) setStatus(v as "pending_biometric" | "complete" | "inactive"); }}
              disabled={loading}
            >
              <SelectTrigger id="edit-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button onClick={handleSave} disabled={loading || !nomeCompleto.trim()}>
            {loading ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null}
            Salvar alterações
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
