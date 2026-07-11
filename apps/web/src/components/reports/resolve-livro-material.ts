import type { createClient } from "@/lib/supabase/server";
import type { LivroRow } from "./types";

type Embedded<T> = T | T[] | null;

// Supabase-js às vezes retorna relações embutidas como array mesmo quando a
// FK é 1:1 (depende de como o PostgREST detecta a relação) — normaliza para
// objeto único em ambos os casos, mesmo padrão já usado em material-items-manutencao.ts.
function firstOrSelf<T>(value: Embedded<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

/**
 * service_log_events.subject_id/subject_type é uma associação polimórfica —
 * resolve o nome do material referenciado buscando em lendings (saida_diaria/
 * lending) ou cautelamentos (cautelamento), os dois tipos de evento do Livro
 * que têm um material por trás. Outros event_type (turno, ocorrência já
 * embutida na description, evento manual) ficam sem material_nome.
 */
export async function resolveLivroMaterialNomes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: LivroRow[]
): Promise<LivroRow[]> {
  const lendingIds = rows
    .filter((r) => r.subject_type === "saida_diaria" || r.subject_type === "lending")
    .map((r) => r.subject_id)
    .filter((id): id is string => !!id);
  const cautelaIds = rows
    .filter((r) => r.subject_type === "cautelamento")
    .map((r) => r.subject_id)
    .filter((id): id is string => !!id);

  const nomeByLendingId = new Map<string, string>();
  const nomeByCautelaId = new Map<string, string>();

  if (lendingIds.length > 0) {
    const { data } = await supabase
      .from("lendings")
      .select("id, material_type:material_types(nome)")
      .in("id", lendingIds);
    (data ?? []).forEach((l: any) => {
      const materialType = firstOrSelf<{ nome: string }>(l.material_type);
      if (materialType?.nome) nomeByLendingId.set(l.id, materialType.nome);
    });
  }

  if (cautelaIds.length > 0) {
    const { data } = await supabase
      .from("cautelamentos")
      .select("id, item:material_items(material_type:material_types(nome))")
      .in("id", cautelaIds);
    (data ?? []).forEach((c: any) => {
      const item = firstOrSelf<{ material_type: Embedded<{ nome: string }> }>(c.item);
      const materialType = firstOrSelf<{ nome: string }>(item?.material_type ?? null);
      if (materialType?.nome) nomeByCautelaId.set(c.id, materialType.nome);
    });
  }

  return rows.map((r) => ({
    ...r,
    material_nome:
      r.subject_type && r.subject_id
        ? (r.subject_type === "saida_diaria" || r.subject_type === "lending"
            ? nomeByLendingId.get(r.subject_id)
            : r.subject_type === "cautelamento"
              ? nomeByCautelaId.get(r.subject_id)
              : null) ?? null
        : null,
  }));
}
