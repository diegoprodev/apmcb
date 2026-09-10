import { describe, expect, it } from "vitest";
import {
  formatMaterialIdentity,
  formatVehiclePlate,
  getMaterialIdentityParts,
  type MaterialIdentityInput,
} from "./material-identity";

function material(overrides: Partial<MaterialIdentityInput> = {}): MaterialIdentityInput {
  return { nome: "Material", categoria: "Outro", ...overrides };
}

describe("formatVehiclePlate", () => {
  it("formata placa antiga (AAA1234) com hífen", () => {
    expect(formatVehiclePlate("ABC1234")).toBe("ABC-1234");
  });

  it("mantém placa Mercosul (AAA1A23) sem hífen", () => {
    expect(formatVehiclePlate("ABC1D23")).toBe("ABC1D23");
  });

  it("normaliza entrada suja (minúscula, hífen, espaço) antes de formatar", () => {
    expect(formatVehiclePlate(" abc-1234 ")).toBe("ABC-1234");
  });

  it("devolve null para vazio, espaço em branco ou null", () => {
    expect(formatVehiclePlate("")).toBeNull();
    expect(formatVehiclePlate("   ")).toBeNull();
    expect(formatVehiclePlate(null)).toBeNull();
    expect(formatVehiclePlate(undefined)).toBeNull();
  });

  it("devolve o texto normalizado quando não bate com nenhum padrão conhecido", () => {
    expect(formatVehiclePlate("xyz-99")).toBe("XYZ99");
  });
});

describe("getMaterialIdentityParts — veículo", () => {
  const viatura = material({
    nome: "VIATURA",
    categoria: "VEICULO",
    categoria_slug: "veiculo",
    requires_vehicle_fields: true,
    vehicle_plate: "ABC1234",
    vehicle_model: "Hilux SW4",
    vehicle_color: "Prata",
    vehicle_year: 2021,
  });

  it("expõe placa, modelo e cor/ano nessa ordem", () => {
    expect(getMaterialIdentityParts(viatura).map((p) => p.value)).toEqual([
      "ABC-1234",
      "Hilux SW4",
      "Prata 2021",
    ]);
  });

  it("marca a placa como código (renderizada em chip mono), o resto como texto", () => {
    const [placa, modelo] = getMaterialIdentityParts(viatura);
    expect(placa.kind).toBe("code");
    expect(placa.key).toBe("placa");
    expect(modelo.kind).toBe("text");
  });

  it("distingue duas viaturas de mesmo nome e categoria", () => {
    const outra = { ...viatura, vehicle_plate: "XYZ5678", vehicle_model: "Ranger" };
    expect(formatMaterialIdentity(viatura)).not.toBe(formatMaterialIdentity(outra));
  });

  it("omite partes ausentes sem deixar separador órfão", () => {
    const semCor = material({
      requires_vehicle_fields: true,
      vehicle_plate: "ABC1234",
      vehicle_model: "Hilux",
    });
    expect(formatMaterialIdentity(semCor)).toBe("ABC-1234 · Hilux");
  });

  it("mostra só o ano quando não há cor cadastrada", () => {
    const semCor = material({ requires_vehicle_fields: true, vehicle_plate: "ABC1234", vehicle_year: 2019 });
    expect(formatMaterialIdentity(semCor)).toBe("ABC-1234 · 2019");
  });

  it("trata veículo pelos dados presentes mesmo sem a flag requires_vehicle_fields", () => {
    const legado = material({ categoria_slug: "veiculo", vehicle_plate: "ABC1234" });
    expect(formatMaterialIdentity(legado)).toBe("ABC-1234");
  });
});

describe("getMaterialIdentityParts — arma", () => {
  it("expõe o calibre prefixado", () => {
    const arma = material({ categoria_slug: "arma", calibre: ".40" });
    expect(formatMaterialIdentity(arma)).toBe("Cal. .40");
  });

  it("prioriza o número de série sobre o calibre quando a unidade é conhecida", () => {
    const arma = material({
      categoria_slug: "arma",
      calibre: ".40",
      has_serial_numbers: true,
      quantidade_total: 1,
      numero_serie: "PT92-0007",
    });
    expect(getMaterialIdentityParts(arma).map((p) => p.value)).toEqual(["Nº PT92-0007", "Cal. .40"]);
  });

  it("não inventa número de série para material com várias unidades", () => {
    const arma = material({
      categoria_slug: "arma",
      calibre: "9mm",
      has_serial_numbers: true,
      quantidade_total: 3,
    });
    expect(formatMaterialIdentity(arma)).toBe("Cal. 9mm · 3 unidades");
  });
});

