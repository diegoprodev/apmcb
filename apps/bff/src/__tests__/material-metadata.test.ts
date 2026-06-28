import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MATERIAL_VALIDITY_ALERT_DAYS,
  normalizeMaterialCategory,
  validateMaterialMetadata,
} from "../lib/material-metadata.ts";

describe("material metadata normalization", () => {
  it("normalizes common weapon, vest, radio and vehicle categories", () => {
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
    assert.deepEqual(normalizeMaterialCategory("Viatura Operacional"), {
      label: "Viatura Operacional",
      slug: "veiculo",
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

  it("enables serial control by default for ballistic vest categories", () => {
    const result = validateMaterialMetadata({
      nome: "Colete Balistico IIIA",
      categoria: "Coletes Balisticos",
      quantidade_total: 1,
      items: [{ numero_serie: "CB-001", validade_item: "2027-12-31" }],
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.categoria_slug, "colete");
      assert.equal(result.value.has_serial_numbers, true);
      assert.equal(result.value.requires_validity, true);
    }
  });

  it("requires plate and model when category is vehicle", () => {
    const result = validateMaterialMetadata({
      nome: "Viatura Reserva",
      categoria: "Veiculo",
      quantidade_total: 1,
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /placa.*modelo|modelo.*placa/i);
  });

  it("returns normalized metadata for a valid vehicle", () => {
    const result = validateMaterialMetadata({
      nome: "Viatura Reserva",
      categoria: "Veiculo",
      quantidade_total: 1,
      vehicle_plate: "abc1d23",
      vehicle_model: "Hilux",
      vehicle_color: "Branca",
      vehicle_year: 2024,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.categoria_slug, "veiculo");
      assert.equal(result.value.requires_vehicle_fields, true);
      assert.equal(result.value.vehicle_plate, "ABC1D23");
      assert.equal(result.value.vehicle_model, "Hilux");
      assert.equal(result.value.vehicle_color, "Branca");
      assert.equal(result.value.vehicle_year, 2024);
    }
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
