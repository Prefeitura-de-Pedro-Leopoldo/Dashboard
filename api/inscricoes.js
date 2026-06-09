/**
 * GET /api/inscricoes
 * Lê AO VIVO os inscritos da planilha "Inscrição" da pasta de um evento, via o
 * Web App servirInscricoes.gs. Mantém o token fora do client e evita CORS.
 *
 * Query:
 *   ?path=<pasta do evento>   ex.: "mapa-gerenciamento-risco-2026-05/turma 1"
 *                              (a pasta de onde sai o participantes.xlsx)
 *   ?manifest=1               lista todas as planilhas "Inscrição" (debug)
 *   ?kind=presentes&path=...  lê a planilha "Presente(s)" (check-ins) da pasta
 *   ?fresh=1                  ignora o cache em memória
 *
 * Env vars (Vercel e .env): INSCRICOES_WEBAPP_URL, INSCRICOES_TOKEN.
 */

const WEBAPP_URL = process.env.INSCRICOES_WEBAPP_URL || "";
const TOKEN = process.env.INSCRICOES_TOKEN || "";

const CACHE_TTL_MS = 20 * 1000; // 20s: "quase ao vivo" sem martelar o Apps Script

export const config = { maxDuration: 30 };

// Cache em memória por pasta (sobrevive entre invocações "quentes" da lambda).
const _cache = new Map(); // key -> { at, data }

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Método não permitido." });
  }

  if (!WEBAPP_URL || !TOKEN) {
    return res.status(503).json({ ok: false, error: "Serviço de inscrições não configurado." });
  }

  const q = req.query || {};
  const fresh = q.fresh === "1" || q.fresh === "true";

  let upstreamUrl;
  let cacheKey;
  if (q.manifest === "1" || q.manifest === "true") {
    cacheKey = "__manifest__";
    upstreamUrl = `${WEBAPP_URL}?action=manifest&token=${encodeURIComponent(TOKEN)}`;
  } else {
    const path = String(q.path || "").trim();
    if (!path) return res.status(400).json({ ok: false, error: 'Parâmetro "path" ausente.' });
    const presentes = q.kind === "presentes";
    const action = presentes ? "presentes" : "inscritos";
    cacheKey = (presentes ? "presentes:" : "") + path;
    upstreamUrl = `${WEBAPP_URL}?action=${action}&token=${encodeURIComponent(TOKEN)}&path=${encodeURIComponent(path)}`;
  }

  const agora = Date.now();
  const hit = _cache.get(cacheKey);
  if (!fresh && hit && agora - hit.at < CACHE_TTL_MS) {
    res.setHeader("X-Inscricoes-Cache", "hit");
    return res.status(200).json(hit.data);
  }

  try {
    const upstream = await fetch(upstreamUrl, { redirect: "follow" });
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
    if (data && data.ok) _cache.set(cacheKey, { at: agora, data });
    res.setHeader("X-Inscricoes-Cache", "miss");
    return res.status(200).json(data);
  } catch (err) {
    console.error("[inscricoes] erro:", err);
    if (hit) {
      res.setHeader("X-Inscricoes-Cache", "stale");
      return res.status(200).json(hit.data);
    }
    return res.status(502).json({ ok: false, error: err.message || "Erro ao ler inscrições." });
  }
}
