import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, parseEnvUsers, validatePasswordChange } from "../lib/users.mjs";

describe("validatePasswordChange", () => {
  it("aceita senha forte (8+, maiúscula, minúscula, número e especial)", () => {
    expect(validatePasswordChange({ currentPassword: "egov2026", newPassword: "NovaSenha1!" }).ok).toBe(true);
  });
  it("rejeita senha curta (< 8)", () => {
    expect(validatePasswordChange({ currentPassword: "egov2026", newPassword: "Aa1!" }).ok).toBe(false);
  });
  it("rejeita sem maiúscula", () => {
    expect(validatePasswordChange({ currentPassword: "egov2026", newPassword: "novasenha1!" }).ok).toBe(false);
  });
  it("rejeita sem minúscula", () => {
    expect(validatePasswordChange({ currentPassword: "egov2026", newPassword: "NOVASENHA1!" }).ok).toBe(false);
  });
  it("rejeita sem número", () => {
    expect(validatePasswordChange({ currentPassword: "egov2026", newPassword: "NovaSenha!" }).ok).toBe(false);
  });
  it("rejeita sem caractere especial", () => {
    expect(validatePasswordChange({ currentPassword: "egov2026", newPassword: "NovaSenha1" }).ok).toBe(false);
  });
  it("rejeita senha igual à atual", () => {
    expect(validatePasswordChange({ currentPassword: "NovaSenha1!", newPassword: "NovaSenha1!" }).ok).toBe(false);
  });
});

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
