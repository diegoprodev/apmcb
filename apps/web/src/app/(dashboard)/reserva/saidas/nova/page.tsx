import { createClient } from "@/lib/supabase/server";
import { getSessionUser, getSessionProfile } from "@/lib/session-profile";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
import { NovaSaidaForm } from "./_form";
import { NovaSaidaShiftGuard } from "./_shift-guard";

export default async function NovaSaidaPage() {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const profile = await getSessionProfile(user.id);
  if (profile?.role !== "armeiro" && profile?.role !== "admin_global" && profile?.role !== "admin_reserva" && profile?.role !== "superadmin") redirect("/");

  const { data: reserveMembership } = await supabase
    .from("reserve_memberships")
    .select("reserve_id")
    .eq("user_id", user.id)
    .maybeSingle();

  // Guard de turno ANTES de montar o formulário — o BFF (POST /api/lendings)
  // já rejeitava com 403 SHIFT_REQUIRED, mas só no submit: o armeiro conseguia
  // preencher todo o formulário (buscar militar, materiais, verificar
  // identidade) até então descobrir que precisava abrir um turno primeiro.
  // Só se aplica a "armeiro" — mesmo escopo do guard no BFF (admin_global/
  // admin_reserva não operam turno).
  let shiftRequired = false;
  if (profile?.role === "armeiro") {
    const { data: activeShift } = await supabase
      .from("service_shifts")
      .select("id")
      .eq("armeiro_id", user.id)
      .eq("status", "ativo")
      .maybeSingle();
    shiftRequired = !activeShift;
  }

  // Bloqueado ANTES de montar o formulário — nem os dados de cadetes/materiais
  // são buscados, já que o formulário não vai ser exibido de qualquer forma.
  if (shiftRequired) {
    return (
      <div className="space-y-6 max-w-2xl">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Nova Saída de Material</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Registrar saída de material do almoxarifado
          </p>
        </div>
        <NovaSaidaShiftGuard />
      </div>
    );
  }

  const SELECT_COLS = "id, nome_completo, nome_de_guerra, matricula, posto, registration_status";

  // Busca cadetes + próprio perfil (armeiro pode se armar) em paralelo
  const [{ data: cadetes }, selfProfile] = await Promise.all([
    supabase
      .from("profiles")
      .select(SELECT_COLS)
      .eq("role", "usuario")
      .order("nome_completo"),
    getSessionProfile(user.id),
  ]);

  // Coloca o próprio armeiro no topo; evita duplicata se ele também tiver role=usuario
  // Achado de code review: getSessionProfile(user.id) retorna a união de 11
  // colunas do PERF-02 (mais ampla que SELECT_COLS) — espalhar o objeto
  // inteiro em `militares` mudaria o shape do RSC payload enviado ao client
  // component (NovaSaidaForm), incluindo colunas que a query original nunca
  // buscava. Destrutura só os campos de SELECT_COLS, mesmo shape de antes.
  const selfMilitar = selfProfile ? {
    id: selfProfile.id,
    nome_completo: selfProfile.nome_completo,
    nome_de_guerra: selfProfile.nome_de_guerra,
    matricula: selfProfile.matricula,
    posto: selfProfile.posto,
    registration_status: selfProfile.registration_status,
  } : null;
  const cadetesList = cadetes ?? [];
  const militares = selfMilitar && selfMilitar.id !== cadetesList.find((c) => c.id === selfMilitar.id)?.id
    ? [selfMilitar, ...cadetesList]
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
        reserveId={reserveMembership?.reserve_id ?? null}
      />
    </div>
  );
}
