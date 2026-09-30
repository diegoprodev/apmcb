import { getSessionUser } from "@/lib/session-profile";
import { BFF_URL, bffSessionHeaders, resolveWebSessionRole } from "@/lib/web-session";
import { redirect } from "next/navigation";
import { OcorrenciasClient } from "./_ocorrencias-client";

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

  const all = await fetchOcorrencias();

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

// Toda negação/falha deixa rastro no log — senão a página só renderiza vazia.
// 401 (sessão do BFF expirou entre as duas chamadas) → login.
async function fetchOcorrencias(): Promise<OcorrenciaRow[]> {
  let res: Response;
  try {
    res = await fetch(`${BFF_URL}/api/ocorrencias`, {
      headers: await bffSessionHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    console.warn("[reserva/ocorrencias] falha ao consultar /api/ocorrencias", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
  const requestId = res.headers.get("x-request-id");
  if (res.status === 401) {
    console.warn("[reserva/ocorrencias] BFF recusou /api/ocorrencias", { status: 401, requestId });
    redirect("/login");
  }
  if (!res.ok) {
    console.warn("[reserva/ocorrencias] BFF recusou /api/ocorrencias", { status: res.status, requestId });
    return [];
  }
  const body: unknown = await res.json().catch(() => null);
  if (!Array.isArray(body)) {
    console.warn("[reserva/ocorrencias] resposta inesperada de /api/ocorrencias", { requestId });
    return [];
  }
  // Só os campos que o cliente renderiza (o BFF devolve mais).
  return (body as OcorrenciaRow[]).map((o) => ({
    id: o.id,
    titulo: o.titulo,
    descricao: o.descricao,
    status: o.status,
    material_nome_snapshot: o.material_nome_snapshot,
    created_at: o.created_at,
    military: o.military
      ? { nome_completo: o.military.nome_completo, posto: o.military.posto, matricula: o.military.matricula }
      : null,
  }));
}
