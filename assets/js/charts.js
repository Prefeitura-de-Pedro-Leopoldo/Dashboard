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
  grid: "rgba(22, 31, 54, 0.04)",
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
  window.Chart.defaults.plugins.legend.labels.boxWidth = 8;
  window.Chart.defaults.plugins.legend.labels.boxHeight = 8;
  window.Chart.defaults.plugins.legend.labels.padding = 18;
  window.Chart.defaults.plugins.legend.labels.font = { size: 11, weight: "600" };
  window.Chart.defaults.plugins.tooltip.backgroundColor = "rgba(22,31,54,0.96)";
  window.Chart.defaults.plugins.tooltip.titleColor = "#fafafa";
  window.Chart.defaults.plugins.tooltip.bodyColor = "#cfd6e4";
  window.Chart.defaults.plugins.tooltip.titleFont = { weight: "700", size: 12 };
  window.Chart.defaults.plugins.tooltip.bodyFont = { size: 12, weight: "500" };
  window.Chart.defaults.plugins.tooltip.padding = { top: 10, right: 14, bottom: 10, left: 14 };
  window.Chart.defaults.plugins.tooltip.cornerRadius = 10;
  window.Chart.defaults.plugins.tooltip.boxPadding = 8;
  window.Chart.defaults.plugins.tooltip.usePointStyle = true;
  window.Chart.defaults.plugins.tooltip.displayColors = true;
  window.Chart.defaults.plugins.tooltip.caretPadding = 10;
  window.Chart.defaults.plugins.tooltip.borderColor = "rgba(255,255,255,0.08)";
  window.Chart.defaults.plugins.tooltip.borderWidth = 1;
  window.Chart.defaults.animation = { duration: 900, easing: "easeOutQuart" };
  window.Chart.defaults.animations = {
    numbers: { duration: 900, easing: "easeOutQuart" },
    colors: { duration: 400 },
  };
  window.Chart.defaults.elements.bar.borderRadius = 8;
  window.Chart.defaults.elements.bar.borderSkipped = false;
}
applyChartDefaults();

// ============================================================================
// Helpers visuais — gradientes, sombras, profundidade
// ============================================================================

// Cria gradiente vertical (barras top→bottom) a partir de uma cor sólida
function vGradient(ctx, area, color, opts = {}) {
  if (!area) return color;
  const { darkenBottom = 0.18, lightenTop = 0.05 } = opts;
  const g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
  g.addColorStop(0, lighten(color, lightenTop));
  g.addColorStop(0.55, color);
  g.addColorStop(1, darken(color, darkenBottom));
  return g;
}
// Gradiente horizontal (barras laterais left→right)
function hGradient(ctx, area, color, opts = {}) {
  if (!area) return color;
  const { darkenStart = 0.10, lightenEnd = 0.10 } = opts;
  const g = ctx.createLinearGradient(area.left, 0, area.right, 0);
  g.addColorStop(0, darken(color, darkenStart));
  g.addColorStop(1, lighten(color, lightenEnd));
  return g;
}
// Gradiente radial para donut/pie (centro mais claro → borda mais escura)
function radialGradient(ctx, x, y, r0, r1, color) {
  const g = ctx.createRadialGradient(x, y, r0, x, y, r1);
  g.addColorStop(0, lighten(color, 0.18));
  g.addColorStop(0.55, color);
  g.addColorStop(1, darken(color, 0.20));
  return g;
}
// Gradiente para área de linha (fill suave)
function areaGradient(ctx, area, color) {
  if (!area) return color + "22";
  const g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
  g.addColorStop(0, color + "55");
  g.addColorStop(0.6, color + "20");
  g.addColorStop(1, color + "00");
  return g;
}

// Manipulação de cor (hex → rgb com offset)
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }
function lighten(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${clamp(r + (255 - r) * amount)},${clamp(g + (255 - g) * amount)},${clamp(b + (255 - b) * amount)})`;
}
function darken(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${clamp(r * (1 - amount))},${clamp(g * (1 - amount))},${clamp(b * (1 - amount))})`;
}

// Plugin: sombra suave para barras (efeito de profundidade)
const barShadowPlugin = {
  id: "barShadow",
  beforeDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.shadowColor = "rgba(22,31,54,0.18)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;
  },
  afterDatasetsDraw(chart) {
    chart.ctx.restore();
  },
};

