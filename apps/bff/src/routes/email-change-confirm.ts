import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../lib/validated-json";
import { supabase } from "../services/supabase";
import { sendEmail } from "../services/email";
import { renderTemplate } from "../lib/email-templates/index.ts";
import { primeiroNome } from "../lib/primeiro-nome";
import { persistEmailLog, persistEmailFailureAudit } from "../lib/email-log";
import { classifyEmailUpdateOutcome } from "../lib/acesso-email-update.ts";
import { hashEmailChangeToken } from "../lib/email-change-token";
import { auditLogDirect } from "../middleware/audit";
import { getAuditClientIp } from "../lib/audit-client-ip";
import type { HonoVariables } from "../types/hono";

// Confirmação de troca de e-mail de acesso (spec:
// docs/enterprise/specs/troca-email-acesso-enterprise.md §5.2). Endpoints
// PÚBLICOS — sem roleGuard/sessão — o token é a prova de identidade, mesmo
// modelo de recovery link do GoTrue. Mesmo motivo pelo qual isto NÃO fica no
// Hono `adminRoutes` (autenticado) nem serve HTML: só JSON, consumido pela
// página apps/web/src/app/auth/email-change/confirm/page.tsx.
//
// GET /validate — read-only, nunca marca nada. Existe separado do POST
// justamente para que uma pré-busca automática de link (scanner corporativo
// de e-mail, Outlook Safe Links) nunca confirme a troca por engano — só o
// clique real no botão da página dispara o POST abaixo.
export const emailChangeConfirmRoutes = new Hono<{ Variables: HonoVariables }>();

