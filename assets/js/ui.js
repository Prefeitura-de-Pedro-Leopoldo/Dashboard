/**
 * ui.js - funcoes de renderizacao (componentes HTML).
 */

import { taxaPresenca, taxaOcupacao, totalVagasOuIngressos } from "./metrics.js";

export const fmt = (n) => (n ?? 0).toLocaleString("pt-BR");
export const pct = (n) => (n === null || n === undefined ? "N/A" : n.toFixed(1) + "%");
export const escapeHtml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

export const formatDateBR = (iso) => {
  if (!iso) return "Sem data";
  const [y, m, d] = iso.split("-");
  if (!d) return iso;
  return `${d}/${m}/${y}`;
};

export const naTooltip = (motivo) =>
  `<span class="na-tooltip" title="${escapeHtml(motivo)}">N/A <i class="fas fa-circle-info"></i></span>`;

const progressClass = (v) => {
  if (v === null || v === undefined) return "";
  if (v >= 80) return "high";
  if (v >= 60) return "mid";
  return "low";
};

const OCUP_MOTIVO =
  "Capacidade não informada para este evento. Adicione no docs/eventos/manual.json para habilitar.";

// Helper: renderiza valor de vagas (ou N/A com tooltip)
const renderVagas = (ev) => {
  const v = totalVagasOuIngressos(ev);
  return v != null ? `<div class="stat__value">${fmt(v)}</div>` : `<div class="stat__value na">${naTooltip(OCUP_MOTIVO)}</div>`;
};
// Helper: renderiza taxa de ocupação
const renderOcup = (ev) => {
  const t = taxaOcupacao(ev);
  return t != null ? `<div class="stat__value ${t >= 90 ? "green" : t >= 50 ? "" : "red"}">${pct(t)}</div>` : `<div class="stat__value na">${naTooltip(OCUP_MOTIVO)}</div>`;
};

// ================ KPIs ================

export function renderKPIs(resumo) {
  const vagasInfo = resumo.totalVagas
    ? `<b>${fmt(resumo.totalVagas)}</b> vagas oferecidas`
    : `Vagas não informadas`;
  const ocupTxt =
    resumo.taxaOcupacaoGlobal === null
      ? "N/A"
      : resumo.taxaOcupacaoGlobal + "<small>%</small>";
  return `
    <div class="kpi">
      <div class="kpi__icon"><i class="fas fa-calendar-check"></i></div>
      <div class="kpi__label">Eventos</div>
      <div class="kpi__value">${resumo.totalEventos}</div>
      <div class="kpi__delta">
        <b>${resumo.eventosRealizados}</b> realizado(s) &middot;
        <b>${resumo.eventosAgendados}</b> agendado(s)
      </div>
    </div>
    <div class="kpi kpi--accent">
      <div class="kpi__icon"><i class="fas fa-user-plus"></i></div>
      <div class="kpi__label">Inscritos</div>
      <div class="kpi__value">${fmt(resumo.totalInscritos)}</div>
      <div class="kpi__delta">${vagasInfo}</div>
    </div>
    <div class="kpi kpi--warn">
      <div class="kpi__icon"><i class="fas fa-user-check"></i></div>
      <div class="kpi__label">Presentes</div>
      <div class="kpi__value">${fmt(resumo.totalPresentes)}</div>
      <div class="kpi__delta"><b>${fmt(resumo.totalAusentes)}</b> faltas &middot;
        Presença ${resumo.taxaPresencaGlobal === null ? "N/A" : resumo.taxaPresencaGlobal + "%"}
      </div>
    </div>
    <div class="kpi kpi--danger">
      <div class="kpi__icon"><i class="fas fa-chart-pie"></i></div>
      <div class="kpi__label">Taxa de ocupação</div>
      <div class="kpi__value">${ocupTxt}</div>
      <div class="kpi__delta">Inscritos vs Vagas</div>
    </div>
  `;
}

// ================ Event card ================

