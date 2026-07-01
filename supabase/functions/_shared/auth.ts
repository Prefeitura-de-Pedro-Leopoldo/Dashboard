// Núcleo de autenticação compartilhado pelas Edge Functions.
// Puro (sem DB, sem HTTP) e idêntico ao lib/users.mjs da Vercel — a paridade
// é garantida por teste de vetor cruzado (hash gerado no Node, conferido no Deno).
import { scryptSync, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

// Confere senha no formato "scrypt$<salt-hex>$<derivado-hex>".
export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored || typeof stored !== "string") return false;
  const [scheme, salt, dk] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !dk) return false;
  const calc = scryptSync(String(password), salt, 64);
  const want = Buffer.from(dk, "hex");
  return calc.length === want.length && timingSafeEqual(calc, want);
}

// Cabeçalhos CORS padrão das Edge Functions.
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
