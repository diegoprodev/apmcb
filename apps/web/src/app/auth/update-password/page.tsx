"use client";

/**
 * /auth/update-password
 *
 * Accessed after clicking a password-reset magic link. The Supabase PKCE
 * callback at /auth/callback exchanges the code and sets a recovery session,
 * then redirects here. The user defines a new password and is signed out.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, KeyRound, CheckCircle2, AlertTriangle } from "lucide-react";

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

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [state, setState] = useState<PageState>("loading");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  // Verify there's an active recovery session
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setState("form");
      } else {
        setState("error");
      }
    });
  }, []);

  const strength = passwordStrength(password);
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = password.length >= 8 && password === confirm && strength.score >= 2;

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      // Sign out immediately — force fresh login with new credentials
      await supabase.auth.signOut();
      setState("success");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar senha");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-[420px]">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Image src="/images/logo.png" alt="APMCB" width={32} height={32} className="shrink-0" priority />
          <span className="text-sm font-semibold text-gray-800 tracking-wide">APMCB</span>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
          {state === "loading" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="size-7 animate-spin text-[#1B3A8C]" />
              <p className="text-sm text-gray-500">Verificando sessão...</p>
            </div>
          )}

          {state === "error" && (
            <div className="flex flex-col items-center gap-4 text-center py-4">
              <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center">
                <AlertTriangle className="size-6 text-red-500" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">Link inválido ou expirado</p>
                <p className="text-sm text-gray-500 mt-1">
                  O link de redefinição expirou ou já foi utilizado.
                  Solicite um novo link na tela de login.
                </p>
              </div>
              <Button
                onClick={() => router.replace("/login")}
                className="w-full h-11 rounded-xl text-sm font-semibold bg-[#1B3A8C] hover:bg-[#162f73] text-white"
              >
                Voltar ao login
              </Button>
            </div>
          )}

          {state === "success" && (
            <div className="flex flex-col items-center gap-4 text-center py-4">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="size-6 text-emerald-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">Senha atualizada!</p>
                <p className="text-sm text-gray-500 mt-1">
                  Sua senha foi redefinida com sucesso. Faça login com as novas credenciais.
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

          {state === "form" && (
            <form onSubmit={handleUpdate} className="space-y-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-[#1B3A8C]/10 flex items-center justify-center">
                  <KeyRound className="size-5 text-[#1B3A8C]" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Nova senha</p>
                  <p className="text-xs text-gray-500">Defina uma senha forte para sua conta</p>
                </div>
              </div>

              {/* New password */}
              <div className="space-y-1.5">
                <Label htmlFor="new-password" className="text-sm font-medium text-gray-700">
                  Nova senha
                </Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Mínimo 8 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  required
                  autoFocus
                  className="h-11 bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-[#1B3A8C] focus:ring-[#1B3A8C]/20"
                />
                {/* Strength meter */}
                {password.length > 0 && (
                  <div className="space-y-1">
                    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${strength.color}`}
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
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Repita a senha"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={loading}
                  required
                  className={`h-11 bg-gray-50 text-gray-900 placeholder:text-gray-400 focus:border-[#1B3A8C] focus:ring-[#1B3A8C]/20 transition-colors ${
                    mismatch ? "border-red-400 focus:border-red-400" : "border-gray-200"
                  }`}
                />
                {mismatch && (
                  <p className="text-xs text-red-500">As senhas não coincidem</p>
                )}
              </div>

              {/* Requirements */}
              <ul className="text-xs text-gray-400 space-y-0.5 pl-1">
                <li className={password.length >= 8 ? "text-emerald-600" : ""}>
                  {password.length >= 8 ? "✓" : "·"} Mínimo 8 caracteres
                </li>
                <li className={/[A-Z]/.test(password) ? "text-emerald-600" : ""}>
                  {/[A-Z]/.test(password) ? "✓" : "·"} Pelo menos 1 letra maiúscula
                </li>
                <li className={/[0-9]/.test(password) ? "text-emerald-600" : ""}>
                  {/[0-9]/.test(password) ? "✓" : "·"} Pelo menos 1 número
                </li>
              </ul>

              <Button
                type="submit"
                disabled={loading || !canSubmit}
                className="w-full h-11 rounded-xl text-sm font-semibold bg-[#1B3A8C] hover:bg-[#162f73] text-white"
              >
                {loading ? <Loader2 className="size-4 animate-spin" /> : "Definir nova senha"}
              </Button>
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
