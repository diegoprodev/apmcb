"use client";

import { useState, useEffect } from "react";
import { NexusSidebar } from "../_components/nexus-sidebar";
import { useNexusGuard } from "../_components/use-nexus-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Shield, CheckCircle2, Copy, RefreshCw } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf";
import { toast } from "sonner";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

interface SetupData {
  qrUrl: string;
  secret: string;
  otpauthUrl: string;
}

export default function Setup2FAPage() {
  const { ready } = useNexusGuard();
  const [setupData, setSetupData] = useState<SetupData | null>(null);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  async function loadSetup() {
    setLoading(true);
    setToken("");
    try {
      const res = await fetch(`${BFF_URL}/api/nexus/setup-2fa`, {
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Falha ao iniciar setup");
        return;
      }
      const data = await res.json();
      setSetupData(data);
    } catch {
      toast.error("Erro de rede");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (ready) loadSetup();
  }, [ready]);

  async function confirmToken() {
    if (token.length !== 6 || !/^\d+$/.test(token)) {
      toast.error("Token deve ter 6 dígitos");
      return;
    }
    setConfirming(true);
    try {
      const res = await fetch(`${BFF_URL}/api/nexus/setup-2fa/confirm`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Token inválido");
        return;
      }
      toast.success("2FA configurado com sucesso!");
      setDone(true);
    } catch {
      toast.error("Erro ao confirmar token");
    } finally {
      setConfirming(false);
    }
  }

  function copySecret() {
    if (!setupData?.secret) return;
    navigator.clipboard.writeText(setupData.secret);
    toast.success("Chave copiada");
  }

  if (!ready) {
    return (
      <div className="min-h-dvh bg-[#0A0A0F] flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-indigo-400" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <NexusSidebar />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-md mx-auto space-y-6">
          <div>
            <h1 className="text-lg font-bold text-white flex items-center gap-2">
              <Shield className="size-5 text-indigo-400" />
              Setup Google Authenticator
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">Configure o 2FA para acesso ao painel Nexus</p>
          </div>

          {done ? (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center space-y-4">
              <CheckCircle2 className="size-12 text-emerald-400 mx-auto" />
              <div>
                <p className="text-white font-semibold text-lg">2FA Configurado!</p>
                <p className="text-gray-400 text-sm mt-1">
                  O Google Authenticator está vinculado à sua conta. Use o código de 6 dígitos no próximo login do Nexus.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setDone(false); setSetupData(null); loadSetup(); }}
                className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 gap-1.5"
              >
                <RefreshCw className="size-3.5" />
                Reconfigurar
              </Button>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Step 1: QR Code */}
              <div className="rounded-xl border border-[#1E1E2E] bg-[#0D0D14] p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-full bg-indigo-600 flex items-center justify-center shrink-0">
                    <span className="text-white text-xs font-bold">1</span>
                  </div>
                  <p className="text-white text-sm font-medium">Escaneie o QR Code</p>
                </div>
                <p className="text-gray-400 text-xs">
                  Abra o <strong className="text-gray-300">Google Authenticator</strong> e escaneie o código abaixo.
                </p>

                {loading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="size-6 animate-spin text-indigo-400" />
                  </div>
                ) : setupData ? (
                  <div className="flex flex-col items-center gap-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={setupData.qrUrl}
                      alt="QR Code 2FA"
                      className="h-48 w-48 rounded-xl border border-[#2A2A3E] p-2 bg-white"
                    />
                    <div className="w-full">
                      <p className="text-xs text-gray-500 mb-1.5">Ou insira a chave manualmente:</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs font-mono text-indigo-300 bg-[#0A0A0F] border border-[#1E1E2E] rounded-lg px-3 py-2 break-all">
                          {setupData.secret}
                        </code>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={copySecret}
                          className="text-gray-500 hover:text-gray-300 h-9 w-9 p-0"
                        >
                          <Copy className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={loadSetup}
                      className="text-gray-500 hover:text-gray-300 text-xs gap-1.5"
                    >
                      <RefreshCw className="size-3.5" />
                      Gerar novo QR Code
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" onClick={loadSetup} className="w-full bg-indigo-600 hover:bg-indigo-700">
                    Gerar QR Code
                  </Button>
                )}
              </div>

              {/* Step 2: Confirm */}
              {setupData && (
                <div className="rounded-xl border border-[#1E1E2E] bg-[#0D0D14] p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-indigo-600 flex items-center justify-center shrink-0">
                      <span className="text-white text-xs font-bold">2</span>
                    </div>
                    <p className="text-white text-sm font-medium">Confirme o código</p>
                  </div>
                  <p className="text-gray-400 text-xs">
                    Insira o código de 6 dígitos gerado pelo app para confirmar a vinculação.
                  </p>
                  <div className="space-y-2">
                    <Label className="text-gray-300 text-sm">Código TOTP</Label>
                    <Input
                      value={token}
                      onChange={(e) => setToken(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="000000"
                      maxLength={6}
                      className="bg-[#0A0A0F] border-[#1E1E2E] text-white font-mono text-lg tracking-[0.3em] text-center h-12"
                      onKeyDown={(e) => e.key === "Enter" && confirmToken()}
                    />
                  </div>
                  <Button
                    onClick={confirmToken}
                    disabled={confirming || token.length !== 6}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
                  >
                    {confirming ? <Loader2 className="size-4 animate-spin" /> : "Confirmar e ativar 2FA"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