// Plugin: faz a barra ativa "crescer" no hover (espessura + glow), efeito similar ao hoverOffset do donut
const barHoverGrowPlugin = {
  id: "barHoverGrow",
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || opts.enabled === false) return;
    const active = chart.tooltip?.getActiveElements?.();
    if (!active || !active.length) return;
    const isHorizontal = chart.options.indexAxis === "y";
    const grow = opts.grow ?? 6;          // pixels a crescer em cada lado (largura total +12)
    const glowColor = opts.glow || "rgba(48,99,173,0.35)";
    const { ctx } = chart;

    active.forEach((el) => {
      const bar = el.element;
      const ds = chart.data.datasets[el.datasetIndex];
      const i = el.index;
      // Pega propriedades originais da barra
      const { x, y, base, width, height } = bar.getProps(["x", "y", "base", "width", "height"], true);

      // Resolve cor de hover (pode ser função em scriptable)
      let fill = ds.hoverBackgroundColor || ds.backgroundColor;
      if (typeof fill === "function") {
        fill = fill({ chart, dataIndex: i, datasetIndex: el.datasetIndex, dataset: ds, parsed: { x, y } });
      }

      ctx.save();
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = isHorizontal ? 0 : 4;
      ctx.shadowOffsetX = isHorizontal ? 4 : 0;
      ctx.fillStyle = fill || "rgba(48,99,173,1)";

      // Calcula retângulo expandido e desenha com cantos arredondados
      let rx, ry, rw, rh;
      if (isHorizontal) {
        const top = y - height / 2 - grow;
        const h = height + grow * 2;
        const left = Math.min(base, x);
        const w = Math.abs(x - base);
        rx = left; ry = top; rw = w; rh = h;
      } else {
        const left = x - width / 2 - grow;
        const w = width + grow * 2;
        const top = Math.min(base, y);
        const h = Math.abs(y - base);
        rx = left; ry = top; rw = w; rh = h;
      }
      const r = Math.min(opts.radius ?? 8, Math.abs(rw) / 2, Math.abs(rh) / 2);
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(rx, ry, rw, rh, r);
      } else {
        // fallback manual
        ctx.moveTo(rx + r, ry);
        ctx.lineTo(rx + rw - r, ry);
        ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + r);
        ctx.lineTo(rx + rw, ry + rh - r);
        ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - r, ry + rh);
        ctx.lineTo(rx + r, ry + rh);
        ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - r);
        ctx.lineTo(rx, ry + r);
        ctx.quadraticCurveTo(rx, ry, rx + r, ry);
        ctx.closePath();
      }
      ctx.fill();
      ctx.restore();
    });
  },
};

// Plugin: grade pontilhada (estilo crosshair) — desenha antes das barras
// opts.axis: "x" desenha linhas verticais, "y" desenha linhas horizontais
const dottedGridXPlugin = {
  id: "dottedGridX",
  beforeDatasetsDraw(chart, _args, opts) {
    if (!opts || opts.enabled === false) return;
    const axis = opts.axis || "x";
    const scale = chart.scales[axis];
    if (!scale) return;
    const { ctx, chartArea } = chart;
    const ticks = scale.ticks || [];
    ctx.save();
    ctx.strokeStyle = opts.color || "rgba(48, 99, 173, 0.25)";
    ctx.lineWidth = opts.lineWidth || 1;
    ctx.setLineDash(opts.dash || [3, 4]);
    ticks.forEach((t, i) => {
      if (axis === "x") {
        const x = scale.getPixelForTick(i);
        if (x < chartArea.left || x > chartArea.right) return;
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
      } else {
        const y = scale.getPixelForTick(i);
        if (y < chartArea.top || y > chartArea.bottom) return;
        ctx.beginPath();
        ctx.moveTo(chartArea.left, y);
        ctx.lineTo(chartArea.right, y);
        ctx.stroke();
      }
    });
    ctx.restore();
  },
};

// Plugin: data labels para barras (mostra valor na ponta da barra)
const barDataLabelsPlugin = {
  id: "barDataLabels",
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || opts.enabled === false) return;
    const { ctx, scales } = chart;
    const isHorizontal = chart.options.indexAxis === "y";
    const suffix = opts.suffix || "";
    const color = opts.color || (getComputedStyle(document.documentElement).getPropertyValue("--text-primary").trim() || "#161f36");

    ctx.save();
    ctx.font = "600 11px Manrope, sans-serif";
    ctx.textBaseline = "middle";
    chart.data.datasets.forEach((ds, di) => {
      const meta = chart.getDatasetMeta(di);
      if (meta.hidden) return;
      meta.data.forEach((bar, i) => {
        const value = ds.data[i];
        if (value == null) return;
        const label = (opts.format ? opts.format(value) : value) + suffix;
        const { x, y, base } = bar.getProps(["x", "y", "base"], true);
        ctx.fillStyle = color;
        if (isHorizontal) {
          ctx.textAlign = "left";
          ctx.fillText(label, x + 6, y);
        } else {
          ctx.textAlign = "center";
          ctx.fillText(label, x, y - 6);
        }
      });
    });
    ctx.restore();
  },
};

// Plugin: texto central no donut (% ou contagem)
const donutCenterPlugin = {
  id: "donutCenter",
  afterDraw(chart, _args, opts) {
    if (!opts || !opts.text) return;
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    const cx = (chartArea.left + chartArea.right) / 2;
    const cy = (chartArea.top + chartArea.bottom) / 2;
    const css = getComputedStyle(document.documentElement);
    const primary = css.getPropertyValue("--text-primary").trim() || "#161f36";
    const muted = css.getPropertyValue("--text-muted").trim() || "#6b7180";
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = primary;
    ctx.font = `700 ${opts.size || 22}px "Fraunces", "Manrope", sans-serif`;
    ctx.fillText(opts.text, cx, cy - (opts.subtitle ? 8 : 0));
    if (opts.subtitle) {
      ctx.fillStyle = muted;
      ctx.font = "600 10px Manrope, sans-serif";
      ctx.fillText(opts.subtitle.toUpperCase(), cx, cy + 14);
    }
    ctx.restore();
  },
};

// Plugin: sombra para donut/pie (efeito de elevação)
const donutShadowPlugin = {
  id: "donutShadow",
  beforeDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.shadowColor = "rgba(22,31,54,0.22)";
    ctx.shadowBlur = 16;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 6;
  },
  afterDatasetsDraw(chart) {
    chart.ctx.restore();
  },
};

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