emailChangeConfirmRoutes.get(
  "/validate",
  zValidator("query", z.object({ token: z.string().min(1).max(500) })),
  async (c) => {
    const { token } = c.req.valid("query");
    const tokenHash = hashEmailChangeToken(token);

    const { data: pending } = await supabase
      .from("pending_email_changes")
      .select("new_email, confirmed_at, expires_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (!pending) return c.json({ valid: false, reason: "invalid" });
    if (pending.confirmed_at) return c.json({ valid: false, reason: "already_confirmed" });
    if (new Date(pending.expires_at) < new Date()) return c.json({ valid: false, reason: "expired" });

    return c.json({ valid: true, new_email: pending.new_email });
  },
);

emailChangeConfirmRoutes.post(
  "/confirm",
  zValidator("json", z.object({ token: z.string().min(1).max(500) })),
  async (c) => {
    const { token } = c.req.valid("json");
    const log = c.get("log");
    const tokenHash = hashEmailChangeToken(token);

    const auditCtx = {
      actorId: null, actorRole: null, tenantId: null,
      ip: getAuditClientIp(c.req.raw, log),
      userAgent: c.req.header("user-agent") ?? null,
    };

    const { data: pending, error: lookupErr } = await supabase
      .from("pending_email_changes")
      .select("id, user_id, tenant_id, old_email, new_email, requested_by, requested_by_role, confirmed_at, expires_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (lookupErr) {
      log.error({ err: lookupErr.message }, "email_change.confirm.lookup_failure");
      return c.json({ error: "Não foi possível confirmar a troca agora. Tente novamente." }, 500);
    }
    // Resposta genérica — nunca revela se o token "não existe" vs. é
    // inválido, evita enumeração. Sem resource_id de audit_events (não temos
    // titularidade confirmada ainda).
    if (!pending) {
      void auditLogDirect(auditCtx, {
        action: "admin.user.email_change_confirm_failed",
        resource_type: "profiles",
        metadata: { reason: "invalid" },
      });
      return c.json({ error: "Link inválido." }, 400);
    }
    if (pending.confirmed_at) {
      void auditLogDirect(auditCtx, {
        action: "admin.user.email_change_confirm_failed",
        resource_type: "profiles",
        resource_id: pending.user_id,
        metadata: { reason: "already_confirmed", pending_id: pending.id },
      });
      return c.json({ error: "Este link já foi usado." }, 409);
    }
    if (new Date(pending.expires_at) < new Date()) {
      void auditLogDirect(auditCtx, {
        action: "admin.user.email_change_confirm_failed",
        resource_type: "profiles",
        resource_id: pending.user_id,
        metadata: { reason: "expired", pending_id: pending.id },
      });
      return c.json({ error: "Link expirado. Peça ao administrador para enviar um novo." }, 410);
    }

    // Passo 4 — dual-write: auth.users (fonte de verdade de login) primeiro,
    // profiles.email (espelho) depois. Reaproveita classifyEmailUpdateOutcome
    // pro caso de conflito (e-mail reivindicado por outra conta nesse
    // meio-tempo — o GoTrue devolve isso como 500 genérico, não confiável
    // sem re-conferência).
    const upd = await supabase.auth.admin.updateUserById(pending.user_id, {
      email: pending.new_email,
      email_confirm: true,
    });
    if (upd.error) {
      const { data: recheck, error: recheckErr } = await supabase.auth.admin.getUserById(pending.user_id);
      const outcome = classifyEmailUpdateOutcome({
        updateErrorStatus: upd.error.status,
        recheckEmail: recheckErr ? null : (recheck?.user?.email ?? null),
        targetEmail: pending.new_email,
      });
      if (!outcome.ok) {
        log.warn({ status: upd.error.status, err: upd.error.message, resolved: outcome.status }, "email_change.confirm.update_email_failure");
        return c.json({ error: outcome.error }, outcome.status ?? 500);
      }
    }

    await supabase.from("profiles").update({ email: pending.new_email }).eq("id", pending.user_id);
    await supabase.from("pending_email_changes").update({ confirmed_at: new Date().toISOString() }).eq("id", pending.id);

    // Passo 7 — auditoria canônica (hash-chain), com before/after — é AQUI
    // que a troca de fato aconteceu.
    void auditLogDirect(auditCtx, {
      action: "admin.user.email_change_confirmed",
      resource_type: "profiles",
      resource_id: pending.user_id,
      before_snapshot: { email: pending.old_email },
      after_snapshot: { email: pending.new_email },
      metadata: { requested_by: pending.requested_by, requested_by_role: pending.requested_by_role },
    });

    // Passo 8 — notificações fire-and-forget, try/catch total: a troca já
    // foi commitada nos passos acima; falha em avisar NUNCA desfaz isso.
    void (async () => {
      const { data: profile } = await supabase.from("profiles").select("nome_completo").eq("id", pending.user_id).maybeSingle();
      const primeiro = primeiroNome(profile?.nome_completo ?? null, "militar");
      const quando = new Date().toLocaleString("pt-BR", { timeZone: "America/Recife" });
      const frontendUrl = (process.env.FRONTEND_URL ?? "https://apmcb.pmpb.online").replace(/\/$/, "");

      try {
        const rendered = renderTemplate(
          "email_changed_notice",
          { old_email: pending.old_email, new_email: pending.new_email, quando },
          { baseUrl: frontendUrl, logoDataUri: "" },
          { nome: primeiro, orgao: null },
        );

        // Envio DIRETO via services/email.ts (nunca sendTransactionalEmail /
        // orquestrador — este sempre resolve o e-mail ATUAL da pessoa via
        // profiles, que já é o novo neste ponto; o endereço antigo não tem
        // mais nenhum jeito de ser alcançado por lookup). Mesmo bypass
        // deliberado que login-device.ts já faz pra `security`.
        const [oldRes, newRes] = await Promise.all([
          sendEmail({ to: pending.old_email, subject: rendered.subject, html: rendered.html, text: rendered.text, category: "security", log }),
          sendEmail({ to: pending.new_email, subject: rendered.subject, html: rendered.html, text: rendered.text, category: "security", log }),
        ]);

        for (const res of [oldRes, newRes]) {
          if (!res.ok) {
            await persistEmailFailureAudit(
              { template: "email_changed_notice", category: "security", error_code: res.error, resource_id: pending.user_id },
              log,
            );
          }
          void persistEmailLog({
            template: "email_changed_notice", category: "security", recipient_id: pending.user_id,
            status: res.ok ? "sent" : "failed",
            resend_id: res.ok ? res.id : null,
            error_code: res.ok ? null : res.error,
          }, log);
        }
      } catch (err) {
        log.error({ err: err instanceof Error ? err.message : String(err) }, "email_change.confirm.notice_exception");
      }

      await supabase.from("notifications").insert({
        user_id: pending.user_id,
        type: "email_changed",
        title: "E-mail de acesso alterado",
        body: `Seu e-mail de acesso foi alterado de ${pending.old_email} para ${pending.new_email}. Se você não reconhece esta ação, procure o administrador do sistema.`,
        tenant_id: pending.tenant_id,
        metadata: { email_anterior: pending.old_email, email_novo: pending.new_email, requested_by_role: pending.requested_by_role },
      }).then(({ error }) => {
        if (error) log.error({ err: error.message }, "email_change.confirm.notification_failure");
      });
    })();

    return c.json({ ok: true });
  },
);
