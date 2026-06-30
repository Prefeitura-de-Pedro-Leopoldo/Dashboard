import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, parseEnvUsers } from "../lib/users.mjs";

describe("hashPassword / verifyPassword (scrypt)", () => {
  it("gera hash no formato scrypt$salt$dk e valida a senha correta", () => {
    const h = hashPassword("segredo-123");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("segredo-123", h)).toBe(true);
  });

  it("rejeita senha errada", () => {
    const h = hashPassword("segredo-123");
    expect(verifyPassword("outra", h)).toBe(false);
  });

  it("rejeita hash malformado ou ausente", () => {
    expect(verifyPassword("x", "")).toBe(false);
    expect(verifyPassword("x", "naoehscrypt")).toBe(false);
    expect(verifyPassword("x", null)).toBe(false);
  });
});

describe("parseEnvUsers", () => {
  it("lê AUTH_USER_* no formato 'email|senha|Nome' e deduplica", () => {
    const prev = { ...process.env };
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("AUTH_USER") || k === "AUTH_USERS") delete process.env[k];
    }
    process.env.AUTH_USER_TESTE = "Pessoa@Exemplo.com|s3nha|Pessoa Exemplo";
    process.env.AUTH_USER_DUP = "pessoa@exemplo.com|outra|Dup";
    try {
      const users = parseEnvUsers();
      const found = users.filter((u) => u.email === "pessoa@exemplo.com");
      // E-mail aparado/minúsculo e deduplicado (uma só entrada).
      expect(found).toHaveLength(1);
      expect(["Pessoa Exemplo", "Dup"]).toContain(found[0].name);
    } finally {
      process.env = prev;
    }
  });
});
