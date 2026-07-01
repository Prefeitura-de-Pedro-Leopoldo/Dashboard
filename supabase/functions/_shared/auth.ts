// Núcleo de autenticação compartilhado pelas Edge Functions.
// Puro (sem DB, sem HTTP) e idêntico ao lib/users.mjs da Vercel — a paridade
// é garantida por teste de vetor cruzado (hash gerado no Node, conferido no Deno).
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

// Reexporta os helpers HTTP (compat: handlers antigos importam daqui).
export { CORS_HEADERS, jsonResponse, preflight } from "./http.ts";

// Gera hash "scrypt$<salt>$<derivado>" — idêntico ao lib/users.mjs.
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const dk = scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt$${salt}$${dk}`;
}

// Regras da nova senha (idênticas ao lib/users.mjs). Pura e testável.
export function validatePasswordChange(
  { currentPassword, newPassword }: { currentPassword?: string; newPassword?: string },
): { ok: boolean; error?: string } {
  const pw = typeof newPassword === "string" ? newPassword : "";
  if (pw.length < 8) return { ok: false, error: "A nova senha deve ter pelo menos 8 caracteres." };
  if (!/[A-Z]/.test(pw)) return { ok: false, error: "A nova senha deve conter ao menos uma letra maiúscula." };
  if (!/[a-z]/.test(pw)) return { ok: false, error: "A nova senha deve conter ao menos uma letra minúscula." };
  if (!/[0-9]/.test(pw)) return { ok: false, error: "A nova senha deve conter ao menos um número." };
  if (!/[^A-Za-z0-9]/.test(pw)) return { ok: false, error: "A nova senha deve conter ao menos um caractere especial." };
  if (pw === currentPassword) return { ok: false, error: "A nova senha deve ser diferente da atual." };
  return { ok: true };
}

// Confere senha no formato "scrypt$<salt-hex>$<derivado-hex>".
export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored || typeof stored !== "string") return false;
  const [scheme, salt, dk] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !dk) return false;
  const calc = scryptSync(String(password), salt, 64);
  const want = Buffer.from(dk, "hex");
  return calc.length === want.length && timingSafeEqual(calc, want);
}
