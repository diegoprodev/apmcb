import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

// 1x1 px GIF transparente — menor imagem válida possível para testar o caminho de exibição de fotos
const FIXTURE_PHOTO = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);
const FIXTURE_USERS = ["000001", "000002", "000003", "000004"]; // matriculas dos usuários de teste

const FIXTURE_ACCOUNTS = [
  { key: "admin",        email: "admin@apmcb.dev",        password: "Admin@123" },
  { key: "reserva",      email: "armeiro@apmcb.dev",      password: "Armeiro@123" },
  { key: "adminReserva", email: "adminreserva@apmcb.dev", password: "Admin@123" },
  { key: "efetivo",      email: "cadete@apmcb.dev",       password: "Cadete@123" },
];

export const TOKEN_CACHE_FILE = path.join(process.cwd(), ".auth", "e2e-tokens.json");

export default async function globalSetup() {
  // Limpa test-results antes de cada run para evitar ENOTEMPTY
  const dir = path.join(process.cwd(), "test-results");
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return; // CI sem credenciais — pular

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Pre-authenticate all fixture users ONCE to avoid Supabase rate-limiting per test.
  // Tokens written to TOKEN_CACHE_FILE; harness.ts reads them in login().
  fs.mkdirSync(path.dirname(TOKEN_CACHE_FILE), { recursive: true });
  const tokenCache: Record<string, { access_token: string; refresh_token: string }> = {};
  const tokenResults = await Promise.allSettled(
    FIXTURE_ACCOUNTS.map(async ({ key, email, password }) => {
      const { data } = await db.auth.signInWithPassword({ email, password });
      if (data?.session) {
        tokenCache[key] = {
          access_token:  data.session.access_token,
          refresh_token: data.session.refresh_token,
        };
      } else {
        throw new Error(`no session returned for ${key}`);
      }
    })
  );
  tokenResults.forEach((r, i) => {
    if (r.status === "rejected") {
      console.warn(`[setup] token cache: login falhou para ${FIXTURE_ACCOUNTS[i].key}:`, r.reason);
    }
  });
  fs.writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(tokenCache));

  // Garante que usuários de fixture tenham foto cadastrada.
  // Sem foto, código de exibição de imagem nunca é exercitado nos testes.
  for (const matricula of FIXTURE_USERS) {
    const { data: profile } = await db
      .from("profiles")
      .select("id, foto_url")
      .eq("matricula", matricula)
      .maybeSingle();

    if (!profile) continue;

    const storagePath = `${profile.id}/profile.gif`;

    // Só faz upload se ainda não tiver foto (idempotente)
    if (!profile.foto_url) {
      const { error } = await db.storage
        .from("profile-photos")
        .upload(storagePath, FIXTURE_PHOTO, {
          contentType: "image/gif",
          upsert: true,
        });
      if (!error) {
        await db.from("profiles").update({ foto_url: storagePath }).eq("id", profile.id);
      }
    }
  }
}
