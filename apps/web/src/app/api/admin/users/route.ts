export const runtime = "edge";

import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { canInvite, allowedRoles, canChangeUserEmail } from "@/lib/invite-ceiling";

// Checagem de teto de privilégio usada nos dois fluxos abaixo (re-invite e
// novo usuário) para os TRÊS papéis chamadores — achado de code review:
// este endpoint nunca checava admin_global, e `role`/`userRole` aqui é um
// `string` puro sem validação de enum. Antes deste fix, um admin_global
// (papel escopado ao próprio tenant) conseguia enviar role: "superadmin" e
// criar uma conta de operador da plataforma inteira (Nexus-only,
// tenant-less) — nenhuma das duas checagens (só armeiro/admin_reserva)
// bloqueava isso.

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
        .select("role, default_tenant_id, email, invite_sent_at")
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
      // Checa os TRÊS papéis chamadores contra o teto (inclusive admin_global
      // — achado real: faltava checagem pra esse papel, ver comentário no
      // topo do arquivo).
      if (!canInvite(role, target.role)) {
        return NextResponse.json({ error: `Seu papel só pode provisionar acesso para: ${allowedRoles(role).join(", ") || "nenhum papel"}` }, { status: 403 });
      }

      // Distingue "primeiro provisionamento de login" (target.email ainda
      // nulo, ou reenvio do MESMO e-mail — fluxo já existente, usado por
      // armeiro/admin_reserva dentro do próprio teto) de uma TROCA de e-mail
      // de acesso de alguém que já tem conta ativa (target.email != email
      // recebido). Isso é uma ação mais sensível — o usuário perde acesso
      // pelo e-mail antigo imediatamente — então tem um teto PRÓPRIO
      // (canChangeUserEmail), mais estreito que canInvite acima e que NUNCA
      // inclui armeiro, mesmo quando o alvo (role "usuario") está dentro do
      // teto geral dele. Comparação normalizada (trim + lowercase) — e-mail
      // é case-insensitive por convenção (e no próprio auth.users do
      // Supabase); sem isso, um reenvio legítimo do MESMO endereço com
      // capitalização diferente (autofill, copy/paste) seria tratado como
      // troca de verdade e bloquearia armeiro/admin_reserva por engano.
      const oldEmail = target.email as string | null;
      const oldInviteSentAt = target.invite_sent_at as string | null;
      const normalizedOldEmail = oldEmail?.trim().toLowerCase() ?? null;
      const normalizedNewEmail = email.trim().toLowerCase();
      const isEmailChange = !!normalizedOldEmail && normalizedOldEmail !== normalizedNewEmail;
      if (isEmailChange && !canChangeUserEmail(role)) {
        return NextResponse.json(
          { error: "Apenas Admin Global ou Admin Reserva podem alterar o e-mail de acesso de um usuário que já possui conta." },
          { status: 403 }
        );
      }

      // Reivindica a linha em `profiles` ANTES de tocar em auth.users — lock
      // otimista contra TOCTOU (achado de code review, mesmo padrão de
      // profiles.ts PATCH /:id para role, `.eq("role", oldRole)`). A ORDEM
      // importa: a Admin API do GoTrue não suporta update condicional por
      // valor atual (não dá pra fazer compare-and-swap em auth.users.email
      // diretamente), então rodar esta claim ANTES do updateUserById abaixo
      // garante que só o request que "vence" a corrida (o UPDATE aqui afeta
      // 1 linha) prossegue pro lado auth.users — o perdedor recebe 409 sem
      // NUNCA ter trocado o e-mail de LOGIN de ninguém. A primeira versão
      // deste fix fazia essa claim DEPOIS do updateUserById: o perdedor
      // ainda assim tinha o e-mail de login trocado por baixo, e o 409
      // devolvido a ele era enganoso (sugeria que nada tinha mudado, quando
      // na verdade o login dele foi silenciosamente redirecionado).
      let claimQuery = supabase
        .from("profiles")
        .update({ email, invite_sent_at: new Date().toISOString() })
        .eq("id", existingUserId);
      claimQuery = oldEmail
        ? claimQuery.eq("email", oldEmail)
        : claimQuery.is("email", null);
      const { data: claimedProfile, error: claimErr } = await claimQuery.select("id").maybeSingle();
      if (claimErr) throw claimErr;
      if (!claimedProfile) {
        return NextResponse.json(
          { error: "O e-mail deste usuário mudou nesse meio tempo. Recarregue e tente novamente." },
          { status: 409 }
        );
      }

      // Update auth user email (previously a non-deliverable internal address)
      const { error: updateErr } = await supabase.auth.admin.updateUserById(existingUserId, {
        email,
        email_confirm: true,
      });
      if (updateErr) {
        // Rollback do claim acima — profiles.email é só espelho de leitura,
        // a fonte de verdade de LOGIN é auth.users; sem desfazer isso aqui,
        // profiles ficaria apontando pro e-mail novo enquanto o login
        // continua no antigo (ex: falha por e-mail duplicado — o catch no
        // fim do handler devolve 409 amigável, mas sem este rollback o
        // profile ficaria mentindo sobre qual e-mail está de fato ativo).
        // Guard .eq("email", email): só reverte se a linha AINDA tem o
        // valor que ESTA request acabou de reivindicar (não sobrescreve a
        // claim de um terceiro request concorrente que já tenha avançado).
        //
        // Restaura pro e-mail VERIFICADO agora em auth.users (não pro
        // `oldEmail` capturado no início da request) — achado de code
        // review: numa cadeia de 2 falhas consecutivas de updateUserById em
        // requests concorrentes pro MESMO usuário (A reivindica, falha,
        // rollback fica pendente; C lê o valor que A reivindicou como SEU
        // oldEmail, reivindica por cima, também falha), restaurar pro
        // oldEmail capturado localmente por cada request podia gravar em
        // profiles um e-mail "fantasma" que nunca foi de fato confirmado em
        // auth.users — só existiu como claim transitória de outro request
        // que também falhou. Consultar auth.users diretamente aqui garante
        // que profiles nunca aponte pra um e-mail que o usuário não
        // consegue de fato usar pra logar, não importa quantas falhas
        // encadeadas aconteçam.
        const { data: verified } = await supabase.auth.admin.getUserById(existingUserId).catch(() => ({ data: null }));
        const verifiedEmail = verified?.user?.email ?? oldEmail;
        await supabase
          .from("profiles")
          .update({ email: verifiedEmail, invite_sent_at: oldInviteSentAt })
          .eq("id", existingUserId)
          .eq("email", email);
        throw updateErr;
      }

      // Send magic link to the real email — works for existing users unlike inviteUserByEmail.
      // redirectTo → /auth/exchange (client-side, lê tokens do hash) porque o callback PKCE
      // falha para flows iniciados por email (sem code_verifier no browser).
      // O BFF exchange detecta registration_status=pending e retorna landAt=/auth/confirmar-conta.
      // NOTA: se isto falhar, NÃO revertemos o e-mail — o updateUserById
      // acima já teve sucesso (o login já mudou de verdade); desfazer o
      // e-mail agora deixaria o usuário sem conseguir entrar nem pelo
      // antigo nem pelo novo, pior que só o link falhar (o admin pode
      // reenviar depois usando o mesmo "Alterar e-mail", que agora vira um
      // reenvio pro mesmo endereço — sem o teto extra, já que
      // oldEmail === email nesse ponto).
      const { error: linkErr } = await supabase.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo: `${siteUrl}/auth/exchange` },
      });
      if (linkErr) throw linkErr;

      // Troca de e-mail de acesso (não primeiro provisionamento): mesma
      // classe de mutação sensível já auditada em profiles.ts PATCH /:id
      // (role/status change) — actor, alvo, e-mail anterior → novo. Nunca
      // grava o token do magic link (gerado só em memória acima, nunca
      // chega ao metadata). Erros de auditoria/notificação são logados, não
      // lançados — a mutação principal (e-mail já trocado acima) não pode
      // ser revertida/reportada como falha só porque um registro secundário
      // não gravou.
      if (isEmailChange) {
        const { error: auditErr } = await supabase.from("audit_logs").insert({
          actor_id: session!.userId,
          action: "profile.email_changed",
          resource_type: "profiles",
          resource_id: existingUserId,
          metadata: { email_anterior: oldEmail, email_novo: email, changed_by_role: role },
        });
        if (auditErr) {
          console.error("[POST /api/admin/users] falha ao gravar audit_log de troca de e-mail", { existingUserId, error: auditErr.message });
        }

        // Notificação in-app para o usuário afetado. Não existe pipeline de
        // e-mail transacional custom neste repo (só os templates nativos do
        // Supabase Auth, disparados pelo generateLink acima — e só para o
        // e-mail NOVO). Um aviso de segurança para o e-mail ANTIGO ("seu
        // login foi alterado") exigiria SMTP/provedor de e-mail próprio, que
        // não existe em apps/bff — fora do esforço razoável desta tarefa.
        // Mínimo viável: notificação in-app, visível quando o usuário
        // acessar de novo. Requer o valor 'email_changed' em
        // notification_type_enum (ver migration
        // 20260815090000_add_email_changed_notification_type.sql) — SEM
        // essa migration aplicada, este insert falha e é só logado (achado
        // de code review: a mesma classe de bug já ocorreu 2x neste repo
        // por inserts de notification com type ausente do enum, sempre por
        // não checar o erro do insert — não repetir esse silêncio aqui).
        const { error: notifErr } = await supabase.from("notifications").insert({
          user_id: existingUserId,
          type: "email_changed",
          title: "E-mail de acesso alterado",
          body: "Seu e-mail de acesso foi alterado por um administrador. Se você não reconhece esta ação, procure o administrador do sistema.",
          metadata: { email_anterior: oldEmail, email_novo: email, changed_by_role: role },
        });
        if (notifErr) {
          console.error("[POST /api/admin/users] falha ao notificar usuário sobre troca de e-mail", { existingUserId, error: notifErr.message });
        }
      }

      return NextResponse.json({ success: true, user_id: existingUserId, invite_sent: true, email_changed: isEmailChange });
    }

    // New user flow
    if (!nome_completo || !matricula) {
      return NextResponse.json({ error: "email, nome_completo e matricula são obrigatórios" }, { status: 400 });
    }

    // Checa os TRÊS papéis chamadores (ver comentário no topo do arquivo —
    // faltava checagem para admin_global, que antes conseguia criar
    // qualquer role_enum, inclusive "superadmin").
    if (!canInvite(role, userRole)) {
      return NextResponse.json({ error: `Seu papel só pode criar: ${allowedRoles(role).join(", ") || "nenhum papel"}` }, { status: 403 });
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
      role: userRole as "admin_global" | "armeiro" | "usuario" | "admin_reserva" | "auditor",
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