export function renderEventCard(ev) {
  const tx = taxaPresenca(ev);
  const statusLabel = ev.status === "agendado" ? "Agendado" : "Realizado";
  const statusClass = ev.status === "agendado" ? "agendado" : tx !== null && tx < 60 ? "atencao" : "realizado";

  return `
    <article class="event-card" data-event="${ev.id}">
      <div class="event-card__top">
        <h3 class="event-card__title">${escapeHtml(ev.title)}</h3>
        <span class="status-badge ${statusClass}">${statusLabel}</span>
      </div>

      <div class="event-card__meta">
        <span><i class="fas fa-calendar"></i> ${formatDateBR(ev.date)}${ev.time ? " &middot; " + escapeHtml(ev.time) : ""}</span>
        ${ev.local ? `<span><i class="fas fa-location-dot"></i> ${escapeHtml(shortLocal(ev.local))}</span>` : ""}
      </div>

      <div class="event-card__stats">
        <div class="stat">
          <div class="stat__label">Inscritos</div>
          <div class="stat__value">${fmt(ev.totalInscritos)}</div>
        </div>
        <div class="stat">
          <div class="stat__label">Presentes</div>
          <div class="stat__value green">${fmt(ev.totalPresentes)}</div>
        </div>
        <div class="stat">
          <div class="stat__label">Vagas oferecidas</div>
          ${renderVagas(ev)}
        </div>
        <div class="stat">
          <div class="stat__label">Taxa de ocupação</div>
          ${renderOcup(ev)}
        </div>
      </div>

      <div class="event-card__progress">
        <div class="progress__head">
          <span>Taxa de presença</span>
          <b>${pct(tx)}</b>
        </div>
        <div class="progress">
          <div class="progress__fill ${progressClass(tx)}" style="width:${tx ?? 0}%"></div>
        </div>
      </div>

      <div class="event-card__action">
        <button class="btn btn--sm" data-action="detalhe" data-event="${ev.id}">
          <i class="fas fa-magnifying-glass-chart"></i> Analisar
        </button>
        <button class="btn btn--sm btn--primary" data-action="certificados" data-event="${ev.id}">
          <i class="fas fa-award"></i> Certificados
        </button>
      </div>
    </article>
  `;
}

// ================ Course card (curso com turmas/módulos) ================

const turmaLabel = (ev) => {
  const g = ev.grupo || {};
  if (g.modulo != null) return `Módulo ${g.modulo}`;
  if (g.turma != null) return `Turma ${g.turma}`;
  return ev.title;
};

export function renderCourseCard(group) {
  const evs = group.eventos;
  const insc = evs.reduce((s, e) => s + (e.totalInscritos || 0), 0);
  const pres = evs.reduce((s, e) => s + (e.totalPresentes || 0), 0);
  const aus = evs.reduce((s, e) => s + (e.totalAusentes || 0), 0);
  const tx = insc ? Math.round((pres / insc) * 1000) / 10 : null;
  const realizados = evs.filter((e) => e.status === "realizado").length;

  const rows = evs.map((e) => {
    const etx = taxaPresenca(e);
    return `
      <button type="button" class="course-card__turma" data-event="${e.id}">
        <span class="course-card__turma-name">
          <i class="fas fa-chevron-right"></i> ${escapeHtml(turmaLabel(e))}
        </span>
        <span class="course-card__turma-meta">
          ${fmt(e.totalInscritos)} inscr.${e.totalPresentes ? " &middot; " + fmt(e.totalPresentes) + " pres." : ""}${etx != null ? " &middot; " + pct(etx) : ""}
        </span>
      </button>
    `;
  }).join("");

  return `
    <article class="course-card">
      <div class="course-card__top">
        <h3 class="course-card__title">${escapeHtml(group.grupo.titulo)}</h3>
        <span class="status-badge curso">Curso</span>
      </div>
      <div class="course-card__sub">
        ${evs.length} turma(s)/módulo(s) &middot; ${realizados} realizado(s)
      </div>

      <div class="event-card__stats">
        <div class="stat"><div class="stat__label">Inscritos</div><div class="stat__value">${fmt(insc)}</div></div>
        <div class="stat"><div class="stat__label">Presentes</div><div class="stat__value green">${fmt(pres)}</div></div>
        <div class="stat"><div class="stat__label">Ausentes</div><div class="stat__value red">${fmt(aus)}</div></div>
        <div class="stat"><div class="stat__label">Taxa de presença</div><div class="stat__value">${pct(tx)}</div></div>
      </div>

      <div class="course-card__turmas">${rows}</div>
    </article>
  `;
}

// ================ Event detail ================

