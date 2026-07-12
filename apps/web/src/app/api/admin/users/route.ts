export const runtime = "edge";

import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

function getSupabaseUrl() {
  return process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

function getServiceRoleKey(): string {
  // CF Pages injects secrets into the Cloudflare Workers env binding, not process.env
  // Try getRequestContext().env first (runtime secrets), then fall back to process.env (build-time)
  try {
    const cfEnv = getRequestContext().env as Record<string, string | undefined>;
    if (cfEnv.SUPABASE_SERVICE_ROLE_KEY) return cfEnv.SUPABASE_SERVICE_ROLE_KEY;
  } catch { /* not in CF Workers context */ }
  const fromEnv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (fromEnv) return fromEnv;
  throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured — adicione nas env vars do CF Pages (Settings > Environment Variables > Production + Preview)");
}

// Mesmo padrão de apps/web/src/app/api/admin/almoxarifado/route.ts — inclui
// tenantId (default_tenant_id do caller) porque o profile criado/atualizado
// aqui precisa ser escopado ao tenant do admin que está chamando. Sem isso,
// profiles_select RLS (default_tenant_id = my_tenant_id()) tornava a linha
// invisível na grid /admin/usuarios para admin_reserva/armeiro/admin_global.
async function getCallerSession(): Promise<{ userId: string; role: string; tenantId: string | null } | null> {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    getSupabaseUrl(),
    process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, default_tenant_id")
    .eq("id", user.id)
    .single();
  if (!profile) return null;
  return { userId: user.id, role: profile.role, tenantId: profile.default_tenant_id ?? null };
}

function adminClient() {
  return createSupabaseClient(getSupabaseUrl(), getServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getCallerSession();
    const role = session?.role ?? null;
    // superadmin NÃO incluído: é operador SaaS (Nexus-only, sem tenant) — todo
    // fluxo deste endpoint agora exige session.tenantId (H-RBAC canônico,
    // mesma regra já aplicada ao roleGuard de POST /api/admin/militares no
    // BFF e à página /reserva/militares). Antes desta correção, superadmin
    // passava neste gate mas sempre falhava depois com 400/404 — dead-end.
    const ALLOWED = ["admin_global", "admin_reserva", "armeiro"];
    if (!role || !ALLOWED.includes(role)) {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    const body = await req.json() as {
      email: string;
      nome_completo?: string;
      matricula?: string;
      posto?: string | null;
      role?: string;
      unidade?: string | null;
      telefone?: string | null;
      method: "magic_link" | "password";
      password?: string;
      // Re-invite an existing profile user (by profile id = auth user id)
      existing_user_id?: string;
    };

    const { email, posto, unidade, telefone, method, password } = body;
    const nome_completo = body.nome_completo ?? "";
    const matricula = body.matricula ?? "";
    const userRole = body.role ?? "usuario";
    const existingUserId = body.existing_user_id;

    if (!email) {
      return NextResponse.json({ error: "email é obrigatório" }, { status: 400 });
    }

    // Re-invite flow: existing profile user gets email updated + magic link sent
    if (existingUserId) {
      const supabase = adminClient();
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://apmcb.pmpb.online";

      // CRÍTICO (achado em code review): sem esta checagem, qualquer caller
      // ALLOWED (inclusive armeiro, cujo teto é só role "usuario") podia
      // passar o UUID de QUALQUER profile — de outro tenant, ou de role
      // superior ao seu teto — e este endpoint trocava o e-mail de login
      // dele e mandava um magic link, permitindo account takeover (ex:
      // armeiro sequestra o login de um admin_global do mesmo tenant).
      // A busca da UI só retorna role=usuario (search-profiles/route.ts),
      // mas a API em si não impunha nada — precisa ser reforçado aqui,
      // não só confiar no client.
      const { data: target } = await supabase
        .from("profiles")
        .select("role, default_tenant_id")
        .eq("id", existingUserId)
        .maybeSingle();
      if (!target) {
        return NextResponse.json({ error: "Militar não encontrado" }, { status: 404 });
      }
      // session.tenantId nulo (ex: superadmin, sem tenant por design H-RBAC)
      // nunca deve corresponder a nenhum alvo — "null !== null" seria true
      // (passaria) se não checado explicitamente aqui.
      if (!session!.tenantId || target.default_tenant_id !== session!.tenantId) {
        return NextResponse.json({ error: "Militar não encontrado" }, { status: 404 });
      }
      if (role === "armeiro" && target.role !== "usuario") {
        return NextResponse.json({ error: "Armeiro só pode provisionar acesso para usuário" }, { status: 403 });
      }
      if (role === "admin_reserva" && !["usuario", "armeiro"].includes(target.role)) {
        return NextResponse.json({ error: "Admin da reserva só pode provisionar acesso para usuário ou armeiro" }, { status: 403 });
      }

      // Update auth user email (previously a non-deliverable internal address)
      const { error: updateErr } = await supabase.auth.admin.updateUserById(existingUserId, {
        email,
        email_confirm: true,
      });
      if (updateErr) throw updateErr;

      // Send magic link to the real email — works for existing users unlike inviteUserByEmail.
      // redirectTo → /auth/exchange (client-side, lê tokens do hash) porque o callback PKCE
      // falha para flows iniciados por email (sem code_verifier no browser).
      // O BFF exchange detecta registration_status=pending e retorna landAt=/auth/confirmar-conta.
      const { error: linkErr } = await supabase.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo: `${siteUrl}/auth/exchange` },
      });
      if (linkErr) throw linkErr;

      // Update profile with real email + invite timestamp
      await supabase.from("profiles").update({
        email,
        invite_sent_at: new Date().toISOString(),
      }).eq("id", existingUserId);

      return NextResponse.json({ success: true, user_id: existingUserId, invite_sent: true });
    }

    // New user flow
    if (!nome_completo || !matricula) {
      return NextResponse.json({ error: "email, nome_completo e matricula são obrigatórios" }, { status: 400 });
    }

    // Armeiro só pode criar militares (usuario); admin_reserva pode criar militares e armeiros
    if (role === "armeiro" && userRole !== "usuario") {
      return NextResponse.json({ error: "Armeiro só pode criar login para militares" }, { status: 403 });
    }
    if (role === "admin_reserva" && !["usuario", "armeiro"].includes(userRole)) {
      return NextResponse.json({ error: "Admin da reserva só pode criar militares ou armeiros" }, { status: 403 });
    }
    // Mesmo achado do BFF /api/admin/militares: sem tenantId o profile novo
    // fica com default_tenant_id nulo e some da grid para roles tenant-scoped.
    if (!session!.tenantId) {
      return NextResponse.json({ error: "Tenant não identificado na sessão" }, { status: 400 });
    }
    const tenantId = session!.tenantId;

    const supabase = adminClient();
    let userId: string;

    if (method === "magic_link") {
      const siteUrl2 = process.env.NEXT_PUBLIC_SITE_URL ?? "https://apmcb.pmpb.online";
      // redirectTo → /auth/exchange pelo mesmo motivo do re-invite:
      // PKCE falha para email-initiated flows sem code_verifier.
      const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
        data: { nome_completo, matricula },
        redirectTo: `${siteUrl2}/auth/exchange`,
      });
      if (error) throw error;
      userId = data.user.id;
    } else {
      if (!password || password.length < 6) {
        return NextResponse.json({ error: "Senha deve ter ao menos 6 caracteres" }, { status: 400 });
      }
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { nome_completo, matricula },
      });
      if (error) throw error;
      userId = data.user.id;
    }

    const { error: profileError } = await supabase.from("profiles").upsert({
      id: userId,
      email,
      nome_completo,
      matricula,
      posto: posto ?? "cadete",
      role: userRole as "admin_global" | "armeiro" | "usuario" | "admin_reserva",
      registration_status: "pending_biometric",
      unidade: unidade ?? null,
      telefone: telefone ?? null,
      invite_sent_at: method === "magic_link" ? new Date().toISOString() : null,
      default_tenant_id: tenantId,
    });
    if (profileError) throw profileError;

    // role_enum não tem valor "member" — precisa ser um valor válido do enum
    // (mesmo bug encontrado e corrigido em apps/bff/src/routes/admin.ts).
    // Erro logado (não lançado): o profile já foi criado com sucesso acima —
    // falhar a request inteira aqui devolveria um 500 enganoso para um
    // usuário que na prática já existe. Mas se este upsert falhar
    // silenciosamente, o BFF (auth.ts) resolve session.tenantId a partir de
    // tenant_memberships no login desse usuário — falhando aqui sem logar
    // reproduziria a mesma classe de bug (achado em code review) que esta
    // tarefa corrigiu no BFF.
    const { error: membershipError } = await supabase.from("tenant_memberships").upsert(
      { tenant_id: tenantId, user_id: userId, role: userRole },
      { onConflict: "tenant_id,user_id" }
    );
    if (membershipError) {
      console.error("[POST /api/admin/users] falha ao criar tenant_membership", { userId, tenantId, error: membershipError.message });
    }

    const notifTitle = "Acesso ao sistema criado";
    const notifBody = method === "magic_link"
      ? "Seu acesso ao APMCB foi provisionado. Verifique seu e-mail para ativar a conta."
      : "Seu acesso ao APMCB foi criado com senha temporária. Faça login para continuar.";

    // Notifica o novo usuário que seu acesso foi criado
    await supabase.from("notifications").insert({
      user_id: userId,
      type: "account_created",
      title: notifTitle,
      body: notifBody,
      metadata: { method, created_by_role: role },
    }).maybeSingle();

    // Trigger PWA push via BFF (fire-and-forget — non-fatal)
    const bffUrl = process.env.BFF_URL ?? process.env.NEXT_PUBLIC_BFF_URL ?? "";
    const internalSecret = process.env.INTERNAL_API_SECRET ?? "";
    if (bffUrl && internalSecret) {
      fetch(`${bffUrl}/api/push/broadcast`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": internalSecret,
        },
        body: JSON.stringify({ user_id: userId, title: notifTitle, body: notifBody, url: "/efetivo" }),
      }).catch(() => {});
    }

    return NextResponse.json({ success: true, user_id: userId });
  } catch (err: unknown) {
    console.error("[POST /api/admin/users]", err);
    const message = err instanceof Error ? err.message : String(err) ?? "Erro interno";
    // Supabase errors for duplicate user
    if (message.includes("already registered") || message.includes("already been registered") || message.includes("User already exists")) {
      return NextResponse.json({ error: "Este e-mail já possui cadastro no sistema." }, { status: 409 });
    }
    if (message.includes("duplicate key") || message.includes("unique constraint")) {
      return NextResponse.json({ error: "Matrícula ou e-mail já cadastrado." }, { status: 409 });
    }
    if (message.includes("SUPABASE_SERVICE_ROLE_KEY")) {
      return NextResponse.json({ error: "Configuração pendente: adicione SUPABASE_SERVICE_ROLE_KEY nas env vars do CF Pages." }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