describe("getMaterialIdentityParts — serializados e coletes", () => {
  it("resume a contagem de unidades de um material serializado", () => {
    const radio = material({ categoria_slug: "radio", has_serial_numbers: true, quantidade_total: 4 });
    expect(formatMaterialIdentity(radio)).toBe("4 unidades");
  });

  it("não mostra contagem para uma única unidade sem série conhecida", () => {
    const radio = material({ categoria_slug: "radio", has_serial_numbers: true, quantidade_total: 1 });
    expect(formatMaterialIdentity(radio)).toBe("");
  });

  it("usa a validade quando o colete é unitário e a validade é conhecida", () => {
    const colete = material({
      categoria_slug: "colete",
      requires_validity: true,
      quantidade_total: 1,
      validade_item: "2027-05-30",
    });
    expect(formatMaterialIdentity(colete)).toBe("Validade 30/05/2027");
  });

  it("resume a contagem quando o colete tem várias unidades", () => {
    const colete = material({ categoria_slug: "colete", requires_validity: true, quantidade_total: 6 });
    expect(formatMaterialIdentity(colete)).toBe("6 unidades");
  });
});

describe("getMaterialIdentityParts — genérico", () => {
  it("cai na descrição quando a categoria não tem campo próprio de identificação", () => {
    const item = material({ categoria_slug: "acessorio", descricao: "Cinto branco de guarnição" });
    expect(formatMaterialIdentity(item)).toBe("Cinto branco de guarnição");
  });

  it("trunca descrição longa preservando a íntegra no title", () => {
    const longa = "A".repeat(120);
    const [parte] = getMaterialIdentityParts(material({ descricao: longa }));
    expect(parte.value.length).toBeLessThanOrEqual(73);
    expect(parte.value.endsWith("…")).toBe(true);
    expect(parte.title).toBe(longa);
  });

  it("não usa a descrição quando já existe identificação específica", () => {
    const viatura = material({
      requires_vehicle_fields: true,
      vehicle_plate: "ABC1234",
      descricao: "Viatura de patrulhamento",
    });
    expect(formatMaterialIdentity(viatura)).toBe("ABC-1234");
  });

  it("devolve string vazia quando não há nada que identifique o material", () => {
    expect(getMaterialIdentityParts(material())).toEqual([]);
    expect(formatMaterialIdentity(material())).toBe("");
  });

  it("ignora campos preenchidos só com espaço em branco", () => {
    const item = material({ descricao: "   ", calibre: "  ", vehicle_model: " " });
    expect(getMaterialIdentityParts(item)).toEqual([]);
  });
});

describe("getMaterialIdentityParts — limites", () => {
  it("limita a 3 partes por padrão para não poluir a linha", () => {
    const viatura = material({
      requires_vehicle_fields: true,
      has_serial_numbers: true,
      quantidade_total: 5,
      vehicle_plate: "ABC1234",
      vehicle_model: "Hilux",
      vehicle_color: "Prata",
      vehicle_year: 2021,
    });
    expect(getMaterialIdentityParts(viatura)).toHaveLength(3);
  });

  it("respeita maxParts quando o chamador pede menos", () => {
    const viatura = material({
      requires_vehicle_fields: true,
      vehicle_plate: "ABC1234",
      vehicle_model: "Hilux",
      vehicle_color: "Prata",
    });
    expect(getMaterialIdentityParts(viatura, { maxParts: 1 }).map((p) => p.value)).toEqual(["ABC-1234"]);
  });

  it("chaves das partes são únicas (uso seguro como React key)", () => {
    const viatura = material({
      requires_vehicle_fields: true,
      vehicle_plate: "ABC1234",
      vehicle_model: "Hilux",
      vehicle_color: "Prata",
      vehicle_year: 2021,
    });
    const keys = getMaterialIdentityParts(viatura, { maxParts: 10 }).map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
