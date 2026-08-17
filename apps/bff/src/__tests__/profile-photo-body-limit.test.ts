import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Hono, type Context } from "hono";
import {
  API_BODY_LIMIT_BYTES,
  MATERIAL_PHOTO_REQUEST_LIMIT_BYTES,
  PROFILE_PHOTO_REQUEST_LIMIT_BYTES,
  requestBodyLimitMiddleware,
} from "../middleware/request-body-limit.ts";

const PHOTO_OVER_GLOBAL_LIMIT_BYTES = API_BODY_LIMIT_BYTES + 256 * 1024;

function multipartRequest(path: string, fileSize: number) {
  const form = new FormData();
  form.set(
    "file",
    new File([new Uint8Array(fileSize)], "profile.jpg", {
      type: "image/jpeg",
    }),
  );

  return new Request(`http://localhost${path}`, {
    method: "POST",
    body: form,
  });
}

function createHarness() {
  const app = new Hono();
  app.use("/api/*", requestBodyLimitMiddleware);

  const photoHandler = async (c: Context) => {
    const form = await c.req.formData();
    const file = form.get("file");
    return c.json({ size: file instanceof File ? file.size : null });
  };

  app.post("/api/profiles/me/photo", photoHandler);
  app.post("/api/profiles/:id/photo", photoHandler);
  app.post("/api/admin/upload-photo", photoHandler);
  app.post("/api/arsenal/material-photo", photoHandler);
  app.post("/api/common", async (c) => {
    const bytes = await c.req.arrayBuffer();
    return c.json({ size: bytes.byteLength });
  });

  return app;
}

describe("requestBodyLimitMiddleware", () => {
  for (const path of [
    "/api/profiles/me/photo",
    "/api/profiles/target-profile/photo",
    "/api/admin/upload-photo",
    "/api/arsenal/material-photo",
  ]) {
    it(`aceita arquivo bruto >2 MiB e <5 MiB em ${path}`, async () => {
      const response = await createHarness().request(
        multipartRequest(path, PHOTO_OVER_GLOBAL_LIMIT_BYTES),
      );

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        size: PHOTO_OVER_GLOBAL_LIMIT_BYTES,
      });
    });
  }

  it("mantém uma rota comum limitada a 2 MiB", async () => {
    const response = await createHarness().request(
      new Request("http://localhost/api/common", {
        method: "POST",
        body: new Uint8Array(API_BODY_LIMIT_BYTES + 1),
      }),
    );

    assert.equal(response.status, 413);
  });

  it("rejeita request de foto acima de 5 MiB mais overhead", async () => {
    const response = await createHarness().request(
      multipartRequest(
        "/api/profiles/me/photo",
        PROFILE_PHOTO_REQUEST_LIMIT_BYTES + 1,
      ),
    );

    assert.equal(response.status, 413);
  });

  // Achado de code review: material-photo tinha inicialmente sido roteado
  // pela MESMA instância de bodyLimit de profile-photo (mesmo valor
  // numérico hoje, mas nenhum teste garantia que continuaria assim se um
  // dos dois limites mudasse independentemente). Este teste usa o limite
  // MATERIAL_PHOTO_REQUEST_LIMIT_BYTES — não PROFILE_PHOTO_REQUEST_LIMIT_BYTES
  // — como fonte da verdade do limite esperado, para pegar uma futura
  // dessincronia entre as duas constantes.
  it("rejeita upload de material-photo acima de 5 MiB mais overhead", async () => {
    const response = await createHarness().request(
      multipartRequest(
        "/api/arsenal/material-photo",
        MATERIAL_PHOTO_REQUEST_LIMIT_BYTES + 1,
      ),
    );

    assert.equal(response.status, 413);
  });
});
