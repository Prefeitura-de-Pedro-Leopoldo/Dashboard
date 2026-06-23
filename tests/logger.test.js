import { describe, it, expect, vi, afterEach } from "vitest";
import { createLogger } from "../lib/logger.mjs";

afterEach(() => {
  vi.restoreAllMocks();
});

function capture(level) {
  return vi.spyOn(console, level).mockImplementation(() => {});
}

describe("createLogger", () => {
  it("emite uma linha JSON com nível, serviço e mensagem", () => {
    const spy = capture("error");
    createLogger("login").error("erro inesperado");
    expect(spy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(spy.mock.calls[0][0]);
    expect(entry.level).toBe("error");
    expect(entry.service).toBe("login");
    expect(entry.message).toBe("erro inesperado");
    expect(typeof entry.ts).toBe("string");
  });

  it("roteia info->log, warn->warn, error->error", () => {
    const log = capture("log");
    const warn = capture("warn");
    const error = capture("error");
    const l = createLogger("svc");
    l.info("a");
    l.warn("b");
    l.error("c");
    expect(log).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("redige valores de chaves sensíveis pelo nome", () => {
    const spy = capture("warn");
    createLogger("svc").warn("config", { token: "abc123", password: "x", folder: "turma 1" });
    const entry = JSON.parse(spy.mock.calls[0][0]);
    expect(entry.context.token).toBe("[REDACTED]");
    expect(entry.context.password).toBe("[REDACTED]");
    expect(entry.context.folder).toBe("turma 1");
  });

  it("não lança com contexto circular (cai para o essencial)", () => {
    const spy = capture("error");
    const circular = {};
    circular.self = circular;
    expect(() => createLogger("svc").error("boom", circular)).not.toThrow();
    const entry = JSON.parse(spy.mock.calls[0][0]);
    expect(entry.message).toBe("boom");
    expect(entry.service).toBe("svc");
  });
});
