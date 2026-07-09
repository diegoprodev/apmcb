import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import pino from "pino";
import { loggerOptions, maskMatricula, maskNome } from "../lib/logger.ts";

/** Constrói um logger com as mesmas opções de produção, gravando em memória. */
function makeTestLogger(): { logger: pino.Logger; lastLine: () => Record<string, unknown> } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) { lines.push(chunk.toString()); cb(); },
  });
  const logger = pino(loggerOptions, stream);
  return { logger, lastLine: () => JSON.parse(lines[lines.length - 1]) };
}

describe("logger — redaction", () => {
  it("redige campo 'token' em 1º nível", () => {
    const { logger, lastLine } = makeTestLogger();
    logger.info({ token: "abc123" }, "test");
    assert.equal(lastLine().token, "[REDACTED]");
  });

  it("redige campo 'secret' aninhado em 2º nível (*.secret)", () => {
    const { logger, lastLine } = makeTestLogger();
    logger.info({ data: { secret: "shh" } }, "test");
    assert.equal((lastLine().data as Record<string, unknown>).secret, "[REDACTED]");
  });

  it("redige 'password' e não afeta campos irmãos", () => {
    const { logger, lastLine } = makeTestLogger();
    logger.info({ password: "hunter2", userId: "u1" }, "test");
    const line = lastLine();
    assert.equal(line.password, "[REDACTED]");
    assert.equal(line.userId, "u1");
  });

  it("redige headers de autorização/cookie", () => {
    const { logger, lastLine } = makeTestLogger();
    logger.info({ req: { headers: { authorization: "Bearer xyz", cookie: "sb=1" } } }, "test");
    const headers = (lastLine().req as Record<string, unknown>).headers as Record<string, unknown>;
    assert.equal(headers.authorization, "[REDACTED]");
    assert.equal(headers.cookie, "[REDACTED]");
  });
});

describe("logger — formato e níveis", () => {
  it("linha tem level, msg, service, time", () => {
    const { logger, lastLine } = makeTestLogger();
    logger.info({ foo: "bar" }, "evento.teste");
    const line = lastLine();
    assert.equal(line.level, "info");
    assert.equal(line.msg, "evento.teste");
    assert.equal(line.service, "apmcb-bff");
    assert.ok(line.time);
    assert.equal(line.foo, "bar");
  });

  it("logger.error grava level error", () => {
    const { logger, lastLine } = makeTestLogger();
    logger.error("falha.teste");
    assert.equal(lastLine().level, "error");
  });

  it("logger.warn grava level warn", () => {
    const { logger, lastLine } = makeTestLogger();
    logger.warn("aviso.teste");
    assert.equal(lastLine().level, "warn");
  });
});

describe("maskMatricula", () => {
  it("mantém os 2 últimos dígitos, mascara o resto", () => {
    assert.equal(maskMatricula("1234567"), "*****67");
  });

  it("string vazia/nula retorna vazio", () => {
    assert.equal(maskMatricula(null), "");
    assert.equal(maskMatricula(undefined), "");
    assert.equal(maskMatricula(""), "");
  });

  it("string com 2 ou menos caracteres vira só asteriscos", () => {
    assert.equal(maskMatricula("12"), "**");
  });
});

describe("maskNome", () => {
  it("nome completo vira 'Primeiro U.'", () => {
    assert.equal(maskNome("João da Silva Sauro"), "João S.");
  });

  it("nome de uma palavra retorna sem alteração", () => {
    assert.equal(maskNome("Madonna"), "Madonna");
  });

  it("string vazia/nula retorna vazio", () => {
    assert.equal(maskNome(null), "");
    assert.equal(maskNome(undefined), "");
  });
});