export function renderEventDetail(ev) {
  if (!ev) return "";
  const tx = taxaPresenca(ev);

  return `
    <div class="card" style="margin-bottom: var(--space-4);">
      <div class="card__header">
        <div>
          <h3>${escapeHtml(ev.title)}</h3>
          <p>
            <i class="fas fa-calendar"></i> ${formatDateBR(ev.date)}${ev.time ? " &middot; " + escapeHtml(ev.time) : ""}
            ${ev.local ? ` &middot; <i class="fas fa-location-dot"></i> ${escapeHtml(shortLocal(ev.local))}` : ""}
          </p>
        </div>
        <span class="status-badge ${
          ev.status === "agendado" ? "agendado" : tx !== null && tx < 60 ? "atencao" : "realizado"
        }">${ev.status === "agendado" ? "Agendado" : "Realizado"}</span>
      </div>

      <div class="event-card__stats" style="grid-template-columns: repeat(4, minmax(0, 1fr));">
        <div class="stat"><div class="stat__label">Inscritos</div><div class="stat__value">${fmt(ev.totalInscritos)}</div></div>
        <div class="stat"><div class="stat__label">Presentes</div><div class="stat__value green">${fmt(ev.totalPresentes)}</div></div>
        <div class="stat"><div class="stat__label">Ausentes</div><div class="stat__value red">${fmt(ev.totalAusentes)}</div></div>
        <div class="stat">
          <div class="stat__label">Taxa de presença</div>
          <div class="stat__value ${tx !== null && tx >= 80 ? "green" : tx !== null && tx < 60 ? "red" : ""}">${pct(tx)}</div>
        </div>
        <div class="stat"><div class="stat__label">Turmas</div><div class="stat__value">${Object.keys(ev.turmas || {}).length || 0}</div></div>
        <div class="stat"><div class="stat__label">Secretarias</div><div class="stat__value">${Object.keys(ev.secretarias || {}).length || 0}</div></div>
        <div class="stat"><div class="stat__label">Vagas oferecidas</div>${renderVagas(ev)}</div>
        <div class="stat"><div class="stat__label">Taxa de ocupação</div>${renderOcup(ev)}</div>
      </div>
    </div>
  `;
}

// ================ Insights ================

export function renderInsights(insights, opts = {}) {
  if (!insights.length) {
    return `<div class="empty-state"><i class="fas fa-circle-info"></i><h3>Sem insights</h3><p>Adicione dados para gerar observações automáticas.</p></div>`;
  }
  const { limit, variant = "default" } = opts;
  const list = typeof limit === "number" ? insights.slice(0, limit) : insights;
  return list.map((i) => `
    <article class="insight insight--${variant} ${i.type}">
      <div class="insight__icon"><i class="fas ${i.icon}"></i></div>
      <div class="insight__body">
        <p class="insight__title">${escapeHtml(i.title)}</p>
        <p class="insight__text">${i.html}</p>
      </div>
    </article>
  `).join("");
}

// ================ Tables ================

