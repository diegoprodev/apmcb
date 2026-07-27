import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ProfilePhotoReadError,
  resolveProfilePhotoUrl,
  type ProfilePhotoReadDependencies,
} from "../domain/profile-photo/resolve-profile-photo-url.ts";

const SUPABASE_URL = "https://project-ref.supabase.co";

function dependencies(
  record: { id: string; photoReferenceRaw: string | null } | null,
) {
  const lookups: Array<{
    profileId: string;
    tenantId: string | null;
    ownProfile: boolean;
  }> = [];
  const signed: string[] = [];
  const value: ProfilePhotoReadDependencies = {
    supabaseUrl: SUPABASE_URL,
    now: () => new Date("2026-07-26T12:00:00.000Z"),
    profiles: {
      findForPhotoRead: async (input) => {
        lookups.push(input);
        return record;
      },
    },
    storage: {
      createSignedUrl: async (path) => {
        signed.push(path);
        return `https://signed.example/${path}`;
      },
    },
  };
  return { value, lookups, signed };
}

function hasCode(code: ProfilePhotoReadError["code"]) {
  return (error: unknown) =>
    error instanceof ProfilePhotoReadError && error.code === code;
}

describe("profile photo route policy", () => {
  it("permite self e normaliza URL pública legada", async () => {
    const harness = dependencies({
      id: "profile-a",
      photoReferenceRaw:
        `${SUPABASE_URL}/storage/v1/object/public/profile-photos/profile-a/a.jpg`,
    });

    const result = await resolveProfilePhotoUrl(
      {
        actor: { userId: "profile-a", role: "usuario", tenantId: "tenant-a" },
        targetProfileId: "profile-a",
      },
      harness.value,
    );

    assert.equal(result.photoPath, "profile-a/a.jpg");
    assert.equal(result.signedUrl, "https://signed.example/profile-a/a.jpg");
    assert.equal(result.expiresAt, "2026-07-26T13:00:00.000Z");
    assert.deepEqual(harness.lookups, [{
      profileId: "profile-a",
      tenantId: null,
      ownProfile: true,
    }]);
  });

  it("permite staff somente com lookup escopado ao tenant", async () => {
    const harness = dependencies({
      id: "profile-b",
      photoReferenceRaw: "profile-b/b.webp",
    });

    await resolveProfilePhotoUrl(
      {
        actor: {
          userId: "staff-a",
          role: "admin_reserva",
          tenantId: "tenant-a",
        },
        targetProfileId: "profile-b",
      },
      harness.value,
    );

    assert.deepEqual(harness.lookups, [{
      profileId: "profile-b",
      tenantId: "tenant-a",
      ownProfile: false,
    }]);
  });

  for (const role of ["usuario", "auditor", "superadmin"]) {
    it(`nega foto de terceiro para ${role} sem consultar o banco`, async () => {
      const harness = dependencies({
        id: "profile-b",
        photoReferenceRaw: "profile-b/b.webp",
      });

      await assert.rejects(
        resolveProfilePhotoUrl(
          {
            actor: { userId: "profile-a", role, tenantId: "tenant-a" },
            targetProfileId: "profile-b",
          },
          harness.value,
        ),
        hasCode("PROFILE_PHOTO_FORBIDDEN"),
      );
      assert.deepEqual(harness.lookups, []);
    });
  }

  it("retorna not-found genérico para staff sem tenant ou alvo fora do tenant", async () => {
    const withoutTenant = dependencies(null);
    await assert.rejects(
      resolveProfilePhotoUrl(
        {
          actor: {
            userId: "staff-a",
            role: "admin_global",
            tenantId: null,
          },
          targetProfileId: "profile-b",
        },
        withoutTenant.value,
      ),
      hasCode("PROFILE_PHOTO_TARGET_NOT_FOUND"),
    );
    assert.deepEqual(withoutTenant.lookups, []);

    const crossTenant = dependencies(null);
    await assert.rejects(
      resolveProfilePhotoUrl(
        {
          actor: {
            userId: "staff-a",
            role: "armeiro",
            tenantId: "tenant-a",
          },
          targetProfileId: "profile-b",
        },
        crossTenant.value,
      ),
      hasCode("PROFILE_PHOTO_TARGET_NOT_FOUND"),
    );
  });

  it("responde ausência sem assinar e rejeita referência corrompida", async () => {
    const absent = dependencies({
      id: "profile-a",
      photoReferenceRaw: null,
    });
    assert.deepEqual(
      await resolveProfilePhotoUrl(
        {
          actor: { userId: "profile-a", role: "usuario", tenantId: null },
          targetProfileId: "profile-a",
        },
        absent.value,
      ),
      {
        profileId: "profile-a",
        photoPath: null,
        signedUrl: null,
        expiresAt: null,
      },
    );
    assert.deepEqual(absent.signed, []);

    const corrupt = dependencies({
      id: "profile-a",
      photoReferenceRaw: "../other-tenant/photo.webp",
    });
    await assert.rejects(
      resolveProfilePhotoUrl(
        {
          actor: { userId: "profile-a", role: "usuario", tenantId: null },
          targetProfileId: "profile-a",
        },
        corrupt.value,
      ),
      hasCode("PROFILE_PHOTO_INVALID_REFERENCE"),
    );
    assert.deepEqual(corrupt.signed, []);
  });
});
