import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizeProfilePhotoReference } from "../src/domain/profile-photo/profile-photo-reference.ts";
import { listProfilePhotoSnapshots } from "./profile-photo-script-support.ts";

type StorageEntry = {
  name: string;
  id: string | null;
  created_at: string | null;
  metadata: { size?: number; mimetype?: string } | null;
};

async function listObjects(
  client: SupabaseClient,
  prefix = "",
): Promise<Array<StorageEntry & { path: string }>> {
  const objects: Array<StorageEntry & { path: string }> = [];
  for (let offset = 0; ; offset += 1_000) {
    const { data, error } = await client.storage
      .from("profile-photos")
      .list(prefix, { limit: 1_000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    for (const entry of (data ?? []) as StorageEntry[]) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        objects.push(...await listObjects(client, path));
      } else {
        objects.push({ ...entry, path });
      }
    }
    if (!data || data.length < 1_000) break;
  }
  return objects;
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias");
  }
  const client = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const profiles = await listProfilePhotoSnapshots(client);

  const references = new Map<string, string[]>();
  for (const profile of profiles) {
    const path = normalizeProfilePhotoReference(
      profile.foto_url as string,
      supabaseUrl,
    );
    if (!path) continue;
    references.set(path, [...(references.get(path) ?? []), profile.id as string]);
  }
  const objects = await listObjects(client);
  const report = objects.map((object) => ({
    path: object.path,
    bytes: object.metadata?.size ?? null,
    mime: object.metadata?.mimetype ?? null,
    createdAt: object.created_at,
    profileIds: references.get(object.path) ?? [],
    classification: references.has(object.path) ? "active" : "orphan",
  }));

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    total: report.length,
    active: report.filter((row) => row.classification === "active").length,
    orphan: report.filter((row) => row.classification === "orphan").length,
    objects: report,
  }, null, 2));
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
