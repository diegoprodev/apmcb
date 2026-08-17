import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";

export const API_BODY_LIMIT_BYTES = 2 * 1024 * 1024;
export const PROFILE_PHOTO_FILE_LIMIT_BYTES = 5 * 1024 * 1024;
export const PROFILE_PHOTO_MULTIPART_OVERHEAD_BYTES = 64 * 1024;
export const PROFILE_PHOTO_REQUEST_LIMIT_BYTES =
  PROFILE_PHOTO_FILE_LIMIT_BYTES + PROFILE_PHOTO_MULTIPART_OVERHEAD_BYTES;

// Material photos (arsenal, ver domain/material-photo/process-material-photo.ts)
// joined the same "raw upload allowed through at the edge, compressed by
// Sharp in the BFF before Storage" pattern as profile photos — same 5 MiB
// raw-file ceiling and multipart overhead today, but routed through its OWN
// bodyLimit instance below (materialPhotoBodyLimit), never through
// profilePhotoBodyLimit — kept as a fully distinct constant + middleware
// instance (not an alias/shared instance) specifically so that changing
// PROFILE_PHOTO_FILE_LIMIT_BYTES later can never silently resize the
// material-photo ceiling (or vice versa) as a side effect of the OR-chain
// below matching both paths.
export const MATERIAL_PHOTO_FILE_LIMIT_BYTES = 5 * 1024 * 1024;
export const MATERIAL_PHOTO_REQUEST_LIMIT_BYTES =
  MATERIAL_PHOTO_FILE_LIMIT_BYTES + PROFILE_PHOTO_MULTIPART_OVERHEAD_BYTES;

const PROFILE_PHOTO_TARGET_PATH = /^\/api\/profiles\/[^/]+\/photo$/;
const MATERIAL_PHOTO_TARGET_PATH = "/api/arsenal/material-photo";

// Name kept as-is (not renamed to something generic like isPhotoUploadRequest)
// so this diff doesn't ripple into the existing test suite that imports it.
// Only matches profile-photo paths — material-photo has its own matcher
// below so each upload type keeps an independent body-size policy.
export function isProfilePhotoUploadRequest(method: string, path: string) {
  if (method.toUpperCase() !== "POST") return false;

  return (
    path === "/api/profiles/me/photo" ||
    path === "/api/admin/upload-photo" ||
    PROFILE_PHOTO_TARGET_PATH.test(path)
  );
}

export function isMaterialPhotoUploadRequest(method: string, path: string) {
  return method.toUpperCase() === "POST" && path === MATERIAL_PHOTO_TARGET_PATH;
}

const commonApiBodyLimit = bodyLimit({
  maxSize: API_BODY_LIMIT_BYTES,
});

const profilePhotoBodyLimit = bodyLimit({
  maxSize: PROFILE_PHOTO_REQUEST_LIMIT_BYTES,
});

const materialPhotoBodyLimit = bodyLimit({
  maxSize: MATERIAL_PHOTO_REQUEST_LIMIT_BYTES,
});

export const requestBodyLimitMiddleware: MiddlewareHandler = (c, next) => {
  if (isMaterialPhotoUploadRequest(c.req.method, c.req.path)) {
    return materialPhotoBodyLimit(c, next);
  }
  const limit = isProfilePhotoUploadRequest(c.req.method, c.req.path)
    ? profilePhotoBodyLimit
    : commonApiBodyLimit;

  return limit(c, next);
};
