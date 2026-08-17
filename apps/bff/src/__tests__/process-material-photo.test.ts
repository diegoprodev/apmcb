import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import sharp from "sharp";
import {
  MATERIAL_PHOTO_FILE_LIMIT_BYTES,
} from "../middleware/request-body-limit.ts";
import {
  materialPhotoErrorStatus,
  processMaterialPhoto,
  type MaterialPhotoError,
  type MaterialPhotoErrorCode,
} from "../domain/material-photo/process-material-photo.ts";

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

function hasCode(code: MaterialPhotoError["code"]) {
  return (error: unknown) =>
    error instanceof Error &&
    "code" in error &&
    (error as MaterialPhotoError).code === code;
}

describe("processMaterialPhoto", () => {
  for (const [format, width, height] of [
    ["jpeg", 1600, 1600],
    ["png", 1280, 1280],
  ] as const) {
    it(`converte ${format.toUpperCase()} bruto de vários MiB para WebP <=400 KB`, async () => {
      const input = await noisyImage(format, width, height);
      assert.ok(input.byteLength <= MATERIAL_PHOTO_FILE_LIMIT_BYTES);

      const result = await processMaterialPhoto(input);
      const metadata = await sharp(result.bytes).metadata();

      assert.equal(result.mime, "image/webp");
      assert.equal(metadata.format, "webp");
      assert.ok(result.size <= 400 * 1024);
      assert.ok((metadata.width ?? Infinity) <= 1280);
      assert.ok((metadata.height ?? Infinity) <= 1280);
    });
  }

  it("preserva o aspect ratio original (sem crop quadrado forçado)", async () => {
    const input = await sharp({
      create: {
        width: 1920,
        height: 1080,
        channels: 3,
        background: "#445566",
      },
    })
      .jpeg()
      .toBuffer();

    const result = await processMaterialPhoto(input);

    // 1920x1080 é 16:9 — "fit inside" com maxDimension=1280 produz 1280x720
    assert.equal(result.width, 1280);
    assert.equal(result.height, 720);
  });

  it("corrige orientação EXIF antes do resize", async () => {
    const input = await sharp({
      create: {
        width: 1600,
        height: 800,
        channels: 3,
        background: "#336699",
      },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const result = await processMaterialPhoto(input);

    assert.ok(result.height > result.width);
  });

  it("não amplia imagem menor que o cap de dimensão", async () => {
    const input = await sharp({
      create: {
        width: 320,
        height: 240,
        channels: 3,
        background: "#112233",
      },
    })
      .png()
      .toBuffer();

    const result = await processMaterialPhoto(input);

    assert.equal(result.width, 320);
    assert.equal(result.height, 240);
  });

  it("rejeita bytes falsos mesmo com nome/MIME declarado fora do domínio", async () => {
    await assert.rejects(
      processMaterialPhoto(Buffer.from("not-an-image")),
      hasCode("MATERIAL_PHOTO_INVALID"),
    );
  });

  it("rejeita arquivo vazio", async () => {
    await assert.rejects(
      processMaterialPhoto(new Uint8Array(0)),
      hasCode("MATERIAL_PHOTO_INVALID"),
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
      processMaterialPhoto(svg),
      hasCode("MATERIAL_PHOTO_INVALID"),
    );
    await assert.rejects(
      processMaterialPhoto(animatedGif),
      hasCode("MATERIAL_PHOTO_INVALID"),
    );
  });

  it("rejeita input acima de 5 MiB antes de decodificar", async () => {
    await assert.rejects(
      processMaterialPhoto(new Uint8Array(MATERIAL_PHOTO_FILE_LIMIT_BYTES + 1)),
      hasCode("MATERIAL_PHOTO_INPUT_TOO_LARGE"),
    );
  });

  it("rejeita imagem acima de 40 milhões de pixels", async () => {
    const oversizedSvg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="7000" height="6000"><rect width="7000" height="6000"/></svg>',
    );

    await assert.rejects(
      processMaterialPhoto(oversizedSvg),
      hasCode("MATERIAL_PHOTO_PIXELS_EXCEEDED"),
    );
  });
});

describe("materialPhotoErrorStatus", () => {
  // Achado de code review: a rota (arsenal.ts) mapeava code→status inline
  // num ternário aninhado — um reordenamento futuro (ex: trocar a ordem dos
  // dois primeiros ramos) inverteria silenciosamente 413/422 sem que nenhum
  // teste pegasse, já que a rota HTTP em si não é testável sem credenciais
  // reais do Supabase (o singleton em services/supabase.ts é importado no
  // topo de arsenal.ts e falha ao importar sem SUPABASE_URL/SERVICE_ROLE_KEY
  // — nenhum teste desta suíte carrega esses secrets de propósito). Extrair
  // o mapeamento como função pura fecha esse gap sem exigir Supabase real.
  const cases: [MaterialPhotoErrorCode, 400 | 413 | 422][] = [
    ["MATERIAL_PHOTO_INPUT_TOO_LARGE", 413],
    ["MATERIAL_PHOTO_OUTPUT_TOO_LARGE", 422],
    ["MATERIAL_PHOTO_INVALID", 400],
    ["MATERIAL_PHOTO_PIXELS_EXCEEDED", 400],
  ];

  for (const [code, expectedStatus] of cases) {
    it(`mapeia ${code} para ${expectedStatus}`, () => {
      assert.equal(materialPhotoErrorStatus(code), expectedStatus);
    });
  }
});
