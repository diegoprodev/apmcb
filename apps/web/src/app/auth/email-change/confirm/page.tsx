"use client";

import { useEffect, useState, Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, MailCheck, MailX, ShieldCheck } from "lucide-react";
import { bffFetch } from "@/lib/bff-client";

// Página pública (spec docs/enterprise/specs/troca-email-acesso-enterprise.md
// §5.2/§9.2) — o link do e-mail aponta pra AQUI, nunca direto pro BFF (mesmo
// motivo de /auth/callback: BFF só fala JSON, UI é sempre apps/web). GET
// (validate) só lê o estado da pendência; a troca de verdade só acontece no
// POST (confirm), disparado pelo clique real no botão abaixo — nunca
// automaticamente, pra não ser confirmada por um scanner de e-mail que
// pré-busca o link antes do usuário abrir a mensagem.
type ValidateState =
  | { status: "loading" }
  | { status: "invalid"; reason: string }
  | { status: "ready"; newEmail: string }
  | { status: "confirming" }
  | { status: "confirmed" }
  | { status: "confirm_failed"; message: string };

const REASON_MESSAGES: Record<string, string> = {
  invalid: "Este link de confirmação é inválido.",
  already_confirmed: "Este link já foi usado — o e-mail já foi confirmado anteriormente.",
  expired: "Este link expirou. Peça ao administrador para enviar uma nova solicitação.",
};

function EmailChangeConfirmContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [state, setState] = useState<ValidateState>({ status: "loading" });

  useEffect(() => {
    if (!token) {
      setState({ status: "invalid", reason: "invalid" });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await bffFetch("GET", `/api/auth/email-change/validate?token=${encodeURIComponent(token)}`);
        if (cancelled) return;
        const data = res.data as { valid: boolean; new_email?: string; reason?: string };
        if (!res.ok || !data.valid) {
          setState({ status: "invalid", reason: data.reason ?? "invalid" });
          return;
        }
        setState({ status: "ready", newEmail: data.new_email ?? "" });
      } catch {
        if (!cancelled) setState({ status: "invalid", reason: "invalid" });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  async function handleConfirm() {
    setState({ status: "confirming" });
    try {
      const res = await bffFetch("POST", "/api/auth/email-change/confirm", { token });
      if (!res.ok) {
        setState({ status: "confirm_failed", message: (res.data as { error?: string })?.error ?? "Não foi possível confirmar agora. Tente novamente." });
        return;
      }
      setState({ status: "confirmed" });
      setTimeout(() => router.push("/login?email_changed=1"), 2500);
    } catch {
      setState({ status: "confirm_failed", message: "Erro de conexão. Tente novamente." });
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-100">
        <div className="flex items-center gap-3 mb-8">
          <Image src="/images/andromeda-logo.webp" alt="Andrômeda" width={32} height={32} className="shrink-0" priority />
          <span className="text-sm font-semibold text-gray-800 tracking-wide">Andrômeda</span>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
          <div className="flex flex-col items-center gap-4 text-center">
            {state.status === "loading" && (
              <>
                <Loader2 className="size-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-gray-500">Verificando link...</p>
              </>
            )}

            {state.status === "invalid" && (
              <>
                <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center">
                  <MailX className="size-6 text-red-500" />
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-gray-900">Link inválido</p>
                  <p className="text-sm text-gray-500 leading-relaxed">
                    {REASON_MESSAGES[state.reason] ?? REASON_MESSAGES.invalid}
                  </p>
                </div>
              </>
            )}

            {(state.status === "ready" || state.status === "confirming") && (
              <>
                <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center">
                  <MailCheck className="size-6 text-blue-500" />
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-gray-900">Confirmar troca de e-mail?</p>
                  <p className="text-sm text-gray-500 leading-relaxed">
                    Seu e-mail de acesso ao Andrômeda vai passar a ser{" "}
                    {"newEmail" in state && <strong className="text-gray-800">{state.newEmail}</strong>}.
                    Se você não esperava esta mensagem, não confirme.
                  </p>
                </div>
                <button
                  onClick={handleConfirm}
                  disabled={state.status === "confirming"}
                  className="flex items-center justify-center gap-2 w-full h-11 rounded-xl text-sm font-semibold bg-[#1B3A8C] hover:bg-[#162f73] disabled:opacity-60 text-white transition-colors"
                >
                  {state.status === "confirming" && <Loader2 className="size-4 animate-spin" />}
                  Confirmar troca de e-mail
                </button>
              </>
            )}

            {state.status === "confirmed" && (
              <>
                <div className="w-14 h-14 rounded-2xl bg-green-50 border border-green-100 flex items-center justify-center">
                  <ShieldCheck className="size-6 text-green-600" />
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-gray-900">E-mail confirmado</p>
                  <p className="text-sm text-gray-500 leading-relaxed">
                    Redirecionando para o login...
                  </p>
                </div>
              </>
            )}

            {state.status === "confirm_failed" && (
              <>
                <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center">
                  <MailX className="size-6 text-red-500" />
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-gray-900">Não foi possível confirmar</p>
                  <p className="text-sm text-gray-500 leading-relaxed">{state.message}</p>
                </div>
              </>
            )}

            <div className="w-full pt-1">
              <Link
                href="/login"
                className="flex items-center justify-center w-full h-11 rounded-xl text-sm font-semibold border border-gray-200 hover:bg-gray-50 text-gray-700 transition-colors"
              >
                Ir para o login
              </Link>
            </div>
          </div>
        </div>

        <p className="text-xs text-center text-gray-400 mt-6">
          Andrômeda Control System · by Arckos IA
        </p>
      </div>
    </div>
  );
}

export default function EmailChangeConfirmPage() {
  // useSearchParams exige Suspense boundary (Next.js) — mesmo padrão de
  // outras páginas públicas deste app que leem query string no client.
  return (
    <Suspense fallback={null}>
      <EmailChangeConfirmContent />
    </Suspense>
  );
}
