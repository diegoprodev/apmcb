import { createClient } from "@/lib/supabase/server";
import { getSessionUser, getSessionProfile } from "@/lib/session-profile";
import { redirect } from "next/navigation";
import { MinhasCautelasClient, type Cautela } from "./_minhas-cautelas-client";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

export default async function MinhasCautelasPage({
  searchParams,
}: {
  searchParams?: Promise<{ limit?: string }>;
}) {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // Achado de code review: esta página não tem restrição de role — um
  // armeiro (que também é militar, ex: cautela pessoal de arma de serviço)
  // pode acessá-la para assinar como usuário/militar. requireActiveShift no
  // BFF valida o role do CHAMADOR (não um role fixo "militar"), então um
  // armeiro sem turno aberto recebe 403 SHIFT_REQUIRED aqui também — o
  // client precisa saber a role pra decidir se faz o pré-check de turno.
  const profile = await getSessionProfile(user.id);

  const { data: { session } } = await supabase.auth.getSession();

  const params = await searchParams;
  const limit = Math.min(Math.max(parseInt(params?.limit ?? "10") || 10, 10), 30);

  let allCautelas: Cautela[] = [];
  try {
    const res = await fetch(`${BFF_URL}/api/cautelamentos/ativos`, {
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      cache: "no-store",
    });
    if (res.ok) {
      const json = await res.json();
      allCautelas = json.cautelamentos ?? [];
    }
  } catch {}

  const hasMore = allCautelas.length > limit;
  const cautelas = hasMore ? allCautelas.slice(0, limit) : allCautelas;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-2xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-foreground">Minhas Cautelas</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Itens sob sua responsabilidade por cautela permanente
        </p>
      </div>
      <MinhasCautelasClient initialCautelas={cautelas} hasMore={hasMore} currentLimit={limit} role={profile?.role ?? null} />
    </div>
  );
}
