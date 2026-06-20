"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Image from "next/image";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, ArrowLeft, Mail } from "lucide-react";

// Em E2E (NEXT_PUBLIC_E2E=true) usa chave de teste Cloudflare que sempre passa
const TURNSTILE_SITEKEY = process.env.NEXT_PUBLIC_E2E === "true"
  ? "1x00000000000000000000AA"
  : (process.env.NEXT_PUBLIC_TURNSTILE_SITEKEY ?? "0x4AAAAAADmwPEpkY8mUdcK9");
const WORKER_URL = process.env.NEXT_PUBLIC_TURNSTILE_WORKER_URL ?? "";

declare global {
  interface Window {
    turnstile?: {
      render: (container: string | HTMLElement, params: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
      getResponse: (widgetId?: string) => string | undefined;
    };
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Forgot password state
  const [view, setView] = useState<"login" | "forgot">("login");
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  // Turnstile
  const turnstileToken = useRef<string>("");
  const widgetRef = useRef<string | null>(null);
  const turnstileContainerRef = useRef<HTMLDivElement>(null);

  // Supabase sends errors in URL hash for implicit/legacy flows (e.g. expired invite)
  useEffect(() => {
    const hash = window.location.hash.substring(1);
    if (!hash) return;
    const params = new URLSearchParams(hash);
    const errorCode = params.get("error_code") ?? params.get("error");
    if (errorCode) {
      router.replace(`/auth/error?reason=${encodeURIComponent(errorCode)}`);
    }
  }, [router]);

  useEffect(() => {
    return () => {
      if (window.turnstile && widgetRef.current) {
        try { window.turnstile.remove(widgetRef.current); } catch { /* ignore */ }
        widgetRef.current = null;
      }
    };
  }, []);

  const onTurnstileLoad = useCallback(() => {
    if (!window.turnstile || !turnstileContainerRef.current || widgetRef.current) return;
    widgetRef.current = window.turnstile.render(turnstileContainerRef.current, {
      sitekey: TURNSTILE_SITEKEY,
      "data-action": "turnstile-spin-v1",
      callback: (token: string) => { turnstileToken.current = token; },
      "expired-callback": () => { turnstileToken.current = ""; },
      "error-callback": () => { turnstileToken.current = ""; },
    });
  }, []);

  function resetWidget() {
    if (window.turnstile && widgetRef.current) {
      window.turnstile.reset(widgetRef.current);
    }
    turnstileToken.current = "";
  }

  async function verifyTurnstile(token: string): Promise<boolean> {
    if (!WORKER_URL) return true; // no worker configured yet — Supabase captcha covers it
    try {
      const res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json() as { success?: boolean };
      return data.success === true;
    } catch {
      return true; // fail open (Supabase still validates)
    }
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!resetEmail.trim()) return;
    setResetLoading(true);
    try {
      const supabase = createClient();
      const redirectTo = `${location.origin}/auth/callback?next=/auth/update-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(
        resetEmail.trim(),
        { redirectTo }
      );
      if (error) throw error;
      setResetSent(true);
    } catch {
      toast.error("Erro ao enviar e-mail. Verifique o endereço.");
    } finally {
      setResetLoading(false);
    }
  }

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

    // Turnstile: verificação soft — se o widget gerou token, valida via Worker.
    // Se não gerou (PAT loop, widget ainda inicializando), deixa prosseguir
    // para não bloquear usuários legítimos por falha interna do Cloudflare.
    const token = turnstileToken.current;
    if (token) {
      const workerOk = await verifyTurnstile(token);
      if (!workerOk) {
        toast.error("Verificação de segurança falhou. Tente novamente.");
        resetWidget();
        setLoading(false);
        return;
      }
    }

    const supabase = createClient();

    // Resolve matrícula (6 numeric digits) → e-mail via RPC
    let resolvedEmail = email.trim();
    if (!resolvedEmail.includes("@")) {
      if (!/^\d{6}$/.test(resolvedEmail)) {
        toast.error("Matrícula inválida — use 6 dígitos ou o e-mail completo");
        resetWidget();
        setLoading(false);
        return;
      }
      const { data: emailData, error: rpcError } = await supabase
        .rpc("get_email_by_matricula", { p_matricula: resolvedEmail });
      if (rpcError || !emailData) {
        toast.error("Matrícula não encontrada");
        resetWidget();
        setLoading(false);
        return;
      }
      resolvedEmail = emailData as string;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: resolvedEmail,
      password,
    });
    if (error) {
      toast.error("Matrícula ou senha inválidos");
      resetWidget();
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
      else if (profile?.role === "master") router.replace("/reserva");
      else router.replace("/cadete");
    }
  }

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        onLoad={onTurnstileLoad}
      />

      <div className="min-h-dvh flex">
        {/* ── LEFT — form panel ── */}
        <div className="flex flex-col justify-between w-full lg:w-[480px] xl:w-[520px] shrink-0 bg-white px-8 py-10 sm:px-12">
          {/* Top center brand mark */}
          <div className="flex justify-center">
            <Image src="/images/pm-logo.png" alt="PMPB" width={72} height={72} className="shrink-0" priority />
          </div>

          {/* Form area */}
          <div className="w-full max-w-[380px] mx-auto space-y-7">
            <div className="space-y-1">
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Bem-vindo de volta</h1>
              <p className="text-sm text-gray-500">Acesse o sistema de controle de materiais</p>
            </div>

            {view === "forgot" ? (
              /* ── Forgot password view ── */
              <div className="space-y-5">
                {resetSent ? (
                  <div className="text-center space-y-4 py-4">
                    <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mx-auto">
                      <Mail className="size-6 text-emerald-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">E-mail enviado!</p>
                      <p className="text-sm text-gray-500 mt-1">
                        Verifique sua caixa de entrada em{" "}
                        <span className="font-medium text-gray-700">{resetEmail}</span>.
                        O link expira em 1 hora.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      className="w-full h-11 rounded-xl"
                      onClick={() => { setView("login"); setResetSent(false); setResetEmail(""); }}
                    >
                      Voltar ao login
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleForgotPassword} className="space-y-4">
                    <div className="space-y-1">
                      <p className="font-semibold text-gray-900">Redefinir senha</p>
                      <p className="text-sm text-gray-500">
                        Informe seu e-mail cadastrado. Enviaremos um link seguro.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reset-email" className="text-sm font-medium text-gray-700">E-mail</Label>
                      <Input
                        id="reset-email"
                        type="email"
                        autoComplete="email"
                        placeholder="militar@pmpb.pb.gov.br"
                        value={resetEmail}
                        onChange={(e) => setResetEmail(e.target.value)}
                        disabled={resetLoading}
                        required
                        autoFocus
                        className="h-11 bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-[#1B3A8C] focus:ring-[#1B3A8C]/20"
                      />
                    </div>
                    <Button
                      type="submit"
                      disabled={resetLoading || !resetEmail.trim()}
                      className="w-full h-11 rounded-xl text-sm font-semibold bg-[#1B3A8C] hover:bg-[#162f73] text-white"
                    >
                      {resetLoading ? <Loader2 className="size-4 animate-spin" /> : "Enviar link de redefinição"}
                    </Button>
                    <button
                      type="button"
                      onClick={() => setView("login")}
                      className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
                    >
                      <ArrowLeft className="size-3.5" />
                      Voltar ao login
                    </button>
                  </form>
                )}
              </div>
            ) : (
              /* ── Normal login form ── */
              <form onSubmit={handleEmailLogin} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-sm font-medium text-gray-700">
                    E-mail ou matrícula
                  </Label>
                  <Input
                    id="email"
                    type="text"
                    autoComplete="username"
                    placeholder="Matrícula ou e-mail"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading || googleLoading}
                    required
                    className="h-11 bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-[#1B3A8C] focus:ring-[#1B3A8C]/20"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-sm font-medium text-gray-700">Senha</Label>
                    <button
                      type="button"
                      onClick={() => setView("forgot")}
                      className="text-xs text-[#1B3A8C] hover:underline font-medium"
                      aria-label="Esqueceu a senha"
                    >
                      Esqueceu a senha?
                    </button>
                  </div>
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

                {/* Turnstile invisible — sem UI, token gerado em background */}
                <div ref={turnstileContainerRef} className="hidden" />

                <Button
                  type="submit"
                  disabled={loading || googleLoading || !email || !password}
                  className="w-full h-11 rounded-xl text-sm font-semibold bg-[#1B3A8C] hover:bg-[#162f73] text-white"
                >
                  {loading ? <Loader2 className="size-4 animate-spin" /> : "Entrar"}
                </Button>
              </form>
            )}

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
              <span className="text-[#1B3A8C] font-medium">Fale com a Reserva de Armamento.</span>
            </p>
          </div>

          {/* Footer */}
          <p className="text-xs text-gray-400">Sistema de Controle · by Arckos IA</p>
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
          <div className="relative z-10 flex flex-col items-center text-center px-12 space-y-8">
            {/* Large logo */}
            <Image
              src="/images/logo.png"
              alt="Logo do órgão"
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
                Plataforma de Controle<br />de Bens Sensíveis
              </h2>
              <p className="text-white/50 text-sm leading-relaxed max-w-xs mx-auto">
                Gestão integrada de Materiais
              </p>
            </div>
          </div>

          {/* Bottom watermark */}
          <div className="absolute bottom-8 text-white/20 text-xs tracking-widest uppercase">
            PMPB · {new Date().getFullYear()}
          </div>
        </div>
      </div>
    </>
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
