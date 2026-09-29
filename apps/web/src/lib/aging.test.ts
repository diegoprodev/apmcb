import { describe, expect, it } from "vitest";
import { agingLevel, cutoffISOForHours, AGING_ALERT_HOURS, agingAlertCutoffISO } from "./aging";

const HOUR = 3_600_000;

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * HOUR).toISOString();
}

describe("agingLevel", () => {
  it("isOpen=false => null, mesmo se issuedAt é muito antigo (devolvida não alerta)", () => {
    expect(agingLevel(isoHoursAgo(200), false)).toBeNull();
  });

  it("aberta há menos de 24h => null", () => {
    expect(agingLevel(isoHoursAgo(23.9), true)).toBeNull();
  });

  it("aberta há exatamente 24h => '24h'", () => {
    expect(agingLevel(isoHoursAgo(24), true)).toBe("24h");
  });

  it("aberta há 30h (entre 24 e 48) => '24h'", () => {
    expect(agingLevel(isoHoursAgo(30), true)).toBe("24h");
  });

  it("aberta há exatamente 48h => '48h'", () => {
    expect(agingLevel(isoHoursAgo(48), true)).toBe("48h");
  });

  it("aberta há exatamente 72h => '72h', cumulativo (não 'some' do alerta ao envelhecer mais)", () => {
    expect(agingLevel(isoHoursAgo(72), true)).toBe("72h");
  });

  it("aberta há 200h (muito além de 72h) => ainda '72h', não null nem nível inexistente", () => {
    expect(agingLevel(isoHoursAgo(200), true)).toBe("72h");
  });
});

describe("cutoffISOForHours", () => {
  it("retorna um ISO ~N horas no passado", () => {
    const iso = cutoffISOForHours(24);
    const diffHours = (Date.now() - new Date(iso).getTime()) / HOUR;
    expect(diffHours).toBeGreaterThanOrEqual(23.99);
    expect(diffHours).toBeLessThanOrEqual(24.01);
  });
});

describe("agingAlertCutoffISO", () => {
  it("usa o mesmo corte de AGING_ALERT_HOURS (24h)", () => {
    expect(AGING_ALERT_HOURS).toBe(24);
    const diffHours = (Date.now() - new Date(agingAlertCutoffISO()).getTime()) / HOUR;
    expect(diffHours).toBeGreaterThanOrEqual(23.99);
    expect(diffHours).toBeLessThanOrEqual(24.01);
  });
});
