"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { FingerSelector } from "@/components/ui/finger-selector";
import { Loader2, CheckCircle2, Camera, X, Fingerprint, Shield, Mail, KeyRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { csrfHeaders } from "@/lib/csrf";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

interface Props {
  open: boolean;
  onClose: () => void;
  callerRole?: "admin" | "master";
}

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

const SELECT_CLASS =
  "w-full h-10 appearance-none rounded-lg border border-input bg-card px-3 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer";

export function CadastrarMilitarDialog({ open, onClose, callerRole: _callerRole = "admin" }: Props) {
  const router = useRouter();

  const [nomeCompleto, setNomeCompleto] = useState("");
  const [matricula, setMatricula] = useState("");
  const [posto, setPosto] = useState("");
  const [nomeDeGuerra, setNomeDeGuerra] = useState("");
  const [unidade, setUnidade] = useState("");
  const [telefone, setTelefone] = useState("");

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [captureBio, setCaptureBio] = useState(false);
  const [fingerIndex, setFingerIndex] = useState<number | null>(null);
  const [provisionTotp, setProvisionTotp] = useState(true);

  const [sendInvite, setSendInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteMethod, setInviteMethod] = useState<"magic_link" | "password">("magic_link");
  const [invitePassword, setInvitePassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);

  function reset() {
    setNomeCompleto(""); setMatricula(""); setPosto("");
    setNomeDeGuerra(""); setUnidade(""); setTelefone("");
    setPhotoFile(null); setPhotoPreview(null);
    setCaptureBio(false); setFingerIndex(null);
    setProvisionTotp(true);
    setSendInvite(false); setInviteEmail(""); setInviteMethod("magic_link"); setInvitePassword("");
    setDone(false); setInviteSent(false);
  }

  function handleClose() { reset(); onClose(); }

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Foto deve ter no máximo 5 MB"); return; }
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  function clearPhoto() {
    setPhotoFile(null); setPhotoPreview(null);
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
    const { data: { publicUrl } } = supabase.storage.from("profile-photos").getPublicUrl(path);
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
    if (sendInvite && !inviteEmail.trim()) {
      toast.error("Informe o e-mail para envio do convite");
      return;
    }
    if (sendInvite && inviteMethod === "password" && invitePassword.length < 6) {
      toast.error("Senha deve ter ao menos 6 caracteres");
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
          nome_de_guerra: nomeDeGuerra.trim() || null,
          role: "usuario",
          unidade: unidade.trim() || null,
          telefone: telefone.trim() || null,
          foto_url,
          biometria_pendente: captureBio,
          finger_index: captureBio ? fingerIndex : null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Erro ao cadastrar militar");

      const userId = body.user_id as string;

      // Provision TOTP for the new military user if requested
      if (provisionTotp && userId) {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        const authHeader: Record<string, string> = session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {};
        await fetch(`${BFF_URL}/api/totp/admin-provision`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...authHeader, ...csrfHeaders() },
          body: JSON.stringify({ user_id: userId }),
        });
      }

      // Send login invite if requested
      if (sendInvite && userId && inviteEmail.trim()) {
        const inviteRes = await fetch("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: inviteEmail.trim(),
            method: inviteMethod,
            password: inviteMethod === "password" ? invitePassword : undefined,
            existing_user_id: userId,
          }),
        });
        const inviteBody = await inviteRes.json();
        if (!inviteRes.ok) {
          toast.warning(`Militar cadastrado, mas convite falhou: ${inviteBody.error ?? "erro desconhecido"}`);
        } else {
          setInviteSent(true);
        }
      }

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
      <DialogContent className="sm:max-w-3xl max-h-[92dvh] overflow-y-auto p-0">
        <div className="sticky top-0 z-10 bg-card border-b border-border px-6 py-4">
          <DialogHeader>
            <DialogTitle className="text-xl">Cadastrar Militar</DialogTitle>
          </DialogHeader>
        </div>

        {done ? (
          <div className="py-16 flex flex-col items-center gap-4 text-center px-6">
            <CheckCircle2 className="size-14 text-emerald-500" />
            <div>
              <p className="font-semibold text-lg">Militar cadastrado com sucesso!</p>
              <p className="text-sm text-muted-foreground mt-1">
                {inviteSent
                  ? <>Convite enviado para <span className="font-mono font-medium">{inviteEmail}</span>. O militar deve clicar no link para ativar a conta.</>
                  : captureBio
                  ? "Biometria marcada como pendente — capture na próxima oportunidade presencial."
                  : <>Use <span className="font-semibold text-foreground">&ldquo;Criar Login&rdquo;</span> para provisionar acesso ao sistema.</>
                }
              </p>
            </div>
            <Button onClick={handleClose} size="lg" className="mt-2">Fechar</Button>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-6">
            {/* Two-column layout */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {/* Left column */}
              <div className="space-y-4">
                {/* Foto */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Foto (opcional)
                  </Label>
                  {photoPreview ? (
                    <div className="relative w-fit">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photoPreview} alt="Prévia" className="w-24 h-24 rounded-xl object-cover border border-border" />
                      <button
                        type="button"
                        onClick={clearPhoto}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center shadow cursor-pointer"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={loading}
                      className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:border-primary/50 hover:bg-primary/5 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <Camera className="size-4" />
                      Selecionar foto
                    </button>
                  )}
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} disabled={loading} />
                </div>

                {/* Nome completo */}
                <div className="space-y-1.5">
                  <Label htmlFor="cm-nome">Nome completo *</Label>
                  <Input id="cm-nome" value={nomeCompleto} onChange={(e) => setNomeCompleto(e.target.value)} disabled={loading} autoFocus />
                </div>

                {/* Matrícula */}
                <div className="space-y-1.5">
                  <Label htmlFor="cm-matricula">Matrícula *</Label>
                  <Input id="cm-matricula" value={matricula} onChange={(e) => setMatricula(e.target.value)} disabled={loading} placeholder="Ex: 20250001" className="font-mono" />
                </div>

                {/* Nome de guerra */}
                <div className="space-y-1.5">
                  <Label htmlFor="cm-nome-guerra">Nome de guerra</Label>
                  <Input id="cm-nome-guerra" value={nomeDeGuerra} onChange={(e) => setNomeDeGuerra(e.target.value)} disabled={loading} placeholder="Ex: Silva, Rodrigues..." />
                </div>
              </div>

              {/* Right column */}
              <div className="space-y-4">
                {/* Posto */}
                <div className="space-y-1.5">
                  <Label htmlFor="cm-posto">Posto/Graduação</Label>
                  <div className="relative">
                    <select id="cm-posto" className={SELECT_CLASS} value={posto} onChange={(e) => setPosto(e.target.value)} disabled={loading}>
                      <option value="">Sem graduação</option>
                      {POSTOS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                    <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 9l6 6 6-6"/></svg>
                  </div>
                </div>

                {/* Unidade */}
                <div className="space-y-1.5">
                  <Label htmlFor="cm-unidade">Unidade</Label>
                  <Input id="cm-unidade" value={unidade} onChange={(e) => setUnidade(e.target.value)} disabled={loading} placeholder="1ª Cia, APMCB..." />
                </div>

                {/* Telefone */}
                <div className="space-y-1.5">
                  <Label htmlFor="cm-telefone">Telefone</Label>
                  <Input id="cm-telefone" value={telefone} onChange={(e) => setTelefone(e.target.value)} disabled={loading} placeholder="(83) 9 9999-9999" />
                </div>
              </div>
            </div>

            {/* Login invite */}
            <div className="rounded-2xl border-2 border-dashed border-border p-5 bg-muted/20 space-y-4">
              <label htmlFor="cm-invite" className="flex items-center gap-3 cursor-pointer group">
                <div
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors shrink-0
                    ${sendInvite ? "bg-primary border-primary" : "border-border group-hover:border-primary/50"}`}
                >
                  {sendInvite && (
                    <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <input id="cm-invite" type="checkbox" className="sr-only" checked={sendInvite}
                  onChange={(e) => setSendInvite(e.target.checked)}
                  disabled={loading} />
                <div className="flex items-center gap-2">
                  <Mail className="size-5 text-blue-500" />
                  <div>
                    <span className="text-sm font-semibold">Enviar convite de login agora</span>
                    <p className="text-xs text-muted-foreground">
                      Envia link ou senha para o militar acessar o sistema
                    </p>
                  </div>
                </div>
              </label>

              {sendInvite && (
                <div className="space-y-3 pt-1">
                  {/* Método */}
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setInviteMethod("magic_link")}
                      className={`flex items-center gap-2 rounded-xl border p-2.5 text-left transition-colors text-sm
                        ${inviteMethod === "magic_link" ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-muted-foreground"}`}>
                      <Mail className="size-3.5 shrink-0" />
                      <span className="text-xs font-semibold">Magic Link</span>
                    </button>
                    <button type="button" onClick={() => setInviteMethod("password")}
                      className={`flex items-center gap-2 rounded-xl border p-2.5 text-left transition-colors text-sm
                        ${inviteMethod === "password" ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-muted-foreground"}`}>
                      <KeyRound className="size-3.5 shrink-0" />
                      <span className="text-xs font-semibold">Senha</span>
                    </button>
                  </div>
                  {/* E-mail */}
                  <div className="space-y-1.5">
                    <Label htmlFor="cm-invite-email">E-mail do militar *</Label>
                    <Input id="cm-invite-email" type="email" value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      disabled={loading} placeholder="militar@pmpb.pb.gov.br" />
                  </div>
                  {/* Senha (modo password) */}
                  {inviteMethod === "password" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="cm-invite-password">Senha temporária *</Label>
                      <Input id="cm-invite-password" type="password" value={invitePassword}
                        onChange={(e) => setInvitePassword(e.target.value)}
                        disabled={loading} placeholder="Mínimo 6 caracteres" />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* TOTP Provisioning */}
            <div className="rounded-2xl border-2 border-dashed border-border p-5 bg-muted/20">
              <label htmlFor="cm-totp" className="flex items-center gap-3 cursor-pointer group">
                <div
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors shrink-0
                    ${provisionTotp ? "bg-primary border-primary" : "border-border group-hover:border-primary/50"}`}
                >
                  {provisionTotp && (
                    <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <input id="cm-totp" type="checkbox" className="sr-only" checked={provisionTotp}
                  onChange={(e) => setProvisionTotp(e.target.checked)}
                  disabled={loading} />
                <div className="flex items-center gap-2">
                  <Shield className="size-5 text-primary" />
                  <div>
                    <span className="text-sm font-semibold">
                      Provisionar código{" "}
                      <abbr title="TOTP — Código de Verificação Temporal: número de 6 dígitos que muda a cada 30 segundos, usado para confirmar a identidade do militar na retirada de material" className="cursor-help underline decoration-dotted">TOTP</abbr>
                      {" "}agora
                    </span>
                    <p className="text-xs text-muted-foreground">
                      Configura automaticamente o código de verificação para o militar
                    </p>
                  </div>
                </div>
              </label>
            </div>

            {/* Biometria — full width, prominent */}
            <div className="rounded-2xl border-2 border-dashed border-border p-5 space-y-4 bg-muted/20">
              <label htmlFor="cm-biometria" className="flex items-center gap-3 cursor-pointer group">
                <div
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors shrink-0
                    ${captureBio ? "bg-primary border-primary" : "border-border group-hover:border-primary/50"}`}
                >
                  {captureBio && (
                    <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <input id="cm-biometria" type="checkbox" className="sr-only" checked={captureBio}
                  onChange={(e) => { setCaptureBio(e.target.checked); if (!e.target.checked) setFingerIndex(null); }}
                  disabled={loading} />
                <div className="flex items-center gap-2">
                  <Fingerprint className="size-5 text-violet-500" />
                  <div>
                    <span className="text-sm font-semibold">Capturar biometria agora</span>
                    <p className="text-xs text-muted-foreground">
                      Selecione o dedo e capture a digital do militar no ato do cadastro
                    </p>
                  </div>
                </div>
              </label>

              {captureBio && (
                <div className="pt-2 space-y-3">
                  <p className="text-xs text-center text-muted-foreground font-medium">
                    Selecione o dedo para a captura inicial
                  </p>
                  <div className="flex justify-center overflow-x-auto py-1">
                    <FingerSelector value={fingerIndex} onChange={setFingerIndex} disabled={loading} />
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 pt-2">
              <Button variant="outline" onClick={handleClose} disabled={loading}>Cancelar</Button>
              <Button
                onClick={handleCadastrar}
                disabled={loading || !nomeCompleto.trim() || !matricula.trim() || (captureBio && fingerIndex === null)}
                size="lg"
              >
                {loading ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null}
                Cadastrar Militar
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
