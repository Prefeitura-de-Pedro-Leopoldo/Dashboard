/**
 * app.js - controller principal: roteamento entre views, sidebar,
 * comparacao, filtros e tela de certificados com upload dinamico.
 */

import { loadData, getEvento } from "./data.js";
import {
  resumoGlobal,
  rankingSecretarias,
  comparativoEventos,
  taxaPresenca,
  participacaoPorSecretaria,
  distribuicaoPorTurma,
} from "./metrics.js";
import {
  barInscritosVsPresentes,
  barTaxaPresenca,
  donutPresenca,
  barSecretarias,
  pieTurmas,
  lineTimeline,
  radarComparativo,
  barGrupoComparativo,
  barGroupedByCategory,
  destroyAll,
  PALETTE,
} from "./charts.js";
import {
  fmt,
  pct,
  escapeHtml,
  formatDateBR,
  renderKPIs,
  renderEventCard,
  renderCourseCard,
  renderEventDetail,
  renderInsights,
  renderParticipantsTable,
  renderEventsTable,
  renderSecretariasTable,
  renderComparativeTable,
} from "./ui.js";
import { gerarInsightsGlobais, gerarInsightsEvento } from "./insights.js";

// ================ Auth gate ================
const session = sessionStorage.getItem("egov_admin_session");
if (!session) window.location.replace("login.html");
const userData = (() => {
  try { return JSON.parse(session); } catch { return { email: "admin", name: "Admin" }; }
})();

// ================ State ================
const state = {
  data: null,
  view: "dashboard",
  selectedEventId: null,
  compareIds: new Set(),
  reportFilters: { eventoId: "", secretaria: "", turma: "", busca: "" },
  certEventId: null,        // id da planilha do sistema selecionada (aba "Do sistema")
  certSource: "evento",     // 'evento' (planilha do sistema) ou 'planilha' (upload)
  certUploaded: null,       // dados de planilha enviada via upload
  certManifest: null,       // índice lido de relatorios/manifest.json
  certSystemCache: {},      // id -> participantes elegíveis já parseados da planilha
  certPendingArquivo: null, // arquivo a resolver quando o manifesto terminar de carregar
  templateImg: null,        // Image do modelo.png
};

const VIEW_TITLES = {
  dashboard: ["Dashboard", "Visão consolidada e análise de cada evento."],
  eventos: ["Análise por Evento", "Detalhamento operacional e demográfico."],
  comparar: ["Comparar Eventos", "Compare dois ou mais eventos lado a lado."],
  participantes: ["Participantes", "Busca e filtros sobre todos os inscritos."],
  secretarias: ["Secretarias", "Ranking e participação por pasta."],
  relatorios: ["Relatórios", "Relatórios por evento, consolidado e exportação."],
  certificados: ["Emitir Certificados", "Planilhas do sistema ou upload geram a lista de elegíveis."],
  qrcode: ["QR Code", "Gere QR Codes em alta resolução para divulgar links institucionais."],
  autoreport: ["Auto-Relatório de Satisfação", "Suba planilhas e gere o PDF no padrão institucional automaticamente."],
};

// ================ Bootstrap ================
(async function init() {
  setupSidebar();
  setupUserChrome();
  setupThemeToggle();
  setupNavigation();
  preloadTemplate();
  await reloadData();
})();

