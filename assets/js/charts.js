/**
 * charts.js - wrappers Chart.js padronizados com a paleta institucional.
 * Cada wrapper verifica se ha dados; se nao houver, renderiza empty state.
 */

export const PALETTE = {
  blue: "#3063ad",
  blueLight: "#6e9bd6",
  blueDark: "#161f36",
  green: "#4dad33",
  greenLight: "#8cd179",
  greenDeep: "#3b9426",
  amber: "#d69a1f",
  red: "#c0392b",
  purple: "#6b4d9e",
  muted: "#6b7180",
  grid: "rgba(22, 31, 54, 0.06)",
  axis: "#9aa3b2",
  series: [
    "#3063ad", "#4dad33", "#d69a1f", "#6b4d9e",
    "#c0392b", "#24417a", "#6bc155", "#9cb8e2", "#8cd179",
  ],
};

// Aplica defaults Chart.js usando tokens institucionais
function applyChartDefaults() {
  if (typeof window === "undefined" || !window.Chart) return;
  const css = getComputedStyle(document.documentElement);
  const textPrimary = css.getPropertyValue("--text-primary").trim() || "#161f36";
  const textMuted = css.getPropertyValue("--text-muted").trim() || "#6b7180";
  window.Chart.defaults.font.family = "Manrope, sans-serif";
  window.Chart.defaults.font.size = 12;
  window.Chart.defaults.color = textPrimary;
  window.Chart.defaults.plugins.legend.labels.color = textMuted;
  window.Chart.defaults.plugins.legend.labels.usePointStyle = true;
  window.Chart.defaults.plugins.legend.labels.boxWidth = 10;
  window.Chart.defaults.plugins.legend.labels.boxHeight = 10;
  window.Chart.defaults.plugins.legend.labels.padding = 16;
  window.Chart.defaults.plugins.tooltip.backgroundColor = "rgba(22,31,54,0.95)";
  window.Chart.defaults.plugins.tooltip.titleFont = { weight: "700", size: 12 };
  window.Chart.defaults.plugins.tooltip.bodyFont = { size: 12 };
  window.Chart.defaults.plugins.tooltip.padding = 12;
  window.Chart.defaults.plugins.tooltip.cornerRadius = 6;
  window.Chart.defaults.plugins.tooltip.boxPadding = 6;
  window.Chart.defaults.plugins.tooltip.usePointStyle = true;
  window.Chart.defaults.elements.bar.borderRadius = 6;
  window.Chart.defaults.elements.bar.borderSkipped = false;
}
applyChartDefaults();

const _instances = new Map();

export function destroy(id) {
  if (_instances.has(id)) {
    _instances.get(id).destroy();
    _instances.delete(id);
  }
}

export function destroyAll() {
  for (const [k] of _instances) destroy(k);
}

function emptyState(canvas, message = "Sem dados para exibir") {
  if (!canvas) return;
  // Render empty state no parent (substitui o canvas visualmente)
  const parent = canvas.parentElement;
  if (!parent) return;
  parent.innerHTML = `
    <div class="chart-empty">
      <i class="fas fa-chart-pie"></i>
      <p>${message}</p>
    </div>`;
}

function _mount(id, config, isEmpty, emptyMsg) {
  destroy(id);
  const canvas = document.getElementById(id);
  if (!canvas) return null;
  // Restore canvas if it was replaced by empty state previously
  // (the parent might no longer contain the canvas)
  if (!document.getElementById(id)) return null;
  if (isEmpty) {
    emptyState(canvas, emptyMsg);
    return null;
  }
  applyChartDefaults();
  const chart = new window.Chart(canvas, config);
  _instances.set(id, chart);
  return chart;
}

// Helpers
function shorten(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "..." : s;
}
function formatShortDate(iso) {
  if (!iso) return "";
  const parts = String(iso).split("-");
  if (parts.length < 3) return iso;
  return `${parts[2]}/${parts[1]}`;
}

const baseScales = () => ({
  x: {
    grid: { display: false },
    border: { display: false },
    ticks: { color: PALETTE.axis, font: { size: 11 }, autoSkip: true, maxRotation: 0 },
  },
  y: {
    beginAtZero: true,
    grid: { color: PALETTE.grid, drawTicks: false },
    border: { display: false },
    ticks: { color: PALETTE.axis, font: { size: 11 }, padding: 8 },
  },
});

