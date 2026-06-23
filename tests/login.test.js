import { describe, it, expect } from "vitest";
import { normalizeUser, parseSingleEntry, safeEqual } from "../api/login.js";

describe("normalizeUser", () => {
  it("normaliza email (trim + lowercase) e deriva nome do email", () => {
    // Comportamento ATUAL travado: o email é aparado/minúsculo, mas o nome
    // derivado vem do email ORIGINAL (sem trim), então mantém o espaço à
    // esquerda (" A"). É uma peculiaridade existente, documentada aqui.
    expect(normalizeUser({ email: " A@B.com ", password: "x" })).toEqual({
      email: "a@b.com",
      password: "x",
      name: " A",
    });
  });

  it("mantém o nome quando fornecido", () => {
    expect(normalizeUser({ email: "a@b.com", password: "x", name: "Ana" }).name).toBe("Ana");
  });

  it("rejeita entradas sem email/senha string", () => {
    expect(normalizeUser(null)).toBeNull();
    expect(normalizeUser({ email: "a@b.com" })).toBeNull();
    expect(normalizeUser({ password: "x" })).toBeNull();
  });
});

describe("parseSingleEntry", () => {
  it("formato 'email|senha|Nome'", () => {
    expect(parseSingleEntry("a@b.com|secret|Maria")).toEqual({
      email: "a@b.com",
      password: "secret",
      name: "Maria",
    });
  });

  it("formato JSON", () => {
    expect(parseSingleEntry('{"email":"x@y.com","password":"p","name":"N"}')).toEqual({
      email: "x@y.com",
      password: "p",
      name: "N",
    });
  });

  it("retorna null quando faltam campos", () => {
    expect(parseSingleEntry("apenasemail")).toBeNull();
  });
});

describe("safeEqual (comparação em tempo constante)", () => {
  it("true para strings iguais", () => {
    expect(safeEqual("abc123", "abc123")).toBe(true);
  });

  it("false para conteúdo ou comprimento diferentes", () => {
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("false para tipos não-string", () => {
    expect(safeEqual(123, "123")).toBe(false);
    expect(safeEqual(null, null)).toBe(false);
  });
});
