/**
 * APMCB — Shared test helpers for the new spec files.
 * Re-exports everything from harness.ts and adds lightweight
 * convenience wrappers that take the full USERS object shape.
 */

import { type Page, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Re-export everything from harness so callers can use either file.
export {
  BASE_URL,
  BFF_URL,
  USERS,
  login,
  logout,
  waitForDashboard,
  collectPerf,
  assertNoJwtInLocalStorage,
  assertHttpOnlyCookies,
  monitorStorageErrors,
  assertAllImagesLoaded,
  type UserKey,
  type PerfSnapshot,
} from "./harness";

// ─── Toast helper ───────────────────────────────────────────────────────────

/**
 * Asserts that a Sonner toast containing `text` becomes visible.
 */
export async function expectToast(page: Page, text: string | RegExp) {
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: text })
  ).toBeVisible({ timeout: 6000 });
}

// ─── Table helper ───────────────────────────────────────────────────────────

/**
 * Waits for at least one tbody row to be visible and returns the row count.
 */
export async function waitForTableRows(page: Page, minRows = 1) {
  await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 8000 });
  const count = await page.locator("tbody tr").count();
  expect(count).toBeGreaterThanOrEqual(minRows);
  return count;
}

// ─── Turno (Livro Digital) helper ───────────────────────────────────────────

/**
 * Garante que o armeiro (por matrícula) tem um turno "ativo" antes de testar
 * páginas atrás do guard de turno (_shift-guard.tsx bloqueia /reserva/saidas/nova
 * inteira sem turno ativo). Usado por specs que testam esse fluxo sem passar
 * pela UI de abrir turno (TOTP real). Se já existir um turno ativo do PRÓPRIO
 * armeiro, não mexe (retorna null — não fechar no teardown o turno de outro
 * uso real). Se perder a corrida de criação para outro worker, trata como
 * sucesso — o turno que importa já está garantido.
 *
 * A constraint uq_shifts_reserve_ativo é por RESERVA, não por armeiro — só um
 * turno ativo por vez na mesma reserva, de qualquer armeiro. Se o conflito de
 * inserção for de OUTRO armeiro (turno órfão de execução anterior, ex: conta
 * de teste "Temp armeiro" nunca encerrada), o guard da página (que checa
 * armeiro_id === usuário logado) continua bloqueando o teste mesmo com essa
 * função retornando null — causa raiz de uma falha real em produção
 * (2026-07-15). Detectamos esse caso e, só quando o turno conflitante não tem
 * nenhum evento registrado (claramente órfão/abandonado, nunca usado), o
 * encerramos e tentamos de novo — nunca mexe em turno com atividade real.
 */
export async function ensureActiveShift(matricula: string): Promise<string | null> {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: profile } = await sb
    .from("profiles")
    .select("id, default_tenant_id")
    .eq("matricula", matricula)
    .single();
  const { data: existing } = await sb
    .from("service_shifts")
    .select("id")
    .eq("armeiro_id", profile!.id)
    .eq("status", "ativo")
    .maybeSingle();
  if (existing) return null;

  const { data: membership } = await sb
    .from("reserve_memberships")
    .select("reserve_id")
    .eq("user_id", profile!.id)
    .limit(1)
    .single();

  const tryInsert = () =>
    sb
      .from("service_shifts")
      .insert({
        tenant_id: profile!.default_tenant_id,
        reserve_id: membership!.reserve_id,
        armeiro_id: profile!.id,
        status: "ativo",
      })
      .select("id")
      .single();

  let { data: shift, error } = await tryInsert();
  if (error?.code === "23505") {
    // Conflito é por reserva: pode ser (a) outro worker abrindo o MESMO
    // armeiro — sucesso, nada a fazer — ou (b) turno órfão de OUTRO armeiro
    // ainda ocupando a reserva.
    const { data: blocker } = await sb
      .from("service_shifts")
      .select("id, armeiro_id")
      .eq("reserve_id", membership!.reserve_id)
      .eq("status", "ativo")
      .maybeSingle();

    if (!blocker || blocker.armeiro_id === profile!.id) return null; // caso (a)

    const { count: eventCount } = await sb
      .from("service_log_events")
      .select("id", { count: "exact", head: true })
      .eq("shift_id", blocker.id);

    if (eventCount && eventCount > 0) {
      throw new Error(
        `ensureActiveShift("${matricula}"): reserva tem turno ativo de outro armeiro (${blocker.armeiro_id}) ` +
        `com ${eventCount} evento(s) registrado(s) — não é seguro encerrar automaticamente. Investigar manualmente.`
      );
    }

    // Órfão sem nenhuma atividade — encerra e tenta de novo.
    await sb.from("service_shifts").update({ status: "encerrado", ended_at: new Date().toISOString() }).eq("id", blocker.id);
    ({ data: shift, error } = await tryInsert());
  }

  if (error) {
    throw new Error(`Falha ao abrir turno fixture: ${error.message}`);
  }
  return shift!.id;
}

/** Encerra o turno criado por ensureActiveShift — no-op se shiftId for null. */
export async function closeShiftIfOpened(shiftId: string | null): Promise<void> {
  if (!shiftId) return;
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await sb.from("service_shifts").update({ status: "encerrado", ended_at: new Date().toISOString() }).eq("id", shiftId);
}