async function reloadData() {
  try {
    state.data = await loadData();
    renderAll();
  } catch (err) {
    document.getElementById("mainContent").innerHTML = `
      <div class="empty-state">
        <i class="fas fa-circle-exclamation"></i>
        <h3>Não foi possível carregar os dados</h3>
        <p>${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}

// ================ Chrome ================
function setupSidebar() {
  const shell = document.getElementById("appShell");
  document.getElementById("sidebarToggle").addEventListener("click", () => {
    if (window.matchMedia("(max-width: 768px)").matches) {
      shell.classList.toggle("is-mobile-open");
    } else {
      shell.classList.toggle("is-collapsed");
      try {
        localStorage.setItem("egov_sidebar_collapsed", shell.classList.contains("is-collapsed") ? "1" : "0");
      } catch (_) {}
    }
  });
  try {
    if (localStorage.getItem("egov_sidebar_collapsed") === "1") shell.classList.add("is-collapsed");
  } catch (_) {}
}

function setupUserChrome() {
  document.getElementById("userName").textContent = userData.name || "Administrador";
  document.getElementById("userEmail").textContent = userData.email;
  document.getElementById("avatarLetter").textContent = (userData.email || "?")[0].toUpperCase();
  document.getElementById("logoutBtn").addEventListener("click", () => {
    sessionStorage.removeItem("egov_admin_session");
    window.location.replace("login.html");
  });
  document.getElementById("refreshBtn").addEventListener("click", reloadData);
}

function setupThemeToggle() {
  const btn = document.getElementById("themeToggle");
  btn.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "light";
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("egovpl-theme", next); } catch (_) {}
    renderAll();
  });
}

function setupNavigation() {
  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      navigate(el.dataset.nav);
    });
  });
}

function navigate(view) {
  state.view = view;
  document.querySelectorAll(".nav-link").forEach((n) => n.classList.toggle("is-active", n.dataset.nav === view));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("is-active", v.id === `view-${view}`));
  const [t, s] = VIEW_TITLES[view] || ["", ""];
  document.getElementById("topbarTitle").textContent = t;
  document.getElementById("topbarSub").textContent = s;
  document.getElementById("appShell").classList.remove("is-mobile-open");
  window.scrollTo({ top: 0, behavior: "smooth" });
  renderAll();
}

// ================ Helpers de UI: Tabs internas ================
// state.viewTabs[viewName] guarda a aba ativa de cada pagina
state.viewTabs = state.viewTabs || {};

function renderTabsNav(viewKey, tabs) {
  const active = state.viewTabs[viewKey] || tabs[0].id;
  return `
    <nav class="view-tabs" role="tablist" data-view="${viewKey}">
      ${tabs.map((t) => `
        <button class="view-tab ${active === t.id ? "is-active" : ""}" data-tab="${t.id}" role="tab" aria-selected="${active === t.id}">
          ${t.icon ? `<i class="fas ${t.icon}"></i>` : ""}
          <span>${escapeHtml(t.label)}</span>
          ${t.badge != null ? `<span class="view-tab__badge">${escapeHtml(String(t.badge))}</span>` : ""}
        </button>
      `).join("")}
    </nav>
  `;
}

function wireTabs(viewKey, onSwitch) {
  const nav = document.querySelector(`.view-tabs[data-view="${viewKey}"]`);
  if (!nav) return;
  nav.querySelectorAll(".view-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.tab;
      state.viewTabs[viewKey] = id;
      onSwitch(id);
    });
  });
}

function getActiveTab(viewKey, defaultId) {
  return state.viewTabs[viewKey] || defaultId;
}

// ================ Render orchestrator ================
function renderAll() {
  destroyAll();
  if (!state.data) return;
  if (state.view === "dashboard") renderDashboard();
  else if (state.view === "eventos") renderViewEventos();
  else if (state.view === "comparar") renderViewComparar();
  else if (state.view === "participantes") renderViewParticipantes();
  else if (state.view === "secretarias") renderViewSecretarias();
  else if (state.view === "relatorios") renderViewRelatorios();
  else if (state.view === "certificados") renderViewCertificados();
  else if (state.view === "qrcode") renderViewQrCode();
  else if (state.view === "autoreport") renderViewAutoReport();
}

// ================ DASHBOARD ================
// Agrupa eventos por curso (grupo.id). Eventos sem grupo viram grupos de 1.
function agruparEventos(eventos) {
  const grupos = [];
  const porId = new Map();
  for (const ev of eventos) {
    const gid = ev.grupo && ev.grupo.id;
    if (!gid) {
      grupos.push({ grupo: null, eventos: [ev] });
      continue;
    }
    if (porId.has(gid)) {
      porId.get(gid).eventos.push(ev);
    } else {
      const g = { grupo: ev.grupo, eventos: [ev] };
      porId.set(gid, g);
      grupos.push(g);
    }
  }
  return grupos;
}

function renderDashboard() {
  const { data } = state;
  const eventos = data.eventos;
  const resumo = resumoGlobal(eventos);
  const ranking = rankingSecretarias(eventos);

  // Tabs
  document.getElementById("dashTabsHost").innerHTML = renderTabsNav("dashboard", [
    { id: "overview", label: "Visão geral", icon: "fa-gauge-high" },
    { id: "charts",   label: "Gráficos consolidados", icon: "fa-chart-line" },
  ]);
  const activeTab = getActiveTab("dashboard", "overview");
  document.querySelectorAll('#view-dashboard [data-tab-panel]').forEach((p) => {
    p.hidden = p.dataset.tabPanel !== activeTab;
  });
  wireTabs("dashboard", () => renderDashboard());

  if (activeTab === "charts") {
    // Charts globais: passamos somente realizados onde faz sentido
    const realizados = eventos.filter((e) => e.status === "realizado");
    barInscritosVsPresentes("chartGlobalBar", realizados);
    barTaxaPresenca("chartGlobalTaxa", realizados);
    barSecretarias("chartGlobalSec", ranking);
    donutPresenca("chartGlobalDonut", resumo.totalPresentes, resumo.totalAusentes);
    return;
  }

  document.getElementById("kpisGlobal").innerHTML = renderKPIs(resumo);

  // Insights particionados por severidade
  const insights = gerarInsightsGlobais(data);
  const alerts = insights.filter((i) => i.type === "danger" || i.type === "warn");
  const highlights = insights.filter((i) => i.type === "positive" || i.type === "neutral");

  const alertStrip = document.getElementById("alertStrip");
  if (alerts.length) {
    alertStrip.innerHTML = renderInsights(alerts.slice(0, 3), { variant: "alert" });
    alertStrip.hidden = false;
  } else {
    alertStrip.hidden = true;
    alertStrip.innerHTML = "";
  }

  const highlightsBlock = document.getElementById("highlightsBlock");
  const highlightsGrid = document.getElementById("highlightsGrid");
  if (highlights.length) {
    highlightsGrid.innerHTML = renderInsights(highlights, { variant: "compact", limit: 4 });
    highlightsBlock.hidden = false;
  } else {
    highlightsBlock.hidden = true;
    highlightsGrid.innerHTML = "";
  }

  // Eventos com vínculo de curso (grupo) viram um card de curso com as
  // turmas/módulos listados; os demais seguem como card de evento normal.
  const gruposEventos = agruparEventos(eventos);
  document.getElementById("eventGrid").innerHTML = gruposEventos
    .map((g) => (g.eventos.length > 1 ? renderCourseCard(g) : renderEventCard(g.eventos[0])))
    .join("");

  document.querySelectorAll(".event-card").forEach((card) =>
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-action]")) return;
      state.selectedEventId = card.dataset.event;
      navigate("eventos");
    })
  );
  document.querySelectorAll(".course-card__turma").forEach((b) =>
    b.addEventListener("click", () => {
      state.selectedEventId = b.dataset.event;
      navigate("eventos");
    })
  );
  document.querySelectorAll('[data-action="detalhe"]').forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      state.selectedEventId = b.dataset.event;
      navigate("eventos");
    })
  );
  document.querySelectorAll('[data-action="certificados"]').forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      // O card conhece o evento do eventos-data.json; a planilha correspondente
      // é resolvida pelo campo "fonte" assim que o manifesto carregar.
      const ev = getEvento(state.data, b.dataset.event);
      state.certPendingArquivo = ev ? ev.fonte : null;
      state.certSource = "evento";
      navigate("certificados");
    })
  );
}

// ================ ANÁLISE POR EVENTO ================
function renderViewEventos() {
  const { data } = state;
  const eventos = data.eventos;
  if (!state.selectedEventId && eventos.length) state.selectedEventId = eventos[0].id;
  const ev = getEvento(data, state.selectedEventId);

  const view = document.getElementById("view-eventos");
  view.innerHTML = `
    <div class="filters">
      <div class="filter">
        <label for="evSelect">Selecionar evento</label>
        <select id="evSelect">
          ${eventos.map((e) => `<option value="${e.id}" ${e.id === state.selectedEventId ? "selected" : ""}>${escapeHtml(e.title)} ${e.date ? "(" + formatDateBR(e.date) + ")" : ""}</option>`).join("")}
        </select>
      </div>
    </div>
    <div id="eventDetailBlock"></div>
  `;
  document.getElementById("evSelect").addEventListener("change", (e) => {
    state.selectedEventId = e.target.value;
    renderViewEventos();
  });
  if (ev) renderEventBlock(ev);
}

function renderEventBlock(ev) {
  const block = document.getElementById("eventDetailBlock");
  const tabsKey = "eventos";
  const active = getActiveTab(tabsKey, "resumo");

  block.innerHTML = `
    ${renderEventDetail(ev)}
    ${renderTabsNav(tabsKey, [
      { id: "resumo",        label: "Resumo & Insights",  icon: "fa-circle-info" },
      { id: "distribuicoes", label: "Distribuições",      icon: "fa-chart-pie" },
      { id: "participantes", label: "Participantes",      icon: "fa-users", badge: ev.participantes.length },
    ])}

    <div class="view-tabs__panel" data-tab-panel="resumo" ${active === "resumo" ? "" : "hidden"}>
      <div class="card">
        <div class="card__header"><div><h3>Observações automáticas</h3><p>Insights deste evento.</p></div></div>
        <div class="insights-grid" style="grid-template-columns:1fr;" id="evInsights"></div>
      </div>
    </div>

    <div class="view-tabs__panel" data-tab-panel="distribuicoes" ${active === "distribuicoes" ? "" : "hidden"}>
      <div class="grid-3">
        <div class="card">
          <div class="card__header"><div><h3>Presença</h3><p>Compareceram vs Faltaram.</p></div></div>
          <div class="chart-wrap"><canvas id="chartEvDonut"></canvas></div>
        </div>
        <div class="card">
          <div class="card__header"><div><h3>Distribuição por turma</h3><p>Por tipo de ingresso.</p></div></div>
          <div class="chart-wrap"><canvas id="chartEvTurmas"></canvas></div>
        </div>
        <div class="card">
          <div class="card__header"><div><h3>Top secretarias</h3><p>Inscritos por secretaria.</p></div></div>
          <div class="chart-wrap"><canvas id="chartEvSec"></canvas></div>
        </div>
      </div>
      <div class="card">
        <div class="card__header"><div><h3>Curva de inscrições</h3><p>Inscrições por dia até o evento.</p></div></div>
        <div class="chart-wrap"><canvas id="chartEvTimeline"></canvas></div>
      </div>
    </div>

    <div class="view-tabs__panel" data-tab-panel="participantes" ${active === "participantes" ? "" : "hidden"}>
      <div class="table-wrap">
        <div class="table-wrap__head">
          <h3><i class="fas fa-users"></i> Participantes deste evento</h3>
          <span class="card__header-meta">${ev.participantes.length} pessoa(s)</span>
        </div>
        ${renderParticipantsTable(ev.participantes)}
      </div>
    </div>
  `;

  wireTabs(tabsKey, () => renderEventBlock(ev));

  if (active === "resumo") {
    document.getElementById("evInsights").innerHTML = renderInsights(gerarInsightsEvento(ev));
  } else if (active === "distribuicoes") {
    donutPresenca("chartEvDonut", ev.totalPresentes, ev.totalAusentes);
    pieTurmas("chartEvTurmas", distribuicaoPorTurma(ev));
    barSecretarias("chartEvSec", participacaoPorSecretaria(ev).sort((a, b) => b.qtd - a.qtd));
    lineTimeline("chartEvTimeline", ev.timelineInscricoes || [], "Inscrições no dia");
  }
}

// ================ COMPARAR ================
function renderViewComparar() {
  const { data } = state;
  const compareItems = data.eventos
    .map((e) => {
      const checked = state.compareIds.has(e.id);
      return `
        <label class="checkbox ${checked ? "is-checked" : ""}">
          <input type="checkbox" value="${e.id}" ${checked ? "checked" : ""} />
          <span class="checkbox__label">${escapeHtml(e.title)}</span>
        </label>
      `;
    })
    .join("");

  const view = document.getElementById("view-comparar");
  view.innerHTML = `
    <div class="compare-bar">
      <span class="compare-bar__label"><i class="fas fa-scale-balanced"></i> Eventos:</span>
      ${compareItems}
      <button class="btn btn--sm" id="compareClear"><i class="fas fa-rotate-left"></i> Limpar</button>
    </div>
    <div id="compareContent"></div>
  `;

  view.querySelectorAll(".checkbox input").forEach((input) =>
    input.addEventListener("change", () => {
      if (input.checked) state.compareIds.add(input.value);
      else state.compareIds.delete(input.value);
      renderViewComparar();
    })
  );
  document.getElementById("compareClear").addEventListener("click", () => {
    state.compareIds.clear();
    renderViewComparar();
  });
  renderCompareContent();
}

function renderCompareContent() {
  const ids = [...state.compareIds];
  const selected = state.data.eventos.filter((e) => ids.includes(e.id));
  const target = document.getElementById("compareContent");

  if (selected.length < 2) {
    target.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-scale-balanced"></i>
        <h3>Selecione 2 ou mais eventos</h3>
        <p>A comparação ficará disponível ao marcar pelo menos dois eventos acima.</p>
      </div>`;
    return;
  }

  const comparativos = comparativoEventos(selected);
  const allSecs = new Set();
  selected.forEach((e) => Object.keys(e.secretarias || {}).forEach((s) => allSecs.add(s)));
  const secLabels = [...allSecs];
  const allTurmas = new Set();
  selected.forEach((e) => Object.keys(e.turmas || {}).forEach((t) => allTurmas.add(t)));
  const turmaLabels = [...allTurmas];

  target.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="card__header"><div><h3>Volume comparado</h3><p>Inscritos, presentes e ausentes.</p></div></div>
        <div class="chart-wrap lg"><canvas id="cmpBar"></canvas></div>
      </div>
      <div class="card">
        <div class="card__header"><div><h3>Perfil relativo</h3><p>Métricas normalizadas em radar.</p></div></div>
        <div class="chart-wrap lg"><canvas id="cmpRadar"></canvas></div>
      </div>
    </div>

    ${secLabels.length || turmaLabels.length ? `
      <div class="grid-2">
        ${secLabels.length ? `
          <div class="card">
            <div class="card__header"><div><h3>Por secretaria</h3><p>Inscrições por secretaria em cada evento.</p></div></div>
            <div class="chart-wrap lg"><canvas id="cmpSec"></canvas></div>
          </div>` : ""}
        ${turmaLabels.length ? `
          <div class="card">
            <div class="card__header"><div><h3>Por turma</h3><p>Distribuição por turma.</p></div></div>
            <div class="chart-wrap lg"><canvas id="cmpTurma"></canvas></div>
          </div>` : ""}
      </div>` : ""}

    <div class="table-wrap">
      <div class="table-wrap__head">
        <h3><i class="fas fa-table"></i> Quadro comparativo</h3>
        <span class="card__header-meta">${selected.length} eventos</span>
      </div>
      ${renderComparativeTable(comparativos)}
    </div>
  `;

  barGrupoComparativo("cmpBar", comparativos);
  radarComparativo("cmpRadar", comparativos);

  if (secLabels.length) {
    const datasets = selected.map((e, i) => ({
      label: e.title.length > 22 ? e.title.slice(0, 20) + "..." : e.title,
      data: secLabels.map((s) => (e.secretarias || {})[s] || 0),
      backgroundColor: PALETTE.series[i % PALETTE.series.length],
      maxBarThickness: 22,
    }));
    barGroupedByCategory("cmpSec", secLabels, datasets, { indexAxis: "y" });
  }
  if (turmaLabels.length) {
    const datasets = selected.map((e, i) => ({
      label: e.title.length > 22 ? e.title.slice(0, 20) + "..." : e.title,
      data: turmaLabels.map((t) => (e.turmas || {})[t] || 0),
      backgroundColor: PALETTE.series[i % PALETTE.series.length],
      maxBarThickness: 32,
    }));
    barGroupedByCategory("cmpTurma", turmaLabels, datasets, { indexAxis: "x" });
  }
}

// ================ PARTICIPANTES ================
function renderViewParticipantes() {
  const { data } = state;
  const activeTab = getActiveTab("participantes", "todos");
  const faltasCount = computeFaltasRecorrentes(data, state.faltasWindow || 3).length;

  const view = document.getElementById("view-participantes");
  view.innerHTML = `
    ${renderTabsNav("participantes", [
      { id: "todos",   label: "Todos os participantes", icon: "fa-users" },
      { id: "faltas",  label: "Faltas recorrentes",     icon: "fa-user-xmark", badge: faltasCount },
    ])}
    <div id="participantesPanel"></div>
  `;
  wireTabs("participantes", () => renderViewParticipantes());

  if (activeTab === "faltas") renderFaltasRecorrentes();
  else renderParticipantesTodos();
}

function renderParticipantesTodos() {
  const { data } = state;
  const allSecs = [...new Set(data.eventos.flatMap((e) => Object.keys(e.secretarias || {})))].sort();
  const allTurmas = [...new Set(data.eventos.flatMap((e) => Object.keys(e.turmas || {})))].sort();
  const f = state.reportFilters;

  document.getElementById("participantesPanel").innerHTML = `
    <div class="filters">
      <div class="filter">
        <label for="pEvento">Evento</label>
        <select id="pEvento">
          <option value="">Todos os eventos</option>
          ${data.eventos.map((e) => `<option value="${e.id}" ${f.eventoId === e.id ? "selected" : ""}>${escapeHtml(e.title)}</option>`).join("")}
        </select>
      </div>
      <div class="filter">
        <label for="pSec">Secretaria</label>
        <select id="pSec">
          <option value="">Todas</option>
          ${allSecs.map((s) => `<option ${f.secretaria === s ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")}
        </select>
      </div>
      <div class="filter">
        <label for="pTurma">Turma</label>
        <select id="pTurma">
          <option value="">Todas</option>
          ${allTurmas.map((t) => `<option ${f.turma === t ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}
        </select>
      </div>
      <div class="filter">
        <label for="pBusca">Buscar</label>
        <input type="search" id="pBusca" placeholder="nome ou e-mail" value="${escapeHtml(f.busca)}" />
      </div>
    </div>

    <div class="table-wrap">
      <div class="table-wrap__head">
        <h3><i class="fas fa-users"></i> Participantes</h3>
        <span class="card__header-meta" id="pCount">0</span>
      </div>
      <div id="pTable"></div>
    </div>
  `;

  const apply = () => {
    state.reportFilters = {
      eventoId: document.getElementById("pEvento").value,
      secretaria: document.getElementById("pSec").value,
      turma: document.getElementById("pTurma").value,
      busca: document.getElementById("pBusca").value,
    };
    populateParticipantes();
  };
  ["pEvento", "pSec", "pTurma"].forEach((id) => document.getElementById(id).addEventListener("change", apply));
  document.getElementById("pBusca").addEventListener("input", apply);
  populateParticipantes();
}

// ---------------- Faltas recorrentes ----------------
function computeFaltasRecorrentes(data, months) {
  // Janela: ultimos N meses a partir da data do evento mais recente (ou hoje)
  const eventDates = data.eventos
    .map((e) => e.date)
    .filter(Boolean)
    .sort();
  const ref = eventDates.length ? new Date(eventDates[eventDates.length - 1]) : new Date();
  const cutoff = new Date(ref);
  cutoff.setMonth(cutoff.getMonth() - months);

  // Agrupa por chave (email normalizado; fallback no nome lowercase)
  const groups = new Map();
  data.eventos.forEach((ev) => {
    if (!ev.date) return;
    const evDate = new Date(ev.date);
    if (evDate < cutoff || evDate > ref) return;
    (ev.participantes || []).forEach((p) => {
      const key = (p.email || "").toLowerCase().trim() ||
                  `n:${(p.nome || "").toLowerCase().trim()}`;
      if (!groups.has(key)) {
        groups.set(key, {
          nome: p.nome,
          email: p.email || "",
          secretaria: p.secretaria || "",
          inscricoes: 0,
          faltas: 0,
          presencas: 0,
          eventos: [],
        });
      }
      const g = groups.get(key);
      g.inscricoes += 1;
      if (p.presente) g.presencas += 1;
      else g.faltas += 1;
      g.eventos.push({ titulo: ev.title, data: ev.date, presente: p.presente });
      // Mantem nome/secretaria mais recente caso varie
      if (p.nome && !g.nome) g.nome = p.nome;
      if (p.secretaria && !g.secretaria) g.secretaria = p.secretaria;
    });
  });

  // Apenas quem comprou ingresso e faltou ao menos uma vez
  return [...groups.values()]
    .filter((g) => g.faltas >= 1)
    .map((g) => ({
      ...g,
      taxaAbsenteismo: Math.round((g.faltas / g.inscricoes) * 100),
    }))
    .sort((a, b) => b.faltas - a.faltas || b.taxaAbsenteismo - a.taxaAbsenteismo);
}

function renderFaltasRecorrentes() {
  const months = state.faltasWindow || 3;
  const onlyMultiple = state.faltasOnlyMultiple !== false; // default true

  const panel = document.getElementById("participantesPanel");
  panel.innerHTML = `
    <div class="filters">
      <div class="filter">
        <label>Janela de tempo</label>
        <div class="pill-group" role="tablist">
          ${[1, 2, 3].map((m) => `
            <button class="pill ${months === m ? "is-active" : ""}" data-window="${m}">
              <i class="fas fa-calendar"></i> ${m} ${m === 1 ? "mês" : "meses"}
            </button>
          `).join("")}
        </div>
      </div>
      <div class="filter">
        <label for="faltasOnlyMulti" style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input type="checkbox" id="faltasOnlyMulti" ${onlyMultiple ? "checked" : ""} />
          <span>Apenas com 2+ faltas</span>
        </label>
      </div>
      <div class="filter">
        <label for="faltasBusca">Buscar</label>
        <input type="search" id="faltasBusca" placeholder="nome, e-mail ou secretaria" value="${escapeHtml(state.faltasBusca || "")}" />
      </div>
    </div>

    <div class="table-wrap">
      <div class="table-wrap__head">
        <h3><i class="fas fa-user-xmark"></i> Faltas recorrentes</h3>
        <span class="card__header-meta" id="faltasCount">0</span>
      </div>
      <div id="faltasTable"></div>
    </div>
  `;

  panel.querySelectorAll(".pill").forEach((b) =>
    b.addEventListener("click", () => {
      state.faltasWindow = parseInt(b.dataset.window, 10);
      renderFaltasRecorrentes();
    })
  );
  document.getElementById("faltasOnlyMulti").addEventListener("change", (e) => {
    state.faltasOnlyMultiple = e.target.checked;
    populateFaltasTable();
  });
  document.getElementById("faltasBusca").addEventListener("input", (e) => {
    state.faltasBusca = e.target.value;
    populateFaltasTable();
  });
  populateFaltasTable();
}

function populateFaltasTable() {
  const months = state.faltasWindow || 3;
  const onlyMultiple = state.faltasOnlyMultiple !== false;
  const busca = (state.faltasBusca || "").toLowerCase();
  let rows = computeFaltasRecorrentes(state.data, months);
  if (onlyMultiple) rows = rows.filter((r) => r.faltas >= 2);
  if (busca) {
    rows = rows.filter((r) =>
      (r.nome || "").toLowerCase().includes(busca) ||
      (r.email || "").toLowerCase().includes(busca) ||
      (r.secretaria || "").toLowerCase().includes(busca)
    );
  }

  document.getElementById("faltasCount").textContent = `${rows.length} pessoa(s)`;

  if (!rows.length) {
    document.getElementById("faltasTable").innerHTML = `
      <div class="empty-state">
        <i class="fas fa-circle-check"></i>
        <h3>Sem faltas recorrentes na janela</h3>
        <p>Nenhum participante com faltas dentro de ${months} ${months === 1 ? "mês" : "meses"}.</p>
      </div>
    `;
    return;
  }

  const html = `
    <div class="table-scroll">
      <table class="data">
        <thead>
          <tr>
            <th>Participante</th>
            <th class="col-hide-sm">E-mail</th>
            <th>Secretaria</th>
            <th style="text-align:center;">Inscrições</th>
            <th style="text-align:center;">Faltas</th>
            <th style="text-align:center;">Presenças</th>
            <th style="text-align:right;">Absenteísmo</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td class="cell-name">${escapeHtml(r.nome || "—")}</td>
              <td class="col-hide-sm">${escapeHtml(r.email || "—")}</td>
              <td>${escapeHtml(r.secretaria || "—")}</td>
              <td style="text-align:center;">${r.inscricoes}</td>
              <td style="text-align:center;"><span class="cell-status ${r.faltas >= 2 ? "red" : "amber"}">${r.faltas}</span></td>
              <td style="text-align:center;">${r.presencas}</td>
              <td style="text-align:right; font-weight:600;">${r.taxaAbsenteismo}%</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
  document.getElementById("faltasTable").innerHTML = html;
}

function populateParticipantes() {
  const parts = collectParticipantes();
  document.getElementById("pTable").innerHTML = renderParticipantsTable(parts);
  document.getElementById("pCount").textContent = `${parts.length} pessoa(s)`;
}

function collectParticipantes() {
  const f = state.reportFilters;
  let evs = state.data.eventos;
  if (f.eventoId) evs = evs.filter((e) => e.id === f.eventoId);
  const out = [];
  const busca = (f.busca || "").toLowerCase();
  evs.forEach((e) => {
    e.participantes.forEach((p) => {
      if (f.secretaria && p.secretaria !== f.secretaria) return;
      if (f.turma && p.turma !== f.turma) return;
      if (busca && !(`${p.nome} ${p.email || ""}`.toLowerCase().includes(busca))) return;
      out.push({ ...p, eventoTitle: e.title, eventoId: e.id });
    });
  });
  return out;
}

// ================ SECRETARIAS ================
function renderViewSecretarias() {
  const { data } = state;
  const ranking = rankingSecretarias(data.eventos);

  const view = document.getElementById("view-secretarias");
  view.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi">
        <div class="kpi__icon"><i class="fas fa-building"></i></div>
        <div class="kpi__label">Secretarias</div>
        <div class="kpi__value">${ranking.length}</div>
        <div class="kpi__delta">Com participação registrada</div>
      </div>
      <div class="kpi kpi--accent">
        <div class="kpi__icon"><i class="fas fa-medal"></i></div>
        <div class="kpi__label">Líder</div>
        <div class="kpi__value" style="font-size:1.1rem">${escapeHtml(ranking[0]?.nome || "N/A")}</div>
        <div class="kpi__delta">${fmt(ranking[0]?.qtd || 0)} inscrições</div>
      </div>
      <div class="kpi kpi--warn">
        <div class="kpi__icon"><i class="fas fa-chart-pie"></i></div>
        <div class="kpi__label">Concentração no topo</div>
        <div class="kpi__value">${ranking[0] ? Math.round((ranking[0].qtd / ranking.reduce((s, r) => s + r.qtd, 0)) * 100) + "%" : "N/A"}</div>
        <div class="kpi__delta">Participação da secretaria líder</div>
      </div>
      <div class="kpi kpi--danger">
        <div class="kpi__icon"><i class="fas fa-arrow-down-9-1"></i></div>
        <div class="kpi__label">Menor adesão</div>
        <div class="kpi__value" style="font-size:1.1rem">${escapeHtml(ranking[ranking.length - 1]?.nome || "N/A")}</div>
        <div class="kpi__delta">${fmt(ranking[ranking.length - 1]?.qtd || 0)} inscrições</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card__header"><div><h3>Distribuição global</h3><p>Inscrições por secretaria (todos os eventos).</p></div></div>
        <div class="chart-wrap lg"><canvas id="secChart"></canvas></div>
      </div>
      <div class="table-wrap" style="margin-bottom:0;">
        <div class="table-wrap__head">
          <h3><i class="fas fa-list-ol"></i> Ranking detalhado</h3>
          <span class="card__header-meta">${ranking.length} secretaria(s)</span>
        </div>
        ${renderSecretariasTable(ranking)}
      </div>
    </div>
  `;
  barSecretarias("secChart", ranking, { limit: 15 });
}

// ================ RELATÓRIOS ================
function renderViewRelatorios() {
  const { data } = state;
  const f = state.reportFilters;
  const allSecs = [...new Set(data.eventos.flatMap((e) => Object.keys(e.secretarias || {})))].sort();

  const view = document.getElementById("view-relatorios");
  view.innerHTML = `
    <div class="filters">
      <div class="filter">
        <label for="rEvento">Evento</label>
        <select id="rEvento">
          <option value="">Todos</option>
          ${data.eventos.map((e) => `<option value="${e.id}" ${f.eventoId === e.id ? "selected" : ""}>${escapeHtml(e.title)}</option>`).join("")}
        </select>
      </div>
      <div class="filter">
        <label for="rSec">Secretaria</label>
        <select id="rSec">
          <option value="">Todas</option>
          ${allSecs.map((s) => `<option ${f.secretaria === s ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")}
        </select>
      </div>
      <div class="filters__actions">
        <button class="btn btn--sm" id="rClear"><i class="fas fa-rotate-left"></i> Limpar</button>
        <button class="btn btn--sm" id="rCsv"><i class="fas fa-file-csv"></i> CSV</button>
        <button class="btn btn--sm" id="rPdf"><i class="fas fa-file-pdf"></i> PDF</button>
        <button class="btn btn--sm" id="rXlsx"><i class="fas fa-file-excel"></i> Excel</button>
      </div>
    </div>

    ${renderTabsNav("relatorios", [
      { id: "eventos",       label: "Eventos",       icon: "fa-calendar-day" },
      { id: "secretarias",   label: "Secretarias",   icon: "fa-building-columns" },
      { id: "participantes", label: "Participantes", icon: "fa-users" },
    ])}

    <div class="view-tabs__panel" data-tab-panel="eventos">
      <div class="table-wrap">
        <div class="table-wrap__head">
          <h3><i class="fas fa-table-list"></i> Quadro consolidado de eventos</h3>
          <span class="card__header-meta" id="rEvCount">0</span>
        </div>
        <div id="rEvTable"></div>
      </div>
    </div>

    <div class="view-tabs__panel" data-tab-panel="secretarias" hidden>
      <div class="table-wrap">
        <div class="table-wrap__head">
          <h3><i class="fas fa-building-columns"></i> Ranking de secretarias</h3>
          <span class="card__header-meta" id="rSecCount">0</span>
        </div>
        <div id="rSecTable"></div>
      </div>
    </div>

    <div class="view-tabs__panel" data-tab-panel="participantes" hidden>
      <div class="table-wrap">
        <div class="table-wrap__head">
          <h3><i class="fas fa-users"></i> Participantes</h3>
          <span class="card__header-meta" id="rPartCount">0</span>
        </div>
        <div id="rPartTable"></div>
      </div>
    </div>
  `;

  const apply = () => {
    state.reportFilters = {
      eventoId: document.getElementById("rEvento").value,
      secretaria: document.getElementById("rSec").value,
      turma: "",
      busca: "",
    };
    populateRelatorios();
  };
  ["rEvento", "rSec"].forEach((id) => document.getElementById(id).addEventListener("change", apply));
  document.getElementById("rClear").addEventListener("click", () => {
    state.reportFilters = { eventoId: "", secretaria: "", turma: "", busca: "" };
    renderViewRelatorios();
  });
  document.getElementById("rCsv").addEventListener("click", exportCsv);
  document.getElementById("rPdf").addEventListener("click", exportPdf);
  document.getElementById("rXlsx").addEventListener("click", exportXlsx);

  // Aba ativa
  const activeTab = getActiveTab("relatorios", "eventos");
  document.querySelectorAll('#view-relatorios [data-tab-panel]').forEach((p) => {
    p.hidden = p.dataset.tabPanel !== activeTab;
  });
  wireTabs("relatorios", () => renderViewRelatorios());

  populateRelatorios();
}

function populateRelatorios() {
  const f = state.reportFilters;
  let evs = state.data.eventos;
  if (f.eventoId) evs = evs.filter((e) => e.id === f.eventoId);

  document.getElementById("rEvTable").innerHTML = renderEventsTable(evs);
  document.getElementById("rEvCount").textContent = `${evs.length} evento(s)`;

  const secAgg = {};
  evs.forEach((e) => {
    Object.entries(e.secretarias || {}).forEach(([k, v]) => {
      if (f.secretaria && k !== f.secretaria) return;
      secAgg[k] = (secAgg[k] || 0) + v;
    });
  });
  const ranking = Object.entries(secAgg).map(([nome, qtd]) => ({ nome, qtd })).sort((a, b) => b.qtd - a.qtd);
  document.getElementById("rSecTable").innerHTML = renderSecretariasTable(ranking);
  document.getElementById("rSecCount").textContent = `${ranking.length} secretaria(s)`;

  const parts = collectParticipantes();
  document.getElementById("rPartTable").innerHTML = renderParticipantsTable(parts);
  document.getElementById("rPartCount").textContent = `${parts.length} pessoa(s)`;
}

function getReportDatasets() {
  const f = state.reportFilters;
  let evs = state.data.eventos;
  if (f.eventoId) evs = evs.filter((e) => e.id === f.eventoId);

  const secAgg = {};
  evs.forEach((e) => {
    Object.entries(e.secretarias || {}).forEach(([k, v]) => {
      if (f.secretaria && k !== f.secretaria) return;
      secAgg[k] = (secAgg[k] || 0) + v;
    });
  });
  const ranking = Object.entries(secAgg).map(([nome, qtd]) => ({ nome, qtd })).sort((a, b) => b.qtd - a.qtd);
  const parts = collectParticipantes();
  return { evs, ranking, parts };
}

function exportCsv() {
  const { parts } = getReportDatasets();
  if (!parts.length) {
    alert("Nenhum participante para exportar com os filtros atuais.");
    return;
  }
  const rows = [
    ["Evento", "Nome", "E-mail", "Turma", "Secretaria", "Presente", "Data Check-in"],
    ...parts.map((p) => [
      p.eventoTitle, p.nome, p.email || "", p.turma || "",
      p.secretaria || "", p.presente ? "Sim" : "Não", p.dataCheckin || "",
    ]),
  ];
  const csv = rows.map((r) => r.map((c) => {
    const s = String(c ?? "").replace(/"/g, '""');
    return /[",;\n]/.test(s) ? `"${s}"` : s;
  }).join(";")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, `relatorio-participantes-${new Date().toISOString().slice(0, 10)}.csv`);
}

function exportXlsx() {
  const { evs, ranking, parts } = getReportDatasets();
  if (!evs.length && !ranking.length && !parts.length) {
    alert("Nada para exportar com os filtros atuais.");
    return;
  }
  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();

  const eventsSheet = XLSX.utils.aoa_to_sheet([
    ["Evento", "Data", "Local", "Vagas", "Inscritos", "Presentes", "Ausentes", "Taxa de presença (%)", "Taxa de ocupação (%)", "Status"],
    ...evs.map((e) => [
      e.title, e.date || "", e.local || "", e.vagas ?? "", e.totalInscritos,
      e.totalPresentes, e.totalAusentes, e.taxaPresenca ?? "",
      e.taxaOcupacao ?? "", e.status,
    ]),
  ]);
  XLSX.utils.book_append_sheet(wb, eventsSheet, "Eventos");

  const secSheet = XLSX.utils.aoa_to_sheet([
    ["#", "Secretaria", "Inscrições"],
    ...ranking.map((r, i) => [i + 1, r.nome, r.qtd]),
  ]);
  XLSX.utils.book_append_sheet(wb, secSheet, "Secretarias");

  const partsSheet = XLSX.utils.aoa_to_sheet([
    ["Evento", "Nome", "E-mail", "Turma", "Secretaria", "Cargo", "Matrícula", "Presente", "Data Check-in", "Data Inscrição"],
    ...parts.map((p) => [
      p.eventoTitle, p.nome, p.email || "", p.turma || "", p.secretaria || "",
      p.cargo || "", p.matricula || "", p.presente ? "Sim" : "Não",
      p.dataCheckin || "", p.dataInscricao || "",
    ]),
  ]);
  XLSX.utils.book_append_sheet(wb, partsSheet, "Participantes");

  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], { type: "application/octet-stream" });
  triggerDownload(blob, `relatorio-egov-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function exportPdf() {
  const { evs, ranking, parts } = getReportDatasets();
  if (!evs.length && !ranking.length && !parts.length) {
    alert("Nada para exportar com os filtros atuais.");
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();

  // Cabeçalho institucional
  doc.setFillColor(22, 31, 54); // var(--blue-900)
  doc.rect(0, 0, pageW, 28, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Escola de Governo · Pedro Leopoldo", 14, 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Relatório consolidado de eventos e participação", 14, 19);
  doc.setFontSize(8);
  doc.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, 14, 24);

  doc.setTextColor(22, 31, 54);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("Quadro consolidado de eventos", 14, 38);

  doc.autoTable({
    startY: 42,
    head: [["Evento", "Data", "Vagas", "Inscr.", "Pres.", "Ausentes", "Presença", "Ocupação"]],
    body: evs.map((e) => [
      e.title.length > 38 ? e.title.slice(0, 36) + "…" : e.title,
      e.date ? new Date(e.date).toLocaleDateString("pt-BR") : "—",
      e.vagas ?? "—",
      e.totalInscritos,
      e.totalPresentes,
      e.totalAusentes,
      e.taxaPresenca != null ? e.taxaPresenca + "%" : "—",
      e.taxaOcupacao != null ? e.taxaOcupacao + "%" : "—",
    ]),
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [48, 99, 173], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 247, 250] },
  });

  let y = doc.lastAutoTable.finalY + 10;
  if (y > 240) { doc.addPage(); y = 20; }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Ranking de secretarias", 14, y);
  doc.autoTable({
    startY: y + 4,
    head: [["#", "Secretaria", "Inscrições"]],
    body: ranking.slice(0, 25).map((r, i) => [i + 1, r.nome, r.qtd]),
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [77, 173, 51], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 247, 250] },
  });

  if (parts.length) {
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(`Participantes (${parts.length})`, 14, 20);
    doc.autoTable({
      startY: 24,
      head: [["Evento", "Nome", "Secretaria", "Turma", "Presente"]],
      body: parts.map((p) => [
        p.eventoTitle.length > 26 ? p.eventoTitle.slice(0, 24) + "…" : p.eventoTitle,
        p.nome,
        p.secretaria || "—",
        p.turma || "—",
        p.presente ? "Sim" : "Não",
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [48, 99, 173], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
    });
  }

  // Rodapé com paginação
  const total = doc.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Página ${i} de ${total}`, pageW - 14, 290, { align: "right" });
    doc.text("EGov-PL · Painel Administrativo", 14, 290);
  }

  doc.save(`relatorio-egov-${new Date().toISOString().slice(0, 10)}.pdf`);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ================ QR CODE ================
function renderViewQrCode() {
  const view = document.getElementById("view-qrcode");
  view.innerHTML = `
    <div class="qr-layout">
      <div class="card qr-form-card">
        <div class="card__header">
          <div>
            <h3><i class="fas fa-qrcode" style="color:var(--brand-primary)"></i> Gerador de QR Code</h3>
            <p>Insira uma URL ou texto. Geração em <b>2000 × 2000 px</b>.</p>
          </div>
        </div>

        <div class="filter">
          <label for="qrUrl">URL ou texto</label>
          <input type="text" id="qrUrl" placeholder="https://escoladegoverno.pedroleopoldo.mg.gov.br" value="" />
        </div>

        <div class="filter">
          <label for="qrBg">Cor de fundo</label>
          <input type="color" id="qrBg" value="#ffffff" />
        </div>

        <div class="qr-actions">
          <button class="btn btn--accent btn--lg" id="qrCreate">
            <i class="fas fa-bolt"></i> Create QR Code
          </button>
          <button class="btn btn--lg" id="qrDownload" disabled>
            <i class="fas fa-download"></i> Download PNG
          </button>
        </div>

        <div id="qrFeedback" class="qr-feedback" hidden></div>
      </div>

      <div class="card qr-preview-card">
        <div class="card__header">
          <div>
            <h3>Pré-visualização</h3>
            <p>Pronto para impressão em alta resolução.</p>
          </div>
        </div>
        <div class="qr-canvas-frame" id="qrFrame">
          <div class="qr-placeholder" id="qrPlaceholder">
            <i class="fas fa-qrcode"></i>
            <p>Clique em <b>Create QR Code</b> para gerar.</p>
          </div>
          <canvas id="qrCanvas" width="2000" height="2000" hidden></canvas>
        </div>
      </div>
    </div>
  `;

  document.getElementById("qrCreate").addEventListener("click", generateQrCode);
  document.getElementById("qrDownload").addEventListener("click", downloadQrCode);
  document.getElementById("qrUrl").addEventListener("keydown", (e) => {
    if (e.key === "Enter") generateQrCode();
  });
}

function generateQrCode() {
  const url = document.getElementById("qrUrl").value.trim();
  const ecl = "H";          // fixo: melhor correção de erro
  const color = "#000000";  // fixo: preto
  const bg = document.getElementById("qrBg").value;
  const feedback = document.getElementById("qrFeedback");

  if (!url) {
    feedback.hidden = false;
    feedback.className = "qr-feedback is-error";
    feedback.innerHTML = '<i class="fas fa-circle-exclamation"></i> Informe uma URL ou texto.';
    return;
  }
  if (!window.QRCode) {
    feedback.hidden = false;
    feedback.className = "qr-feedback is-error";
    feedback.innerHTML = '<i class="fas fa-circle-exclamation"></i> Biblioteca QR não carregou. Recarregue a página.';
    return;
  }

  // qrcodejs renderiza num <div>; usamos um container temporário 1000x1000
  // e depois copiamos para o canvas 2000x2000 com nitidez.
  const tmp = document.createElement("div");
  tmp.style.position = "fixed";
  tmp.style.left = "-9999px";
  document.body.appendChild(tmp);

  const eclMap = {
    L: window.QRCode.CorrectLevel.L,
    M: window.QRCode.CorrectLevel.M,
    Q: window.QRCode.CorrectLevel.Q,
    H: window.QRCode.CorrectLevel.H,
  };
  new window.QRCode(tmp, {
    text: url,
    width: 1000,
    height: 1000,
    colorDark: color,
    colorLight: bg,
    correctLevel: eclMap[ecl] || eclMap.Q,
  });

  // qrcodejs gera um <img> (base64) — esperamos renderizar e desenhar no canvas 2000
  setTimeout(() => {
    const img = tmp.querySelector("img") || tmp.querySelector("canvas");
    if (!img) {
      document.body.removeChild(tmp);
      feedback.hidden = false;
      feedback.className = "qr-feedback is-error";
      feedback.innerHTML = '<i class="fas fa-circle-exclamation"></i> Falha ao gerar o QR.';
      return;
    }
    const canvas = document.getElementById("qrCanvas");
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 2000, 2000);

    const render = () => {
      ctx.drawImage(img, 0, 0, 2000, 2000);
      document.body.removeChild(tmp);
      canvas.hidden = false;
      document.getElementById("qrPlaceholder").hidden = true;
      document.getElementById("qrDownload").disabled = false;
      feedback.hidden = false;
      feedback.className = "qr-feedback is-success";
      feedback.innerHTML = '<i class="fas fa-circle-check"></i> QR Code gerado · 2000 × 2000 px';
    };
    if (img.tagName === "IMG" && !img.complete) {
      img.onload = render;
    } else {
      render();
    }
  }, 40);
}

function downloadQrCode() {
  const canvas = document.getElementById("qrCanvas");
  if (!canvas || canvas.hidden) return;
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = document.getElementById("qrUrl").value.trim() || "qrcode";
    const safe = url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").slice(0, 40).replace(/^-|-$/g, "");
    triggerDownload(blob, `qrcode-${safe || "egov"}-2000px.png`);
  }, "image/png");
}

// ================ CERTIFICADOS ================
function preloadTemplate() {
  if (state.templateImg) return;
  const img = new Image();
  img.onload = () => { state.templateImg = img; renderCertPreview(); };
  img.onerror = () => console.warn("Falha ao carregar modelo.png");
  img.src = "modelo.png";
}

function renderViewCertificados() {
  if (!state.certStep) state.certStep = 1;

  // Carrega o índice de planilhas do sistema (relatorios/manifest.json) uma vez.
  if (state.certManifest === null && !state._certManifestLoading) {
    state._certManifestLoading = true;
    loadCertManifest()
      .catch((err) => {
        console.warn("Falha ao carregar manifesto de planilhas:", err);
        // Evita novo fetch em loop: marca como carregado, porém vazio.
        state.certManifest = { planilhas: [], erro: true };
      })
      .finally(() => {
        state._certManifestLoading = false;
        if (state.view === "certificados") renderViewCertificados();
      });
  }

  const planilhas = (state.certManifest && state.certManifest.planilhas) || [];
  // Atalho vindo de um card de evento: resolve a planilha pelo nome do arquivo.
  if (state.certPendingArquivo && planilhas.length) {
    const hit = planilhas.find((p) => p.arquivo === state.certPendingArquivo);
    if (hit) state.certEventId = hit.id;
    state.certPendingArquivo = null;
  }
  if (!state.certEventId && planilhas.length) state.certEventId = planilhas[0].id;

  // Remove form oculto deixado por uma visita anterior a etapa 3 (evita IDs duplicados).
  const oldHidden = document.getElementById("certFormHidden");
  if (oldHidden) oldHidden.remove();

  const view = document.getElementById("view-certificados");
  view.innerHTML = `
    <div class="wizard">
      <ol class="wizard__steps" role="tablist">
        <li class="wizard__step ${state.certStep === 1 ? "is-active" : ""} ${state.certStep > 1 ? "is-done" : ""}" data-step="1" role="tab">
          <span class="wizard__step-num">1</span>
          <span class="wizard__step-label">
            <strong>Origem & Dados</strong>
            <em>Escolha a fonte e preencha o curso</em>
          </span>
        </li>
        <li class="wizard__step ${state.certStep === 2 ? "is-active" : ""} ${state.certStep > 2 ? "is-done" : ""}" data-step="2" role="tab">
          <span class="wizard__step-num">2</span>
          <span class="wizard__step-label">
            <strong>Selecionar Elegíveis</strong>
            <em>Marque quem receberá certificado</em>
          </span>
        </li>
        <li class="wizard__step ${state.certStep === 3 ? "is-active" : ""}" data-step="3" role="tab">
          <span class="wizard__step-num">3</span>
          <span class="wizard__step-label">
            <strong>Pré-visualizar & Emitir</strong>
            <em>Confira o modelo e gere o ZIP</em>
          </span>
        </li>
      </ol>

      <!-- ETAPA 1: Origem + Dados -->
      <div class="wizard__panel" data-panel="1" ${state.certStep === 1 ? "" : "hidden"}>
        <div class="grid-2">
          <div class="card">
            <div class="card__header">
              <div><h3>Fonte dos elegíveis</h3><p>Use os check-ins do sistema ou suba uma planilha.</p></div>
            </div>
            <div class="source-tabs">
              <button class="source-tab ${state.certSource === "evento" ? "is-active" : ""}" data-source="evento">
                <i class="fas fa-database"></i> Do sistema
              </button>
              <button class="source-tab ${state.certSource === "planilha" ? "is-active" : ""}" data-source="planilha">
                <i class="fas fa-file-arrow-up"></i> Upload
              </button>
            </div>

            <div id="sourceEvento" ${state.certSource === "evento" ? "" : "hidden"}>
              <div class="filter">
                <label for="certEvento">Evento</label>
                <select id="certEvento" ${planilhas.length ? "" : "disabled"}>
                  ${planilhas.length
                    ? planilhas.map((p) => `<option value="${escapeHtml(p.id)}" ${state.certEventId === p.id ? "selected" : ""}>${escapeHtml(p.titulo)}</option>`).join("")
                    : `<option>${state._certManifestLoading ? "Carregando planilhas…" : "Nenhuma planilha encontrada"}</option>`}
                </select>
              </div>
              <div class="dropzone-hint">
                <i class="fas fa-circle-info"></i>
                <span>Apenas participantes com check-in entram como elegíveis.</span>
              </div>
            </div>

            <div id="sourcePlanilha" ${state.certSource === "planilha" ? "" : "hidden"}>
              <label class="dropzone" id="certDrop">
                <input type="file" id="certFile" accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
                <div class="dropzone__icon"><i class="fas fa-file-arrow-up"></i></div>
                <div class="dropzone__title" id="certDropTitle">Clique ou arraste a planilha aqui</div>
                <div class="dropzone__sub" id="certDropSub">CSV, XLSX ou XLS · até 5 MB</div>
              </label>
              <div class="dropzone-hint">
                <i class="fas fa-circle-info"></i>
                <span>Detecta automaticamente <b>Nome</b>, <b>Email</b>, <b>Secretaria</b>, <b>Check-in</b>. Apenas presentes (check-in = "Sim") são listados.</span>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card__header"><div><h3>Dados do certificado</h3><p>Aplicado a todos os selecionados.</p></div></div>
            <div class="filter" style="margin-bottom:10px;">
              <label for="certCurso">Título do curso</label>
              <input type="text" id="certCurso" placeholder="Ex.: Fundamentos da Gestão Pública" />
            </div>
            <div class="filters" style="margin-bottom:10px; padding:0; background:transparent; border:0;">
              <div class="filter">
                <label for="certDia">Dia</label>
                <input type="number" id="certDia" min="1" max="31" placeholder="14" />
              </div>
              <div class="filter">
                <label for="certMes">Mês</label>
                <select id="certMes">
                  <option value="">Selecione</option>
                  <option>janeiro</option><option>fevereiro</option><option>março</option><option>abril</option>
                  <option>maio</option><option>junho</option><option>julho</option><option>agosto</option>
                  <option>setembro</option><option>outubro</option><option>novembro</option><option>dezembro</option>
                </select>
              </div>
              <div class="filter">
                <label for="certAno">Ano</label>
                <input type="number" id="certAno" min="2024" max="2099" placeholder="2026" />
              </div>
            </div>
            <div class="filter">
              <label for="certCarga">Carga horária (horas)</label>
              <input type="number" id="certCarga" min="1" placeholder="8" />
            </div>
          </div>
        </div>
      </div>

      <!-- ETAPA 2: Selecionar elegíveis -->
      <div class="wizard__panel" data-panel="2" ${state.certStep === 2 ? "" : "hidden"}>
        <div class="filters">
          <div class="filter">
            <label for="certBusca">Buscar elegível</label>
            <input type="search" id="certBusca" placeholder="nome ou secretaria" />
          </div>
          <div class="filters__actions">
            <button class="btn btn--sm" id="certSelAll"><i class="fas fa-check-double"></i> Selecionar todos</button>
            <button class="btn btn--sm" id="certSelNone"><i class="fas fa-square"></i> Limpar</button>
          </div>
        </div>

        <div class="table-wrap">
          <div class="table-wrap__head">
            <h3><i class="fas fa-users"></i> Participantes elegíveis</h3>
            <span class="card__header-meta" id="certCount">0</span>
          </div>
          <div id="certTable"></div>
        </div>
      </div>

      <!-- ETAPA 3: Preview + Emitir -->
      <div class="wizard__panel" data-panel="3" ${state.certStep === 3 ? "" : "hidden"}>
        <div class="cert-emit-layout">
          <div class="card cert-preview-card">
            <div class="card__header">
              <div>
                <h3><i class="fas fa-eye"></i> Pré-visualização</h3>
                <p>Confira como o certificado ficará para cada selecionado.</p>
              </div>
              <span class="cert-preview-badge"><i class="fas fa-bolt"></i> Ao vivo</span>
            </div>
            <div class="cert-preview-toolbar" id="certPreviewToolbar">
              <button class="btn btn--sm" id="certPreviewPrev" title="Participante anterior">
                <i class="fas fa-chevron-left"></i>
              </button>
              <div class="cert-preview-name">
                <span class="cert-preview-name__label">Mostrando</span>
                <strong id="certPreviewName">—</strong>
                <span class="cert-preview-name__counter" id="certPreviewCounter"></span>
              </div>
              <button class="btn btn--sm" id="certPreviewNext" title="Próximo participante">
                <i class="fas fa-chevron-right"></i>
              </button>
            </div>
            <div class="canvas-frame canvas-frame--lg">
              <canvas id="certCanvas" width="1100" height="820"></canvas>
            </div>
          </div>

          <div class="cert-emit-side">
            <div class="card">
              <div class="card__header"><div><h3>Resumo da emissão</h3></div></div>
              <div class="cert-summary" id="certSummary"></div>
              <button class="btn btn--accent btn--lg" id="certEmit" disabled style="width:100%; margin-top: var(--space-3);">
                <i class="fas fa-award"></i> Emitir <span id="certEmitCount">(0)</span>
              </button>
              <div class="cert-progress" id="certProgress" hidden style="margin-top: var(--space-3);">
                <div class="cert-progress__head">
                  <span id="certProgressLabel">Gerando</span>
                  <strong id="certProgressPct">0%</strong>
                </div>
                <div class="cert-progress__bar"><div class="cert-progress__fill" id="certProgressFill"></div></div>
                <div class="cert-status" id="certStatus"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Navegação do wizard -->
      <div class="wizard__nav">
        <button class="btn" id="certPrev" ${state.certStep === 1 ? "disabled" : ""}>
          <i class="fas fa-arrow-left"></i> Voltar
        </button>
        <div class="wizard__nav-meta" id="certStepMeta"></div>
        <button class="btn btn--accent" id="certNext" ${state.certStep === 3 ? "hidden" : ""}>
          Próximo <i class="fas fa-arrow-right"></i>
        </button>
      </div>
    </div>
  `;

  // Step nav (cliques na trilha)
  view.querySelectorAll(".wizard__step").forEach((s) =>
    s.addEventListener("click", () => goToCertStep(parseInt(s.dataset.step, 10)))
  );
  document.getElementById("certPrev").addEventListener("click", () => goToCertStep(state.certStep - 1));
  const nextBtn = document.getElementById("certNext");
  if (nextBtn) nextBtn.addEventListener("click", () => goToCertStep(state.certStep + 1));

  // Etapa 1 — source tabs + form
  if (state.certStep === 1) {
    view.querySelectorAll(".source-tab").forEach((t) =>
      t.addEventListener("click", () => {
        state.certSource = t.dataset.source;
        renderViewCertificados();
      })
    );
    const evSel = document.getElementById("certEvento");
    if (evSel) {
      evSel.addEventListener("change", () => {
        state.certEventId = evSel.value;
        // Troca de evento invalida a seleção feita para o anterior.
        state._certSelectedIds = [];
        state._certSelectedCount = 0;
      });
    }
    setupCertUpload();
    ["certCurso", "certDia", "certMes", "certAno", "certCarga"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      // Restaura valor do state se existir
      if (state.certForm && state.certForm[id] != null) el.value = state.certForm[id];
      const save = () => {
        state.certForm = state.certForm || {};
        state.certForm[id] = el.value;
      };
      // 'change' cobre <select>; 'input' cobre <input> em tempo real
      el.addEventListener("input", save);
      el.addEventListener("change", save);
    });
  }

  // Etapa 2 — tabela e seleção
  if (state.certStep === 2) {
    document.getElementById("certBusca").addEventListener("input", populateCertTable);
    document.getElementById("certSelAll").addEventListener("click", () => {
      document.querySelectorAll(".cert-row-check").forEach((c) => (c.checked = true));
      updateCertEmitCount();
    });
    document.getElementById("certSelNone").addEventListener("click", () => {
      document.querySelectorAll(".cert-row-check").forEach((c) => (c.checked = false));
      updateCertEmitCount();
    });
    // Fonte "Do sistema": baixa e parseia a planilha antes de montar a tabela.
    if (state.certSource === "evento") {
      renderCertTableLoading();
      loadSystemPlanilha(state.certEventId)
        .then(() => populateCertTable())
        .catch((err) => renderCertTableError(err));
    } else {
      populateCertTable();
    }
  }

  // Etapa 3 — preview + emissão
  if (state.certStep === 3) {
    const initStep3 = () => {
      // Garante que a lista de origem esteja disponivel mesmo se etapa 2 nao foi visitada
      if (!state._certCurrentList) state._certCurrentList = getCertParticipantes();
      // Restaura form fields num form oculto (necessário para getCertFormData)
      ensureCertFormHidden();
      // Indice do participante atualmente em preview
      state._certPreviewIdx = 0;
      refreshCertPreviewWithName();
      renderCertSummary();
      document.getElementById("certEmit").addEventListener("click", emitCertificadosLote);
      document.getElementById("certPreviewPrev").addEventListener("click", () => stepCertPreview(-1));
      document.getElementById("certPreviewNext").addEventListener("click", () => stepCertPreview(1));
      updateCertEmitCount();
    };
    // Se pulou direto da etapa 1 para a 3, garante a planilha do sistema carregada.
    if (state.certSource === "evento" && !(state.certSystemCache || {})[state.certEventId]) {
      loadSystemPlanilha(state.certEventId).then(initStep3).catch(initStep3);
    } else {
      initStep3();
    }
  }
}

