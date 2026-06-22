"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { csrfHeaders } from "@/lib/csrf";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, Shield, Eye, EyeOff } from "lucide-react";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

type Step = "credentials" | "totp";

export default function NexusLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [totpToken, setTotpToken] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        toast.error("Credenciais inválidas");
        return;
      }

      // Ensure role is admin via BFF login (sets iron-session)
      const res = await fetch(`${BFF_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro no login");
        return;
      }
      if (data.user?.role !== "admin_global" && data.user?.role !== "superadmin") {
        toast.error("Acesso restrito a administradores");
        await supabase.auth.signOut();
        return;
      }

      setStep("totp");
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setLoading(false);
    }
  }

  async function handleTotp(e: React.FormEvent) {
    e.preventDefault();
    if (totpToken.length !== 6) return;
    setLoading(true);
    try {
      const res = await fetch(`${BFF_URL}/api/totp/self-validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        credentials: "include",
        body: JSON.stringify({ token: totpToken }),
      });
      const data = await res.json();

      if (res.status === 404) {
        toast.error("TOTP não configurado. Configure em /admin primeiro.", { duration: 5000 });
        return;
      }
      if (res.status === 429) {
        toast.error(`Bloqueado. Aguarde ${data.retry_after_seconds}s`);
        return;
      }
      if (!res.ok || !data.valid) {
        toast.error("Código inválido");
        setTotpToken("");
        return;
      }

      router.replace("/nexus");
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-[#0A0A0F] px-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Image src="/images/logo.png" alt="APMCB" width={32} height={32} className="shrink-0" priority />
          <span className="text-sm font-semibold text-white tracking-wide">APMCB</span>
          <span className="ml-auto text-xs text-indigo-400 font-mono">NEXUS</span>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-6">
          <span className={`w-2 h-2 rounded-full ${step === "credentials" ? "bg-indigo-500" : "bg-indigo-800"}`} />
          <span className={`w-2 h-2 rounded-full ${step === "totp" ? "bg-indigo-500" : "bg-[#1E1E2E]"}`} />
        </div>

        <div className="bg-[#12121A] rounded-2xl border border-[#1E1E2E] p-8 shadow-2xl">
          {step === "credentials" ? (
            <>
              <div className="flex items-center gap-2 mb-6">
                <Shield className="size-5 text-indigo-400" />
                <h1 className="text-base font-semibold text-white">Acesso ao Nexus</h1>
              </div>
              <form onSubmit={handleCredentials} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-400">E-mail</label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@apmcb.mil.br"
                    required
                    autoFocus
                    className="bg-[#0A0A0F] border-[#1E1E2E] text-white placeholder:text-gray-600 focus:border-indigo-500 focus:ring-indigo-500/20"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-400">Senha</label>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      className="bg-[#0A0A0F] border-[#1E1E2E] text-white placeholder:text-gray-600 focus:border-indigo-500 focus:ring-indigo-500/20 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
                <Button
                  type="submit"
                  disabled={loading || !email || !password}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold h-11 mt-2"
                >
                  {loading ? <Loader2 className="size-4 animate-spin" /> : "Continuar"}
                </Button>
              </form>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-2">
                <Shield className="size-5 text-indigo-400" />
                <h1 className="text-base font-semibold text-white">Verificação 2FA</h1>
              </div>
              <p className="text-xs text-gray-500 mb-6">
                Abra o Google Authenticator e insira o código de 6 dígitos.
              </p>
              <form onSubmit={handleTotp} className="space-y-4">
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={totpToken}
                  onChange={(e) => setTotpToken(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  autoFocus
                  className="bg-[#0A0A0F] border-[#1E1E2E] text-white text-center text-2xl tracking-[0.5em] font-mono placeholder:text-gray-700 focus:border-indigo-500 focus:ring-indigo-500/20 h-14"
                />
                <Button
                  type="submit"
                  disabled={loading || totpToken.length !== 6}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold h-11"
                >
                  {loading ? <Loader2 className="size-4 animate-spin" /> : "Entrar no Nexus"}
                </Button>
                <button
                  type="button"
                  onClick={() => { setStep("credentials"); setTotpToken(""); }}
                  className="w-full text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  ← Voltar
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-xs text-center text-gray-600 mt-6">
          APMCB Control System · Nexus Admin Panel
        </p>
      </div>
    </div>
  );
}
