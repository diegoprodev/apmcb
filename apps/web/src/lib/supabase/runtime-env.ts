import { getRequestContext } from "@cloudflare/next-on-pages";

const PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://jepitcrkicwmvzrmllpn.supabase.co";

const PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplcGl0Y3JraWN3bXZ6cm1sbHBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMzk2MDgsImV4cCI6MjA5NjgxNTYwOH0.3FWH0VGtAqWD-c2r39wDL4uLUKrhh-HS0kyupgcPhic";

function getCloudflareEnv(name: string) {
  try {
    const env = getRequestContext().env as Record<string, string | undefined>;
    const value = env[name];
    return value && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function getSupabaseUrl() {
  return process.env.SUPABASE_URL || getCloudflareEnv("SUPABASE_URL") || PUBLIC_SUPABASE_URL;
}

export function getSupabaseAnonKey() {
  return process.env.SUPABASE_ANON_KEY || getCloudflareEnv("SUPABASE_ANON_KEY") || PUBLIC_SUPABASE_ANON_KEY;
}
