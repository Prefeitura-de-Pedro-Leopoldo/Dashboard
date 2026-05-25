/**
 * metrics.js - funcoes puras de calculo de metricas.
 *
 * Capacidade ("vagas") vem do enriquecimento manual em
 * docs/eventos/manual.json (campo `vagas` por evento). Quando disponivel,
 * a taxa de ocupacao = inscritos / vagas * 100 e calculavel.
 * Quando ausente, ambos retornam null (UI mostra "N/A").
 */

export const totalInscricoes = (ev) => ev.totalInscritos ?? 0;

export const totalVagasOuIngressos = (ev) => ev.vagas ?? null;

export const totalPresentes = (ev) => ev.totalPresentes ?? 0;

export const totalAusentes = (ev) =>
  Math.max(0, (ev.totalInscritos ?? 0) - (ev.totalPresentes ?? 0));

export const taxaPresenca = (ev) => {
  const t = ev.totalInscritos ?? 0;
  if (t === 0) return null;
  return Math.round(((ev.totalPresentes ?? 0) / t) * 1000) / 10;
};

export const taxaOcupacao = (ev) => {
  const v = ev.vagas;
  const i = ev.totalInscritos ?? 0;
  if (!v || v <= 0) return null;
  return Math.round((i / v) * 1000) / 10;
};

export const inscricoesPorEvento = (eventos) =>
  eventos.map((e) => ({ id: e.id, title: e.title, valor: totalInscricoes(e) }));

export const presencasPorEvento = (eventos) =>
  eventos.map((e) => ({ id: e.id, title: e.title, valor: totalPresentes(e) }));

export const taxaPresencaPorEvento = (eventos) =>
  eventos.map((e) => ({ id: e.id, title: e.title, valor: taxaPresenca(e) }));

export const participacaoPorSecretaria = (ev) =>
  Object.entries(ev.secretarias || {}).map(([nome, qtd]) => ({ nome, qtd }));

export const rankingSecretarias = (eventos) => {
  const agg = {};
  for (const e of eventos) {
    for (const [k, v] of Object.entries(e.secretarias || {})) {
      agg[k] = (agg[k] || 0) + v;
    }
  }
  return Object.entries(agg)
    .map(([nome, qtd]) => ({ nome, qtd }))
    .sort((a, b) => b.qtd - a.qtd);
};

export const distribuicaoPorTurma = (ev) =>
  Object.entries(ev.turmas || {}).map(([nome, qtd]) => ({ nome, qtd }));

/**
 * Compara N eventos lado a lado e devolve um objeto agregado:
 *   inscritos, presentes, taxa, turmas, secretariasUnicas
 */
export const comparativoEventos = (eventos) =>
  eventos.map((e) => ({
    id: e.id,
    title: e.title,
    date: e.date,
    status: e.status,
    inscritos: totalInscricoes(e),
    presentes: totalPresentes(e),
    ausentes: totalAusentes(e),
    taxaPresenca: taxaPresenca(e),
    vagas: totalVagasOuIngressos(e),
    taxaOcupacao: taxaOcupacao(e),
    turmas: e.turmas || {},
    secretarias: e.secretarias || {},
    nSecretarias: Object.keys(e.secretarias || {}).length,
  }));

export const eventosComAltaProcura = (eventos, threshold = null) => {
  const realizados = eventos.filter((e) => e.status === "realizado");
  if (realizados.length === 0) return [];
  const ordenados = [...realizados].sort(
    (a, b) => totalInscricoes(b) - totalInscricoes(a)
  );
  if (threshold !== null) return ordenados.filter((e) => totalInscricoes(e) >= threshold);
  return ordenados.slice(0, Math.max(1, Math.ceil(ordenados.length / 2)));
};

export const eventosComBaixaPresenca = (eventos, limite = 70) => {
  return eventos
    .filter((e) => e.status === "realizado" && taxaPresenca(e) !== null)
    .filter((e) => taxaPresenca(e) < limite)
    .sort((a, b) => taxaPresenca(a) - taxaPresenca(b));
};

/**
 * Resumo global do conjunto.
 */
export const resumoGlobal = (eventos) => {
  const realizados = eventos.filter((e) => e.status === "realizado");
  const totInsc = realizados.reduce((s, e) => s + totalInscricoes(e), 0);
  const totPres = realizados.reduce((s, e) => s + totalPresentes(e), 0);
  const totVagas = eventos.reduce((s, e) => s + (e.vagas || 0), 0);
  return {
    totalEventos: eventos.length,
    eventosRealizados: realizados.length,
    eventosAgendados: eventos.filter((e) => e.status === "agendado").length,
    totalInscritos: totInsc,
    totalPresentes: totPres,
    totalAusentes: totInsc - totPres,
    totalVagas: totVagas || null,
    taxaPresencaGlobal: totInsc ? Math.round((totPres / totInsc) * 1000) / 10 : null,
    taxaOcupacaoGlobal: totVagas ? Math.round((totInsc / totVagas) * 1000) / 10 : null,
  };
};
