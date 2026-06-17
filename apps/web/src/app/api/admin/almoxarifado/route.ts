export const runtime = "edge";

import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

function getSupabaseUrl() {
  return process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

function getServiceRoleKey(): string {
  try {
    const cfEnv = getRequestContext().env as Record<string, string | undefined>;
    if (cfEnv.SUPABASE_SERVICE_ROLE_KEY) return cfEnv.SUPABASE_SERVICE_ROLE_KEY;
  } catch { /* not in CF Workers context */ }
  const fromEnv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (fromEnv) return fromEnv;
  throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurado nas env vars do CF Pages");
}

async function getCallerSession(): Promise<{ userId: string; role: string } | null> {
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
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile) return null;
  return { userId: user.id, role: profile.role };
}

function adminClient() {
  return createSupabaseClient(getSupabaseUrl(), getServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// POST /api/admin/almoxarifado — create material
export async function POST(req: NextRequest) {
  try {
    const session = await getCallerSession();
    if (session?.role !== "admin") {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    const body = await req.json() as { nome?: string; categoria?: string; quantidade_total?: number };
    const { nome, categoria, quantidade_total } = body;

    if (!nome?.trim() || !categoria || !quantidade_total || quantidade_total < 1) {
      return NextResponse.json({ error: "nome, categoria e quantidade_total são obrigatórios" }, { status: 400 });
    }

    const db = adminClient();

    const { data: material, error } = await db
      .from("material_types")
      .insert({ nome: nome.trim(), categoria, quantidade_total })
      .select("id, nome, categoria, quantidade_total")
      .single();

    if (error) throw error;

    await db.from("audit_logs").insert({
      actor_id: session.userId,
      action: "almoxarifado.material_criado",
      resource_type: "material_types",
      resource_id: material.id,
      metadata: {
        nome: material.nome,
        categoria: material.categoria,
        quantidade_total: material.quantidade_total,
      },
    });

    return NextResponse.json({ ok: true, material }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro ao criar material";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/admin/almoxarifado — edit material
export async function PATCH(req: NextRequest) {
  try {
    const session = await getCallerSession();
    if (session?.role !== "admin") {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    const body = await req.json() as { id?: string; nome?: string; categoria?: string; quantidade_total?: number };
    const { id, nome, categoria, quantidade_total } = body;

    if (!id || !nome?.trim() || !categoria || !quantidade_total) {
      return NextResponse.json({ error: "id, nome, categoria e quantidade_total são obrigatórios" }, { status: 400 });
    }

    const db = adminClient();

    const { data: before } = await db
      .from("material_types")
      .select("nome, categoria, quantidade_total")
      .eq("id", id)
      .single();

    const { data: material, error } = await db
      .from("material_types")
      .update({ nome: nome.trim(), categoria, quantidade_total })
      .eq("id", id)
      .select("id, nome, categoria, quantidade_total")
      .single();

    if (error) throw error;
    if (!material) return NextResponse.json({ error: "Material não encontrado" }, { status: 404 });

    await db.from("audit_logs").insert({
      actor_id: session.userId,
      action: "almoxarifado.material_editado",
      resource_type: "material_types",
      resource_id: id,
      metadata: {
        antes: before ?? null,
        depois: {
          nome: material.nome,
          categoria: material.categoria,
          quantidade_total: material.quantidade_total,
        },
      },
    });

    return NextResponse.json({ ok: true, material });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro ao editar material";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/admin/almoxarifado?id=<uuid> — remove material
export async function DELETE(req: NextRequest) {
  try {
    const session = await getCallerSession();
    if (session?.role !== "admin") {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id é obrigatório" }, { status: 400 });
    }

    const db = adminClient();

    const { data: material } = await db
      .from("material_types")
      .select("nome, categoria, quantidade_total")
      .eq("id", id)
      .single();

    if (!material) return NextResponse.json({ error: "Material não encontrado" }, { status: 404 });

    const { error } = await db.from("material_types").delete().eq("id", id);
    if (error) throw error;

    await db.from("audit_logs").insert({
      actor_id: session.userId,
      action: "almoxarifado.material_removido",
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
