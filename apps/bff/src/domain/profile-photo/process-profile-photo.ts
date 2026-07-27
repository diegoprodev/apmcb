import sharp from "sharp";
import { PROFILE_PHOTO_FILE_LIMIT_BYTES } from "../../middleware/request-body-limit.ts";

const PROFILE_PHOTO_PIXEL_LIMIT = 40_000_000;
const PROFILE_PHOTO_TARGET_BYTES = 100 * 1024;
const PROFILE_PHOTO_OUTPUT_LIMIT_BYTES = 150 * 1024;
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

export type ProfilePhotoErrorCode =
  | "PROFILE_PHOTO_INPUT_TOO_LARGE"
  | "PROFILE_PHOTO_INVALID"
  | "PROFILE_PHOTO_PIXELS_EXCEEDED"
  | "PROFILE_PHOTO_OUTPUT_TOO_LARGE";

export class ProfilePhotoError extends Error {
  readonly code: ProfilePhotoErrorCode;

  constructor(code: ProfilePhotoErrorCode, message: string) {
    super(message);
    this.name = "ProfilePhotoError";
    this.code = code;
  }
}

export type ProcessedProfilePhoto = {
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
  dimension: number,
  quality: number,
): Promise<ProcessedProfilePhoto> {
  const bytes = await sharp(source, {
    limitInputPixels: PROFILE_PHOTO_PIXEL_LIMIT,
    animated: false,
  })
    .autoOrient()
    .resize({
      width: dimension,
      height: dimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality })
    .toBuffer();
  const metadata = await sharp(bytes).metadata();

  if (!metadata.width || !metadata.height) {
    throw new ProfilePhotoError(
      "PROFILE_PHOTO_INVALID",
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

export async function processProfilePhoto(
  input: Uint8Array,
): Promise<ProcessedProfilePhoto> {
  if (input.byteLength === 0) {
    throw new ProfilePhotoError(
      "PROFILE_PHOTO_INVALID",
      "O arquivo de foto está vazio",
    );
  }
  if (input.byteLength > PROFILE_PHOTO_FILE_LIMIT_BYTES) {
    throw new ProfilePhotoError(
      "PROFILE_PHOTO_INPUT_TOO_LARGE",
      "A foto excede o limite de 5 MiB",
    );
  }

  const source = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(source, {
      limitInputPixels: PROFILE_PHOTO_PIXEL_LIMIT,
      animated: true,
    }).metadata();
  } catch (error) {
    if (isPixelLimitError(error)) {
      throw new ProfilePhotoError(
        "PROFILE_PHOTO_PIXELS_EXCEEDED",
        "A imagem excede o limite de 40 milhões de pixels",
      );
    }
    throw new ProfilePhotoError(
      "PROFILE_PHOTO_INVALID",
      "O arquivo não contém uma imagem válida",
    );
  }

  if (
    !metadata.format ||
    !ALLOWED_FORMATS.has(metadata.format) ||
    (metadata.pages ?? 1) > 1
  ) {
    throw new ProfilePhotoError(
      "PROFILE_PHOTO_INVALID",
      "Use uma imagem JPEG, PNG ou WebP não animada",
    );
  }

  let smallestAcceptable: ProcessedProfilePhoto | null = null;

  try {
    for (const quality of [80, 75, 70, 65]) {
      const candidate = await encodeCandidate(source, 512, quality);
      if (
        candidate.size <= PROFILE_PHOTO_OUTPUT_LIMIT_BYTES &&
        (!smallestAcceptable || candidate.size < smallestAcceptable.size)
      ) {
        smallestAcceptable = candidate;
      }
      if (candidate.size <= PROFILE_PHOTO_TARGET_BYTES) {
        return candidate;
      }
    }

    if (smallestAcceptable) return smallestAcceptable;

    for (const dimension of [448, 384, 320, 256]) {
      const candidate = await encodeCandidate(source, dimension, 65);
      if (candidate.size <= PROFILE_PHOTO_OUTPUT_LIMIT_BYTES) {
        return candidate;
      }
    }
  } catch (error) {
    if (error instanceof ProfilePhotoError) throw error;
    if (isPixelLimitError(error)) {
      throw new ProfilePhotoError(
        "PROFILE_PHOTO_PIXELS_EXCEEDED",
        "A imagem excede o limite de 40 milhões de pixels",
      );
    }
    throw new ProfilePhotoError(
      "PROFILE_PHOTO_INVALID",
      "Não foi possível processar a imagem",
    );
  }

  throw new ProfilePhotoError(
    "PROFILE_PHOTO_OUTPUT_TOO_LARGE",
    "Não foi possível reduzir a foto para 150 KB",
  );
}
