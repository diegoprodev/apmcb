import { getSessionUser } from "@/lib/session-profile";
import { bffSessionHeaders, resolveWebSessionRole } from "@/lib/web-session";
import { redirect } from "next/navigation";
import { OcorrenciasClient } from "./_ocorrencias-client";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

// Mesmos papéis do roleGuard de staff de GET /api/ocorrencias (BFF).
const STAFF_ROLES = new Set(["armeiro", "admin_reserva", "admin_global"]);

type OcorrenciaRow = {
  id: string;
  titulo: string;
  descricao: string | null;
  status: string;
  material_nome_snapshot: string | null;
  created_at: string;
  military: { nome_completo: string; posto: string | null; matricula: string } | null;
};

// R-34 / R-37 (docs/auditoria/EVIDENCE_R37_BATCH1.md): antes lia `ocorrencias`
// direto do Supabase com o JWT do usuário — o RLS decide por profiles.role e
// ignora o Modo Usuário (D-02). Agora: autorização pelo papel EFETIVO da
// sessão do BFF e dados de GET /api/ocorrencias, que aplica sessão, tenant e
// reserva (C_HYBRID). Nada de Supabase direto nesta página.
export default async function OcorrenciasPage({
  searchParams,
}: {
  searchParams?: Promise<{ limit?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // null = sem sessão do BFF, sessão de outra identidade ou falha → nega.
  const role = await resolveWebSessionRole(user.id);
  if (!role || !STAFF_ROLES.has(role)) redirect("/");

  const params = await searchParams;
  const limit = Math.min(Math.max(parseInt(params?.limit ?? "10") || 10, 10), 30);

  const res = await fetch(`${BFF_URL}/api/ocorrencias`, {
    headers: await bffSessionHeaders(),
    cache: "no-store",
  });
  // Negação/falha deixa rastro — senão a página só renderiza vazia.
  if (!res.ok) console.warn("[reserva/ocorrencias] BFF recusou /api/ocorrencias", { status: res.status });
  const all: OcorrenciaRow[] = res.ok ? await res.json() : [];

  const hasMore = all.length > limit;
  const ocorrencias = hasMore ? all.slice(0, limit) : all;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Ocorrências</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Problemas reportados com materiais pelos militares
        </p>
      </div>

      <OcorrenciasClient
        ocorrencias={ocorrencias}
        hasMore={hasMore}
        currentLimit={limit}
      />
    </div>
  );
}
