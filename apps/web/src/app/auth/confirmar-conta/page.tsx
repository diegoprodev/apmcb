export const runtime = "edge";
// Sem isso, Next.js pode servir uma resposta cacheada (com dados de OUTRO
// usuário) para requisições subsequentes — a detecção automática de "usa
// cookies() logo é dinâmico" não é confiável neste adaptador. Causa raiz
// confirmada do incidente de session-bleed cross-user (ver commit e059f7f).
export const dynamic = "force-dynamic";

import Image from "next/image";
import { AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ConfirmarContaForm } from "./_confirmar-conta-form";

function ErrorCard() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-[440px]">
        <div className="flex items-center gap-3 mb-8">
          <Image src="/images/logo.png" alt="APMCB" width={32} height={32} className="shrink-0" priority />
          <span className="text-sm font-semibold text-gray-800 tracking-wide">APMCB</span>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
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
            <a
              href="/login"
              className="flex w-full h-11 items-center justify-center rounded-xl text-sm font-semibold bg-[#1B3A8C] hover:bg-[#162f73] text-white transition-colors"
            >
              Ir para o login
            </a>
          </div>
        </div>
        <p className="text-xs text-center text-gray-400 mt-6">APMCB Control System · by Arckos IA</p>
      </div>
    </div>
  );
}

export default async function ConfirmarContaPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <ErrorCard />;

  const { data: profile } = await supabase
    .from("profiles")
    .select("nome_completo, role, email")
    .eq("id", user.id)
    .single();

  return (
    <ConfirmarContaForm
      nomeCompleto={profile?.nome_completo ?? (user.user_metadata?.nome_completo as string | undefined) ?? "Usuário"}
      email={profile?.email ?? user.email ?? ""}
      role={profile?.role ?? "usuario"}
    />
  );
}
