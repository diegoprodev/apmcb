import { createBrowserClient } from "@supabase/ssr";

// NEXT_PUBLIC_* vars are statically replaced by webpack at build time.
// vercel build (called by next-on-pages) does NOT receive CF Pages env vars,
// so process.env.NEXT_PUBLIC_* becomes undefined in the browser bundle.
// The anon key is a public JWT by Supabase design — safe to hardcode here.
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://jepitcrkicwmvzrmllpn.supabase.co";

const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplcGl0Y3JraWN3bXZ6cm1sbHBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMzk2MDgsImV4cCI6MjA5NjgxNTYwOH0.3FWH0VGtAqWD-c2r39wDL4uLUKrhh-HS0kyupgcPhic";

export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