// Abreviador inteligente para nomes de órgãos públicos.
// Aplica regras conhecidas (SMU. X, CGM, etc.) e trunca o restante.
function shortenOrg(s, n = 28) {
  if (!s) return "";
  const original = String(s).trim();
  // Aplica SEMPRE os padrões de abreviação (não pula para nomes curtos —
  // queremos "Sec." mesmo quando o nome inteiro caberia)

  // Padrões conhecidos — capturam o "sufixo significativo" e prefixam com sigla curta
  // "Municipal" é descartado (não agrega), mantendo "Sec. <Nome>"
  const patterns = [
    { re: /^Secretaria\s+Municipal\s+(?:da|de|do|das|dos)?\s*(.+)$/i, prefix: "Sec. " },
    { re: /^Secretaria\s+(?:da|de|do|das|dos)?\s*(.+)$/i, prefix: "Sec. " },
    { re: /^Controladoria\s+Geral\s+do\s+Munic[ií]pio$/i, full: "Controladoria Geral" },
    { re: /^Controladoria\s+Geral\s+(?:do|de|da)?\s*(.+)$/i, prefix: "Controladoria " },
    { re: /^Procuradoria\s+Geral\s+do\s+Munic[ií]pio$/i, full: "Procuradoria Geral" },
    { re: /^Procuradoria\s+(?:Geral|da|de|do)?\s*(.+)$/i, prefix: "Proc. " },
    { re: /^Chefia\s+de\s+Gabinete$/i, full: "Chefia de Gabinete" },
    { re: /^Departamento\s+(?:Municipal|de|do|da|dos|das)?\s*(.+)$/i, prefix: "Dep. " },
    { re: /^Diretoria\s+(?:de|do|da|dos|das)?\s*(.+)$/i, prefix: "Dir. " },
    { re: /^Superintend[êe]ncia\s+(?:de|do|da|dos|das)?\s*(.+)$/i, prefix: "Sup. " },
    { re: /^Coordenadoria\s+(?:de|do|da|dos|das)?\s*(.+)$/i, prefix: "Coord. " },
    { re: /^Fundac[ãa]o\s+(?:Municipal|de|do|da|dos|das)?\s*(.+)$/i, prefix: "Fund. " },
    { re: /^Instituto\s+(?:Municipal|de|do|da|dos|das)?\s*(.+)$/i, prefix: "Inst. " },
    { re: /^Autarquia\s+(?:Municipal|de|do|da|dos|das)?\s*(.+)$/i, prefix: "Aut. " },
    { re: /^Empresa\s+(?:Municipal|de|do|da|dos|das)?\s*(.+)$/i, prefix: "Emp. " },
    { re: /^Gabinete\s+(?:do|da|de)?\s*(.+)$/i, prefix: "Gab. " },
    { re: /^Comiss[ãa]o\s+(?:de|do|da|dos|das)?\s*(.+)$/i, prefix: "Com. " },
    { re: /^Conselho\s+(?:Municipal|de|do|da|dos|das)?\s*(.+)$/i, prefix: "Cons. " },
  ];

  // Stopwords pt-BR que não agregam significado e podem ser removidas em apertos
  const stop = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "para", "por", "em", "no", "na", "nos", "nas", "com"]);

  // Remove preposições/artigos do INÍCIO do tail (case-insensitive)
  // Ex.: "de Desenvolvimento Econômico" → "Desenvolvimento Econômico"
  const stripLeadingPreps = (t) => {
    let out = t.trim();
    // remove até 3 prefixos consecutivos (cobre casos raros tipo "do da")
    for (let i = 0; i < 3; i++) {
      const m = out.match(/^(?:de|da|do|das|dos|e|a|o)\s+(.+)$/i);
      if (!m) break;
      out = m[1];
    }
    return out;
  };

  for (const p of patterns) {
    const m = original.match(p.re);
    if (m) {
      if (p.full) return p.full;
      const tail = stripLeadingPreps(m[1]);
      // Capitaliza primeira letra se veio minúsculo (raro mas possível)
      const tailCap = tail.charAt(0).toUpperCase() + tail.slice(1);
      return p.prefix + tailCap;
    }
  }
  // Sem padrão conhecido: devolve original
  return original;
}
// Abreviador para títulos de eventos — extrai o tópico principal
// (suficiente como label de gráfico; o tooltip mostra o nome completo).
function shortenEvent(s) {
  if (!s) return "";
  let out = String(s).trim();

  // Padrões: descarta o prefixo institucional e mantém só o tópico
  const eventPatterns = [
    { re: /^Workshop\s+(.+)$/i, replacement: "$1" },
    { re: /^Forma[çc][ãa]o\s+para\s+Membros\s+(?:da|de|do)\s+(.+)$/i, replacement: "$1" },
    { re: /^Forma[çc][ãa]o\s+(?:em|de|para)\s+(.+)$/i, replacement: "$1" },
    { re: /^Fundamentos\s+(?:da|de|do)\s+(.+)$/i, replacement: "$1" },
    { re: /^Elabora[çc][ãa]o\s+(?:do|da|de)\s+(.+)$/i, replacement: "$1" },
    { re: /^Curso\s+(?:de|sobre)\s+(.+)$/i, replacement: "$1" },
    { re: /^Capacita[çc][ãa]o\s+(?:em|de|para)\s+(.+)$/i, replacement: "$1" },
    { re: /^Palestra\s+(?:sobre|de)?\s*(.+)$/i, replacement: "$1" },
    { re: /^Semin[áa]rio\s+(?:de|sobre)?\s*(.+)$/i, replacement: "$1" },
  ];

  for (const p of eventPatterns) {
    if (p.re.test(out)) {
      out = out.replace(p.re, p.replacement);
      break;
    }
  }

  // Remove "Mapa de" no início (após o pattern já ter cortado "Elaboração do")
  out = out.replace(/^Mapa\s+de\s+/i, "");

  // Normaliza sufixos de turma em qualquer formato → "T1", "T2"...
  // Casos: "- 1ª Turma", "1ª Turma", "1ª TURMA", "Turma 1", "TURMA 2", "1a Turma"
  out = out.replace(/\s*[-·]?\s*(\d+)\s*[ªa°º]\s*TURMA\b\.?/gi, " T$1");
  out = out.replace(/\bTURMA\s+(\d+)\b/gi, "T$1");
  out = out.replace(/\s+TURMA\s*$/i, "");
  // Limpa espaços duplicados
  out = out.replace(/\s{2,}/g, " ");

  return out.trim();
}

