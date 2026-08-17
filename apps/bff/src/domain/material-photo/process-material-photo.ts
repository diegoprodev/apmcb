import sharp from "sharp";
import { MATERIAL_PHOTO_FILE_LIMIT_BYTES } from "../../middleware/request-body-limit.ts";

// Material photos are pictures of physical weapons/equipment (armas,
// coletes, viaturas, etc.), not square avatars — unlike profile photos we
// do NOT force a square crop, only a "fit inside" resize that preserves
// aspect ratio. 1280px on the longest side is generous enough to still show
// serial numbers/damage detail on zoom while capping the worst case (a
// 12MP+ phone photo) to a small fraction of its original pixel count.
// Storage/egress is billed by bytes, not pixels, so the WebP quality ladder
// below — not the dimension cap — is what actually controls cost; the
// target/hard-cap are higher than profile-photo's (100KB/150KB) because
// these images need to preserve enough detail to be useful as evidence
// (ocorrência de dano/furto) or a catalog photo, and there are far fewer of
// them than profile photos.
const MATERIAL_PHOTO_PIXEL_LIMIT = 40_000_000; // same decompression-bomb guard as profile photos
const MATERIAL_PHOTO_MAX_DIMENSION = 1280;
const MATERIAL_PHOTO_TARGET_BYTES = 300 * 1024; // soft target — first candidate at/under this wins
const MATERIAL_PHOTO_OUTPUT_LIMIT_BYTES = 400 * 1024; // hard cap — smallest candidate under this is accepted even if above target
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

export type MaterialPhotoErrorCode =
  | "MATERIAL_PHOTO_INPUT_TOO_LARGE"
  | "MATERIAL_PHOTO_INVALID"
  | "MATERIAL_PHOTO_PIXELS_EXCEEDED"
  | "MATERIAL_PHOTO_OUTPUT_TOO_LARGE";

export class MaterialPhotoError extends Error {
  readonly code: MaterialPhotoErrorCode;

  constructor(code: MaterialPhotoErrorCode, message: string) {
    super(message);
    this.name = "MaterialPhotoError";
    this.code = code;
  }
}

// Pure code→status mapping, factored out of the route handler (arsenal.ts)
// specifically so it's unit-testable without a Hono app or a Supabase
// client: the route handler that consumes this touches the real
// service-role Supabase singleton at import time, which this test suite
// deliberately never does (every existing BFF test is a dependency-free
// domain-level test — see profile-photo-routes.test.ts, which tests
// resolveProfilePhotoUrl with injected fakes rather than the Hono route
// itself). Keeping the status mapping here, not inline in a ternary in the
// route, means a future reordering mistake (e.g. swapping 413/422) is
// caught by the test below instead of only surfacing as a silently wrong
// HTTP status in production.
export function materialPhotoErrorStatus(
  code: MaterialPhotoErrorCode,
): 400 | 413 | 422 {
  switch (code) {
    case "MATERIAL_PHOTO_INPUT_TOO_LARGE":
      return 413;
    case "MATERIAL_PHOTO_OUTPUT_TOO_LARGE":
      return 422;
    case "MATERIAL_PHOTO_INVALID":
    case "MATERIAL_PHOTO_PIXELS_EXCEEDED":
      return 400;
    default: {
      // Exhaustiveness check: a future MaterialPhotoErrorCode added to the
      // union without a case here fails to COMPILE (never types as `never`)
      // instead of silently falling through to 400 — closes the exact class
      // of gap flagged in code review for the pre-switch if/else fallback.
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

export type ProcessedMaterialPhoto = {
  bytes: Uint8Array;
  mime: "image/webp";
  width: number;
  height: number;
  size: number;
  quality: number;
};

function isPixelLimitError(error: unknown) {
  return (
    error instanceof Error &&
    /pixel limit|exceeds.*pixels|too many pixels/i.test(error.message)
  );
}

async function encodeCandidate(
  source: Buffer,
  maxDimension: number,
  quality: number,
): Promise<ProcessedMaterialPhoto> {
  const bytes = await sharp(source, {
    limitInputPixels: MATERIAL_PHOTO_PIXEL_LIMIT,
    animated: false,
  })
    .autoOrient()
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality })
    .toBuffer();
  const metadata = await sharp(bytes).metadata();

  if (!metadata.width || !metadata.height) {
    throw new MaterialPhotoError(
      "MATERIAL_PHOTO_INVALID",
      "A imagem processada não possui dimensões válidas",
    );
  }

  return {
    bytes,
    mime: "image/webp",
    width: metadata.width,
    height: metadata.height,
    size: bytes.byteLength,
    quality,
  };
}

export async function processMaterialPhoto(
  input: Uint8Array,
): Promise<ProcessedMaterialPhoto> {
  if (input.byteLength === 0) {
    throw new MaterialPhotoError(
      "MATERIAL_PHOTO_INVALID",
      "O arquivo de foto está vazio",
    );
  }
  if (input.byteLength > MATERIAL_PHOTO_FILE_LIMIT_BYTES) {
    throw new MaterialPhotoError(
      "MATERIAL_PHOTO_INPUT_TOO_LARGE",
      "A foto excede o limite de 5 MiB",
    );
  }

  const source = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(source, {
      limitInputPixels: MATERIAL_PHOTO_PIXEL_LIMIT,
      animated: true,
    }).metadata();
  } catch (error) {
    if (isPixelLimitError(error)) {
      throw new MaterialPhotoError(
        "MATERIAL_PHOTO_PIXELS_EXCEEDED",
        "A imagem excede o limite de 40 milhões de pixels",
      );
    }
    throw new MaterialPhotoError(
      "MATERIAL_PHOTO_INVALID",
      "O arquivo não contém uma imagem válida",
    );
  }

  if (
    !metadata.format ||
    !ALLOWED_FORMATS.has(metadata.format) ||
    (metadata.pages ?? 1) > 1
  ) {
    throw new MaterialPhotoError(
      "MATERIAL_PHOTO_INVALID",
      "Use uma imagem JPEG, PNG ou WebP não animada",
    );
  }

  let smallestAcceptable: ProcessedMaterialPhoto | null = null;

  try {
    for (const quality of [80, 72, 64, 56]) {
      const candidate = await encodeCandidate(
        source,
        MATERIAL_PHOTO_MAX_DIMENSION,
        quality,
      );
      if (
        candidate.size <= MATERIAL_PHOTO_OUTPUT_LIMIT_BYTES &&
        (!smallestAcceptable || candidate.size < smallestAcceptable.size)
      ) {
        smallestAcceptable = candidate;
      }
      if (candidate.size <= MATERIAL_PHOTO_TARGET_BYTES) {
        return candidate;
      }
    }

    if (smallestAcceptable) return smallestAcceptable;

    for (const dimension of [1152, 1024, 896, 768, 640]) {
      const candidate = await encodeCandidate(source, dimension, 56);
      if (candidate.size <= MATERIAL_PHOTO_OUTPUT_LIMIT_BYTES) {
        return candidate;
      }
    }
  } catch (error) {
    if (error instanceof MaterialPhotoError) throw error;
    if (isPixelLimitError(error)) {
      throw new MaterialPhotoError(
        "MATERIAL_PHOTO_PIXELS_EXCEEDED",
        "A imagem excede o limite de 40 milhões de pixels",
      );
    }
    throw new MaterialPhotoError(
      "MATERIAL_PHOTO_INVALID",
      "Não foi possível processar a imagem",
    );
  }

  throw new MaterialPhotoError(
    "MATERIAL_PHOTO_OUTPUT_TOO_LARGE",
    "Não foi possível reduzir a foto para 400 KB",
  );
}
