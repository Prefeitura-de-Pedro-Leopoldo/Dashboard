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
const renderVagas = (ev, inline = false) => {
  const v = totalVagasOuIngressos(ev);
  if (inline) return v != null ? fmt(v) : `<span class="na">${naTooltip(OCUP_MOTIVO)}</span>`;
  return v != null ? `<div class="stat__value">${fmt(v)}</div>` : `<div class="stat__value na">${naTooltip(OCUP_MOTIVO)}</div>`;
};
// Helper: renderiza taxa de ocupação
const renderOcup = (ev, inline = false) => {
  const t = taxaOcupacao(ev);
  const cls = t != null ? (t >= 90 ? "green" : t >= 50 ? "" : "red") : "na";
  if (inline) return t != null ? `<span class="${cls}">${pct(t)}</span>` : `<span class="na">${naTooltip(OCUP_MOTIVO)}</span>`;
  return t != null ? `<div class="stat__value ${cls}">${pct(t)}</div>` : `<div class="stat__value na">${naTooltip(OCUP_MOTIVO)}</div>`;
};

// ================ KPIs ================

const toneFromTaxa = (v) => {
  if (v === null || v === undefined) return "none";
  if (v >= 80) return "high";
  if (v >= 60) return "mid";
  return "low";
};

// Gauge circular SVG (raio 54, stroke 12, perímetro = 2π·54 ≈ 339.29)
function renderGauge(taxa) {
  const tone = toneFromTaxa(taxa);
  const valid = taxa !== null && taxa !== undefined;
  const pctVal = valid ? Math.max(0, Math.min(100, taxa)) : 0;
  const R = 54;
  const C = 2 * Math.PI * R;
  const offset = C - (pctVal / 100) * C;
  const center = valid
    ? `${taxa.toFixed(1).replace(".", ",")}<small>presença</small>`
    : `N/A<small>sem dados</small>`;
  return `
    <div class="kpi__gauge" role="img" aria-label="Taxa de presença ${valid ? taxa + "%" : "indisponível"}">
      <svg viewBox="0 0 132 132" aria-hidden="true">
        <circle class="kpi__gauge-track" cx="66" cy="66" r="${R}" stroke-width="12"></circle>
        <circle class="kpi__gauge-fill ${tone}" cx="66" cy="66" r="${R}" stroke-width="12"
          stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"></circle>
      </svg>
      <div class="kpi__gauge-center">${center}</div>
    </div>
  `;
}

function renderSparkline(eventos) {
  const realizados = (eventos || []).filter(
    (e) => e.status === "realizado" && (e.totalInscritos ?? 0) > 0
  );
  if (!realizados.length) return "";
  const ordenados = [...realizados].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const bars = ordenados.map((e) => {
    const t = taxaPresenca(e);
    const tone = toneFromTaxa(t);
    const h = t === null ? 6 : Math.max(6, Math.round((t / 100) * 24));
    const title = escapeHtml(e.title);
    const taxaTxt = pct(t);
    const inscritos = fmt(e.totalInscritos ?? 0);
    const presentes = fmt(e.totalPresentes ?? 0);
    const tip = `${title}&#10;${taxaTxt} • ${presentes} de ${inscritos} presentes`;
    return `<div class="kpi__spark-bar ${tone}" style="height:${h}px" data-tip="${tip}" title="${title} — ${taxaTxt}" tabindex="0"></div>`;
  }).join("");
  return `<div class="kpi__spark" aria-label="Presença por evento (ordem cronológica)">${bars}</div>`;
}

