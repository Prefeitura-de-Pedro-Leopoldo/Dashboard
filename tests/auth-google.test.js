import { describe, it, expect } from "vitest";
import { validateGoogleClaims } from "../api/auth/google.js";

const CLIENT_ID = "client-123.apps.googleusercontent.com";
const future = () => Math.floor((Date.now() + 60_000) / 1000);

function baseClaims(over = {}) {
  return {
    aud: CLIENT_ID,
    iss: "https://accounts.google.com",
    exp: future(),
    email: "user@pedroleopoldo.mg.gov.br",
    email_verified: true,
    name: "Fulano",
    ...over,
  };
}

describe("validateGoogleClaims", () => {
  it("aceita token válido e normaliza o e-mail", () => {
    const r = validateGoogleClaims(baseClaims({ email: "User@Pedroleopoldo.MG.GOV.BR" }), { clientId: CLIENT_ID });
    expect(r.ok).toBe(true);
    expect(r.email).toBe("user@pedroleopoldo.mg.gov.br");
    expect(r.name).toBe("Fulano");
  });

  it("aceita email_verified como string 'true'", () => {
    expect(validateGoogleClaims(baseClaims({ email_verified: "true" }), { clientId: CLIENT_ID }).ok).toBe(true);
  });

  it("rejeita audiência diferente do client id", () => {
    const r = validateGoogleClaims(baseClaims({ aud: "outro" }), { clientId: CLIENT_ID });
    expect(r.ok).toBe(false);
  });

  it("rejeita emissor inválido", () => {
    expect(validateGoogleClaims(baseClaims({ iss: "evil.com" }), { clientId: CLIENT_ID }).ok).toBe(false);
  });

  it("rejeita token expirado", () => {
    const r = validateGoogleClaims(baseClaims({ exp: Math.floor(Date.now() / 1000) - 10 }), { clientId: CLIENT_ID });
    expect(r.ok).toBe(false);
  });

  it("rejeita e-mail não verificado", () => {
    expect(validateGoogleClaims(baseClaims({ email_verified: false }), { clientId: CLIENT_ID }).ok).toBe(false);
  });

  it("rejeita claims ausentes ou clientId ausente", () => {
    expect(validateGoogleClaims(null, { clientId: CLIENT_ID }).ok).toBe(false);
    expect(validateGoogleClaims(baseClaims(), { clientId: "" }).ok).toBe(false);
  });
});
