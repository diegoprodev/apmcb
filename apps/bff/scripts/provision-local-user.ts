// apps/bff/scripts/provision-local-user.ts
//
// Provisiona o primeiro usuário admin de uma instalação ON_PREMISE nova.
// Uso: DATABASE_URL=postgres://... bun run scripts/provision-local-user.ts \
//        --email admin@orgao.gov.br --nome "Fulano de Tal" --tenant-slug orgao-x
//
// Gera senha temporária aleatória, imprime uma vez (nunca fica em log
// persistente) — força troca no primeiro login (reaproveita o fluxo já
// existente de "senha temporária" do sistema, não é novo).
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { randomUUID, randomBytes } from "node:crypto";

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    const value = argv[i + 1];
    if (key && value) out[key] = value;
  }
  return out;
}

export function generateTempPassword(): string {
  return randomBytes(12).toString("base64url");
}

export async function provisionLocalUser(
  pool: Pool,
  opts: { email: string; nome: string; tenantSlug: string; password: string },
): Promise<{ userId: string }> {
  const userId = randomUUID();
  const hash = await bcrypt.hash(opts.password, 10);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [userId, opts.email]);
    await client.query(
      "INSERT INTO public.usuarios (id, email, senha_hash) VALUES ($1, $2, $3)",
      [userId, opts.email, hash],
    );
    const { rows } = await client.query<{ id: string }>(
      "SELECT id FROM public.tenants WHERE slug = $1",
      [opts.tenantSlug],
    );
    if (!rows[0]) {
      throw new Error(`tenant com slug "${opts.tenantSlug}" não existe — crie o tenant antes de provisionar o usuário`);
    }
    await client.query(
      `INSERT INTO public.profiles (id, nome_completo, role, default_tenant_id)
       VALUES ($1, $2, 'admin_global', $3)`,
      [userId, opts.nome, rows[0].id],
    );
    await client.query("COMMIT");
    return { userId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.email || !args.nome || !args["tenant-slug"]) {
    console.error("Uso: --email <email> --nome <nome> --tenant-slug <slug>");
    process.exit(1);
  }
  const password = generateTempPassword();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  provisionLocalUser(pool, { email: args.email, nome: args.nome, tenantSlug: args["tenant-slug"], password })
    .then(({ userId }) => {
      console.log(`Usuário criado: ${userId}`);
      console.log(`Senha temporária (copie agora, não será mostrada de novo): ${password}`);
    })
    .catch((err) => {
      console.error("Falha ao provisionar usuário:", err.message);
      process.exit(1);
    })
    .finally(() => pool.end());
}
