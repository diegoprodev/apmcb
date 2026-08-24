// SSOT: resolução de URLs de storage (bucket privado → signed URL autenticada)
// Uso em Server Components: import { resolvePhotoUrl } from "@/lib/storage"
// Uso em Client Components: import { resolvePhotoUrlClient } from "@/lib/storage"
//
// Formato aceito em `foto_url`:
//   - Path relativo: "userId/profile.png"
//   - URL pública legada: "https://....supabase.co/storage/v1/object/public/profile-photos/..."
//
// Ambos os formatos são normalizados para path antes de gerar a signed URL.

import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET_PROFILE = "profile-photos";
const BUCKET_MATERIAL = "material-photos";

const PUBLIC_URL_INFIX_PROFILE = `/storage/v1/object/public/${BUCKET_PROFILE}/`;
const PUBLIC_URL_INFIX_MATERIAL = `/storage/v1/object/public/${BUCKET_MATERIAL}/`;

const SIGNED_URL_TTL = 3600; // 1 hora

function extractPath(fotoUrl: string, bucket: string): string {
  const infix = bucket === BUCKET_PROFILE ? PUBLIC_URL_INFIX_PROFILE : PUBLIC_URL_INFIX_MATERIAL;
  const idx = fotoUrl.indexOf(infix);
  if (idx >= 0) return fotoUrl.slice(idx + infix.length).split("?")[0];
  return fotoUrl; // já é um path relativo
}

export async function resolvePhotoUrl(
  fotoUrl: string | null | undefined,
  supabase: SupabaseClient,
  bucket = BUCKET_PROFILE,
): Promise<string | null> {
  if (!fotoUrl) return null;
  const path = extractPath(fotoUrl, bucket);
  try {
    const { data } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL);
    return data?.signedUrl ?? null;
  } catch (error) {
    // Falha de rede/timeout no Storage não pode derrubar a página inteira —
    // Promise.all em resolvePhotosInBulk/withMaterialPhotoDisplayUrls rejeitaria
    // tudo por causa de UMA foto. Degrada para "sem foto" e loga para F12.
    console.error("[storage] falha ao gerar signed URL", { bucket, path, error });
    return null;
  }
}

export async function resolvePhotosInBulk<T extends { foto_url?: string | null }>(
  items: T[],
  supabase: SupabaseClient,
  bucket = BUCKET_PROFILE,
): Promise<(T & { foto_url: string | null })[]> {
  if (items.length === 0) return items as (T & { foto_url: string | null })[];
  const resolved = await Promise.all(
    items.map(async (item) => ({
      ...item,
      foto_url: await resolvePhotoUrl(item.foto_url, supabase, bucket),
    })),
  );
  return resolved;
}

const SIGNED_URL_BATCH_SIZE = 100;

// PERF-04 (docs/enterprise/specs/navegacao-performance-enterprise.md):
// createSignedUrls (plural, em lote) em vez de N chamadas de createSignedUrl
// (uma por item, em Promise.all) — mesmo padrão já revisado e em produção em
// apps/bff/src/routes/usuario.ts:124-143 (inclusive o try/catch: createSignedUrl(s)
// PODE LANÇAR em falha de rede/fetch do Storage, não só retornar `{error}`).
// Em chunks de 100 (mesmo tamanho de referência de usuario.ts, cuja fonte já
// vem de uma query com .limit(100)) — a lista de materiais do arsenal NÃO é
// paginada hoje, então sem chunking um lote muito grande poderia esbarrar
// num teto não documentado da API do Storage; chunks preservam o ganho (1
// chamada a cada 100 itens, não 1 por item) sem depender de um limite não
// confirmado.
async function resolveMaterialPhotoUrlsBulk(
  paths: string[],
  supabase: SupabaseClient,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (paths.length === 0) return map;

  const chunks: string[][] = [];
  for (let i = 0; i < paths.length; i += SIGNED_URL_BATCH_SIZE) {
    chunks.push(paths.slice(i, i + SIGNED_URL_BATCH_SIZE));
  }

  await Promise.all(chunks.map(async (chunk) => {
    try {
      const { data, error } = await supabase.storage.from(BUCKET_MATERIAL).createSignedUrls(chunk, SIGNED_URL_TTL);
      if (error) {
        // Falha de rede/timeout no Storage não pode derrubar a página inteira
        // — degrada pra "sem foto" nesse chunk e loga para F12, mesmo
        // comportamento de resolvePhotoUrl.
        console.error("[storage] falha ao gerar signed URLs em lote", { count: chunk.length, error });
        return;
      }
      // Prefere entry.path (path retornado pela API, mesmo padrão já revisado
      // de apps/bff/src/routes/usuario.ts:133-135 — não depende de garantia
      // de ordem do SDK do Storage, que não é documentada formalmente).
      // Fallback pro path REQUISITADO (chunk[i], por posição) só quando
      // entry.path vier null — elimina a colisão original (2ª achado BAIXO:
      // duas entradas com path null colidindo na mesma chave "") sem
      // reintroduzir a dependência de ordem que o mapeamento por índice puro
      // teria.
      (data ?? []).forEach((entry, i) => {
        if (entry.signedUrl && !entry.error) map.set(entry.path ?? chunk[i], entry.signedUrl);
      });
    } catch (error) {
      console.error("[storage] exceção ao gerar signed URLs em lote", { count: chunk.length, error });
    }
  }));

  return map;
}

// Materiais do arsenal usam o campo `photo_url` (não `foto_url`) e, ao contrário dos
// fluxos de perfil, o valor bruto de `photo_url` também é reenviado pelo formulário de
// edição (admin/arsenal) quando o usuário salva sem trocar a foto. Por isso NÃO
// sobrescrevemos `photo_url` aqui — adicionamos um campo adicional `photo_display_url`
// (signed URL, só para exibição) e preservamos o valor bruto intacto para round-trip.
export async function withMaterialPhotoDisplayUrls<T extends { photo_url?: string | null }>(
  items: T[],
  supabase: SupabaseClient,
): Promise<(T & { photo_display_url: string | null })[]> {
  if (items.length === 0) return items as (T & { photo_display_url: string | null })[];

  const paths = items
    .map((item) => item.photo_url)
    .filter((value): value is string => !!value)
    .map((value) => extractPath(value, BUCKET_MATERIAL));

  const urlMap = await resolveMaterialPhotoUrlsBulk(paths, supabase);

  return items.map((item) => ({
    ...item,
    photo_display_url: item.photo_url
      ? urlMap.get(extractPath(item.photo_url, BUCKET_MATERIAL)) ?? null
      : null,
  }));
}
