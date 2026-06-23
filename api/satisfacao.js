/**
 * GET /api/satisfacao?folder=<pasta relativa a assets/docs/relatorios/>
 *
 * Baixa do Drive (via o Web App servirRelatorios.gs) a planilha de
 * satisfacao/pesquisa que estiver na pasta informada e devolve o .xlsx.
 *
 * Serve de FALLBACK para quando o arquivo estatico nao esta disponivel/servido
 * - tipicamente no `vercel dev`, que nao serve os .xlsx ignorados pelo git, ou
 * quando a planilha so existe no Drive (ainda nao baixada localmente). Em
 * producao o arquivo estatico costuma resolver primeiro; este endpoint e o
 * plano B. Mesmas credenciais do /api/eventos.
 *
 * Env vars: RELATORIOS_WEBAPP_URL, RELATORIOS_TOKEN.
 */

import { createLogger } from "../lib/logger.mjs";

const log = createLogger("satisfacao");

const WEBAPP_URL = process.env.RELATORIOS_WEBAPP_URL || "";
const TOKEN = process.env.RELATORIOS_TOKEN || "";
const PREFIXO = "assets/docs/relatorios/";

export const config = { maxDuration: 30 };

// Normaliza para comparar pastas: minusculas, sem acento, barras "/".
const norm = (s) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

// Caminho relativo a assets/docs/relatorios/ (tolera o prefixo vindo do Drive).
function relativo(p) {
  return String(p).replace(/\\/g, "/").replace(/^\/+/, "").replace(new RegExp("^" + PREFIXO, "i"), "");
}

// Reconhece o arquivo de satisfacao/pesquisa (qualquer grafia/acentuacao).
function ehSatisfacao(base) {
  const b = base.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!b.endsWith(".xlsx") || b.startsWith("~$")) return false;
  return b.startsWith("satisfacao") || b.startsWith("pesquisa");
}

async function getJson(url) {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export default async function handler(req, res) {
  if (!WEBAPP_URL || !TOKEN) {
    return res.status(503).json({ ok: false, error: "Relatorios ao vivo nao configurados." });
  }
  const q = req.query || {};
  const folder = String(q.folder || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!folder) return res.status(400).json({ ok: false, error: "Parametro 'folder' obrigatorio." });
  const folderN = norm(folder);

  try {
    const manifest = await getJson(`${WEBAPP_URL}?action=manifest&token=${encodeURIComponent(TOKEN)}`);
    if (!manifest.ok) throw new Error(manifest.error || "Falha no manifesto do Drive.");

    // Procura a satisfacao na pasta pedida (comparacao normalizada por acento/caixa).
    const hit = (manifest.files || [])
      .map((f) => ({ ...f, rel: relativo(f.path) }))
      .find((f) => {
        const slash = f.rel.lastIndexOf("/");
        const dir = slash >= 0 ? f.rel.slice(0, slash) : "";
        const base = slash >= 0 ? f.rel.slice(slash + 1) : f.rel;
        return norm(dir) === folderN && ehSatisfacao(base);
      });

    if (!hit) return res.status(404).json({ ok: false, error: `Sem satisfacao na pasta "${folder}".` });

    const data = await getJson(`${WEBAPP_URL}?action=file&token=${encodeURIComponent(TOKEN)}&id=${encodeURIComponent(hit.id)}`);
    if (!data.ok || !data.base64) return res.status(502).json({ ok: false, error: "Falha ao baixar do Drive." });

    const buf = Buffer.from(data.base64, "base64");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `inline; filename="${hit.rel.split("/").pop()}"`);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(buf);
  } catch (err) {
    log.error("erro ao buscar satisfação", { folder, err: err?.message });
    return res.status(502).json({ ok: false, error: err.message || "Erro ao buscar satisfacao." });
  }
}
