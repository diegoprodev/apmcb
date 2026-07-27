import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeProfilePhotoReference,
} from "../domain/profile-photo/profile-photo-reference.ts";

const SUPABASE_URL = "https://project-ref.supabase.co";

describe("normalizeProfilePhotoReference", () => {
  it("preserva path relativo válido", () => {
    assert.equal(
      normalizeProfilePhotoReference("profile-id/photo-id.webp", SUPABASE_URL),
      "profile-id/photo-id.webp",
    );
  });

  it("normaliza URL pública legada do host e bucket esperados", () => {
    const oldPhotoReferenceRaw =
      `${SUPABASE_URL}/storage/v1/object/public/profile-photos/abc/profile.jpg`;

    const oldPhotoPathNormalized = normalizeProfilePhotoReference(
      oldPhotoReferenceRaw,
      SUPABASE_URL,
    );

    assert.equal(oldPhotoPathNormalized, "abc/profile.jpg");
    assert.equal(
      oldPhotoReferenceRaw,
      `${SUPABASE_URL}/storage/v1/object/public/profile-photos/abc/profile.jpg`,
    );
  });

  it("normaliza URL signed válida sem persistir o token", () => {
    assert.equal(
      normalizeProfilePhotoReference(
        `${SUPABASE_URL}/storage/v1/object/sign/profile-photos/abc/profile.webp?token=secret`,
        SUPABASE_URL,
      ),
      "abc/profile.webp",
    );
  });

  for (const invalid of [
    "../profile.webp",
    "abc/../profile.webp",
    "abc\\profile.webp",
    "abc/profile.webp?token=x",
    "abc/profile.webp#fragment",
    "abc//profile.webp",
    "https://evil.example/storage/v1/object/public/profile-photos/abc/profile.webp",
    `${SUPABASE_URL}/storage/v1/object/public/material-photos/abc/profile.webp`,
    `${SUPABASE_URL}/storage/v1/object/public/profile-photos/%2e%2e/profile.webp`,
    `${SUPABASE_URL}/storage/v1/object/public/profile-photos/abc%2Fprofile.webp`,
  ]) {
    it(`rejeita referência não confiável: ${invalid}`, () => {
      assert.equal(
        normalizeProfilePhotoReference(invalid, SUPABASE_URL),
        null,
      );
    });
  }

  it("trata nulo e vazio como ausência de foto", () => {
    assert.equal(normalizeProfilePhotoReference(null, SUPABASE_URL), null);
    assert.equal(normalizeProfilePhotoReference("", SUPABASE_URL), null);
  });
});
