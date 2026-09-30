import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { getIronSession } from "iron-session";
import { authMiddleware } from "../../middleware/auth.ts";
import { requestIdMiddleware } from "../../middleware/request-id.ts";
import { nexusRoutes } from "../../routes/nexus.ts";
import { sessionOptions, type SessionData } from "../../lib/session.ts";
import { baseLogger } from "../../lib/logger.ts";
import { supabase } from "../../services/supabase.ts";
import type { HonoVariables } from "../../types/hono.ts";

// Varredura de e-mail (2026-09-30): POST /api/nexus/tenants/:id/invite
// (superadmin convidando o primeiro admin_global de um tenant novo) usava
// inviteUserByEmail — e-mail cru do GoTrue, sem a marca Andrômeda. Mesma
// classe de gap já corrigida em admin.ts (enviar-acesso e /users/invite).
// Este teste confirma que a rota do Nexus segue o mesmo padrão: generateLink
// (sem disparo de e-mail do GoTrue) + template "acesso" do BFF.

const ORIGINAL_FROM = supabase.from.bind(supabase);
const ORIGINAL_AUTH_ADMIN = { ...supabase.auth.admin };
const TENANT_ID = "95555555-0000-0000-0000-000000000001";
const ACTOR_ID = "95555555-1111-1111-1111-111111111111";

let authAdminCalls: string[] = [];
let emailLogRow: Record<string, unknown> | null = null;
let auditMetadata: Record<string, unknown> | null = null;

function builder(data: unknown, extra: Record<string, unknown> = {}): unknown {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data, error: null, ...extra });
      if (prop === "single" || prop === "maybeSingle") return async () => ({ data, error: null, ...extra });
      return () => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
}

let inserts: string[] = [];

function defaultFromMock(table: string) {
  if (table === "tenants") {
    return { select: () => builder({ id: TENANT_ID, nome: "Tenant Teste", slug: "tenant-teste" }) };
  }
  if (table === "profiles") {
    return {
      select: (cols: string) => cols.includes("sessions_invalidated_at")
        ? builder({ role: "superadmin", sessions_invalidated_at: null })
        : builder(null), // checagem de profile existente: por padrão não existe (caminho feliz)
      insert: () => { inserts.push("profiles"); return builder(null); },
    };
  }
  if (table === "tenant_memberships") {
    return { upsert: () => builder(null) };
  }
  if (table === "audit_logs") {
    return {
      insert: (row: Record<string, unknown>) => {
        if (row.action === "nexus.tenant.admin_invited") auditMetadata = row.metadata as Record<string, unknown>;
        return builder(null);
      },
    };
  }
  if (table === "email_log") {
    return { insert: (row: Record<string, unknown>) => { emailLogRow = row; return builder(null); } };
  }
  return { select: () => builder(null), insert: () => builder(null), upsert: () => builder(null) };
}

before(() => {
  // @ts-expect-error monkey-patch intencional do singleton pra teste de integração
  supabase.from = defaultFromMock;
  supabase.auth.admin.inviteUserByEmail = (async () => {
    authAdminCalls.push("inviteUserByEmail");
    return { data: { user: { id: "convidado-nexus-1", email: null } }, error: null };
  }) as never;
  supabase.auth.admin.generateLink = (async (params: { type: string }) => {
    authAdminCalls.push("generateLink:" + params.type);
    return {
      data: { user: { id: "convidado-nexus-1", email: null }, properties: { hashed_token: "b".repeat(56) } },
      error: null,
    };
  }) as never;
  supabase.auth.admin.deleteUser = (async () => {
    authAdminCalls.push("deleteUser");
    return { data: {}, error: null };
  }) as never;
});

after(() => {
  supabase.from = ORIGINAL_FROM;
  Object.assign(supabase.auth.admin, ORIGINAL_AUTH_ADMIN);
});

beforeEach(() => {
  // @ts-expect-error monkey-patch intencional do singleton pra teste de integração
  supabase.from = defaultFromMock;
  authAdminCalls = [];
  emailLogRow = null;
  auditMetadata = null;
  inserts = [];
});

const app = new Hono<{ Variables: HonoVariables }>();
app.use("*", requestIdMiddleware);
app.use("/api/*", authMiddleware);
app.route("/api/nexus", nexusRoutes);

