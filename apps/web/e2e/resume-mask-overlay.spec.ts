import { expect, test } from "@playwright/test";
import { BASE_URL, login } from "./harness";

/**
 * Regressão do FOUC branco relatado em produção (2026-07-18). Causa raiz
 * real: ResumeMaskOverlay (apps/web/src/components/providers.tsx) nascia
 * com `masked=true` incondicionalmente em TODA rota — inclusive /login —
 * cobrindo a tela inteira por um ciclo de render até um useEffect (que só
 * roda após o primeiro paint) corrigir para rotas fora do dashboard. O fix
 * computa o estado inicial a partir do pathname (síncrono, mesmo valor em
 * SSR e no 1º render client), então o HTML inicial já deve vir com o
 * overlay desmascarado em rotas públicas — sem depender de um useEffect
 * pós-paint para corrigir.
 *
 * Este arquivo fica no projeto "suite" (não em "arsenal-profile-feedback",
 * que nenhum job de CI dispara) especificamente para que a invariante de
 * segurança abaixo tenha cobertura automática real — achado de code review:
 * um teste que nunca roda em CI não é um guard-rail.
 */

function overlayClass(html: string): string | null {
  const match = html.match(/data-testid="resume-mask-overlay"[^>]*class="([^"]*)"/);
  return match ? match[1] : null;
}

test.describe("ResumeMaskOverlay — mascaramento correto por rota", () => {
  test("SSR de /login já renderiza o formulário e o resume-mask-overlay desmascarado (sem flash)", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/login`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain("Bem-vindo de volta");

    const overlayClassAttr = overlayClass(html);
    expect(overlayClassAttr, "resume-mask-overlay deveria estar presente no HTML inicial").not.toBeNull();
    expect(overlayClassAttr).toContain("opacity-0");
    expect(overlayClassAttr).not.toContain("opacity-100");
  });

  // Teste espelhado (achado de code review de segurança): garante que o fix
  // acima não afrouxou a invariante oposta, mais crítica — rota de
  // dashboard continua nascendo MASCARADA no SSR, exatamente como antes do
  // fix do FOUC. Sem este teste, um refactor futuro que confundisse a
  // condição de isDashboardRoute() passaria despercebido pelo CI.
  test("SSR de /admin (autenticado) continua renderizando o resume-mask-overlay mascarado", async ({ page }) => {
    await login(page, "admin");
    const res = await page.request.get(`${BASE_URL}/admin`);
    expect(res.status()).toBe(200);
    const html = await res.text();

    const overlayClassAttr = overlayClass(html);
    expect(overlayClassAttr, "resume-mask-overlay deveria estar presente no HTML inicial").not.toBeNull();
    expect(overlayClassAttr).toContain("opacity-100");
    expect(overlayClassAttr).not.toContain("opacity-0");
  });
});
