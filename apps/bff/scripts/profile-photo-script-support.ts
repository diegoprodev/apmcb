import type { SupabaseClient } from "@supabase/supabase-js";

const PROFILE_PAGE_SIZE = 1_000;

export type ProfilePhotoSnapshot = {
  id: string;
  foto_url: string;
};

export async function listProfilePhotoSnapshots(
  client: SupabaseClient,
): Promise<ProfilePhotoSnapshot[]> {
  const profiles: ProfilePhotoSnapshot[] = [];

  for (let from = 0; ; from += PROFILE_PAGE_SIZE) {
    const { data, error } = await client
      .from("profiles")
      .select("id, foto_url")
      .not("foto_url", "is", null)
      .order("id", { ascending: true })
      .range(from, from + PROFILE_PAGE_SIZE - 1);
    if (error) throw error;

    const page = (data ?? []) as ProfilePhotoSnapshot[];
    profiles.push(...page);
    if (page.length < PROFILE_PAGE_SIZE) break;
  }

  return profiles;
}
