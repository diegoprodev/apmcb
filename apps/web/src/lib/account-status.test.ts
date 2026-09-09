import { describe, expect, it } from "vitest";
import { classifyAccountStatus, type AccountStatusInput } from "./account-status";

const HOUR = 3600 * 1000;

function make(over: Partial<AccountStatusInput>): AccountStatusInput {
  return {
    registration_status: "pending_biometric",
    totp_configured: false,
    invite_sent_at: null,
    account_activated_at: null,
    ...over,
  };
}

describe("classifyAccountStatus", () => {
  it("recém-cadastrado (pending_biometric, sem invite, sem login) => 'Sem acesso'", () => {
    const r = classifyAccountStatus(make({ registration_status: "pending_biometric" }));
    expect(r.noInvite).toBe(true);
    expect(r.accountActive).toBe(false);
    expect(r.inviteSent).toBe(false);
    expect(r.inviteExpired).toBe(false);
    expect(r.allComplete).toBe(false);
  });

  it("convite enviado há 2 min => 'Convite enviado', não expirado", () => {
    const r = classifyAccountStatus(make({
      invite_sent_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    }));
    expect(r.inviteSent).toBe(true);
    expect(r.inviteExpired).toBe(false);
    expect(r.noInvite).toBe(false);
    expect(r.accountActive).toBe(false);
  });

  it("convite enviado há 48h sem ativar => 'Expirado' (ainda marca inviteSent — consumidores usam inviteSent && !inviteExpired)", () => {
    const r = classifyAccountStatus(make({
      invite_sent_at: new Date(Date.now() - 48 * HOUR).toISOString(),
    }));
    expect(r.inviteExpired).toBe(true);
    expect(r.inviteSent).toBe(true);
    expect(r.noInvite).toBe(false);
  });

  it("limite dos 24h: 23h59 ainda não expirou; 24h01 expirou", () => {
    const naoExpirou = classifyAccountStatus(make({
      invite_sent_at: new Date(Date.now() - (24 * HOUR - 60_000)).toISOString(),
    }));
    expect(naoExpirou.inviteExpired).toBe(false);
    const expirou = classifyAccountStatus(make({
      invite_sent_at: new Date(Date.now() - (24 * HOUR + 60_000)).toISOString(),
    }));
    expect(expirou.inviteExpired).toBe(true);
  });

  it("account_activated_at preenchido (login registrado) => acesso ativo, convite irrelevante", () => {
    const r = classifyAccountStatus(make({
      invite_sent_at: new Date(Date.now() - 48 * HOUR).toISOString(),
      account_activated_at: new Date().toISOString(),
    }));
    expect(r.accountActive).toBe(true);
    expect(r.inviteExpired).toBe(false);
    expect(r.inviteSent).toBe(false);
    expect(r.noInvite).toBe(false);
  });

  it("profile tipo 000003 APÓS o backfill (complete + TOTP + account_activated_at) => 'Completo', nunca 'Sem acesso'", () => {
    const r = classifyAccountStatus(make({
      registration_status: "complete",
      totp_configured: true,
      account_activated_at: "2026-09-09T12:00:00Z",
    }));
    expect(r.accountActive).toBe(true);
    expect(r.noInvite).toBe(false);
    expect(r.allComplete).toBe(true);
  });

  it("REGRESSÃO: 'complete' SEM account_activated_at (enrollment biométrico presencial, militar nunca logou) continua 'Sem acesso' — não inferir login de registration_status", () => {
    const r = classifyAccountStatus(make({ registration_status: "complete", totp_configured: true }));
    expect(r.accountActive).toBe(false);
    expect(r.noInvite).toBe(true);
    expect(r.allComplete).toBe(false);
  });

  it("inactive nunca conta como allComplete, mesmo com todos os campos preenchidos", () => {
    const r = classifyAccountStatus(make({
      registration_status: "inactive",
      totp_configured: true,
      account_activated_at: new Date().toISOString(),
    }));
    expect(r.allComplete).toBe(false);
  });

  it("bioPending e totpPending derivam de registration_status e totp_configured", () => {
    const r = classifyAccountStatus(make({ registration_status: "pending_biometric", totp_configured: false }));
    expect(r.bioPending).toBe(true);
    expect(r.totpPending).toBe(true);
    const r2 = classifyAccountStatus(make({ registration_status: "complete", totp_configured: true }));
    expect(r2.bioPending).toBe(false);
    expect(r2.totpPending).toBe(false);
  });
});
