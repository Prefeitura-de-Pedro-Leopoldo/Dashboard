/**
 * data.js - fonte unica dos dados do painel.
 * Le o JSON gerado por `docs/eventos/_extract.py` (que processa
 * exclusivamente os .xlsx em docs/eventos/).
 */

const DATA_URL = "eventos-data.json";

let _cache = null;

export async function loadData() {
  if (_cache) return _cache;
  const res = await fetch(DATA_URL, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Falha ao carregar ${DATA_URL}: ${res.status}`);
  const raw = await res.json();
  _cache = normalize(raw);
  return _cache;
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