export function renderParticipantsTable(participantes) {
  if (!participantes.length) {
    return `<div class="empty-state"><i class="fas fa-users-slash"></i><h3>Sem participantes</h3><p>Este evento ainda não possui inscritos ou nenhum participante corresponde aos filtros.</p></div>`;
  }
  const rows = participantes.map((p) => `
    <tr>
      <td class="cell-name">${escapeHtml(p.nome || "-")}</td>
      <td class="col-hide-sm">${escapeHtml(p.email || "-")}</td>
      <td class="col-hide-md">${escapeHtml(p.turma || "-")}</td>
      <td>${escapeHtml(p.secretaria || "-")}</td>
      <td>
        <span class="cell-status ${p.presente ? "green" : "red"}">
          <i class="fas ${p.presente ? "fa-check" : "fa-xmark"}"></i>
          ${p.presente ? "Presente" : "Faltou"}
        </span>
      </td>
    </tr>
  `).join("");
  return `
    <div class="table-scroll">
      <table class="data">
        <thead>
          <tr>
            <th>Participante</th>
            <th class="col-hide-sm">E-mail</th>
            <th class="col-hide-md">Turma</th>
            <th>Secretaria</th>
            <th>Presença</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

export function renderEventsTable(eventos) {
  if (!eventos.length) {
    return `<div class="empty-state"><i class="fas fa-folder-open"></i><h3>Sem eventos</h3></div>`;
  }
  const rows = eventos.map((e) => `
    <tr>
      <td class="cell-name">${escapeHtml(e.title)}</td>
      <td class="col-hide-sm cell-num">${formatDateBR(e.date)}</td>
      <td class="cell-num">${fmt(e.totalInscritos)}</td>
      <td class="cell-num">${fmt(e.totalPresentes)}</td>
      <td class="col-hide-md cell-num">${fmt(e.totalAusentes)}</td>
      <td class="cell-num">${pct(taxaPresenca(e))}</td>
      <td class="col-hide-md cell-num">${Object.keys(e.turmas || {}).length || 0}</td>
      <td class="col-hide-md cell-num">${Object.keys(e.secretarias || {}).length || 0}</td>
      <td><span class="cell-status ${e.status === "agendado" ? "muted" : "green"}">${e.status}</span></td>
    </tr>
  `).join("");
  return `
    <div class="table-scroll">
      <table class="data">
        <thead>
          <tr>
            <th>Evento</th>
            <th class="col-hide-sm">Data</th>
            <th>Inscritos</th>
            <th>Presentes</th>
            <th class="col-hide-md">Ausentes</th>
            <th>Taxa</th>
            <th class="col-hide-md">Turmas</th>
            <th class="col-hide-md">Secret.</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

export function renderSecretariasTable(ranking) {
  if (!ranking.length) {
    return `<div class="empty-state"><i class="fas fa-building"></i><h3>Sem dados de secretarias</h3></div>`;
  }
  const total = ranking.reduce((s, r) => s + r.qtd, 0);
  const rows = ranking.map((r, i) => {
    const share = ((r.qtd / total) * 100).toFixed(1);
    return `
      <tr>
        <td class="cell-num">${i + 1}</td>
        <td class="cell-name">${escapeHtml(r.nome)}</td>
        <td class="cell-num">${fmt(r.qtd)}</td>
        <td class="cell-num">${share}%</td>
      </tr>
    `;
  }).join("");
  return `
    <div class="table-scroll">
      <table class="data">
        <thead><tr><th>#</th><th>Secretaria</th><th>Inscrições</th><th>Participação</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ================ Compare table ================

export function renderComparativeTable(comparativos) {
  if (!comparativos.length) {
    return `<div class="empty-state"><i class="fas fa-scale-balanced"></i><h3>Selecione eventos</h3><p>Escolha 2 ou mais eventos acima para iniciar a comparação.</p></div>`;
  }
  const head = `
    <thead>
      <tr>
        <th>Métrica</th>
        ${comparativos.map((c) => `<th>${escapeHtml(c.title)}</th>`).join("")}
      </tr>
    </thead>
  `;
  const row = (label, cells) => `
    <tr>
      <td class="cell-name">${label}</td>
      ${cells.map((c) => `<td>${c}</td>`).join("")}
    </tr>
  `;
  const tbody = `
    <tbody>
      ${row("Data", comparativos.map((c) => formatDateBR(c.date)))}
      ${row("Status", comparativos.map((c) => c.status))}
      ${row("Inscritos", comparativos.map((c) => fmt(c.inscritos)))}
      ${row("Presentes", comparativos.map((c) => fmt(c.presentes)))}
      ${row("Ausentes", comparativos.map((c) => fmt(c.ausentes)))}
      ${row("Taxa de presença", comparativos.map((c) => pct(c.taxaPresenca)))}
      ${row("Nº de turmas", comparativos.map((c) => Object.keys(c.turmas).length || 0))}
      ${row("Nº de secretarias", comparativos.map((c) => c.nSecretarias || 0))}
      ${row("Vagas oferecidas", comparativos.map((c) => c.vagas != null ? fmt(c.vagas) : naTooltip(OCUP_MOTIVO)))}
      ${row("Taxa de ocupação", comparativos.map((c) => c.taxaOcupacao != null ? pct(c.taxaOcupacao) : naTooltip(OCUP_MOTIVO)))}
    </tbody>
  `;
  return `<div class="table-scroll"><table class="data">${head}${tbody}</table></div>`;
}

// ================ Helpers ================

function shortLocal(loc) {
  if (!loc) return "";
  return loc.length > 70 ? loc.slice(0, 68) + "..." : loc;
}
