import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// PERF-02 (docs/enterprise/specs/navegacao-performance-enterprise.md), §8:
// teste estático de cobertura completa — garante que NENHUM dos 26 page.tsx
// + 2 layout.tsx do escopo passou batido na migração pra getSessionUser()/
// getSessionProfile() (cache() do React) e regride pra uma leitura direta de
// supabase.auth.getUser()/`.from("profiles")`, reintroduzindo o round-trip
// duplicado que a spec inteira existe pra eliminar. Varre o código-fonte
// real em vez de confiar numa lista hardcoded de arquivos — pega também
// page.tsx futuros que alguém adicionar sem saber da convenção.

const DASHBOARD_ROOT = join(__dirname);

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (
      (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx")
    ) {
      out.push(full);
    }
  }
  return out;
}

describe("PERF-02 — cobertura estática de supabase.auth.getUser() em (dashboard)/", () => {
  const files = collectSourceFiles(DASHBOARD_ROOT);

  it("existe pelo menos 1 arquivo de origem pra varrer (sanity check do próprio teste)", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("supabase.auth.getUser() direto só ocorre em layout.tsx (o recheck do guard), em nenhum outro arquivo", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith(`${join("(dashboard)", "layout.tsx")}`)) continue;
      const content = readFileSync(file, "utf-8");
      if (content.includes(".auth.getUser(")) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("layout.tsx raiz do dashboard contém exatamente 1 chamada de supabase.auth.getUser() — o recheck raw, não-cacheado", () => {
    const layoutPath = join(DASHBOARD_ROOT, "layout.tsx");
    const content = readFileSync(layoutPath, "utf-8");
    // Exclui linhas de comentário — só conta chamadas de código real.
    const codeLines = content
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    const matches = codeLines.match(/\.auth\.getUser\(\)/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("nenhum page.tsx sob (dashboard) faz select direto em profiles filtrando pelo próprio usuário sem passar por getSessionProfile", () => {
    // Heurística: um select direto em "profiles" .eq("id", user.id) fora de
    // session-profile.ts é o padrão que a spec elimina (era a query
    // duplicada por página). Não bloqueia OUTRAS queries em profiles (ex.
    // lista de cadetes, lista de militares) — só a auto-consulta pelo id do
    // usuário logado.
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith(join("lib", "session-profile.ts"))) continue;
      const content = readFileSync(file, "utf-8");
      if (/\.from\(["']profiles["']\)[\s\S]*?\.eq\(["']id["'],\s*user\.id\)/.test(content)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
