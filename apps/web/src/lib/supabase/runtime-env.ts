import { getRequestContext } from "@cloudflare/next-on-pages";

function getCloudflareEnv(name: string) {
  try {
    const env = getRequestContext().env as Record<string, string | undefined>;
    const value = env[name];
    return value && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function getEnv(name: string) {
  const value = process.env[name];
  return value && value.length > 0 ? value : getCloudflareEnv(name);
}

export function getSupabaseUrl() {
  return getEnv("SUPABASE_URL") ?? getEnv("NEXT_PUBLIC_SUPABASE_URL") ?? "";
}

export function getSupabaseAnonKey() {
  return getEnv("SUPABASE_ANON_KEY") ?? getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? "";
}
