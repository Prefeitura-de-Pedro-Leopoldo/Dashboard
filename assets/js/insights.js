/**
 * insights.js - gera observacoes automaticas a partir dos dados reais.
 */

import {
  taxaPresenca,
  taxaOcupacao,
  rankingSecretarias,
  eventosComBaixaPresenca,
  resumoGlobal,
} from "./metrics.js";

const fmt = (n) => (n ?? 0).toLocaleString("pt-BR");
const pct = (n) => (n === null || n === undefined ? "N/A" : n + "%");

/**
 * Severidade (menor = mais urgente):
 *   1 = danger  (alerta crítico, ação imediata)
 *   2 = warn    (atenção, recomendação)
 *   3 = positive (destaque positivo)
 *   4 = neutral  (informativo / contexto)
 */
const SEVERITY = { danger: 1, warn: 2, positive: 3, neutral: 4 };

export function gerarInsightsGlobais(data) {
  const out = [];
  const eventos = data.eventos;
  const realizados = eventos.filter((e) => e.status === "realizado");
  const agendados = eventos.filter((e) => e.status === "agendado");
  const resumo = resumoGlobal(eventos);

  if (eventos.length === 0) {
    out.push({
      type: "neutral",
      icon: "fa-circle-info",
      title: "Sem dados",
      html: "Nenhum evento foi encontrado nos arquivos da pasta <b>docs/eventos</b>.",
    });
    return out;
  }

  if (agendados.length > 0) {
    const titulos = agendados.map((e) => e.title).join(", ");
    out.push({
      type: "neutral",
      icon: "fa-calendar-plus",
      title: "Eventos agendados",
      html: `<b>${agendados.length}</b> evento(s) futuro(s): <b>${titulos}</b>.`,
    });
  }

  if (realizados.length > 0) {
    const top = [...realizados].sort((a, b) => b.totalInscritos - a.totalInscritos)[0];
    out.push({
      type: "positive",
      icon: "fa-arrow-trend-up",
      title: "Maior adesão",
      html: `<b>${top.title}</b> · <b>${fmt(top.totalInscritos)}</b> inscrições.`,
    });
  }

  if (resumo.taxaPresencaGlobal !== null) {
    if (resumo.taxaPresencaGlobal >= 80) {
      out.push({
        type: "positive",
        icon: "fa-circle-check",
        title: "Engajamento elevado",
        html: `Presença global de <b>${pct(resumo.taxaPresencaGlobal)}</b>. Manter abordagem atual.`,
      });
    } else if (resumo.taxaPresencaGlobal < 60) {
      out.push({
        type: "danger",
        icon: "fa-triangle-exclamation",
        title: "Gargalo de comparecimento",
        html: `Apenas <b>${pct(resumo.taxaPresencaGlobal)}</b> dos inscritos compareceram. Avaliar lembretes e confirmação prévia.`,
      });
    }
  }

  const baixos = eventosComBaixaPresenca(eventos, 70);
  if (baixos.length > 0) {
    const lista = baixos.map((e) => `${e.title} (${pct(taxaPresenca(e))})`).join(", ");
    out.push({
      type: "warn",
      icon: "fa-bell",
      title: "Baixa presença",
      html: `${baixos.length} evento(s) abaixo de 70%: <b>${lista}</b>.`,
    });
  }

  const ranking = rankingSecretarias(eventos);
  if (ranking.length > 0) {
    const top = ranking[0];
    out.push({
      type: "positive",
      icon: "fa-medal",
      title: "Secretaria líder",
      html: `<b>${top.nome}</b> · <b>${fmt(top.qtd)}</b> inscrições.`,
    });

    if (ranking.length >= 2) {
      const totalInsc = ranking.reduce((s, r) => s + r.qtd, 0);
      const concTop = Math.round((top.qtd / totalInsc) * 100);
      if (concTop >= 50) {
        out.push({
          type: "warn",
          icon: "fa-circle-half-stroke",
          title: "Concentração de inscrições",
          html: `<b>${concTop}%</b> das inscrições vieram de <b>${top.nome}</b>. Ampliar divulgação.`,
        });
      }
    }

    if (ranking.length >= 3) {
      const cauda = ranking.slice(-2);
      out.push({
        type: "neutral",
        icon: "fa-arrow-down-9-1",
        title: "Menor adesão",
        html: `<b>${cauda.map((c) => `${c.nome} (${c.qtd})`).join(", ")}</b>. Oportunidade de engajamento.`,
      });
    }
  }

  // Insights de ocupação (quando vagas conhecidas)
  const comVagas = eventos.filter((e) => e.vagas);
  if (comVagas.length) {
    const lotados = comVagas.filter((e) => taxaOcupacao(e) !== null && taxaOcupacao(e) >= 90);
    const vazios = comVagas.filter((e) => taxaOcupacao(e) !== null && taxaOcupacao(e) < 50);
    if (lotados.length) {
      const chips = lotados
        .map((e) => `<span class="insight-chip"><b>${pct(taxaOcupacao(e))}</b><span>${e.title}</span></span>`)
        .join("");
      out.push({
        type: "positive",
        icon: "fa-fire",
        title: "Alta procura (≥ 90%) Avaliar abrir vagas extras.",
        html: `<div class="insight-chips">${chips}</div>`,
      });
    }
    if (vazios.length) {
      const chips = vazios
        .map((e) => `<span class="insight-chip"><b>${pct(taxaOcupacao(e))}</b><span>${e.title}</span></span>`)
        .join("");
      out.push({
        type: "warn",
        icon: "fa-chair",
        title: "Vagas ociosas (< 50%) Reforçar divulgação ou ajustar oferta.",
        html: `<div class="insight-chips">${chips}</div>`,
      });
    }
  }
  const semVagas = eventos.filter((e) => !e.vagas);
  if (semVagas.length) {
    out.push({
      type: "neutral",
      icon: "fa-circle-info",
      title: "Capacidade não informada",
      html: `<b>${semVagas.length}</b> evento(s) sem capacidade registrada. Adicione em <b>docs/eventos/manual.json</b> para habilitar a taxa de ocupação.`,
    });
  }

  // Ordena por severidade (críticos primeiro)
  return out.sort((a, b) => (SEVERITY[a.type] || 99) - (SEVERITY[b.type] || 99));
}

