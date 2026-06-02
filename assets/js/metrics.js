/**
 * metrics.js - funcoes puras de calculo de metricas.
 *
 * Capacidade ("vagas") vem do enriquecimento manual em
 * assets/docs/relatorios/eventos-meta.json (campo `vagas` por evento) e é
 * exibida como informação, mas NÃO entra na ocupação.
 * Ocupação = Presentes / (Presentes + Ausentes): mede a efetividade de
 * comparecimento. Sem presença/ausência registrada, retorna null (UI "N/A").
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

// Ocupação = Presentes / (Presentes + Ausentes). Mede quanto da audiência
// efetiva (quem confirmou presença ou faltou) de fato compareceu — NÃO usa
// vagas/inscritos. Sem presença nem ausência registradas, retorna null.
export const taxaOcupacao = (ev) => {
  const pres = ev.totalPresentes ?? 0;
  const aus = ev.totalAusentes ?? Math.max(0, (ev.totalInscritos ?? 0) - pres);
  const base = pres + aus;
  if (base <= 0) return null;
  return Math.round((pres / base) * 1000) / 10;
};

export const inscricoesPorEvento = (eventos) =>
  eventos.map((e) => ({ id: e.id, title: e.title, valor: totalInscricoes(e) }));

export const presencasPorEvento = (eventos) =>
  eventos.map((e) => ({ id: e.id, title: e.title, valor: totalPresentes(e) }));

export const taxaPresencaPorEvento = (eventos) =>
  eventos.map((e) => ({ id: e.id, title: e.title, valor: taxaPresenca(e) }));

export const participacaoPorSecretaria = (ev) =>
  Object.entries(ev.secretarias || {}).map(([nome, qtd]) => ({ nome, qtd }));

/**
 * Consolida eventos do mesmo `grupo.id` em um único objeto.
 * Soma inscritos/presentes/ausentes, mescla mapas de secretarias/turmas,
 * unifica participantes e recalcula taxas. Eventos sem grupo passam intactos.
 * Adiciona `_turmas` (lista dos eventos originais) para drill-down posterior.
 */
