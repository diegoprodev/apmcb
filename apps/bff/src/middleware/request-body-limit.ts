import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";

export const API_BODY_LIMIT_BYTES = 2 * 1024 * 1024;
export const PROFILE_PHOTO_FILE_LIMIT_BYTES = 5 * 1024 * 1024;
export const PROFILE_PHOTO_MULTIPART_OVERHEAD_BYTES = 64 * 1024;
export const PROFILE_PHOTO_REQUEST_LIMIT_BYTES =
  PROFILE_PHOTO_FILE_LIMIT_BYTES + PROFILE_PHOTO_MULTIPART_OVERHEAD_BYTES;

const PROFILE_PHOTO_TARGET_PATH = /^\/api\/profiles\/[^/]+\/photo$/;

export function isProfilePhotoUploadRequest(method: string, path: string) {
  if (method.toUpperCase() !== "POST") return false;

  return (
    path === "/api/profiles/me/photo" ||
    path === "/api/admin/upload-photo" ||
    PROFILE_PHOTO_TARGET_PATH.test(path)
  );
}

const commonApiBodyLimit = bodyLimit({
  maxSize: API_BODY_LIMIT_BYTES,
});

const profilePhotoBodyLimit = bodyLimit({
  maxSize: PROFILE_PHOTO_REQUEST_LIMIT_BYTES,
});

export const requestBodyLimitMiddleware: MiddlewareHandler = (c, next) => {
  const limit = isProfilePhotoUploadRequest(c.req.method, c.req.path)
    ? profilePhotoBodyLimit
    : commonApiBodyLimit;

  return limit(c, next);
};
