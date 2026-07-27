import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ProfilePhotoReplaceError,
  replaceProfilePhoto,
  type ProfilePhotoDependencies,
  type ProfilePhotoRecord,
} from "../domain/profile-photo/replace-profile-photo.ts";

const SUPABASE_URL = "https://project-ref.supabase.co";
const ACTOR = {
  userId: "profile-id",
  role: "usuario",
  tenantId: "tenant-id",
};
const PROCESSED = {
  bytes: new Uint8Array([1, 2, 3]),
  mime: "image/webp" as const,
  width: 100,
  height: 100,
  size: 3,
  quality: 80,
};

function hasCode(code: ProfilePhotoReplaceError["code"]) {
  return (error: unknown) =>
    error instanceof ProfilePhotoReplaceError && error.code === code;
}

function createDependencies(
  initialReference: string | null = "profile-id/old.webp",
) {
  let currentReference = initialReference;
  const uploaded: string[] = [];
  const removed: string[] = [];
  const casInputs: Array<{
    oldPhotoReferenceRaw: string | null;
    newPhotoPath: string;
  }> = [];
  const countInputs: string[] = [];
  let uuidCounter = 0;

  const profile: ProfilePhotoRecord = {
    id: "profile-id",
    defaultTenantId: "tenant-id",
    photoReferenceRaw: initialReference,
  };

  const dependencies: ProfilePhotoDependencies = {
    supabaseUrl: SUPABASE_URL,
    createUuid: () => `uuid-${++uuidCounter}`,
    process: async () => PROCESSED,
    profiles: {
      findById: async () => ({
        ...profile,
        photoReferenceRaw: currentReference,
      }),
      compareAndSwap: async (input) => {
        casInputs.push(input);
        if (currentReference !== input.oldPhotoReferenceRaw) return false;
        currentReference = input.newPhotoPath;
        return true;
      },
      countNormalizedReferences: async (path) => {
        countInputs.push(path);
        return currentReference === path ? 1 : 0;
      },
    },
    storage: {
      upload: async (path) => {
        uploaded.push(path);
      },
      remove: async (path) => {
        removed.push(path);
      },
    },
    warn: () => undefined,
  };

  return {
    dependencies,
    uploaded,
    removed,
    casInputs,
    countInputs,
    current: () => currentReference,
  };
}