// Quebra string em array de linhas (Chart.js renderiza array como múltiplas linhas)
function wrapLabel(s, maxPerLine = 18) {
  if (!s) return "";
  const words = String(s).split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if ((cur + " " + w).length <= maxPerLine) cur += " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length > 1 ? lines : s;
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
    grid: { color: PALETTE.grid, drawTicks: false, lineWidth: 1 },
    border: { display: false },
    ticks: { color: PALETTE.axis, font: { size: 11 }, padding: 8, maxTicksLimit: 5 },
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
      labels: filtered.map((e) => shortenEvent(e.title)),
      datasets: [
        {
          label: "Inscritos",
          data: filtered.map((e) => e.totalInscritos),
          backgroundColor: (c) => vGradient(c.chart.ctx, c.chart.chartArea, PALETTE.blue),
          hoverBackgroundColor: (c) => vGradient(c.chart.ctx, c.chart.chartArea, PALETTE.blueLight),
          barThickness: "flex", maxBarThickness: 36, borderRadius: 8,
        },
        {
          label: "Presentes",
          data: filtered.map((e) => e.totalPresentes),
          backgroundColor: (c) => vGradient(c.chart.ctx, c.chart.chartArea, PALETTE.green),
          hoverBackgroundColor: (c) => vGradient(c.chart.ctx, c.chart.chartArea, PALETTE.greenLight),
          barThickness: "flex", maxBarThickness: 36, borderRadius: 8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 16, left: 8, right: 8, bottom: 8 } },
      interaction: { mode: "index", intersect: false },
      animation: { duration: 900, easing: "easeOutQuart" },
      plugins: {
        legend: { position: "bottom", align: "start" },
        tooltip: { callbacks: { title: (items) => filtered[items[0].dataIndex]?.title || items[0].label } },
        dottedGridX: { enabled: true, axis: "y", color: "rgba(48, 99, 173, 0.25)", dash: [3, 4], lineWidth: 1 },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: PALETTE.axis,
            font: { size: 10, weight: "600" },
            autoSkip: false,
            maxRotation: 35,
            minRotation: 35,
            padding: 4,
          },
        },
        y: {
          beginAtZero: true,
          grid: { display: false },
          border: { display: false },
          ticks: { color: PALETTE.axis, font: { size: 11 }, padding: 8, maxTicksLimit: 5 },
        },
      },
    },
    plugins: [barShadowPlugin, dottedGridXPlugin],
  }, isEmpty, "Sem eventos com inscrições para comparar.");
}

export function barTaxaPresenca(id, eventos) {
  const filtered = eventos.filter((e) => e.taxaPresenca !== null && e.taxaPresenca !== undefined);
  const isEmpty = filtered.length === 0;
  const cor = (v) => (v >= 80 ? PALETTE.green : v >= 60 ? PALETTE.amber : PALETTE.red);
  return _mount(id, {
    type: "bar",
    data: {
      labels: filtered.map((e) => shortenEvent(e.title)),
      datasets: [{
        label: "% Presença",
        data: filtered.map((e) => e.taxaPresenca),
        backgroundColor: (c) => {
          const i = c.dataIndex;
          if (i == null || !c.chart.chartArea) return cor(filtered[i ?? 0]?.taxaPresenca ?? 0);
          return hGradient(c.chart.ctx, c.chart.chartArea, cor(filtered[i].taxaPresenca));
        },
        hoverBackgroundColor: (c) => {
          const i = c.dataIndex;
          if (i == null || !c.chart.chartArea) return cor(filtered[i ?? 0]?.taxaPresenca ?? 0);
          return hGradient(c.chart.ctx, c.chart.chartArea, cor(filtered[i].taxaPresenca), { darkenStart: 0, lightenEnd: 0.2 });
        },
        maxBarThickness: 30, borderRadius: 8,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 60, top: 8, bottom: 8, left: 4 } },
      interaction: { mode: "nearest", axis: "y", intersect: false },
      animation: { duration: 900, easing: "easeOutQuart", delay: (c) => (c.type === "data" && c.mode === "default" ? c.dataIndex * 60 : 0) },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => filtered[items[0].dataIndex]?.title || items[0].label,
            label: (ctx) => " " + ctx.parsed.x.toFixed(1) + "%",
          },
        },
        barDataLabels: { enabled: true, suffix: "%", format: (v) => Number.isInteger(v) ? v : v.toFixed(1) },
        barHoverGrow: { enabled: true, grow: 5, radius: 8, glow: "rgba(48,99,173,0.32)" },
        dottedGridX: { enabled: true, color: "rgba(48, 99, 173, 0.25)", dash: [3, 4], lineWidth: 1 },
      },
      scales: {
        x: {
          beginAtZero: true, max: 100,
          ticks: {
            callback: (v) => v + "%",
            color: PALETTE.axis,
            font: { size: 11 },
            stepSize: 25,
            maxTicksLimit: 5,
          },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          grid: { display: false },
          border: { display: false },
          afterFit(scale) {
            const ctx = scale.chart.ctx;
            const labels = (scale.ticks || []).map((t, i) => shortenEvent(filtered[i]?.title || t.label));
            ctx.save();
            ctx.font = "600 11px Manrope, sans-serif";
            const max = labels.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
            ctx.restore();
            const chartW = scale.chart.width || 320;
            const desired = Math.min(Math.ceil(max) + 24, Math.round(chartW * 0.55));
            if (scale.width < desired) scale.width = desired;
          },
          ticks: {
            color: PALETTE.axis,
            font: { size: 11, weight: "600" },
            padding: 10,
            autoSkip: false,
            crossAlign: "far",
            callback(value) {
              const original = filtered[value]?.title || this.getLabelForValue(value);
              return shortenEvent(original);
            },
          },
        },
      },
    },
    plugins: [barShadowPlugin, barDataLabelsPlugin, barHoverGrowPlugin, dottedGridXPlugin],
  }, isEmpty, "Nenhum evento realizado com taxa calculável.");
}

