import { z } from "zod";

export type InfraMode = "SUPABASE" | "ON_PREMISE";

export interface InfraEnv {
  mode: InfraMode;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  databaseUrl?: string;
}

const baseSchema = z.object({
  AMBIENTE_INFRA: z.enum(["SUPABASE", "ON_PREMISE"], {
    errorMap: () => ({
      message: "AMBIENTE_INFRA deve ser 'SUPABASE' ou 'ON_PREMISE' (variável obrigatória, sem default)",
    }),
  }),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  DATABASE_URL: z.string().optional(),
});

export function loadInfraEnv(source: NodeJS.ProcessEnv): InfraEnv {
  const parsed = baseSchema.parse(source);

  if (parsed.AMBIENTE_INFRA === "SUPABASE") {
    if (!parsed.SUPABASE_URL || !parsed.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        "AMBIENTE_INFRA=SUPABASE exige SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY definidos",
      );
    }
    return {
      mode: "SUPABASE",
      supabaseUrl: parsed.SUPABASE_URL,
      supabaseServiceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY,
    };
  }

  if (!parsed.DATABASE_URL) {
    throw new Error("AMBIENTE_INFRA=ON_PREMISE exige DATABASE_URL definido");
  }
  return { mode: "ON_PREMISE", databaseUrl: parsed.DATABASE_URL };
}