function getCertSelectedParticipants() {
  const list = state._certCurrentList || [];
  const ids = state._certSelectedIds || [];
  return ids.map((i) => list[i]).filter(Boolean);
}

function stepCertPreview(delta) {
  const selected = getCertSelectedParticipants();
  if (!selected.length) return;
  const n = selected.length;
  state._certPreviewIdx = ((state._certPreviewIdx || 0) + delta + n) % n;
  refreshCertPreviewWithName();
}

function refreshCertPreviewWithName() {
  const selected = getCertSelectedParticipants();
  const nameEl = document.getElementById("certPreviewName");
  const counterEl = document.getElementById("certPreviewCounter");
  const prevBtn = document.getElementById("certPreviewPrev");
  const nextBtn = document.getElementById("certPreviewNext");
  const idx = state._certPreviewIdx || 0;

  if (selected.length) {
    const p = selected[Math.min(idx, selected.length - 1)];
    if (nameEl) nameEl.textContent = p.nome;
    if (counterEl) counterEl.textContent = `(${idx + 1} de ${selected.length})`;
    if (prevBtn) prevBtn.disabled = selected.length < 2;
    if (nextBtn) nextBtn.disabled = selected.length < 2;
    drawCertWithName(p.nome);
  } else {
    if (nameEl) nameEl.textContent = "Nenhum participante selecionado";
    if (counterEl) counterEl.textContent = "— Volte à etapa 2 para selecionar";
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    drawCertWithName(null);
  }
}

