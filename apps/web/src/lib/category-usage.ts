import type { createClient } from "@/lib/supabase/server";
import type { MaterialCategoryProfile } from "./material-metadata";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Anexa `material_types_count` a cada categoria: quantos material_types
 * ATIVOS referenciam cada uma — mesmo casamento (category_id OU
 * categoria_slug) já usado no bloqueio 409 de DELETE /api/categories/:id
 * (apps/bff/src/routes/categories.ts) — para que o admin veja essa contagem
 * no hover do botão "Desativar" ANTES de clicar, em vez de só descobrir o
 * bloqueio depois do erro.
 *
 * Uma única query batched (RLS já escopa material_types ao tenant/reserva da
 * sessão — mesmo princípio das queries de material_categories nestas mesmas
 * páginas, que também não filtram tenant_id manualmente) seguida de um loop
 * em memória — nunca uma query por categoria renderizada (evitaria N+1 numa
 * lista que já pode ter dezenas de linhas).
 */
export async function withMaterialTypesCount<T extends MaterialCategoryProfile>(
  categories: T[],
  supabase: SupabaseServerClient
): Promise<(T & { material_types_count: number })[]> {
  if (categories.length === 0) return [];

  const { data: materialRows } = await supabase
    .from("material_types")
    .select("category_id, categoria_slug")
    .eq("ativo", true);

  return categories.map((cat) => ({
    ...cat,
    material_types_count: (materialRows ?? []).filter(
      (m) => (cat.id && m.category_id === cat.id) || (cat.slug && m.categoria_slug === cat.slug)
    ).length,
  }));
}