export function renderKPIs(resumo, eventos = []) {
  const vagasInfo = resumo.totalVagas
    ? `<b>${fmt(resumo.totalVagas)}</b> vagas oferecidas`
    : `Vagas não informadas`;
  const ocupTxt =
    resumo.taxaOcupacaoGlobal === null
      ? "N/A"
      : resumo.taxaOcupacaoGlobal + "<small>%</small>";
  const presFmt = fmt(resumo.totalPresentes);
  const inscFmt = fmt(resumo.totalInscritos);
  return `
    <div class="kpi kpi--hero">
      ${renderGauge(resumo.taxaPresencaGlobal)}
      <div class="kpi__body">
        <div class="kpi__label">Visão geral · Presença</div>
        <h3 class="kpi__hero-title">Taxa de presença consolidada</h3>
        <p class="kpi__hero-sub">
          <b>${presFmt}</b> presentes de <b>${inscFmt}</b> inscritos
          em <b>${resumo.eventosRealizados}</b> evento(s) realizado(s).
        </p>
        ${renderSparkline(eventos)}
      </div>
    </div>
    <div class="kpi">
      <div class="kpi__icon"><i class="fas fa-calendar-check"></i></div>
      <div class="kpi__label">Eventos</div>
      <div class="kpi__value">${resumo.totalEventos}</div>
      <div class="kpi__delta">
        <b>${resumo.eventosRealizados}</b> realizado(s) · <b>${resumo.eventosAgendados}</b> agendado(s)
      </div>
    </div>
    <div class="kpi kpi--accent">
      <div class="kpi__icon"><i class="fas fa-user-plus"></i></div>
      <div class="kpi__label">Inscritos</div>
      <div class="kpi__value">${inscFmt}</div>
      <div class="kpi__delta">${vagasInfo}</div>
    </div>
    <div class="kpi kpi--warn">
      <div class="kpi__icon"><i class="fas fa-chart-pie"></i></div>
      <div class="kpi__label">Ocupação</div>
      <div class="kpi__value">${ocupTxt}</div>
      <div class="kpi__delta">Inscritos vs vagas</div>
    </div>
  `;
}

// ================ Event card ================

