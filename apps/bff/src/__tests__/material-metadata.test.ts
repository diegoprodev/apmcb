import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MATERIAL_VALIDITY_ALERT_DAYS,
  normalizeMaterialCategory,
  validateMaterialMetadata,
} from "../lib/material-metadata.ts";

describe("material metadata normalization", () => {
  it("normalizes common weapon, vest and radio categories", () => {
    assert.deepEqual(normalizeMaterialCategory("Armas"), {
      label: "Armas",
      slug: "arma",
    });
    assert.deepEqual(normalizeMaterialCategory("Colete Balistico NIJ III"), {
      label: "Colete Balistico NIJ III",
      slug: "colete",
    });
    assert.deepEqual(normalizeMaterialCategory("Radio HT"), {
      label: "Radio HT",
      slug: "radio",
    });
  });

  it("keeps custom category text and generates a stable slug", () => {
    assert.deepEqual(normalizeMaterialCategory("Kit Cerimonial"), {
      label: "Kit Cerimonial",
      slug: "kit-cerimonial",
    });
  });
});

describe("material metadata validation", () => {
  it("requires caliber when category is weapon", () => {
    const result = validateMaterialMetadata({
      nome: "Pistola Glock G17",
      categoria: "Arma",
      quantidade_total: 1,
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /calibre/i);
  });

  it("requires validity dates when category is ballistic vest", () => {
    const result = validateMaterialMetadata({
      nome: "Colete Balistico",
      categoria: "Colete",
      quantidade_total: 2,
      items: [{}, {}],
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /validade/i);
  });

  it("accepts configured validity alert days and rejects unsupported days", () => {
    assert.deepEqual(MATERIAL_VALIDITY_ALERT_DAYS, [365, 180, 90]);

    const result = validateMaterialMetadata({
      nome: "Colete Balistico",
      categoria: "Colete",
      quantidade_total: 1,
      validity_alert_days: [365, 30],
      items: [{ validade_item: "2027-12-31" }],
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /alerta/i);
  });

  it("returns normalized metadata for a valid weapon", () => {
    const result = validateMaterialMetadata({
      nome: "Pistola Glock G17",
      categoria: "Arma",
      quantidade_total: 1,
      calibre: "9mm",
      has_serial_numbers: true,
      items: [{ numero_serie: "GLK-123" }],
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.categoria_slug, "arma");
      assert.equal(result.value.calibre, "9mm");
      assert.equal(result.value.has_serial_numbers, true);
    }
  });
});
