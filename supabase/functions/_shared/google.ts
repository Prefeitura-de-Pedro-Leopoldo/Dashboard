// Validação das claims de um ID token do Google — PORT idêntico do
// api/auth/google.js da Vercel (mesma tabela auth-google.test.js valida a lógica).
// Pura (sem rede): a busca do token no Google fica no handler (injetável).

const VALID_ISS = new Set(["accounts.google.com", "https://accounts.google.com"]);

export interface GoogleClaims {
  aud?: string;
  iss?: string;
  exp?: string | number;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  [k: string]: unknown;
}

export function validateGoogleClaims(
  claims: GoogleClaims | null | undefined,
  { clientId, now = Date.now() }: { clientId?: string; now?: number } = {},
): { ok: boolean; error?: string; email?: string; name?: string } {
  if (!claims || typeof claims !== "object") return { ok: false, error: "Token inválido." };
  if (!clientId || claims.aud !== clientId) return { ok: false, error: "Token não destinado a esta aplicação." };
  if (!VALID_ISS.has(String(claims.iss))) return { ok: false, error: "Emissor do token inválido." };
  const expMs = Number(claims.exp) * 1000;
  if (!expMs || expMs < now) return { ok: false, error: "Token expirado." };
  const emailVerified = claims.email_verified === true || claims.email_verified === "true";
  const email = String(claims.email || "").trim().toLowerCase();
  if (!email || !emailVerified) return { ok: false, error: "E-mail do Google não verificado." };
  return { ok: true, email, name: claims.name || email.split("@")[0] };
}
