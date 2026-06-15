/**
 * /api/certificado: assinatura e verificação de certificados.
 *
 * O objetivo é permitir VALIDAÇÃO PÚBLICA de autenticidade sem banco de dados:
 * o código do certificado carrega os próprios dados (nome, curso, carga, data)
 * + uma assinatura HMAC-SHA256. Quem não tem o segredo (CERT_SECRET) não
 * consegue forjar um código válido.
 *
 *   POST  body { certs: [{ nome, curso, carga, data }] }
 *         -> { ok:true, items: [{ codigo }] }   (1 por cert, na mesma ordem)
 *
 *   GET   ?codigo=<token>   (alias: ?c=<token>)
 *         -> { ok:true, valido:true,  cert:{ nome, curso, carga, data } }
 *         -> { ok:true, valido:false }           (assinatura inválida/adulterada)
 *
 * Env var (Vercel): CERT_SECRET, segredo HMAC. SEM ele a assinatura usa um
 * fallback de desenvolvimento (NÃO seguro em produção): defina CERT_SECRET.
 */

import crypto from "node:crypto";

const SECRET = process.env.CERT_SECRET || "egov-pl-cert-dev-secret-DEFINA-CERT_SECRET";
const SIG_LEN = 24; // tamanho do trecho de assinatura no código (base64url)

function b64url(buf) {
  return Buffer.from(buf).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s) {
  let t = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return Buffer.from(t, "base64");
}
function sign(payloadB64) {
  return b64url(crypto.createHmac("sha256", SECRET).update(payloadB64).digest()).slice(0, SIG_LEN);
}

// Gera o código assinado a partir dos campos do certificado.
function makeCode(cert) {
  const payload = { n: cert.nome, c: cert.curso, h: cert.carga, d: cert.data };
  const pB64 = b64url(JSON.stringify(payload));
  return `${pB64}.${sign(pB64)}`;
}

// Verifica um código. Retorna { valido, cert? }.
function verifyCode(code) {
  if (!code || typeof code !== "string" || code.indexOf(".") < 0) return { valido: false };
  const dot = code.lastIndexOf(".");
  const pB64 = code.slice(0, dot);
  const sig = code.slice(dot + 1);
  if (!pB64 || !sig) return { valido: false };
  const expected = sign(pB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { valido: false };
  let payload;
  try { payload = JSON.parse(b64urlDecode(pB64).toString("utf-8")); }
  catch (_) { return { valido: false }; }
  return {
    valido: true,
    cert: {
      nome: payload.n || "",
      curso: payload.c || "",
      carga: payload.h || "",
      data: payload.d || "",
    },
  };
}

export default async function handler(req, res) {
  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = {}; } }
    const certs = Array.isArray(body && body.certs) ? body.certs : [];
    if (!certs.length) return res.status(400).json({ ok: false, error: 'Lista "certs" vazia.' });
    if (certs.length > 5000) return res.status(413).json({ ok: false, error: "Lote acima do limite (5000)." });
    const items = certs.map((c) => ({
      codigo: makeCode({
        nome: String((c && c.nome) || "").trim(),
        curso: String((c && c.curso) || "").trim(),
        carga: String((c && c.carga) || "").trim(),
        data: String((c && c.data) || "").trim(),
      }),
    }));
    return res.status(200).json({ ok: true, items });
  }

  if (req.method === "GET") {
    const q = req.query || {};
    const codigo = String(q.codigo || q.c || "").trim();
    if (!codigo) return res.status(400).json({ ok: false, error: 'Parâmetro "codigo" ausente.' });
    const r = verifyCode(codigo);
    return res.status(200).json({ ok: true, ...r });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ ok: false, error: "Método não permitido." });
}