export function donutPresenca(id, presentes, ausentes) {
  const isEmpty = (presentes + ausentes) === 0;
  const colors = [PALETTE.green, PALETTE.red];
  return _mount(id, {
    type: "doughnut",
    data: {
      labels: ["Presentes", "Ausentes"],
      datasets: [{
        data: [presentes, ausentes],
        backgroundColor: (c) => {
          const area = c.chart.chartArea;
          if (!area) return colors[c.dataIndex ?? 0];
          const cx = (area.left + area.right) / 2;
          const cy = (area.top + area.bottom) / 2;
          const r = Math.min(area.width, area.height) / 2;
          return radialGradient(c.chart.ctx, cx, cy, r * 0.5, r, colors[c.dataIndex]);
        },
        hoverOffset: 14,
        borderWidth: 2,
        borderColor: getComputedStyle(document.documentElement).getPropertyValue("--surface-card").trim() || "#fff",
        borderJoinStyle: "round",
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      animation: { animateScale: true, animateRotate: true, duration: 900 },
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
    plugins: [donutShadowPlugin],
  }, isEmpty, "Sem check-ins registrados.");
}

export function barSecretarias(id, entries, opts = {}) {
  const { horizontal = true, limit = 10 } = opts;
  const slice = entries.slice(0, limit);
  const isEmpty = slice.length === 0;
  return _mount(id, {
    type: "bar",
    data: {
      labels: slice.map((s) => shortenOrg(s.nome, 26)),
      datasets: [{
        label: "Inscrições",
        data: slice.map((s) => s.qtd),
        backgroundColor: (c) => {
          const i = c.dataIndex;
          if (i == null || !c.chart.chartArea) return PALETTE.series[(i ?? 0) % PALETTE.series.length];
          const base = PALETTE.series[i % PALETTE.series.length];
          return horizontal ? hGradient(c.chart.ctx, c.chart.chartArea, base) : vGradient(c.chart.ctx, c.chart.chartArea, base);
        },
        hoverBackgroundColor: (c) => {
          const i = c.dataIndex;
          if (i == null || !c.chart.chartArea) return PALETTE.series[(i ?? 0) % PALETTE.series.length];
          const base = PALETTE.series[i % PALETTE.series.length];
          return horizontal
            ? hGradient(c.chart.ctx, c.chart.chartArea, base, { darkenStart: 0, lightenEnd: 0.22 })
            : vGradient(c.chart.ctx, c.chart.chartArea, base, { lightenTop: 0.15 });
        },
        maxBarThickness: 28, borderRadius: 8,
      }],
    },
    options: {
      indexAxis: horizontal ? "y" : "x",
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: horizontal ? { right: 36, top: 8, bottom: 8 } : { top: 18, left: 8, right: 8 } },
      interaction: { mode: "nearest", axis: horizontal ? "y" : "x", intersect: false },
      animation: { duration: 900, easing: "easeOutQuart", delay: (c) => (c.type === "data" && c.mode === "default" ? c.dataIndex * 60 : 0) },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => slice[items[0].dataIndex]?.nome || items[0].label,
            label: (ctx) => " " + ctx.parsed[horizontal ? "x" : "y"] + " inscrição(ões)",
          },
        },
        barDataLabels: { enabled: true, suffix: "", color: undefined },
        barHoverGrow: { enabled: true, grow: 5, radius: 8, glow: "rgba(48,99,173,0.32)" },
      },
      scales: horizontal
        ? {
            x: { display: false, beginAtZero: true, grid: { display: false }, border: { display: false } },
            y: {
              grid: { display: false },
              border: { display: false },
              afterFit(scale) {
                // Mede o texto real de cada label para reservar a largura mínima necessária
                const ctx = scale.chart.ctx;
                const labels = (scale.ticks || []).map((t, i) => {
                  const original = slice[i]?.nome || t.label;
                  return shortenOrg(original, 999); // sem corte, deixa o nome completo abreviado
                });
                ctx.save();
                ctx.font = "600 11px Manrope, sans-serif";
                const max = labels.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
                ctx.restore();
                const chartW = scale.chart.width || 320;
                // Cap em 55% da largura para não esmagar as barras
                const desired = Math.min(Math.ceil(max) + 24, Math.round(chartW * 0.55));
                if (scale.width < desired) scale.width = desired;
              },
              ticks: {
                color: PALETTE.axis,
                font: { size: 11, weight: "600" },
                padding: 10,
                autoSkip: false,
                crossAlign: "far",
                callback(value) {
                  const original = slice[value]?.nome || this.getLabelForValue(value);
                  return shortenOrg(original, 999);
                },
              },
            },
          }
        : baseScales(),
    },
    plugins: [barShadowPlugin, barDataLabelsPlugin, barHoverGrowPlugin],
  }, isEmpty, "Sem dados de secretarias.");
}

