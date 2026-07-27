import { normalizeProfilePhotoReference } from "./profile-photo-reference.ts";

const PROFILE_PHOTO_SIGNED_URL_TTL_SECONDS = 3_600;
const PROFILE_PHOTO_STAFF_ROLES = new Set([
  "admin_global",
  "admin_reserva",
  "armeiro",
]);

export type ProfilePhotoReadDependencies = {
  supabaseUrl: string;
  now?: () => Date;
  profiles: {
    findForPhotoRead: (input: {
      profileId: string;
      tenantId: string | null;
      ownProfile: boolean;
    }) => Promise<{
      id: string;
      photoReferenceRaw: string | null;
    } | null>;
  };
  storage: {
    createSignedUrl: (
      photoPath: string,
      expiresInSeconds: number,
    ) => Promise<string>;
  };
};

export type ProfilePhotoReadErrorCode =
  | "PROFILE_PHOTO_FORBIDDEN"
  | "PROFILE_PHOTO_TARGET_NOT_FOUND"
  | "PROFILE_PHOTO_INVALID_REFERENCE"
  | "PROFILE_PHOTO_SIGN_FAILED";

export class ProfilePhotoReadError extends Error {
  readonly code: ProfilePhotoReadErrorCode;

  constructor(code: ProfilePhotoReadErrorCode, message: string) {
    super(message);
    this.name = "ProfilePhotoReadError";
    this.code = code;
  }
}

export async function resolveProfilePhotoUrl(
  input: {
    actor: {
      userId: string;
      role: string;
      tenantId: string | null;
    };
    targetProfileId: string;
  },
  dependencies: ProfilePhotoReadDependencies,
) {
  const ownProfile = input.actor.userId === input.targetProfileId;
  if (!ownProfile && !PROFILE_PHOTO_STAFF_ROLES.has(input.actor.role)) {
    throw new ProfilePhotoReadError(
      "PROFILE_PHOTO_FORBIDDEN",
      "Sem permissão",
    );
  }
  if (!ownProfile && !input.actor.tenantId) {
    throw new ProfilePhotoReadError(
      "PROFILE_PHOTO_TARGET_NOT_FOUND",
      "Perfil não encontrado",
    );
  }

  const profile = await dependencies.profiles.findForPhotoRead({
    profileId: input.targetProfileId,
    tenantId: ownProfile ? null : input.actor.tenantId,
    ownProfile,
  });
  if (!profile) {
    throw new ProfilePhotoReadError(
      "PROFILE_PHOTO_TARGET_NOT_FOUND",
      "Perfil não encontrado",
    );
  }
  if (profile.photoReferenceRaw === null) {
    return {
      profileId: profile.id,
      photoPath: null,
      signedUrl: null,
      expiresAt: null,
    };
  }

  const photoPath = normalizeProfilePhotoReference(
    profile.photoReferenceRaw,
    dependencies.supabaseUrl,
  );
  if (!photoPath) {
    throw new ProfilePhotoReadError(
      "PROFILE_PHOTO_INVALID_REFERENCE",
      "Referência de foto inválida",
    );
  }

  let signedUrl: string;
  try {
    signedUrl = await dependencies.storage.createSignedUrl(
      photoPath,
      PROFILE_PHOTO_SIGNED_URL_TTL_SECONDS,
    );
  } catch {
    throw new ProfilePhotoReadError(
      "PROFILE_PHOTO_SIGN_FAILED",
      "Não foi possível resolver a foto",
    );
  }

  return {
    profileId: profile.id,
    photoPath,
    signedUrl,
    expiresAt: new Date(
      (dependencies.now ?? (() => new Date()))().getTime() +
        PROFILE_PHOTO_SIGNED_URL_TTL_SECONDS * 1_000,
    ).toISOString(),
  };
}
