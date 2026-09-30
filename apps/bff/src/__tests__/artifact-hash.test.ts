import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { artifactSha256 } from "../lib/artifact-hash.ts";

// R-01B: primitive de hash dos BYTES exatos de um artefato (ex.: PDF final).
// Não é o content hash (hashDocument) — ver lib/artifact-hash.ts.

describe("artifactSha256", () => {
  it("vetor conhecido: SHA-256('abc')", () => {
    assert.equal(
      artifactSha256(new TextEncoder().encode("abc")),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("vetor conhecido: SHA-256 de 0 bytes", () => {
    assert.equal(
      artifactSha256(new Uint8Array(0)),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("mesmo buffer → mesmo hash; Buffer e Uint8Array com os mesmos bytes → mesmo hash", () => {
    const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"
    assert.equal(artifactSha256(bytes), artifactSha256(Uint8Array.from(bytes)));
    assert.equal(artifactSha256(bytes), artifactSha256(Buffer.from(bytes)));
  });

  it("alterar 1 byte → hash diferente", () => {
    const a = Uint8Array.from([1, 2, 3, 4, 5]);
    const b = Uint8Array.from(a);
    b[4] ^= 0x01;
    assert.notEqual(artifactSha256(a), artifactSha256(b));
  });

  it("opera só sobre os bytes da view (respeita byteOffset/byteLength)", () => {
    const backing = Uint8Array.from([9, 9, 1, 2, 3, 9, 9]);
    const view = new Uint8Array(backing.buffer, 2, 3);
    assert.equal(artifactSha256(view), artifactSha256(Uint8Array.from([1, 2, 3])));
  });

  it("recusa string/objeto — não re-serializa conteúdo", () => {
    assert.throws(() => artifactSha256("abc" as unknown as Uint8Array), TypeError);
    assert.throws(() => artifactSha256({ a: 1 } as unknown as Uint8Array), TypeError);
    assert.throws(() => artifactSha256(new ArrayBuffer(3) as unknown as Uint8Array), TypeError);
  });
});
