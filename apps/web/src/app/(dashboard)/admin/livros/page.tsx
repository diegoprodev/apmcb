export const runtime = "edge";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, getSessionProfile } from "@/lib/session-profile";
import { AdminLivrosClient } from "./_admin-livros-client";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

// Achado real do usuário: admin_global não tinha nenhum seletor de
// reserva/unidade nesta tela — via TODOS os turnos de TODAS as reservas
// misturados, sem controle nenhum, ao contrário do "padrão enterprise"
// já estabelecido em admin/saidas/page.tsx (mesmo fetch de
// /api/admin/estrutura, mesmo shape de props).
export default async function AdminLivrosPage() {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const profile = await getSessionProfile(user.id);
  if (!profile) redirect("/login");

  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(`${BFF_URL}/api/admin/estrutura`, {
    headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
    cache: "no-store",
  });

  const estrutura = res.ok
    ? (await res.json() as { org_units: { id: string; nome: string }[]; reserves: { id: string; nome: string; acronym: string; org_unit_id: string | null }[] })
    : { org_units: [], reserves: [] };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-foreground">Livros Digitais de Serviço</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Histórico de todos os turnos — armeiros, reservas, eventos e pendências
        </p>
      </div>
      <AdminLivrosClient orgUnits={estrutura.org_units} reserves={estrutura.reserves} />
    </div>
  );
}
