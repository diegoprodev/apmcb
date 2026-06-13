"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

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
      options: {
        redirectTo: `${location.origin}/auth/callback`,
      },
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
    <div className="min-h-dvh flex flex-col items-center justify-center bg-background px-4">
      {/* Card */}
      <div
        className="w-full max-w-[400px] bg-card rounded-2xl p-8 space-y-6"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        {/* Logo + heading */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-16 h-16 rounded-2xl overflow-hidden flex-shrink-0" style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.12)" }}>
            <Image
              src="/images/logo.png"
              alt="APMCB"
              width={64}
              height={64}
              className="w-full h-full object-cover"
              priority
            />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              APMCB
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Academia de Polícia Militar do Cabo Branco
            </p>
          </div>
        </div>

        {/* Google OAuth */}
        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={googleLoading || loading}
          className="w-full h-11 flex items-center justify-center gap-3 rounded-xl border border-border bg-background text-sm font-medium text-foreground transition-all hover:bg-muted active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {googleLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <GoogleIcon />
          )}
          Continuar com Google
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground">ou</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Email / matrícula form */}
        <form onSubmit={handleEmailLogin} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-sm font-medium">
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
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-sm font-medium">
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
            />
          </div>

          <Button
            type="submit"
            disabled={loading || googleLoading || !email || !password}
            className="w-full h-11 rounded-xl text-sm font-semibold"
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Entrar"
            )}
          </Button>
        </form>

        {/* Footer note */}
        <p className="text-xs text-center text-muted-foreground">
          Acesso restrito a militares da PMBA credenciados.{" "}
          <span className="text-primary">
            Fale com o armeiro para cadastro.
          </span>
        </p>
      </div>

      {/* Version stamp */}
      <p className="mt-6 text-xs text-muted-foreground/50">
        APMCB Control System v0.1
      </p>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}