export function gerarInsightsEvento(ev) {
  const out = [];
  if (!ev) return out;

  if (ev.status === "agendado") {
    out.push({
      type: "neutral",
      icon: "fa-calendar-plus",
      title: "Evento agendado",
      html: `<b>${ev.title}</b> ainda não recebeu inscrições. Aguardando a primeira lista de participantes.`,
    });
    return out;
  }

  const tx = taxaPresenca(ev);

  if (tx !== null && tx >= 80) {
    out.push({
      type: "positive",
      icon: "fa-circle-check",
      title: "Alta taxa de presença",
      html: `<b>${pct(tx)}</b> dos inscritos compareceram, evento com engajamento acima da média.`,
    });
  } else if (tx !== null && tx < 60) {
    out.push({
      type: "danger",
      icon: "fa-triangle-exclamation",
      title: "Presença abaixo do esperado",
      html: `Somente <b>${pct(tx)}</b> de comparecimento. Avaliar lembretes ou confirmação ativa.`,
    });
  }

  const turmas = Object.entries(ev.turmas || {});
  if (turmas.length >= 2) {
    turmas.sort((a, b) => b[1] - a[1]);
    const [maior, menor] = [turmas[0], turmas[turmas.length - 1]];
    const dif = Math.round(((maior[1] - menor[1]) / maior[1]) * 100);
    if (dif >= 20) {
      out.push({
        type: "warn",
        icon: "fa-scale-unbalanced",
        title: "Distribuição desigual entre turmas",
        html: `<b>${maior[0]}</b> teve ${maior[1]} inscritos vs <b>${menor[0]}</b> com ${menor[1]} (${dif}% de diferença). Considerar realocação ou estimular a turma menos procurada.`,
      });
    } else {
      out.push({
        type: "positive",
        icon: "fa-scale-balanced",
        title: "Distribuição equilibrada entre turmas",
        html: `As turmas estão balanceadas (${maior[1]} vs ${menor[1]} inscritos).`,
      });
    }
  }

  const ranking = Object.entries(ev.secretarias || {}).sort((a, b) => b[1] - a[1]);
  if (ranking.length > 0) {
    out.push({
      type: "neutral",
      icon: "fa-building-columns",
      title: "Secretaria de maior adesão",
      html: `<b>${ranking[0][0]}</b> com <b>${ranking[0][1]}</b> inscrições, secretaria mais engajada neste evento.`,
    });
    if (ranking.length === 1) {
      out.push({
        type: "warn",
        icon: "fa-bullhorn",
        title: "Adesão concentrada",
        html: `Apenas <b>1 secretaria</b> participou. Avaliar divulgação para outras pastas.`,
      });
    }
  }

  return out;
}
