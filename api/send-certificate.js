/**
 * POST /api/send-certificate
 * Proxy server-side para o Apps Script Web App que envia certificados.
 * Elimina o problema de CORS ao chamar script.google.com direto do browser.
 *
 * Env var opcional:
 *   CERT_WEBAPP_URL  URL /exec do Apps Script (sobrescreve o default)
 */

import { createLogger } from "../lib/logger.mjs";

const log = createLogger("send-certificate");

const APPS_SCRIPT_URL =
  process.env.CERT_WEBAPP_URL ||
  "https://script.google.com/macros/s/AKfycbwAVbJ8bKzBpKSlSwPEsX815JJrTkhZu0mXwDccL6H9FrIc_g0kd3GCLiVtzZA29-Kc/exec";

export const config = {
  api: { bodyParser: { sizeLimit: "10mb" } },
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Método não permitido." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (_) { body = null; }
  }
  if (!body || typeof body !== "object") {
    return res.status(400).json({ ok: false, error: "Payload inválido." });
  }

  try {
    const upstream = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      redirect: "follow",
    });

    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); }
    catch (_) {
      return res.status(502).json({
        ok: false,
        error: "Resposta inválida do Apps Script.",
        upstreamStatus: upstream.status,
        snippet: text.slice(0, 300),
      });
    }
    return res.status(upstream.ok ? 200 : 502).json(data);
  } catch (err) {
    log.error("erro no proxy de envio de certificado", { err: err?.message });
    return res.status(500).json({ ok: false, error: err.message || "Erro interno." });
  }
}
