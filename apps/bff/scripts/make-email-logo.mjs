// One-off: gera as variantes da logo Andrômeda para e-mail e web a partir do
// PNG transparente original. Rodar de apps/bff:
//   node scripts/make-email-logo.mjs <src.png> <repo-root>
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const src = process.argv[2];
const root = process.argv[3] ?? resolve(process.cwd(), "..", "..");
if (!src) { console.error("uso: node scripts/make-email-logo.mjs <src.png> [repo-root]"); process.exit(1); }

const out = (p) => resolve(root, p);
const base = sharp(src).trim({ threshold: 10 });

const emailPng = await base.clone().resize({ width: 480, withoutEnlargement: true })
  .png({ compressionLevel: 9, palette: true }).toBuffer();
writeFileSync(out("apps/web/public/images/andromeda-email.png"), emailPng);
console.log("andromeda-email.png", emailPng.length, "bytes");

const webPng = await base.clone().resize({ width: 512, withoutEnlargement: true })
  .png({ compressionLevel: 9 }).toBuffer();
writeFileSync(out("apps/web/public/images/andromeda-logo.png"), webPng);
console.log("andromeda-logo.png", webPng.length, "bytes");

const meta = await sharp(emailPng).metadata();
console.log("email logo dims:", meta.width, "x", meta.height);