// ============================================================================
// Chart builders
// ============================================================================

export function barInscritosVsPresentes(id, eventos) {
  const filtered = eventos.filter((e) => e.totalInscritos > 0);
  const isEmpty = filtered.length === 0;
  return _mount(id, {
    type: "bar",
    data: {
      labels: filtered.map((e) => shorten(e.title, 22)),
      datasets: [
        { label: "Inscritos", data: filtered.map((e) => e.totalInscritos), backgroundColor: PALETTE.blue, barThickness: "flex", maxBarThickness: 32 },
        { label: "Presentes", data: filtered.map((e) => e.totalPresentes), backgroundColor: PALETTE.green, barThickness: "flex", maxBarThickness: 32 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 8 } },
      plugins: { legend: { position: "bottom", align: "start" } },
      scales: baseScales(),
    },
  }, isEmpty, "Sem eventos com inscrições para comparar.");
}

export function barTaxaPresenca(id, eventos) {
  const filtered = eventos.filter((e) => e.taxaPresenca !== null && e.taxaPresenca !== undefined);
  const isEmpty = filtered.length === 0;
  const cor = (v) => (v >= 80 ? PALETTE.green : v >= 60 ? PALETTE.amber : PALETTE.red);
  return _mount(id, {
    type: "bar",
    data: {
      labels: filtered.map((e) => shorten(e.title, 28)),
      datasets: [{
        label: "% Presença",
        data: filtered.map((e) => e.taxaPresenca),
        backgroundColor: filtered.map((e) => cor(e.taxaPresenca)),
        maxBarThickness: 28,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 12 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => " " + ctx.parsed.x.toFixed(1) + "%" } },
      },
      scales: {
        x: {
          beginAtZero: true, max: 100,
          ticks: { callback: (v) => v + "%", color: PALETTE.axis, font: { size: 11 } },
          grid: { color: PALETTE.grid, drawTicks: false },
          border: { display: false },
        },
        y: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: PALETTE.axis, font: { size: 11 } },
        },
      },
    },
  }, isEmpty, "Nenhum evento realizado com taxa calculável.");
}

export function donutPresenca(id, presentes, ausentes) {
  const isEmpty = (presentes + ausentes) === 0;
  return _mount(id, {
    type: "doughnut",
    data: {
      labels: ["Presentes", "Ausentes"],
      datasets: [{
        data: [presentes, ausentes],
        backgroundColor: [PALETTE.green, PALETTE.red],
        borderWidth: 0,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct = total ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
              return ` ${ctx.label}: ${ctx.parsed} (${pct}%)`;
            },
          },
        },
      },
    },
  }, isEmpty, "Sem check-ins registrados.");
}

export function barSecretarias(id, entries, opts = {}) {
  const { horizontal = true, limit = 10 } = opts;
  const slice = entries.slice(0, limit);
  const isEmpty = slice.length === 0;
  return _mount(id, {
    type: "bar",
    data: {
      labels: slice.map((s) => shorten(s.nome, 30)),
      datasets: [{
        label: "Inscrições",
        data: slice.map((s) => s.qtd),
        backgroundColor: slice.map((_, i) => PALETTE.series[i % PALETTE.series.length]),
        maxBarThickness: 26,
      }],
    },
    options: {
      indexAxis: horizontal ? "y" : "x",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => " " + ctx.parsed[horizontal ? "x" : "y"] + " inscrição(ões)" } },
      },
      scales: horizontal
        ? {
            x: { beginAtZero: true, grid: { color: PALETTE.grid, drawTicks: false }, border: { display: false }, ticks: { color: PALETTE.axis, font: { size: 11 } } },
            y: { grid: { display: false }, border: { display: false }, ticks: { color: PALETTE.axis, font: { size: 11 } } },
          }
        : baseScales(),
    },
  }, isEmpty, "Sem dados de secretarias.");
}

