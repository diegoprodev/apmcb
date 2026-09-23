import { Pool } from "pg";
import type { InfraEnv } from "./infra-env.ts";
import type { AuthProvider } from "./auth-provider.ts";
import { SupabaseAuthProvider } from "./auth-provider.ts";
import { LocalAuthProvider, PgUsuariosRepository } from "./local-auth-provider.ts";

let cachedPool: Pool | undefined;

export function createAuthProvider(env: InfraEnv): AuthProvider {
  if (env.mode === "SUPABASE") {
    return new SupabaseAuthProvider({
      url: env.supabaseUrl!,
      serviceRoleKey: env.supabaseServiceRoleKey!,
    });
  }

  // Pool único reaproveitado entre chamadas — evita abrir uma conexão nova
  // por login (mesmo padrão do singleton em apps/bff/src/services/supabase.ts).
  cachedPool ??= new Pool({ connectionString: env.databaseUrl! });
  return new LocalAuthProvider(new PgUsuariosRepository(cachedPool));
}
