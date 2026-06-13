"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, Shield, Package, Users } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function handleGoogleLogin() {
    setGoogleLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
    if (error) {
      toast.error("Falha ao conectar com Google");
      setGoogleLoading(false);
    }
  }

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.includes("@") ? email : `${email}@apmcb.pb.gov.br`,
      password,
    });
    if (error) {
      toast.error("Matrícula ou senha inválidos");
      setLoading(false);
      return;
    }
    if (data.user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, registration_status")
        .eq("id", data.user.id)
        .single();
      if (profile?.role === "admin") router.replace("/admin");
      else if (profile?.role === "master") router.replace("/armeiro");
      else if (profile?.registration_status === "complete") router.replace("/cadete");
      else router.replace("/registro-pendente");
    }
  }

  return (
    <div className="min-h-dvh flex">
      {/* ── LEFT — form panel ── */}
      <div className="flex flex-col justify-between w-full lg:w-[480px] xl:w-[520px] shrink-0 bg-white px-8 py-10 sm:px-12">
        {/* Top brand mark */}
        <div className="flex items-center gap-3">
          <Image src="/images/logo.png" alt="APMCB" width={32} height={32} className="shrink-0" priority />
          <span className="text-sm font-semibold text-gray-800 tracking-wide">APMCB</span>
        </div>

        {/* Form area */}
        <div className="w-full max-w-[380px] mx-auto space-y-7">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Bem-vindo de volta</h1>
            <p className="text-sm text-gray-500">Acesse o sistema de controle de materiais</p>
          </div>

          <form onSubmit={handleEmailLogin} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium text-gray-700">
                E-mail ou matrícula
              </Label>
              <Input
                id="email"
                type="text"
                autoComplete="username"
                placeholder="militar@apmcb.pb.gov.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading || googleLoading}
                required
                className="h-11 bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-[#1B3A8C] focus:ring-[#1B3A8C]/20"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-medium text-gray-700">
                Senha
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading || googleLoading}
                required
                className="h-11 bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-[#1B3A8C] focus:ring-[#1B3A8C]/20"
              />
            </div>

            <Button
              type="submit"
              disabled={loading || googleLoading || !email || !password}
              className="w-full h-11 rounded-xl text-sm font-semibold bg-[#1B3A8C] hover:bg-[#162f73] text-white"
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : "Entrar"}
            </Button>
          </form>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400 uppercase tracking-widest">ou</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={googleLoading || loading}
            className="w-full h-11 flex items-center justify-center gap-3 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 transition-all hover:bg-gray-50 hover:border-gray-300 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {googleLoading ? <Loader2 className="size-4 animate-spin" /> : <GoogleIcon />}
            Continuar com Google
          </button>

          <p className="text-xs text-center text-gray-400">
            Acesso restrito a militares da PMPB credenciados.{" "}
            <span className="text-[#1B3A8C] font-medium">Fale com o armeiro.</span>
          </p>
        </div>

        {/* Footer */}
        <p className="text-xs text-gray-400">APMCB Control System v0.1 · by Arckos IA v1.02</p>
      </div>

      {/* ── RIGHT — brand panel (hidden on mobile) ── */}
      <div
        className="hidden lg:flex flex-1 flex-col items-center justify-center relative overflow-hidden"
        style={{ background: "linear-gradient(145deg, #0f2460 0%, #1B3A8C 50%, #1e4db7 100%)" }}
      >
        {/* Subtle grid texture */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center text-center px-12 space-y-10">
          {/* Large logo — sem moldura */}
          <Image
            src="/images/logo.png"
            alt="APMCB"
            width={192}
            height={192}
            className="drop-shadow-2xl"
            priority
          />

          {/* Institution name */}
          <div className="space-y-3">
            <p className="text-white/60 text-xs font-semibold tracking-[0.25em] uppercase">
              Sistema de Controle
            </p>
            <h2 className="text-white text-3xl font-bold tracking-tight leading-tight">
              Academia de Polícia<br />Militar do Cabo Branco
            </h2>
            <p className="text-white/50 text-sm leading-relaxed max-w-xs mx-auto">
              Gestão integrada de materiais, empréstimos e identificação biométrica.
            </p>
          </div>

          {/* Feature badges */}
          <div className="flex flex-col gap-3 w-full max-w-xs">
            <FeatureBadge icon={<Shield className="size-4" />} label="Acesso biométrico ZKTeco" />
            <FeatureBadge icon={<Package className="size-4" />} label="Controle de materiais em tempo real" />
            <FeatureBadge icon={<Users className="size-4" />} label="Gestão de ~500 militares" />
          </div>
        </div>

        {/* Bottom watermark */}
        <div className="absolute bottom-8 text-white/20 text-xs tracking-widest uppercase">
          PMPB · APMCB · {new Date().getFullYear()}
        </div>
      </div>
    </div>
  );
}

function FeatureBadge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-3 bg-white/10 backdrop-blur-sm rounded-xl px-4 py-3 text-left">
      <span className="text-white/70 shrink-0">{icon}</span>
      <span className="text-white/80 text-sm font-medium">{label}</span>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}
