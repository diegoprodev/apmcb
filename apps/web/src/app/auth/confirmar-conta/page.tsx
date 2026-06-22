"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Loader2,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Eye,
  EyeOff,
  Lock,
} from "lucide-react";

type PageState = "loading" | "form" | "success" | "error";

function passwordStrength(pwd: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;

  if (score <= 1) return { score, label: "Muito fraca", color: "bg-red-500" };
  if (score === 2) return { score, label: "Fraca", color: "bg-orange-400" };
  if (score === 3) return { score, label: "Razoável", color: "bg-yellow-400" };
  if (score === 4) return { score, label: "Forte", color: "bg-emerald-400" };
  return { score, label: "Muito forte", color: "bg-emerald-600" };
}

interface UserInfo {
  nomeCompleto: string;
  email: string;
  role: string;
}

export default function ConfirmarContaPage() {
  const router = useRouter();
  const [state, setState] = useState<PageState>("loading");
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        setState("error");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("nome_completo, role, email")
        .eq("id", session.user.id)
        .single();

      setUserInfo({
        nomeCompleto: profile?.nome_completo ?? session.user.user_metadata?.nome_completo ?? "Usuário",
        email: profile?.email ?? session.user.email ?? "",
        role: profile?.role ?? "usuario",
      });
      setState("form");
    });
  }, []);

  const strength = passwordStrength(password);
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = password.length >= 8 && password === confirm && strength.score >= 2;

  async function handleActivate(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);

    try {
      const supabase = createClient();

      // Set the user's password for the first time
      const { error: pwdError } = await supabase.auth.updateUser({ password });
      if (pwdError) throw pwdError;

      // Mark account as activated via server API
      await fetch("/api/auth/activate-account", { method: "POST" }).catch(() => {});

      setState("success");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao ativar conta");
    } finally {
      setLoading(false);
    }
  }

  function handleGoToDashboard() {
    if (!userInfo) { router.replace("/login"); return; }
    if (userInfo.role === "admin_global" || userInfo.role === "superadmin") router.replace("/admin");
    else if (userInfo.role === "armeiro" || userInfo.role === "admin_reserva") router.replace("/reserva");
    else router.replace("/cadete");
  }

  const firstName = userInfo?.nomeCompleto.split(" ")[0] ?? "";

  return (
    <div className="min-h-dvh flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-[440px]">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Image src="/images/logo.png" alt="APMCB" width={32} height={32} className="shrink-0" priority />
          <span className="text-sm font-semibold text-gray-800 tracking-wide">APMCB</span>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
          {/* Loading */}
          {state === "loading" && (
            <div className="flex flex-col items-center gap-3 py-10">
              <Loader2 className="size-7 animate-spin text-[#1B3A8C]" />
              <p className="text-sm text-gray-500">Verificando convite...</p>
            </div>
          )}

          {/* Error */}
          {state === "error" && (
            <div className="flex flex-col items-center gap-4 text-center py-4">
              <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center">
                <AlertTriangle className="size-6 text-red-500" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">Link inválido ou expirado</p>
                <p className="text-sm text-gray-500 mt-1">
                  O link de ativação expirou ou já foi utilizado.
                  Solicite um novo convite ao administrador do sistema.
                </p>
              </div>
              <Button
                onClick={() => router.replace("/login")}
                className="w-full h-11 rounded-xl text-sm font-semibold bg-[#1B3A8C] hover:bg-[#162f73] text-white"
              >
                Ir para o login
              </Button>
            </div>
          )}

          {/* Success */}
          {state === "success" && (
            <div className="flex flex-col items-center gap-4 text-center py-4">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="size-6 text-emerald-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">Conta ativada!</p>
                <p className="text-sm text-gray-500 mt-1">
                  Sua conta foi configurada com sucesso. Bem-vindo ao sistema APMCB.
                </p>
              </div>
              <Button
                onClick={handleGoToDashboard}
                className="w-full h-11 rounded-xl text-sm font-semibold bg-[#1B3A8C] hover:bg-[#162f73] text-white"
              >
                Acessar o sistema
              </Button>
            </div>
          )}

          {/* Form */}
          {state === "form" && (
            <form onSubmit={handleActivate} className="space-y-5">
              {/* Welcome header */}
              <div className="flex items-start gap-3 mb-1">
                <div className="w-11 h-11 rounded-xl bg-[#1B3A8C]/10 flex items-center justify-center shrink-0 mt-0.5">
                  <ShieldCheck className="size-5 text-[#1B3A8C]" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">
                    Bem-vindo{firstName ? `, ${firstName}` : ""}!
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Defina uma senha para ativar seu acesso ao APMCB
                  </p>
                </div>
              </div>

              {/* Email display */}
              {userInfo?.email && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100">
                  <Lock className="size-3.5 text-gray-400 shrink-0" />
                  <span className="text-xs text-gray-500 truncate">{userInfo.email}</span>
                </div>
              )}

              {/* Password field */}
              <div className="space-y-1.5">
                <Label htmlFor="new-password" className="text-sm font-medium text-gray-700">
                  Senha
                </Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Mínimo 8 caracteres"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    required
                    autoFocus
                    className="h-11 pr-10 bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-[#1B3A8C] focus:ring-[#1B3A8C]/20"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>

                {/* Strength meter */}
                {password.length > 0 && (
                  <div className="space-y-1">
                    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${strength.color}`}
                        style={{ width: `${(strength.score / 5) * 100}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-500">
                      Força: <span className="font-medium">{strength.label}</span>
                    </p>
                  </div>
                )}
              </div>

              {/* Confirm password */}
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password" className="text-sm font-medium text-gray-700">
                  Confirmar senha
                </Label>
                <div className="relative">
                  <Input
                    id="confirm-password"
                    type={showConfirm ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Repita a senha"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    disabled={loading}
                    required
                    className={`h-11 pr-10 bg-gray-50 text-gray-900 placeholder:text-gray-400 focus:ring-[#1B3A8C]/20 transition-colors ${
                      mismatch
                        ? "border-red-400 focus:border-red-400"
                        : "border-gray-200 focus:border-[#1B3A8C]"
                    }`}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    aria-label={showConfirm ? "Ocultar confirmação" : "Mostrar confirmação"}
                  >
                    {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {mismatch && (
                  <p className="text-xs text-red-500">As senhas não coincidem</p>
                )}
              </div>

              {/* Requirements checklist */}
              <ul className="text-xs space-y-1 pl-1">
                <li className={`flex items-center gap-1.5 ${password.length >= 8 ? "text-emerald-600" : "text-gray-400"}`}>
                  <span className="text-[10px] font-bold">{password.length >= 8 ? "✓" : "○"}</span>
                  Mínimo 8 caracteres
                </li>
                <li className={`flex items-center gap-1.5 ${/[A-Z]/.test(password) ? "text-emerald-600" : "text-gray-400"}`}>
                  <span className="text-[10px] font-bold">{/[A-Z]/.test(password) ? "✓" : "○"}</span>
                  Pelo menos 1 letra maiúscula
                </li>
                <li className={`flex items-center gap-1.5 ${/[0-9]/.test(password) ? "text-emerald-600" : "text-gray-400"}`}>
                  <span className="text-[10px] font-bold">{/[0-9]/.test(password) ? "✓" : "○"}</span>
                  Pelo menos 1 número
                </li>
              </ul>

              <Button
                type="submit"
                disabled={loading || !canSubmit}
                className="w-full h-11 rounded-xl text-sm font-semibold bg-[#1B3A8C] hover:bg-[#162f73] text-white transition-colors"
              >
                {loading ? <Loader2 className="size-4 animate-spin" /> : "Ativar minha conta"}
              </Button>

              <p className="text-[11px] text-center text-gray-400 leading-snug">
                Mantenha sua senha em sigilo. Não compartilhe com ninguém,
                inclusive com a administração do sistema.
              </p>
            </form>
          )}
        </div>

        <p className="text-xs text-center text-gray-400 mt-6">
          APMCB Control System · by Arckos IA
        </p>
      </div>
    </div>
  );
}
