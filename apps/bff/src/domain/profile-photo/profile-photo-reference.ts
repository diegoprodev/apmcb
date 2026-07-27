const PROFILE_PHOTO_URL_PREFIXES = [
  "/storage/v1/object/public/profile-photos/",
  "/storage/v1/object/sign/profile-photos/",
] as const;

function normalizePath(path: string) {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("?") ||
    path.includes("#")
  ) {
    return null;
  }

  const normalizedSegments: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment) return null;

    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }

    if (
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\")
    ) {
      return null;
    }
    normalizedSegments.push(decoded);
  }

  return normalizedSegments.join("/");
}

export function normalizeProfilePhotoReference(
  reference: string | null | undefined,
  supabaseUrl: string,
) {
  if (!reference) return null;

  if (/^https?:\/\//i.test(reference)) {
    let referenceUrl: URL;
    let expectedOrigin: string;
    try {
      referenceUrl = new URL(reference);
      expectedOrigin = new URL(supabaseUrl).origin;
    } catch {
      return null;
    }

    if (
      referenceUrl.origin !== expectedOrigin ||
      referenceUrl.hash
    ) {
      return null;
    }

    const prefix = PROFILE_PHOTO_URL_PREFIXES.find((candidate) =>
      referenceUrl.pathname.startsWith(candidate),
    );
    if (!prefix) return null;

    return normalizePath(referenceUrl.pathname.slice(prefix.length));
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(reference)) return null;
  return normalizePath(reference);
}
