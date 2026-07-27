import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { processProfilePhoto } from "../src/domain/profile-photo/process-profile-photo.ts";
import { normalizeProfilePhotoReference } from "../src/domain/profile-photo/profile-photo-reference.ts";
import { replaceProfilePhoto } from "../src/domain/profile-photo/replace-profile-photo.ts";
import { createProfilePhotoDependencies } from "../src/repositories/profile-photo-repository.ts";
import {
  listProfilePhotoSnapshots,
  type ProfilePhotoSnapshot,
} from "./profile-photo-script-support.ts";

const APPLY_CONFIRMATION = "APPLY-ACTIVE-PROFILE-PHOTO-MIGRATION";

export function parseMigrationMode(args: string[]) {
  const apply = args.includes("--apply");
  const confirmation = args
    .find((arg) => arg.startsWith("--confirmation="))
    ?.slice("--confirmation=".length);
  if (apply && confirmation !== APPLY_CONFIRMATION) {
    throw new Error(
      `Modo apply exige --confirmation=${APPLY_CONFIRMATION}`,
    );
  }
  if (!apply && confirmation) {
    throw new Error("--confirmation só pode ser usado junto com --apply");
  }
  return apply ? "apply" as const : "dry-run" as const;
}

export function parseTargetProfileIds(args: string[]) {
  const profileIds = args
    .filter((arg) => arg.startsWith("--profile-id="))
    .map((arg) => arg.slice("--profile-id=".length));
  if (profileIds.some((profileId) => !profileId)) {
    throw new Error("--profile-id inválido");
  }
  if (new Set(profileIds).size !== profileIds.length) {
    throw new Error("--profile-id duplicado");
  }
  return profileIds;
}

export function selectTargetProfiles(
  profiles: ProfilePhotoSnapshot[],
  targetProfileIds: string[],
  mode: "apply" | "dry-run",
) {
  if (targetProfileIds.length === 0) {
    if (mode === "apply") {
      throw new Error("Modo apply exige ao menos um --profile-id");
    }
    return profiles;
  }

  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  return targetProfileIds.map((profileId) => {
    const profile = byId.get(profileId);
    if (!profile) {
      throw new Error(`profile-id não encontrado: ${profileId}`);
    }
    return profile;
  });
}

async function main() {
  const args = process.argv.slice(2);
  const mode = parseMigrationMode(args);
  const targetProfileIds = parseTargetProfileIds(args);
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias");
  }
  const client = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const profiles = selectTargetProfiles(
    await listProfilePhotoSnapshots(client),
    targetProfileIds,
    mode,
  );

  const results: Record<string, unknown>[] = [];
  for (const profile of profiles) {
    const currentPath = normalizeProfilePhotoReference(
      profile.foto_url as string,
      supabaseUrl,
    );
    if (!currentPath) {
      results.push({
        profileId: profile.id,
        currentReference: profile.foto_url,
        status: "invalid-reference",
      });
      continue;
    }
    const { data: original, error: downloadError } = await client.storage
      .from("profile-photos")
      .download(currentPath);
    if (downloadError) {
      results.push({
        profileId: profile.id,
        currentPath,
        status: "download-failed",
        error: downloadError.message,
      });
      continue;
    }
    const rawBytes = new Uint8Array(await original.arrayBuffer());
    const originalMetadata = await sharp(rawBytes).metadata();
    const processed = await processProfilePhoto(rawBytes);
    const proposedPath = `${profile.id}/<uuid>.webp`;

    if (mode === "apply") {
      const dependencies = createProfilePhotoDependencies(client, {
        supabaseUrl,
        warn: (message, context) =>
          console.warn(JSON.stringify({ message, ...context })),
      });
      dependencies.process = async () => processed;
      const applied = await replaceProfilePhoto(
        {
          actor: {
            userId: profile.id as string,
            role: "usuario",
            tenantId: null,
          },
          targetProfileId: profile.id as string,
          rawBytes,
          expectedOldPhotoReferenceRaw: profile.foto_url as string,
        },
        dependencies,
      );
      results.push({
        profileId: profile.id,
        currentPath,
        originalBytes: rawBytes.byteLength,
        originalWidth: originalMetadata.width,
        originalHeight: originalMetadata.height,
        newPath: applied.photoPath,
        newBytes: processed.size,
        newWidth: processed.width,
        newHeight: processed.height,
        quality: processed.quality,
        status: "applied",
      });
    } else {
      results.push({
        profileId: profile.id,
        currentPath,
        originalMime: originalMetadata.format,
        originalBytes: rawBytes.byteLength,
        originalWidth: originalMetadata.width,
        originalHeight: originalMetadata.height,
        proposedPath,
        newMime: processed.mime,
        newBytes: processed.size,
        newWidth: processed.width,
        newHeight: processed.height,
        quality: processed.quality,
        status: "dry-run",
      });
    }
  }

  console.log(JSON.stringify({
    mode,
    generatedAt: new Date().toISOString(),
    total: results.length,
    results,
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