function drawCertWithName(nome) {
  const canvas = document.getElementById("certCanvas");
  if (!canvas || !state.templateImg) return;
  canvas.width = state.templateImg.naturalWidth;
  canvas.height = state.templateImg.naturalHeight;
  const fields = getCertFormData(nome);
  drawCertificateInto(canvas, fields);
}

function ensureCertFormHidden() {
  // Recria inputs ocultos com valores em state.certForm para que getCertFormData funcione
  let host = document.getElementById("certFormHidden");
  if (!host) {
    host = document.createElement("div");
    host.id = "certFormHidden";
    host.style.display = "none";
    document.body.appendChild(host);
  }
  const f = state.certForm || {};
  host.innerHTML = `
    <input id="certCurso" value="${escapeHtml(f.certCurso || "")}" />
    <input id="certDia"   value="${escapeHtml(f.certDia || "")}" />
    <input id="certMes"   value="${escapeHtml(f.certMes || "")}" />
    <input id="certAno"   value="${escapeHtml(f.certAno || "")}" />
    <input id="certCarga" value="${escapeHtml(f.certCarga || "")}" />
  `;
}

function renderCertSummary() {
  const f = state.certForm || {};
  const list = getCertParticipantes();
  const selectedCount = state._certSelectedCount || 0;
  document.getElementById("certSummary").innerHTML = `
    <dl class="cert-summary-list">
      <div><dt>Origem</dt><dd>${state.certSource === "planilha" ? "Planilha enviada" : "Sistema (evento)"}</dd></div>
      <div><dt>Curso</dt><dd>${escapeHtml(f.certCurso || "—")}</dd></div>
      <div><dt>Data</dt><dd>${escapeHtml([f.certDia, f.certMes, f.certAno].filter(Boolean).join(" / ") || "—")}</dd></div>
      <div><dt>Carga horária</dt><dd>${escapeHtml(f.certCarga || "—")}h</dd></div>
      <div><dt>Elegíveis</dt><dd>${list.length} pessoa(s)</dd></div>
      <div><dt>Selecionados</dt><dd><strong>${selectedCount}</strong></dd></div>
    </dl>
  `;
}

function goToCertStep(step) {
  if (step < 1 || step > 3) return;
  // Salva os dados do formulario da etapa 1 antes de sair (garante que
  // valores recem-digitados sem evento change/blur sejam preservados).
  if (state.certStep === 1) {
    state.certForm = state.certForm || {};
    ["certCurso", "certDia", "certMes", "certAno", "certCarga"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) state.certForm[id] = el.value;
    });
  }
  // Salva selecionados ao sair da etapa 2
  if (state.certStep === 2) {
    state._certSelectedIds = [...document.querySelectorAll(".cert-row-check:checked")]
      .map((c) => parseInt(c.dataset.idx, 10));
    state._certSelectedCount = state._certSelectedIds.length;
  }
  state.certStep = step;
  renderViewCertificados();
}

function setupCertUpload() {
  const drop = document.getElementById("certDrop");
  const input = document.getElementById("certFile");
  if (!drop || !input) return;

  input.addEventListener("change", (e) => {
    if (e.target.files[0]) handleCertFile(e.target.files[0]);
  });
  ["dragenter", "dragover"].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-drag"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("is-drag"); })
  );
  drop.addEventListener("drop", (e) => {
    if (e.dataTransfer.files[0]) handleCertFile(e.dataTransfer.files[0]);
  });
}

function handleCertFile(file) {
  const drop = document.getElementById("certDrop");
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      let participantes = [];
      const ext = file.name.toLowerCase().split(".").pop();
      if (ext === "csv") {
        participantes = parseCsvParticipantes(e.target.result);
      } else {
        // XLSX/XLS via SheetJS
        const data = new Uint8Array(e.target.result);
        const wb = window.XLSX.read(data, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        participantes = parseSheetParticipantes(sheet);
      }
      if (!participantes.length) {
        document.getElementById("certDropTitle").textContent = "Nenhum elegível na planilha";
        document.getElementById("certDropSub").textContent = "Esperado: linhas com check-in 'Sim' ou coluna nome";
        drop.classList.remove("has-file");
        state.certUploaded = null;
        populateCertTable();
        return;
      }
      state.certUploaded = { fileName: file.name, participantes };
      drop.classList.add("has-file");
      document.getElementById("certDropTitle").textContent = file.name;
      document.getElementById("certDropSub").textContent = `${participantes.length} elegíveis carregados`;
      populateCertTable();
    } catch (err) {
      console.error(err);
      document.getElementById("certDropTitle").textContent = "Erro ao ler planilha";
      document.getElementById("certDropSub").textContent = err.message;
      drop.classList.remove("has-file");
    }
  };
  if (file.name.toLowerCase().endsWith(".csv")) reader.readAsText(file, "utf-8");
  else reader.readAsArrayBuffer(file);
}

function parseCsvParticipantes(text) {
  text = text.replace(/^﻿/, "");
  const sep = text.split("\n")[0].includes(";") ? ";" : ",";
  const rows = [];
  let row = [], cur = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === sep) { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (c === "\r") { /* skip */ }
      else cur += c;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).filter((r) => r.some((v) => v && v.trim())).map((r) => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = (r[i] || "").trim());
    return obj;
  }).map(normalizeParticipante).filter((p) => !isLinhaRodape(p.nome)).filter(isElegivel);
}

/**
 * Linhas de rodapé dos exports do Sympla ("Exportado em ...*" e
 * "* Horário de Brasília") não são participantes — devem ser descartadas.
 */
function isLinhaRodape(nome) {
  const n = (nome || "").trim().toLowerCase();
  return n.startsWith("*") || n.startsWith("exportado em") ||
         n.includes("horário de brasília") || n.includes("horario de brasilia");
}

/**
 * Algumas planilhas (ex.: exports do Sympla) declaram um <dimension> errado,
 * que cobre só a coluna A. Sem corrigir, o SheetJS lê apenas 1 coluna e a
 * lista de elegíveis fica vazia. Recalcula o !ref pelos endereços de célula
 * realmente presentes e expande quando o declarado for menor que o conteúdo.
 */
function fixSheetRange(sheet) {
  const XLSX = window.XLSX;
  let maxC = 0, maxR = 0, achou = false;
  for (const key of Object.keys(sheet)) {
    if (key[0] === "!") continue;
    const cell = XLSX.utils.decode_cell(key);
    if (Number.isNaN(cell.r) || Number.isNaN(cell.c)) continue;
    if (cell.c > maxC) maxC = cell.c;
    if (cell.r > maxR) maxR = cell.r;
    achou = true;
  }
  if (!achou) return;
  const real = XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: maxC, r: maxR } });
  const declared = sheet["!ref"];
  if (!declared) { sheet["!ref"] = real; return; }
  const d = XLSX.utils.decode_range(declared);
  if (d.e.c < maxC || d.e.r < maxR) sheet["!ref"] = real;
}

