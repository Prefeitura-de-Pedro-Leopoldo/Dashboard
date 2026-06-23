/**
 * POST /api/palestrantes
 * Proxy server-side para o Web App do Apps Script que persiste palestrantes
 * (planilha Google Sheets + fotos no Drive). Elimina CORS ao chamar
 * script.google.com direto do browser e mantém o token fora do client.
 *
 * Env vars (configure na Vercel e em .env.local):
 *   PALESTRANTES_WEBAPP_URL  URL /exec do Apps Script (obrigatória).
 *   PALESTRANTES_TOKEN       token compartilhado (SHARED_TOKEN do .gs).
 *
 * Ações aceitas no corpo JSON: create | list | update | delete.
 */

import { createLogger } from "../lib/logger.mjs";

const log = createLogger("palestrantes");

const WEBAPP_URL = process.env.PALESTRANTES_WEBAPP_URL || "";
const TOKEN = process.env.PALESTRANTES_TOKEN || "";

const ALLOWED_ACTIONS = new Set([
  "create", "list", "update", "delete",
  "invite-create", "invite-list", "invite-revoke", "invite-check", "invite-submit",
]);

export const config = {
  api: { bodyParser: { sizeLimit: "10mb" } }, // foto em base64
  maxDuration: 30,
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Método não permitido." });
  }

  if (!WEBAPP_URL || !TOKEN) {
    log.error("env ausente: defina PALESTRANTES_WEBAPP_URL e PALESTRANTES_TOKEN");
    return res.status(503).json({ ok: false, error: "Serviço de palestrantes não configurado." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (_) { body = null; }
  }
  if (!body || typeof body !== "object") {
    return res.status(400).json({ ok: false, error: "Payload inválido." });
  }

  const action = String(body.action || "").trim().toLowerCase();
  if (!ALLOWED_ACTIONS.has(action)) {
    return res.status(400).json({ ok: false, error: "Ação inválida." });
  }

  // Injeta o token no servidor; ignora qualquer token vindo do client.
  const payload = { ...body, action, token: TOKEN };

  try {
    const upstream = await fetch(WEBAPP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
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
    log.error("erro no proxy de palestrantes", { action, err: err?.message });
    return res.status(500).json({ ok: false, error: err.message || "Erro interno." });
  }
}