export function pieTurmas(id, entries) {
  const isEmpty = entries.length === 0;
  const surface = getComputedStyle(document.documentElement).getPropertyValue("--surface-card").trim() || "#fff";
  return _mount(id, {
    type: "doughnut",
    data: {
      labels: entries.map((t) => shortenOrg(t.nome, 30)),
      datasets: [{
        data: entries.map((t) => t.qtd),
        backgroundColor: (c) => {
          const area = c.chart.chartArea;
          const base = PALETTE.series[c.dataIndex % PALETTE.series.length];
          if (!area) return base;
          const cx = (area.left + area.right) / 2;
          const cy = (area.top + area.bottom) / 2;
          const r = Math.min(area.width, area.height) / 2;
          return radialGradient(c.chart.ctx, cx, cy, r * 0.45, r, base);
        },
        hoverOffset: 14,
        borderWidth: 2,
        borderColor: surface,
        borderJoinStyle: "round",
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "58%",
      animation: { animateScale: true, animateRotate: true, duration: 900 },
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
    plugins: [donutShadowPlugin],
  }, isEmpty, "Evento sem subdivisão em turmas.");
}

export function lineTimeline(id, points, label = "Inscrições") {
  const isEmpty = !points || points.length === 0;
  const surface = getComputedStyle(document.documentElement).getPropertyValue("--surface-card").trim() || "#fff";

  // Plugin local: linha vertical de crosshair no hover
  const crosshairPlugin = {
    id: "lineCrosshair",
    afterDraw(chart) {
      const active = chart.tooltip?.getActiveElements?.();
      if (!active || !active.length) return;
      const { ctx, chartArea } = chart;
      const x = active[0].element.x;
      ctx.save();
      ctx.strokeStyle = "rgba(48,99,173,0.25)";
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.restore();
    },
  };

  return _mount(id, {
    type: "line",
    data: {
      labels: points.map(([d]) => formatShortDate(d)),
      datasets: [{
        label,
        data: points.map(([, v]) => v),
        fill: true,
        backgroundColor: (c) => areaGradient(c.chart.ctx, c.chart.chartArea, PALETTE.blue),
        borderColor: PALETTE.blue,
        borderWidth: 3,
        tension: 0.4,
        pointBackgroundColor: surface,
        pointBorderColor: PALETTE.blue,
        pointBorderWidth: 2.5,
        pointRadius: 5,
        pointHoverRadius: 8,
        pointHoverBackgroundColor: PALETTE.blue,
        pointHoverBorderColor: surface,
        pointHoverBorderWidth: 3,
        clip: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      layout: { padding: { top: 12, right: 12, left: 4, bottom: 4 } },
      animation: {
        duration: 1100,
        easing: "easeOutQuart",
        x: { from: (ctx) => (ctx.type === "data" && ctx.mode === "default" && !ctx.dropped ? ctx.xStarted ? ctx.x : (ctx.xStarted = true, ctx.x) : undefined) },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => `Data: ${items[0].label}`,
            label: (ctx) => ` ${ctx.parsed.y} inscrição(ões)`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: PALETTE.axis, font: { size: 10, weight: "600" }, padding: 6 },
        },
        y: {
          beginAtZero: true,
          grid: { color: PALETTE.grid, drawTicks: false, lineWidth: 1 },
          border: { display: false },
          ticks: { color: PALETTE.axis, font: { size: 11 }, padding: 8, maxTicksLimit: 5, precision: 0 },
        },
      },
    },
    plugins: [
      {
        id: "lineGlow",
        beforeDatasetDraw(chart) {
          const { ctx } = chart;
          ctx.save();
          ctx.shadowColor = "rgba(48,99,173,0.40)";
          ctx.shadowBlur = 14;
          ctx.shadowOffsetY = 6;
        },
        afterDatasetDraw(chart) { chart.ctx.restore(); },
      },
      crosshairPlugin,
    ],
  }, isEmpty, "Sem registros de data de inscrição.");
}

export function radarComparativo(id, comparativos) {
  const isEmpty = comparativos.length < 2;
  const maxInsc = Math.max(...comparativos.map((c) => c.inscritos), 1);
  const maxPres = Math.max(...comparativos.map((c) => c.presentes), 1);
  const maxSec = Math.max(...comparativos.map((c) => c.nSecretarias), 1);

  // Cada eixo normalizado para 0–100 com explicação clara no tooltip
  const axes = [
    {
      label: "Inscritos",
      get: (c) => Math.round((c.inscritos / maxInsc) * 100),
      raw: (c) => `${c.inscritos} inscritos`,
    },
    {
      label: "Presentes",
      get: (c) => Math.round((c.presentes / maxPres) * 100),
      raw: (c) => `${c.presentes} presentes`,
    },
    {
      label: "Taxa de presença",
      get: (c) => Math.round(c.taxaPresenca ?? 0),
      raw: (c) => `${(c.taxaPresenca ?? 0).toFixed(1)}% de presença`,
    },
    {
      label: "Secretarias",
      get: (c) => Math.round((c.nSecretarias / maxSec) * 100),
      raw: (c) => `${c.nSecretarias} secretarias representadas`,
    },
  ];

  const surface = getComputedStyle(document.documentElement).getPropertyValue("--surface-card").trim() || "#fff";
  return _mount(id, {
    type: "radar",
    data: {
      labels: axes.map((a) => a.label),
      datasets: comparativos.map((c, i) => {
        const color = PALETTE.series[i % PALETTE.series.length];
        // Quando há muitos eventos, reduz o preenchimento para evitar sobreposição confusa
        const many = comparativos.length > 3;
        const fillAlpha = many ? "14" : "26";
        const hoverAlpha = many ? "30" : "44";
        return {
          label: shortenEvent(c.title),
          data: axes.map((a) => a.get(c)),
          _comp: c,
          borderColor: color,
          backgroundColor: color + fillAlpha,
          hoverBackgroundColor: color + hoverAlpha,
          pointBackgroundColor: surface,
          pointBorderColor: color,
          pointBorderWidth: 2,
          pointRadius: many ? 3 : 4,
          pointHoverRadius: 7,
          pointHoverBackgroundColor: color,
          pointHoverBorderColor: surface,
          pointHoverBorderWidth: 3,
          borderWidth: many ? 2 : 2.5,
          tension: 0.15,
        };
      }),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "point", intersect: true },
      animation: { duration: 1000, easing: "easeOutQuart" },
      layout: { padding: 8 },
      plugins: {
        legend: {
          position: "bottom",
          labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 8, boxHeight: 8, padding: 14, font: { size: 11, weight: "600" } },
          // Hover na legenda: marca o dataset alvo via flag (lida pelo plugin radarHighlight)
          onHover: (e, item, legend) => {
            const ci = legend.chart;
            if (ci.$highlightedDataset === item.datasetIndex) return;
            ci.$highlightedDataset = item.datasetIndex;
            ci.canvas.style.cursor = "pointer";
            ci.update("none");
          },
          onLeave: (e, item, legend) => {
            const ci = legend.chart;
            if (ci.$highlightedDataset == null) return;
            ci.$highlightedDataset = null;
            ci.canvas.style.cursor = "default";
            ci.update("none");
          },
        },
        tooltip: {
          mode: "point",
          intersect: true,
          callbacks: {
            title: (items) => {
              const it = items[0];
              if (!it) return "";
              const axisLabel = it.label || "";
              return `${it.dataset.label} · ${axisLabel}`;
            },
            label: (ctx) => {
              const comp = ctx.dataset._comp;
              const axis = axes[ctx.dataIndex];
              if (!comp || !axis) return ` ${ctx.parsed.r}`;
              return " " + axis.raw(comp);
            },
            afterBody: (items) => {
              const it = items[0];
              if (!it) return "";
              const chart = it.chart;
              const axisIdx = it.dataIndex;
              const axis = axes[axisIdx];
              if (!axis) return "";
              // Coleta valor real de todos os outros datasets neste eixo
              const others = chart.data.datasets
                .map((ds, i) => ({ label: ds.label, comp: ds._comp, isThis: i === it.datasetIndex }))
                .filter((d) => d.comp && !d.isThis);
              if (!others.length) return "";
              const lines = ["", "Comparando com:"];
              others.forEach((o) => lines.push(` • ${o.label}: ${axis.raw(o.comp)}`));
              return lines;
            },
          },
        },
      },
      scales: {
        r: {
          min: 0,
          max: 100,
          ticks: {
            display: true,
            stepSize: 25,
            color: "rgba(154, 163, 178, 0.55)",
            backdropColor: "transparent",
            font: { size: 9, weight: "600" },
            callback: (v) => v === 0 ? "" : v + "%",
            showLabelBackdrop: false,
            z: 1,
          },
          grid: { color: "rgba(48, 99, 173, 0.18)", lineWidth: 1, circular: true },
          angleLines: { color: "rgba(48, 99, 173, 0.18)", lineWidth: 1 },
          pointLabels: {
            font: { size: 12, weight: "700" },
            color: getComputedStyle(document.documentElement).getPropertyValue("--text-primary").trim() || "#161f36",
            padding: 12,
          },
        },
      },
    },
    plugins: [{
      id: "radarHighlight",
      beforeDatasetsDraw(chart) {
        const target = chart.$highlightedDataset;
        if (target == null) return;
        chart.$origStyles = chart.$origStyles || chart.data.datasets.map((ds) => ({
          backgroundColor: ds.backgroundColor,
          borderColor: ds.borderColor,
          borderWidth: ds.borderWidth,
        }));
        chart.data.datasets.forEach((ds, idx) => {
          const baseColor = PALETTE.series[idx % PALETTE.series.length];
          if (idx === target) {
            // Mantém visual original do destacado, só leve realce na borda
            const orig = chart.$origStyles[idx];
            ds.backgroundColor = baseColor + "38";
            ds.borderColor = baseColor;
            ds.borderWidth = (orig.borderWidth || 2.5) + 0.5;
          } else {
            // Esmaece muito: borda visível mas sem preenchimento
            ds.backgroundColor = baseColor + "00";
            ds.borderColor = baseColor + "30";
            ds.borderWidth = 1;
          }
        });
      },
      afterDatasetsDraw(chart) {
        if (chart.$highlightedDataset == null && chart.$origStyles) {
          chart.data.datasets.forEach((ds, idx) => {
            const orig = chart.$origStyles[idx];
            if (!orig) return;
            ds.backgroundColor = orig.backgroundColor;
            ds.borderColor = orig.borderColor;
            ds.borderWidth = orig.borderWidth;
          });
          chart.$origStyles = null;
        }
      },
    }, {
      id: "radarBackdrop",
      beforeDatasetsDraw(chart) {
        const scale = chart.scales.r;
        if (!scale) return;
        const { ctx } = chart;
        const cx = scale.xCenter;
        const cy = scale.yCenter;
        const rMax = scale.getDistanceFromCenterForValue(100);
        ctx.save();
        // Fundo radial sutil para destacar a área do radar
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rMax);
        grad.addColorStop(0, "rgba(48, 99, 173, 0.05)");
        grad.addColorStop(0.6, "rgba(48, 99, 173, 0.02)");
        grad.addColorStop(1, "rgba(48, 99, 173, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, rMax, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      },
    }, {
      id: "radarGlow",
      beforeDatasetsDraw(chart) {
        const { ctx } = chart;
        ctx.save();
        ctx.shadowColor = "rgba(22,31,54,0.18)";
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 3;
      },
      afterDatasetsDraw(chart) { chart.ctx.restore(); },
    }],
  }, isEmpty, "Selecione 2 ou mais eventos para comparar.");
}

export function barGrupoComparativo(id, comparativos) {
  const isEmpty = comparativos.length === 0;
  const makeBg = (color) => (c) => c.chart.chartArea ? vGradient(c.chart.ctx, c.chart.chartArea, color) : color;
  const makeHover = (color) => (c) => c.chart.chartArea ? vGradient(c.chart.ctx, c.chart.chartArea, color, { lightenTop: 0.18 }) : color;
  return _mount(id, {
    type: "bar",
    data: {
      labels: comparativos.map((c) => shortenEvent(c.title)),
      datasets: [
        { label: "Inscritos", data: comparativos.map((c) => c.inscritos), backgroundColor: makeBg(PALETTE.blue), hoverBackgroundColor: makeHover(PALETTE.blue), maxBarThickness: 32, borderRadius: 8 },
        { label: "Presentes", data: comparativos.map((c) => c.presentes), backgroundColor: makeBg(PALETTE.green), hoverBackgroundColor: makeHover(PALETTE.green), maxBarThickness: 32, borderRadius: 8 },
        { label: "Ausentes", data: comparativos.map((c) => c.ausentes), backgroundColor: makeBg(PALETTE.red), hoverBackgroundColor: makeHover(PALETTE.red), maxBarThickness: 32, borderRadius: 8 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 18, left: 8, right: 8 } },
      interaction: { mode: "nearest", axis: "x", intersect: false },
      animation: { duration: 900, easing: "easeOutQuart", delay: (c) => (c.type === "data" && c.mode === "default" ? c.dataIndex * 60 : 0) },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            title: (items) => comparativos[items[0].dataIndex]?.title || items[0].label,
          },
        },
        barDataLabels: { enabled: true, suffix: "" },
        barHoverGrow: { enabled: true, grow: 4, radius: 8, glow: "rgba(48,99,173,0.30)" },
      },
      scales: baseScales(),
    },
    plugins: [barShadowPlugin, barDataLabelsPlugin, barHoverGrowPlugin],
  }, isEmpty, "Selecione eventos para comparar.");
}

