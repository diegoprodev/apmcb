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
  const resolved = await Promise.all(
    items.map(async (item) => ({
      ...item,
      photo_display_url: await resolvePhotoUrl(item.photo_url, supabase, BUCKET_MATERIAL),
    })),
  );
  return resolved;
}