describe("replaceProfilePhoto", () => {
  it("autoriza somente self ou staff do mesmo tenant", async () => {
    const denied = createDependencies();
    await assert.rejects(
      replaceProfilePhoto(
        {
          actor: {
            userId: "other-profile",
            role: "usuario",
            tenantId: "tenant-id",
          },
          targetProfileId: "profile-id",
          rawBytes: new Uint8Array([9]),
        },
        denied.dependencies,
      ),
      hasCode("PROFILE_PHOTO_FORBIDDEN"),
    );
    assert.deepEqual(denied.uploaded, []);

    const crossTenant = createDependencies();
    await assert.rejects(
      replaceProfilePhoto(
        {
          actor: {
            userId: "staff-profile",
            role: "admin_reserva",
            tenantId: "other-tenant",
          },
          targetProfileId: "profile-id",
          rawBytes: new Uint8Array([9]),
        },
        crossTenant.dependencies,
      ),
      hasCode("PROFILE_PHOTO_TARGET_NOT_FOUND"),
    );
    assert.deepEqual(crossTenant.uploaded, []);

    const sameTenant = createDependencies();
    const result = await replaceProfilePhoto(
      {
        actor: {
          userId: "staff-profile",
          role: "armeiro",
          tenantId: "tenant-id",
        },
        targetProfileId: "profile-id",
        rawBytes: new Uint8Array([9]),
      },
      sameTenant.dependencies,
    );
    assert.equal(result.photoPath, "profile-id/uuid-1.webp");
  });

  it("faz upload imutável, CAS e só então remove o objeto antigo sem referência", async () => {
    const harness = createDependencies();

    const result = await replaceProfilePhoto(
      {
        actor: ACTOR,
        targetProfileId: "profile-id",
        rawBytes: new Uint8Array([9]),
      },
      harness.dependencies,
    );

    assert.equal(result.photoPath, "profile-id/uuid-1.webp");
    assert.deepEqual(harness.uploaded, ["profile-id/uuid-1.webp"]);
    assert.deepEqual(harness.removed, ["profile-id/old.webp"]);
    assert.equal(harness.current(), "profile-id/uuid-1.webp");
  });

  it("preserva o valor bruto legado no CAS e usa somente o normalizado no Storage", async () => {
    const oldPhotoReferenceRaw =
      `${SUPABASE_URL}/storage/v1/object/public/profile-photos/abc/profile.jpg`;
    const harness = createDependencies(oldPhotoReferenceRaw);

    await replaceProfilePhoto(
      {
        actor: ACTOR,
        targetProfileId: "profile-id",
        rawBytes: new Uint8Array([9]),
      },
      harness.dependencies,
    );

    assert.equal(
      harness.casInputs[0]?.oldPhotoReferenceRaw,
      oldPhotoReferenceRaw,
    );
    assert.deepEqual(harness.countInputs, ["abc/profile.jpg"]);
    assert.deepEqual(harness.removed, ["abc/profile.jpg"]);
  });

  it("recusa bytes vinculados a snapshot antigo antes de processar ou fazer upload", async () => {
    const harness = createDependencies("profile-id/current.webp");
    let processed = false;
    harness.dependencies.process = async () => {
      processed = true;
      return PROCESSED;
    };

    await assert.rejects(
      replaceProfilePhoto(
        {
          actor: ACTOR,
          targetProfileId: "profile-id",
          rawBytes: new Uint8Array([9]),
          expectedOldPhotoReferenceRaw: "profile-id/stale.webp",
        },
        harness.dependencies,
      ),
      hasCode("PROFILE_PHOTO_CONFLICT"),
    );

    assert.equal(processed, false);
    assert.deepEqual(harness.uploaded, []);
    assert.deepEqual(harness.removed, []);
    assert.equal(harness.current(), "profile-id/current.webp");
  });

  it("compensa o objeto novo quando o banco falha", async () => {
    const harness = createDependencies();
    harness.dependencies.profiles.compareAndSwap = async () => {
      throw new Error("database unavailable");
    };

    await assert.rejects(
      replaceProfilePhoto(
        {
          actor: ACTOR,
          targetProfileId: "profile-id",
          rawBytes: new Uint8Array([9]),
        },
        harness.dependencies,
      ),
      hasCode("PROFILE_PHOTO_UPDATE_FAILED"),
    );

    assert.deepEqual(harness.removed, ["profile-id/uuid-1.webp"]);
    assert.equal(harness.current(), "profile-id/old.webp");
  });

  it("não remove objeto antigo compartilhado ou quando a recontagem falha", async () => {
    const shared = createDependencies();
    shared.dependencies.profiles.countNormalizedReferences = async () => 1;
    await replaceProfilePhoto(
      {
        actor: ACTOR,
        targetProfileId: "profile-id",
        rawBytes: new Uint8Array([9]),
      },
      shared.dependencies,
    );
    assert.deepEqual(shared.removed, []);

    const inconclusive = createDependencies();
    inconclusive.dependencies.profiles.countNormalizedReferences = async () => {
      throw new Error("count failed");
    };
    await replaceProfilePhoto(
      {
        actor: ACTOR,
        targetProfileId: "profile-id",
        rawBytes: new Uint8Array([9]),
      },
      inconclusive.dependencies,
    );
    assert.deepEqual(inconclusive.removed, []);
  });

  it("mantém a nova foto quando a remoção antiga falha", async () => {
    const harness = createDependencies();
    harness.dependencies.storage.remove = async (path) => {
      if (path.endsWith("old.webp")) throw new Error("remove failed");
      harness.removed.push(path);
    };

    const result = await replaceProfilePhoto(
      {
        actor: ACTOR,
        targetProfileId: "profile-id",
        rawBytes: new Uint8Array([9]),
      },
      harness.dependencies,
    );

    assert.equal(result.photoPath, "profile-id/uuid-1.webp");
    assert.equal(harness.current(), result.photoPath);
  });

  it("duas trocas concorrentes têm uma vencedora e nunca removem o objeto vencedor", async () => {
    const harness = createDependencies();
    let bothProcessed = 0;
    let releaseProcessing!: () => void;
    const processingBarrier = new Promise<void>((resolve) => {
      releaseProcessing = resolve;
    });
    harness.dependencies.process = async () => {
      bothProcessed += 1;
      if (bothProcessed === 2) releaseProcessing();
      await processingBarrier;
      return PROCESSED;
    };

    const attempts = await Promise.allSettled([
      replaceProfilePhoto(
        {
          actor: ACTOR,
          targetProfileId: "profile-id",
          rawBytes: new Uint8Array([1]),
        },
        harness.dependencies,
      ),
      replaceProfilePhoto(
        {
          actor: ACTOR,
          targetProfileId: "profile-id",
          rawBytes: new Uint8Array([2]),
        },
        harness.dependencies,
      ),
    ]);

    const winner = attempts.find(
      (attempt): attempt is PromiseFulfilledResult<{ photoPath: string }> =>
        attempt.status === "fulfilled",
    );
    const conflict = attempts.find(
      (attempt): attempt is PromiseRejectedResult =>
        attempt.status === "rejected",
    );

    assert.ok(winner);
    assert.ok(conflict);
    assert.ok(hasCode("PROFILE_PHOTO_CONFLICT")(conflict.reason));
    assert.equal(harness.current(), winner.value.photoPath);
    assert.equal(harness.removed.includes(winner.value.photoPath), false);
    assert.equal(harness.uploaded.length, 2);
    assert.equal(
      harness.removed.filter((path) => path.includes("uuid-")).length,
      1,
    );
  });
});