export const consolidarPorGrupo = (eventos) => {
  if (!Array.isArray(eventos) || !eventos.length) return [];
  const byGroup = new Map();
  const out = [];
  for (const ev of eventos) {
    const gid = ev.grupo && ev.grupo.id;
    if (!gid) {
      out.push({ ...ev, _turmas: [ev] });
      continue;
    }
    if (!byGroup.has(gid)) {
      const base = {
        id: gid,
        title: ev.grupo.titulo || ev.title,
        date: ev.date,
        dateRaw: ev.dateRaw,
        time: ev.time,
        local: ev.local,
        city: ev.city,
        status: ev.status,
        totalInscritos: 0,
        totalAprovados: 0,
        totalPresentes: 0,
        totalAusentes: 0,
        vagas: 0,
        secretarias: {},
        secretariasPresentes: {},
        turmas: {},
        turmasPresentes: {},
        participantes: [],
        timelineInscricoes: [],
        timelineCheckins: [],
        grupo: { ...ev.grupo, agrupado: true },
        _turmas: [],
      };
      byGroup.set(gid, base);
      out.push(base);
    }
    const g = byGroup.get(gid);
    g._turmas.push(ev);
    g.totalInscritos += ev.totalInscritos || 0;
    g.totalAprovados += ev.totalAprovados || 0;
    g.totalPresentes += ev.totalPresentes || 0;
    g.totalAusentes += ev.totalAusentes || 0;
    g.vagas += ev.vagas || 0;
    // Pega a data mais antiga e horário/local do primeiro
    if (ev.date && (!g.date || ev.date < g.date)) g.date = ev.date;
    // Soma secretarias
    for (const [k, v] of Object.entries(ev.secretarias || {})) {
      g.secretarias[k] = (g.secretarias[k] || 0) + v;
    }
    for (const [k, v] of Object.entries(ev.secretariasPresentes || {})) {
      g.secretariasPresentes[k] = (g.secretariasPresentes[k] || 0) + v;
    }
    // Turmas: se o evento individual já tem subdivisão interna em turmas, usa essas;
    // caso contrário, ele mesmo (turma do grupo) vira uma chave do mapa "turmas".
    const subturmas = ev.turmas || {};
    const subturmasPresentes = ev.turmasPresentes || {};
    if (Object.keys(subturmas).length > 0) {
      for (const [k, v] of Object.entries(subturmas)) {
        g.turmas[k] = (g.turmas[k] || 0) + v;
      }
      for (const [k, v] of Object.entries(subturmasPresentes)) {
        g.turmasPresentes[k] = (g.turmasPresentes[k] || 0) + v;
      }
    } else {
      // Nome legível da turma a partir de grupo.turma / grupo.modulo, com fallback no title
      const tNum = ev.grupo && (ev.grupo.turma ?? null);
      const mNum = ev.grupo && (ev.grupo.modulo ?? null);
      let label;
      if (tNum != null) label = `Turma ${tNum}`;
      else if (mNum != null) label = `Módulo ${mNum}`;
      else label = ev.title;
      g.turmas[label] = (g.turmas[label] || 0) + (ev.totalInscritos || 0);
      g.turmasPresentes[label] = (g.turmasPresentes[label] || 0) + (ev.totalPresentes || 0);
    }
    // Participantes: une listas
    if (Array.isArray(ev.participantes)) g.participantes.push(...ev.participantes);
    // Timeline: soma por chave
    const mergeTimeline = (dst, src) => {
      const map = new Map(dst.map(([k, v]) => [k, v]));
      for (const [k, v] of src || []) map.set(k, (map.get(k) || 0) + v);
      return [...map.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    };
    g.timelineInscricoes = mergeTimeline(g.timelineInscricoes, ev.timelineInscricoes);
    g.timelineCheckins = mergeTimeline(g.timelineCheckins, ev.timelineCheckins);
  }
  // Recalcula taxas
  for (const g of out) {
    if (g._turmas.length > 1) {
      g.taxaPresenca = g.totalInscritos
        ? Math.round((g.totalPresentes / g.totalInscritos) * 1000) / 10
        : null;
      g.taxaOcupacao = (g.totalPresentes + g.totalAusentes) > 0
        ? Math.round((g.totalPresentes / (g.totalPresentes + g.totalAusentes)) * 1000) / 10
        : null;
    }
  }
  return out;
};

/**
 * Evasão por secretaria de um único evento.
 * Conta inscritos que não compareceram. Só retorna entradas com evasão > 0.
 */
export const evasaoPorSecretariaEvento = (ev) => {
  const ins = ev.secretarias || {};
  const pres = ev.secretariasPresentes || {};
  const out = [];
  for (const [nome, qtdIns] of Object.entries(ins)) {
    const qtdPres = pres[nome] || 0;
    const evasao = qtdIns - qtdPres;
    if (evasao > 0) out.push({ nome, qtd: evasao, inscritos: qtdIns, presentes: qtdPres });
  }
  return out.sort((a, b) => b.qtd - a.qtd);
};

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

/**
 * Ranking de secretarias por evasão (inscritos que não compareceram).
 * Agrega `secretarias` (inscritos) menos `secretariasPresentes` (compareceram)
 * em todos os eventos realizados. Inclui `taxaEvasao` em pp para tooltip.
 */
export const rankingEvasaoSecretarias = (eventos) => {
  const inscritos = {};
  const presentes = {};
  for (const e of eventos) {
    if (e.status !== "realizado") continue;
    for (const [k, v] of Object.entries(e.secretarias || {})) {
      inscritos[k] = (inscritos[k] || 0) + v;
    }
    for (const [k, v] of Object.entries(e.secretariasPresentes || {})) {
      presentes[k] = (presentes[k] || 0) + v;
    }
  }
  return Object.keys(inscritos)
    .map((nome) => {
      const i = inscritos[nome] || 0;
      const p = presentes[nome] || 0;
      const qtd = Math.max(0, i - p);
      const taxa = i > 0 ? Math.round((qtd / i) * 1000) / 10 : 0;
      return { nome, qtd, inscritos: i, presentes: p, taxaEvasao: taxa };
    })
    .filter((s) => s.qtd > 0)
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
  const totAus = realizados.reduce(
    (s, e) => s + (e.totalAusentes ?? Math.max(0, totalInscricoes(e) - totalPresentes(e))),
    0
  );
  return {
    totalEventos: eventos.length,
    eventosRealizados: realizados.length,
    eventosAgendados: eventos.filter((e) => e.status === "agendado").length,
    totalInscritos: totInsc,
    totalPresentes: totPres,
    totalAusentes: totInsc - totPres,
    totalVagas: totVagas || null,
    taxaPresencaGlobal: totInsc ? Math.round((totPres / totInsc) * 1000) / 10 : null,
    taxaOcupacaoGlobal: (totPres + totAus) > 0
      ? Math.round((totPres / (totPres + totAus)) * 1000) / 10
      : null,
  };
};
