#!/usr/bin/env node
// Usage: node scripts/gen-vapid.js
// Generates VAPID key pair for Web Push.
// Add these to BFF .env and CF Pages dashboard.

const { generateKeyPairSync } = require("crypto");

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });

const pubDer = publicKey.export({ type: "spki", format: "der" });
const privDer = privateKey.export({ type: "pkcs8", format: "der" });

const b64url = (buf) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

// SPKI for P-256: 26-byte header + 65-byte uncompressed EC point
const vapidPublic = b64url(pubDer.slice(26));
// PKCS8 for P-256: 36-byte header + 32-byte private scalar
const vapidPrivate = b64url(privDer.slice(36, 68));

console.log("\nAdd these to apps/bff/.env AND Hetzner VPS:\n");
console.log(`VAPID_PUBLIC_KEY=${vapidPublic}`);
console.log(`VAPID_PRIVATE_KEY=${vapidPrivate}`);
console.log("\nAdd this to CF Pages Dashboard (env vars):\n");
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${vapidPublic}`);
console.log("\nGenerate an INTERNAL_API_SECRET (shared between CF Pages and BFF):");
console.log(`INTERNAL_API_SECRET=${require("crypto").randomBytes(32).toString("hex")}\n`);
