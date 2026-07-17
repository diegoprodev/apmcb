#!/usr/bin/env node
// Harness estático do plano de PWA (docs/superpowers/specs/
// 2026-07-17-pwa-native-boot-experience-design.md, seção 4.1) — falha o
// build se os ícones do manifest.webmanifest estiverem incorretos.
// Não valida comportamento do WebKit (ver seção 4.2) — só integridade dos
// arquivos: existência, dimensões reais batendo com o declarado, ícones
// quadrados de fato, apple-touch-icon sem canal alpha.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dirname, "..");
const publicDir = join(webRoot, "public");

function readPngHeader(absPath) {
  const buf = readFileSync(absPath);
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    colorType: buf.readUInt8(25),
  };
}

const errors = [];

// ── 1. manifest.webmanifest: ícones existem, dimensões batem, quadrados ──
const manifestPath = join(publicDir, "manifest.webmanifest");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

for (const icon of manifest.icons ?? []) {
  const absPath = join(publicDir, icon.src);
  if (!existsSync(absPath)) {
    errors.push(`manifest.webmanifest: ícone "${icon.src}" não existe em disco`);
    continue;
  }
  const { width, height } = readPngHeader(absPath);
  const [declaredW, declaredH] = icon.sizes.split("x").map(Number);
  if (width !== declaredW || height !== declaredH) {
    errors.push(
      `manifest.webmanifest: "${icon.src}" declarado ${icon.sizes} mas tem ${width}x${height} de verdade`
    );
  }
  if (width !== height) {
    errors.push(`manifest.webmanifest: "${icon.src}" deveria ser quadrado, é ${width}x${height}`);
  }
}

// ── 2. apple-touch-icon: existe, quadrado, SEM canal alpha ──
// iOS não respeita transparência em apple-touch-icon — sem achatar, pode
// renderizar preto onde deveria ser opaco (achado real desta sessão,
// confirmado contra public/images/logo.png que tem alpha).
const appleTouchIconPath = join(publicDir, "images/pwa/apple-touch-icon-180x180.png");
if (!existsSync(appleTouchIconPath)) {
  errors.push("apple-touch-icon-180x180.png não existe em public/images/pwa/");
} else {
  const { width, height, colorType } = readPngHeader(appleTouchIconPath);
  if (width !== height) {
    errors.push(`apple-touch-icon deveria ser quadrado, é ${width}x${height}`);
  }
  // PNG colorType 4 (grayscale+alpha) ou 6 (RGBA) têm canal alpha.
  if (colorType === 4 || colorType === 6) {
    errors.push(
      `apple-touch-icon-180x180.png tem canal alpha (colorType ${colorType}) — iOS pode renderizar preto onde for transparente`
    );
  }
}

// ── 3. src/lib/pwa/apple-startup-images.json: todos os arquivos existem ──
const startupImagesPath = join(webRoot, "src/lib/pwa/apple-startup-images.json");
const startupImages = JSON.parse(readFileSync(startupImagesPath, "utf8"));
for (const { url } of startupImages) {
  const absPath = join(publicDir, url.replace(/^\//, ""));
  if (!existsSync(absPath)) {
    errors.push(`apple-startup-images.json: "${url}" não existe em disco`);
  }
}

if (errors.length > 0) {
  console.error("verify-pwa-assets: FALHOU\n");
  for (const err of errors) console.error(`  ✗ ${err}`);
  process.exit(1);
}

console.log(`verify-pwa-assets: OK (${manifest.icons?.length ?? 0} ícones, ${startupImages.length} splash screens)`);
