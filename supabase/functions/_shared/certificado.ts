// Assinatura/verificação de certificados (HMAC-SHA256) — PORT idêntico do
// api/certificado.js. O segredo entra por parâmetro (testável). A saída é
// byte-idêntica à do Node (garantido por teste de paridade).
import { createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

const SIG_LEN = 24;

export interface Cert { nome: string; curso: string; carga: string; data: string; }

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf as Uint8Array | string).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Buffer {
  let t = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return Buffer.from(t, "base64");
}
function sign(payloadB64: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(payloadB64).digest()).slice(0, SIG_LEN);
}

export function makeCode(cert: Cert, secret: string): string {
  const payload = { n: cert.nome, c: cert.curso, h: cert.carga, d: cert.data };
  const pB64 = b64url(JSON.stringify(payload));
  return `${pB64}.${sign(pB64, secret)}`;
}

export function verifyCode(code: string, secret: string): { valido: boolean; cert?: Cert } {
  if (!code || typeof code !== "string" || code.indexOf(".") < 0) return { valido: false };
  const dot = code.lastIndexOf(".");
  const pB64 = code.slice(0, dot);
  const sig = code.slice(dot + 1);
  if (!pB64 || !sig) return { valido: false };
  const expected = sign(pB64, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { valido: false };
  let payload: { n?: string; c?: string; h?: string; d?: string };
  try { payload = JSON.parse(b64urlDecode(pB64).toString("utf-8")); } catch (_) { return { valido: false }; }
  return { valido: true, cert: { nome: payload.n || "", curso: payload.c || "", carga: payload.h || "", data: payload.d || "" } };
}
