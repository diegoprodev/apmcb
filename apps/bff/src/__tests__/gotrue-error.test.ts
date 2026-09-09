import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyGotrueError } from "../lib/gotrue-error.ts";

describe("classifyGotrueError", () => {
  it("e-mail já registrado por error_code=email_exists → isDuplicate", () => {
    const r = classifyGotrueError(
      JSON.stringify({ code: 422, error_code: "email_exists", msg: "A user with this email address has already been registered" }),
    );
    assert.equal(r.isDuplicate, true);
    assert.equal(r.code, "email_exists");
    assert.match(r.detail, /already been registered/);
  });

  it("e-mail já registrado só pela mensagem (sem error_code) → isDuplicate", () => {
    const r = classifyGotrueError(JSON.stringify({ msg: "A user with this email address has already been registered" }));
    assert.equal(r.isDuplicate, true);
  });

  it("casa 'already registered' e 'already been registered'", () => {
    assert.equal(classifyGotrueError(JSON.stringify({ msg: "email already registered" })).isDuplicate, true);
    assert.equal(classifyGotrueError(JSON.stringify({ msg: "already been registered" })).isDuplicate, true);
  });

  it("erro 422 que NÃO é duplicata (ex.: formato inválido) → não isDuplicate", () => {
    const r = classifyGotrueError(JSON.stringify({ code: 422, error_code: "validation_failed", msg: "Unable to validate email address: invalid format" }));
    assert.equal(r.isDuplicate, false);
    assert.equal(r.code, "validation_failed");
  });

  it("corpo não-JSON → detail = texto cru, não isDuplicate", () => {
    const r = classifyGotrueError("<html>502 Bad Gateway</html>");
    assert.equal(r.isDuplicate, false);
    assert.equal(r.detail, "<html>502 Bad Gateway</html>");
    assert.equal(r.code, undefined);
  });

  it("corpo vazio → detail vazio, não lança", () => {
    const r = classifyGotrueError("");
    assert.equal(r.detail, "");
    assert.equal(r.isDuplicate, false);
  });

  it("formato antigo {message} ainda é lido", () => {
    assert.equal(classifyGotrueError(JSON.stringify({ message: "boom" })).detail, "boom");
  });

  it("detail é capado em 200 chars", () => {
    const long = "x".repeat(500);
    assert.equal(classifyGotrueError(JSON.stringify({ msg: long })).detail.length, 200);
  });

  it("user_already_exists também conta como duplicata", () => {
    assert.equal(classifyGotrueError(JSON.stringify({ error_code: "user_already_exists", msg: "..." })).isDuplicate, true);
  });
});
