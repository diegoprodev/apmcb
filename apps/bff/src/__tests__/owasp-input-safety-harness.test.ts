import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";

const repoRoot = resolve(process.cwd(), "..", "..");
const RAW_SQL_PATTERN =
  /(?:\b(?:execute_sql|exec_sql)\b|\bpostgres\s*\(|\bsql\s*(?:\/\*[\s\S]*?\*\/\s*)?`|\.(?:raw)\s*\(|\b(?:pool|client|db|conn|connection)\s*\.\s*(?:query|execute)\s*\(|(?:\bprisma\s*\.\s*)?\$(?:queryRaw|executeRaw)(?:Unsafe)?\b)/;
const XSS_SINK_PATTERN =
  /(?:\bdangerouslySetInnerHTML\b|\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b|\bdocument\s*(?:\.\s*write|\[\s*["']write["']\s*\])|(?:^|[^\w$])eval\s*\(|new\s+Function\s*\(|\[\s*["'](?:innerHTML|outerHTML|insertAdjacentHTML)["']\s*\])/;

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist" || entry === "__tests__") continue;
    const full = resolve(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...filesUnder(full));
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

function read(relPath: string) {
  return readFileSync(resolve(repoRoot, relPath), "utf8");
}

function stripLineComments(text: string) {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

function assertNoPattern(files: string[], pattern: RegExp, message: string) {
  const hits = files
    .map((file) => ({ file, text: readFileSync(file, "utf8") }))
    .filter(({ text }) => pattern.test(text))
    .map(({ file }) => relative(repoRoot, file));

  assert.deepEqual(hits, [], message);
}

describe("OWASP input safety harness", () => {
  const appFiles = [
    ...filesUnder(resolve(repoRoot, "apps", "bff", "src")),
    ...filesUnder(resolve(repoRoot, "apps", "web", "src")),
  ];

  it("detects common raw SQL bypass spellings", () => {
    for (const sample of [
      "await pool.query(userSql)",
      "await client.query(`select * from profiles where id = ${id}`)",
      "await db.execute(inputSql)",
      "await connection.execute(statement)",
      "await prisma.$queryRaw`select * from profiles`",
      "await prisma.$executeRawUnsafe(inputSql)",
      "const rows = await sql /* typed */`select 1`",
    ]) {
      assert.match(sample, RAW_SQL_PATTERN);
    }
  });

  it("does not use raw SQL execution primitives in application source", () => {
    assertNoPattern(
      appFiles,
      RAW_SQL_PATTERN,
      "Application code must use typed Supabase query builder/RPC wrappers, not raw SQL string execution",
    );
  });

  it("detects direct and computed browser HTML/script sinks", () => {
    for (const sample of [
      "node.innerHTML = userText",
      "container.insertAdjacentHTML('beforeend', html)",
      "document.write(markup)",
      "document['write'](markup)",
      "element['outerHTML'] = html",
      "eval(userInput)",
      "new Function(userInput)",
    ]) {
      assert.match(sample, XSS_SINK_PATTERN);
    }
  });

  it("does not use browser XSS sinks for report rendering", () => {
    assertNoPattern(
      appFiles,
      XSS_SINK_PATTERN,
      "Application code must avoid raw HTML/script sinks; render with React or DOM textContent/createElement",
    );
  });

  it("keeps production CSP and browser CSRF wiring locked down", () => {
    const middleware = read("apps/web/src/middleware.ts");
    assert.match(middleware, /default-src 'self'/);
    assert.match(middleware, /frame-ancestors 'none'/);
    assert.match(middleware, /base-uri 'self'/);
    assert.match(middleware, /form-action 'self'/);

    const productionScriptSrc = middleware.match(/\? "script-src ([^"]+)"/)?.[1] ?? "";
    assert.equal(
      productionScriptSrc.includes("unsafe-eval"),
      false,
      "Production CSP must not allow unsafe-eval",
    );

    const csrfClient = stripLineComments(read("apps/web/src/lib/csrf.ts"));
    assert.match(csrfClient, /sessionStorage\.getItem\("csrf-token"\)/);
    assert.match(csrfClient, /"X-CSRF-Token"/);
    assert.equal(
      csrfClient.includes("document.cookie"),
      false,
      "Browser CSRF helper must not read tokens from document.cookie",
    );
  });

  it("enforces CSRF middleware before authenticated API routes with exact exemptions", () => {
    const index = read("apps/bff/src/index.ts");
    const csrfIndex = index.indexOf('app.use("/api/*", csrfMiddleware);');
    assert.ok(csrfIndex >= 0, "BFF must register CSRF middleware on /api/*");

    const authenticatedRoutes = Array.from(index.matchAll(/app\.use\("([^"]+)",\s*authMiddleware\)/g));
    assert.ok(authenticatedRoutes.length >= 10, "Harness must see the authenticated API route registrations");

    for (const route of authenticatedRoutes) {
      const routePath = route[1];
      const routeIndex = route.index;
      assert.equal(typeof routeIndex, "number", `Could not locate auth middleware registration for ${routePath}`);
      assert.ok(
        csrfIndex < routeIndex,
        `CSRF middleware must run before authenticated API route ${routePath}`,
      );
    }

    const csrf = read("apps/bff/src/middleware/csrf.ts");
    assert.match(csrf, /const SAFE_METHODS = new Set\(\["GET", "HEAD", "OPTIONS"\]\)/);
    assert.match(csrf, /session\.csrfToken/);
    assert.match(csrf, /c\.req\.header\(CSRF_HEADER\)/);
    assert.match(csrf, /sessionToken !== headerToken/);
    assert.equal(csrf.includes('path.startsWith("/api/'), false, "CSRF exemptions must not be wildcard path prefixes");

    const exemptPaths = Array.from(csrf.matchAll(/path === "([^"]+)"/g), (match) => match[1]).sort();
    assert.deepEqual(
      exemptPaths,
      [
        "/api/auth/exchange",
        "/api/auth/login",
        "/api/auth/logout",
        "/api/nexus/logout",
        "/api/nexus/setup-2fa/confirm",
        "/api/push/broadcast",
        "/api/totp/self-validate",
      ].sort(),
      "CSRF exemptions must stay explicit and reviewable",
    );

    for (const route of ["/api/lendings", "/api/saidas", "/api/cautelamentos", "/api/admin", "/api/arsenal"]) {
      assert.equal(csrf.includes(route), false, `${route} must not be CSRF-exempt`);
    }
  });
});
