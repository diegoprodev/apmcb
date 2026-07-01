"use client";

import { useState, useEffect, useRef } from "react";
import { NexusShell } from "../_components/nexus-shell";
import { useNexusGuard } from "../_components/use-nexus-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Camera, QrCode, ShieldCheck } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf";
import { toast } from "sonner";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

interface Profile {
  id: string;
  nome_completo: string;
  matricula: string;
  posto: string | null;
  foto_url: string | null;
  role: string;
}

function getInitials(nome: string) {
  return nome.split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

export default function NexusPerfilPage() {
  const { ready } = useNexusGuard();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 2FA reconfiguração
  const [totpStep, setTotpStep] = useState<"idle" | "qr" | "confirm">("idle");
  const [qrUri, setQrUri] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [confirmingTotp, setConfirmingTotp] = useState(false);
  const [loadingQr, setLoadingQr] = useState(false);

  useEffect(() => {
    if (!ready) return;
    fetch(`${BFF_URL}/api/nexus/me`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.profile) setProfile(d.profile); })
      .catch(() => toast.error("Falha ao carregar perfil"))
      .finally(() => setLoading(false));
  }, [ready]);

  async function handlePhotoUpload(file: File) {
    if (file.size > 2 * 1024 * 1024) { toast.error("Foto maior que 2MB"); return; }
    setUploadingPhoto(true);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      const res = await fetch(`${BFF_URL}/api/profiles/me/photo`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders(),
        body: fd,
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setProfile((p) => p ? { ...p, foto_url: data.url } : p);
      toast.success("Foto atualizada");
    } catch {
      toast.error("Falha ao enviar foto");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function startTotpSetup() {
    setLoadingQr(true);
    try {
      const res = await fetch(`${BFF_URL}/api/nexus/setup-2fa`, { credentials: "include" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setQrUri(data.uri ?? data.qr_uri ?? null);
      setTotpStep("qr");
    } catch {
      toast.error("Falha ao gerar QR code");
    } finally {
      setLoadingQr(false);
    }
  }

  async function confirmTotp() {
    if (totpCode.length !== 6) { toast.error("Digite os 6 dígitos"); return; }
    setConfirmingTotp(true);
    try {
      const res = await fetch(`${BFF_URL}/api/nexus/setup-2fa/confirm`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ code: totpCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Código inválido");
      toast.success("Autenticador reconfigurado com sucesso");
      setTotpStep("idle");
      setTotpCode("");
      setQrUri(null);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao confirmar");
    } finally {
      setConfirmingTotp(false);
    }
  }

  if (!ready || loading) {
    return (
      <div className="min-h-dvh bg-[#0A0A0F] flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-indigo-400" />
      </div>
    );
  }

  return (
    <NexusShell>
      <div className="max-w-xl space-y-6">
        <div>
          <h1 className="text-lg font-bold text-white">Meu Perfil</h1>
          <p className="text-xs text-gray-500 mt-0.5">Dados e configurações do operador Nexus</p>
        </div>

        {/* Avatar */}
        <div className="bg-[#0D0D14] border border-[#1E1E2E] rounded-xl p-6">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-4">Foto</p>
          <div className="flex items-center gap-5">
            {profile?.foto_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.foto_url}
                alt="Avatar"
                className="size-20 rounded-full object-cover border-2 border-[#1E1E2E]"
              />
            ) : (
              <div className="size-20 rounded-full bg-indigo-600/20 border-2 border-indigo-500/30 flex items-center justify-center text-2xl font-bold text-indigo-300">
                {profile ? getInitials(profile.nome_completo) : "?"}
              </div>
            )}
            <div className="space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f); }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={uploadingPhoto}
                className="border-[#1E1E2E] text-gray-400 hover:text-white gap-1.5"
              >
                {uploadingPhoto ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
                {profile?.foto_url ? "Trocar foto" : "Enviar foto"}
              </Button>
              <p className="text-[10px] text-gray-600">PNG, JPG · máx. 2MB</p>
            </div>
          </div>
        </div>

        {/* Dados */}
        <div className="bg-[#0D0D14] border border-[#1E1E2E] rounded-xl p-6 space-y-4">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Dados</p>
          <div className="space-y-1.5">
            <Label className="text-gray-300 text-sm">Nome completo</Label>
            <Input
              value={profile?.nome_completo ?? ""}
              readOnly
              className="bg-[#0A0A0F] border-[#1E1E2E] text-white/60 cursor-default"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-sm">Matrícula</Label>
              <Input
                value={profile?.matricula ?? ""}
                readOnly
                className="bg-[#0A0A0F] border-[#1E1E2E] text-white/60 font-mono cursor-default"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-sm">Papel</Label>
              <Input
                value="Superadmin"
                readOnly
                className="bg-[#0A0A0F] border-[#1E1E2E] text-purple-400 cursor-default"
              />
            </div>
          </div>
          <p className="text-[10px] text-gray-600">Para alterar dados cadastrais, contate o suporte Nexus.</p>
        </div>

        {/* 2FA */}
        <div className="bg-[#0D0D14] border border-[#1E1E2E] rounded-xl p-6 space-y-4">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Autenticação de 2 Fatores</p>

          {totpStep === "idle" && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="size-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <ShieldCheck className="size-4 text-emerald-400" />
                </div>
                <div>
                  <p className="text-sm text-white font-medium">TOTP ativo</p>
                  <p className="text-xs text-gray-500">Google Authenticator ou similar</p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={startTotpSetup}
                disabled={loadingQr}
                className="border-[#1E1E2E] text-gray-400 hover:text-white gap-1.5"
              >
                {loadingQr ? <Loader2 className="size-3.5 animate-spin" /> : <QrCode className="size-3.5" />}
                Reconfigurar
              </Button>
            </div>
          )}

          {totpStep === "qr" && qrUri && (
            <div className="space-y-4">
              <p className="text-sm text-gray-300">
                Escaneie o QR code no seu autenticador e confirme com o código gerado:
              </p>
              <div className="flex justify-center bg-white rounded-xl p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrUri)}`}
                  alt="QR Code 2FA"
                  className="size-48"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-gray-300 text-sm">Código do autenticador</Label>
                <Input
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  className="bg-[#0A0A0F] border-[#1E1E2E] text-white font-mono text-lg tracking-widest text-center"
                  autoFocus
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => { setTotpStep("idle"); setTotpCode(""); setQrUri(null); }}
                  className="flex-1 border-[#1E1E2E] text-gray-400 hover:text-white"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={confirmTotp}
                  disabled={confirmingTotp || totpCode.length !== 6}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  {confirmingTotp ? <Loader2 className="size-4 animate-spin" /> : "Confirmar"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </NexusShell>
  );
}
