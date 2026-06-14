"use client";

/**
 * Modal — Cadastrar Militar
 *
 * Registra um militar no sistema interno SEM criar credenciais de login.
 * Suporta: upload de foto, flag de biometria pendente com seleção de dedo.
 * callerRole "master": role fixado em "military".
 */

import { useState, useRef } from "react";
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
import { FingerSelector } from "@/components/ui/finger-selector";
import { Loader2, CheckCircle2, ShieldOff, Camera, X, Fingerprint } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface Props {
  open: boolean;
  onClose: () => void;
  callerRole?: "admin" | "master";
}

const ALL_ROLES = [
  { value: "military", label: "Militar" },
  { value: "master", label: "Armeiro" },
  { value: "admin", label: "Admin" },
];

const POSTOS = [
  { value: "cadete", label: "Cadete" },
  { value: "aspirante", label: "Aspirante" },
  { value: "segundo_tenente", label: "2º Tenente" },
  { value: "primeiro_tenente", label: "1º Tenente" },
  { value: "capitao", label: "Capitão" },
  { value: "major", label: "Major" },
  { value: "tenente_coronel", label: "Tenente-Coronel" },
  { value: "coronel", label: "Coronel" },
];

export function CadastrarMilitarDialog({ open, onClose, callerRole = "admin" }: Props) {
  const router = useRouter();
  const ROLES = callerRole === "master" ? [{ value: "military", label: "Militar" }] : ALL_ROLES;

  const [nomeCompleto, setNomeCompleto] = useState("");
  const [matricula, setMatricula] = useState("");
  const [posto, setPosto] = useState("");
  const [role, setRole] = useState<"admin" | "master" | "military">("military");
  const [unidade, setUnidade] = useState("");
  const [telefone, setTelefone] = useState("");

  // Photo upload
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Biometria
  const [captureBio, setCaptureBio] = useState(false);
  const [fingerIndex, setFingerIndex] = useState<number | null>(null);

  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  function reset() {
    setNomeCompleto(""); setMatricula(""); setPosto("");
    setRole("military"); setUnidade(""); setTelefone("");
    setPhotoFile(null); setPhotoPreview(null);
    setCaptureBio(false); setFingerIndex(null);
    setDone(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Foto deve ter no máximo 5 MB");
      return;
    }
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  function clearPhoto() {
    setPhotoFile(null);
    setPhotoPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function uploadPhoto(mat: string): Promise<string | null> {
    if (!photoFile) return null;
    const supabase = createClient();
    const ext = photoFile.name.split(".").pop() ?? "jpg";
    const path = `${mat}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("profile-photos")
      .upload(path, photoFile, { upsert: true, cacheControl: "3600" });
    if (error) throw new Error(`Erro ao enviar foto: ${error.message}`);
    const { data: { publicUrl } } = supabase.storage
      .from("profile-photos")
      .getPublicUrl(path);
    return publicUrl;
  }

  async function handleCadastrar() {
    if (!nomeCompleto.trim() || !matricula.trim()) {
      toast.error("Nome completo e matrícula são obrigatórios");
      return;
    }
    if (captureBio && fingerIndex === null) {
      toast.error("Selecione o dedo para captura biométrica");
      return;
    }

    setLoading(true);
    try {
      const foto_url = await uploadPhoto(matricula.trim());

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
          foto_url,
          biometria_pendente: captureBio,
          finger_index: captureBio ? fingerIndex : null,
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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cadastrar Militar</DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="py-8 flex flex-col items-center gap-4 text-center">
            <CheckCircle2 className="size-12 text-emerald-500" />
            <div>
              <p className="font-semibold text-base">Militar cadastrado com sucesso!</p>
              <p className="text-sm text-muted-foreground mt-1">
                O militar foi registrado no sistema.{" "}
                {captureBio && (
                  <>Biometria marcada como pendente — capture na próxima oportunidade.</>
                )}
                {!captureBio && (
                  <>Use <span className="font-semibold text-foreground">"Criar Login"</span> para provisionar acesso.</>
                )}
              </p>
            </div>
            <Button onClick={handleClose} className="mt-2">Fechar</Button>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-4 py-3">
              <ShieldOff className="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                Este cadastro <strong>não cria credenciais de login</strong>. O militar ficará
                registrado para controle de materiais. Acesso pode ser provisionado depois via{" "}
                <strong>"Criar Login"</strong>.
              </p>
            </div>

            <div className="space-y-4 py-1">
              {/* Foto */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Foto (opcional)
                </Label>
                {photoPreview ? (
                  <div className="relative w-fit">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photoPreview}
                      alt="Prévia da foto"
                      className="w-20 h-20 rounded-xl object-cover border border-border"
                    />
                    <button
                      type="button"
                      onClick={clearPhoto}
                      aria-label="Remover foto"
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center shadow"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loading}
                    className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:border-primary/50 hover:bg-primary/5 transition-colors disabled:opacity-50"
                  >
                    <Camera className="size-4" />
                    Selecionar foto do militar
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoChange}
                  disabled={loading}
                />
              </div>

              {/* Nome + Matrícula */}
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

              {/* Posto + Role */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="cm-posto">Posto</Label>
                  <Select
                    value={posto || "nenhum"}
                    onValueChange={(v) => setPosto(v === "nenhum" ? "" : (v ?? ""))}
                    disabled={loading}
                  >
                    <SelectTrigger id="cm-posto">
                      <span className="truncate">
                        {POSTOS.find(p => p.value === posto)?.label ?? "Sem posto"}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nenhum">Sem posto</SelectItem>
                      {POSTOS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="cm-role">Papel</Label>
                  <Select
                    value={role}
                    onValueChange={(v) => { if (v) setRole(v as typeof role); }}
                    disabled={loading || callerRole === "master"}
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

              {/* Unidade + Telefone */}
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

              {/* Biometria */}
              <div className="rounded-xl border border-border p-4 space-y-3">
                <label htmlFor="cm-biometria" className="flex items-center gap-3 cursor-pointer group">
                  <div
                    className={`
                      w-5 h-5 rounded border-2 flex items-center justify-center transition-colors shrink-0
                      ${captureBio
                        ? "bg-primary border-primary"
                        : "border-border group-hover:border-primary/50"
                      }
                    `}
                    aria-hidden="true"
                  >
                    {captureBio && (
                      <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <input
                    id="cm-biometria"
                    type="checkbox"
                    className="sr-only"
                    checked={captureBio}
                    onChange={(e) => { setCaptureBio(e.target.checked); if (!e.target.checked) setFingerIndex(null); }}
                    disabled={loading}
                    aria-label="Capturar biometria"
                  />
                  <div className="flex items-center gap-2">
                    <Fingerprint className="size-4 text-violet-500" />
                    <span className="text-sm font-medium">Capturar biometria</span>
                  </div>
                </label>

                {captureBio && (
                  <div className="pt-1 space-y-2">
                    <p className="text-xs text-muted-foreground text-center">
                      Selecione o dedo para a captura
                    </p>
                    <FingerSelector
                      value={fingerIndex}
                      onChange={setFingerIndex}
                      disabled={loading}
                    />
                  </div>
                )}
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={handleClose} disabled={loading}>
                Cancelar
              </Button>
              <Button
                onClick={handleCadastrar}
                disabled={loading || !nomeCompleto.trim() || !matricula.trim() || (captureBio && fingerIndex === null)}
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
