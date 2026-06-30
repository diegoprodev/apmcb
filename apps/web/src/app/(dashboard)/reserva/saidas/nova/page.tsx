
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
  if (profile?.role !== "armeiro" && profile?.role !== "admin_global" && profile?.role !== "admin_reserva" && profile?.role !== "superadmin") redirect("/");

  const SELECT_COLS = "id, nome_completo, nome_de_guerra, matricula, posto, registration_status";

  // Busca cadetes + próprio perfil (armeiro pode se armar) em paralelo
  const [{ data: cadetes }, { data: selfProfile }] = await Promise.all([
    supabase
      .from("profiles")
      .select(SELECT_COLS)
      .eq("role", "usuario")
      .order("nome_completo"),
    supabase
      .from("profiles")
      .select(SELECT_COLS)
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  // Coloca o próprio armeiro no topo; evita duplicata se ele também tiver role=usuario
  const cadetesList = cadetes ?? [];
  const militares = selfProfile && selfProfile.id !== cadetesList.find((c) => c.id === selfProfile.id)?.id
    ? [selfProfile, ...cadetesList]
    : cadetesList;

  // Reserva de Armamento vê TODOS os materiais (inclusive sem estoque) para saber o inventário completo
  const { data: materiais } = await supabase
    .from("material_availability")
    .select("id, nome, categoria, quantidade_disponivel, quantidade_total")
    .order("nome");

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Nova Saída de Material</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Registrar saída de material do almoxarifado
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
