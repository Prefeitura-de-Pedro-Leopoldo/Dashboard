// Lógica de assinatura/validação de certificados (testável). Contrato idêntico
// ao /api/certificado da Vercel (POST assina em lote; GET valida por código).
import { jsonResponse, preflight } from "../_shared/http.ts";
import { type Cert, makeCode, verifyCode } from "../_shared/certificado.ts";

export async function handleCertificado(req: Request, secret: string): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  if (req.method === "POST") {
    let body: { certs?: unknown };
    try { body = await req.json(); } catch (_) { body = {}; }
    const certs = Array.isArray(body?.certs) ? body.certs as Partial<Cert>[] : [];
    if (!certs.length) return jsonResponse({ ok: false, error: 'Lista "certs" vazia.' }, 400);
    if (certs.length > 5000) return jsonResponse({ ok: false, error: "Lote acima do limite (5000)." }, 413);
    const items = certs.map((c) => ({
      codigo: makeCode({
        nome: String(c?.nome || "").trim(),
        curso: String(c?.curso || "").trim(),
        carga: String(c?.carga || "").trim(),
        data: String(c?.data || "").trim(),
      }, secret),
    }));
    return jsonResponse({ ok: true, items });
  }

  if (req.method === "GET") {
    const params = new URL(req.url).searchParams;
    const codigo = String(params.get("codigo") || params.get("c") || "").trim();
    if (!codigo) return jsonResponse({ ok: false, error: 'Parâmetro "codigo" ausente.' }, 400);
    return jsonResponse({ ok: true, ...verifyCode(codigo, secret) });
  }

  return jsonResponse({ ok: false, error: "Método não permitido." }, 405);
}
