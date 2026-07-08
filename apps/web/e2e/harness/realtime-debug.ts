/**
 * Realtime Debug Harness
 *
 * Helpers para testes E2E que verificam atualizações em tempo real via Supabase Realtime.
 *
 * Padrão de uso:
 *   1. attachRealtimeMonitor(page, tables) — ANTES da navegação
 *   2. waitForRTReady(page)              — após navegar, antes do trigger
 *   3. rt.reset()                        — imediatamente antes do trigger
 *   4. trigger()
 *   5. expect(locator).toBeVisible(...)  — no catch, rt.report() para diagnóstico estruturado
 *
 * Por que esse harness existe:
 *   O Supabase Realtime confirma o canal (SUBSCRIBED) ANTES de validar os postgres_changes
 *   individuais. Sem monitoramento estruturado de WS é impossível distinguir entre:
 *   (a) evento que nunca chegou, (b) evento chegou mas DOM não atualizou,
 *   (c) subscription foi rejeitada pelo servidor com "system" error.
 */

import type { Page } from "@playwright/test";

export interface RealtimeMonitor {
  /** Frames WS (RECV) das tabelas monitoradas — confirmam entrega do evento CDC */
  wsEvents: string[];
  /** Todos os frames WS pós-reset — para verificar se o WS está vivo */
  allFrames: string[];
  /** Frames com "system" error do servidor — indicam subscription rejeitada */
  systemErrors: string[];
  /** True se uma RSC request (/_rsc=) foi feita pós-reset — confirma router.refresh() */
  rscFired: boolean;
  /** Body da RSC response pós-reset — confirma que o servidor retornou dados atualizados */
  rscBody: string;
  /** Zera todos os contadores — chamar imediatamente ANTES do trigger de DB */
  reset(): void;
  /** Relatório estruturado para ser lançado no catch da asserção Playwright */
  report(): string;
}

/**
 * Registra listeners de WS e RSC na page ANTES da navegação.
 *
 * @param page  - Playwright page
 * @param tables - Nomes de tabelas a monitorar em frames WS (ex: ["material_requests"])
 */
export function attachRealtimeMonitor(page: Page, tables: string[]): RealtimeMonitor {
  const monitor: RealtimeMonitor = {
    wsEvents: [],
    allFrames: [],
    systemErrors: [],
    rscFired: false,
    rscBody: "",

    reset() {
      this.wsEvents = [];
      this.allFrames = [];
      this.systemErrors = [];
      this.rscFired = false;
      this.rscBody = "";
    },

    report() {
      const lines = [
        `--- Realtime Monitor Report ---`,
        `rscFired       : ${this.rscFired}`,
        `wsEvents       : ${this.wsEvents.length} (frames das tabelas monitoradas)`,
        `systemErrors   : ${this.systemErrors.length} (subscriptions rejeitadas pelo servidor)`,
        `allFrames      : ${this.allFrames.length} (total WS pós-reset)`,
      ];
      if (this.systemErrors.length > 0) {
        lines.push(`\nSYSTEM ERRORS (subscription rejeitada):`);
        this.systemErrors.forEach((e) => lines.push(`  ${e.slice(0, 200)}`));
      }
      if (this.wsEvents.length > 0) {
        lines.push(`\nWS EVENTS (CDC das tabelas monitoradas):`);
        this.wsEvents.slice(0, 5).forEach((e) => lines.push(`  ${e.slice(0, 200)}`));
      }
      if (this.allFrames.length > 0 && this.wsEvents.length === 0) {
        lines.push(`\nWS FRAMES (pós-reset, sem match nas tabelas):`);
        this.allFrames.slice(0, 5).forEach((f) => lines.push(`  ${f.slice(0, 120)}`));
      }
      if (this.rscBody) {
        lines.push(`\nRSC BODY (primeiros 300 chars):\n  ${this.rscBody.slice(0, 300)}`);
      }
      lines.push(`--- Fim do Report ---`);
      return lines.join("\n");
    },
  };

  page.on("request", (req) => {
    if (!monitor.rscFired && req.url().includes("_rsc=")) {
      monitor.rscFired = true;
    }
  });

  page.on("response", async (res) => {
    if (monitor.rscFired && res.url().includes("_rsc=") && !monitor.rscBody) {
      try {
        monitor.rscBody = (await res.text()).slice(0, 400);
      } catch {
        // response já consumida ou erro de rede — silencioso
      }
    }
  });

  page.on("websocket", (ws) => {
    ws.on("framereceived", (frame) => {
      const data = frame.payload.toString().slice(0, 400);
      monitor.allFrames.push(`R:${data.slice(0, 120)}`);

      if (tables.some((t) => data.includes(t))) {
        monitor.wsEvents.push(`R:${data}`);
      }
      if (data.includes('"system"') && data.includes("Unable")) {
        monitor.systemErrors.push(data);
      }
    });

    ws.on("framesent", (frame) => {
      const data = frame.payload.toString().slice(0, 400);
      monitor.allFrames.push(`S:${data.slice(0, 120)}`);
      if (data.includes("postgres_changes")) {
        monitor.wsEvents.push(`S:${data}`);
      }
    });
  });

  return monitor;
}

/**
 * Aguarda window.__rtReady ser setado (sinal do useRealtimeRefresh após SUBSCRIBED).
 *
 * Lança erro descritivo se o timeout expirar — indica que o componente Realtime
 * não montou na página ou a subscription falhou antes de SUBSCRIBED.
 *
 * @param page    - Playwright page
 * @param timeout - Timeout em ms (default: 30s — inclui getSession() + WS handshake)
 * @param label   - Label para identificar o contexto no erro (ex: "efetivo-sync")
 */
export async function waitForRTReady(
  page: Page,
  timeout = 30_000,
  label = ""
): Promise<void> {
  await page
    .waitForFunction(
      () => !!(window as unknown as { __rtReady?: boolean }).__rtReady,
      undefined,
      { timeout }
    )
    .catch(() => {
      throw new Error(
        `[Realtime] __rtReady não setado após ${timeout}ms` +
          (label ? ` [${label}]` : "") +
          ". Verifique: (1) componente Realtime montado na rota, " +
          "(2) getSession() resolve antes do subscribe, " +
          "(3) canal recebe status SUBSCRIBED do servidor."
      );
    });
}
