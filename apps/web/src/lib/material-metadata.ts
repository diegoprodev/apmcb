export const MATERIAL_VALIDITY_ALERT_DAYS = [365, 180, 90] as const;

export type MaterialCategoryProfile = {
  id: string | null;
  nome: string;
  slug: string;
  description?: string | null;
  icon?: string | null;
  requires_caliber: boolean;
  requires_validity: boolean;
  default_has_serial_numbers: boolean;
  validity_alert_days: number[];
  requires_vehicle_fields: boolean;
};

export type MaterialMetadataItemInput = {
  numero_serie?: string | null;
  validade_item?: string | null;
  descricao_adicional?: string | null;
};

export type MaterialMetadataInput = {
  category_id?: string | null;
  nome?: string;
  categoria?: string;
  categoria_slug?: string | null;
  quantidade_total?: number;
  descricao?: string | null;
  calibre?: string | null;
  has_serial_numbers?: boolean;
  requires_validity?: boolean;
  requires_vehicle_fields?: boolean;
  validity_alert_days?: number[] | null;
  photo_url?: string | null;
  photo_storage_path?: string | null;
  vehicle_plate?: string | null;
  vehicle_color?: string | null;
  vehicle_year?: number | null;
  vehicle_model?: string | null;
  items?: MaterialMetadataItemInput[];
};

export type NormalizedMaterialMetadata = Required<
  Pick<MaterialMetadataInput, "nome" | "categoria" | "quantidade_total">
> & {
  category_id: string | null;
  categoria_slug: string;
  descricao: string | null;
  calibre: string | null;
  has_serial_numbers: boolean;
  requires_validity: boolean;
  requires_vehicle_fields: boolean;
  validity_alert_days: number[];
  photo_url: string | null;
  photo_storage_path: string | null;
  vehicle_plate: string | null;
  vehicle_color: string | null;
  vehicle_year: number | null;
  vehicle_model: string | null;
  items: MaterialMetadataItemInput[];
};

