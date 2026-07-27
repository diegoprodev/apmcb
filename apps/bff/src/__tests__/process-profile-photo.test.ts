import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import sharp from "sharp";
import {
  PROFILE_PHOTO_FILE_LIMIT_BYTES,
} from "../middleware/request-body-limit.ts";
import {
  processProfilePhoto,
  type ProfilePhotoError,
} from "../domain/profile-photo/process-profile-photo.ts";

async function noisyImage(
  format: "jpeg" | "png",
  width: number,
  height: number,
) {
  const input = randomBytes(width * height * 3);
  const pipeline = sharp(input, {
    raw: { width, height, channels: 3 },
  });

  return format === "jpeg"
    ? pipeline.jpeg({ quality: 100 }).toBuffer()
    : pipeline.png({ compressionLevel: 0 }).toBuffer();
}

function hasCode(code: ProfilePhotoError["code"]) {
  return (error: unknown) =>
    error instanceof Error &&
    "code" in error &&
    (error as ProfilePhotoError).code === code;
}

describe("processProfilePhoto", () => {
  for (const [format, width, height] of [
    ["jpeg", 1600, 1600],
    ["png", 1280, 1280],
  ] as const) {
    it(`converte ${format.toUpperCase()} bruto de vários MiB para WebP <=150 KB`, async () => {
      const input = await noisyImage(format, width, height);
      assert.ok(input.byteLength > 3 * 1024 * 1024);
      assert.ok(input.byteLength <= PROFILE_PHOTO_FILE_LIMIT_BYTES);

      const result = await processProfilePhoto(input);
      const metadata = await sharp(result.bytes).metadata();

      assert.equal(result.mime, "image/webp");
      assert.equal(metadata.format, "webp");
      assert.ok(result.size <= 150 * 1024);
      assert.ok((metadata.width ?? Infinity) <= 512);
      assert.ok((metadata.height ?? Infinity) <= 512);
    });
  }

  it("corrige orientação EXIF antes do resize", async () => {
    const input = await sharp({
      create: {
        width: 800,
        height: 400,
        channels: 3,
        background: "#336699",
      },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const result = await processProfilePhoto(input);

    assert.ok(result.height > result.width);
    assert.equal(result.height, 512);
    assert.equal(result.width, 256);
  });

  it("não amplia imagem menor que 512 px", async () => {
    const input = await sharp({
      create: {
        width: 128,
        height: 64,
        channels: 3,
        background: "#112233",
      },
    })
      .png()
      .toBuffer();

    const result = await processProfilePhoto(input);

    assert.equal(result.width, 128);
    assert.equal(result.height, 64);
  });

  it("rejeita bytes falsos mesmo com nome/MIME declarado fora do domínio", async () => {
    await assert.rejects(
      processProfilePhoto(Buffer.from("not-an-image")),
      hasCode("PROFILE_PHOTO_INVALID"),
    );
  });

  it("rejeita formatos não permitidos e imagem animada", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32"/></svg>',
    );
    const animatedGif = await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 4,
        background: "#ff0000",
      },
    })
      .gif()
      .toBuffer();

    await assert.rejects(
      processProfilePhoto(svg),
      hasCode("PROFILE_PHOTO_INVALID"),
    );
    await assert.rejects(
      processProfilePhoto(animatedGif),
      hasCode("PROFILE_PHOTO_INVALID"),
    );
  });

  it("rejeita input acima de 5 MiB antes de decodificar", async () => {
    await assert.rejects(
      processProfilePhoto(new Uint8Array(PROFILE_PHOTO_FILE_LIMIT_BYTES + 1)),
      hasCode("PROFILE_PHOTO_INPUT_TOO_LARGE"),
    );
  });

  it("rejeita imagem acima de 40 milhões de pixels", async () => {
    const oversizedSvg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="7000" height="6000"><rect width="7000" height="6000"/></svg>',
    );

    await assert.rejects(
      processProfilePhoto(oversizedSvg),
      hasCode("PROFILE_PHOTO_PIXELS_EXCEEDED"),
    );
  });
});
