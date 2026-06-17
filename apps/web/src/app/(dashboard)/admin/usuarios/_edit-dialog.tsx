"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2, X } from "lucide-react";

interface UserData {
  id: string;
  nome_completo: string;
  matricula: string;
  email: string | null;
  role: "admin" | "master" | "usuario";
  registration_status: "pending_biometric" | "complete" | "inactive";
  posto: string | null;
  nome_de_guerra: string | null;
  unidade: string | null;
  telefone: string | null;
  foto_url?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  user: UserData | null;
  currentUserId: string;
  onUserUpdated?: (updated: Partial<UserData> & { id: string }) => void;
}

const STATUSES = [
  { value: "complete", label: "Completo" },
  { value: "pending_biometric", label: "Pendente biometria" },
  { value: "inactive", label: "Inativo" },
];

const POSTOS = [
  { value: "sd",              label: "Sd" },
  { value: "cb",              label: "Cb" },
  { value: "3sgt",            label: "3° Sgt" },
  { value: "2sgt",            label: "2° Sgt" },
  { value: "1sgt",            label: "1° Sgt" },
  { value: "st",              label: "ST" },
  { value: "cad1ano",         label: "Cad 1° Ano" },
  { value: "cad2ano",         label: "Cad 2° Ano" },
  { value: "cadete",          label: "Cad" },
  { value: "aspirante",       label: "Asp" },
  { value: "segundo_tenente", label: "2° Ten" },
  { value: "primeiro_tenente",label: "1° Ten" },
  { value: "capitao",         label: "Cap" },
  { value: "major",           label: "Maj" },
  { value: "tenente_coronel", label: "TC" },
  { value: "coronel",         label: "Cel" },
];

const selectClass =
  "w-full h-10 appearance-none rounded-lg border border-input bg-card px-3 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer";

export function EditUserDialog({ open, onClose, user, currentUserId: _currentUserId, onUserUpdated }: Props) {
  const router = useRouter();
  const [photoOpen, setPhotoOpen] = useState(false);
  const [nomeCompleto, setNomeCompleto] = useState("");
  const [posto, setPosto] = useState("");
  const [nomeDeGuerra, setNomeDeGuerra] = useState("");
  const [status, setStatus] = useState<"pending_biometric" | "complete" | "inactive">("complete");
  const [unidade, setUnidade] = useState("");
  const [telefone, setTelefone] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user && open) {
      setNomeCompleto(user.nome_completo ?? "");
      setPosto(user.posto ?? "");
      setNomeDeGuerra(user.nome_de_guerra ?? "");
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
          posto: posto || null,
          nome_de_guerra: nomeDeGuerra.trim() || null,
          registration_status: status,
          unidade: unidade.trim() || null,
          telefone: telefone.trim() || null,
        })
        .eq("id", user!.id);
      if (error) throw error;
      onUserUpdated?.({
        id: user!.id,
        nome_completo: nomeCompleto.trim(),
        posto: posto || null,
        nome_de_guerra: nomeDeGuerra.trim() || null,
        registration_status: status,
        unidade: unidade.trim() || null,
        telefone: telefone.trim() || null,
      });
      toast.success("Usuário atualizado com sucesso");
      onClose();
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar usuário");
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
          {/* Foto + info imutável */}
          <div className="flex items-center gap-4">
            {user?.foto_url ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={user.foto_url}
                  alt={user.nome_completo}
                  className="w-16 h-16 rounded-xl object-cover shrink-0 cursor-zoom-in hover:opacity-90 transition-opacity"
                  onClick={() => setPhotoOpen(true)}
                  title="Clique para ampliar"
                />
                {photoOpen && createPortal(
                  <div
                    className="fixed inset-0 z-[300] flex items-center justify-center"
                    style={{ backgroundColor: "rgba(0,0,0,0.92)" }}
                    onClick={() => setPhotoOpen(false)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={user.foto_url!}
                      alt={user.nome_completo}
                      className="max-h-[88vh] max-w-[88vw] rounded-2xl shadow-2xl object-contain"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <button
                      className="absolute top-5 right-5 text-white/70 hover:text-white transition-colors"
                      onClick={() => setPhotoOpen(false)}
                    >
                      <X className="size-8" />
                    </button>
                  </div>,
                  document.body
                )}
              </>
            ) : (
              <div className="w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center text-primary text-xl font-bold shrink-0">
                {user?.nome_completo?.slice(0, 2).toUpperCase() ?? "?"}
              </div>
            )}
            <div className="flex-1 grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Matrícula (imutável)</Label>
                <p className="font-mono text-sm bg-muted px-3 py-2 rounded-lg">{user?.matricula}</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">E-mail</Label>
                <p className="text-sm bg-muted px-3 py-2 rounded-lg truncate text-muted-foreground">
                  {user?.email ?? "—"}
                </p>
              </div>
            </div>
          </div>

          {/* Nome */}
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

          {/* Posto/Graduação + Status */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-posto">Posto/Graduação</Label>
              <div className="relative">
                <select
                  id="edit-posto"
                  className={selectClass}
                  value={posto}
                  onChange={(e) => setPosto(e.target.value)}
                  disabled={loading}
                >
                  <option value="">Sem graduação</option>
                  {POSTOS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 9l6 6 6-6"/></svg>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-status">Status</Label>
              <div className="relative">
                <select
                  id="edit-status"
                  className={selectClass}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as typeof status)}
                  disabled={loading}
                >
                  {STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
                <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 9l6 6 6-6"/></svg>
              </div>
            </div>
          </div>

          {/* Nome de guerra */}
          <div className="space-y-1.5">
            <Label htmlFor="edit-nome-guerra">Nome de guerra</Label>
            <Input
              id="edit-nome-guerra"
              value={nomeDeGuerra}
              onChange={(e) => setNomeDeGuerra(e.target.value)}
              disabled={loading}
              placeholder="Ex: Silva, Rodrigues..."
            />
          </div>

          {/* Unidade */}
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

          {/* Telefone */}
          <div className="space-y-1.5">
            <Label htmlFor="edit-telefone">Telefone</Label>
            <Input
              id="edit-telefone"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              disabled={loading}
              placeholder="(83) 9 9999-9999"
              inputMode="tel"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button onClick={handleSave} disabled={loading || !nomeCompleto.trim()}>
            {loading && <Loader2 className="size-4 animate-spin mr-1.5" />}
            Salvar alterações
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
