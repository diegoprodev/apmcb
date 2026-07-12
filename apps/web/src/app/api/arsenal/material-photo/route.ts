export const runtime = "edge";
// Defesa em profundidade: POST não é cacheado por semântica HTTP padrão, mas a
// detecção automática de "usa cookies() logo é dinâmico" já se provou não
// confiável neste adaptador (ver commit e059f7f).
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const MAX_SIZE = 5 * 1024 * 1024;
const STAFF_ROLES = new Set(["admin_global", "admin_reserva", "armeiro", "admin", "master"]);

// POST /api/arsenal/material-photo — upload de foto de material (arsenal).
//
// Mesmo motivo do /api/profiles/photo: storage.objects tem RLS "TO authenticated"
// nesse bucket, e o client Supabase do browser não tem sessão legível (sb-* é
// HttpOnly) para autenticar o upload direto.
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (!profile || !STAFF_ROLES.has(profile.role)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Arquivo não informado" }, { status: 400 });
    }
    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json({ error: "Formato de imagem não suportado" }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "Imagem excede o tamanho máximo de 5MB" }, { status: 400 });
    }

    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `materials/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("material-photos")
      .upload(path, file, { cacheControl: "3600", upsert: true });
    if (uploadError) {
      console.error("[POST /api/arsenal/material-photo] falha ao enviar foto", uploadError);
      return NextResponse.json({ error: "Erro ao enviar foto" }, { status: 500 });
    }

    const { data } = supabase.storage.from("material-photos").getPublicUrl(path);
    return NextResponse.json({ photo_url: data.publicUrl, photo_storage_path: path });
  } catch (err: unknown) {
    console.error("[POST /api/arsenal/material-photo]", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
