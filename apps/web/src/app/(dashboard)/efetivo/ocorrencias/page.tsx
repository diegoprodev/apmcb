export const runtime = "edge";

import { getSessionUser, getSessionProfile } from "@/lib/session-profile";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { OcorrenciasClient } from "./_ocorrencias-client";
import { Loader2 } from "lucide-react";

// Achado real do usuário (2026-08-28): uma ocorrência de material registrada
// pelo armeiro aparecia só como um resumo em efetivo/historico, sem clique,
// sem detalhe, sem status. Nova rota dedicada, sub-item do sidebar abaixo de
// "Solicitações Remotas" (ver components/layout/sidebar.tsx) — junta as
// ocorrências que o próprio militar reportou (GET /api/ocorrencias) com as
// de material que o associam (GET /api/usuario/ocorrencias-material).
export default async function EfetivoOcorrenciasPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const profile = await getSessionProfile(user.id);

  const cookieStore = await cookies();
  const activeMode = cookieStore.get("apmcb_mode")?.value;
  if (!profile || (profile.role !== "usuario" && activeMode !== "usuario")) redirect("/");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Ocorrências</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Problemas que você reportou e ocorrências de material associadas ao seu nome
        </p>
      </div>

      <Suspense
        fallback={
          <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Carregando ocorrências...</span>
          </div>
        }
      >
        <OcorrenciasClient />
      </Suspense>
    </div>
  );
}
