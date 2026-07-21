import { createClient } from "@/lib/supabase/client";
import { csrfHeaders } from "@/lib/csrf";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

// Chave compartilhada entre quem dispara o logout (ex: IdleTimeoutGuard,
// providers.tsx) e quem exibe o motivo na tela de login (LogoutReasonNotice,
// login/page.tsx). sessionStorage em vez de query string na URL de redirect
// — sobrevive ao hard redirect na mesma aba independente de uma eventual
// corrida com outro código que também redirecione para /login (ex:
// AuthListener reagindo ao evento SIGNED_OUT disparado por
// supabase.auth.signOut() dentro de signOutAndRedirect).
export const LOGOUT_REASON_KEY = "apmcb_logout_reason";

/**
 * Destrói a sessão do servidor (iron-session no BFF) e do Supabase, depois força
 * um full page load. Hard navigation é obrigatório aqui — soft navigation
 * (router.push/replace) deixa o Router Cache do Next reaproveitar payload RSC
 * da sessão anterior quando outro usuário loga na mesma aba em seguida.
 */
export async function signOutAndRedirect(opts?: { logoutPath?: string; redirectTo?: string }) {
  const logoutPath = opts?.logoutPath ?? "/api/auth/logout";
  const redirectTo = opts?.redirectTo ?? "/login";
  try {
    await fetch(`${BFF_URL}${logoutPath}`, {
      method: "POST",
      credentials: "include",
      headers: csrfHeaders(),
    });
  } catch {
    // Segue para signOut/redirect mesmo se a chamada ao BFF falhar —
    // logout nunca deve deixar o usuário preso numa sessão travada.
  }
  const supabase = createClient();
  await supabase.auth.signOut();
  window.location.href = redirectTo;
}
