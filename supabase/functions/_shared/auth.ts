// Núcleo de autenticação compartilhado pelas Edge Functions.
// Puro (sem DB, sem HTTP) e idêntico ao lib/users.mjs da Vercel — a paridade
// é garantida por teste de vetor cruzado (hash gerado no Node, conferido no Deno).
import { scryptSync, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

// Reexporta os helpers HTTP (compat: handlers antigos importam daqui).
export { CORS_HEADERS, jsonResponse, preflight } from "./http.ts";

// Confere senha no formato "scrypt$<salt-hex>$<derivado-hex>".
export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored || typeof stored !== "string") return false;
  const [scheme, salt, dk] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !dk) return false;
  const calc = scryptSync(String(password), salt, 64);
  const want = Buffer.from(dk, "hex");
  return calc.length === want.length && timingSafeEqual(calc, want);
}
