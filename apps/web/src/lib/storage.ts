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
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL);
  return data?.signedUrl ?? null;
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
