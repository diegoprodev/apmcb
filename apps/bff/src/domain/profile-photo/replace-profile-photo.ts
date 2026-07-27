import {
  processProfilePhoto,
  type ProcessedProfilePhoto,
} from "./process-profile-photo.ts";
import { normalizeProfilePhotoReference } from "./profile-photo-reference.ts";

type OperationalRole = "admin_global" | "admin_reserva" | "armeiro";

export type ProfilePhotoActor = {
  userId: string;
  role: string;
  tenantId: string | null;
};

export type ProfilePhotoRecord = {
  id: string;
  defaultTenantId: string | null;
  photoReferenceRaw: string | null;
};

export type ProfilePhotoCasInput = {
  profileId: string;
  tenantId: string | null;
  oldPhotoReferenceRaw: string | null;
  newPhotoPath: string;
};

export type ProfilePhotoDependencies = {
  supabaseUrl: string;
  createUuid?: () => string;
  process?: (rawBytes: Uint8Array) => Promise<ProcessedProfilePhoto>;
  profiles: {
    findById: (profileId: string) => Promise<ProfilePhotoRecord | null>;
    compareAndSwap: (input: ProfilePhotoCasInput) => Promise<boolean>;
    countNormalizedReferences: (photoPath: string) => Promise<number>;
  };
  storage: {
    upload: (
      path: string,
      bytes: Uint8Array,
      options: {
        contentType: "image/webp";
        cacheControl: string;
        upsert: false;
      },
    ) => Promise<void>;
    remove: (path: string) => Promise<void>;
  };
  warn: (message: string, context: Record<string, unknown>) => void;
};

export type ProfilePhotoReplaceErrorCode =
  | "PROFILE_PHOTO_TARGET_NOT_FOUND"
  | "PROFILE_PHOTO_FORBIDDEN"
  | "PROFILE_PHOTO_STORAGE_FAILED"
  | "PROFILE_PHOTO_UPDATE_FAILED"
  | "PROFILE_PHOTO_CONFLICT";

export class ProfilePhotoReplaceError extends Error {
  readonly code: ProfilePhotoReplaceErrorCode;

  constructor(code: ProfilePhotoReplaceErrorCode, message: string) {
    super(message);
    this.name = "ProfilePhotoReplaceError";
    this.code = code;
  }
}

const OPERATIONAL_ROLES = new Set<OperationalRole>([
  "admin_global",
  "admin_reserva",
  "armeiro",
]);

function authorizeTarget(
  actor: ProfilePhotoActor,
  target: ProfilePhotoRecord | null,
) {
  if (!target) {
    throw new ProfilePhotoReplaceError(
      "PROFILE_PHOTO_TARGET_NOT_FOUND",
      "Perfil não encontrado",
    );
  }
  if (actor.userId === target.id) return target;
  if (!OPERATIONAL_ROLES.has(actor.role as OperationalRole)) {
    throw new ProfilePhotoReplaceError(
      "PROFILE_PHOTO_FORBIDDEN",
      "Sem permissão para alterar esta foto",
    );
  }
  if (
    !actor.tenantId ||
    !target.defaultTenantId ||
    actor.tenantId !== target.defaultTenantId
  ) {
    throw new ProfilePhotoReplaceError(
      "PROFILE_PHOTO_TARGET_NOT_FOUND",
      "Perfil não encontrado",
    );
  }
  return target;
}

async function compensateNewObject(
  dependencies: ProfilePhotoDependencies,
  photoPath: string,
  targetProfileId: string,
) {
  try {
    await dependencies.storage.remove(photoPath);
  } catch (error) {
    dependencies.warn("profile_photo_compensation_failed", {
      profileId: targetProfileId,
      photoPath,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

export async function replaceProfilePhoto(
  input: {
    actor: ProfilePhotoActor;
    targetProfileId: string;
    rawBytes: Uint8Array;
    expectedOldPhotoReferenceRaw?: string | null;
  },
  dependencies: ProfilePhotoDependencies,
) {
  const target = authorizeTarget(
    input.actor,
    await dependencies.profiles.findById(input.targetProfileId),
  );
  const oldPhotoReferenceRaw = target.photoReferenceRaw;
  if (
    "expectedOldPhotoReferenceRaw" in input &&
    input.expectedOldPhotoReferenceRaw !== oldPhotoReferenceRaw
  ) {
    throw new ProfilePhotoReplaceError(
      "PROFILE_PHOTO_CONFLICT",
      "A foto foi alterada por outra requisição",
    );
  }
  const oldPhotoPathNormalized = normalizeProfilePhotoReference(
    oldPhotoReferenceRaw,
    dependencies.supabaseUrl,
  );
  const processed = await (dependencies.process ?? processProfilePhoto)(
    input.rawBytes,
  );
  const createUuid = dependencies.createUuid ?? (() => crypto.randomUUID());
  const photoPath = `${target.id}/${createUuid()}.webp`;

  try {
    await dependencies.storage.upload(photoPath, processed.bytes, {
      contentType: "image/webp",
      cacheControl: "31536000",
      upsert: false,
    });
  } catch {
    throw new ProfilePhotoReplaceError(
      "PROFILE_PHOTO_STORAGE_FAILED",
      "Não foi possível armazenar a nova foto",
    );
  }

  let updated: boolean;
  try {
    updated = await dependencies.profiles.compareAndSwap({
      profileId: target.id,
      tenantId: target.defaultTenantId,
      oldPhotoReferenceRaw,
      newPhotoPath: photoPath,
    });
  } catch {
    await compensateNewObject(dependencies, photoPath, target.id);
    throw new ProfilePhotoReplaceError(
      "PROFILE_PHOTO_UPDATE_FAILED",
      "Não foi possível atualizar o perfil",
    );
  }

  if (!updated) {
    await compensateNewObject(dependencies, photoPath, target.id);
    throw new ProfilePhotoReplaceError(
      "PROFILE_PHOTO_CONFLICT",
      "A foto foi alterada por outra requisição",
    );
  }

  if (oldPhotoPathNormalized && oldPhotoPathNormalized !== photoPath) {
    let remainingReferences: number;
    try {
      remainingReferences =
        await dependencies.profiles.countNormalizedReferences(
          oldPhotoPathNormalized,
        );
    } catch (error) {
      dependencies.warn("profile_photo_reference_count_failed", {
        profileId: target.id,
        photoPath: oldPhotoPathNormalized,
        error: error instanceof Error ? error.message : "unknown",
      });
      return { photoPath };
    }

    if (remainingReferences === 0) {
      try {
        await dependencies.storage.remove(oldPhotoPathNormalized);
      } catch (error) {
        dependencies.warn("profile_photo_old_object_removal_failed", {
          profileId: target.id,
          photoPath: oldPhotoPathNormalized,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }
  }

  return { photoPath };
}