function parseSheetParticipantes(sheet) {
  fixSheetRange(sheet);
  const json = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  // Procura linha de cabecalho (contem 'Ordem de inscricao' OU 'Nome')
  let headerIdx = -1;
  for (let i = 0; i < Math.min(15, json.length); i++) {
    const lower = json[i].map((c) => String(c).toLowerCase());
    if (lower.some((c) => c.includes("ordem de"))) { headerIdx = i; break; }
    if (lower.includes("nome") && headerIdx < 0) headerIdx = i;
  }
  if (headerIdx < 0) return [];
  const headers = json[headerIdx].map((h) => String(h).trim().toLowerCase());
  return json.slice(headerIdx + 1)
    .filter((r) => r.some((v) => v && String(v).trim()))
    .map((r) => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = String(r[i] || "").trim());
      return obj;
    })
    .map(normalizeParticipante)
    .filter((p) => !isLinhaRodape(p.nome))
    .filter(isElegivel);
}

/**
 * Padroniza o nome da secretaria para o formato institucional
 * "Secretaria Municipal de ..." (igual à planilha Fundamentos da Gestão
 * Pública), unificando siglas, caixa-alta e variações de digitação.
 */
function normalizeSecretaria(raw) {
  if (!raw) return "";
  // Remove sigla entre parênteses no fim: "... (SME)".
  const s = String(raw).trim().replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (!s) return "";
  const key = s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const MAPA = [
    [["educacao"], "Secretaria Municipal de Educação"],
    [["saude"], "Secretaria Municipal de Saúde"],
    // Gestão e Finanças engloba: Gestão e Administração, Adjunta de
    // Transformação Digital e SAGA (Secretaria Adjunta de Gestão Administrativa).
    [["gestao e financas", "gestao e administracao", "transformacao digital", "saga"],
      "Secretaria Municipal de Gestão e Finanças"],
    [["desenvolvimento economico"], "Secretaria Municipal de Desenvolvimento Econômico"],
    [["desenvolvimento social"], "Secretaria Municipal de Desenvolvimento Social"],
    [["bem estar", "bem-estar"], "Secretaria Municipal de Bem Estar"],
    [["meio ambiente"], "Secretaria Municipal de Meio Ambiente"],
    [["seguranca"], "Secretaria Municipal de Segurança Pública"],
    [["obras"], "Secretaria Municipal de Obras"],
    [["controladoria"], "Controladoria Geral do Município"],
    [["vice"], "Gabinete do Vice-Prefeito"],
    [["gabinete do prefeito"], "Gabinete do Prefeito"],
    [["chefia de gabinete"], "Chefia de Gabinete"],
    [["governo"], "Secretaria Municipal de Governo"],
  ];
  for (const [chaves, canon] of MAPA) {
    if (chaves.some((c) => key.includes(c))) return canon;
  }
  // Sem correspondência conhecida: apenas ajusta a capitalização.
  return s.replace(/\S+/g, (w) =>
    w.length > 2 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()
  );
}

function normalizeParticipante(row) {
  // tenta varios nomes de coluna
  const k = Object.keys(row);
  const find = (...patterns) => {
    for (const p of patterns) {
      const hit = k.find((kk) => kk.includes(p));
      if (hit && row[hit]) return row[hit];
    }
    return "";
  };
  const nome = [find("nome"), find("sobrenome")].filter(Boolean).join(" ").trim() ||
               find("nome completo", "participante");
  const checkin = find("check-in", "check in", "checkin", "presente").toLowerCase();
  // A coluna de check-in existe? (verifica o cabeçalho, não o valor da célula —
  // assim uma célula vazia não é confundida com ausência da coluna).
  const padroesCheckin = ["check-in", "check in", "checkin", "presente"];
  const temColunaCheckin = k.some((kk) => padroesCheckin.some((p) => kk.includes(p)));
  // Presente quando o check-in é afirmativo. Sem coluna de check-in, assume
  // elegível; com a coluna presente mas célula vazia, conta como ausente.
  const presente = ["sim", "yes", "true", "1"].includes(checkin) || !temColunaCheckin;
  return {
    nome: nome || "(sem nome)",
    email: find("email", "e-mail"),
    secretaria: normalizeSecretaria(find("secret", "lota")),
    turma: find("tipo de ingresso", "turma"),
    presente,
  };
}

function isElegivel(p) {
  return p.presente && p.nome && p.nome !== "(sem nome)";
}

function getCertParticipantes() {
  if (state.certSource === "planilha") {
    return state.certUploaded ? state.certUploaded.participantes : [];
  }
  // Fonte "Do sistema": planilha de relatorios/ já parseada e em cache.
  return (state.certSystemCache || {})[state.certEventId] || [];
}