export function pieTurmas(id, entries) {
  const isEmpty = entries.length === 0;
  return _mount(id, {
    type: "doughnut",
    data: {
      labels: entries.map((t) => shorten(t.nome, 36)),
      datasets: [{
        data: entries.map((t) => t.qtd),
        backgroundColor: entries.map((_, i) => PALETTE.series[i % PALETTE.series.length]),
        borderWidth: 0,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "55%",
      plugins: {
        legend: { position: "bottom", labels: { font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct = total ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
              return ` ${ctx.label}: ${ctx.parsed} (${pct}%)`;
            },
          },
        },
      },
    },
  }, isEmpty, "Evento sem subdivisão em turmas.");
}

export function lineTimeline(id, points, label = "Inscrições") {
  const isEmpty = !points || points.length === 0;
  return _mount(id, {
    type: "line",
    data: {
      labels: points.map(([d]) => formatShortDate(d)),
      datasets: [{
        label,
        data: points.map(([, v]) => v),
        fill: true,
        backgroundColor: "rgba(48, 99, 173, 0.12)",
        borderColor: PALETTE.blue,
        borderWidth: 2,
        tension: 0.35,
        pointBackgroundColor: PALETTE.blue,
        pointRadius: 3,
        pointHoverRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: PALETTE.axis, font: { size: 10 } } },
        y: { beginAtZero: true, grid: { color: PALETTE.grid, drawTicks: false }, border: { display: false }, ticks: { color: PALETTE.axis, font: { size: 11 } } },
      },
    },
  }, isEmpty, "Sem registros de data de inscrição.");
}

export function radarComparativo(id, comparativos) {
  const isEmpty = comparativos.length < 2;
  const maxInsc = Math.max(...comparativos.map((c) => c.inscritos), 1);
  const maxPres = Math.max(...comparativos.map((c) => c.presentes), 1);
  const maxSec = Math.max(...comparativos.map((c) => c.nSecretarias), 1);
  const norm = (c) => [
    Math.round((c.inscritos / maxInsc) * 100),
    Math.round((c.presentes / maxPres) * 100),
    c.taxaPresenca ?? 0,
    Math.round((c.nSecretarias / maxSec) * 100),
  ];
  return _mount(id, {
    type: "radar",
    data: {
      labels: ["Inscritos (rel.)", "Presentes (rel.)", "Taxa de presença %", "Diversidade secret. (rel.)"],
      datasets: comparativos.map((c, i) => ({
        label: shorten(c.title, 26),
        data: norm(c),
        borderColor: PALETTE.series[i % PALETTE.series.length],
        backgroundColor: PALETTE.series[i % PALETTE.series.length] + "33",
        pointBackgroundColor: PALETTE.series[i % PALETTE.series.length],
        pointRadius: 3,
        borderWidth: 2,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
      scales: {
        r: {
          suggestedMin: 0, suggestedMax: 100,
          ticks: { display: false, stepSize: 25 },
          grid: { color: "rgba(22,31,54,0.10)" },
          angleLines: { color: "rgba(22,31,54,0.10)" },
          pointLabels: { font: { size: 11, weight: "600" }, color: PALETTE.muted },
        },
      },
    },
  }, isEmpty, "Selecione 2 ou mais eventos para comparar.");
}

export function barGrupoComparativo(id, comparativos) {
  const isEmpty = comparativos.length === 0;
  return _mount(id, {
    type: "bar",
    data: {
      labels: comparativos.map((c) => shorten(c.title, 22)),
      datasets: [
        { label: "Inscritos", data: comparativos.map((c) => c.inscritos), backgroundColor: PALETTE.blue, maxBarThickness: 32 },
        { label: "Presentes", data: comparativos.map((c) => c.presentes), backgroundColor: PALETTE.green, maxBarThickness: 32 },
        { label: "Ausentes", data: comparativos.map((c) => c.ausentes), backgroundColor: PALETTE.red, maxBarThickness: 32 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
      scales: baseScales(),
    },
  }, isEmpty, "Selecione eventos para comparar.");
}

export function barGroupedByCategory(id, labels, datasets, opts = {}) {
  const { indexAxis = "x" } = opts;
  const isEmpty = labels.length === 0;
  return _mount(id, {
    type: "bar",
    data: { labels: labels.map((l) => shorten(l, 28)), datasets },
    options: {
      indexAxis,
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
      scales:
        indexAxis === "y"
          ? {
              x: { beginAtZero: true, grid: { color: PALETTE.grid, drawTicks: false }, border: { display: false }, ticks: { color: PALETTE.axis, font: { size: 11 } } },
              y: { grid: { display: false }, border: { display: false }, ticks: { color: PALETTE.axis, font: { size: 11 } } },
            }
          : baseScales(),
    },
  }, isEmpty, "Sem dados.");
}
