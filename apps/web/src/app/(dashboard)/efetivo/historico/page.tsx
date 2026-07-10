
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { HistoricoClient } from "./_historico-client";
import { Loader2 } from "lucide-react";

export default async function EfetivoHistoricoPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const cookieStore = await cookies();
  const activeMode = cookieStore.get("apmcb_mode")?.value;
  if (!profile || (profile.role !== "usuario" && activeMode !== "usuario")) redirect("/");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Histórico de Saídas</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Todos os materiais retirados e devolvidos — filtre, ordene e exporte
        </p>
      </div>

      <Suspense
        fallback={
          <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Carregando histórico...</span>
          </div>
        }
      >
        <HistoricoClient />
      </Suspense>
    </div>
  );
}
