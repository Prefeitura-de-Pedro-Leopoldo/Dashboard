/**
 * data.js - fonte unica dos dados do painel.
 * Le o JSON gerado por `docs/eventos/_extract.py` (que processa
 * exclusivamente os .xlsx em docs/eventos/).
 */

// Fonte primária: API ao vivo (processa as planilhas do Drive em runtime, então
// atualizar uma planilha reflete sem novo deploy). Fallback: o JSON estático
// gerado no build (rápido e sempre disponível, mesmo se a API estiver fora).
const LIVE_URL = "/api/eventos";
const STATIC_URL = "eventos-data.json";

let _cache = null;

/**
 * Carrega os dados com estratégia "stale-while-revalidate":
 *   1. Resolve já com o JSON ESTÁTICO (local, instantâneo) → tela aparece rápido.
 *   2. Em segundo plano, busca a API AO VIVO e, se os números mudaram, chama
 *      `onLiveUpdate(dados)` para a tela se atualizar sem novo deploy.
 *
 * Se não houver estático, espera o ao vivo. Se ambos falharem, lança erro.
 *
 * @param {(dados:object)=>void} [onLiveUpdate]
 */
export async function loadData(onLiveUpdate, opts = {}) {
  const force = !!opts.force;
  if (_cache && !force) return _cache;

  // Atualização forçada (botão "Atualizar"): busca o AO VIVO fresco, ignorando
  // o cache do cliente e o do servidor (?fresh=1), e espera por ele.
  if (force) {
    const live = await fetchNorm(LIVE_URL + "?fresh=1");
    if (live) { _cache = live; return _cache; }
    const est = await fetchNorm(STATIC_URL);
    if (est) { _cache = est; return _cache; }
    throw new Error("Não foi possível atualizar os dados.");
  }

  const livePromise = fetchNorm(LIVE_URL); // pode resolver null

  // Estático primeiro (rápido) para a primeira renderização.
  const estatico = await fetchNorm(STATIC_URL);
  if (estatico) {
    _cache = estatico;
    // Revalida com o ao vivo em segundo plano; só re-renderiza se mudou.
    livePromise.then((live) => {
      if (live && _sig(live) !== _sig(estatico)) {
        _cache = live;
        if (typeof onLiveUpdate === "function") onLiveUpdate(live);
      }
    });
    return _cache;
  }

  // Sem estático: depende do ao vivo.
  const live = await livePromise;
  if (live) {
    _cache = live;
    return _cache;
  }
  throw new Error("Não foi possível carregar os dados (ao vivo e estático indisponíveis).");
}

async function fetchNorm(url) {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return null;
    const raw = await res.json();
    if (!raw || !Array.isArray(raw.eventos)) return null;
    return normalize(raw);
  } catch (_) {
    return null;
  }
}

// Assinatura barata para detectar se os números mudaram (evita re-render à toa).
function _sig(d) {
  return (d.eventos || [])
    .map((e) => `${e.id}:${e.totalInscritos}:${e.totalPresentes}`)
    .join("|");
}

/**
 * Normaliza os dados garantindo campos consistentes e tratando
 * eventos sem inscritos ou com campos ausentes.
 */
function normalize(raw) {
  const eventos = (raw.eventos || []).map((e) => ({
    ...e,
    title: e.title || "(sem título)",
    secretarias: e.secretarias || {},
    turmas: e.turmas || {},
    participantes: e.participantes || [],
    timelineInscricoes: e.timelineInscricoes || [],
    timelineCheckins: e.timelineCheckins || [],
    totalInscritos: e.totalInscritos || 0,
    totalPresentes: e.totalPresentes || 0,
    totalAusentes: e.totalAusentes || 0,
    taxaPresenca: e.taxaPresenca,
    status: e.status || (e.totalInscritos > 0 ? "realizado" : "agendado"),
  }));
  return { ...raw, eventos, resumo: raw.resumo || {} };
}

/**
 * Helper: retorna evento por id.
 */
export function getEvento(data, id) {
  return data.eventos.find((e) => e.id === id) || null;
}
