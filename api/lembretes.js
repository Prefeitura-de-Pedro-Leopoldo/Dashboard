/**
 * POST /api/lembretes
 * Proxy para o Web App lembretesEventos.gs (guarda a config de encontros/lembrete
 * de cada turma e dispara os e-mails 1 dia antes). Token fica no servidor.
 *
 * Ações: config-get | config-save.
 * Env vars (Vercel e .env): LEMBRETES_WEBAPP_URL, LEMBRETES_TOKEN.
 */

const WEBAPP_URL = process.env.LEMBRETES_WEBAPP_URL || "";
const TOKEN = process.env.LEMBRETES_TOKEN || "";

const ALLOWED = new Set(["config-get", "config-save"]);

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Método não permitido." });
  }
  if (!WEBAPP_URL || !TOKEN) {
    return res.status(503).json({ ok: false, error: "Serviço de lembretes não configurado." });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = null; } }
  if (!body || typeof body !== "object") return res.status(400).json({ ok: false, error: "Payload inválido." });

  const action = String(body.action || "").trim().toLowerCase();
  if (!ALLOWED.has(action)) return res.status(400).json({ ok: false, error: "Ação inválida." });

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
      return res.status(502).json({ ok: false, error: "Resposta inválida do Apps Script.", snippet: text.slice(0, 300) });
    }
    return res.status(upstream.ok ? 200 : 502).json(data);
  } catch (err) {
    console.error("[lembretes] erro:", err);
    return res.status(500).json({ ok: false, error: err.message || "Erro interno." });
  }
}
