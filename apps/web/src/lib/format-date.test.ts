import { describe, expect, it } from "vitest";
import { formatDate, formatTime, formatDateTime, APP_TIMEZONE } from "./format-date";

// 2026-07-09T02:30:00.000Z é 08/07 23:30 em America/Recife (UTC-3) —
// cruza a virada de dia, prova que o timezone está realmente sendo aplicado
// (se caísse em UTC, o dia mostrado seria 09, não 08).
const CROSS_MIDNIGHT_ISO = "2026-07-09T02:30:00.000Z";

describe("format-date — SSOT do timezone", () => {
  it("APP_TIMEZONE é America/Recife", () => {
    expect(APP_TIMEZONE).toBe("America/Recife");
  });

  it("formatDate aplica o timezone (dia anterior ao UTC na virada)", () => {
    expect(formatDate(CROSS_MIDNIGHT_ISO)).toBe("08/07/2026");
  });

  it("formatTime aplica o timezone", () => {
    expect(formatTime(CROSS_MIDNIGHT_ISO)).toBe("23:30");
  });

  it("formatDateTime aplica o timezone", () => {
    expect(formatDateTime(CROSS_MIDNIGHT_ISO)).toBe("08/07/2026, 23:30");
  });

  it("formatDate: opts não pode sobrescrever o timeZone fixo", () => {
    // Regressão do achado do code review: formatDate deve travar timeZone
    // por último, igual formatTime/formatDateTime — um opts com timeZone
    // diferente não pode reintroduzir o hydration mismatch.
    expect(formatDate(CROSS_MIDNIGHT_ISO, { timeZone: "UTC" })).toBe("08/07/2026");
  });

  it("formatTime: opts não pode sobrescrever o timeZone fixo", () => {
    expect(formatTime(CROSS_MIDNIGHT_ISO, { timeZone: "UTC" })).toBe("23:30");
  });

  it("formatDateTime: opts não pode sobrescrever o timeZone fixo", () => {
    expect(formatDateTime(CROSS_MIDNIGHT_ISO, { timeZone: "UTC" })).toBe("08/07/2026, 23:30");
  });

  it("null/undefined retornam travessão nas 3 funções", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatTime(null)).toBe("—");
    expect(formatDateTime(null)).toBe("—");
  });

  it("determinístico independente do TZ do processo (anti-regressão de hidratação)", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "UTC";
      const asUtc = formatDateTime(CROSS_MIDNIGHT_ISO);
      process.env.TZ = "America/Recife";
      const asRecife = formatDateTime(CROSS_MIDNIGHT_ISO);
      expect(asUtc).toBe(asRecife);
    } finally {
      process.env.TZ = original;
    }
  });
});
