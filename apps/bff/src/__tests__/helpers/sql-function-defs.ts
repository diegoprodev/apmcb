import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// Parser mínimo de `create [or replace] function` nas migrations, usado pelas
// guardas estáticas de SQL (sql-migrations-on-conflict-guard,
// sql-lending-liveness-guard). Não é um parser SQL: acha o cabeçalho, o
// primeiro delimitador $tag$ depois dele e o fechamento correspondente.

export interface SqlFunctionDef {
  name: string;
  signature: string;
  body: string;
}

export const migrationsDir = resolve(process.cwd(), "..", "..", "supabase/migrations");

export function extractFunctionDefs(sql: string): SqlFunctionDef[] {
  const defs: SqlFunctionDef[] = [];
  const headerRe = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\(/gi;
  let headerMatch: RegExpExecArray | null;
  while ((headerMatch = headerRe.exec(sql)) !== null) {
    const name = headerMatch[1];
    const headerStart = headerMatch.index;
    const dollarOpenRe = /\$([a-zA-Z_]*)\$/g;
    dollarOpenRe.lastIndex = headerRe.lastIndex;
    const openMatch = dollarOpenRe.exec(sql);
    if (!openMatch) continue;
    const tag = openMatch[0];
    const signature = sql.slice(headerStart, openMatch.index);
    const bodyStart = openMatch.index + tag.length;
    const closeIdx = sql.indexOf(tag, bodyStart);
    if (closeIdx === -1) continue;
    const body = sql.slice(bodyStart, closeIdx);
    defs.push({ name, signature, body });
    headerRe.lastIndex = closeIdx + tag.length;
  }
  return defs;
}

/** Migrations em ordem de aplicação (o prefixo é o timestamp). */
export function readMigrations(): Array<{ file: string; sql: string }> {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(resolve(migrationsDir, file), "utf8") }));
}
