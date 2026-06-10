/**
 * GET /api/eventos
 * Dados dos eventos AO VIVO: baixa as planilhas .xlsx do Drive (via o Web App
 * servirRelatorios.gs), processa em memoria com a MESMA logica do build
 * (normalize + build-data) e devolve o mesmo formato de eventos-data.json.
 *
 * Assim, atualizar uma planilha no Drive reflete no site sem novo deploy.
 * Um cache em memoria (TTL) evita reprocessar a cada request.
 *
 * Env vars: RELATORIOS_WEBAPP_URL, RELATORIOS_TOKEN.
 */

import XLSX from "xlsx";
import {
  extractRegistrosFromWorkbook,
  buildSchemaA,
  buildSchemaB,
} from "../scripts/normalize-planilhas.mjs";
import {
  parsePlanilhaFromWorkbook,
  buildEvento,
  buildResumo,
  slugify,
} from "../scripts/build-data.mjs";

const WEBAPP_URL = process.env.RELATORIOS_WEBAPP_URL || "";
const TOKEN = process.env.RELATORIOS_TOKEN || "";

const PREFIXO = "assets/docs/relatorios/";
const CACHE_TTL_MS = 30 * 1000; // 30s

export const config = { maxDuration: 30 };

// Cache em memoria (sobrevive entre invocacoes "quentes" da mesma lambda).
let _cache = { at: 0, data: null };

export default async function handler(req, res) {
  if (!WEBAPP_URL || !TOKEN) {
    // Sem config: o front cai no fallback (eventos-data.json estatico).
    return res.status(503).json({ ok: false, error: "Relatórios ao vivo não configurados." });
  }

  // ?fresh=1 força reprocessar do Drive, ignorando o cache (usado pelo botão
  // "Atualizar" do painel).
  const q = req.query || {};
  const fresh = q.fresh === "1" || q.fresh === "true" || /[?&]fresh=(1|true)\b/.test(req.url || "");

  try {
    const agora = Date.now();
    if (!fresh && _cache.data && agora - _cache.at < CACHE_TTL_MS) {
      res.setHeader("X-Eventos-Cache", "hit");
      return res.status(200).json(_cache.data);
    }

    const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0];
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const metaUrl = `${proto}://${host}/${PREFIXO}eventos-meta.json`;

    // Manifesto (lista de arquivos no Drive) + metadata em paralelo.
    const [manifest, meta] = await Promise.all([
      getJson(`${WEBAPP_URL}?action=manifest&token=${encodeURIComponent(TOKEN)}`),
      getJson(metaUrl).then((m) => (m && m.eventos) || {}).catch(() => ({})),
    ]);
    if (!manifest.ok) throw new Error(manifest.error || "Falha no manifesto do Drive.");

    // Filtra: só .xlsx de participantes (ignora satisfacao/pesquisa e lock files).
    const arquivos = (manifest.files || [])
      .map((f) => ({ ...f, rel: relativo(f.path) }))
      .filter((f) => ehParticipantes(f.rel));

    // Baixa todos os arquivos em paralelo.
    const buffers = await Promise.all(
      arquivos.map((f) =>
        getJson(`${WEBAPP_URL}?action=file&token=${encodeURIComponent(TOKEN)}&id=${encodeURIComponent(f.id)}`)
          .then((d) => (d && d.ok && d.base64 ? Buffer.from(d.base64, "base64") : null))
          .catch(() => null)
      )
    );

    const eventos = [];
    for (let i = 0; i < arquivos.length; i++) {
      const arquivo = arquivos[i].rel;
      const buf = buffers[i];
      if (!buf) continue;
      const metaEntry = meta[arquivo] || {};
      // Respeita o mesmo "ignore" do build estático (eventos-meta.json): arquivo
      // legado já consolidado em outra turma não vira evento (evita duplicar o
      // Ciclo no seletor e não re-agrupar a turma única, que perderia o fonte).
      if (metaEntry.ignore) continue;
      try {
        const evento = processarArquivo(buf, arquivo, metaEntry);
        if (evento) eventos.push(evento);
      } catch (err) {
        // Cabeçalho não reconhecido = não é lista de participantes; pula.
        if (!/Cabeçalho não reconhecido/.test(err.message)) {
          console.error(`[eventos] ${arquivo}: ${err.message}`);
        }
      }
    }

    // Ordena por data asc (sem data ao final) - igual ao build.
    eventos.sort((a, b) => {
      if (a.date && b.date) return a.date.localeCompare(b.date);
      if (a.date) return -1;
      if (b.date) return 1;
      return 0;
    });

    const data = {
      geradoEm: new Date().toISOString(),
      fonte: "drive (ao vivo)",
      eventos,
      resumo: buildResumo(eventos),
    };

    _cache = { at: agora, data };
    res.setHeader("X-Eventos-Cache", "miss");
    return res.status(200).json(data);
  } catch (err) {
    console.error("[eventos] erro:", err);
    // Se temos cache antigo, melhor servir velho do que nada.
    if (_cache.data) {
      res.setHeader("X-Eventos-Cache", "stale");
      return res.status(200).json(_cache.data);
    }
    return res.status(502).json({ ok: false, error: err.message || "Erro ao montar eventos." });
  }
}

// Reproduz o pipeline do build em memoria: normalize -> workbook -> build-data.
function processarArquivo(buffer, arquivo, metaEntry) {
  const wbRaw = XLSX.read(buffer, { cellDates: true });
  const { registros, sourceHasModulos } = extractRegistrosFromWorkbook(wbRaw);

  const metaHasModulos = Array.isArray(metaEntry.modulos) && metaEntry.modulos.length > 0;
  const useSchemaA = metaHasModulos || sourceHasModulos;
  const aoa = useSchemaA
    ? buildSchemaA(registros, sourceHasModulos)
    : buildSchemaB(registros, sourceHasModulos);

  // Monta um workbook normalizado em memoria e re-parseia com a logica do build.
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const wbNorm = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbNorm, sheet, "Lista de participantes");
  const participantes = parsePlanilhaFromWorkbook(wbNorm);

  const defaults = {
    id: slugify(arquivo.replace(/\.xlsx$/i, "").replace(/\//g, "-")),
    title: arquivo.replace(/\.xlsx$/i, "").replace(/\//g, " · "),
  };
  const eventoMeta = { ...defaults, ...metaEntry };
  return buildEvento(arquivo, eventoMeta, participantes);
}

// Caminho relativo a assets/docs/relatorios/ (tolera o prefixo vindo do Drive).
function relativo(p) {
  return String(p).replace(/\\/g, "/").replace(/^\/+/, "").replace(new RegExp("^" + PREFIXO, "i"), "");
}

function ehParticipantes(rel) {
  const base = rel.split("/").pop().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!base.endsWith(".xlsx")) return false;
  if (base.startsWith("~$")) return false;
  if (base.startsWith("satisfacao") || base.startsWith("pesquisa")) return false;
  return true;
}

async function getJson(url) {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
