export const runtime = 'edge';

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { NovaSaidaForm } from "./_form";

export default async function NovaSaidaPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, id, nome_completo")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "master" && profile?.role !== "admin") redirect("/");

  const { data: militares } = await supabase
    .from("profiles")
    .select("id, nome_completo, matricula, posto")
    .eq("role", "military")
    .order("nome_completo");

  // Armeiro vê TODOS os materiais (inclusive sem estoque) para saber o inventário completo
  const { data: materiais } = await supabase
    .from("material_availability")
    .select("id, nome, categoria, quantidade_disponivel, quantidade_total")
    .order("nome");

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Nova Saída de Material</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Registrar saída de material do arsenal
        </p>
      </div>
      <NovaSaidaForm
        militares={militares ?? []}
        materiais={materiais ?? []}
        masterId={profile!.id}
      />
    </div>
  );
}
