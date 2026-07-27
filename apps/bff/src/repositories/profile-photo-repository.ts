import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeProfilePhotoReference } from "../domain/profile-photo/profile-photo-reference.ts";
import type {
  ProfilePhotoCasInput,
  ProfilePhotoDependencies,
} from "../domain/profile-photo/replace-profile-photo.ts";

const PROFILE_PHOTO_BUCKET = "profile-photos";
const REFERENCE_PAGE_SIZE = 1_000;

export function createProfilePhotoDependencies(
  client: SupabaseClient,
  options: {
    supabaseUrl: string;
    warn: ProfilePhotoDependencies["warn"];
  },
): ProfilePhotoDependencies {
  return {
    supabaseUrl: options.supabaseUrl,
    warn: options.warn,
    profiles: {
      async findById(profileId) {
        const { data, error } = await client
          .from("profiles")
          .select("id, default_tenant_id, foto_url")
          .eq("id", profileId)
          .maybeSingle();

        if (error) throw error;
        if (!data) return null;
        return {
          id: data.id as string,
          defaultTenantId: data.default_tenant_id as string | null,
          photoReferenceRaw: data.foto_url as string | null,
        };
      },

      async compareAndSwap(input: ProfilePhotoCasInput) {
        let query = client
          .from("profiles")
          .update({ foto_url: input.newPhotoPath })
          .eq("id", input.profileId);

        query = input.tenantId
          ? query.eq("default_tenant_id", input.tenantId)
          : query.is("default_tenant_id", null);
        query = input.oldPhotoReferenceRaw === null
          ? query.is("foto_url", null)
          : query.eq("foto_url", input.oldPhotoReferenceRaw);

        const { data, error } = await query.select("id").maybeSingle();
        if (error) throw error;
        return data !== null;
      },

      async countNormalizedReferences(photoPath) {
        let count = 0;
        for (let from = 0; ; from += REFERENCE_PAGE_SIZE) {
          const { data, error } = await client
            .from("profiles")
            .select("id, foto_url")
            .not("foto_url", "is", null)
            .order("id", { ascending: true })
            .range(from, from + REFERENCE_PAGE_SIZE - 1);
          if (error) throw error;

          for (const row of data ?? []) {
            if (
              normalizeProfilePhotoReference(
                row.foto_url as string,
                options.supabaseUrl,
              ) === photoPath
            ) {
              count += 1;
            }
          }
          if (!data || data.length < REFERENCE_PAGE_SIZE) break;
        }
        return count;
      },
    },
    storage: {
      async upload(path, bytes, uploadOptions) {
        const { error } = await client.storage
          .from(PROFILE_PHOTO_BUCKET)
          .upload(path, bytes, uploadOptions);
        if (error) throw error;
      },
      async remove(path) {
        const { error } = await client.storage
          .from(PROFILE_PHOTO_BUCKET)
          .remove([path]);
        if (error) throw error;
      },
    },
  };
}