async function request(path: string, body: unknown) {
  const req = new Request("http://localhost/seal");
  const res = new Response(null);
  const session = await getIronSession<SessionData>(req, res, sessionOptions);
  Object.assign(session, {
    userId: ACTOR_ID, role: "superadmin", tenantId: TENANT_ID, reserveId: null,
    supabaseAccessToken: "fake", sessionId: "sess-93-superadmin", issuedAt: Date.now(),
    nexusAuthorized: true, nexusAuthorizedAt: Date.now(),
  } satisfies Partial<SessionData>);
  await session.save();
  const cookie = res.headers.get("set-cookie")!;
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

describe("POST /api/nexus/tenants/:id/invite — e-mail de convite usa o modelo da marca", () => {
  it("usa generateLink(type:invite) + template \"acesso\" — nunca inviteUserByEmail", async () => {
    const res = await request(`/api/nexus/tenants/${TENANT_ID}/invite`, { email: "novo.admin@exemplo.com", nome_completo: "Novo Admin" });
    assert.equal(res.status, 201, `esperava 201, veio ${res.status}: ${JSON.stringify(await res.clone().json())}`);
    assert.ok(!authAdminCalls.includes("inviteUserByEmail"), "usou inviteUserByEmail — e-mail cru do GoTrue, sem a marca Andrômeda");
    assert.ok(authAdminCalls.includes("generateLink:invite"), "não chamou generateLink(type:invite)");
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(emailLogRow, "nenhum e-mail foi registrado em email_log");
    assert.equal((emailLogRow as unknown as { template: string }).template, "acesso");
    assert.equal((emailLogRow as unknown as { status: string }).status, "failed", "RESEND não configurado no teste ⇒ envio deveria falhar (not_configured)");
    assert.ok(auditMetadata, "audit_logs não recebeu o registro de convite");
    assert.equal((auditMetadata as Record<string, unknown>).email_sent, false);
  });

  it("e-mail realmente sai (ok:true) — email_log e audit_logs refletem email_sent:true", async () => {
    const ENV_KEYS = ["EMAIL_ENABLED", "RESEND_API_KEY", "FROM_EMAIL"] as const;
    const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    const REAL_FETCH = globalThis.fetch;
    process.env.EMAIL_ENABLED = "true";
    process.env.RESEND_API_KEY = "re_test_fake_key";
    process.env.FROM_EMAIL = "alertas@pmpb.online";
    globalThis.fetch = (async () => new Response(JSON.stringify({ id: "email_fake_nexus_1" }), { status: 200 })) as unknown as typeof fetch;
    try {
      const res = await request(`/api/nexus/tenants/${TENANT_ID}/invite`, { email: "novo.admin2@exemplo.com", nome_completo: "Novo Admin 2" });
      assert.equal(res.status, 201, `esperava 201, veio ${res.status}: ${JSON.stringify(await res.clone().json())}`);
      await new Promise((r) => setTimeout(r, 0));
      assert.ok(emailLogRow);
      assert.equal((emailLogRow as unknown as { status: string }).status, "sent");
      assert.equal((emailLogRow as unknown as { resend_id: string }).resend_id, "email_fake_nexus_1");
      assert.ok(auditMetadata);
      assert.equal((auditMetadata as Record<string, unknown>).email_sent, true);
    } finally {
      globalThis.fetch = REAL_FETCH;
      for (const k of ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
      }
    }
  });
});

describe("POST /api/nexus/tenants/:id/invite — generateLink falha antes de criar qualquer vínculo", () => {
  it("generateLink devolve error → 422, nenhum profile/membership gravado, sem deleteUser espúrio", async () => {
    const origGenerateLink = supabase.auth.admin.generateLink;
    supabase.auth.admin.generateLink = (async (params: { type: string }) => {
      authAdminCalls.push("generateLink:" + params.type);
      return { data: { user: null, properties: null }, error: { message: "boom", status: 500 } };
    }) as never;
    try {
      const res = await request(`/api/nexus/tenants/${TENANT_ID}/invite`, { email: "falha-generatelink@exemplo.com" });
      assert.equal(res.status, 422);
      assert.ok(!inserts.includes("profiles"));
      assert.ok(!authAdminCalls.includes("deleteUser"), "chamou deleteUser sem conta nenhuma ter sido criada (inviteData.user era null)");
    } finally {
      supabase.auth.admin.generateLink = origGenerateLink;
    }
  });

  it("generateLink devolve sucesso mas sem hashed_token → 422, faz rollback (deleteUser) da conta órfã, nada gravado", async () => {
    const origGenerateLink = supabase.auth.admin.generateLink;
    supabase.auth.admin.generateLink = (async (params: { type: string }) => {
      authAdminCalls.push("generateLink:" + params.type);
      return { data: { user: { id: "sem-token-nexus-1", email: null }, properties: {} }, error: null };
    }) as never;
    try {
      const res = await request(`/api/nexus/tenants/${TENANT_ID}/invite`, { email: "sem-hashed-token@exemplo.com" });
      assert.equal(res.status, 422);
      assert.ok(!inserts.includes("profiles"), "gravou profile mesmo sem hashed_token pra montar o link");
      assert.ok(authAdminCalls.includes("deleteUser"), "não limpou a conta órfã criada pelo generateLink sem hashed_token");
    } finally {
      supabase.auth.admin.generateLink = origGenerateLink;
    }
  });
});

describe("POST /api/nexus/tenants/:id/invite — reaproveitamento de auth.users pendente de OUTRO tenant", () => {
  it("e-mail já pertence a um profile de outro tenant (convite pendente) → 409, profile NÃO sobrescrito", async () => {
    const origFrom = supabase.from;
    supabase.from = ((table: string) => {
      if (table === "profiles") {
        return {
          select: (cols: string) => cols.includes("sessions_invalidated_at")
            ? builder({ role: "superadmin", sessions_invalidated_at: null })
            : builder({ id: "convidado-nexus-1", default_tenant_id: "92222222-9999-9999-9999-999999999999" }),
          insert: () => { inserts.push("profiles"); return builder(null); },
        };
      }
      return (origFrom as (t: string) => unknown)(table);
    }) as typeof supabase.from;

    const res = await request(`/api/nexus/tenants/${TENANT_ID}/invite`, { email: "reaproveitado@exemplo.com" });
    assert.equal(res.status, 409, `esperava 409, veio ${res.status}: ${JSON.stringify(await res.clone().json())}`);
    assert.ok(!inserts.includes("profiles"), "sobrescreveu o profile do convite pendente de outro tenant");
  });
});