export type MaterialMetadataValidation =
  | { ok: true; value: NormalizedMaterialMetadata }
  | { ok: false; error: string };

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function slugify(value: string) {
  return stripAccents(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeMaterialCategory(input: string) {
  const label = input.trim();
  const normalized = stripAccents(label).toLowerCase();
  const slug = slugify(label);

  if (/(^|\b)(arma|armas|armamento|pistola|fuzil|revolver|espingarda)(\b|$)/.test(normalized)) {
    return { label, slug: "arma" };
  }
  if (/(^|\b)(colete|coletes|balistico|balistica)(\b|$)/.test(normalized)) {
    return { label, slug: "colete" };
  }
  if (/(^|\b)(radio|radios|ht|comunicador)(\b|$)/.test(normalized)) {
    return { label, slug: "radio" };
  }
  if (/(^|\b)(veiculo|veiculos|viatura|viaturas|carro|moto|caminhonete|van)(\b|$)/.test(normalized)) {
    return { label, slug: "veiculo" };
  }

  return { label, slug: slug || "outro" };
}

export function getMaterialCategoryDefaults(slug: string) {
  return {
    requires_caliber: slug === "arma",
    requires_validity: slug === "colete",
    default_has_serial_numbers: ["arma", "colete", "radio"].includes(slug),
    requires_vehicle_fields: slug === "veiculo",
  };
}

export function createMaterialCategoryProfile(name: string): MaterialCategoryProfile {
  const category = normalizeMaterialCategory(name);
  const defaults = getMaterialCategoryDefaults(category.slug);
  return {
    id: null,
    nome: category.label,
    slug: category.slug,
    description: null,
    requires_caliber: defaults.requires_caliber,
    requires_validity: defaults.requires_validity,
    default_has_serial_numbers: defaults.default_has_serial_numbers,
    validity_alert_days: defaults.requires_validity ? [...MATERIAL_VALIDITY_ALERT_DAYS] : [],
    requires_vehicle_fields: defaults.requires_vehicle_fields,
  };
}

function hasText(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeAlertDays(input: number[] | null | undefined, requiresValidity: boolean) {
  const source = input?.length ? input : requiresValidity ? [...MATERIAL_VALIDITY_ALERT_DAYS] : [];
  const unique = [...new Set(source.map((day) => Number(day)))];
  const invalid = unique.find((day) => !MATERIAL_VALIDITY_ALERT_DAYS.includes(day as 365 | 180 | 90));
  if (invalid) return { ok: false as const, error: "Marco de alerta de validade invalido" };
  return { ok: true as const, value: unique };
}

export function validateMaterialMetadata(input: MaterialMetadataInput): MaterialMetadataValidation {
  const nome = input.nome?.trim() ?? "";
  if (!nome) return { ok: false, error: "Nome do material e obrigatorio" };

  const categoriaInput = input.categoria?.trim() ?? "";
  if (!categoriaInput) return { ok: false, error: "Categoria do material e obrigatoria" };

  const quantidadeTotal = Number(input.quantidade_total ?? 0);
  if (!Number.isInteger(quantidadeTotal) || quantidadeTotal < 1) {
    return { ok: false, error: "Quantidade total deve ser maior que zero" };
  }

  const category = normalizeMaterialCategory(categoriaInput);
  const categoriaSlug = input.categoria_slug?.trim() || category.slug;
  const categoryDefaults = getMaterialCategoryDefaults(categoriaSlug);
  const requiresValidity = input.requires_validity === true || categoryDefaults.requires_validity;
  const requiresVehicleFields = input.requires_vehicle_fields === true || categoryDefaults.requires_vehicle_fields;
  const hasSerialNumbers = input.has_serial_numbers ?? categoryDefaults.default_has_serial_numbers;
  const calibre = input.calibre?.trim() || null;
  const vehiclePlate = input.vehicle_plate?.trim()
    ? input.vehicle_plate.trim().replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
    : null;
  const vehicleModel = input.vehicle_model?.trim() || null;
  const vehicleColor = input.vehicle_color?.trim() || null;
  const vehicleYear = input.vehicle_year == null || input.vehicle_year === undefined
    ? null
    : Number(input.vehicle_year);
  const items = input.items ?? [];

  if (categoryDefaults.requires_caliber && !calibre) {
    return { ok: false, error: "Informe o calibre da arma" };
  }

  if (requiresVehicleFields && (!vehiclePlate || !vehicleModel)) {
    return { ok: false, error: "Informe placa e modelo do veiculo" };
  }

  if (vehicleYear !== null) {
    const currentYear = new Date().getFullYear();
    if (!Number.isInteger(vehicleYear) || vehicleYear < 1900 || vehicleYear > currentYear + 1) {
      return { ok: false, error: "Ano do veiculo invalido" };
    }
  }

  if (requiresValidity) {
    const hasMissingValidity =
      items.length < quantidadeTotal || items.some((item) => !hasText(item.validade_item));
    if (hasMissingValidity) return { ok: false, error: "Informe a validade do colete" };
  }

  if (hasSerialNumbers) {
    const serials = items.map((item) => item.numero_serie?.trim()).filter(Boolean) as string[];
    if (serials.length > 0 && new Set(serials.map((serial) => serial.toLowerCase())).size !== serials.length) {
      return { ok: false, error: "Numeros de serie duplicados no formulario" };
    }
  }

  const alertDays = normalizeAlertDays(input.validity_alert_days, requiresValidity);
  if (!alertDays.ok) return { ok: false, error: alertDays.error };

  return {
    ok: true,
    value: {
      nome,
      category_id: input.category_id?.trim() || null,
      categoria: category.label,
      categoria_slug: categoriaSlug,
      quantidade_total: quantidadeTotal,
      descricao: input.descricao?.trim() || null,
      calibre,
      has_serial_numbers: hasSerialNumbers,
      requires_validity: requiresValidity,
      requires_vehicle_fields: requiresVehicleFields,
      validity_alert_days: alertDays.value,
      photo_url: input.photo_url ?? null,
      photo_storage_path: input.photo_storage_path ?? null,
      vehicle_plate: requiresVehicleFields ? vehiclePlate : null,
      vehicle_color: requiresVehicleFields ? vehicleColor : null,
      vehicle_year: requiresVehicleFields ? vehicleYear : null,
      vehicle_model: requiresVehicleFields ? vehicleModel : null,
      items,
    },
  };
}
