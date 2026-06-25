/**
 * POST /api/send-certificate-palestrante
 * Proxy server-side para o Apps Script Web App que envia os certificados de
 * PALESTRANTES (separado do de inscritos). Evita CORS ao chamar
 * script.google.com direto do browser.
 *
 * Env var:
 *   CERT_PAL_WEBAPP_URL  URL /exec do Apps Script de palestrantes.
 *   (Defina na Vercel após publicar o enviarCertificadosPalestrantes.gs.)
 */

import { createLogger } from "../lib/logger.mjs";

const log = createLogger("send-certificate-palestrante");

const APPS_SCRIPT_URL =
  process.env.CERT_PAL_WEBAPP_URL ||
  "https://script.google.com/macros/s/AKfycbyCyREbNiSnzEmhSByQDon10pUeLHNNCS_GButNdiPnT0AeQU5pjlSN_9xB_qtSKf5H/exec";

export const config = {
  api: { bodyParser: { sizeLimit: "10mb" } },
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Método não permitido." });
  }

  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.startsWith("COLE_AQUI")) {
    return res.status(503).json({
      ok: false,
      error: "Endpoint de palestrantes não configurado: defina CERT_PAL_WEBAPP_URL.",
    });
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
    log.error("erro no proxy de envio de certificado de palestrante", { err: err?.message });
    return res.status(500).json({ ok: false, error: err.message || "Erro interno." });
  }
}
