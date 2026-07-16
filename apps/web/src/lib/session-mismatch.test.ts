import { describe, expect, it } from "vitest";
import { decideSessionMismatch } from "./session-mismatch";

const BFF_ID = "0f74d62a-4c48-40b2-8f4d-81b69d0eaddb";
const OTHER_ID = "5d2e20d6-a3a5-4d94-bb2f-e230cb521431";

describe("decideSessionMismatch", () => {
  it("recheck concorda com o BFF → confirmed-ok (corrida transitória)", () => {
    const decision = decideSessionMismatch(BFF_ID, BFF_ID);
    expect(decision).toEqual({ kind: "confirmed-ok", confirmedUserId: BFF_ID });
  });

  it("recheck diverge de novo do BFF → redirect persistent (vazamento real)", () => {
    const decision = decideSessionMismatch(BFF_ID, OTHER_ID);
    expect(decision).toEqual({ kind: "redirect", reason: "persistent" });
  });

  it("recheck falha (null — timeout/erro do Supabase) → redirect inconclusive, nunca 'ok'", () => {
    const decision = decideSessionMismatch(BFF_ID, null);
    expect(decision).toEqual({ kind: "redirect", reason: "inconclusive" });
  });

  it("recheck sem usuário (undefined — getUser() sem sessão) → redirect inconclusive, nunca 'ok'", () => {
    const decision = decideSessionMismatch(BFF_ID, undefined);
    expect(decision).toEqual({ kind: "redirect", reason: "inconclusive" });
  });
});
