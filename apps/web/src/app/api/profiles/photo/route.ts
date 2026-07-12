export const runtime = "edge";
// Defesa em profundidade: POST não é cacheado por semântica HTTP padrão, mas a
// detecção automática de "usa cookies() logo é dinâmico" já se provou não
// confiável neste adaptador (ver commit e059f7f).
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const MAX_SIZE = 5 * 1024 * 1024;

// POST /api/profiles/photo — upload da foto de perfil do próprio usuário.
//
// Roda no servidor porque o storage.objects tem RLS "TO authenticated": o
// client Supabase do browser não serve — sb-* é HttpOnly (lib/supabase/server.ts),
// então createBrowserClient() nunca tem sessão pra autenticar o upload e a
// policy nem chega a ser avaliada (role de conexão fica "anon").
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
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
    const path = `${user.id}/profile.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("profile-photos")
      .upload(path, file, { cacheControl: "3600", upsert: true });
    if (uploadError) {
      console.error("[POST /api/profiles/photo] falha ao enviar foto", uploadError);
      return NextResponse.json({ error: "Erro ao enviar foto" }, { status: 500 });
    }

    const { data: signed } = await supabase.storage.from("profile-photos").createSignedUrl(path, 3600);
    return NextResponse.json({ path, signedUrl: signed?.signedUrl ?? null });
  } catch (err: unknown) {
    console.error("[POST /api/profiles/photo]", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