/** Baixa relatorios/manifest.json — o índice das planilhas do sistema. */
async function loadCertManifest() {
  const res = await fetch("assets/docs/relatorios/manifest.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`manifest.json: ${res.status}`);
  state.certManifest = await res.json();
  return state.certManifest;
}

/**
 * Baixa e parseia a planilha .xlsx de um evento (por id do manifesto),
 * guardando os elegíveis em cache. Reaproveita o parser do upload.
 */
async function loadSystemPlanilha(id) {
  state.certSystemCache = state.certSystemCache || {};
  if (!id) return [];
  if (state.certSystemCache[id]) return state.certSystemCache[id];

  const planilhas = (state.certManifest && state.certManifest.planilhas) || [];
  const entry = planilhas.find((p) => p.id === id);
  if (!entry) return [];

  const url = "assets/docs/relatorios/" + encodeURIComponent(entry.arquivo);
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Falha ao ler ${entry.arquivo} (HTTP ${res.status})`);
  const buf = await res.arrayBuffer();
  const wb = window.XLSX.read(new Uint8Array(buf), { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const participantes = parseSheetParticipantes(sheet);
  state.certSystemCache[id] = participantes;
  return participantes;
}

function renderCertTableLoading() {
  const t = document.getElementById("certTable");
  if (t) t.innerHTML = `
    <div class="empty-state">
      <i class="fas fa-spinner fa-spin"></i>
      <h3>Carregando elegíveis…</h3>
      <p>Lendo a planilha do sistema.</p>
    </div>`;
  const c = document.getElementById("certCount");
  if (c) c.textContent = "…";
  const emit = document.getElementById("certEmit");
  if (emit) emit.disabled = true;
}

function renderCertTableError(err) {
  console.error(err);
  const t = document.getElementById("certTable");
  if (t) t.innerHTML = `
    <div class="empty-state">
      <i class="fas fa-triangle-exclamation"></i>
      <h3>Não foi possível ler a planilha</h3>
      <p>${escapeHtml(err && err.message ? err.message : String(err))}</p>
    </div>`;
  const c = document.getElementById("certCount");
  if (c) c.textContent = "0";
  const emit = document.getElementById("certEmit");
  if (emit) emit.disabled = true;
}

function populateCertTable() {
  const list = getCertParticipantes();
  const busca = (document.getElementById("certBusca")?.value || "").toLowerCase();
  const filtered = busca
    ? list.filter((p) =>
        (p.nome || "").toLowerCase().includes(busca) ||
        (p.secretaria || "").toLowerCase().includes(busca)
      )
    : list;

  document.getElementById("certCount").textContent = `${filtered.length} de ${list.length} elegíveis`;

  if (!filtered.length) {
    document.getElementById("certTable").innerHTML = `
      <div class="empty-state">
        <i class="fas fa-users-slash"></i>
        <h3>Sem elegíveis</h3>
        <p>${state.certSource === "planilha" ? "Faça upload de uma planilha." : "Este evento não possui check-ins, ou tente outro filtro."}</p>
      </div>`;
    document.getElementById("certEmit").disabled = true;
    return;
  }

  const savedIds = new Set(state._certSelectedIds || []);
  const rows = filtered.map((p, i) => `
    <tr>
      <td><input type="checkbox" class="cert-row-check" data-idx="${i}" ${savedIds.has(i) ? "checked" : ""} /></td>
      <td class="cell-name">${escapeHtml(p.nome)}</td>
      <td class="col-hide-sm">${escapeHtml(p.email || "")}</td>
      <td class="col-hide-md">${escapeHtml(p.turma || "")}</td>
      <td>${escapeHtml(p.secretaria || "")}</td>
      <td><span class="cell-status green"><i class="fas fa-check"></i> Elegível</span></td>
      <td><span class="cell-status muted">A emitir</span></td>
    </tr>
  `).join("");

  document.getElementById("certTable").innerHTML = `
    <div class="table-scroll">
      <table class="data">
        <thead>
          <tr>
            <th style="width:36px;"><input type="checkbox" id="certHeadCheck" /></th>
            <th>Participante</th>
            <th class="col-hide-sm">E-mail</th>
            <th class="col-hide-md">Turma</th>
            <th>Secretaria</th>
            <th>Presença</th>
            <th>Certificado</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  document.getElementById("certHeadCheck").addEventListener("change", (e) => {
    document.querySelectorAll(".cert-row-check").forEach((c) => (c.checked = e.target.checked));
    updateCertEmitCount();
  });
  document.querySelectorAll(".cert-row-check").forEach((c) =>
    c.addEventListener("change", updateCertEmitCount)
  );
  // expose for emission
  state._certCurrentList = filtered;
  updateCertEmitCount();
}

function updateCertEmitCount() {
  // Na etapa 2 conta direto dos checkboxes; na etapa 3 usa o state salvo
  let n;
  const checks = document.querySelectorAll(".cert-row-check");
  if (checks.length) {
    n = document.querySelectorAll(".cert-row-check:checked").length;
    state._certSelectedIds = [...document.querySelectorAll(".cert-row-check:checked")]
      .map((c) => parseInt(c.dataset.idx, 10));
    state._certSelectedCount = n;
  } else {
    n = state._certSelectedCount || 0;
  }
  const countEl = document.getElementById("certEmitCount");
  const btn = document.getElementById("certEmit");
  if (countEl) countEl.textContent = `(${n})`;
  if (btn) btn.disabled = n === 0;
  if (state.certStep === 3) renderCertSummary();
}

// ---------------- Canvas / PDF rendering ----------------

const POS = {
  nome:  { x: 0.54,  y: 0.34 },
  curso: { x: 0.42,  y: 0.389 },
  dia:   { x: 0.371, y: 0.431 },
  mes:   { x: 0.55,  y: 0.431 },
  ano:   { x: 0.715, y: 0.431 },
  carga: { x: 0.26,  y: 0.475 },
};

function getCertFormData(nomeOverride = null) {
  // Le primeiro de state.certForm (fonte da verdade, populado na etapa 1);
  // cai para o DOM quando a etapa 1 esta visivel e o usuario acabou de digitar.
  const f = state.certForm || {};
  const fromState = (key) => (f[key] != null ? String(f[key]) : "");
  const fromDom = (id) => {
    const el = document.getElementById(id);
    return el ? el.value : "";
  };
  const pick = (id) => (fromDom(id) || fromState(id)).trim();
  return {
    nome: nomeOverride || "NOME COMPLETO DO PARTICIPANTE",
    curso: pick("certCurso") || "TÍTULO DO CURSO",
    dia:   pick("certDia")   || "XX",
    mes:   pick("certMes")   || "XXXX",
    ano:   pick("certAno")   || "XXXX",
    carga: pick("certCarga") || "XX",
  };
}

function drawCertificateInto(canvas, fields) {
  if (!state.templateImg) return;
  const w = canvas.width, h = canvas.height;
  const c = canvas.getContext("2d");
  c.clearRect(0, 0, w, h);
  c.drawImage(state.templateImg, 0, 0, w, h);
  const fontFamily = "'Calibri', 'Carlito', 'Segoe UI', Arial, sans-serif";
  const baseSize = w * 0.026;
  c.font = `700 ${baseSize}px ${fontFamily}`;
  c.fillStyle = "#000000";
  c.textBaseline = "middle";
  c.textAlign = "center";
  c.fillText(fields.nome, w * POS.nome.x, h * POS.nome.y);
  c.fillText(fields.curso, w * POS.curso.x, h * POS.curso.y);
  c.fillText(String(fields.dia), w * POS.dia.x, h * POS.dia.y);
  c.fillText(fields.mes, w * POS.mes.x, h * POS.mes.y);
  c.fillText(String(fields.ano), w * POS.ano.x, h * POS.ano.y);
  c.fillText(String(fields.carga), w * POS.carga.x, h * POS.carga.y);
}

function renderCertPreview() {
  const canvas = document.getElementById("certCanvas");
  if (!canvas || !state.templateImg) return;
  canvas.width = state.templateImg.naturalWidth;
  canvas.height = state.templateImg.naturalHeight;
  drawCertificateInto(canvas, getCertFormData());
}

function slug(s) {
  return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function emitCertificadosLote() {
  if (!state.templateImg) { alert("Template ainda carregando."); return; }
  const fd = getCertFormData();
  if (!fd.curso || fd.curso === "TÍTULO DO CURSO" || !fd.mes || fd.mes === "XXXX" ||
      !fd.ano || fd.ano === "XXXX" || !fd.dia || fd.dia === "XX") {
    alert("Preencha curso, dia, mês, ano e carga horária antes de emitir.");
    return;
  }
  // Tenta primeiro os checkboxes visíveis (etapa 2); fallback no state (etapa 3)
  const visibleChecks = [...document.querySelectorAll(".cert-row-check:checked")];
  const ids = visibleChecks.length
    ? visibleChecks.map((c) => parseInt(c.dataset.idx, 10))
    : (state._certSelectedIds || []);
  const list = state._certCurrentList || [];
  const selected = ids.map((i) => list[i]).filter(Boolean);
  if (!selected.length) {
    alert("Volte à etapa 2 e selecione ao menos um participante.");
    return;
  }

  const btn = document.getElementById("certEmit");
  btn.disabled = true;
  const progress = document.getElementById("certProgress");
  const fill = document.getElementById("certProgressFill");
  const pctEl = document.getElementById("certProgressPct");
  const labelEl = document.getElementById("certProgressLabel");
  const statusEl = document.getElementById("certStatus");
  progress.hidden = false;
  statusEl.className = "cert-status";
  statusEl.textContent = "";
  fill.style.width = "0%";

  const { jsPDF } = window.jspdf;
  const zip = new window.JSZip();
  const tmp = document.createElement("canvas");
  tmp.width = state.templateImg.naturalWidth;
  tmp.height = state.templateImg.naturalHeight;

  for (let i = 0; i < selected.length; i++) {
    const p = selected[i];
    const fields = { ...fd, nome: p.nome };
    drawCertificateInto(tmp, fields);
    const imgData = tmp.toDataURL("image/jpeg", 0.92);
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    pdf.addImage(imgData, "JPEG", 0, 0, 297, 210);
    const blob = pdf.output("blob");
    zip.file(`certificado-${slug(p.nome)}-${slug(fd.curso)}.pdf`, blob);
    const pctVal = Math.round(((i + 1) / selected.length) * 100);
    fill.style.width = pctVal + "%";
    pctEl.textContent = pctVal + "%";
    labelEl.textContent = `Gerando ${i + 1} de ${selected.length}`;
    await new Promise((r) => setTimeout(r, 0));
  }

  labelEl.textContent = "Compactando...";
  const zipBlob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(zipBlob);
  a.download = `certificados-${new Date().toISOString().slice(0, 10)}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);

  statusEl.classList.add("is-success");
  statusEl.textContent = `${selected.length} certificado(s) gerado(s) e baixado(s) em ZIP.`;
  btn.disabled = false;
}

// ================ AUTO-RELATÓRIO DE SATISFAÇÃO ================
// Configuração institucional (constantes — vão sempre no PDF).
const AR_CONFIG = {
  orgao: "Diretoria de Gestão de Pessoas",
  cabecalho: [
    "PREFEITURA MUNICIPAL DE PEDRO LEOPOLDO",
    "SECRETARIA MUNICIPAL DE GESTÃO E FINANÇAS",
    "DIRETORIA DE GESTÃO DE PESSOAS",
  ],
  assinaturaCargo: "Diretoria de Gestão de Pessoas",
};

function ensureAutoReportState() {
  if (state.autoReport) return state.autoReport;
  state.autoReport = {
    participantes: null,  // { fileName, evento, data, local, totalInscritos, totalPresentes, totalAusentes, capacidade }
    pesquisa: null,       // { fileName, respostas, medias, notas, textos, temas: { altos, melhorias, sugestoes } }
  };
  return state.autoReport;
}

function renderViewAutoReport() {
  const s = ensureAutoReportState();
  const view = document.getElementById("view-autoreport");
  view.innerHTML = `
    <div class="auto-report-layout">
      <div class="auto-report-form">
        <div class="card auto-report-intro">
          <div class="card__header">
            <div>
              <h3><i class="fas fa-magic-wand-sparkles" style="color:var(--brand-primary)"></i> Geração automática</h3>
              <p>Faça upload das duas planilhas e clique em <b>Gerar PDF</b>. Todo o conteúdo do relatório (título, datas, métricas, gráficos, análises e conclusão) é extraído automaticamente.</p>
            </div>
          </div>
        </div>

        <div class="grid-2">
          <div class="card">
            <div class="card__header"><div><h3>1. Lista de participantes</h3><p>XLSX exportado do sistema de inscrições.</p></div></div>
            <label class="dropzone" id="arDropPart">
              <input type="file" id="arFilePart" accept=".xlsx,.xls,.csv" />
              <div class="dropzone__icon"><i class="fas fa-users"></i></div>
              <div class="dropzone__title" id="arDropPartTitle">${s.participantes ? escapeHtml(s.participantes.fileName) : "Clique ou arraste a planilha"}</div>
              <div class="dropzone__sub" id="arDropPartSub">${s.participantes ? `${s.participantes.totalInscritos} inscritos · ${s.participantes.totalPresentes} presentes` : "XLSX, XLS ou CSV"}</div>
            </label>
          </div>

          <div class="card">
            <div class="card__header"><div><h3>2. Pesquisa de satisfação</h3><p>Respostas do Google Forms ou similar.</p></div></div>
            <label class="dropzone" id="arDropPesq">
              <input type="file" id="arFilePesq" accept=".xlsx,.xls,.csv" />
              <div class="dropzone__icon"><i class="fas fa-clipboard-check"></i></div>
              <div class="dropzone__title" id="arDropPesqTitle">${s.pesquisa ? escapeHtml(s.pesquisa.fileName) : "Clique ou arraste a planilha"}</div>
              <div class="dropzone__sub" id="arDropPesqSub">${s.pesquisa ? `${s.pesquisa.respostas} respostas detectadas` : "Colunas detectadas automaticamente"}</div>
            </label>
          </div>
        </div>

        <div class="auto-report-actions">
          <button class="btn btn--accent btn--lg" id="arGenerate">
            <i class="fas fa-file-pdf"></i> Gerar PDF
          </button>
          <button class="btn btn--lg" id="arGenerateDocx">
            <i class="fas fa-file-word"></i> Gerar DOCX
          </button>
          <span id="arStatus" class="auto-report-status"></span>
        </div>
      </div>

      <aside class="auto-report-side">
        <div class="card">
          <div class="card__header"><div><h3>Dados detectados</h3><p>Pré-visualização do que entrará no PDF.</p></div></div>
          <div class="ar-summary" id="arSummary"></div>
        </div>
      </aside>
    </div>
  `;

  setupAutoReportUploads();
  document.getElementById("arGenerate").addEventListener("click", generateSatisfacaoPdf);
  document.getElementById("arGenerateDocx").addEventListener("click", generateSatisfacaoDocx);
  updateAutoReportSummary();
}

function updateAutoReportSummary() {
  const s = state.autoReport;
  const p = s.participantes;
  const q = s.pesquisa;

  const taxaNum = p && p.totalInscritos
    ? (p.totalPresentes / p.totalInscritos) * 100
    : null;
  const taxaStr = taxaNum != null ? taxaNum.toFixed(1) + "%" : "—";
  const taxaTone = taxaNum == null ? "muted" : taxaNum >= 80 ? "good" : taxaNum >= 60 ? "warn" : "bad";

  const renderStars = (media) => {
    const v = Math.max(0, Math.min(5, Number(media) || 0));
    const full = Math.floor(v);
    const half = v - full >= 0.5 ? 1 : 0;
    const empty = 5 - full - half;
    return (
      "★".repeat(full) +
      (half ? "⯨" : "") +
      "☆".repeat(empty)
    );
  };

  const criteriosHtml = q?.criterios?.length
    ? q.criterios.map((c) => {
        const media = Number(c.media) || 0;
        return `
          <li class="ar-rating-row">
            <span class="ar-rating-row__label">${escapeHtml(c.label)}</span>
            <span class="ar-rating-row__stars" aria-hidden="true">${renderStars(media)}</span>
            <span class="ar-rating-row__value">${media.toFixed(2)}</span>
          </li>`;
      }).join("")
    : `<li class="ar-rating-row ar-rating-row--empty">Sem critérios disponíveis</li>`;

  const temasChips = q?.temas
    ? `
        <span class="ar-chip ar-chip--good"><i class="bi bi-arrow-up-circle-fill"></i> ${q.temas.altos.length} pontos altos</span>
        <span class="ar-chip ar-chip--warn"><i class="bi bi-tools"></i> ${q.temas.melhorias.length} melhorias</span>
        <span class="ar-chip ar-chip--info"><i class="bi bi-lightbulb-fill"></i> ${q.temas.sugestoes.length} sugestões</span>
      `
    : `<span class="ar-chip ar-chip--muted">Nenhum tema extraído</span>`;

  const capBadge = p?.capacidadeInferida
    ? `<span class="ar-tag ar-tag--soft" title="Valor inferido a partir dos dados">inferida</span>`
    : "";

  document.getElementById("arSummary").innerHTML = `
    <section class="ar-block ar-block--event">
      <h4 class="ar-block__title">${escapeHtml(p?.evento || "Evento não detectado")}</h4>
      <div class="ar-block__meta">
        <span><i class="bi bi-calendar-event"></i> ${escapeHtml(p?.data || "—")}</span>
        <span><i class="bi bi-people-fill"></i> Capacidade ${p?.capacidade ?? "—"} ${capBadge}</span>
      </div>
    </section>

    <section class="ar-block ar-hero ar-hero--${taxaTone}">
      <div class="ar-hero__label">Taxa de presença</div>
      <div class="ar-hero__value">${taxaStr}</div>
      <div class="ar-hero__bar"><span style="width:${taxaNum != null ? Math.min(100, taxaNum) : 0}%"></span></div>
      <div class="ar-hero__caption">${p?.totalPresentes ?? "—"} de ${p?.totalInscritos ?? "—"} inscritos compareceram</div>
    </section>

    <section class="ar-kpis">
      <div class="ar-kpi">
        <div class="ar-kpi__value">${p?.totalInscritos ?? "—"}</div>
        <div class="ar-kpi__label">Inscritos</div>
      </div>
      <div class="ar-kpi ar-kpi--good">
        <div class="ar-kpi__value">${p?.totalPresentes ?? "—"}</div>
        <div class="ar-kpi__label">Presentes</div>
      </div>
      <div class="ar-kpi ar-kpi--bad">
        <div class="ar-kpi__value">${p?.totalAusentes ?? "—"}</div>
        <div class="ar-kpi__label">Ausentes</div>
      </div>
    </section>

    <section class="ar-block">
      <div class="ar-block__header">
        <h5 class="ar-block__subtitle"><i class="bi bi-star-fill"></i> Avaliação</h5>
        <span class="ar-block__hint">${q?.respostas ?? 0} ${q?.respostas === 1 ? "resposta" : "respostas"}</span>
      </div>
      <ul class="ar-rating-list">${criteriosHtml}</ul>
    </section>

    <section class="ar-block">
      <div class="ar-block__header">
        <h5 class="ar-block__subtitle"><i class="bi bi-chat-square-text"></i> Temas extraídos</h5>
      </div>
      <div class="ar-chips">${temasChips}</div>
    </section>
  `;
}

function setupAutoReportUploads() {
  const setupDrop = (dropId, inputId, handler) => {
    const drop = document.getElementById(dropId);
    const input = document.getElementById(inputId);
    if (!drop || !input) return;
    input.addEventListener("change", (e) => { if (e.target.files[0]) handler(e.target.files[0]); });
    ["dragenter", "dragover"].forEach((ev) =>
      drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-drag"); })
    );
    ["dragleave", "drop"].forEach((ev) =>
      drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("is-drag"); })
    );
    drop.addEventListener("drop", (e) => { if (e.dataTransfer.files[0]) handler(e.dataTransfer.files[0]); });
  };
  setupDrop("arDropPart", "arFilePart", handleAutoReportParticipantes);
  setupDrop("arDropPesq", "arFilePesq", handleAutoReportPesquisa);
}

function handleAutoReportParticipantes(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = window.XLSX.read(data, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

      // Extrai metadados (linhas 0-3): título, data, local
      const get = (i, j) => (json[i] && json[i][j] != null) ? String(json[i][j]).trim() : "";
      const evento = get(0, 0).replace(/\s+/g, " ");
      let dataEvento = "";
      let local = "";
      for (let i = 1; i < Math.min(5, json.length); i++) {
        for (let j = 0; j < (json[i] || []).length; j++) {
          const v = get(i, j);
          if (!dataEvento && /^data\s*:/i.test(v)) {
            dataEvento = v.replace(/^data\s*:\s*/i, "").trim();
          }
          if (!local && /^local\s*:/i.test(v)) {
            local = v.replace(/^local\s*:\s*/i, "").trim();
          }
        }
      }

      // Detecta cabeçalho com "Nome" + "Check-in"
      let hdr = -1;
      for (let i = 0; i < Math.min(15, json.length); i++) {
        const lower = (json[i] || []).map((c) => String(c).toLowerCase());
        if (lower.some((c) => c.includes("check-in")) &&
            (lower.some((c) => c === "nome") || lower.some((c) => c.includes("ordem de")))) {
          hdr = i; break;
        }
      }
      if (hdr < 0) throw new Error("Cabeçalho não encontrado (esperado: Nome + Check-in)");

      const headers = json[hdr].map((h) => String(h).toLowerCase());
      const colNome = headers.findIndex((h) => h === "nome" || h.startsWith("nome"));
      const colChk = headers.findIndex((h) => h.includes("check-in") && !h.includes("data"));
      const rows = json.slice(hdr + 1).filter((r) =>
        r[colNome] && !String(r[colNome]).toLowerCase().startsWith("exportado") &&
        !String(r[colNome]).startsWith("*")
      );
      const totalInscritos = rows.length;
      const totalPresentes = rows.filter((r) => String(r[colChk] || "").toLowerCase() === "sim").length;

      // Infere capacidade: tenta match no JSON consolidado primeiro
      let capacidade = null;
      let capacidadeInferida = false;
      if (state.data && state.data.eventos) {
        const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        const evNorm = norm(evento);
        const match = state.data.eventos.find((ev) => {
          const t = norm(ev.title || "");
          return t && (evNorm.includes(t) || t.includes(evNorm));
        });
        if (match && match.vagas) capacidade = match.vagas;
      }
      // Fallback: assume sold out (capacidade = inscritos)
      if (!capacidade) {
        capacidade = totalInscritos;
        capacidadeInferida = true;
      }

      state.autoReport.participantes = {
        fileName: file.name,
        evento: evento || "(sem título)",
        data: dataEvento || "",
        local: local || "",
        totalInscritos,
        totalPresentes,
        totalAusentes: totalInscritos - totalPresentes,
        capacidade,
        capacidadeInferida,
      };
      document.getElementById("arDropPart").classList.add("has-file");
      document.getElementById("arDropPartTitle").textContent = evento || file.name;
      document.getElementById("arDropPartSub").textContent =
        `${totalInscritos} inscritos · ${totalPresentes} presentes · capacidade ${capacidade}${capacidadeInferida ? " (inferida)" : ""}`;
      updateAutoReportSummary();
    } catch (err) {
      document.getElementById("arDropPartTitle").textContent = "Erro ao ler planilha";
      document.getElementById("arDropPartSub").textContent = err.message;
    }
  };
  reader.readAsArrayBuffer(file);
}

function handleAutoReportPesquisa(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = window.XLSX.read(data, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = window.XLSX.utils.sheet_to_json(sheet, { defval: "" });
      if (!rows.length) throw new Error("Planilha vazia");

      const columns = Object.keys(rows[0]);
      const numeric = (v) => {
        const m = String(v).replace(",", ".").match(/-?\d+(\.\d+)?/);
        if (!m) return null;
        const n = parseFloat(m[0]);
        return isFinite(n) ? n : null;
      };

      // Classifica cada coluna automaticamente:
      // - "skip": carimbo de data/email/etc
      // - "numeric": coluna com valores 1-5 (escala Likert)
      // - "text": coluna textual livre
      const numericCols = [];
      const textCols = [];
      columns.forEach((col) => {
        const lc = col.toLowerCase();
        if (/carimbo|timestamp|endere|e-?mail|nome\s|matr|data\b/.test(lc)) return;
        // analisa primeiras 30 linhas para classificar
        const sample = rows.slice(0, 30).map((r) => r[col]).filter((v) => v !== "" && v != null);
        if (!sample.length) return;
        const numericVals = sample.map(numeric).filter((n) => n != null && n >= 1 && n <= 5);
        const numericRatio = numericVals.length / sample.length;
        if (numericRatio >= 0.7) {
          numericCols.push(col);
        } else {
          // se a maioria dos valores são strings com >=4 caracteres, conta como texto
          const textVals = sample.filter((v) => typeof v === "string" && v.trim().length >= 3);
          if (textVals.length / sample.length >= 0.3) textCols.push(col);
        }
      });

      // Para cada coluna numérica: calcula média + distribuição 1-5
      const criterios = numericCols.map((col) => {
        const vals = rows.map((r) => numeric(r[col])).filter((v) => v != null && v >= 1 && v <= 5);
        const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, total: vals.length };
        vals.forEach((v) => { dist[Math.round(v)] += 1; });
        const media = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
        return {
          // limpa numeração ("2.   Qual o ponto alto" → "Qual o ponto alto") e dois-pontos finais
          label: col.replace(/^\s*\d+[\.\)]\s*/, "").replace(/[:\s]+$/, "").trim(),
          original: col,
          media,
          dist,
        };
      });

      // Classifica colunas textuais por finalidade pelo cabeçalho
      const matcher = {
        altos: /ponto.*alto|destaque|positiv|gost|alto.*ponto/i,
        melhorias: /melhor|ruim|negativ|dificul|crít/i,
        sugestoes: /sugest|tema|próxim|proxim|futur/i,
        comentarios: /coment|observa|livr|geral|outr/i,
      };
      const textosBy = { altos: [], melhorias: [], sugestoes: [], comentarios: [] };
      const usedTextCols = new Set();
      textCols.forEach((col) => {
        for (const key of ["altos", "melhorias", "sugestoes", "comentarios"]) {
          if (matcher[key].test(col)) {
            const vals = rows.map((r) => String(r[col] || "").trim()).filter((v) => v);
            textosBy[key] = textosBy[key].concat(vals);
            usedTextCols.add(col);
            break;
          }
        }
      });
      // Colunas textuais não classificadas viram comentários gerais
      textCols.filter((c) => !usedTextCols.has(c)).forEach((col) => {
        const vals = rows.map((r) => String(r[col] || "").trim()).filter((v) => v);
        textosBy.comentarios = textosBy.comentarios.concat(vals);
      });

      // Recomendação: tenta achar critério "recomend*"; se não, usa o critério com maior média
      // (proxy) para o texto da conclusão.
      let recIdx = criterios.findIndex((c) => /recomend/i.test(c.original));
      let recomendacao = recIdx >= 0 ? criterios[recIdx] : null;

      state.autoReport.pesquisa = {
        fileName: file.name,
        respostas: rows.length,
        criterios,            // [{label, media, dist}, ...] — qualquer quantidade
        recomendacao,         // critério "recomend*" se existir; senão null
        textos: textosBy,
        temas: {
          altos:      extractThemes(textosBy.altos),
          melhorias:  extractThemes(textosBy.melhorias),
          sugestoes:  extractThemes(textosBy.sugestoes),
        },
      };

      const resumoCriterios = criterios.slice(0, 3)
        .map((c) => `${c.label.slice(0, 18)}=${c.media.toFixed(2)}`).join(" · ");
      document.getElementById("arDropPesq").classList.add("has-file");
      document.getElementById("arDropPesqTitle").textContent = file.name;
      document.getElementById("arDropPesqSub").textContent =
        `${rows.length} respostas · ${criterios.length} critérios · ${resumoCriterios}`;
      updateAutoReportSummary();
    } catch (err) {
      document.getElementById("arDropPesqTitle").textContent = "Erro ao ler planilha";
      document.getElementById("arDropPesqSub").textContent = err.message;
    }
  };
  reader.readAsArrayBuffer(file);
}

// ---------------- Extração automática de temas (NLP simples) ----------------
const PT_STOPWORDS = new Set([
  "a","o","e","de","da","do","das","dos","em","no","na","nos","nas","um","uma","uns","umas",
  "para","com","por","pelo","pela","pelos","pelas","que","se","ao","aos","à","às",
  "mas","ou","como","quando","onde","então","ja","já","mais","muito","muita","muitos","muitas",
  "também","tambem","só","so","ser","sao","são","foi","foram","tem","têm","tinha","ter","tive",
  "este","esta","esse","essa","isto","isso","aquilo","aquele","aquela","seu","sua","seus","suas",
  "meu","minha","nosso","nossa","todo","toda","todos","todas","outro","outra","outros","outras",
  "não","nao","sim","poder","pode","ainda","já","la","lá","aqui","ali",
  "do","sobre","entre","até","após","antes","contra","sem","sob","durante",
  "evento","eventos","palestra","palestras","atividade","atividades",
  "achei","gostei","acho","gosto","fica","ficar","ficou","houve",
  "boa","bom","boas","bons","melhor","melhores","ótima","otima","ótimo","otimo","ótimas","otimas","ótimos","otimos",
  "tudo","nada","alguma","algum","algumas","alguns","cada","quem","qual","quais",
  "estar","estou","estamos","está","esta","estão","estao",
  "vez","vezes","dia","dias","mês","meses","ano","anos","hora","horas","tempo",
]);

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Lematização simples para PT-BR: unifica plural/singular e variações comuns.
// "curso" e "cursos" → "curso"; "capacitações" → "capacitacao"; etc.
function lemmatize(w) {
  if (w.length < 4) return w;
  // -ções/-coes → -cao
  if (w.endsWith("coes")) return w.slice(0, -4) + "cao";
  // -ões → -ao
  if (w.endsWith("oes")) return w.slice(0, -3) + "ao";
  // -ais → -al (animais → animal)
  if (w.endsWith("ais")) return w.slice(0, -3) + "al";
  // -eis → -el
  if (w.endsWith("eis")) return w.slice(0, -3) + "el";
  // -is → -il (lápis fica de fora pelo length, gentis → gentil)
  if (w.endsWith("is") && w.length >= 5) return w.slice(0, -2) + "il";
  // -res → -r (servidores → servidor)
  if (w.endsWith("res")) return w.slice(0, -2);
  // plural simples -s (mas evita palavras tipo "menos", "antes", "talvez")
  if (w.endsWith("s") && !["os", "as", "is", "es", "us"].includes(w.slice(-2)) || (w.endsWith("os") || w.endsWith("as"))) {
    return w.slice(0, -1);
  }
  return w;
}

function titleCase(s) {
  return s.split(" ").map((w) =>
    w.length >= 3 ? w[0].toUpperCase() + w.slice(1) : w
  ).join(" ");
}

function extractThemes(responses, max = 10) {
  if (!Array.isArray(responses) || !responses.length) return [];
  const counts = new Map();
  responses.forEach((r) => {
    const norm = normalizeText(r);
    // Aplica lematização para unificar curso/cursos, capacitação/capacitações etc.
    const words = norm.split(" ")
      .map(lemmatize)
      .filter((w) => w.length >= 4 && !PT_STOPWORDS.has(w));
    // unigramas (uma vez por resposta)
    const seenU = new Set();
    words.forEach((w) => {
      if (seenU.has(w)) return;
      seenU.add(w);
      counts.set(w, (counts.get(w) || 0) + 1);
    });
    // bigramas (mais informativos)
    const seenB = new Set();
    for (let i = 0; i < words.length - 1; i++) {
      const bg = words[i] + " " + words[i + 1];
      if (seenB.has(bg)) continue;
      seenB.add(bg);
      counts.set(bg, (counts.get(bg) || 0) + 1);
    }
  });

  // Inclui inclusive menções únicas (count >= 1), ordenado por contagem
  // (bigramas têm prioridade em empate)
  const entries = [...counts.entries()]
    .filter(([k, v]) => v >= 1)
    .sort((a, b) => {
      const aBg = a[0].includes(" ") ? 1 : 0;
      const bBg = b[0].includes(" ") ? 1 : 0;
      return b[1] - a[1] || bBg - aBg;
    });

  const picked = [];
  const usedTokens = new Set();
  for (const [k, v] of entries) {
    const tokens = k.split(" ");
    // Evita repetir tema (ex: "painel" e "paineis conteudo" — escolhe o bigrama)
    if (tokens.some((t) => usedTokens.has(t))) continue;
    picked.push({ label: titleCase(k), value: v });
    tokens.forEach((t) => usedTokens.add(t));
    if (picked.length >= max) break;
  }
  return picked;
}

// ---------------- Geração do PDF ----------------
function parseCategorias(txt) {
  // Aceita "Nome: 5" ou "Nome - 5" por linha
  return String(txt || "").split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(.+?)\s*[:\-]\s*(\d+)\s*$/);
      if (m) return { label: m[1].trim(), value: parseInt(m[2], 10) };
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => b.value - a.value);
}

async function renderChartToImage(type, config, width = 700, height = 400) {
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.style.position = "fixed";
    canvas.style.left = "-9999px";
    document.body.appendChild(canvas);
    const chart = new window.Chart(canvas, {
      type,
      data: config.data,
      options: {
        ...config.options,
        responsive: false,
        animation: false,
        devicePixelRatio: 2,
      },
    });
    // espera o desenho concluir
    setTimeout(() => {
      const img = canvas.toDataURL("image/png");
      chart.destroy();
      canvas.remove();
      resolve(img);
    }, 60);
  });
}

async function generateSatisfacaoPdf() {
  const s = state.autoReport;
  const status = document.getElementById("arStatus");
  status.className = "auto-report-status";
  status.textContent = "Validando dados...";

  if (!s.participantes) { status.classList.add("is-error"); status.textContent = "Faça upload da planilha de participantes."; return; }
  if (!s.pesquisa) { status.classList.add("is-error"); status.textContent = "Faça upload da pesquisa de satisfação."; return; }

  // Tudo extraído da planilha de participantes
  const evento = s.participantes.evento;
  const cap = s.participantes.capacidade;
  const intro = `O presente relatório tem por finalidade apresentar a análise do evento "${evento}", promovido pela ${AR_CONFIG.orgao}.\n\nOs gráficos e indicadores apresentados nas seções subsequentes fornecem subsídios estratégicos para a compreensão do nível de engajamento, da qualidade percebida pelos participantes e das perspectivas de aprimoramento, permitindo à gestão pública delinear ações futuras com maior assertividade e aderência às demandas identificadas.`;

  status.classList.remove("is-error");
  status.textContent = "Gerando gráficos...";

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 20;     // margem
  const W = pageW - M * 2;
  let y = 0;
  let pageNum = 0;

  const drawHeader = () => {
    pageNum += 1;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(22, 31, 54);
    doc.text("PREFEITURA MUNICIPAL DE PEDRO LEOPOLDO", pageW / 2, 14, { align: "center" });
    doc.setFontSize(9);
    doc.text("SECRETARIA MUNICIPAL DE GESTÃO E FINANÇAS", pageW / 2, 19, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.text("DIRETORIA DE GESTÃO DE PESSOAS", pageW / 2, 24, { align: "center" });
    doc.setDrawColor(48, 99, 173);
    doc.setLineWidth(0.5);
    doc.line(M, 28, pageW - M, 28);
    y = 36;
  };

  const drawFooter = () => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text(String(pageNum), pageW / 2, pageH - 10, { align: "center" });
  };

  const newPage = () => {
    drawFooter();
    doc.addPage();
    drawHeader();
  };

  const ensureSpace = (needed) => {
    if (y + needed > pageH - 18) newPage();
  };

  const justified = (text, lineHeight = 5.2) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(40, 40, 40);
    const lines = doc.splitTextToSize(text, W);
    lines.forEach((ln) => {
      ensureSpace(lineHeight + 1);
      doc.text(ln, M, y);
      y += lineHeight;
    });
    y += 2;
  };

  const sectionTitle = (txt) => {
    ensureSpace(12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(22, 31, 54);
    doc.text(txt, M, y);
    y += 7;
  };

  const bullet = (txt, marker = "➢") => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(40, 40, 40);
    const lines = doc.splitTextToSize(txt, W - 8);
    ensureSpace(lines.length * 5.2 + 1);
    doc.setFont("helvetica", "bold");
    doc.text(marker, M, y);
    doc.setFont("helvetica", "normal");
    lines.forEach((ln, i) => {
      doc.text(ln, M + 6, y);
      if (i < lines.length - 1) y += 5.2;
    });
    y += 6;
  };

  // ===== PÁGINA 1: capa + Gráfico 1 =====
  drawHeader();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(22, 31, 54);
  doc.text(`Relatório - Evento ${evento}`, M, y);
  y += 9;
  justified(intro);

  // Gráfico 1: participação no evento
  status.textContent = "Renderizando Gráfico 1...";
  const inscritos = s.participantes.totalInscritos;
  const presentes = s.participantes.totalPresentes;
  const ausentes = s.participantes.totalAusentes;
  const naoAdquiridos = cap - inscritos;
  const taxaPresenca = ((presentes / inscritos) * 100).toFixed(1);

  // Paleta padrão Excel (mesma família do PDF de referência)
  const EXCEL = {
    blue:       "#4472C4",
    orange:     "#ED7D31",
    gray:       "#A5A5A5",
    yellow:     "#FFC000",
    lightblue:  "#5B9BD5",
    green:      "#70AD47",
    darkblue:   "#264478",
    darkgreen:  "#43682B",
  };
  const EXCEL_FONT = { family: "Calibri, 'Carlito', Arial, sans-serif" };

  const g1Img = await renderChartToImage("doughnut", {
    data: {
      labels: ["Presentes", "Ausentes", "Ingressos não adquiridos"],
      datasets: [{
        data: [presentes, ausentes, naoAdquiridos],
        backgroundColor: [EXCEL.blue, EXCEL.orange, EXCEL.gray],
        borderWidth: 2,
        borderColor: "#fff",
      }],
    },
    options: {
      plugins: {
        legend: { position: "bottom", labels: { font: { size: 13, family: EXCEL_FONT.family }, color: "#000" } },
        title: { display: true, text: "Gráfico 1 - Participação no evento", font: { size: 14, weight: "bold", family: EXCEL_FONT.family }, color: "#000" },
      },
    },
  }, 700, 460);

  ensureSpace(110);
  doc.addImage(g1Img, "PNG", M + 20, y, W - 40, 95);
  y += 100;

  justified(`O gráfico acima apresenta a consolidação das presenças confirmadas no evento.`);
  justified(`Foram disponibilizados ${cap} ingressos. Destes, ${inscritos} foram adquiridos e ${naoAdquiridos} não foram retirados. Dos participantes inscritos, ${presentes} estiveram presentes e ${ausentes} não compareceram.`);
  justified(`Sob a perspectiva dos ingressos adquiridos, a taxa de presença alcança ${taxaPresenca.replace(".", ",")}% (${presentes}/${inscritos}). O formulário de satisfação recebeu ${s.pesquisa.respostas} respostas.`);

  // ===== PÁGINA 2: Gráfico 2 - médias =====
  newPage();
  status.textContent = "Renderizando Gráfico 2...";
  const criterios = s.pesquisa.criterios || [];
  if (!criterios.length) throw new Error("Nenhum critério numérico (escala 1-5) encontrado na pesquisa.");

  // Quebra rótulos longos em até 3 linhas para o gráfico de barras
  const wrapLabel = (txt, max = 16) => {
    const words = txt.split(/\s+/);
    const lines = [""];
    words.forEach((w) => {
      if ((lines[lines.length - 1] + " " + w).trim().length > max) lines.push(w);
      else lines[lines.length - 1] = (lines[lines.length - 1] + " " + w).trim();
    });
    return lines.slice(0, 3);
  };

  const palette = [EXCEL.blue, EXCEL.orange, EXCEL.gray, EXCEL.yellow, EXCEL.lightblue, EXCEL.green, EXCEL.darkblue, EXCEL.darkgreen];
  const g2Img = await renderChartToImage("bar", {
    data: {
      labels: criterios.map((c) => wrapLabel(c.label)),
      datasets: [{
        label: "Média (1 a 5)",
        data: criterios.map((c) => Number(c.media.toFixed(2))),
        backgroundColor: criterios.map((_, i) => palette[i % palette.length]),
        borderColor: "#fff",
        borderWidth: 1,
      }],
    },
    options: {
      scales: {
        y: { beginAtZero: true, max: 5, ticks: { stepSize: 1, font: { family: EXCEL_FONT.family } }, grid: { color: "#d9d9d9" } },
        x: { ticks: { font: { family: EXCEL_FONT.family, size: 11 } }, grid: { display: false } },
      },
      plugins: {
        legend: { display: false },
        title: { display: true, text: "Gráfico 2 - Médias das avaliações", font: { size: 14, weight: "bold", family: EXCEL_FONT.family }, color: "#000" },
      },
    },
  }, 700, 420);
  ensureSpace(95);
  doc.addImage(g2Img, "PNG", M, y, W, 85);
  y += 90;

  const respostas = s.pesquisa.respostas;
  justified(`Foram coletadas ${respostas} respostas ao formulário de satisfação. As avaliações apresentam médias elevadas nos critérios analisados (escala de 1 a 5):`);
  criterios.forEach((c) => {
    bullet(`${c.label}: média de ${c.media.toFixed(2).replace(".", ",")};`);
  });

  // Tabela Nota 4 / Nota 5 — dinâmica para todos os critérios
  ensureSpace(40);
  const buildRow = (label, n) => {
    const t = Math.max(n.total, 1);
    const p4 = n[4] ? ` (${((n[4] / t) * 100).toFixed(1).replace(".", ",")}%)` : "";
    const p5 = n[5] ? ` (${((n[5] / t) * 100).toFixed(1).replace(".", ",")}%)` : "";
    return [label, `${n[4]}${p4}`, `${n[5]}${p5}`];
  };
  doc.autoTable({
    startY: y,
    head: [["Critério", "Nota 4", "Nota 5"]],
    body: criterios.map((c) => buildRow(c.label, c.dist)),
    styles: { fontSize: 10, cellPadding: 3 },
    headStyles: { fillColor: [48, 99, 173], textColor: 255 },
    margin: { left: M, right: M },
  });
  y = doc.lastAutoTable.finalY + 6;

  // Análise: usa critério "recomend*" se existir, senão usa o de maior média
  const destaque = s.pesquisa.recomendacao || criterios.reduce((a, b) => a.media >= b.media ? a : b);
  const destPct = ((destaque.dist[5] / Math.max(destaque.dist.total, 1)) * 100).toFixed(1).replace(".", ",");
  justified(`A uniformidade dos resultados indica satisfação elevada e consistente do público em todos os aspectos avaliados. O critério "${destaque.label}" obteve ${destPct}% de notas máximas, reforçando a percepção positiva da iniciativa.`);

  // ===== PÁGINAS 3-5: análises qualitativas =====
  const renderCategoryChart = async (titulo, cats, cor) => {
    if (!cats.length) return;
    const img = await renderChartToImage("bar", {
      data: {
        labels: cats.map((c) => c.label),
        datasets: [{
          label: "Menções",
          data: cats.map((c) => c.value),
          backgroundColor: cor,
          borderColor: "#fff",
          borderWidth: 1,
        }],
      },
      options: {
        indexAxis: "y",
        scales: {
          x: { beginAtZero: true, ticks: { stepSize: 1, font: { family: EXCEL_FONT.family } }, grid: { color: "#d9d9d9" } },
          y: { ticks: { font: { family: EXCEL_FONT.family, size: 11 } }, grid: { display: false } },
        },
        plugins: {
          legend: { display: false },
          title: { display: true, text: titulo, font: { size: 14, weight: "bold", family: EXCEL_FONT.family }, color: "#000" },
        },
      },
    }, 700, 80 + cats.length * 32);
    newPage();
    ensureSpace(95);
    const h = Math.min(140, 36 + cats.length * 11);
    doc.addImage(img, "PNG", M, y, W, h);
    y += h + 4;
  };

  status.textContent = "Renderizando Gráficos 3-5...";
  const cAltos = s.pesquisa.temas?.altos || [];
  const cMelhor = s.pesquisa.temas?.melhorias || [];
  const cSugest = s.pesquisa.temas?.sugestoes || [];

  if (cAltos.length) {
    await renderCategoryChart("Gráfico 3 - Principais pontos altos", cAltos, EXCEL.blue);
    justified(`A análise qualitativa das respostas evidencia que os principais pontos altos do evento foram ${cAltos.slice(0, 2).map((c) => `${c.label} (${c.value} ${c.value === 1 ? "menção" : "menções"})`).join(" e ")}, demonstrando a valorização desses aspectos pelo público.`);
  }
  if (cMelhor.length) {
    await renderCategoryChart("Gráfico 4 - O que pode ser melhorado?", cMelhor, EXCEL.orange);
    justified(`A principal oportunidade de melhoria identificada é ${cMelhor[0].label.toLowerCase()} (${cMelhor[0].value} ${cMelhor[0].value === 1 ? "menção" : "menções"}).`);
    if (cMelhor.length > 1) {
      justified("Também foram apontadas:");
      cMelhor.slice(1).forEach((c) => bullet(`${c.label} (${c.value} ${c.value === 1 ? "menção" : "menções"});`));
    }
  }
  if (cSugest.length) {
    await renderCategoryChart("Gráfico 5 - Sugestões de temas para as próximas ações", cSugest, EXCEL.lightblue);
    justified(`A análise das sugestões evidencia maior interesse em ${cSugest.slice(0, 2).map((c) => c.label).join(" e ")}, sinalizando prioridade nesses temas.`);
    if (cSugest.length > 2) {
      justified("Também foram sugeridos:");
      cSugest.slice(2).forEach((c) => bullet(`${c.label};`));
    }
  }

  // ===== COMENTÁRIOS =====
  // Usa coluna "comentarios" se existir; senão recolhe as respostas mais
  // expressivas (>30 chars) das outras colunas textuais como destaque.
  let comentarios = (s.pesquisa.textos.comentarios || []).filter((t) => t.length > 8);
  if (!comentarios.length) {
    const all = [
      ...(s.pesquisa.textos.altos || []),
      ...(s.pesquisa.textos.melhorias || []),
      ...(s.pesquisa.textos.sugestoes || []),
    ];
    comentarios = all
      .filter((t) => t.length > 30)
      .sort((a, b) => b.length - a.length)
      .slice(0, 8);
  } else {
    comentarios = comentarios.slice(0, 8);
  }
  if (comentarios.length) {
    ensureSpace(20);
    sectionTitle("Comentários e Sugestões dos Participantes");
    justified("Os comentários livres registrados no formulário refletem a percepção dos participantes. Destacam-se:");
    comentarios.forEach((c) => bullet(`"${c}"`, "•"));
  }

  // ===== CONCLUSÃO (gerada automaticamente das métricas) =====
  newPage();
  sectionTitle("Conclusão");
  const minMedia = criterios.length ? Math.min(...criterios.map((c) => c.media)) : 5;
  const conclusaoAuto =
    `Com base na pesquisa de satisfação aplicada ao público-alvo, os dados evidenciam que o evento alcançou elevado nível de aprovação, com médias superiores a ${minMedia.toFixed(2).replace(".", ",")} em todos os ${criterios.length} critérios avaliados (escala de 1 a 5). A taxa de presença de ${taxaPresenca.replace(".", ",")}% das inscrições reforça o engajamento do público com a iniciativa.`;
  justified(conclusaoAuto);

  if (cSugest.length) {
    justified(`Os resultados sinalizam demanda por ações contínuas voltadas aos temas mais recorrentes nas sugestões dos participantes — em especial ${cSugest.slice(0, 2).map((c) => c.label).join(" e ")}. Recomenda-se considerar essas temáticas como eixo permanente nas atividades de capacitação da e-Gov PL.`);
  }
  justified(`Conclui-se que a iniciativa cumpriu seu objetivo de promover um espaço de valorização, troca e formação para os servidores municipais, consolidando-se como ação estratégica da ${AR_CONFIG.orgao}. A continuidade e a institucionalização desse tipo de evento são fortemente recomendadas.`);

  // Assinatura (apenas cargo institucional — sem nome digitado)
  y += 24;
  ensureSpace(20);
  // linha para assinatura manuscrita
  doc.setDrawColor(100, 100, 100);
  doc.setLineWidth(0.3);
  doc.line(pageW / 2 - 40, y, pageW / 2 + 40, y);
  y += 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(22, 31, 54);
  doc.text(AR_CONFIG.assinaturaCargo, pageW / 2, y, { align: "center" });

  drawFooter();
  const slug = (evento || "evento").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  doc.save(`Relatorio Satisfacao - ${slug}.pdf`);

  status.classList.add("is-success");
  status.textContent = `Relatório "${evento}" gerado!`;
}

// ---------------- Geração do DOCX ----------------
function dataUrlToUint8(dataUrl) {
  const base64 = dataUrl.split(",")[1];
  const bin = atob(base64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function generateSatisfacaoDocx() {
  const s = state.autoReport;
  const status = document.getElementById("arStatus");
  status.className = "auto-report-status";

  if (!s.participantes) { status.classList.add("is-error"); status.textContent = "Faça upload da planilha de participantes."; return; }
  if (!s.pesquisa) { status.classList.add("is-error"); status.textContent = "Faça upload da pesquisa de satisfação."; return; }
  if (!window.docx) { status.classList.add("is-error"); status.textContent = "Biblioteca docx não carregou. Recarregue a página."; return; }

  status.classList.remove("is-error");
  status.textContent = "Gerando DOCX...";

  const D = window.docx;
  const {
    Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, AlignmentType,
    Table, TableRow, TableCell, BorderStyle, WidthType, PageNumber, Header, Footer, PageBreak,
  } = D;

  const evento = s.participantes.evento;
  const cap = s.participantes.capacidade;
  const inscritos = s.participantes.totalInscritos;
  const presentes = s.participantes.totalPresentes;
  const ausentes = s.participantes.totalAusentes;
  const naoAdquiridos = cap - inscritos;
  const taxaPresenca = ((presentes / inscritos) * 100).toFixed(1).replace(".", ",");
  const criterios = s.pesquisa.criterios || [];
  if (!criterios.length) { status.classList.add("is-error"); status.textContent = "Pesquisa sem critérios numéricos detectados."; return; }
  const respostas = s.pesquisa.respostas;
  const destaque = s.pesquisa.recomendacao || criterios.reduce((a, b) => a.media >= b.media ? a : b);
  const destPct = ((destaque.dist[5] / Math.max(destaque.dist.total, 1)) * 100).toFixed(1).replace(".", ",");
  const minMedia = Math.min(...criterios.map((c) => c.media));
  // Paleta padrão Excel (mesma família do PDF de referência)
  const EXCEL = {
    blue: "#4472C4", orange: "#ED7D31", gray: "#A5A5A5",
    yellow: "#FFC000", lightblue: "#5B9BD5", green: "#70AD47",
    darkblue: "#264478", darkgreen: "#43682B",
  };
  const EXCEL_FONT_FAMILY = "Calibri, 'Carlito', Arial, sans-serif";
  const palette = [EXCEL.blue, EXCEL.orange, EXCEL.gray, EXCEL.yellow, EXCEL.lightblue, EXCEL.green, EXCEL.darkblue, EXCEL.darkgreen];

  // Renderiza Charts em PNG
  status.textContent = "Renderizando Gráfico 1...";
  const g1 = await renderChartToImage("doughnut", {
    data: {
      labels: ["Presentes", "Ausentes", "Ingressos não adquiridos"],
      datasets: [{
        data: [presentes, ausentes, naoAdquiridos],
        backgroundColor: [EXCEL.blue, EXCEL.orange, EXCEL.gray],
        borderWidth: 2, borderColor: "#fff",
      }],
    },
    options: {
      plugins: {
        legend: { position: "bottom", labels: { font: { size: 13, family: EXCEL_FONT_FAMILY }, color: "#000" } },
        title: { display: true, text: "Gráfico 1 - Participação no evento", font: { size: 14, weight: "bold", family: EXCEL_FONT_FAMILY }, color: "#000" },
      },
    },
  }, 700, 460);

  status.textContent = "Renderizando Gráfico 2...";
  const wrapLabel = (txt, max = 16) => {
    const words = txt.split(/\s+/);
    const lines = [""];
    words.forEach((w) => {
      if ((lines[lines.length - 1] + " " + w).trim().length > max) lines.push(w);
      else lines[lines.length - 1] = (lines[lines.length - 1] + " " + w).trim();
    });
    return lines.slice(0, 3);
  };
  const g2 = await renderChartToImage("bar", {
    data: {
      labels: criterios.map((c) => wrapLabel(c.label)),
      datasets: [{
        label: "Média (1 a 5)",
        data: criterios.map((c) => Number(c.media.toFixed(2))),
        backgroundColor: criterios.map((_, i) => palette[i % palette.length]),
        borderColor: "#fff",
        borderWidth: 1,
      }],
    },
    options: {
      scales: {
        y: { beginAtZero: true, max: 5, ticks: { stepSize: 1, font: { family: EXCEL_FONT_FAMILY } }, grid: { color: "#d9d9d9" } },
        x: { ticks: { font: { family: EXCEL_FONT_FAMILY, size: 11 } }, grid: { display: false } },
      },
      plugins: {
        legend: { display: false },
        title: { display: true, text: "Gráfico 2 - Médias das avaliações", font: { size: 14, weight: "bold", family: EXCEL_FONT_FAMILY }, color: "#000" },
      },
    },
  }, 700, 420);

  status.textContent = "Renderizando Gráficos 3-5...";
  const cAltos = s.pesquisa.temas?.altos || [];
  const cMelhor = s.pesquisa.temas?.melhorias || [];
  const cSugest = s.pesquisa.temas?.sugestoes || [];
  const renderCat = async (titulo, cats, cor) => {
    if (!cats.length) return null;
    return renderChartToImage("bar", {
      data: {
        labels: cats.map((c) => c.label),
        datasets: [{
          label: "Menções",
          data: cats.map((c) => c.value),
          backgroundColor: cor,
          borderColor: "#fff",
          borderWidth: 1,
        }],
      },
      options: {
        indexAxis: "y",
        scales: {
          x: { beginAtZero: true, ticks: { stepSize: 1, font: { family: EXCEL_FONT_FAMILY } }, grid: { color: "#d9d9d9" } },
          y: { ticks: { font: { family: EXCEL_FONT_FAMILY, size: 11 } }, grid: { display: false } },
        },
        plugins: {
          legend: { display: false },
          title: { display: true, text: titulo, font: { size: 14, weight: "bold", family: EXCEL_FONT_FAMILY }, color: "#000" },
        },
      },
    }, 700, 80 + cats.length * 32);
  };
  const g3 = await renderCat("Gráfico 3 - Principais pontos altos", cAltos, EXCEL.blue);
  const g4 = await renderCat("Gráfico 4 - O que pode ser melhorado?", cMelhor, EXCEL.orange);
  const g5 = await renderCat("Gráfico 5 - Sugestões de temas para as próximas ações", cSugest, EXCEL.lightblue);

  status.textContent = "Montando documento Word...";

  // Helpers
  const para = (text, opts = {}) => new Paragraph({
    spacing: { before: 80, after: 100, line: 320 },
    alignment: opts.align || AlignmentType.JUSTIFIED,
    children: [new TextRun({ text, bold: opts.bold, size: opts.size || 22, color: opts.color || "1F2A48", italics: opts.italic })],
  });
  const heading = (text) => new Paragraph({
    spacing: { before: 240, after: 120 },
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, bold: true, size: 26, color: "161F36" })],
  });
  const bullet = (text, marker = "➢") => new Paragraph({
    spacing: { before: 40, after: 60 },
    indent: { left: 360 },
    children: [
      new TextRun({ text: `${marker}  `, bold: true, size: 22 }),
      new TextRun({ text, size: 22, color: "1F2A48" }),
    ],
  });
  const imgPara = (dataUrl, w, h) => new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 120 },
    children: [new ImageRun({ data: dataUrlToUint8(dataUrl), transformation: { width: w, height: h } })],
  });
  const titleSection = (text) => new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: 200, after: 160 },
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, bold: true, size: 32, color: "161F36" })],
  });

  // Tabela Nota 4 / Nota 5
  const cellTxt = (txt, opts = {}) => new TableCell({
    width: { size: opts.size || 33, type: WidthType.PERCENTAGE },
    shading: opts.shading ? { fill: opts.shading } : undefined,
    children: [new Paragraph({
      alignment: opts.align || AlignmentType.LEFT,
      children: [new TextRun({ text: txt, bold: opts.bold, color: opts.color || "1F2A48", size: 22 })],
    })],
  });
  const fmtCount = (n, total) => {
    const pct = total ? ` (${((n / total) * 100).toFixed(1).replace(".", ",")}%)` : "";
    return `${n}${pct}`;
  };
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      cellTxt("Critério", { shading: "3063AD", color: "FFFFFF", bold: true }),
      cellTxt("Nota 4", { shading: "3063AD", color: "FFFFFF", bold: true, align: AlignmentType.CENTER }),
      cellTxt("Nota 5", { shading: "3063AD", color: "FFFFFF", bold: true, align: AlignmentType.CENTER }),
    ],
  });
  const dataRows = criterios.map((c) => new TableRow({
    children: [
      cellTxt(c.label),
      cellTxt(fmtCount(c.dist[4], c.dist.total), { align: AlignmentType.CENTER }),
      cellTxt(fmtCount(c.dist[5], c.dist.total), { align: AlignmentType.CENTER }),
    ],
  }));
  const tabelaNotas = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
  });

  // Header e Footer institucionais
  const headerInst = new Header({
    children: AR_CONFIG.cabecalho.map((t, i) => new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [new TextRun({ text: t, bold: i < 2, size: i === 0 ? 20 : 18, color: "161F36" })],
    })),
  });
  const footerInst = new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "888888" }),
      ],
    })],
  });

  // Conteúdo
  const children = [];
  children.push(titleSection(`Relatório - Evento ${evento}`));
  para(`O presente relatório tem por finalidade apresentar a análise do evento "${evento}", promovido pela ${AR_CONFIG.orgao}.`).children && children.push(para(`O presente relatório tem por finalidade apresentar a análise do evento "${evento}", promovido pela ${AR_CONFIG.orgao}.`));
  children.push(para(`Os gráficos e indicadores apresentados nas seções subsequentes fornecem subsídios estratégicos para a compreensão do nível de engajamento, da qualidade percebida pelos participantes e das perspectivas de aprimoramento, permitindo à gestão pública delinear ações futuras com maior assertividade e aderência às demandas identificadas.`));

  children.push(imgPara(g1, 480, 320));
  children.push(para("O gráfico acima apresenta a consolidação das presenças confirmadas no evento."));
  children.push(para(`Foram disponibilizados ${cap} ingressos. Destes, ${inscritos} foram adquiridos e ${naoAdquiridos} não foram retirados. Dos participantes inscritos, ${presentes} estiveram presentes e ${ausentes} não compareceram.`));
  children.push(para(`Sob a perspectiva dos ingressos adquiridos, a taxa de presença alcança ${taxaPresenca}% (${presentes}/${inscritos}). O formulário de satisfação recebeu ${respostas} respostas.`));

  // Gráfico 2
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(imgPara(g2, 540, 320));
  children.push(para(`Foram coletadas ${respostas} respostas ao formulário de satisfação. As avaliações apresentam médias elevadas nos critérios analisados (escala de 1 a 5):`));
  criterios.forEach((c) => children.push(bullet(`${c.label}: média de ${c.media.toFixed(2).replace(".", ",")};`)));
  children.push(tabelaNotas);
  children.push(para(`A uniformidade dos resultados indica satisfação elevada e consistente do público em todos os aspectos avaliados. O critério "${destaque.label}" obteve ${destPct}% de notas máximas, reforçando a percepção positiva da iniciativa.`));

  // Gráficos 3-5
  if (g3) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    const h = Math.min(420, 120 + cAltos.length * 40);
    children.push(imgPara(g3, 540, h));
    children.push(para(`A análise qualitativa das respostas evidencia que os principais pontos altos do evento foram ${cAltos.slice(0, 2).map((c) => `${c.label} (${c.value} menções)`).join(" e ")}, demonstrando a valorização desses aspectos pelo público.`));
  }
  if (g4) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    const h = Math.min(420, 120 + cMelhor.length * 40);
    children.push(imgPara(g4, 540, h));
    children.push(para(`A principal oportunidade de melhoria identificada é ${cMelhor[0].label.toLowerCase()} (${cMelhor[0].value} menções).`));
    if (cMelhor.length > 1) {
      children.push(para("Também foram apontadas:"));
      cMelhor.slice(1).forEach((c) => children.push(bullet(`${c.label} (${c.value} menções);`)));
    }
  }
  if (g5) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    const h = Math.min(420, 120 + cSugest.length * 40);
    children.push(imgPara(g5, 540, h));
    children.push(para(`A análise das sugestões evidencia maior interesse em ${cSugest.slice(0, 2).map((c) => c.label).join(" e ")}, sinalizando prioridade nesses temas.`));
    if (cSugest.length > 2) {
      children.push(para("Também foram sugeridos:"));
      cSugest.slice(2).forEach((c) => children.push(bullet(`${c.label};`)));
    }
  }

  // Comentários
  let comentarios = (s.pesquisa.textos.comentarios || []).filter((t) => t.length > 8);
  if (!comentarios.length) {
    comentarios = [
      ...(s.pesquisa.textos.altos || []),
      ...(s.pesquisa.textos.melhorias || []),
      ...(s.pesquisa.textos.sugestoes || []),
    ].filter((t) => t.length > 30).sort((a, b) => b.length - a.length).slice(0, 8);
  } else {
    comentarios = comentarios.slice(0, 8);
  }
  if (comentarios.length) {
    children.push(heading("Comentários e Sugestões dos Participantes"));
    children.push(para("Os comentários livres registrados no formulário refletem a percepção dos participantes. Destacam-se:"));
    comentarios.forEach((c) => children.push(bullet(`"${c}"`, "•")));
  }

  // Conclusão
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(heading("Conclusão"));
  children.push(para(`Com base na pesquisa de satisfação aplicada ao público-alvo, os dados evidenciam que o evento alcançou elevado nível de aprovação, com médias superiores a ${minMedia.toFixed(2).replace(".", ",")} em todos os ${criterios.length} critérios avaliados (escala de 1 a 5). A taxa de presença de ${taxaPresenca}% das inscrições reforça o engajamento do público com a iniciativa.`));
  if (cSugest.length) {
    children.push(para(`Os resultados sinalizam demanda por ações contínuas voltadas aos temas mais recorrentes nas sugestões dos participantes — em especial ${cSugest.slice(0, 2).map((c) => c.label).join(" e ")}. Recomenda-se considerar essas temáticas como eixo permanente nas atividades de capacitação da e-Gov PL.`));
  }
  children.push(para(`Conclui-se que a iniciativa cumpriu seu objetivo de promover um espaço de valorização, troca e formação para os servidores municipais, consolidando-se como ação estratégica da ${AR_CONFIG.orgao}. A continuidade e a institucionalização desse tipo de evento são fortemente recomendadas.`));

  // Assinatura
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 600, after: 60 },
    border: { top: { style: BorderStyle.SINGLE, size: 6, color: "888888" } },
    children: [new TextRun({ text: "" })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 60 },
    children: [new TextRun({ text: AR_CONFIG.assinaturaCargo, bold: true, size: 22, color: "161F36" })],
  }));

  const docDoc = new Document({
    creator: "Escola de Governo - Pedro Leopoldo",
    title: `Relatório de Satisfação - ${evento}`,
    sections: [{
      properties: { page: { margin: { top: 1100, bottom: 1100, left: 1100, right: 1100 } } },
      headers: { default: headerInst },
      footers: { default: footerInst },
      children,
    }],
  });

  const blob = await Packer.toBlob(docDoc);
  const slug = (evento || "evento").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  window.saveAs(blob, `Relatorio Satisfacao - ${slug}.docx`);

  status.classList.add("is-success");
  status.textContent = `DOCX "${evento}" gerado!`;
}