export function barGroupedByCategory(id, labels, datasets, opts = {}) {
  const { indexAxis = "x" } = opts;
  const isEmpty = labels.length === 0;
  // Aplica gradiente + hover claro a cada dataset preservando a cor base
  const enriched = datasets.map((ds) => {
    const base = ds.backgroundColor || PALETTE.blue;
    const color = typeof base === "string" ? base : PALETTE.blue;
    return {
      ...ds,
      backgroundColor: (c) => {
        if (!c.chart.chartArea) return color;
        return indexAxis === "y"
          ? hGradient(c.chart.ctx, c.chart.chartArea, color)
          : vGradient(c.chart.ctx, c.chart.chartArea, color);
      },
      hoverBackgroundColor: (c) => {
        if (!c.chart.chartArea) return color;
        return indexAxis === "y"
          ? hGradient(c.chart.ctx, c.chart.chartArea, color, { darkenStart: 0, lightenEnd: 0.22 })
          : vGradient(c.chart.ctx, c.chart.chartArea, color, { lightenTop: 0.18 });
      },
      borderRadius: ds.borderRadius ?? 8,
      maxBarThickness: ds.maxBarThickness ?? 28,
    };
  });
  return _mount(id, {
    type: "bar",
    data: { labels: labels.map((l) => shorten(l, 28)), datasets: enriched },
    options: {
      indexAxis,
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: indexAxis === "y" ? { right: 24, top: 8, bottom: 8 } : { top: 18, left: 8, right: 8 } },
      interaction: { mode: "nearest", axis: indexAxis === "y" ? "y" : "x", intersect: false },
      animation: { duration: 900, easing: "easeOutQuart", delay: (c) => (c.type === "data" && c.mode === "default" ? c.dataIndex * 50 : 0) },
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { title: (items) => labels[items[0].dataIndex] || items[0].label } },
        barHoverGrow: { enabled: true, grow: 4, radius: 8, glow: "rgba(48,99,173,0.28)" },
      },
      scales:
        indexAxis === "y"
          ? {
              x: { beginAtZero: true, grid: { color: PALETTE.grid, drawTicks: false }, border: { display: false }, ticks: { color: PALETTE.axis, font: { size: 11 } } },
              y: { grid: { display: false }, border: { display: false }, ticks: { color: PALETTE.axis, font: { size: 11, weight: "600" }, padding: 8 } },
            }
          : baseScales(),
    },
    plugins: [barShadowPlugin, barHoverGrowPlugin],
  }, isEmpty, "Sem dados.");
}