export function renderEventCard(ev) {
  const tx = taxaPresenca(ev);
  const statusLabel = ev.status === "agendado" ? "Agendado" : "Realizado";
  const statusClass = ev.status === "agendado" ? "agendado" : tx !== null && tx < 60 ? "atencao" : "realizado";
  const tone = ev.status === "agendado"
    ? "scheduled"
    : tx === null ? "muted" : toneFromTaxa(tx);

  const dateLine = `${formatDateBR(ev.date)}${ev.time ? " · " + escapeHtml(ev.time) : ""}`;
  const localLine = ev.local ? escapeHtml(shortLocal(ev.local)) : "";
  const txClass = progressClass(tx);

  return `
    <article class="event-card" data-event="${ev.id}" data-tone="${tone}">
      <header class="event-card__head">
        <h3 class="event-card__title" title="${escapeHtml(ev.title)}">${escapeHtml(ev.title)}</h3>
        <div class="event-card__meta">
          <span title="${dateLine}"><i class="fas fa-calendar"></i> ${dateLine}</span>
          ${localLine ? `<span title="${localLine}"><i class="fas fa-location-dot"></i> ${localLine}</span>` : ""}
        </div>
      </header>

      <div class="event-card__hero ${txClass}">
        <div class="event-card__hero-main">
          <span class="event-card__hero-label">Taxa de presença</span>
          <span class="event-card__hero-value">${pct(tx)}</span>
        </div>
        <div class="progress">
          <div class="progress__fill ${txClass}" style="width:${tx ?? 0}%"></div>
        </div>
      </div>

      <dl class="event-card__metrics">
        <div class="metric">
          <dt>Inscritos</dt>
          <dd>${fmt(ev.totalInscritos)}</dd>
        </div>
        <div class="metric">
          <dt>Presentes</dt>
          <dd class="green">${fmt(ev.totalPresentes)}</dd>
        </div>
        <div class="metric">
          <dt>Vagas</dt>
          <dd>${renderVagas(ev, true)}</dd>
        </div>
        <div class="metric">
          <dt>Ocupação</dt>
          <dd>${renderOcup(ev, true)}</dd>
        </div>
      </dl>

      <footer class="event-card__action">
        <button class="btn btn--sm" data-action="detalhe" data-event="${ev.id}">
          <i class="fas fa-magnifying-glass-chart"></i> Analisar
        </button>
        <button class="btn btn--sm btn--primary" data-action="certificados" data-event="${ev.id}">
          <i class="fas fa-award"></i> Certificados
        </button>
      </footer>
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

  const txClass = progressClass(tx);
  return `
    <article class="event-card course-card" data-tone="${tx == null ? "muted" : toneFromTaxa(tx)}">
      <header class="event-card__head">
        <h3 class="event-card__title" title="${escapeHtml(group.grupo.titulo)}">${escapeHtml(group.grupo.titulo)}</h3>
        <div class="event-card__meta">
          <span><i class="fas fa-layer-group"></i> ${evs.length} turma(s)/módulo(s)</span>
          <span><i class="fas fa-circle-check"></i> ${realizados} realizado(s)</span>
        </div>
      </header>

      <div class="event-card__hero ${txClass}">
        <div class="event-card__hero-main">
          <span class="event-card__hero-label">Taxa de presença</span>
          <span class="event-card__hero-value">${pct(tx)}</span>
        </div>
        <div class="progress">
          <div class="progress__fill ${txClass}" style="width:${tx ?? 0}%"></div>
        </div>
      </div>

      <dl class="event-card__metrics">
        <div class="metric"><dt>Inscritos</dt><dd>${fmt(insc)}</dd></div>
        <div class="metric"><dt>Presentes</dt><dd class="green">${fmt(pres)}</dd></div>
        <div class="metric"><dt>Ausentes</dt><dd class="red">${fmt(aus)}</dd></div>
        <div class="metric"><dt>Turmas</dt><dd>${evs.length}</dd></div>
      </dl>

      <div class="course-card__turmas">${rows}</div>
    </article>
  `;
}

// ================ Event detail ================

export function renderEventDetail(ev) {
  if (!ev) return "";
  const tx = taxaPresenca(ev);
  const ocup = taxaOcupacao(ev);
  const tone = tx === null ? "muted" : toneFromTaxa(tx);
  const dateLine = `${formatDateBR(ev.date)}${ev.time ? " · " + escapeHtml(ev.time) : ""}`;
  const localLine = ev.local ? escapeHtml(shortLocal(ev.local)) : "";
  const txClass = progressClass(tx);
  const vagasVal = totalVagasOuIngressos(ev);

  const ocupCls = ocup == null ? "na" : ocup >= 90 ? "green" : ocup >= 50 ? "" : "red";
  const ocupTxt = ocup == null ? naTooltip(OCUP_MOTIVO) : pct(ocup);
  const vagasTxt = vagasVal == null ? naTooltip(OCUP_MOTIVO) : fmt(vagasVal);

  return `
    <section class="event-detail" data-tone="${tone}">
      <header class="event-detail__head">
        <div class="event-detail__title-wrap">
          <h2 class="event-detail__title" title="${escapeHtml(ev.title)}">${escapeHtml(ev.title)}</h2>
          <div class="event-detail__meta">
            <span title="${dateLine}"><i class="fas fa-calendar"></i> ${dateLine}</span>
            ${localLine ? `<span title="${localLine}"><i class="fas fa-location-dot"></i> ${localLine}</span>` : ""}
          </div>
        </div>
      </header>

      <div class="event-detail__kpis">
        <div class="kpi kpi--hero">
          ${renderGauge(tx)}
          <div class="kpi__body">
            <div class="kpi__label">Resultado do evento</div>
            <h3 class="kpi__hero-title">Taxa de presença</h3>
            <p class="kpi__hero-sub">
              <b>${fmt(ev.totalPresentes)}</b> presentes de <b>${fmt(ev.totalInscritos)}</b> inscritos.
              ${ev.totalAusentes ? `Ausentes: <b>${fmt(ev.totalAusentes)}</b>.` : ""}
            </p>
          </div>
        </div>
        <div class="kpi">
          <div class="kpi__icon"><i class="fas fa-user-plus"></i></div>
          <div class="kpi__label">Inscritos</div>
          <div class="kpi__value">${fmt(ev.totalInscritos)}</div>
          <div class="kpi__delta"><b>${fmt(ev.totalPresentes)}</b> presentes · <b>${fmt(ev.totalAusentes)}</b> ausentes</div>
        </div>
        <div class="kpi kpi--accent">
          <div class="kpi__icon"><i class="fas fa-ticket"></i></div>
          <div class="kpi__label">Vagas oferecidas</div>
          <div class="kpi__value">${vagasTxt}</div>
          <div class="kpi__delta">Capacidade total do evento</div>
        </div>
        <div class="kpi kpi--warn">
          <div class="kpi__icon"><i class="fas fa-chart-pie"></i></div>
          <div class="kpi__label">Taxa de ocupação</div>
          <div class="kpi__value ${ocupCls}">${ocupTxt}</div>
          <div class="kpi__delta">Inscritos vs vagas</div>
        </div>
      </div>

      <div class="event-detail__subs">
        <div class="event-detail__sub">
          <i class="fas fa-layer-group"></i>
          <div>
            <span class="event-detail__sub-label">Turmas</span>
            <span class="event-detail__sub-value">${Object.keys(ev.turmas || {}).length || 0}</span>
          </div>
        </div>
        <div class="event-detail__sub">
          <i class="fas fa-building-columns"></i>
          <div>
            <span class="event-detail__sub-label">Secretarias</span>
            <span class="event-detail__sub-value">${Object.keys(ev.secretarias || {}).length || 0}</span>
          </div>
        </div>
        <div class="event-detail__sub">
          <i class="fas fa-users"></i>
          <div>
            <span class="event-detail__sub-label">Participantes</span>
            <span class="event-detail__sub-value">${fmt((ev.participantes || []).length)}</span>
          </div>
        </div>
      </div>

      ${renderTurmasBreakdown(ev)}
    </section>
  `;
}

// Detalhamento por turma quando o evento é consolidado (vem de um grupo com 2+ turmas)
function renderTurmasBreakdown(ev) {
  const turmas = ev._turmas;
  if (!Array.isArray(turmas) || turmas.length < 2) return "";

  const rows = turmas.map((t) => {
    const tNum = t.grupo && (t.grupo.turma ?? null);
    const mNum = t.grupo && (t.grupo.modulo ?? null);
    const label = tNum != null ? `Turma ${tNum}` : mNum != null ? `Módulo ${mNum}` : t.title;
    const tx = taxaPresenca(t);
    const txClass = progressClass(tx);
    const ocup = taxaOcupacao(t);
    const ocupCls = ocup == null ? "na" : ocup >= 90 ? "green" : ocup >= 50 ? "" : "red";
    const vagas = totalVagasOuIngressos(t);
    return `
      <div class="turma-row">
        <div class="turma-row__head">
          <span class="turma-row__label"><i class="fas fa-users-rectangle"></i> ${escapeHtml(label)}</span>
          <span class="turma-row__date">${t.date ? formatDateBR(t.date) : ""}${t.time ? " · " + escapeHtml(t.time) : ""}</span>
        </div>
        <div class="turma-row__metrics">
          <div class="turma-metric"><span>Vagas</span><b>${vagas != null ? fmt(vagas) : "—"}</b></div>
          <div class="turma-metric"><span>Inscritos</span><b>${fmt(t.totalInscritos || 0)}</b></div>
          <div class="turma-metric"><span>Presentes</span><b class="green">${fmt(t.totalPresentes || 0)}</b></div>
          <div class="turma-metric"><span>Ausentes</span><b class="${(t.totalAusentes || 0) > 0 ? "red" : ""}">${fmt(t.totalAusentes || 0)}</b></div>
          <div class="turma-metric"><span>Ocupação</span><b class="${ocupCls}">${ocup != null ? pct(ocup) : "—"}</b></div>
          <div class="turma-metric"><span>Presença</span><b class="${txClass}">${pct(tx)}</b></div>
        </div>
        <div class="progress" aria-label="Taxa de presença">
          <div class="progress__fill ${txClass}" style="width:${tx ?? 0}%"></div>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="event-detail__turmas">
      <div class="event-detail__turmas-head">
        <h3><i class="fas fa-layer-group"></i> Detalhamento por turma</h3>
        <span class="event-detail__turmas-sub">${turmas.length} turmas neste curso</span>
      </div>
      <div class="event-detail__turmas-grid">${rows}</div>
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
        <span class="insight__title">${escapeHtml(i.title)}</span>
        <div class="insight__text">${i.html}</div>
      </div>
    </article>
  `).join("");
}

// ================ Tables ================

export function renderParticipantsTable(participantes, opts = {}) {
  if (!participantes.length) {
    return `<div class="empty-state"><i class="fas fa-users-slash"></i><h3>Sem participantes</h3><p>Este evento ainda não possui inscritos ou nenhum participante corresponde aos filtros.</p></div>`;
  }
  const { paginate = true, pageSize = 10, page = 1, scopeId = "default" } = opts;
  const total = participantes.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const slice = paginate ? participantes.slice((currentPage - 1) * pageSize, currentPage * pageSize) : participantes;

  const rows = slice.map((p) => {
    const emailValid = p.email && !/^user-anonymous/i.test(p.email);
    const emailCell = emailValid
      ? escapeHtml(p.email)
      : `<span class="cell-empty" title="E-mail não informado">—</span>`;
    return `
    <tr>
      <td class="cell-name">${escapeHtml(p.nome || "-")}</td>
      <td class="col-hide-sm">${emailCell}</td>
      <td class="col-hide-md cell-turma" title="${escapeHtml(p.turma || "")}">${escapeHtml(p.turma || "-")}</td>
      <td>${escapeHtml(p.secretaria || "-")}</td>
      <td class="col-presence">
        <span class="cell-status ${p.presente ? "green" : "red"}">
          <i class="fas ${p.presente ? "fa-check" : "fa-xmark"}"></i>
          ${p.presente ? "Presente" : "Faltou"}
        </span>
      </td>
    </tr>
  `;
  }).join("");

  const pager = paginate && totalPages > 1 ? renderPager(currentPage, totalPages, total, pageSize, scopeId) : "";

  return `
    <div class="table-scroll">
      <table class="data">
        <thead>
          <tr>
            <th>Participante</th>
            <th class="col-hide-sm">E-mail</th>
            <th class="col-hide-md">Turma</th>
            <th>Secretaria</th>
            <th class="col-presence">Presença</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${pager}
  `;
}

function renderPager(current, totalPages, total, pageSize, scopeId) {
  const from = (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);

  const btn = (page, label, opts = {}) => {
    const cls = ["pager__btn"];
    if (opts.active) cls.push("is-active");
    if (opts.disabled) cls.push("is-disabled");
    return `<button type="button" class="${cls.join(" ")}" data-pager-scope="${scopeId}" data-pager-page="${page}" ${opts.disabled ? "disabled" : ""} aria-label="${opts.aria || label}">${label}</button>`;
  };

  // Pager minimalista: ← [atual / total] →
  return `
    <div class="pager" data-pager-scope="${scopeId}">
      <span class="pager__info"><b>${from}–${to}</b> de <b>${total}</b></span>
      <div class="pager__controls">
        ${btn(current - 1, '<i class="fas fa-chevron-left"></i>', { disabled: current === 1, aria: "Página anterior" })}
        <span class="pager__current"><b>${current}</b> / ${totalPages}</span>
        ${btn(current + 1, '<i class="fas fa-chevron-right"></i>', { disabled: current === totalPages, aria: "Próxima página" })}
      </div>
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
