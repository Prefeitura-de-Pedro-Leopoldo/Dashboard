/**
 * GET /api/participantes?folder=<pasta relativa a assets/docs/relatorios/>
 *
 * Le AO VIVO o participantes.xlsx de uma pasta de evento (via o Web App
 * servirRelatorios.gs), parseia com a MESMA logica do build (build-data.mjs) e
 * devolve o evento ja montado (mesmo formato do eventos-data.json).
 *
 * Serve para o dashboard "promover" um evento de inscricao-aberta para
 * concluido SEM precisar de um novo build/deploy: assim que o gerarParticipantes
 * grava o .xlsx com check-ins no Drive (3h apos o evento), o card passa a exibir
 * presenca/analises ao vivo. Eventos que ainda nao aconteceram tem so o
 * placeholder (cabecalho, 0 linhas) -> hasData=false -> nao alteram o estado.
 *
 * Query:
 *   ?folder=<pasta>   ex.: "gestao-inovacao-presencial-2026-06"
 *   ?fresh=1          ignora o cache em memoria
 *
 * Resposta: { ok, found, hasData, evento? }
 *
 * Env vars: RELATORIOS_WEBAPP_URL, RELATORIOS_TOKEN.
 */

import XLSX from "xlsx";
import { parsePlanilhaFromWorkbook, buildEvento } from "../scripts/build-data.mjs";
import { createLogger } from "../lib/logger.mjs";

const log = createLogger("participantes");

const WEBAPP_URL = process.env.RELATORIOS_WEBAPP_URL || "";
const TOKEN = process.env.RELATORIOS_TOKEN || "";
const PREFIXO = "assets/docs/relatorios/";

const CACHE_TTL_MS = 30 * 1000;      // 30s: "quase ao vivo" sem martelar o Apps Script
const META_TTL_MS = 5 * 60 * 1000;   // 5min para o eventos-meta.json

export const config = { maxDuration: 30 };

// Normaliza para comparar pastas/chaves: minusculas, sem acento, barras "/".
const norm = (s) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

// Caminho relativo a assets/docs/relatorios/ (tolera o prefixo vindo do Drive).
function relativo(p) {
  return String(p).replace(/\\/g, "/").replace(/^\/+/, "").replace(new RegExp("^" + PREFIXO, "i"), "");
}

function ehParticipantes(base) {
  const b = base.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return b.startsWith("participantes") && b.endsWith(".xlsx") && !b.startsWith("~$");
}

async function getJson(url) {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// eventos-meta.json publicado (estatico do proprio deploy). Cacheado em memoria.
let _metaCache = null; // { at, byKey: Map }
async function carregarMeta(req) {
  const agora = Date.now();
  if (_metaCache && agora - _metaCache.at < META_TTL_MS) return _metaCache.byKey;
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host;
  const url = `${proto}://${host}/${PREFIXO}eventos-meta.json`;
  const json = await getJson(url);
  const eventos = (json && json.eventos) || {};
  const byKey = new Map();
  for (const [k, v] of Object.entries(eventos)) byKey.set(norm(k), v);
  _metaCache = { at: agora, byKey };
  return byKey;
}

// Cache do evento montado, por pasta.
const _cache = new Map(); // folderN -> { at, payload }

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Metodo nao permitido." });
  }
  if (!WEBAPP_URL || !TOKEN) {
    return res.status(503).json({ ok: false, error: "Relatorios ao vivo nao configurados." });
  }

  const q = req.query || {};
  const folder = String(q.folder || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!folder) return res.status(400).json({ ok: false, error: "Parametro 'folder' obrigatorio." });
  const folderN = norm(folder);
  const fresh = q.fresh === "1" || q.fresh === "true";

  const hit = _cache.get(folderN);
  if (!fresh && hit && Date.now() - hit.at < CACHE_TTL_MS) {
    res.setHeader("X-Participantes-Cache", "hit");
    return res.status(200).json(hit.payload);
  }

  try {
    const manifest = await getJson(`${WEBAPP_URL}?action=manifest&token=${encodeURIComponent(TOKEN)}`);
    if (!manifest.ok) throw new Error(manifest.error || "Falha no manifesto do Drive.");

    // Acha o participantes.xlsx na pasta pedida.
    const arquivo = (manifest.files || [])
      .map((f) => ({ ...f, rel: relativo(f.path) }))
      .find((f) => {
        const slash = f.rel.lastIndexOf("/");
        const dir = slash >= 0 ? f.rel.slice(0, slash) : "";
        const base = slash >= 0 ? f.rel.slice(slash + 1) : f.rel;
        return norm(dir) === folderN && ehParticipantes(base);
      });

    if (!arquivo) {
      const payload = { ok: true, found: false, hasData: false };
      _cache.set(folderN, { at: Date.now(), payload });
      return res.status(200).json(payload);
    }

    const file = await getJson(`${WEBAPP_URL}?action=file&token=${encodeURIComponent(TOKEN)}&id=${encodeURIComponent(arquivo.id)}`);
    if (!file.ok || !file.base64) throw new Error("Falha ao baixar o participantes.xlsx do Drive.");

    const wb = XLSX.read(file.base64, { type: "base64", cellDates: true });
    const participantes = parsePlanilhaFromWorkbook(wb);

    // Placeholder vazio (so cabecalho) -> nao promove o evento.
    if (!participantes.length) {
      const payload = { ok: true, found: true, hasData: false };
      _cache.set(folderN, { at: Date.now(), payload });
      return res.status(200).json(payload);
    }

    const metaByKey = await carregarMeta(req);
    const meta = metaByKey.get(norm(arquivo.rel)) || {};
    const evento = buildEvento(arquivo.rel, meta, participantes);

    const payload = { ok: true, found: true, hasData: true, evento };
    _cache.set(folderN, { at: Date.now(), payload });
    res.setHeader("X-Participantes-Cache", "miss");
    return res.status(200).json(payload);
  } catch (err) {
    log.error("erro ao ler participantes", { folder, err: err?.message });
    if (hit) {
      res.setHeader("X-Participantes-Cache", "stale");
      return res.status(200).json(hit.payload);
    }
    return res.status(502).json({ ok: false, error: err.message || "Erro ao ler participantes." });
  }
}
