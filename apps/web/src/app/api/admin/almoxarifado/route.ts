export const runtime = "edge";

import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { validateMaterialMetadata, type NormalizedMaterialMetadata } from "@/lib/material-metadata";

function getSupabaseUrl() {
  return process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

function getServiceRoleKey(): string {
  try {
    const cfEnv = getRequestContext().env as Record<string, string | undefined>;
    if (cfEnv.SUPABASE_SERVICE_ROLE_KEY) return cfEnv.SUPABASE_SERVICE_ROLE_KEY;
  } catch {
    // not in CF Workers context
  }
  const fromEnv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (fromEnv) return fromEnv;
  throw new Error("SUPABASE_SERVICE_ROLE_KEY nao configurado nas env vars do CF Pages");
}

const DIRECT_MANAGE_ROLES = new Set(["admin", "admin_reserva"]);

async function getCallerSession(): Promise<{
  userId: string;
  role: string;
  tenantId: string | null;
  reserveId: string | null;
} | null> {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    getSupabaseUrl(),
    process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, default_tenant_id")
    .eq("id", user.id)
    .single();
  if (!profile) return null;

  const { data: reserveMembership } = await supabase
    .from("reserve_memberships")
    .select("reserve_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  return {
    userId: user.id,
    role: profile.role,
    tenantId: profile.default_tenant_id ?? null,
    reserveId: reserveMembership?.reserve_id ?? null,
  };
}

function adminClient() {
  return createSupabaseClient(getSupabaseUrl(), getServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function ensureMaterialCategory({
  db,
  session,
  metadata,
}: {
  db: ReturnType<typeof adminClient>;
  session: NonNullable<Awaited<ReturnType<typeof getCallerSession>>>;
  metadata: NormalizedMaterialMetadata;
}) {
  if (metadata.category_id) return metadata.category_id;
  if (!session.tenantId) return null;

  const { data: existing } = await db
    .from("material_categories")
    .select("id")
    .eq("tenant_id", session.tenantId)
    .eq("slug", metadata.categoria_slug)
    .or(session.reserveId ? `reserve_id.eq.${session.reserveId},reserve_id.is.null` : "reserve_id.is.null")
    .eq("active", true)
    .order("reserve_id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) return existing.id as string;

  const { data: created, error } = await db
    .from("material_categories")
    .insert({
      tenant_id: session.tenantId,
      reserve_id: session.reserveId,
      nome: metadata.categoria,
      slug: metadata.categoria_slug,
      requires_caliber: metadata.categoria_slug === "arma",
      requires_validity: metadata.requires_validity,
      default_has_serial_numbers: metadata.has_serial_numbers,
      validity_alert_days: metadata.validity_alert_days,
      requires_vehicle_fields: metadata.requires_vehicle_fields,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error) throw error;
  return created?.id as string | null;
}

function makePhysicalItems({
  materialTypeId,
  tenantId,
  reserveId,
  metadata,
}: {
  materialTypeId: string;
  tenantId: string | null;
  reserveId: string | null;
  metadata: NormalizedMaterialMetadata;
}) {
  if (!tenantId) return [];
  if (!metadata.has_serial_numbers && !metadata.requires_validity && metadata.items.length === 0) return [];

  return metadata.items.map((item, index) => {
    const serial = item.numero_serie?.trim() || null;
    const identifier = serial || `${metadata.categoria_slug}-${materialTypeId}-${index + 1}`;
    return {
      tenant_id: tenantId,
      material_type_id: materialTypeId,
      tipo_identificador: serial ? "numero_serie" : "interno",
      identificador_principal: identifier,
      numero_serie: serial,
      validade_item: item.validade_item ?? null,
      descricao_adicional: item.descricao_adicional?.trim() || null,
      current_unit_id: reserveId,
    };
  });
}

type MaterialRequestBody = {
  id?: string;
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
  items?: Array<{
    numero_serie?: string | null;
    validade_item?: string | null;
    descricao_adicional?: string | null;
  }>;
};

// POST /api/admin/almoxarifado - create material
export async function POST(req: NextRequest) {
  try {
    const session = await getCallerSession();
    if (!session || !DIRECT_MANAGE_ROLES.has(session.role)) {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    const body = await req.json() as MaterialRequestBody;
    const validation = validateMaterialMetadata(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const materialInput = validation.value;
    const db = adminClient();
    const categoryId = await ensureMaterialCategory({ db, session, metadata: materialInput });

    const { data: material, error } = await db
      .from("material_types")
      .insert({
        nome: materialInput.nome,
        category_id: categoryId,
        categoria: materialInput.categoria,
        categoria_slug: materialInput.categoria_slug,
        quantidade_total: materialInput.quantidade_total,
        descricao: materialInput.descricao,
        calibre: materialInput.calibre,
        has_serial_numbers: materialInput.has_serial_numbers,
        requires_validity: materialInput.requires_validity,
        requires_vehicle_fields: materialInput.requires_vehicle_fields,
        validity_alert_days: materialInput.validity_alert_days,
        vehicle_plate: materialInput.vehicle_plate,
        vehicle_color: materialInput.vehicle_color,
        vehicle_year: materialInput.vehicle_year,
        vehicle_model: materialInput.vehicle_model,
        tenant_id: session.tenantId,
        reserve_id: session.reserveId,
        photo_url: materialInput.photo_url,
        photo_storage_path: materialInput.photo_storage_path,
      })
      .select("id, nome, category_id, categoria, categoria_slug, quantidade_total, descricao, calibre, vehicle_plate, vehicle_model, photo_url")
      .single();

    if (error) throw error;

    const physicalItems = makePhysicalItems({
      materialTypeId: material.id,
      tenantId: session.tenantId,
      reserveId: session.reserveId,
      metadata: materialInput,
    });

    if (physicalItems.length > 0) {
      const { error: itemError } = await db.from("material_items").insert(physicalItems);
      if (itemError) throw itemError;
    }

    await db.from("audit_logs").insert({
      actor_id: session.userId,
      action: "almoxarifado.material_criado",
      resource_type: "material_types",
      resource_id: material.id,
      metadata: {
        nome: material.nome,
        categoria: material.categoria,
        category_id: material.category_id,
        categoria_slug: material.categoria_slug,
        quantidade_total: material.quantidade_total,
        calibre: material.calibre,
        vehicle_plate: material.vehicle_plate,
        vehicle_model: material.vehicle_model,
        physical_items_created: physicalItems.length,
      },
    });

    return NextResponse.json({ ok: true, material }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro ao criar material";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/admin/almoxarifado - edit material catalog metadata
export async function PATCH(req: NextRequest) {
  try {
    const session = await getCallerSession();
    if (!session || !DIRECT_MANAGE_ROLES.has(session.role)) {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    const body = await req.json() as MaterialRequestBody;
    const { id } = body;
    if (!id) return NextResponse.json({ error: "id e obrigatorio" }, { status: 400 });

    const validation = validateMaterialMetadata(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const materialInput = validation.value;
    const db = adminClient();
    const categoryId = await ensureMaterialCategory({ db, session, metadata: materialInput });

    const { data: before } = await db
      .from("material_types")
      .select("nome, category_id, categoria, categoria_slug, quantidade_total, descricao, calibre, reserve_id, photo_url")
      .eq("id", id)
      .single();

    if (session.role === "admin_reserva" && session.reserveId && before?.reserve_id !== session.reserveId) {
      return NextResponse.json({ error: "Material fora da reserva" }, { status: 403 });
    }

    const { data: material, error } = await db
      .from("material_types")
      .update({
        nome: materialInput.nome,
        category_id: categoryId,
        categoria: materialInput.categoria,
        categoria_slug: materialInput.categoria_slug,
        quantidade_total: materialInput.quantidade_total,
        descricao: materialInput.descricao,
        calibre: materialInput.calibre,
        has_serial_numbers: materialInput.has_serial_numbers,
        requires_validity: materialInput.requires_validity,
        requires_vehicle_fields: materialInput.requires_vehicle_fields,
        validity_alert_days: materialInput.validity_alert_days,
        vehicle_plate: materialInput.vehicle_plate,
        vehicle_color: materialInput.vehicle_color,
        vehicle_year: materialInput.vehicle_year,
        vehicle_model: materialInput.vehicle_model,
        ...(materialInput.photo_url !== undefined ? { photo_url: materialInput.photo_url } : {}),
        ...(materialInput.photo_storage_path !== undefined ? { photo_storage_path: materialInput.photo_storage_path } : {}),
      })
      .eq("id", id)
      .select("id, nome, category_id, categoria, categoria_slug, quantidade_total, descricao, calibre, vehicle_plate, vehicle_model, photo_url")
      .single();

    if (error) throw error;
    if (!material) return NextResponse.json({ error: "Material nao encontrado" }, { status: 404 });

    await db.from("audit_logs").insert({
      actor_id: session.userId,
      action: "almoxarifado.material_editado",
      resource_type: "material_types",
      resource_id: id,
      metadata: {
        antes: before ?? null,
        depois: {
          nome: material.nome,
          category_id: material.category_id,
          categoria: material.categoria,
          categoria_slug: material.categoria_slug,
          quantidade_total: material.quantidade_total,
          descricao: material.descricao,
          calibre: material.calibre,
          vehicle_plate: material.vehicle_plate,
          vehicle_model: material.vehicle_model,
        },
      },
    });

    return NextResponse.json({ ok: true, material });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro ao editar material";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/admin/almoxarifado?id=<uuid> - deactivate material
export async function DELETE(req: NextRequest) {
  try {
    const session = await getCallerSession();
    if (!session || !DIRECT_MANAGE_ROLES.has(session.role)) {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id e obrigatorio" }, { status: 400 });
    }

    const db = adminClient();

    const { data: material } = await db
      .from("material_types")
      .select("nome, categoria, quantidade_total, reserve_id")
      .eq("id", id)
      .single();

    if (!material) return NextResponse.json({ error: "Material nao encontrado" }, { status: 404 });

    if (session.role === "admin_reserva" && session.reserveId && material.reserve_id !== session.reserveId) {
      return NextResponse.json({ error: "Material fora da reserva" }, { status: 403 });
    }

    const { data: availability } = await db
      .from("material_availability")
      .select("quantidade_armada")
      .eq("id", id)
      .maybeSingle();

    if ((availability?.quantidade_armada ?? 0) > 0) {
      return NextResponse.json({ error: "Material possui unidades em uso" }, { status: 409 });
    }

    const { error } = await db.from("material_types").update({ ativo: false }).eq("id", id);
    if (error) throw error;

    await db.from("audit_logs").insert({
      actor_id: session.userId,
      action: "almoxarifado.material_desativado",
      resource_type: "material_types",
      resource_id: id,
      metadata: {
        nome: material.nome,
        categoria: material.categoria,
        quantidade_total: material.quantidade_total,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro ao remover material";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
