/**
 * app.js - controller principal: roteamento entre views, sidebar,
 * comparacao, filtros e tela de certificados com upload dinamico.
 */

import { loadData, getEvento } from "./data.js"
import {
  resumoGlobal,
  rankingSecretarias,
  rankingEvasaoSecretarias,
  taxaPresenca,
  participacaoPorSecretaria,
  evasaoPorSecretariaEvento,
  distribuicaoPorTurma,
  consolidarPorGrupo,
  inferirGruposPorPasta,
  turmasExpandidas,
  dedupEventos
} from "./metrics.js"
import {
  barInscritosVsPresentes,
  barTaxaPresenca,
  donutPresenca,
  barSecretarias,
  pieTurmas,
  lineTimeline,
  lineEvolucaoEventos,
  barModulosPresenca,
  shortenOrg,
  destroyAll
} from "./charts.js"
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
  turmaLabel
} from "./ui.js"
import { gerarInsightsGlobais, gerarInsightsEvento } from "./insights.js"
import {
  chaveServidor,
  agregarServidores,
  classificarVinculo,
  taxaRetencao
} from "./servidores.js"
import { initPalestrantes, renderLista as renderPalestrantesLista, listarConvites } from "./palestrantes.js"
import { initNotificacoes, refreshNotificacoes } from "./notificacoes.js"
import { renderInscricoes, renderEncontros, renderPresenca, eventosComInscricaoAberta } from "./lembretes.js"
import { showCover } from "./loader.js"
import { triggerDownload } from "./util.js"
import { renderViewQrCode } from "./views/qrcode.js"
import { renderViewSecretarias } from "./views/secretarias.js"
import { renderViewComparar } from "./views/comparar.js"
import { renderViewServidores, renderViewCargos } from "./views/pessoas.js"
// Efeito colateral: registra o listener de clique do perfil do servidor.
import "./views/servidor-perfil.js"
import { state } from "./core/state.js"
import { showAlert, showConfirm, showPrompt } from "./core/modal.js"
import { renderPaginatedTable, renderTabsNav, wireTabs, getActiveTab } from "./core/ui-kit.js"

// ================ Auth gate ================
const session = sessionStorage.getItem("egov_admin_session")
if (!session) window.location.replace("index.html")
const userData = (() => {
  try {
    return JSON.parse(session)
  } catch {
    return { email: "admin", name: "Admin" }
  }
})()

// ================ State ================
// O estado compartilhado agora vive em ./core/state.js (importado acima).

// Modelos disponiveis em assets/img/modelos_certificados/. Declarado no topo
// pois preloadTemplate() roda em init() antes da secao CERTIFICADOS ser definida.
const CERT_TEMPLATES = [
  { id: "modelo-1", label: "Modelo 1", src: "assets/img/modelos_certificados/modelo.png" },
  { id: "modelo-2", label: "Modelo 2", src: "assets/img/modelos_certificados/modelo2.png" },
  { id: "modelo-3", label: "Modelo 3", src: "assets/img/modelos_certificados/modelo3.png" },
  { id: "modelo-4", label: "Modelo 4", src: "assets/img/modelos_certificados/modelo4.png" },
  { id: "modelo-5", label: "Modelo 5", src: "assets/img/modelos_certificados/modelo5.png" },
  { id: "modelo-6", label: "Modelo 6", src: "assets/img/modelos_certificados/modelo6.jpeg", hint: "Ideal para cursos com 2 datas" }
]
const _certTemplateCache = {}

// Coordenadas (fracoes 0-1) dos campos por modelo. Modelos 3 e 4 compartilham
// a MESMA referencia de objeto (editar um atualiza ambos). Modelo 5 e independente.
// Para mudar os defaults, edite os objetos abaixo e tambem o CERT_POS_DEFAULT
// (usado pelo botao "Restaurar").
const CERT_POS_DEFAULT = {
  nome: { x: 0.54, y: 0.34 },
  curso: { x: 0.2, y: 0.389 },
  dia: { x: 0.371, y: 0.431 },
  mes: { x: 0.55, y: 0.431 },
  ano: { x: 0.715, y: 0.431 },
  carga: { x: 0.26, y: 0.475 }
}
const _clonePos = p => JSON.parse(JSON.stringify(p))

// >>> EDITE AQUI as coordenadas padrao dos modelos 3, 4 e 5 (uma alteracao vale para os tres) <<<
// Modelos 3 e 4 compartilham as mesmas coordenadas; Modelo 5 e independente.
const _sharedPos34 = {
  nome:  { x: 0.54,                y: 0.34 },
  curso: { x: 0.5272700357660243,  y: 0.3856354675895818 },
  dia:   { x: 0.4979363214822313,  y: 0.42712126362578806 },
  mes:   { x: 0.6479741791378472,  y: 0.42729721333734916 },
  ano:   { x: 0.8353478642086691,  y: 0.42600634241979934 },
  carga: { x: 0.37565280289548464, y: 0.47071931574988013 },
}
const _defaultPos5 = {
  nome:  { x: 0.54,                y: 0.34 },
  curso: { x: 0.4684721285621191,  y: 0.38492365818360647 },
  dia:   { x: 0.4459021454308956,  y: 0.4316981909541735 },
  mes:   { x: 0.5930339846944069,  y: 0.4285587736287913 },
  ano:   { x: 0.778617745248111,   y: 0.4286175667908371 },
  carga: { x: 0.3220714047502807,  y: 0.4720777756471362 },
}

// >>> EDITE AQUI os defaults dos modelos 1 e 2 (cada um e independente) <<<
const _defaultPos1 = {
  nome:  { x: 0.5456536189424821, y: 0.3422426758031584 },
  curso: { x: 0.4048601791151441, y: 0.38428588946490144 },
  dia:   { x: 0.371, y: 0.431 },
  mes:   { x: 0.55,  y: 0.431 },
  ano:   { x: 0.715, y: 0.431 },
  carga: { x: 0.26,  y: 0.475 },
};
const _defaultPos2 = _clonePos(CERT_POS_DEFAULT);

// Modelo 6 - específico para cursos com 2 datas. Tem POSIÇÃO PRÓPRIA para
// dia2 (diferente de dia), então cada dia aparece em um lugar distinto na
// linha "no dia X e Y de MES de ANO". Os outros modelos ignoram POS.dia2
// e renderizam "X e Y" juntos em POS.dia.
// Coordenadas iniciais derivadas de um ajuste manual prévio do modelo 6
// (refeito pelo usuário via arrasta-e-solta e exportado do localStorage).
const _defaultPos6 = {
  nome:  { x: 0.5329486307975467,  y: 0.3428822877224162  },
  curso: { x: 0.4053636787545341,  y: 0.38252836385487154 },
  dia:   { x: 0.3584795910867044,  y: 0.4272828888296249  },
  dia2:  { x: 0.4411716953437269,  y: 0.43021866521000807 },
  mes:   { x: 0.6222967175035481,  y: 0.4283340015035414  },
  ano:   { x: 0.7792784289227523,  y: 0.4272828888296249  },
  carga: { x: 0.32287374625640497, y: 0.46964218392418033 }
}

const CERT_POS_BY_TEMPLATE = {
  "modelo-1": _defaultPos1,
  "modelo-2": _defaultPos2,
  "modelo-3": _sharedPos34,
  "modelo-4": _sharedPos34,
  "modelo-5": _defaultPos5,
  "modelo-6": _defaultPos6
}

// Escalas manuais de fonte por campo e por modelo. 1.0 = tamanho base.
// Campos suportados: nome, curso, dia, mes, ano, carga. Persistido no
// localStorage. Modelos 3 e 4 compartilham (edição em um aplica nos dois).
const CERT_SCALE_DEFAULT = 1.0
const CERT_SCALE_MIN = 0.5
const CERT_SCALE_MAX = 1.5
const CERT_SCALE_FIELDS = ["nome", "curso", "dia", "mes", "ano", "carga"]
const CERT_TEMPLATE_IDS = ["modelo-1", "modelo-2", "modelo-3", "modelo-4", "modelo-5", "modelo-6"]
const CERT_FIELD_SCALES = {}
CERT_SCALE_FIELDS.forEach(f => {
  CERT_FIELD_SCALES[f] = {}
  CERT_TEMPLATE_IDS.forEach(t => { CERT_FIELD_SCALES[f][t] = CERT_SCALE_DEFAULT })
})
function getFieldScale(tplId, field) {
  const v = CERT_FIELD_SCALES[field] && CERT_FIELD_SCALES[field][tplId]
  return typeof v === "number" && v > 0 ? v : CERT_SCALE_DEFAULT
}
function setFieldScale(tplId, field, v) {
  if (!CERT_FIELD_SCALES[field]) return
  const n = Math.max(CERT_SCALE_MIN, Math.min(CERT_SCALE_MAX, Number(v) || CERT_SCALE_DEFAULT))
  if (tplId === "modelo-3" || tplId === "modelo-4") {
    CERT_FIELD_SCALES[field]["modelo-3"] = n
    CERT_FIELD_SCALES[field]["modelo-4"] = n
  } else {
    CERT_FIELD_SCALES[field][tplId] = n
  }
}
function resetFieldScales(tplId) {
  CERT_SCALE_FIELDS.forEach(f => setFieldScale(tplId, f, CERT_SCALE_DEFAULT))
}

// Formata "dia [e dia2] / mes / ano" para o resumo da emissão.
function formatCertData(f) {
  if (!f) return ""
  const d1 = f.certDia
  const d2 = f.certDia2
  const dias = d1 && d2 ? `${d1} e ${d2}` : (d1 || "")
  const partes = [dias, f.certMes, f.certAno].filter(Boolean)
  return partes.join(" / ")
}

// Carrega ajustes salvos do localStorage (so para modelos 1, 2 e o compartilhado 3-5).
function loadCertPosOverrides() {
  try {
    const raw = localStorage.getItem("egov-cert-pos-v1")
    if (!raw) return
    const saved = JSON.parse(raw)
    if (saved["modelo-1"]) Object.assign(CERT_POS_BY_TEMPLATE["modelo-1"], saved["modelo-1"])
    if (saved["modelo-2"]) Object.assign(CERT_POS_BY_TEMPLATE["modelo-2"], saved["modelo-2"])
    if (saved["modelo-3"]) Object.assign(_sharedPos34, saved["modelo-3"]) // representa 3-4
    if (saved["modelo-5"]) Object.assign(_defaultPos5, saved["modelo-5"])
    if (saved["modelo-6"]) Object.assign(_defaultPos6, saved["modelo-6"])
    if (typeof saved.typoLinked === "boolean") state._certTypoLinked = saved.typoLinked
    // Formato novo: { fieldScales: { curso: {modelo-1: 0.9, ...}, ... } }
    if (saved.fieldScales && typeof saved.fieldScales === "object") {
      CERT_SCALE_FIELDS.forEach(f => {
        const src = saved.fieldScales[f]
        if (!src || typeof src !== "object") return
        CERT_TEMPLATE_IDS.forEach(t => {
          if (typeof src[t] === "number") CERT_FIELD_SCALES[f][t] = src[t]
        })
      })
    }
    // Compat com formato antigo (cursoScale, dataScale aplicado a dia/mes/ano)
    if (saved.cursoScale && typeof saved.cursoScale === "object") {
      CERT_TEMPLATE_IDS.forEach(t => {
        if (typeof saved.cursoScale[t] === "number") CERT_FIELD_SCALES.curso[t] = saved.cursoScale[t]
      })
    }
    if (saved.dataScale && typeof saved.dataScale === "object") {
      CERT_TEMPLATE_IDS.forEach(t => {
        if (typeof saved.dataScale[t] === "number") {
          CERT_FIELD_SCALES.dia[t] = saved.dataScale[t]
          CERT_FIELD_SCALES.mes[t] = saved.dataScale[t]
          CERT_FIELD_SCALES.ano[t] = saved.dataScale[t]
        }
      })
    }
  } catch (_) {}
}
function saveCertPosOverrides() {
  try {
    localStorage.setItem(
      "egov-cert-pos-v1",
      JSON.stringify({
        "modelo-1": CERT_POS_BY_TEMPLATE["modelo-1"],
        "modelo-2": CERT_POS_BY_TEMPLATE["modelo-2"],
        "modelo-3": _sharedPos34, // representa 3-4
        "modelo-5": _defaultPos5,
        "modelo-6": _defaultPos6,
        fieldScales: CERT_FIELD_SCALES,
        typoLinked: !!state._certTypoLinked
      })
    )
  } catch (_) {}
}
loadCertPosOverrides()
function getCertPos(templateId) {
  return CERT_POS_BY_TEMPLATE[templateId] || CERT_POS_BY_TEMPLATE["modelo-1"]
}

const VIEW_TITLES = {
  dashboard:     ["Visão Geral",                "Resumo executivo, gráficos consolidados e insights estratégicos."],
  eventos:       ["Eventos",                    "Detalhamento operacional e demográfico de cada evento."],
  comparar:      ["Comparar Eventos",           "Compare dois ou mais eventos lado a lado."],
  participantes: ["Participantes",              "Busca e filtros sobre todos os inscritos."],
  servidores:    ["Servidores em Destaque",     "Lista completa de servidores ordenada por participação."],
  faltas:        ["Faltas Recorrentes",         "Quem inscreve e falta com frequência."],
  cargos:        ["Cargos",                     "Distribuição da capacitação por cargo."],
  secretarias:   ["Secretarias",                "Ranking e participação por pasta."],
  relatorios:    ["Relatórios",                 "Filtros, KPIs do recorte e exportação."],
  autoreport:    ["Auto-Relatório de Satisfação","Geração automática do PDF no padrão institucional."],
  certificados:  ["Certificados",               "Emita certificados em lote a partir do check-in."],
  qrcode:        ["QR Code",                    "Gere QR Codes em alta resolução para divulgação."]
}

// Grupos da sidebar. `title` e `subtitle` alimentam o topbar - ficam fixos
// enquanto o usuário navega entre as sub-abas (padrão consistente como em
// Visão Geral).
const SIDEBAR_GROUPS = [
  { id: "visao",
    label: "Visão Geral",
    title: "Visão Geral",
    subtitle: "Resumo executivo, gráficos consolidados e insights estratégicos.",
    defaultView: "dashboard",
    tabs: null /* dashboard já tem tabs internas (Resumo/Gráficos/Insights) */
  },
  { id: "eventos",
    label: "Eventos",
    title: "Eventos",
    subtitle: "Análise individual, comparação e detalhamento operacional.",
    defaultView: "eventos",
    tabs: [
      { view: "eventos",  label: "Análise individual", icon: "fa-magnifying-glass-chart" },
      { view: "comparar", label: "Comparar",           icon: "fa-scale-balanced" }
    ]
  },
  { id: "pessoas",
    label: "Secretarias",
    title: "Secretarias",
    subtitle: "Demografia da capacitação por secretaria, servidor, cargo e perfil.",
    defaultView: "secretarias",
    tabs: [
      { view: "secretarias",   label: "Secretarias",         icon: "fa-building-columns" },
      { view: "servidores",    label: "Servidores destaque", icon: "fa-medal" },
      { view: "faltas",        label: "Faltas recorrentes",  icon: "fa-user-xmark" },
      { view: "participantes", label: "Participantes",       icon: "fa-users" }
    ]
  },
  { id: "palestrantes",
    label: "Palestrantes",
    title: "Palestrantes",
    subtitle: "Cadastro de palestrantes: eixo temático, curso ministrado, mini bio e foto.",
    defaultView: "palestrantes-lista",
    tabs: [
      { view: "palestrantes-lista",    label: "Galeria",   icon: "fa-users-rectangle" }
    ]
  },
  { id: "docs",
    label: "Relatórios",
    title: "Relatórios",
    subtitle: "Documentação consolidada e geração automática de relatórios.",
    defaultView: "relatorios",
    tabs: [
      { view: "relatorios", label: "Relatórios",     icon: "fa-file-lines" },
      { view: "autoreport", label: "Auto-Relatório", icon: "fa-file-pdf" }
    ]
  },
  { id: "ops",
    label: "Certificados e QR Code",
    title: "Certificados e QR Code",
    subtitle: "Emissão em lote a partir do check-in e ferramentas auxiliares.",
    defaultView: "certificados",
    tabs: [
      { view: "certificados", label: "Certificados", icon: "fa-award" },
      { view: "qrcode",       label: "QR Code",      icon: "fa-qrcode" }
    ]
  }
]

const VIEW_TO_GROUP = (() => {
  const out = {}
  for (const g of SIDEBAR_GROUPS) {
    if (g.tabs) g.tabs.forEach(t => { out[t.view] = g.id })
    else out[g.defaultView] = g.id
  }
  return out
})()

// ================ Bootstrap ================
;(async function init() {
  setupSidebar()
  setupUserChrome()
  setupThemeToggle()
  setupNavigation()
  initPalestrantes({
    showAlert,
    showConfirm,
    showPrompt,
    getEventos: () => (state.data && state.data.eventos) || [],
    navigate
  })
  initNotificacoes({ listarConvites, navigate })
  preloadTemplate()
  await reloadData()
})()

async function reloadData(opts = {}) {
  showDashboardSkeleton()
  // Loader (capelo) sobre o conteúdo enquanto os dados não chegam. Com atraso
  // de revelação: carregamento rápido (estático local) não chega a exibir.
  // Na atualização forçada (botão), mostra logo (revealMs baixo).
  const hideLoader = showCover(document.getElementById("mainContent"),
    opts.force ? "Atualizando informações…" : "Carregando informações…",
    opts.force ? 0 : 200)
  const applyData = (raw) => {
    state.dataRaw = raw
    // Junta inscrições abertas (sintéticos), remove duplicatas de estático antigo,
    // infere grupo pela pasta (turmas/módulos) e consolida em cards de curso.
    const base = _baseComInscricoes(raw.eventos)
    state.data = { ...raw, eventos: consolidarPorGrupo(inferirGruposPorPasta(base)) }
    renderAll()
  }
  try {
    const raw = await loadData((live) => applyData(live), opts)
    applyData(raw)
    hideLoader()
    // Turmas com inscrição aberta entram em 2º plano (não travam a tela).
    augmentInscricoesAbertas()
  } catch (err) {
    hideLoader()
    document.getElementById("mainContent").innerHTML = `
      <div class="empty-state">
        <div class="empty-state__art"><i class="fas fa-circle-exclamation"></i></div>
        <h3>Não foi possível carregar os dados</h3>
        <p>${escapeHtml(err.message)}</p>
        <div class="empty-state__actions">
          <button class="btn btn--primary" onclick="location.reload()">
            <i class="fas fa-arrows-rotate"></i> Tentar novamente
          </button>
        </div>
      </div>
    `
  }
}

// Recalcula state.data com as turmas de inscrição aberta e re-renderiza.
function _reaplicarComInscricoes() {
  if (!state.dataRaw) return
  const base = _baseComInscricoes(state.dataRaw.eventos)
  state.data = { ...state.dataRaw, eventos: consolidarPorGrupo(inferirGruposPorPasta(base)) }
  renderAll()
}

// Pasta do evento (sem o nome do arquivo). Para sintéticos, é a pastaInscricao.
function pastaDeEvento(ev) {
  if (ev && ev.pastaInscricao) return ev.pastaInscricao
  return ev && ev.fonte ? String(ev.fonte).replace(/\/[^/]*$/, "") : ""
}

// Mescla os eventos reais (raw) com os sintéticos de inscrição aberta, descartando
// o sintético quando JÁ existe um evento real na mesma pasta. A filtragem é feita
// AQUI (contra os dados vigentes), não na busca — assim um evento presente só no
// estático ou só no ao vivo não "pisca e some" entre as duas fontes.
function _baseComInscricoes(rawEventos) {
  const reais = rawEventos || []
  const pastasReais = new Set(reais.map(pastaDeEvento).filter(Boolean))
  const sinteticos = (state.inscricoesAbertas || []).filter((s) => {
    const f = pastaDeEvento(s)
    return f && !pastasReais.has(f)
  })
  return marcarAbertasPorData(dedupEventos(reais.concat(sinteticos)))
}

// Um evento REAL (com participantes.xlsx) cuja data ainda está no futuro e que
// ainda não teve check-ins é, na prática, um evento com INSCRIÇÃO ABERTA: a
// planilha de participantes só é preenchida quando o evento encerra. Marca-o
// como `inscricaoAberta` para exibir as abas Inscrições/Encontros/Presença
// (em vez das abas de análise), preservando título/data do eventos-meta.json.
function marcarAbertasPorData(eventos) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  return (eventos || []).map((ev) => {
    if (ev.inscricaoAberta) return ev
    const d = ev.date ? new Date(ev.date + "T00:00:00") : null
    const futuro = d && !isNaN(d) && d >= hoje
    if (!futuro || (ev.totalPresentes || 0) > 0) return ev
    const pasta = String(ev.fonte || "").replace(/\/[^/]*$/, "")
    // Mantém o status original ("agendado") para o card exibir "Agendado"; é o
    // inscricaoAberta que liga as abas Inscrições/Encontros/Presença e o banner.
    return { ...ev, inscricaoAberta: true, pastaInscricao: pasta || ev.pastaInscricao }
  })
}

// Busca (em 2º plano) as turmas com inscrição aberta e re-renderiza incluindo-as.
// Usa cache de sessão pra aparecerem na hora em recargas. Falha silenciosa.
async function augmentInscricoesAbertas() {
  try {
    const cached = JSON.parse(sessionStorage.getItem("egov_insc_abertas") || "null")
    if (Array.isArray(cached) && cached.length) { state.inscricoesAbertas = cached; _reaplicarComInscricoes() }
  } catch (_) {}
  try {
    const novos = await eventosComInscricaoAberta((state.dataRaw && state.dataRaw.eventos) || [])
    state.inscricoesAbertas = novos || []
    try { sessionStorage.setItem("egov_insc_abertas", JSON.stringify(novos || [])) } catch (_) {}
    _reaplicarComInscricoes()
  } catch (_) {}
}

function showDashboardSkeleton() {
  const kpis = document.getElementById("kpisGlobal")
  const grid = document.getElementById("eventGrid")
  if (kpis) {
    kpis.outerHTML = `
      <div class="skel-kpis" id="kpisGlobal">
        <div class="skel-card hero">
          <div class="skel skel--circle"></div>
          <div class="skel-card__body">
            <div class="skel skel--line sm" style="width:30%"></div>
            <div class="skel skel--title"></div>
            <div class="skel skel--line" style="width:80%"></div>
            <div class="skel skel--bar" style="margin-top:12px"></div>
          </div>
        </div>
        ${Array.from({ length: 3 })
          .map(
            () => `
          <div class="skel-card">
            <div class="skel skel--line sm" style="width:40%"></div>
            <div class="skel skel--title" style="width:60%"></div>
            <div class="skel skel--line" style="width:75%"></div>
          </div>
        `
          )
          .join("")}
      </div>
    `
  }
  if (grid) {
    grid.innerHTML = Array.from({ length: 6 })
      .map(
        () => `
      <div class="skel-card">
        <div class="skel skel--title"></div>
        <div class="skel skel--line" style="width:55%"></div>
        <div class="skel skel--block" style="margin-top:8px"></div>
        <div class="skel skel--bar" style="margin-top:8px"></div>
      </div>
    `
      )
      .join("")
  }
}

// ================ Chrome ================
function setupSidebar() {
  const shell = document.getElementById("appShell")
  document.getElementById("sidebarToggle").addEventListener("click", () => {
    if (window.matchMedia("(max-width: 768px)").matches) {
      shell.classList.toggle("is-mobile-open")
    } else {
      shell.classList.toggle("is-collapsed")
      try {
        localStorage.setItem("egov_sidebar_collapsed", shell.classList.contains("is-collapsed") ? "1" : "0")
      } catch (_) {}
    }
  })
  try {
    // Default: colapsada. Só mantém aberta se o usuário marcou explicitamente "0".
    const pref = localStorage.getItem("egov_sidebar_collapsed")
    if (pref !== "0") shell.classList.add("is-collapsed")
  } catch (_) {
    shell.classList.add("is-collapsed")
  }
}

function setupUserChrome() {
  document.getElementById("userName").textContent = userData.name || "Administrador"
  document.getElementById("userEmail").textContent = userData.email
  document.getElementById("avatarLetter").textContent = (userData.email || "?")[0].toUpperCase()
  document.getElementById("logoutBtn").addEventListener("click", () => {
    sessionStorage.removeItem("egov_admin_session")
    try { localStorage.removeItem("egov_admin_session") } catch (_) {}
    window.location.replace("index.html")
  })
  document.getElementById("refreshBtn").addEventListener("click", () => { reloadData({ force: true }); refreshNotificacoes() })
}

function setupThemeToggle() {
  const btn = document.getElementById("themeToggle")
  btn.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "light"
    const next = cur === "dark" ? "light" : "dark"
    document.documentElement.setAttribute("data-theme", next)
    try {
      localStorage.setItem("egovpl-theme", next)
    } catch (_) {}
    renderAll()
  })
}

function setupNavigation() {
  document.querySelectorAll("[data-nav]").forEach(el => {
    el.addEventListener("click", e => {
      e.preventDefault()
      navigate(el.dataset.nav)
    })
  })
}

function navigate(view) {
  state.view = view
  const groupId = VIEW_TO_GROUP[view]
  // Sidebar: marca o item do grupo correspondente como ativo
  document.querySelectorAll(".nav-link").forEach(n => {
    n.classList.toggle("is-active", n.dataset.group === groupId)
  })
  // View: ativa só o painel correspondente
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("is-active", v.id === `view-${view}`))
  // Topbar reflete o GRUPO da sidebar - fica estável entre sub-abas.
  const grp = SIDEBAR_GROUPS.find(g => g.id === groupId)
  document.getElementById("topbarTitle").textContent = grp?.title || ""
  document.getElementById("topbarSub").textContent = grp?.subtitle || ""
  document.getElementById("appShell").classList.remove("is-mobile-open")
  // Lembra última sub-aba escolhida por grupo (útil para o user voltar)
  state.groupTab = state.groupTab || {}
  if (groupId) state.groupTab[groupId] = view
  renderGroupTabs(groupId)
  window.scrollTo({ top: 0, behavior: "smooth" })
  renderAll()
}

// Renderiza a barra de sub-abas do grupo ativo (ou esconde se o grupo
// só tem uma view).
function renderGroupTabs(groupId) {
  const host = document.getElementById("groupTabsHost")
  if (!host) return
  const grp = SIDEBAR_GROUPS.find(g => g.id === groupId)
  if (!grp || !grp.tabs || !grp.tabs.length) {
    host.innerHTML = ""
    return
  }
  host.innerHTML = `
    <nav class="group-tabs" role="tablist" aria-label="${escapeHtml(grp.label)}">
      ${grp.tabs.map(t => `
        <button type="button" class="group-tab ${state.view === t.view ? "is-active" : ""}" data-group-tab="${t.view}" role="tab" aria-selected="${state.view === t.view}">
          ${t.icon ? `<i class="fas ${t.icon}"></i>` : ""}
          <span>${escapeHtml(t.label)}</span>
        </button>
      `).join("")}
    </nav>
  `
  host.querySelectorAll("[data-group-tab]").forEach(btn => {
    btn.addEventListener("click", () => navigate(btn.dataset.groupTab))
  })
}

// ================ Helpers de UI: Tabs internas ================
// (renderPaginatedTable, renderTabsNav, wireTabs, getActiveTab vivem em
//  ./core/ui-kit.js -importados acima.)

// ================ Render orchestrator ================
function renderAll() {
  destroyAll()
  if (!state.data) return
  if (state.view === "dashboard") renderDashboard()
  else if (state.view === "eventos") renderViewEventos()
  else if (state.view === "comparar") renderViewComparar()
  else if (state.view === "participantes") renderViewParticipantes()
  else if (state.view === "secretarias") renderViewSecretarias()
  else if (state.view === "servidores") renderViewServidores()
  else if (state.view === "faltas") renderViewFaltas()
  else if (state.view === "cargos") renderViewCargos()
  else if (state.view === "relatorios") renderViewRelatorios()
  else if (state.view === "certificados") renderViewCertificados()
  else if (state.view === "qrcode") renderViewQrCode()
  else if (state.view === "autoreport") renderViewAutoReport()
  else if (state.view === "palestrantes-lista") renderPalestrantesLista()
}

// ================ DASHBOARD ================
// Agrupa eventos por curso (grupo.id). Eventos sem grupo viram grupos de 1.
function agruparEventos(eventos) {
  const grupos = []
  const porId = new Map()
  for (const ev of eventos) {
    const gid = ev.grupo && ev.grupo.id
    if (!gid) {
      grupos.push({ grupo: null, eventos: [ev] })
      continue
    }
    if (porId.has(gid)) {
      porId.get(gid).eventos.push(ev)
    } else {
      const g = { grupo: ev.grupo, eventos: [ev] }
      porId.set(gid, g)
      grupos.push(g)
    }
  }
  return grupos
}

function renderDashboard() {
  const { data } = state
  const eventos = data.eventos
  const resumo = resumoGlobal(eventos)

  // Tabs
  document.getElementById("dashTabsHost").innerHTML = renderTabsNav("dashboard", [
    { id: "overview", label: "Resumo", icon: "fa-gauge-high" },
    { id: "charts", label: "Gráficos consolidados", icon: "fa-chart-line" },
    { id: "insights", label: "Insights", icon: "fa-lightbulb" }
  ])
  const activeTab = getActiveTab("dashboard", "overview")
  document.querySelectorAll("#view-dashboard [data-tab-panel]").forEach(p => {
    p.hidden = p.dataset.tabPanel !== activeTab
  })
  wireTabs("dashboard", () => renderDashboard())

  if (activeTab === "insights") {
    renderInsightsTab()
    return
  }

  if (activeTab === "charts") {
    // Charts globais: somente realizados, limitados aos 8 mais recentes
    const realizados = eventos
      .filter(e => e.status === "realizado")
      .slice()
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .slice(0, 8)
      .reverse() // cronológico crescente no gráfico (mais antigo → mais recente)
    barInscritosVsPresentes("chartGlobalBar", realizados)
    barTaxaPresenca("chartGlobalTaxa", realizados)
    donutPresenca("chartGlobalDonut", resumo.totalPresentes, resumo.totalAusentes)
    lineEvolucaoEventos("chartGlobalEvo", realizados)
    return
  }

  const kpisHost = document.getElementById("kpisGlobal")
  kpisHost.className = "kpi-grid"
  kpisHost.innerHTML = renderKPIs(resumo, eventos)

  // Insights particionados por severidade
  const insights = gerarInsightsGlobais(data)
  const alerts = insights.filter(i => i.type === "danger" || i.type === "warn")
  const highlights = insights.filter(i => i.type === "positive" || i.type === "neutral")

  const alertStrip = document.getElementById("alertStrip")
  if (alerts.length) {
    alertStrip.innerHTML = renderInsights(alerts.slice(0, 3), { variant: "alert" })
    alertStrip.hidden = false
  } else {
    alertStrip.hidden = true
    alertStrip.innerHTML = ""
  }

  const highlightsBlock = document.getElementById("highlightsBlock")
  const highlightsGrid = document.getElementById("highlightsGrid")
  if (highlights.length) {
    highlightsGrid.innerHTML = renderInsights(highlights, { variant: "compact", limit: 4 })
    highlightsBlock.hidden = false
  } else {
    highlightsBlock.hidden = true
    highlightsGrid.innerHTML = ""
  }

  // Eventos com vínculo de curso (grupo) viram um card de curso com as
  // turmas/módulos listados; os demais seguem como card de evento normal.
  // Ordenados do mais recente para o mais antigo; inicia mostrando 4.
  const parseDateSafe = d => {
    if (!d) return 0
    const t = Date.parse(d)
    return Number.isFinite(t) ? t : 0
  }
  // "Ativo" = inscrição aberta OU ainda acontecendo (data de início já passou e
  // a data-fim — último encontro — ainda não passou). Esses vêm no topo da lista.
  const hojeMs = (() => { const h = new Date(); h.setHours(0, 0, 0, 0); return h.getTime() })()
  const eventoAtivo = e => {
    const cands = (e._turmas && e._turmas.length) ? e._turmas : [e]
    return cands.some(c => {
      if (c.inscricaoAberta) return true
      const ini = parseDateSafe(c.date), fim = parseDateSafe(c.dateFim)
      return ini && fim && ini <= hojeMs && hojeMs <= fim
    })
  }
  const gruposEventos = agruparEventos(eventos)
    .slice()
    .sort((a, b) => {
      const aA = a.eventos.some(eventoAtivo), bA = b.eventos.some(eventoAtivo)
      if (aA !== bA) return aA ? -1 : 1 // ativos (abertos/acontecendo) primeiro
      const da = Math.max(0, ...a.eventos.map(e => parseDateSafe(e.date)))
      const db = Math.max(0, ...b.eventos.map(e => parseDateSafe(e.date)))
      return db - da
    })
  const grid = document.getElementById("eventGrid")
  if (!grid) return
  const PAGE = 4
  if (state.eventGridShown == null) state.eventGridShown = PAGE

  const wireEventCards = () => {
    document.querySelectorAll(".event-card").forEach(card =>
      card.addEventListener("click", e => {
        if (e.target.closest("[data-action]") || e.target.closest(".course-card__turma")) return
        state.selectedEventId = card.dataset.event
        state.selectedTurmaId = null // card → consolidado
        navigate("eventos")
      })
    )
    document.querySelectorAll(".course-card__turma").forEach(b =>
      b.addEventListener("click", () => {
        state.selectedEventId = b.dataset.group || b.dataset.event
        state.selectedTurmaId = b.dataset.group ? b.dataset.event : null
        navigate("eventos")
      })
    )
    document.querySelectorAll('[data-action="detalhe"]').forEach(b =>
      b.addEventListener("click", e => {
        e.stopPropagation()
        state.selectedEventId = b.dataset.event
        state.selectedTurmaId = null
        navigate("eventos")
      })
    )
    document.querySelectorAll('[data-action="certificados"]').forEach(b =>
      b.addEventListener("click", e => {
        e.stopPropagation()
        const ev = resolverEvento(b.dataset.event)
        state.certPendingArquivo = b.dataset.fonte || (ev ? ev.fonte : null)
        state.certSource = "evento"
        navigate("certificados")
      })
    )
  }

  const renderGrid = () => {
    const shown = Math.min(state.eventGridShown, gruposEventos.length)
    const cardsHtml = gruposEventos
      .slice(0, shown)
      .map(g => {
        const ev = g.eventos[0]
        // Turmas reais: membros de grupo (subpastas) + divisão por coluna de
        // turma (arquivo único com várias turmas) + turmas com inscrição aberta.
        const turmas = turmasExpandidas(ev)
        if (turmas.length > 1) {
          return renderCourseCard({
            grupo: ev.grupo || { id: ev.id, titulo: ev.title },
            eventos: turmas,
            base: ev
          })
        }
        return renderEventCard(ev)
      })
      .join("")
    grid.innerHTML = cardsHtml

    const remaining = gruposEventos.length - shown
    const host = grid.parentElement
    const existing = host && host.querySelector(".event-grid__more")
    if (existing) existing.remove()
    let more = ""
    if (remaining > 0) {
      more = `<div class="event-grid__more">
        <button type="button" class="btn" id="eventGridMore">
          <i class="fas fa-chevron-down"></i> Ver mais (${remaining} restante${remaining === 1 ? "" : "s"})
        </button>
      </div>`
    } else if (shown > PAGE) {
      more = `<div class="event-grid__more">
        <button type="button" class="btn" id="eventGridLess">
          <i class="fas fa-chevron-up"></i> Recolher
        </button>
      </div>`
    }
    if (more && host) host.insertAdjacentHTML("beforeend", more)

    const moreBtn = document.getElementById("eventGridMore")
    if (moreBtn)
      moreBtn.addEventListener("click", () => {
        state.eventGridShown += PAGE
        renderGrid()
      })
    const lessBtn = document.getElementById("eventGridLess")
    if (lessBtn)
      lessBtn.addEventListener("click", () => {
        state.eventGridShown = PAGE
        renderGrid()
        grid.scrollIntoView({ behavior: "smooth", block: "start" })
      })

    wireEventCards()
  }

  renderGrid()
}

// ================ ANÁLISE POR EVENTO ================
// Resolve um id tanto no topo (grupos/standalone) quanto nas turmas internas
// (que ficam em _turmas, fora do nível superior de data.eventos).
function resolverEvento(id) {
  const evs = (state.data && state.data.eventos) || []
  const top = evs.find(e => e.id === id)
  if (top) return top
  for (const g of evs) {
    const t = (g._turmas || []).find(e => e.id === id)
    if (t) return t
  }
  return null
}

function renderViewEventos() {
  const { data } = state
  const eventos = data.eventos
  if (!eventos.length) {
    document.getElementById("view-eventos").innerHTML = `<div class="empty-state"><h3>Nenhum evento</h3></div>`
    return
  }

  // Normaliza a seleção: o dropdown guarda o id do EVENTO (topo). Se vier um id
  // de turma (ex.: clique no card), descobre o evento dono e marca a turma.
  let topEv = eventos.find(e => e.id === state.selectedEventId)
  if (!topEv) {
    for (const g of eventos) {
      if ((g._turmas || []).some(t => t.id === state.selectedEventId)) {
        state.selectedTurmaId = state.selectedEventId
        state.selectedEventId = g.id
        topEv = g
        break
      }
    }
  }
  if (!topEv) { topEv = eventos[0]; state.selectedEventId = topEv.id; state.selectedTurmaId = null }

  // Turmas do evento (subpastas + divisão por coluna + inscrição aberta).
  const turmasList = turmasExpandidas(topEv)
  const turmas = turmasList.length > 1 ? turmasList : null
  const turmaSel = turmas ? (turmas.find(t => t.id === state.selectedTurmaId) || null) : null
  const alvo = turmaSel || topEv

  // Dropdown: UMA opção por evento.
  const optionsHtml = eventos.map(e =>
    `<option value="${e.id}" ${e.id === state.selectedEventId ? "selected" : ""}>${escapeHtml(e.title)}${e.date ? " (" + formatDateBR(e.date) + ")" : ""}</option>`
  ).join("")

  // Seletor de turma (só para eventos com turmas): Consolidado + cada turma.
  const pill = (id, label, ativo, open) =>
    `<button type="button" class="turma-pill${ativo ? " is-active" : ""}${open ? " is-open" : ""}" data-turma="${escapeHtml(id)}">${escapeHtml(label)}</button>`
  const subSelector = turmas ? `
    <div class="turma-switch" role="tablist" aria-label="Selecionar turma">
      ${pill("", "Consolidado", !turmaSel, false)}
      ${turmas.map(t => pill(t.id, turmaLabel(t), !!(turmaSel && turmaSel.id === t.id), !!t.inscricaoAberta)).join("")}
    </div>` : ""

  const view = document.getElementById("view-eventos")
  view.innerHTML = `
    <div class="event-picker">
      <label class="event-picker__label" for="evSelect">
        <i class="fas fa-calendar-day"></i> Evento
      </label>
      <select id="evSelect" class="event-picker__select">
        ${optionsHtml}
      </select>
    </div>
    ${subSelector}
    <div id="eventDetailBlock"></div>
  `
  document.getElementById("evSelect").addEventListener("change", e => {
    state.selectedEventId = e.target.value
    state.selectedTurmaId = null // volta ao consolidado ao trocar de evento
    renderViewEventos()
  })
  view.querySelectorAll(".turma-pill").forEach(b => b.addEventListener("click", () => {
    state.selectedTurmaId = b.dataset.turma || null
    renderViewEventos()
  }))
  if (alvo) renderEventBlock(alvo)
}

function renderEventBlock(ev) {
  const block = document.getElementById("eventDetailBlock")
  const tabsKey = "eventos"

  // Abas conforme o tipo de evento:
  //  - turma ABERTA para inscrição → só Inscrições + Encontros & Lembretes;
  //  - qualquer evento ENCERRADO/realizado (turma, consolidado ou standalone)
  //    → só as análises (Resumo, Distribuições, Participantes).
  const aberta = !!ev.inscricaoAberta
  const tabIds = aberta
    ? ["inscricoes", "encontros", "presenca"]
    : ["resumo", "distribuicoes", "participantes"]
  let active = getActiveTab(tabsKey, tabIds[0])
  if (!tabIds.includes(active)) active = tabIds[0]

  const tabDefs = {
    resumo: { id: "resumo", label: "Resumo & Insights", icon: "fa-circle-info" },
    distribuicoes: { id: "distribuicoes", label: "Distribuições", icon: "fa-chart-pie" },
    participantes: { id: "participantes", label: "Participantes", icon: "fa-users", badge: (ev.participantes || []).length },
    inscricoes: { id: "inscricoes", label: "Inscrições", icon: "fa-user-plus" },
    encontros: { id: "encontros", label: "Encontros & Lembretes", icon: "fa-bell" },
    presenca: { id: "presenca", label: "Presença", icon: "fa-clipboard-check" },
  }

  // Cabeçalho: turma aberta tem um banner próprio (sem KPIs de presença).
  const turmaTxt = ev.grupo && ev.grupo.turma != null ? `Turma ${ev.grupo.turma}`
    : ev.grupo && ev.grupo.modulo != null ? `Módulo ${ev.grupo.modulo}` : ""
  const headerHtml = aberta
    ? `<section class="event-detail event-detail--aberta" data-tone="scheduled">
        <header class="event-detail__head">
          <div class="event-detail__title-wrap">
            <h2 class="event-detail__title">${escapeHtml((ev.grupo && ev.grupo.titulo) || ev.title)}${turmaTxt ? " · " + escapeHtml(turmaTxt) : ""}</h2>
            <div class="event-detail__meta">
              <span class="lemb-tag-aberta"><i class="fas fa-user-plus"></i> Inscrições abertas</span>
              ${ev.pastaInscricao ? `<span title="${escapeHtml(ev.pastaInscricao)}"><i class="fas fa-folder-open"></i> ${escapeHtml(ev.pastaInscricao)}</span>` : ""}
            </div>
          </div>
        </header>
      </section>`
    : renderEventDetail(ev)

  block.innerHTML = `
    ${headerHtml}
    ${renderTabsNav(tabsKey, tabIds.map(id => tabDefs[id]))}

    ${tabIds.includes("resumo") ? `<div class="view-tabs__panel" data-tab-panel="resumo" ${active === "resumo" ? "" : "hidden"}>
      <div class="card">
        <div class="card__header"><div><h3>Observações automáticas</h3><p>Insights deste evento.</p></div></div>
        <div class="insights-grid" style="grid-template-columns:1fr;" id="evInsights"></div>
      </div>
    </div>` : ""}

    ${tabIds.includes("distribuicoes") ? `<div class="view-tabs__panel" data-tab-panel="distribuicoes" ${active === "distribuicoes" ? "" : "hidden"}>
      <!-- Linha 1: Top Participação + Top Evasão deste evento -->
      <div class="grid-2">
        <div class="card">
          <div class="card__header"><div><h3>Top Secretarias com Mais Participação</h3><p>Inscritos por secretaria neste evento.</p></div></div>
          <div class="chart-wrap lg"><canvas id="chartEvSec"></canvas></div>
        </div>
        <div class="card">
          <div class="card__header"><div><h3>Top Secretarias com Mais Evasão</h3><p>Inscritos que não compareceram, por secretaria.</p></div></div>
          <div class="chart-wrap lg"><canvas id="chartEvEvasao"></canvas></div>
        </div>
      </div>

      <!-- Linha 2: Presença + (Por módulo | Distribuição por turma) -->
      <div class="grid-2">
        <div class="card">
          <div class="card__header"><div><h3>${ev.modulos ? "Aptos ao certificado" : "Presença"}</h3><p>${ev.modulos ? "Compareceram a <b>todos os módulos</b> vs faltaram em pelo menos um." : "Compareceram vs faltaram."}</p></div></div>
          <div class="chart-wrap lg"><canvas id="chartEvDonut"></canvas></div>
        </div>
        <div class="card">
          <div class="card__header"><div><h3>${ev.modulos ? "Presença e ausência por módulo" : "Distribuição por turma"}</h3><p>${ev.modulos ? "Comparativo de comparecimento em cada módulo." : "Inscritos por turma."}</p></div></div>
          <div class="chart-wrap lg"><canvas id="chartEvTurmas"></canvas></div>
        </div>
      </div>

      <!-- Linha 3: Curva de inscrições (full-width) -->
      <div class="card">
        <div class="card__header"><div><h3>Curva de inscrições</h3><p>Inscrições por dia até o evento.</p></div></div>
        <div class="chart-wrap lg"><canvas id="chartEvTimeline"></canvas></div>
      </div>
    </div>` : ""}

    ${tabIds.includes("participantes") ? `<div class="view-tabs__panel" data-tab-panel="participantes" ${active === "participantes" ? "" : "hidden"}>
      <div class="grid-2 participantes-grid">
        <div class="table-wrap">
          <div class="table-wrap__head">
            <h3><i class="fas fa-circle-check" style="color: var(--ind-good)"></i> Presentes</h3>
            <span class="card__header-meta">${(ev.participantes || []).filter(p => p.presente).length} pessoa(s)</span>
          </div>
          <div id="evPresentesTable"></div>
        </div>

        <div class="table-wrap">
          <div class="table-wrap__head">
            <h3><i class="fas fa-circle-xmark" style="color: var(--red)"></i> Faltou</h3>
            <span class="card__header-meta">${(ev.participantes || []).filter(p => !p.presente).length} pessoa(s)</span>
          </div>
          <div id="evFaltouTable"></div>
        </div>
      </div>
    </div>` : ""}

    ${tabIds.includes("inscricoes") ? `<div class="view-tabs__panel" data-tab-panel="inscricoes" ${active === "inscricoes" ? "" : "hidden"}>
      <div id="lembInscPanel"></div>
    </div>` : ""}

    ${tabIds.includes("encontros") ? `<div class="view-tabs__panel" data-tab-panel="encontros" ${active === "encontros" ? "" : "hidden"}>
      <div id="lembEncPanel"></div>
    </div>` : ""}

    ${tabIds.includes("presenca") ? `<div class="view-tabs__panel" data-tab-panel="presenca" ${active === "presenca" ? "" : "hidden"}>
      <div id="lembPresPanel"></div>
    </div>` : ""}
  `

  wireTabs(tabsKey, () => renderEventBlock(ev))

  if (active === "participantes") {
    const presentes = (ev.participantes || []).filter(p => p.presente)
    const faltou = (ev.participantes || []).filter(p => !p.presente)
    renderPaginatedTable("evPresentesTable", presentes, `ev-${ev.id}-presentes`)
    renderPaginatedTable("evFaltouTable", faltou, `ev-${ev.id}-faltou`)
  } else if (active === "inscricoes") {
    renderInscricoes("lembInscPanel", ev)
  } else if (active === "encontros") {
    renderEncontros("lembEncPanel", ev)
  } else if (active === "presenca") {
    renderPresenca("lembPresPanel", ev)
  }

  if (active === "resumo") {
    document.getElementById("evInsights").innerHTML = renderInsights(gerarInsightsEvento(ev))
  } else if (active === "distribuicoes") {
    donutPresenca("chartEvDonut", ev.totalPresentes, ev.totalAusentes)
    if (ev.modulos) {
      barModulosPresenca("chartEvTurmas", ev.modulos)
    } else {
      pieTurmas("chartEvTurmas", distribuicaoPorTurma(ev))
    }
    barSecretarias(
      "chartEvSec",
      participacaoPorSecretaria(ev).sort((a, b) => b.qtd - a.qtd)
    )
    barSecretarias("chartEvEvasao", evasaoPorSecretariaEvento(ev), { datasetLabel: "Faltas", unitLabel: "ausência(s)" })
    lineTimeline("chartEvTimeline", ev.timelineInscricoes || [], "Inscrições no dia")
  }
}


// ================ PARTICIPANTES ================
function renderViewParticipantes() {
  const { data } = state
  const view = document.getElementById("view-participantes")
  view.innerHTML = `<div id="participantesPanel"></div>`
  renderParticipantesTodos()
}

function renderParticipantesTodos() {
  const { data } = state
  const allSecs = [...new Set(data.eventos.flatMap(e => Object.keys(e.secretarias || {})))].sort()
  const allTurmas = [...new Set(data.eventos.flatMap(e => Object.keys(e.turmas || {})))].sort()
  const f = state.reportFilters

  document.getElementById("participantesPanel").innerHTML = `
    <div class="filters">
      <div class="filter">
        <label for="pEvento">Evento</label>
        <select id="pEvento">
          <option value="">Todos os eventos</option>
          ${data.eventos.map(e => `<option value="${e.id}" ${f.eventoId === e.id ? "selected" : ""}>${escapeHtml(e.title)}</option>`).join("")}
        </select>
      </div>
      <div class="filter">
        <label for="pSec">Secretaria</label>
        <select id="pSec">
          <option value="">Todas</option>
          ${allSecs.map(s => `<option ${f.secretaria === s ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")}
        </select>
      </div>
      <div class="filter">
        <label for="pTurma">Turma</label>
        <select id="pTurma">
          <option value="">Todas</option>
          ${allTurmas.map(t => `<option ${f.turma === t ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}
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
  `

  const apply = () => {
    state.reportFilters = {
      eventoId: document.getElementById("pEvento").value,
      secretaria: document.getElementById("pSec").value,
      turma: document.getElementById("pTurma").value,
      busca: document.getElementById("pBusca").value
    }
    populateParticipantes()
  }
  ;["pEvento", "pSec", "pTurma"].forEach(id => document.getElementById(id).addEventListener("change", apply))
  document.getElementById("pBusca").addEventListener("input", apply)
  populateParticipantes()
}

// ---------------- Faltas recorrentes ----------------
function computeFaltasRecorrentes(data, months) {
  // Janela: ultimos N meses a partir da data do evento mais recente (ou hoje)
  const eventDates = data.eventos
    .map(e => e.date)
    .filter(Boolean)
    .sort()
  const ref = eventDates.length ? new Date(eventDates[eventDates.length - 1]) : new Date()
  const cutoff = new Date(ref)
  cutoff.setMonth(cutoff.getMonth() - months)

  // Agrupa por chave (email normalizado; fallback no nome lowercase)
  const groups = new Map()
  data.eventos.forEach(ev => {
    if (!ev.date) return
    const evDate = new Date(ev.date)
    if (evDate < cutoff || evDate > ref) return
    ;(ev.participantes || []).forEach(p => {
      // Mesma chave usada por agregarServidores - garante que o modal
      // de perfil encontra o servidor pelo data-servidor-chave.
      const key = chaveServidor(p)
      if (!key) return
      if (!groups.has(key)) {
        groups.set(key, {
          chave: key,
          nome: p.nome,
          email: p.email || "",
          secretaria: p.secretaria || "",
          inscricoes: 0,
          faltas: 0,
          presencas: 0,
          eventos: []
        })
      }
      const g = groups.get(key)
      g.inscricoes += 1
      if (p.presente) g.presencas += 1
      else g.faltas += 1
      g.eventos.push({ titulo: ev.title, data: ev.date, presente: p.presente })
      // Mantem nome/secretaria mais recente caso varie
      if (p.nome && !g.nome) g.nome = p.nome
      if (p.secretaria && !g.secretaria) g.secretaria = p.secretaria
    })
  })

  // Apenas quem comprou ingresso e faltou ao menos uma vez
  return [...groups.values()]
    .filter(g => g.faltas >= 1)
    .map(g => ({
      ...g,
      taxaAbsenteismo: Math.round((g.faltas / g.inscricoes) * 100)
    }))
    .sort((a, b) => b.faltas - a.faltas || b.taxaAbsenteismo - a.taxaAbsenteismo)
}

function renderViewFaltas() { renderFaltasRecorrentes() }

function renderFaltasRecorrentes() {
  const months = state.faltasWindow || 3
  const onlyMultiple = state.faltasOnlyMultiple !== false // default true

  const panel = document.getElementById("view-faltas")
  panel.innerHTML = `
    <div class="filters">
      <div class="filter">
        <label>Janela de tempo</label>
        <div class="pill-group" role="tablist">
          ${[1, 2, 3]
            .map(
              m => `
            <button class="pill ${months === m ? "is-active" : ""}" data-window="${m}">
              <i class="fas fa-calendar"></i> ${m} ${m === 1 ? "mês" : "meses"}
            </button>
          `
            )
            .join("")}
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
  `

  panel.querySelectorAll(".pill").forEach(b =>
    b.addEventListener("click", () => {
      state.faltasWindow = parseInt(b.dataset.window, 10)
      renderFaltasRecorrentes()
    })
  )
  document.getElementById("faltasOnlyMulti").addEventListener("change", e => {
    state.faltasOnlyMultiple = e.target.checked
    populateFaltasTable()
  })
  document.getElementById("faltasBusca").addEventListener("input", e => {
    state.faltasBusca = e.target.value
    populateFaltasTable()
  })
  populateFaltasTable()
}

function populateFaltasTable() {
  const months = state.faltasWindow || 3
  const onlyMultiple = state.faltasOnlyMultiple !== false
  const busca = (state.faltasBusca || "").toLowerCase()
  let rows = computeFaltasRecorrentes(state.data, months)
  if (onlyMultiple) rows = rows.filter(r => r.faltas >= 2)
  if (busca) {
    rows = rows.filter(
      r => (r.nome || "").toLowerCase().includes(busca) || (r.email || "").toLowerCase().includes(busca) || (r.secretaria || "").toLowerCase().includes(busca)
    )
  }

  document.getElementById("faltasCount").textContent = `${rows.length} pessoa(s)`

  if (!rows.length) {
    document.getElementById("faltasTable").innerHTML = `
      <div class="empty-state">
        <i class="fas fa-circle-check"></i>
        <h3>Sem faltas recorrentes na janela</h3>
        <p>Nenhum participante com faltas dentro de ${months} ${months === 1 ? "mês" : "meses"}.</p>
      </div>
    `
    return
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
          ${rows
            .map(
              r => `
            <tr>
              <td class="cell-name"><a class="servidor-link" data-servidor-chave="${escapeHtml(r.chave || "")}" tabindex="0" role="button">${escapeHtml(r.nome || "-")}</a></td>
              <td class="col-hide-sm">${escapeHtml(r.email || "-")}</td>
              <td>${escapeHtml(r.secretaria || "-")}</td>
              <td style="text-align:center;">${r.inscricoes}</td>
              <td style="text-align:center;"><span class="cell-status ${r.faltas >= 2 ? "red" : "amber"}">${r.faltas}</span></td>
              <td style="text-align:center;">${r.presencas}</td>
              <td style="text-align:right; font-weight:600;">${r.taxaAbsenteismo}%</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `
  document.getElementById("faltasTable").innerHTML = html
}

function populateParticipantes() {
  const parts = collectParticipantes()
  renderPaginatedTable("pTable", parts, "participantes-global")
  document.getElementById("pCount").textContent = `${parts.length} pessoa(s)`
}

function collectParticipantes() {
  const f = state.reportFilters
  let evs = state.data.eventos
  if (f.eventoId) evs = evs.filter(e => e.id === f.eventoId)
  const out = []
  const busca = (f.busca || "").toLowerCase()
  evs.forEach(e => {
    e.participantes.forEach(p => {
      if (f.secretaria && p.secretaria !== f.secretaria) return
      if (f.turma && p.turma !== f.turma) return
      if (busca && !`${p.nome} ${p.email || ""}`.toLowerCase().includes(busca)) return
      out.push({ ...p, eventoTitle: e.title, eventoId: e.id })
    })
  })
  return out
}

// ================================================================
// ANALÍTICAS COMPARTILHADAS (Insights / Servidores / Cargos)
// ================================================================

// ================ INSIGHTS (aba) ================
function renderInsightsTab() {
  const host = document.getElementById("insightsHost")
  if (!host) return
  const eventos = state.data.eventos.filter(e => e.status === "realizado")
  const servidores = agregarServidores(eventos)
  const ret = taxaRetencao(servidores)

  // Funil capacidade → inscritos → presentes
  const tCap = eventos.reduce((s, e) => s + (e.vagas || 0), 0)
  const tIns = eventos.reduce((s, e) => s + (e.totalInscritos || 0), 0)
  const tPres = eventos.reduce((s, e) => s + (e.totalPresentes || 0), 0)

  // Apenas os 1º colocados (todos empatados no topo). Sem 2º/3º/4º/5º.
  // Empates em ordem alfabética. Paginado 5 em 5 na view.
  const ordenados = servidores
    .filter(s => s.totalPresentes >= 1)
    .sort((a, b) => b.totalPresentes - a.totalPresentes || (a.nome || "").localeCompare(b.nome || "", "pt-BR"))
  const maxPresentes = ordenados.length ? ordenados[0].totalPresentes : 0
  const topServidores = ordenados
    .filter(s => s.totalPresentes === maxPresentes)
    .map(s => ({ ...s, rank: 1 }))

  host.innerHTML = `
    <div class="insights-board">
      <!-- Linha 1: KPIs leves -->
      <div class="kpi-grid">
        <div class="kpi">
          <div class="kpi__icon"><i class="fas fa-user-check"></i></div>
          <div class="kpi__label">Servidores únicos</div>
          <div class="kpi__value">${ret.unicos}</div>
          <div class="kpi__delta">presentes em algum evento</div>
        </div>
        <div class="kpi kpi--accent">
          <div class="kpi__icon"><i class="fas fa-rotate"></i></div>
          <div class="kpi__label">Taxa de retenção</div>
          <div class="kpi__value">${ret.pct.toFixed(1).replace(".", ",")}<small>%</small></div>
          <div class="kpi__delta"><b>${ret.retidos}</b> servidores em ≥ 2 eventos</div>
        </div>
        <div class="kpi">
          <div class="kpi__icon"><i class="fas fa-list-check"></i></div>
          <div class="kpi__label">Eventos realizados</div>
          <div class="kpi__value">${eventos.length}</div>
          <div class="kpi__delta">no recorte atual</div>
        </div>
      </div>

      <!-- Linha 2: Funil + Top servidores (top 10 com pódio) -->
      <div class="grid-2">
        <div class="card">
          <div class="card__header"><div><h3><i class="fas fa-filter"></i> Funil - Capacidade → Inscritos → Presentes</h3><p>Quanto da oferta vira presença efetiva.</p></div></div>
          <div class="funil">
            ${[
              { label: "Vagas oferecidas", value: tCap, base: tCap, color: "var(--blue-700,#1B2A4E)" },
              { label: "Inscritos",        value: tIns, base: tCap, color: "var(--blue-500,#3B5BA5)" },
              { label: "Presentes",        value: tPres, base: tCap, color: "var(--ind-good-light,#6E9BD6)" }
            ].map(f => {
              const pct = f.base ? Math.min(100, (f.value / f.base) * 100) : 0
              return `
                <div class="funil__row">
                  <div class="funil__label"><span>${f.label}</span><b>${f.value}</b></div>
                  <div class="funil__bar"><span style="width:${pct.toFixed(1)}%; background:${f.color};"></span></div>
                </div>`
            }).join("")}
          </div>
          <div class="funil__caption">
            ${tIns ? `Taxa de presença geral: <b>${((tPres / tIns) * 100).toFixed(1).replace(".", ",")}%</b>` : "Sem inscrições no recorte."} ·
            ${tCap ? `Preenchimento das vagas: <b>${((tIns / tCap) * 100).toFixed(1).replace(".", ",")}%</b>` : "Capacidade não informada."}
          </div>
        </div>

        <div class="card">
          <div class="card__header">
            <div><h3><i class="fas fa-medal"></i> Top servidores participantes</h3><p>1º lugar - servidores com mais presenças (paginado 5 em 5).</p></div>
            <span class="card__header-meta">${topServidores.length} servidor(es)</span>
          </div>
          <div id="insTopHost"></div>
        </div>
      </div>
    </div>
  `

  // Top servidores paginado 5 em 5 (mantém ordem do dense rank)
  renderPodioInsightsPaginated("insTopHost", topServidores, "insights-top", 5)
}


// Linha da tabela de Top servidores - mesmo design da "Lista completa de
// servidores" (Servidores destaque): # + medalha, Servidor e Secretaria.
// Empates compartilham a medalha (dense rank: 1º ouro, 2º prata, 3º bronze).
function renderTopServidorRow(s, pos) {
  const r = s.rank
  const medalCls = r === 1 ? "row-medal-gold"
    : r === 2 ? "row-medal-silver"
    : r === 3 ? "row-medal-bronze"
    : ""
  const medalIcon = r != null && r <= 3 ? `<i class="fas fa-medal" style="margin-right:6px;"></i>` : ""
  return `
    <tr class="${medalCls}">
      <td class="cell-num">${medalIcon}${pos}</td>
      <td class="cell-name"><a class="servidor-link" data-servidor-chave="${escapeHtml(s.chave || "")}" tabindex="0" role="button">${escapeHtml(s.nome || "(sem nome)")}</a></td>
      <td>${escapeHtml(s.secretaria || "-")}</td>
    </tr>
  `
}

// Top servidores paginado - tabela no mesmo estilo de Servidores destaque,
// preservando o dense rank e mostrando `pageSize` itens por página.
function renderPodioInsightsPaginated(containerId, lista, scopeId, pageSize = 5) {
  const container = document.getElementById(containerId)
  if (!container) return
  if (!lista.length) {
    container.innerHTML = `<div class="table-scroll"><table class="data"><thead><tr><th style="width:70px;">#</th><th>Servidor</th><th>Secretaria</th></tr></thead><tbody><tr><td colspan="3" class="empty-cell">Nenhum servidor com presença ainda.</td></tr></tbody></table></div>`
    return
  }
  const totalPages = Math.max(1, Math.ceil(lista.length / pageSize))
  const cur = state.pagerPages[scopeId] || 1
  if (cur > totalPages) state.pagerPages[scopeId] = 1
  if (!state.pagerPages[scopeId]) state.pagerPages[scopeId] = 1

  const draw = () => {
    const page = state.pagerPages[scopeId] || 1
    const slice = lista.slice((page - 1) * pageSize, page * pageSize)
    const from = (page - 1) * pageSize + 1
    const to = Math.min(page * pageSize, lista.length)
    const offset = (page - 1) * pageSize
    container.innerHTML = `
      <div class="table-scroll">
        <table class="data">
          <thead>
            <tr>
              <th style="width:70px;">#</th>
              <th>Servidor</th>
              <th>Secretaria</th>
            </tr>
          </thead>
          <tbody>${slice.map((s, i) => renderTopServidorRow(s, offset + i + 1)).join("")}</tbody>
        </table>
      </div>
      ${lista.length > pageSize ? `
        <div class="pager" data-pager-scope="${scopeId}">
          <span class="pager__info"><b>${from}–${to}</b> de <b>${lista.length}</b></span>
          <div class="pager__controls">
            <button type="button" class="pager__btn ${page === 1 ? "is-disabled" : ""}" data-pager-scope="${scopeId}" data-pager-page="${page - 1}" ${page === 1 ? "disabled" : ""} aria-label="Página anterior"><i class="fas fa-chevron-left"></i></button>
            <span class="pager__current"><b>${page}</b> / ${totalPages}</span>
            <button type="button" class="pager__btn ${page === totalPages ? "is-disabled" : ""}" data-pager-scope="${scopeId}" data-pager-page="${page + 1}" ${page === totalPages ? "disabled" : ""} aria-label="Próxima página"><i class="fas fa-chevron-right"></i></button>
          </div>
        </div>` : ""}
    `
    container.querySelectorAll(`[data-pager-scope="${scopeId}"][data-pager-page]`).forEach(btn => {
      btn.addEventListener("click", () => {
        const p = parseInt(btn.dataset.pagerPage, 10)
        if (!Number.isFinite(p) || p < 1) return
        state.pagerPages[scopeId] = p
        draw()
      })
    })
  }
  draw()
}

// ================ RELATÓRIOS ================
function renderViewRelatorios() {
  const { data } = state
  const f = state.reportFilters
  const allSecs = [...new Set(data.eventos.flatMap(e => Object.keys(e.secretarias || {})))].sort()

  const view = document.getElementById("view-relatorios")
  view.innerHTML = `
    <div class="filters">
      <div class="filter">
        <label for="rEvento">Evento</label>
        <select id="rEvento">
          <option value="">Todos</option>
          ${data.eventos.map(e => `<option value="${e.id}" ${f.eventoId === e.id ? "selected" : ""}>${escapeHtml(e.title)}</option>`).join("")}
        </select>
      </div>
      <div class="filter">
        <label for="rSec">Secretaria</label>
        <select id="rSec">
          <option value="">Todas</option>
          ${allSecs.map(s => `<option ${f.secretaria === s ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")}
        </select>
      </div>
      <div class="filters__actions">
        <button class="btn btn--sm" id="rClear"><i class="fas fa-rotate-left"></i> Limpar</button>
        <button class="btn btn--sm" id="rCsv"><i class="fas fa-file-csv"></i> CSV</button>
        <button class="btn btn--sm" id="rPdf"><i class="fas fa-file-pdf"></i> PDF</button>
        <button class="btn btn--sm" id="rXlsx"><i class="fas fa-file-excel"></i> Excel</button>
        <button class="btn btn--sm" id="rPptx"><i class="fas fa-file-powerpoint"></i> PPTX</button>
      </div>
    </div>

    <!-- Resumo executivo do recorte atual (orienta o que vai ser exportado) -->
    <div class="kpi-grid" id="rResumo"></div>

    <!-- Único bloco: Presentes / Faltantes (não duplicado em outra view) -->
    <div class="grid-2 participantes-split">
      <div class="card">
        <div class="card__header">
          <div><h3><i class="fas fa-check-circle" style="color:var(--ind-good,#3063ad);"></i> Presentes</h3><p>Quem fez check-in.</p></div>
          <span class="card__header-meta" id="rPresCount">0</span>
        </div>
        <div id="rPresHost"></div>
      </div>
      <div class="card">
        <div class="card__header">
          <div><h3><i class="fas fa-circle-xmark" style="color:#C0392B;"></i> Faltantes</h3><p>Inscritos que não compareceram.</p></div>
          <span class="card__header-meta" id="rFaltCount">0</span>
        </div>
        <div id="rFaltHost"></div>
      </div>
    </div>
  `

  const apply = () => {
    state.reportFilters = {
      eventoId: document.getElementById("rEvento").value,
      secretaria: document.getElementById("rSec").value,
      turma: "",
      busca: ""
    }
    populateRelatorios()
  }
  ;["rEvento", "rSec"].forEach(id => document.getElementById(id).addEventListener("change", apply))
  document.getElementById("rClear").addEventListener("click", () => {
    state.reportFilters = { eventoId: "", secretaria: "", turma: "", busca: "" }
    renderViewRelatorios()
  })
  document.getElementById("rCsv").addEventListener("click", exportCsv)
  document.getElementById("rPdf").addEventListener("click", exportPdf)
  document.getElementById("rXlsx").addEventListener("click", exportXlsx)
  document.getElementById("rPptx").addEventListener("click", exportPptx)

  populateRelatorios()
}

function populateRelatorios() {
  const f = state.reportFilters
  let evs = state.data.eventos
  if (f.eventoId) evs = evs.filter(e => e.id === f.eventoId)

  // Resumo executivo do recorte (orienta o que está sendo exportado)
  const totalIns = evs.reduce((s, e) => s + (e.totalInscritos || 0), 0)
  const totalPres = evs.reduce((s, e) => s + (e.totalPresentes || 0), 0)
  const taxa = totalIns ? ((totalPres / totalIns) * 100).toFixed(1).replace(".", ",") + "%" : "-"
  document.getElementById("rResumo").innerHTML = `
    <div class="kpi">
      <div class="kpi__icon"><i class="fas fa-calendar-day"></i></div>
      <div class="kpi__label">Eventos no recorte</div>
      <div class="kpi__value">${evs.length}</div>
      <div class="kpi__delta">${f.eventoId ? "filtro de evento ativo" : "todos os eventos"}</div>
    </div>
    <div class="kpi kpi--accent">
      <div class="kpi__icon"><i class="fas fa-user-plus"></i></div>
      <div class="kpi__label">Inscritos</div>
      <div class="kpi__value">${totalIns}</div>
      <div class="kpi__delta">${f.secretaria ? "secretaria filtrada" : "todas as secretarias"}</div>
    </div>
    <div class="kpi">
      <div class="kpi__icon"><i class="fas fa-user-check"></i></div>
      <div class="kpi__label">Presentes</div>
      <div class="kpi__value">${totalPres}</div>
      <div class="kpi__delta">com check-in</div>
    </div>
    <div class="kpi kpi--warn">
      <div class="kpi__icon"><i class="fas fa-chart-pie"></i></div>
      <div class="kpi__label">Taxa de presença</div>
      <div class="kpi__value">${taxa}</div>
      <div class="kpi__delta">recorte atual</div>
    </div>
  `

  const parts = collectParticipantes()
  const presentes = parts.filter(p => p.presente)
  const faltantes = parts.filter(p => !p.presente)
  renderPaginatedTable("rPresHost", presentes, "relatorios-presentes", { hideEmail: true, hideTurma: true })
  renderPaginatedTable("rFaltHost", faltantes, "relatorios-faltantes", { hideEmail: true, hideTurma: true })
  document.getElementById("rPresCount").textContent = `${presentes.length} pessoa(s)`
  document.getElementById("rFaltCount").textContent = `${faltantes.length} pessoa(s)`
}

// ============================================================
// MODELO DE RELATÓRIO (dependente do filtro) + base ABNT
// ============================================================

// Data de extração dos dados (geradoEm do eventos-data.json) formatada pt-BR.
function dataExtracao() {
  const iso = state.data && state.data.geradoEm
  const d = iso ? new Date(iso) : new Date()
  return isNaN(d) ? new Date().toLocaleDateString("pt-BR") : d.toLocaleDateString("pt-BR")
}

// Atribuição de fonte no padrão ABNT, sempre com a data de extração.
// Nunca retorna "Fonte: —".
function relFonte() {
  return `Fonte: Escola de Governo de Pedro Leopoldo. Dados extraídos em ${dataExtracao()}.`
}

const REL_DESC = {
  eventos: "Compara, por evento, o total de inscritos e quantos compareceram (check-in). Quanto mais próximas as barras, maior a adesão.",
  presenca: "Proporção entre presentes e ausentes no recorte.",
  secInscritos: "Secretarias que mais inscreveram servidores.",
  secPresentes: "Secretarias com mais servidores presentes (check-in confirmado).",
  vinculoPresentes: "Presentes por tipo de vínculo (comissionado x efetivo), classificado pelo cargo. Valor estimado a partir da nomenclatura do cargo."
}

// Descrição do gráfico de vínculo, divulgando quantos presentes ficaram sem
// classificação por não terem cargo informado (transparência).
function relVinculoDesc(st) {
  const base = REL_DESC.vinculoPresentes
  return st && st.vinculoSemInfo
    ? `${base} Observação: ${st.vinculoSemInfo} presente(s) sem cargo informado não foram classificados.`
    : base
}

// Estatísticas de um conjunto de participantes (um evento ou o geral).
function statsFromParts(parts) {
  const presentes = parts.filter(p => p.presente)
  const tally = (keyFn, src) => {
    const m = {}
    src.forEach(p => { const k = keyFn(p); if (k) m[k] = (m[k] || 0) + 1 })
    return Object.entries(m).map(([nome, qtd]) => ({ nome, qtd })).sort((a, b) => b.qtd - a.qtd)
  }
  return {
    inscritos: parts.length,
    presentes: presentes.length,
    ausentes: parts.length - presentes.length,
    taxa: parts.length ? Math.round((presentes.length / parts.length) * 1000) / 10 : null,
    rankingInscricoes: tally(p => p.secretaria, parts),
    secPresentes: tally(p => p.secretaria, presentes),
    vinculoPresentes: tally(p => classificarVinculo(p.cargo), presentes),
    vinculoSemInfo: presentes.filter(p => !classificarVinculo(p.cargo)).length
  }
}

// Constrói o modelo do relatório a partir dos filtros atuais.
//  - Todos eventos + todas secretarias → blocos por evento + bloco GERAL.
//  - Evento específico               → apenas o bloco daquele evento.
//  - Secretaria específica           → tudo filtrado por aquela secretaria.
function buildReportModel() {
  const f = state.reportFilters
  const all = state.data.eventos
  const evs = f.eventoId ? all.filter(e => e.id === f.eventoId) : all
  const sec = f.secretaria || null
  const partsOf = ev => (ev.participantes || []).filter(p => !sec || p.secretaria === sec)

  const eventBlocks = evs
    .map(ev => {
      const parts = partsOf(ev)
      return { tipo: "evento", id: ev.id, ev, titulo: ev.title, date: ev.date, vagas: ev.vagas, parts, stats: statsFromParts(parts) }
    })
    .filter(b => b.stats.inscritos > 0)

  const singleEvent = !!f.eventoId
  let blocks = eventBlocks.slice()
  let geral = null
  if (!singleEvent && eventBlocks.length) {
    const allParts = evs.flatMap(partsOf)
    geral = { tipo: "geral", titulo: sec ? `Visão Geral - ${sec}` : "Visão Geral Consolidada", evs, parts: allParts, stats: statsFromParts(allParts) }
    blocks.push(geral)
  }

  return {
    f, sec, evs, singleEvent, eventBlocks, geral, blocks,
    eventoNome: singleEvent ? (evs[0] ? evs[0].title : "-") : "Todos os eventos",
    secretariaNome: sec || "Todas as secretarias",
    extraido: dataExtracao(),
    vazio: blocks.length === 0
  }
}

// ---- Construtores de gráfico (imagem PNG) reutilizados nos exports ----
async function chartInscPresEvento(evs, sec) {
  const labels = evs.map(e => e.title.length > 26 ? e.title.slice(0, 24) + "…" : e.title)
  const insc = evs.map(ev => (ev.participantes || []).filter(p => !sec || p.secretaria === sec).length)
  const pres = evs.map(ev => (ev.participantes || []).filter(p => (!sec || p.secretaria === sec) && p.presente).length)
  return await renderChartToImage("bar", {
    data: { labels, datasets: [
      { label: "Inscritos", data: insc, backgroundColor: MODELO_CHART.navy, borderWidth: 0 },
      { label: "Presentes", data: pres, backgroundColor: MODELO_CHART.blueMid, borderWidth: 0 }
    ] },
    options: {
      scales: {
        y: { beginAtZero: true, title: { display: true, text: "Quantidade", font: { family: MODELO_CHART.font, size: 13, weight: "600" }, color: MODELO_CHART.text }, ticks: { precision: 0, font: { family: MODELO_CHART.font, size: 12 }, color: MODELO_CHART.textMuted }, grid: { color: MODELO_CHART.grid } },
        x: { ticks: { font: { family: MODELO_CHART.font, size: 11 }, color: MODELO_CHART.text, maxRotation: 30, minRotation: 30 }, grid: { display: false } }
      },
      plugins: {
        legend: { position: "top", labels: { font: { family: MODELO_CHART.font, size: 12 }, color: MODELO_CHART.text } },
        title: { display: true, text: "Inscritos x Presentes por Evento", font: { size: 16, weight: "bold", family: MODELO_CHART.font }, color: MODELO_CHART.navy, padding: { bottom: 12 } },
        datalabels: { display: false }
      }
    }
  }, 1100, 520)
}

async function chartDonutPresenca(pres, aus, titulo) {
  return await renderChartToImage("doughnut", {
    data: { labels: ["Presentes", "Ausentes"], datasets: [{ data: [pres, aus], backgroundColor: [MODELO_CHART.navy, MODELO_CHART.blueLighter], borderWidth: 2, borderColor: "#fff" }] },
    options: {
      plugins: {
        legend: { position: "bottom", labels: { font: { family: MODELO_CHART.font, size: 13 }, color: MODELO_CHART.text } },
        title: { display: true, text: titulo, font: { size: 16, weight: "bold", family: MODELO_CHART.font }, color: MODELO_CHART.navy, padding: { bottom: 12 } },
        datalabels: { color: "#fff", font: { weight: "bold", size: 14, family: MODELO_CHART.font }, formatter: (v, ctx) => { const t = ctx.dataset.data.reduce((a, b) => a + b, 0); return t ? `${v}\n${((v / t) * 100).toFixed(1)}%` : v } }
      }
    }
  }, 700, 520)
}

async function chartBarSecretarias(entries, titulo, eixo) {
  const t = (entries || []).slice(0, 10)
  if (!t.length) return null
  return await renderChartToImage("bar", {
    data: { labels: t.map(r => shortenOrg(r.nome, 32)), datasets: [{ data: t.map(r => r.qtd), backgroundColor: modeloGradedColors(t.map(r => r.qtd)), borderWidth: 0, barPercentage: 0.75, categoryPercentage: 0.8 }] },
    options: {
      indexAxis: "y",
      scales: {
        x: { beginAtZero: true, title: { display: true, text: eixo, font: { family: MODELO_CHART.font, size: 13, weight: "600" }, color: MODELO_CHART.text }, ticks: { precision: 0, font: { family: MODELO_CHART.font, size: 12 }, color: MODELO_CHART.textMuted }, grid: { color: MODELO_CHART.grid } },
        y: { ticks: { font: { family: MODELO_CHART.font, size: 11 }, color: MODELO_CHART.text }, grid: { display: false } }
      },
      plugins: {
        legend: { display: false },
        title: { display: true, text: titulo, font: { size: 16, weight: "bold", family: MODELO_CHART.font }, color: MODELO_CHART.navy, padding: { bottom: 12 } },
        datalabels: { anchor: "end", align: "end", offset: 6, color: MODELO_CHART.navy, font: { weight: "bold", size: 12, family: MODELO_CHART.font }, formatter: v => v }
      }
    }
  }, 1100, Math.max(360, 100 + t.length * 36))
}

async function chartVinculo(entries, titulo) {
  const vinc = entries || []
  if (!vinc.length) return null
  const cor = { "Comissionado": MODELO_CHART.navy, "Efetivo": MODELO_CHART.blueMid }
  return await renderChartToImage("doughnut", {
    data: { labels: vinc.map(v => v.nome), datasets: [{ data: vinc.map(v => v.qtd), backgroundColor: vinc.map(v => cor[v.nome] || MODELO_CHART.blueLight), borderWidth: 2, borderColor: "#fff" }] },
    options: {
      plugins: {
        legend: { position: "bottom", labels: { font: { family: MODELO_CHART.font, size: 13 }, color: MODELO_CHART.text } },
        title: { display: true, text: titulo, font: { size: 16, weight: "bold", family: MODELO_CHART.font }, color: MODELO_CHART.navy, padding: { bottom: 12 } },
        datalabels: { color: "#fff", font: { weight: "bold", size: 13, family: MODELO_CHART.font }, formatter: (v, ctx) => { const tt = ctx.dataset.data.reduce((a, b) => a + b, 0); return tt ? `${v}\n${((v / tt) * 100).toFixed(0)}%` : v } }
      }
    }
  }, 700, 520)
}

// Lista ordenada de figuras (gráficos) de um bloco, conforme o filtro.
async function buildBlockFigures(block, sec) {
  const isGeral = block.tipo === "geral"
  const st = block.stats
  const figs = []
  if (isGeral && block.evs && block.evs.length > 1) {
    const img = await chartInscPresEvento(block.evs, sec)
    if (img) figs.push({ titulo: "Inscritos x Presentes por Evento", img, w: 1100, h: 520, descricao: REL_DESC.eventos })
  }
  const imgDonut = await chartDonutPresenca(st.presentes, st.ausentes, isGeral ? "Presença Consolidada" : "Presença")
  if (imgDonut) figs.push({ titulo: isGeral ? "Presença Consolidada" : "Presença", img: imgDonut, w: 700, h: 520, descricao: REL_DESC.presenca })
  if (!sec) {
    if (st.rankingInscricoes.length > 1) {
      const img = await chartBarSecretarias(st.rankingInscricoes, "Top Secretarias por Inscrições", "Inscrições")
      if (img) figs.push({ titulo: "Top Secretarias por Inscrições", img, w: 1100, h: Math.max(360, 100 + Math.min(st.rankingInscricoes.length, 10) * 36), descricao: REL_DESC.secInscritos })
    }
    if (st.secPresentes.length > 1) {
      const img = await chartBarSecretarias(st.secPresentes, "Secretarias com Mais Presentes", "Presentes")
      if (img) figs.push({ titulo: "Secretarias com Mais Presentes", img, w: 1100, h: Math.max(360, 100 + Math.min(st.secPresentes.length, 10) * 36), descricao: REL_DESC.secPresentes })
    }
  }
  return figs
}


// Texto da introdução (ABNT), adaptado ao recorte selecionado.
function reportIntro(model) {
  const p = ["Este relatório apresenta os indicadores de participação dos eventos de capacitação da Escola de Governo de Pedro Leopoldo, elaborado a partir dos registros de inscrição e check-in."]
  if (model.singleEvent) p.push(`O recorte refere-se ao evento "${model.eventoNome}".`)
  else p.push("Os dados são apresentados individualmente por evento e, ao final, de forma consolidada (visão geral).")
  if (model.sec) p.push(`As informações estão restritas à secretaria "${model.sec}".`)
  p.push(`Dados extraídos do sistema em ${model.extraido}.`)
  return p.join(" ")
}

// Título de uma seção/bloco em caixa-alta (sumário e cabeçalhos).
function blockHeading(b) {
  return b.tipo === "geral" ? b.titulo.toUpperCase() : "EVENTO: " + b.titulo.toUpperCase()
}

// Tabelas de dados de um bloco, conforme o filtro (sem secretarias quando há
// filtro de secretaria específica).
function blockTables(b, sec) {
  const st = b.stats
  const out = []
  if (!sec) {
    out.push({ titulo: "Secretarias por inscrições", header: ["#", "Secretaria", "Inscrições"], data: st.rankingInscricoes.map((r, j) => [j + 1, r.nome, r.qtd]) })
    out.push({ titulo: "Secretarias com mais presentes", header: ["#", "Secretaria", "Presentes"], data: st.secPresentes.map((r, j) => [j + 1, r.nome, r.qtd]) })
  }
  return out
}

function exportCsv() {
  const model = buildReportModel()
  if (model.vazio) {
    showAlert({ title: "Nada para exportar", message: "Nenhum participante para exportar com os filtros atuais.", type: "warn" })
    return
  }
  const { blocks, sec } = model
  const HR = "======================================================================"
  const hr = "----------------------------------------------------------------------"
  const rows = []
  const add = (...r) => r.forEach(x => rows.push(x))

  // ---- Capa ----
  add([HR], ["ESCOLA DE GOVERNO DE PEDRO LEOPOLDO"], ["PREFEITURA MUNICIPAL DE PEDRO LEOPOLDO"],
    ["RELATÓRIO DE EVENTOS E PARTICIPAÇÃO"], [HR],
    [`Recorte - Evento: ${model.eventoNome} | Secretaria: ${model.secretariaNome}`],
    [`Dados extraídos em: ${model.extraido}`], [""])

  // ---- Sumário ----
  const refNum = blocks.length + 2
  add([hr], ["SUMÁRIO"], [hr], ["1  INTRODUÇÃO"])
  blocks.forEach((b, i) => add([`${i + 2}  ${blockHeading(b)}`]))
  add([`${refNum}  REFERÊNCIAS`], [""])

  // ---- 1 Introdução ----
  add([hr], ["1  INTRODUÇÃO"], [hr], [reportIntro(model)], [""])

  // ---- Seções (uma por bloco) ----
  blocks.forEach((b, i) => {
    const num = i + 2
    const st = b.stats
    add([hr], [`${num}  ${blockHeading(b)}`], [hr])
    if (b.tipo === "evento") add([`Data: ${b.date ? formatDateBR(b.date) : "-"} | Vagas: ${b.vagas ?? "-"}`])
    add([`Inscritos: ${st.inscritos} | Presentes: ${st.presentes} | Ausentes: ${st.ausentes} | Taxa de presença: ${st.taxa != null ? st.taxa + "%" : "-"}`], [""])
    blockTables(b, sec).forEach((t, j) => {
      add([`${num}.${j + 1}  ${t.titulo}`])
      if (t.desc) add([t.desc])
      add(t.header, ...t.data, [relFonte()], [""])
    })
  })

  // ---- Referências ----
  add([hr], [`${refNum}  REFERÊNCIAS`], [hr], [relFonte()],
    [HR], [`Documento gerado pelo Painel EGov em ${new Date().toLocaleString("pt-BR")}`], [HR])

  const csv = rows
    .map(r => r.map(c => {
      const s = String(c ?? "").replace(/"/g, '""')
      return /[",;\n]/.test(s) ? `"${s}"` : s
    }).join(";"))
    .join("\n")
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })
  triggerDownload(blob, `relatorio-egov-${new Date().toISOString().slice(0, 10)}.csv`)
}

async function exportXlsx() {
  const model = buildReportModel()
  if (model.vazio) {
    showAlert({ title: "Nada para exportar", message: "Não há dados para exportar com os filtros atuais.", type: "warn" })
    return
  }
  if (!window.ExcelJS) {
    showAlert({ title: "Biblioteca ausente", message: "ExcelJS não foi carregada. Recarregue a página.", type: "warn" })
    return
  }
  const { blocks, sec } = model
  const brand = await loadBrandAssets().catch(() => null)
  const wb = new window.ExcelJS.Workbook()
  wb.creator = "Escola de Governo de Pedro Leopoldo"
  wb.company = "Prefeitura Municipal de Pedro Leopoldo"
  wb.title = "Relatório de Eventos e Participação"
  wb.created = new Date()

  const NAVY = "FF1B2A4E", GREEN = "FF4DAD33", BG_SOFT = "FFF5F8FB", WHITE = "FFFFFFFF", TEXT_MUTED = "FF5A6B85"
  const txt = (sh, addr, value, { size = 11, color = NAVY, bold = false, italic = false } = {}) => {
    const c = sh.getCell(addr); c.value = value
    c.font = { name: "Calibri", size, bold, italic, color: { argb: color } }
    c.alignment = { vertical: "middle", wrapText: true }
    return c
  }
  const sanitizeSheet = (name) => name.replace(/[\[\]\:\*\?\/\\]/g, " ").slice(0, 31).trim()
  // Escreve uma tabela a partir da coluna B; devolve a próxima linha livre.
  const writeTable = (sh, startRow, header, data, color = NAVY) => {
    header.forEach((h, i) => {
      const c = sh.getCell(startRow, 2 + i)
      c.value = h; c.font = { name: "Calibri", bold: true, size: 11, color: { argb: WHITE } }
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } }
      c.alignment = { vertical: "middle" }
    })
    data.forEach((arr, ri) => {
      arr.forEach((v, ci) => {
        const c = sh.getCell(startRow + 1 + ri, 2 + ci)
        c.value = v; c.font = { name: "Calibri", size: 11, color: { argb: NAVY } }
        if (ri % 2 === 1) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BG_SOFT } }
      })
    })
    return startRow + 1 + data.length + 1
  }

  let figN = 0

  // ============== Capa ==============
  const cap = wb.addWorksheet("Capa", { views: [{ showGridLines: false }] })
  cap.columns = Array.from({ length: 10 }, () => ({ width: 12 }))
  try {
    const logoId = wb.addImage({ base64: brand.comboLogo, extension: "png" })
    const fit = fitAspect(brand.dims.comboLogo.ratio, 320, 90)
    cap.addImage(logoId, { tl: { col: 1, row: 1 }, ext: { width: fit.w, height: fit.h } })
  } catch (_) {}
  cap.mergeCells("B7:J8"); txt(cap, "B7", "RELATÓRIO DE EVENTOS E PARTICIPAÇÃO", { size: 20, bold: true })
  cap.mergeCells("B9:J9"); txt(cap, "B9", "Escola de Governo de Pedro Leopoldo", { size: 13, color: TEXT_MUTED, italic: true })
  cap.mergeCells("B10:J10"); txt(cap, "B10", "Prefeitura Municipal de Pedro Leopoldo", { size: 13, color: TEXT_MUTED, italic: true })
  cap.mergeCells("B13:J13"); txt(cap, "B13", `Recorte - Evento: ${model.eventoNome}`, { size: 12 })
  cap.mergeCells("B14:J14"); txt(cap, "B14", `Recorte - Secretaria: ${model.secretariaNome}`, { size: 12 })
  cap.mergeCells("B16:J16"); txt(cap, "B16", `Dados extraídos em ${model.extraido}`, { size: 11, color: TEXT_MUTED, italic: true })
  cap.mergeCells("B24:J24"); txt(cap, "B24", "PEDRO LEOPOLDO", { size: 12, bold: true })

  // ============== Sumário ==============
  const sum = wb.addWorksheet("Sumário", { views: [{ showGridLines: false }] })
  sum.getColumn(2).width = 80
  txt(sum, "B2", "SUMÁRIO", { size: 18, bold: true })
  let sr = 4
  txt(sum, `B${sr++}`, "1  INTRODUÇÃO", { size: 12 })
  blocks.forEach((b, i) => txt(sum, `B${sr++}`, `${i + 2}  ${blockHeading(b)}`, { size: 12 }))
  txt(sum, `B${sr++}`, `${blocks.length + 2}  REFERÊNCIAS`, { size: 12 })

  // ============== Introdução ==============
  const intro = wb.addWorksheet("Introdução", { views: [{ showGridLines: false }] })
  intro.getColumn(2).width = 110
  txt(intro, "B2", "1  INTRODUÇÃO", { size: 18, bold: true })
  intro.mergeCells("B4:B10"); txt(intro, "B4", reportIntro(model), { size: 12 })
  txt(intro, "B12", relFonte(), { size: 9, color: TEXT_MUTED, italic: true })

  // ============== Uma aba por bloco (evento + geral) ==============
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi]
    const num = bi + 2
    const st = b.stats
    const sh = wb.addWorksheet(sanitizeSheet(`${num} ${b.tipo === "geral" ? "Visão Geral" : b.titulo}`), { views: [{ showGridLines: false }] })
    sh.getColumn(1).width = 3; sh.getColumn(2).width = 26; sh.getColumn(3).width = 46; sh.getColumn(4).width = 14
    txt(sh, "B2", `${num}  ${blockHeading(b)}`, { size: 16, bold: true })
    if (b.tipo === "evento") txt(sh, "B3", `Data: ${b.date ? formatDateBR(b.date) : "-"}  |  Vagas: ${b.vagas ?? "-"}`, { size: 11, color: TEXT_MUTED })
    txt(sh, "B4", `Inscritos: ${st.inscritos}  |  Presentes: ${st.presentes}  |  Ausentes: ${st.ausentes}  |  Taxa de presença: ${st.taxa != null ? st.taxa + "%" : "-"}`, { size: 11 })

    let row = 6
    const figs = await buildBlockFigures(b, sec)
    for (const fig of figs) {
      figN++
      txt(sh, `B${row++}`, `Figura ${figN} - ${fig.titulo}`, { size: 12, bold: true })
      if (fig.descricao) { txt(sh, `B${row++}`, fig.descricao, { size: 10, color: TEXT_MUTED, italic: true }) }
      const dispW = fig.w >= 1000 ? 640 : 440
      const dispH = Math.round(dispW * fig.h / fig.w)
      const id = wb.addImage({ base64: fig.img, extension: "png" })
      sh.addImage(id, { tl: { col: 1, row: row - 1 }, ext: { width: dispW, height: dispH } })
      row += Math.ceil(dispH / 18) + 1
      txt(sh, `B${row++}`, relFonte(), { size: 9, color: TEXT_MUTED, italic: true })
      row += 1
    }

    // Tabelas de dados (mesmas do gráfico)
    for (const t of blockTables(b, sec)) {
      txt(sh, `B${row++}`, t.titulo, { size: 12, bold: true })
      if (t.desc) txt(sh, `B${row++}`, t.desc, { size: 10, color: TEXT_MUTED, italic: true })
      row = writeTable(sh, row, t.header, t.data, b.tipo === "geral" ? NAVY : GREEN)
      txt(sh, `B${row++}`, relFonte(), { size: 9, color: TEXT_MUTED, italic: true })
      row += 1
    }
  }

  // ============== Referências ==============
  const ref = wb.addWorksheet("Referências", { views: [{ showGridLines: false }] })
  ref.getColumn(2).width = 110
  txt(ref, "B2", `${blocks.length + 2}  REFERÊNCIAS`, { size: 18, bold: true })
  txt(ref, "B4", relFonte(), { size: 11 })
  txt(ref, "B6", `Documento gerado pelo Painel EGov em ${new Date().toLocaleString("pt-BR")}.`, { size: 9, color: TEXT_MUTED, italic: true })

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  triggerDownload(blob, `relatorio-egov-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

async function exportPdf() {
  const model = buildReportModel()
  if (model.vazio) {
    showAlert({ title: "Nada para exportar", message: "Não há dados para exportar com os filtros atuais.", type: "warn" })
    return
  }
  const brand = await loadBrandAssets().catch(() => null)
  const { jsPDF } = window.jspdf
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const NAVY = [27, 42, 78], GREEN = [77, 173, 51], TEXT_MUTED = [90, 107, 133], BG_SOFT = [245, 248, 251], BODY = [40, 48, 66]
  const { blocks, sec } = model

  // ============== CAPA (folha de rosto ABNT) ==============
  try { if (brand) doc.addImage(brand.hero, "PNG", 0, 0, pageW, 90) } catch (_) {}
  doc.setFillColor(255, 255, 255); doc.rect(0, 90, pageW, pageH - 90, "F")
  try { if (brand) { const fit = fitAspect(brand.dims.comboLogo.ratio, 110, 38); doc.addImage(brand.comboLogo, "PNG", (pageW - fit.w) / 2, 30, fit.w, fit.h) } } catch (_) {}
  doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(...NAVY)
  doc.text("PREFEITURA MUNICIPAL DE PEDRO LEOPOLDO", pageW / 2, 112, { align: "center" })
  doc.setDrawColor(...GREEN); doc.setLineWidth(1); doc.line(pageW / 2 - 30, 118, pageW / 2 + 30, 118)
  doc.setFont("helvetica", "normal"); doc.setFontSize(13); doc.setTextColor(...TEXT_MUTED)
  doc.text("Escola de Governo de Pedro Leopoldo", pageW / 2, 130, { align: "center" })
  doc.setFont("helvetica", "bold"); doc.setFontSize(24); doc.setTextColor(...NAVY)
  doc.text("Relatório de Eventos e Participação", pageW / 2, 162, { align: "center" })
  doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(...BODY)
  doc.text(`Evento: ${model.eventoNome}`, pageW / 2, 180, { align: "center" })
  doc.text(`Secretaria: ${model.secretariaNome}`, pageW / 2, 187, { align: "center" })
  doc.setFont("helvetica", "italic"); doc.setFontSize(11); doc.setTextColor(...TEXT_MUTED)
  doc.text(`Dados extraídos em ${model.extraido}`, pageW / 2, 200, { align: "center" })
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...NAVY)
  doc.text("PEDRO LEOPOLDO", pageW / 2, pageH - 22, { align: "center" })

  const drawHeaderFooter = () => {
    doc.setFillColor(...NAVY); doc.rect(0, 0, pageW, 14, "F")
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(10)
    doc.text("Escola de Governo de Pedro Leopoldo", pageW / 2, 9, { align: "center" })
    doc.setDrawColor(...GREEN); doc.setLineWidth(0.5); doc.line(0, 14, pageW, 14)
    doc.setFillColor(...BG_SOFT); doc.rect(0, pageH - 10, pageW, 10, "F")
    doc.setTextColor(...TEXT_MUTED); doc.setFontSize(9); doc.setFont("helvetica", "normal")
    doc.text("Prefeitura Municipal de Pedro Leopoldo", pageW / 2, pageH - 4, { align: "center" })
  }

  // Inicia uma seção numa página nova; devolve o nº absoluto da página.
  const startSection = (titulo) => {
    doc.addPage(); drawHeaderFooter()
    doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...NAVY)
    doc.text(titulo, 14, 28)
    doc.setDrawColor(...GREEN); doc.setLineWidth(0.6); doc.line(14, 31, 58, 31)
    return doc.internal.getNumberOfPages()
  }

  // Figura ABNT: "Figura N -título" + descrição + imagem + Fonte (com data).
  const drawFigure = (n, fig) => {
    doc.addPage(); drawHeaderFooter()
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...NAVY)
    const tl = doc.splitTextToSize(`Figura ${n} - ${fig.titulo}`, pageW - 28)
    doc.text(tl, 14, 26)
    let topY = 26 + tl.length * 5 + 2
    if (fig.descricao) {
      doc.setFont("helvetica", "italic"); doc.setFontSize(9); doc.setTextColor(...TEXT_MUTED)
      const dl = doc.splitTextToSize(fig.descricao, pageW - 28)
      doc.text(dl, 14, topY); topY += dl.length * 4.2 + 3
    }
    const maxW = pageW - 28, maxH = pageH - topY - 26, ratio = fig.w / fig.h
    let w = maxW, h = w / ratio
    if (h > maxH) { h = maxH; w = h * ratio }
    const x = (pageW - w) / 2
    doc.addImage(fig.img, "PNG", x, topY, w, h)
    doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(...TEXT_MUTED)
    doc.text(doc.splitTextToSize(relFonte(), pageW - 28), 14, Math.min(topY + h + 6, pageH - 13))
    return doc.internal.getNumberOfPages()
  }

  // Página de sumário/lista com preenchimento pontilhado e nº de página.
  const drawTocPage = (titulo, entries) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(...NAVY)
    doc.text(titulo, pageW / 2, 30, { align: "center" })
    doc.setDrawColor(...GREEN); doc.setLineWidth(0.6); doc.line(pageW / 2 - 24, 34, pageW / 2 + 24, 34)
    doc.setFontSize(11)
    let y = 46
    entries.forEach(e => {
      if (y > pageH - 18) return
      const pageStr = String(e.page - 1)
      doc.setFont("helvetica", "normal"); doc.setTextColor(...NAVY)
      doc.text(e.label, 14, y)
      doc.text(pageStr, pageW - 14, y, { align: "right" })
      const lw = doc.getTextWidth(e.label), pw = doc.getTextWidth(pageStr)
      let dx = 14 + lw + 1.5; const endX = pageW - 14 - pw - 1.5
      doc.setTextColor(190, 198, 210)
      while (dx < endX) { doc.text(".", dx, y); dx += 1.7 }
      y += 7
    })
  }

  // Reserva páginas para Sumário e Lista de Figuras (preenchidas no fim).
  doc.addPage(); drawHeaderFooter(); const pgSumario = doc.internal.getNumberOfPages()
  doc.addPage(); drawHeaderFooter(); const pgLista = doc.internal.getNumberOfPages()

  const toc = [], figIndex = []
  let figN = 0

  // ============== 1 INTRODUÇÃO ==============
  {
    const pg = startSection("1  INTRODUÇÃO")
    toc.push({ label: "1  INTRODUÇÃO", page: pg })
    doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(...BODY)
    doc.text(doc.splitTextToSize(reportIntro(model), pageW - 28), 14, 44)
  }

  // ============== Seções por bloco ==============
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi], num = bi + 2, st = b.stats
    const heading = `${num}  ${blockHeading(b)}`
    const pg = startSection(heading)
    toc.push({ label: heading, page: pg })
    let y = 42
    if (b.tipo === "evento") {
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...TEXT_MUTED)
      doc.text(`Data: ${b.date ? formatDateBR(b.date) : "-"}     |     Vagas: ${b.vagas ?? "-"}`, 14, y); y += 7
    }
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...NAVY)
    doc.text(`Inscritos: ${st.inscritos}     Presentes: ${st.presentes}     Ausentes: ${st.ausentes}     Taxa de presença: ${st.taxa != null ? st.taxa + "%" : "-"}`, 14, y); y += 8

    for (const t of blockTables(b, sec)) {
      if (y > pageH - 40) { doc.addPage(); drawHeaderFooter(); y = 24 }
      doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...NAVY)
      doc.text(t.titulo, 14, y); y += 3
      doc.autoTable({
        startY: y,
        head: [t.header],
        body: t.data.map(r => r.map(String)),
        styles: { fontSize: 9, cellPadding: 2.5, font: "helvetica" },
        headStyles: { fillColor: b.tipo === "geral" ? NAVY : [77, 173, 51], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: BG_SOFT },
        margin: { left: 14, right: 14 },
        didDrawPage: drawHeaderFooter
      })
      y = doc.lastAutoTable.finalY + 5
      doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(...TEXT_MUTED)
      doc.text(relFonte(), 14, y); y += 7
    }

    const blockFigs = await buildBlockFigures(b, sec)
    for (const fig of blockFigs) {
      figN++
      const fpg = drawFigure(figN, fig)
      figIndex.push({ label: `Figura ${figN} - ${fig.titulo}`, page: fpg })
    }
  }

  // ============== REFERÊNCIAS ==============
  {
    const refTit = `${blocks.length + 2}  REFERÊNCIAS`
    const pg = startSection(refTit)
    toc.push({ label: refTit, page: pg })
    doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(...BODY)
    doc.text(doc.splitTextToSize(relFonte(), pageW - 28), 14, 44)
    doc.setFont("helvetica", "italic"); doc.setFontSize(9); doc.setTextColor(...TEXT_MUTED)
    doc.text(`Documento gerado pelo Painel EGov em ${new Date().toLocaleString("pt-BR")}.`, 14, 56)
  }

  // ============== Preenche Sumário e Lista de Figuras ==============
  doc.setPage(pgSumario); drawTocPage("SUMÁRIO", toc)
  doc.setPage(pgLista)
  drawTocPage("LISTA DE FIGURAS", figIndex.length ? figIndex : [{ label: "(sem figuras no recorte)", page: pgLista }])

  // ============== Paginação (exceto capa) ==============
  const total = doc.internal.getNumberOfPages()
  for (let i = 2; i <= total; i++) {
    doc.setPage(i)
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...TEXT_MUTED)
    doc.text(`Página ${i - 1} de ${total - 1}`, pageW - 14, pageH - 4, { align: "right" })
  }

  doc.save(`relatorio-egov-${new Date().toISOString().slice(0, 10)}.pdf`)
}

async function exportPptx() {
  const model = buildReportModel()
  if (model.vazio) {
    showAlert({ title: "Nada para exportar", message: "Não há dados para exportar com os filtros atuais.", type: "warn" })
    return
  }
  if (!window.PptxGenJS) {
    showAlert({ title: "Biblioteca ausente", message: "PptxGenJS não foi carregada. Recarregue a página.", type: "warn" })
    return
  }
  const { blocks, sec } = model
  const brand = await loadBrandAssets().catch(() => null)

  const pptx = new window.PptxGenJS()
  pptx.layout = "LAYOUT_WIDE"
  pptx.author = "Escola de Governo de Pedro Leopoldo"
  pptx.company = "Prefeitura Municipal de Pedro Leopoldo"
  pptx.title = "Relatório de Eventos e Participação"
  buildEgovPptxMaster(pptx, brand, "Relatório de Eventos e Participação")

  const fonteSlide = (s) => s.addText(relFonte(), { x: 0.7, y: 6.75, w: 12, h: 0.35, fontFace: EGOV_BRAND.font, fontSize: 9, italic: true, color: EGOV_BRAND.textMuted })

  // ============== Capa ==============
  const sCover = pptx.addSlide()
  sCover.background = { color: EGOV_BRAND.white }
  if (brand) {
    sCover.addImage({ data: brand.hero, x: 0, y: 0, w: 13.333, h: 7.5, sizing: { type: "cover", w: 13.333, h: 7.5 } })
    sCover.addShape("rect", { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: EGOV_BRAND.white, transparency: 35 } })
    const fit = fitAspect(brand.dims.comboLogo.ratio, 5.4, 1.4)
    sCover.addImage({ data: brand.comboLogo, x: (13.333 - fit.w) / 2, y: 0.8, w: fit.w, h: fit.h })
  }
  sCover.addText("PREFEITURA MUNICIPAL DE PEDRO LEOPOLDO", { x: 1, y: 2.3, w: 11.3, h: 0.5, fontFace: EGOV_BRAND.font, fontSize: 14, bold: true, color: EGOV_BRAND.navy, align: "center", charSpacing: 4 })
  sCover.addShape("line", { x: 5.4, y: 2.9, w: 2.5, h: 0, line: { color: EGOV_BRAND.green, width: 2 } })
  sCover.addText("Relatório de Eventos e Participação", { x: 1, y: 3.1, w: 11.3, h: 1.0, fontFace: EGOV_BRAND.font, fontSize: 40, bold: true, color: EGOV_BRAND.navy, align: "center" })
  sCover.addText(`Evento: ${model.eventoNome}`, { x: 1, y: 4.35, w: 11.3, h: 0.5, fontFace: EGOV_BRAND.font, fontSize: 18, color: EGOV_BRAND.text, align: "center" })
  sCover.addText(`Secretaria: ${model.secretariaNome}`, { x: 1, y: 4.9, w: 11.3, h: 0.5, fontFace: EGOV_BRAND.font, fontSize: 18, color: EGOV_BRAND.text, align: "center" })
  sCover.addText(`Dados extraídos em ${model.extraido}`, { x: 1, y: 5.7, w: 11.3, h: 0.5, fontFace: EGOV_BRAND.font, fontSize: 14, italic: true, color: EGOV_BRAND.textMuted, align: "center" })

  // ============== Sumário ==============
  const sSum = pptx.addSlide({ masterName: "EGOV_MASTER" })
  egovSlideTitle(sSum, "Sumário")
  const sumLines = ["1  INTRODUÇÃO", ...blocks.map((b, i) => `${i + 2}  ${blockHeading(b)}`), `${blocks.length + 2}  REFERÊNCIAS`]
  sSum.addText(sumLines.map(t => ({ text: t, options: { breakLine: true, fontSize: 15, color: EGOV_BRAND.navy, paraSpaceAfter: 8 } })), { x: 1, y: 1.7, w: 11.3, h: 5.2, fontFace: EGOV_BRAND.font, valign: "top" })

  // ============== Introdução ==============
  const sIntro = pptx.addSlide({ masterName: "EGOV_MASTER" })
  egovSlideTitle(sIntro, "1  Introdução")
  sIntro.addText(reportIntro(model), { x: 0.95, y: 1.9, w: 11.4, h: 4.2, fontFace: EGOV_BRAND.font, fontSize: 16, color: EGOV_BRAND.text, align: "justify", valign: "top" })
  fonteSlide(sIntro)

  // ============== Seções por bloco ==============
  let figN = 0
  const figSlide = (titulo, fig) => {
    figN++
    const s = pptx.addSlide({ masterName: "EGOV_MASTER" })
    s.addShape("rect", { x: 0.7, y: 0.95, w: 0.16, h: 0.55, fill: { color: EGOV_BRAND.green } })
    s.addText(`Figura ${figN} - ${titulo}`, { x: 0.95, y: 0.9, w: 11.8, h: 0.65, fontFace: EGOV_BRAND.font, fontSize: 20, bold: true, color: EGOV_BRAND.navy })
    if (fig.descricao) s.addText(fig.descricao, { x: 0.95, y: 1.55, w: 11.5, h: 0.5, fontFace: EGOV_BRAND.font, fontSize: 12, italic: true, color: EGOV_BRAND.textMuted })
    const ratio = fig.w / fig.h
    let w = 10.8, h = w / ratio
    if (h > 4.4) { h = 4.4; w = h * ratio }
    s.addImage({ data: fig.img, x: (13.333 - w) / 2, y: 2.05, w, h })
    fonteSlide(s)
  }

  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi], num = bi + 2, st = b.stats
    const sDiv = pptx.addSlide({ masterName: "EGOV_MASTER" })
    egovSlideTitle(sDiv, `${num}  ${b.titulo}`)
    const kpi = (x, label, value, accent) => {
      sDiv.addShape("roundRect", { x, y: 2.5, w: 2.8, h: 2.0, fill: { color: EGOV_BRAND.white }, line: { color: EGOV_BRAND.blueSoft, width: 1 }, rectRadius: 0.12 })
      sDiv.addShape("rect", { x, y: 2.5, w: 2.8, h: 0.1, fill: { color: accent } })
      sDiv.addText(String(value), { x, y: 2.7, w: 2.8, h: 1.1, fontFace: EGOV_BRAND.font, fontSize: 38, bold: true, color: accent, align: "center" })
      sDiv.addText(label, { x, y: 3.8, w: 2.8, h: 0.5, fontFace: EGOV_BRAND.font, fontSize: 14, color: EGOV_BRAND.textMuted, align: "center" })
    }
    kpi(0.9, "Inscritos", st.inscritos, EGOV_BRAND.navy)
    kpi(3.9, "Presentes", st.presentes, EGOV_BRAND.green)
    kpi(6.9, "Ausentes", st.ausentes, EGOV_BRAND.navyLight)
    kpi(9.9, "Taxa de presença", st.taxa != null ? st.taxa + "%" : "-", EGOV_BRAND.navyLight)
    if (b.tipo === "evento") sDiv.addText(`Data: ${b.date ? formatDateBR(b.date) : "-"}   ·   Vagas: ${b.vagas ?? "-"}`, { x: 0.95, y: 4.9, w: 11.5, h: 0.4, fontFace: EGOV_BRAND.font, fontSize: 14, italic: true, color: EGOV_BRAND.text, align: "center" })
    const figs = await buildBlockFigures(b, sec)
    for (const fig of figs) figSlide(fig.titulo, fig)
  }

  // ============== Referências ==============
  const sRef = pptx.addSlide({ masterName: "EGOV_MASTER" })
  egovSlideTitle(sRef, `${blocks.length + 2}  Referências`)
  sRef.addText(relFonte(), { x: 0.95, y: 2.0, w: 11.3, h: 0.8, fontFace: EGOV_BRAND.font, fontSize: 16, color: EGOV_BRAND.text })
  sRef.addText(`Documento gerado pelo Painel EGov em ${new Date().toLocaleString("pt-BR")}.`, { x: 0.95, y: 3.0, w: 11.3, h: 0.5, fontFace: EGOV_BRAND.font, fontSize: 12, italic: true, color: EGOV_BRAND.textMuted })

  await pptx.writeFile({ fileName: `relatorio-egov-${new Date().toISOString().slice(0, 10)}.pptx` })
}


// ================ CERTIFICADOS ================
function loadCertTemplate(templateId) {
  const tpl = CERT_TEMPLATES.find(t => t.id === templateId) || CERT_TEMPLATES[0]
  // Atualiza o id ANTES do load assíncrono: renderCertPosEditor() é chamado
  // logo após este return pelo click handler do seletor de modelo, e precisa
  // ler o id novo para fiar os handles na referência de posições correta.
  // Sem isso, o arrasta-e-solta editava o modelo anterior até a imagem
  // terminar de carregar.
  state.certTemplateId = tpl.id
  if (_certTemplateCache[tpl.id]) {
    state.templateImg = _certTemplateCache[tpl.id]
    renderCertPreview()
    if (state.certStep === 3) refreshCertPreviewWithName()
    return
  }
  const img = new Image()
  img.onload = () => {
    _certTemplateCache[tpl.id] = img
    state.templateImg = img
    renderCertPreview()
    if (state.certStep === 3) {
      refreshCertPreviewWithName()
      // Re-fia os handles agora que o canvas tem as dimensões do novo modelo.
      renderCertPosEditor()
    }
  }
  img.onerror = () => console.warn("Falha ao carregar modelo:", tpl.src)
  img.src = tpl.src
}

function preloadTemplate() {
  if (state.templateImg) return
  loadCertTemplate(state.certTemplateId || "modelo-1")
}

// Lista de campos editaveis (label exibida no handle = valor real do form).
const CERT_FIELDS = [
  { key: "nome", label: "Nome completo do participante" },
  { key: "curso", label: "Título do curso" },
  { key: "dia", label: "Dia" },
  { key: "mes", label: "Mês" },
  { key: "ano", label: "Ano" },
  { key: "carga", label: "Carga horária" }
]

// Editor visual de posicoes via arrasta-e-solta. Modelos 3 e 4 compartilham
// a mesma referencia, entao mover um campo num aplica no outro. Modelo 5 e independente.
function renderCertPosEditor() {
  const layer = document.getElementById("certDragLayer")
  const toggle = document.getElementById("certPosEditToggle")
  const hint = document.getElementById("certPosEditorHint")
  const resetBtn = document.getElementById("certPosReset")
  if (!layer || !toggle) return

  const tplId = state.certTemplateId || "modelo-1"
  const compartilhado34 = tplId === "modelo-3" || tplId === "modelo-4"
  if (hint) hint.textContent = compartilhado34 ? "Modelos 3 e 4 usam as mesmas posições" : `Posições do ${tplId.replace("modelo-", "Modelo ")}`

  const P = getCertPos(tplId)
  const fields = getCertFormData()

  // Lista de handles a renderizar: inclui dia2 só se o modelo tiver POS.dia2.
  const handleFields = CERT_FIELDS.slice()
  if (P.dia2) {
    // insere dia2 logo após dia
    const i = handleFields.findIndex(f => f.key === "dia")
    handleFields.splice(i + 1, 0, { key: "dia2", label: "Segundo dia" })
  }

  // (Re)monta os handles em cada chamada - a fonte do texto e a posicao podem mudar.
  layer.innerHTML = handleFields.map(({ key }) => {
    let value = String(fields[key] ?? "").trim() || "-"
    if (key === "dia2" && !fields.dia2) value = "(2º dia)"
    return `
      <div class="cert-drag-handle" data-field="${key}"
           style="left:${(P[key].x * 100).toFixed(3)}%; top:${(P[key].y * 100).toFixed(3)}%">
        <span class="cert-drag-handle__grip"><i class="fas fa-up-down-left-right"></i></span>
        <span class="cert-drag-handle__text">${escapeHtml(value)}</span>
      </div>
    `
  }).join("")

  // Wire-up drag por handle
  layer.querySelectorAll(".cert-drag-handle").forEach(el => {
    const fkey = el.dataset.field
    let dragging = false
    let dx = 0,
      dy = 0
    el.addEventListener("pointerdown", e => {
      e.preventDefault()
      dragging = true
      el.setPointerCapture(e.pointerId)
      el.classList.add("is-dragging")
      const rect = el.getBoundingClientRect()
      // Offset do clique relativo ao centro do handle (handles sao centrados via translate -50%, -50%).
      dx = e.clientX - (rect.left + rect.width / 2)
      dy = e.clientY - (rect.top + rect.height / 2)
    })
    el.addEventListener("pointermove", e => {
      if (!dragging) return
      const stage = document.getElementById("certCanvasStage")
      const sb = stage.getBoundingClientRect()
      const x = (e.clientX - dx - sb.left) / sb.width
      const y = (e.clientY - dy - sb.top) / sb.height
      const xc = Math.max(0, Math.min(1, x))
      const yc = Math.max(0, Math.min(1, y))
      P[fkey].x = xc
      P[fkey].y = yc
      el.style.left = (xc * 100).toFixed(3) + "%"
      el.style.top = (yc * 100).toFixed(3) + "%"
      refreshCertPreviewWithName()
    })
    const end = e => {
      if (!dragging) return
      dragging = false
      el.classList.remove("is-dragging")
      try {
        el.releasePointerCapture(e.pointerId)
      } catch (_) {}
      saveCertPosOverrides()
    }
    el.addEventListener("pointerup", end)
    el.addEventListener("pointercancel", end)
  })

  // Toggle mostra/oculta camada (default: ligado - persistido em state)
  toggle.checked = state._certDragEnabled !== false
  const sync = () => {
    state._certDragEnabled = toggle.checked
    layer.hidden = !toggle.checked
  }
  toggle.onchange = sync
  sync()

  // Painel de tipografia: 1 slider por campo (nome, curso, dia, mes, ano, carga)
  const typoGrid = document.getElementById("certTypoGrid")
  if (typoGrid) {
    const SCALE_FIELD_META = {
      nome:  { label: "Nome completo", icon: "fa-user" },
      curso: { label: "Título do curso", icon: "fa-graduation-cap" },
      dia:   { label: "Dia", icon: "fa-1" },
      mes:   { label: "Mês", icon: "fa-calendar" },
      ano:   { label: "Ano", icon: "fa-hashtag" },
      carga: { label: "Carga horária", icon: "fa-clock" }
    }
    typoGrid.innerHTML = CERT_SCALE_FIELDS.map(key => {
      const meta = SCALE_FIELD_META[key]
      const pct = Math.round(getFieldScale(tplId, key) * 100)
      return `
        <div class="cert-typo-control">
          <div class="cert-typo-control__head">
            <span class="cert-typo-control__label"><i class="fas ${meta.icon}"></i> ${meta.label}</span>
            <span class="cert-typo-control__value" data-typo-val="${key}">${pct}%</span>
          </div>
          <input type="range" class="cert-typo-control__range" data-typo="${key}" min="${Math.round(CERT_SCALE_MIN*100)}" max="${Math.round(CERT_SCALE_MAX*100)}" step="1" value="${pct}" />
        </div>
      `
    }).join("")
    // Aplica um valor em um campo (e em todos se "manter proporções" ativo)
    const applyScale = (changedKey, pct) => {
      const fraction = pct / 100
      if (state._certTypoLinked) {
        CERT_SCALE_FIELDS.forEach(k => setFieldScale(tplId, k, fraction))
        // Reflete em todos os sliders/valores
        typoGrid.querySelectorAll("input[data-typo]").forEach(other => {
          other.value = String(pct)
          const otherVal = typoGrid.querySelector(`[data-typo-val="${other.dataset.typo}"]`)
          if (otherVal) otherVal.textContent = pct + "%"
        })
      } else {
        setFieldScale(tplId, changedKey, fraction)
        const valEl = typoGrid.querySelector(`[data-typo-val="${changedKey}"]`)
        if (valEl) valEl.textContent = pct + "%"
      }
      refreshCertPreviewWithName()
    }

    typoGrid.querySelectorAll("input[data-typo]").forEach(el => {
      const key = el.dataset.typo
      el.addEventListener("input", () => applyScale(key, Number(el.value)))
      el.addEventListener("change", () => saveCertPosOverrides())
    })

    // Toggle "Manter proporções" (linked sliders)
    const linkEl = document.getElementById("certTypoLink")
    if (linkEl) {
      linkEl.checked = !!state._certTypoLinked
      linkEl.addEventListener("change", () => {
        state._certTypoLinked = linkEl.checked
        // Ao ativar, normaliza todos para a maior escala atual - assim entra
        // em "proporção" sem fazer ninguém encolher.
        if (linkEl.checked) {
          const maxPct = Math.max(...CERT_SCALE_FIELDS.map(k => Math.round(getFieldScale(tplId, k) * 100)))
          applyScale(CERT_SCALE_FIELDS[0], maxPct)
        }
        saveCertPosOverrides()
      })
    }

    // Toggle de colapso (persistido em state)
    const toggleBtn = document.getElementById("certTypoToggle")
    const panel = document.getElementById("certTypoPanel")
    if (toggleBtn && panel) {
      const setCollapsed = (c) => {
        panel.classList.toggle("is-collapsed", c)
        toggleBtn.querySelector("i").className = c ? "fas fa-chevron-down" : "fas fa-chevron-up"
      }
      setCollapsed(state._certTypoCollapsed === true)
      toggleBtn.onclick = () => {
        state._certTypoCollapsed = !panel.classList.contains("is-collapsed")
        setCollapsed(state._certTypoCollapsed)
      }
    }
  }

  // Reset (posições + escalas)
  if (resetBtn) {
    resetBtn.onclick = () => {
      Object.keys(CERT_POS_DEFAULT).forEach(k => {
        P[k].x = CERT_POS_DEFAULT[k].x
        P[k].y = CERT_POS_DEFAULT[k].y
      })
      resetFieldScales(tplId)
      saveCertPosOverrides()
      renderCertPosEditor()
      refreshCertPreviewWithName()
    }
  }
}

function renderViewCertificados() {
  if (!state.certStep) state.certStep = 1

  // Carrega o índice de planilhas do sistema (relatorios/manifest.json) uma vez.
  if (state.certManifest === null && !state._certManifestLoading) {
    state._certManifestLoading = true
    loadCertManifest()
      .catch(err => {
        console.warn("Falha ao carregar manifesto de planilhas:", err)
        // Evita novo fetch em loop: marca como carregado, porém vazio.
        state.certManifest = { planilhas: [], erro: true }
      })
      .finally(() => {
        state._certManifestLoading = false
        if (state.view === "certificados") renderViewCertificados()
      })
  }

  // Só lista eventos CONCLUÍDOS (com check-ins registrados). Eventos futuros /
  // com inscrição aberta — ou gerados sem presença ainda — não entram, pois
  // certificado só sai após a conclusão do evento.
  const planilhasTodas = (state.certManifest && state.certManifest.planilhas) || []
  const eventosRaw = (state.dataRaw && state.dataRaw.eventos) || []
  const planilhas = eventosRaw.length
    ? planilhasTodas.filter(p => {
        const ev = eventosRaw.find(e => e.id === p.id || e.fonte === p.arquivo)
        return ev && (ev.totalPresentes || 0) > 0
      })
    : planilhasTodas
  // Atalho vindo de um card de evento: resolve a planilha pelo nome do arquivo.
  if (state.certPendingArquivo && planilhas.length) {
    const hit = planilhas.find(p => p.arquivo === state.certPendingArquivo)
    if (hit) state.certEventId = hit.id
    state.certPendingArquivo = null
  }
  if (!state.certEventId && planilhas.length) state.certEventId = planilhas[0].id

  // Remove form oculto deixado por uma visita anterior a etapa 3 (evita IDs duplicados).
  const oldHidden = document.getElementById("certFormHidden")
  if (oldHidden) oldHidden.remove()

  const view = document.getElementById("view-certificados")
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
                  ${
                    planilhas.length
                      ? planilhas
                          .map(p => `<option value="${escapeHtml(p.id)}" ${state.certEventId === p.id ? "selected" : ""}>${escapeHtml(p.titulo)}</option>`)
                          .join("")
                      : `<option>${state._certManifestLoading ? "Carregando planilhas…" : "Nenhuma planilha encontrada"}</option>`
                  }
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
                <label for="certDia2">Segundo dia <span style="color:var(--text-muted);font-weight:400">(opcional)</span></label>
                <input type="number" id="certDia2" min="1" max="31" placeholder="26" title="Para cursos com 2 módulos no mesmo mês (ex.: 14 e 26)" />
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
                <strong id="certPreviewName">-</strong>
                <span class="cert-preview-name__counter" id="certPreviewCounter"></span>
              </div>
              <button class="btn btn--sm" id="certPreviewNext" title="Próximo participante">
                <i class="fas fa-chevron-right"></i>
              </button>
            </div>

            <div class="cert-template-picker">
              <div class="cert-template-picker__head">
                <span class="cert-template-picker__label"><i class="fas fa-image"></i> Modelo de certificado</span>
                <span class="cert-template-picker__hint">Clique para escolher</span>
              </div>
              <div class="cert-template-picker__grid" id="certTemplateGrid">
                ${CERT_TEMPLATES.map(
                  t => `
                  <button type="button" class="cert-template-thumb ${(state.certTemplateId || "modelo-1") === t.id ? "is-active" : ""}" data-template="${t.id}" title="${escapeHtml(t.hint ? t.label + " - " + t.hint : t.label)}">
                    <img src="${t.src}" alt="${escapeHtml(t.label)}" loading="lazy" />
                    <span class="cert-template-thumb__label">${escapeHtml(t.label)}</span>
                    ${t.hint ? `<span class="cert-template-thumb__badge"><i class="fas fa-calendar-days"></i> 2 datas</span>` : ""}
                  </button>
                `
                ).join("")}
              </div>
            </div>

            <div class="canvas-frame canvas-frame--lg cert-canvas-stage" id="certCanvasStage">
              <canvas id="certCanvas" width="1100" height="820"></canvas>
              <div class="cert-drag-layer" id="certDragLayer" hidden></div>
            </div>
          </div>

          <div class="cert-emit-side">
            <div class="card">
              <div class="card__header"><div><h3>Resumo da emissão</h3></div></div>
              <div class="cert-summary" id="certSummary"></div>
              <button class="btn btn--accent btn--lg" id="certEmit" disabled style="width:100%; margin-top: var(--space-3);">
                <i class="fas fa-award"></i> Emitir ZIP <span id="certEmitCount">(0)</span>
              </button>
              <div class="cert-progress" id="certProgress" hidden style="margin-top: var(--space-3);">
                <div class="cert-progress__head">
                  <span id="certProgressLabel">Gerando</span>
                  <strong id="certProgressPct">0%</strong>
                </div>
                <div class="cert-progress__bar"><div class="cert-progress__fill" id="certProgressFill"></div></div>
                <div class="cert-status" id="certStatus"></div>
              </div>

              <button class="btn btn--primary btn--lg" id="certSend" disabled style="width:100%; margin-top: var(--space-3);">
                <i class="fas fa-envelope"></i> Enviar por e-mail <span id="certSendCount">(0)</span>
              </button>
            </div>

            <!-- Caixa: editor de posições (arrastar e soltar) -->
            <div class="card cert-pos-card">
              <div class="cert-pos-card__row">
                <label class="cert-pos-card__toggle">
                  <input type="checkbox" id="certPosEditToggle" checked />
                  <span class="cert-pos-card__switch" aria-hidden="true"></span>
                  <span class="cert-pos-card__text">
                    <strong><i class="fas fa-arrows-up-down-left-right"></i> Arrastar e soltar</strong>
                    <small>Reposicione cada campo no certificado</small>
                  </span>
                </label>
                <button type="button" class="btn btn--sm cert-pos-card__reset" id="certPosReset" title="Restaurar posições e fontes padrão">
                  <i class="fas fa-rotate-left"></i>
                </button>
              </div>
              <span class="cert-pos-card__hint" id="certPosEditorHint"></span>
            </div>

            <!-- Caixa: tipografia do modelo -->
            <div class="card cert-typo-panel cert-typo-panel--side" id="certTypoPanel">
              <div class="cert-typo-panel__head">
                <div class="cert-typo-panel__title">
                  <strong><i class="fas fa-text-height"></i> Tipografia do modelo</strong>
                  <span class="cert-typo-panel__hint">Ajuste o tamanho de cada texto. Salvo por modelo.</span>
                </div>
                <button type="button" class="cert-typo-panel__toggle" id="certTypoToggle" title="Mostrar/ocultar">
                  <i class="fas fa-chevron-up"></i>
                </button>
              </div>
              <div class="cert-typo-panel__actions-row">
                <label class="cert-typo-link" title="Quando ativo, mover um slider ajusta todos juntos - evita discrepância tipográfica">
                  <input type="checkbox" id="certTypoLink" />
                  <i class="fas fa-link"></i>
                  <span>Manter proporções entre os campos</span>
                </label>
              </div>
              <div class="cert-typo-panel__grid" id="certTypoGrid"></div>
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
        ${
          state.certStep === 3
            ? ""
            : `
          <button class="btn btn--accent" id="certNext">
            Próximo <i class="fas fa-arrow-right"></i>
          </button>
        `
        }
      </div>
    </div>
  `

  // Step nav (cliques na trilha)
  view.querySelectorAll(".wizard__step").forEach(s => s.addEventListener("click", () => goToCertStep(parseInt(s.dataset.step, 10))))
  document.getElementById("certPrev").addEventListener("click", () => goToCertStep(state.certStep - 1))
  const nextBtn = document.getElementById("certNext")
  if (nextBtn) nextBtn.addEventListener("click", () => goToCertStep(state.certStep + 1))

  // Etapa 1 - source tabs + form
  if (state.certStep === 1) {
    view.querySelectorAll(".source-tab").forEach(t =>
      t.addEventListener("click", () => {
        state.certSource = t.dataset.source
        renderViewCertificados()
      })
    )
    const evSel = document.getElementById("certEvento")
    if (evSel) {
      evSel.addEventListener("change", () => {
        state.certEventId = evSel.value
        // Troca de evento invalida a seleção feita para o anterior.
        state._certSelectedKeys = new Set()
        state._certSelectedCount = 0
        // Autopreenche os campos do certificado a partir do evento.
        autoFillCertFromEvent(evSel.value)
      })
    }
    setupCertUpload()
    ;["certCurso", "certDia", "certDia2", "certMes", "certAno", "certCarga"].forEach(id => {
      const el = document.getElementById(id)
      if (!el) return
      // Restaura valor do state se existir
      if (state.certForm && state.certForm[id] != null) el.value = state.certForm[id]
      const save = () => {
        state.certForm = state.certForm || {}
        state.certForm[id] = el.value
      }
      // 'change' cobre <select>; 'input' cobre <input> em tempo real
      el.addEventListener("input", save)
      el.addEventListener("change", save)
    })
    // Autopreenchimento inicial: se há evento selecionado e os campos estão
    // vazios (ou nunca foram tocados), preenche a partir do evento.
    if (state.certEventId && state.certSource === "evento") {
      autoFillCertFromEvent(state.certEventId, { onlyEmpty: true })
    }
  }

  // Função utilitária para autopreencher os campos do certificado.
  // opts.onlyEmpty=true só sobrescreve quando o campo está vazio (não pisa em edições do usuário).
  function autoFillCertFromEvent(eventId, opts = {}) {
    if (!eventId) return
    const onlyEmpty = !!opts.onlyEmpty
    const planilhasManifest = (state.certManifest && state.certManifest.planilhas) || []
    const planilha = planilhasManifest.find(p => p.id === eventId)
    if (!planilha) return

    // Match com o eventos-data.json para puxar data/horário precisos
    const norm = s =>
      String(s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
    const tNorm = norm(planilha.titulo)
    const evMeta = (state.data?.eventos || []).find(ev => {
      const t = norm(ev.title)
      const f = norm(ev.fonte)
      return (t && (tNorm.includes(t) || t.includes(tNorm))) || (planilha.arquivo && f && f === norm(planilha.arquivo))
    })

    const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
    let dia = "",
      mes = "",
      ano = ""
    if (evMeta?.date) {
      const [y, m, d] = String(evMeta.date).split("-")
      if (d) dia = String(parseInt(d, 10))
      if (m) mes = MESES[parseInt(m, 10) - 1] || ""
      if (y) ano = y
    }
    // Carga horária: usa a informada no evento (eventos-meta.json); se faltar,
    // estima a partir do dateRaw (ex.: "Data: 24/04/2026 08h30 - 17h").
    let carga = evMeta?.cargaHoraria != null ? String(evMeta.cargaHoraria) : ""
    if (!carga && evMeta?.dateRaw) {
      const m = String(evMeta.dateRaw).match(/(\d{1,2})[h:](\d{0,2})\s*[-–às]+\s*(\d{1,2})[h:]?(\d{0,2})/i)
      if (m) {
        const ini = parseInt(m[1], 10) + parseInt(m[2] || "0", 10) / 60
        const fim = parseInt(m[3], 10) + parseInt(m[4] || "0", 10) / 60
        if (Number.isFinite(ini) && Number.isFinite(fim) && fim > ini) {
          carga = String(Math.round(fim - ini))
        }
      }
    }

    const setField = (id, value) => {
      const el = document.getElementById(id)
      if (!el || !value) return
      if (onlyEmpty && el.value && el.value.trim() !== "") return
      el.value = value
      state.certForm = state.certForm || {}
      state.certForm[id] = value
    }
    setField("certCurso", planilha.titulo)
    setField("certDia", dia)
    setField("certMes", mes)
    setField("certAno", ano)
    if (carga) setField("certCarga", carga)
  }

  // Etapa 2 - tabela e seleção
  if (state.certStep === 2) {
    document.getElementById("certBusca").addEventListener("input", () => {
      // Salva o estado das checkboxes visiveis ANTES de re-renderizar.
      // Sem isso, marcacoes feitas e nao confirmadas via change-event somem.
      updateCertEmitCount()
      state._certPage = 1
      populateCertTable()
    })
    document.getElementById("certSelAll").addEventListener("click", () => {
      // Seleciona TODOS os elegíveis do filtro atual (preserva seleções de outros filtros)
      const list = getCertParticipantes()
      const busca = (document.getElementById("certBusca")?.value || "").toLowerCase()
      const filtered = busca ? list.filter(p => (p.nome || "").toLowerCase().includes(busca) || (p.secretaria || "").toLowerCase().includes(busca)) : list
      if (!(state._certSelectedKeys instanceof Set)) state._certSelectedKeys = new Set()
      filtered.forEach(p => state._certSelectedKeys.add(certKey(p)))
      state._certSelectedCount = state._certSelectedKeys.size
      document.querySelectorAll(".cert-row-check").forEach(c => (c.checked = true))
      updateCertEmitCount()
    })
    document.getElementById("certSelNone").addEventListener("click", () => {
      // Limpa só o que esta visivel no filtro atual (preserva selecoes de outras buscas).
      const list = getCertParticipantes()
      const busca = (document.getElementById("certBusca")?.value || "").toLowerCase()
      const filtered = busca ? list.filter(p => (p.nome || "").toLowerCase().includes(busca) || (p.secretaria || "").toLowerCase().includes(busca)) : list
      if (!(state._certSelectedKeys instanceof Set)) state._certSelectedKeys = new Set()
      filtered.forEach(p => state._certSelectedKeys.delete(certKey(p)))
      state._certSelectedCount = state._certSelectedKeys.size
      document.querySelectorAll(".cert-row-check").forEach(c => (c.checked = false))
      updateCertEmitCount()
    })
    // Fonte "Do sistema": baixa e parseia a planilha antes de montar a tabela.
    if (state.certSource === "evento") {
      renderCertTableLoading()
      loadSystemPlanilha(state.certEventId)
        .then(() => populateCertTable())
        .catch(err => renderCertTableError(err))
    } else {
      populateCertTable()
    }
  }

  // Etapa 3 - preview + emissão
  if (state.certStep === 3) {
    const initStep3 = () => {
      // Garante que a lista de origem esteja disponivel mesmo se etapa 2 nao foi visitada
      if (!state._certCurrentList) state._certCurrentList = getCertParticipantes()
      // Restaura form fields num form oculto (necessário para getCertFormData)
      ensureCertFormHidden()
      // Indice do participante atualmente em preview
      state._certPreviewIdx = 0
      refreshCertPreviewWithName()
      renderCertSummary()
      document.getElementById("certEmit").addEventListener("click", emitCertificadosLote)
      document.getElementById("certSend").addEventListener("click", enviarCertificadosLote)
      document.getElementById("certPreviewPrev").addEventListener("click", () => stepCertPreview(-1))
      document.getElementById("certPreviewNext").addEventListener("click", () => stepCertPreview(1))
      // Seletor de modelo de certificado
      document.querySelectorAll(".cert-template-thumb").forEach(btn => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.template
          document.querySelectorAll(".cert-template-thumb").forEach(b => b.classList.toggle("is-active", b === btn))
          loadCertTemplate(id)
          renderCertPosEditor()
        })
      })
      renderCertPosEditor()
      initCertWebappConfig()
      updateCertEmitCount()
    }
    // Se pulou direto da etapa 1 para a 3, garante a planilha do sistema carregada.
    if (state.certSource === "evento" && !(state.certSystemCache || {})[state.certEventId]) {
      loadSystemPlanilha(state.certEventId).then(initStep3).catch(initStep3)
    } else {
      initStep3()
    }
  }
}

function getCertSelectedParticipants() {
  // Resolve sempre a partir da lista COMPLETA da fonte ativa, nao do filtro
  // atual. Garante que selecoes feitas em buscas anteriores persistam.
  const fullList = getCertParticipantes()
  const keys = state._certSelectedKeys instanceof Set ? state._certSelectedKeys : new Set()
  if (!keys.size) return []
  return fullList.filter(p => keys.has(certKey(p)))
}

function stepCertPreview(delta) {
  const selected = getCertSelectedParticipants()
  if (!selected.length) return
  const n = selected.length
  state._certPreviewIdx = ((state._certPreviewIdx || 0) + delta + n) % n
  refreshCertPreviewWithName()
}

function refreshCertPreviewWithName() {
  const selected = getCertSelectedParticipants()
  const nameEl = document.getElementById("certPreviewName")
  const counterEl = document.getElementById("certPreviewCounter")
  const prevBtn = document.getElementById("certPreviewPrev")
  const nextBtn = document.getElementById("certPreviewNext")
  const idx = state._certPreviewIdx || 0

  if (selected.length) {
    const p = selected[Math.min(idx, selected.length - 1)]
    if (nameEl) nameEl.textContent = p.nome
    if (counterEl) counterEl.textContent = `(${idx + 1} de ${selected.length})`
    if (prevBtn) prevBtn.disabled = selected.length < 2
    if (nextBtn) nextBtn.disabled = selected.length < 2
    drawCertWithName(p.nome)
  } else {
    if (nameEl) nameEl.textContent = "Nenhum participante selecionado"
    if (counterEl) counterEl.textContent = "- Volte à etapa 2 para selecionar"
    if (prevBtn) prevBtn.disabled = true
    if (nextBtn) nextBtn.disabled = true
    drawCertWithName(null)
  }
  syncCertDragHandlesText()
}

// Atualiza so o texto exibido em cada handle (sem reconstruir o overlay e quebrar drag).
function syncCertDragHandlesText() {
  const layer = document.getElementById("certDragLayer")
  if (!layer) return
  const selected = getCertSelectedParticipants()
  const idx = state._certPreviewIdx || 0
  const nome = selected.length ? selected[Math.min(idx, selected.length - 1)].nome : null
  const fields = getCertFormData(nome)
  layer.querySelectorAll(".cert-drag-handle").forEach(el => {
    const k = el.dataset.field
    const txt = el.querySelector(".cert-drag-handle__text")
    if (txt) txt.textContent = String(fields[k] ?? "").trim() || "-"
  })
}

function drawCertWithName(nome) {
  const canvas = document.getElementById("certCanvas")
  if (!canvas || !state.templateImg) return
  canvas.width = state.templateImg.naturalWidth
  canvas.height = state.templateImg.naturalHeight
  const fields = getCertFormData(nome)
  drawCertificateInto(canvas, fields)
}

function ensureCertFormHidden() {
  // Recria inputs ocultos com valores em state.certForm para que getCertFormData funcione
  let host = document.getElementById("certFormHidden")
  if (!host) {
    host = document.createElement("div")
    host.id = "certFormHidden"
    host.style.display = "none"
    document.body.appendChild(host)
  }
  const f = state.certForm || {}
  host.innerHTML = `
    <input id="certCurso" value="${escapeHtml(f.certCurso || "")}" />
    <input id="certDia"   value="${escapeHtml(f.certDia || "")}" />
    <input id="certDia2"  value="${escapeHtml(f.certDia2 || "")}" />
    <input id="certMes"   value="${escapeHtml(f.certMes || "")}" />
    <input id="certAno"   value="${escapeHtml(f.certAno || "")}" />
    <input id="certCarga" value="${escapeHtml(f.certCarga || "")}" />
  `
}

function renderCertSummary() {
  const f = state.certForm || {}
  const list = getCertParticipantes()
  const selectedCount = (state._certSelectedKeys instanceof Set ? state._certSelectedKeys.size : 0) || state._certSelectedCount || 0
  document.getElementById("certSummary").innerHTML = `
    <dl class="cert-summary-list">
      <div><dt>Origem</dt><dd>${state.certSource === "planilha" ? "Planilha enviada" : "Sistema (evento)"}</dd></div>
      <div><dt>Curso</dt><dd>${escapeHtml(f.certCurso || "-")}</dd></div>
      <div><dt>Data</dt><dd>${escapeHtml(formatCertData(f) || "-")}</dd></div>
      <div><dt>Carga horária</dt><dd>${escapeHtml(f.certCarga || "-")}h</dd></div>
      <div><dt>Elegíveis</dt><dd>${list.length} pessoa(s)</dd></div>
      <div><dt>Selecionados</dt><dd><strong>${selectedCount}</strong></dd></div>
    </dl>
  `
}

function goToCertStep(step) {
  if (step < 1 || step > 3) return
  // Salva os dados do formulario da etapa 1 antes de sair (garante que
  // valores recem-digitados sem evento change/blur sejam preservados).
  if (state.certStep === 1) {
    state.certForm = state.certForm || {}
    ;["certCurso", "certDia", "certDia2", "certMes", "certAno", "certCarga"].forEach(id => {
      const el = document.getElementById(id)
      if (el) state.certForm[id] = el.value
    })
  }
  // Salva selecionados ao sair da etapa 2.
  // updateCertEmitCount() já mantém state._certSelectedKeys sincronizado a cada
  // toggle de checkbox; aqui só forçamos uma última sincronização defensiva.
  if (state.certStep === 2) {
    updateCertEmitCount()
  }
  state.certStep = step
  renderViewCertificados()
}

function setupCertUpload() {
  const drop = document.getElementById("certDrop")
  const input = document.getElementById("certFile")
  if (!drop || !input) return

  input.addEventListener("change", e => {
    if (e.target.files[0]) handleCertFile(e.target.files[0])
  })
  ;["dragenter", "dragover"].forEach(ev =>
    drop.addEventListener(ev, e => {
      e.preventDefault()
      drop.classList.add("is-drag")
    })
  )
  ;["dragleave", "drop"].forEach(ev =>
    drop.addEventListener(ev, e => {
      e.preventDefault()
      drop.classList.remove("is-drag")
    })
  )
  drop.addEventListener("drop", e => {
    if (e.dataTransfer.files[0]) handleCertFile(e.dataTransfer.files[0])
  })
}

function handleCertFile(file) {
  const drop = document.getElementById("certDrop")
  const reader = new FileReader()
  reader.onload = e => {
    try {
      let participantes = []
      const ext = file.name.toLowerCase().split(".").pop()
      if (ext === "csv") {
        participantes = parseCsvParticipantes(e.target.result)
      } else {
        // XLSX/XLS via SheetJS
        const data = new Uint8Array(e.target.result)
        const wb = window.XLSX.read(data, { type: "array" })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        participantes = parseSheetParticipantes(sheet)
      }
      if (!participantes.length) {
        document.getElementById("certDropTitle").textContent = "Nenhum elegível na planilha"
        document.getElementById("certDropSub").textContent = "Esperado: linhas com check-in 'Sim' ou coluna nome"
        drop.classList.remove("has-file")
        state.certUploaded = null
        populateCertTable()
        return
      }
      state.certUploaded = { fileName: file.name, participantes }
      drop.classList.add("has-file")
      document.getElementById("certDropTitle").textContent = file.name
      document.getElementById("certDropSub").textContent = `${participantes.length} elegíveis carregados`
      populateCertTable()
    } catch (err) {
      console.error(err)
      document.getElementById("certDropTitle").textContent = "Erro ao ler planilha"
      document.getElementById("certDropSub").textContent = err.message
      drop.classList.remove("has-file")
    }
  }
  if (file.name.toLowerCase().endsWith(".csv")) reader.readAsText(file, "utf-8")
  else reader.readAsArrayBuffer(file)
}

function parseCsvParticipantes(text) {
  text = text.replace(/^﻿/, "")
  const sep = text.split("\n")[0].includes(";") ? ";" : ","
  const rows = []
  let row = [],
    cur = "",
    inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') inQuotes = false
      else cur += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === sep) {
        row.push(cur)
        cur = ""
      } else if (c === "\n") {
        row.push(cur)
        rows.push(row)
        row = []
        cur = ""
      } else if (c === "\r") {
        /* skip */
      } else cur += c
    }
  }
  if (cur.length || row.length) {
    row.push(cur)
    rows.push(row)
  }
  if (!rows.length) return []
  const headers = rows[0].map(h => h.trim().toLowerCase())
  return rows
    .slice(1)
    .filter(r => r.some(v => v && v.trim()))
    .map(r => {
      const obj = {}
      headers.forEach((h, i) => (obj[h] = (r[i] || "").trim()))
      return obj
    })
    .map(normalizeParticipante)
    .filter(p => !isLinhaRodape(p.nome))
    .filter(isElegivel)
}

/**
 * Linhas de rodapé dos exports do Sympla ("Exportado em ...*" e
 * "* Horário de Brasília") não são participantes - devem ser descartadas.
 */
function isLinhaRodape(nome) {
  const n = (nome || "").trim().toLowerCase()
  return n.startsWith("*") || n.startsWith("exportado em") || n.includes("horário de brasília") || n.includes("horario de brasilia")
}

/**
 * Algumas planilhas (ex.: exports do Sympla) declaram um <dimension> errado,
 * que cobre só a coluna A. Sem corrigir, o SheetJS lê apenas 1 coluna e a
 * lista de elegíveis fica vazia. Recalcula o !ref pelos endereços de célula
 * realmente presentes e expande quando o declarado for menor que o conteúdo.
 */
function fixSheetRange(sheet) {
  const XLSX = window.XLSX
  let maxC = 0,
    maxR = 0,
    achou = false
  for (const key of Object.keys(sheet)) {
    if (key[0] === "!") continue
    const cell = XLSX.utils.decode_cell(key)
    if (Number.isNaN(cell.r) || Number.isNaN(cell.c)) continue
    if (cell.c > maxC) maxC = cell.c
    if (cell.r > maxR) maxR = cell.r
    achou = true
  }
  if (!achou) return
  const real = XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: maxC, r: maxR } })
  const declared = sheet["!ref"]
  if (!declared) {
    sheet["!ref"] = real
    return
  }
  const d = XLSX.utils.decode_range(declared)
  if (d.e.c < maxC || d.e.r < maxR) sheet["!ref"] = real
}

function parseSheetParticipantes(sheet) {
  fixSheetRange(sheet)
  const json = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" })
  // Procura linha de cabecalho (contem 'Ordem de inscricao' OU 'Nome')
  let headerIdx = -1
  for (let i = 0; i < Math.min(15, json.length); i++) {
    const lower = json[i].map(c => String(c).toLowerCase())
    if (lower.some(c => c.includes("ordem de"))) {
      headerIdx = i
      break
    }
    if (lower.includes("nome") && headerIdx < 0) headerIdx = i
  }
  if (headerIdx < 0) return []
  const headers = json[headerIdx].map(h => String(h).trim().toLowerCase())
  return json
    .slice(headerIdx + 1)
    .filter(r => r.some(v => v && String(v).trim()))
    .map(r => {
      const obj = {}
      headers.forEach((h, i) => (obj[h] = String(r[i] || "").trim()))
      return obj
    })
    .map(normalizeParticipante)
    .filter(p => !isLinhaRodape(p.nome))
    .filter(isElegivel)
}

/**
 * Padroniza o nome da secretaria para o formato institucional
 * "Secretaria Municipal de ..." (igual à planilha Fundamentos da Gestão
 * Pública), unificando siglas, caixa-alta e variações de digitação.
 */
function normalizeSecretaria(raw) {
  if (!raw) return ""
  // Remove sigla entre parênteses no fim: "... (SME)".
  const s = String(raw)
    .trim()
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
  if (!s) return ""
  const key = s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  const MAPA = [
    [["educacao"], "Secretaria Municipal de Educação"],
    [["saude"], "Secretaria Municipal de Saúde"],
    // Gestão e Finanças engloba: Gestão e Administração, Adjunta de
    // Transformação Digital e SAGA (Secretaria Adjunta de Gestão Administrativa).
    [["gestao e financas", "gestao e administracao", "transformacao digital", "saga"], "Secretaria Municipal de Gestão e Finanças"],
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
    [["governo"], "Secretaria Municipal de Governo"]
  ]
  for (const [chaves, canon] of MAPA) {
    if (chaves.some(c => key.includes(c))) return canon
  }
  // Sem correspondência conhecida: apenas ajusta a capitalização.
  return s.replace(/\S+/g, w => (w.length > 2 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
}

function normalizeParticipante(row) {
  // tenta varios nomes de coluna
  const k = Object.keys(row)
  const find = (...patterns) => {
    for (const p of patterns) {
      const hit = k.find(kk => kk.includes(p))
      if (hit && row[hit]) return row[hit]
    }
    return ""
  }
  const nome = [find("nome"), find("sobrenome")].filter(Boolean).join(" ").trim() || find("nome completo", "participante")
  const checkin = find("check-in", "check in", "checkin", "presente").toLowerCase()
  // A coluna de check-in existe? (verifica o cabeçalho, não o valor da célula -
  // assim uma célula vazia não é confundida com ausência da coluna).
  const padroesCheckin = ["check-in", "check in", "checkin", "presente"]
  const temColunaCheckin = k.some(kk => padroesCheckin.some(p => kk.includes(p)))
  // Presente quando o check-in é afirmativo. Sem coluna de check-in, assume
  // elegível; com a coluna presente mas célula vazia, conta como ausente.
  const presente = ["sim", "yes", "true", "1"].includes(checkin) || !temColunaCheckin
  return {
    nome: nome || "(sem nome)",
    email: find("email", "e-mail"),
    secretaria: normalizeSecretaria(find("secret", "lota")),
    turma: find("tipo de ingresso", "turma"),
    presente
  }
}

function isElegivel(p) {
  return p.presente && p.nome && p.nome !== "(sem nome)"
}

// Chave estavel de um participante para persistir selecao entre filtros/etapas.
// Prefere email (case-insensitive); fallback no nome normalizado.
function certKey(p) {
  if (!p) return ""
  const e = (p.email || "").trim().toLowerCase()
  if (e) return "e:" + e
  return (
    "n:" +
    String(p.nome || "")
      .trim()
      .toLowerCase()
  )
}

function getCertParticipantes() {
  if (state.certSource === "planilha") {
    return state.certUploaded ? state.certUploaded.participantes : []
  }
  // Fonte "Do sistema": planilha de relatorios/ já parseada e em cache.
  return (state.certSystemCache || {})[state.certEventId] || []
}

/** Baixa relatorios/manifest.json - o índice das planilhas do sistema. */
async function loadCertManifest() {
  const res = await fetch("assets/docs/relatorios/manifest.json", { cache: "no-cache" })
  if (!res.ok) throw new Error(`manifest.json: ${res.status}`)
  state.certManifest = await res.json()
  return state.certManifest
}

/**
 * Carrega elegíveis de um evento a partir do eventos-data.json (já pré-buildado
 * por scripts/build-data.mjs). O id do manifesto agora coincide com o id do
 * evento no JSON, então é uma simples lookup + filtro de presentes.
 */
async function loadSystemPlanilha(id) {
  state.certSystemCache = state.certSystemCache || {}
  if (!id) return []
  if (state.certSystemCache[id]) return state.certSystemCache[id]

  if (!state.dataRaw) state.dataRaw = await loadData()

  const evento = (state.dataRaw.eventos || []).find(e => e.id === id)
  if (!evento) throw new Error(`Evento "${id}" não encontrado no eventos-data.json. Rode "npm run build".`)

  const participantes = (evento.participantes || [])
    .filter(p => p.presente && p.nome && p.nome !== "(sem nome)")
    .map(p => ({
      nome: p.nome,
      email: p.email || "",
      secretaria: p.secretaria || "",
      turma: p.turma || "",
      presente: true
    }))
  state.certSystemCache[id] = participantes
  return participantes
}

function renderCertTableLoading() {
  const t = document.getElementById("certTable")
  if (t)
    t.innerHTML = `
    <div class="empty-state">
      <i class="fas fa-spinner fa-spin"></i>
      <h3>Carregando elegíveis…</h3>
      <p>Lendo a planilha do sistema.</p>
    </div>`
  const c = document.getElementById("certCount")
  if (c) c.textContent = "…"
  const emit = document.getElementById("certEmit")
  if (emit) emit.disabled = true
}

function renderCertTableError(err) {
  console.error(err)
  const t = document.getElementById("certTable")
  if (t)
    t.innerHTML = `
    <div class="empty-state">
      <i class="fas fa-triangle-exclamation"></i>
      <h3>Não foi possível ler a planilha</h3>
      <p>${escapeHtml(err && err.message ? err.message : String(err))}</p>
    </div>`
  const c = document.getElementById("certCount")
  if (c) c.textContent = "0"
  const emit = document.getElementById("certEmit")
  if (emit) emit.disabled = true
}

function populateCertTable() {
  const list = getCertParticipantes()
  const busca = (document.getElementById("certBusca")?.value || "").toLowerCase()
  const filtered = busca ? list.filter(p => (p.nome || "").toLowerCase().includes(busca) || (p.secretaria || "").toLowerCase().includes(busca)) : list

  document.getElementById("certCount").textContent = `${filtered.length} de ${list.length} elegíveis`

  if (!filtered.length) {
    document.getElementById("certTable").innerHTML = `
      <div class="empty-state">
        <i class="fas fa-users-slash"></i>
        <h3>Sem elegíveis</h3>
        <p>${state.certSource === "planilha" ? "Faça upload de uma planilha." : "Este evento não possui check-ins, ou tente outro filtro."}</p>
      </div>`
    document.getElementById("certEmit").disabled = true
    return
  }

  // Paginação: 5 por página. Mantém estado entre renders.
  const PAGE_SIZE = 5
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  if (state._certPage == null) state._certPage = 1
  if (state._certPage > totalPages) state._certPage = totalPages
  const page = state._certPage
  const start = (page - 1) * PAGE_SIZE
  const pageItems = filtered.slice(start, start + PAGE_SIZE)

  if (!(state._certSelectedKeys instanceof Set)) state._certSelectedKeys = new Set()
  const savedKeys = state._certSelectedKeys
  // Cada checkbox e identificada pela chave estavel do participante (email||nome).
  // Assim, selecoes feitas em outras buscas/paginas continuam refletidas aqui.
  const rows = pageItems
    .map(p => {
      const k = certKey(p)
      return `
    <tr>
      <td><input type="checkbox" class="cert-row-check" data-key="${escapeHtml(k)}" ${savedKeys.has(k) ? "checked" : ""} /></td>
      <td class="cell-name">${escapeHtml(p.nome)}</td>
      <td class="col-hide-sm">${escapeHtml(p.email || "")}</td>
      <td class="col-hide-md cell-turma" title="${escapeHtml(p.turma || "")}">${escapeHtml(p.turma || "")}</td>
      <td>${escapeHtml(p.secretaria || "")}</td>
      <td><span class="cell-status green"><i class="fas fa-check"></i> Elegível</span></td>
      <td><span class="cell-status muted">A emitir</span></td>
    </tr>
  `
    })
    .join("")

  const from = start + 1
  const to = start + pageItems.length
  const pagerHtml =
    totalPages > 1
      ? `
    <div class="pager" data-pager-scope="cert">
      <span class="pager__info"><b>${from}–${to}</b> de <b>${filtered.length}</b></span>
      <div class="pager__controls">
        <button type="button" class="pager__btn ${page === 1 ? "is-disabled" : ""}" data-cert-page="${page - 1}" ${page === 1 ? "disabled" : ""}><i class="fas fa-chevron-left"></i></button>
        <span class="pager__current"><b>${page}</b> / ${totalPages}</span>
        <button type="button" class="pager__btn ${page === totalPages ? "is-disabled" : ""}" data-cert-page="${page + 1}" ${page === totalPages ? "disabled" : ""}><i class="fas fa-chevron-right"></i></button>
      </div>
    </div>
  `
      : ""

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
    ${pagerHtml}
  `

  // Wire pager
  document.querySelectorAll("[data-cert-page]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.preventDefault()
      const p = parseInt(btn.dataset.certPage, 10)
      if (Number.isFinite(p) && p >= 1 && p <= totalPages) {
        updateCertEmitCount()
        state._certPage = p
        populateCertTable()
      }
    })
  })

  document.getElementById("certHeadCheck").addEventListener("change", e => {
    document.querySelectorAll(".cert-row-check").forEach(c => (c.checked = e.target.checked))
    updateCertEmitCount()
  })
  document.querySelectorAll(".cert-row-check").forEach(c => c.addEventListener("change", updateCertEmitCount))
  // expose for emission
  state._certCurrentList = filtered
  updateCertEmitCount()
}

function updateCertEmitCount() {
  // Sincroniza state._certSelectedKeys com as checkboxes visiveis (pagina atual),
  // preservando selecoes feitas em outras paginas/buscas (merge por chave estavel).
  if (!(state._certSelectedKeys instanceof Set)) state._certSelectedKeys = new Set()
  let n
  const checks = document.querySelectorAll(".cert-row-check")
  if (checks.length) {
    checks.forEach(c => {
      const k = c.dataset.key
      if (!k) return
      if (c.checked) state._certSelectedKeys.add(k)
      else state._certSelectedKeys.delete(k)
    })
    n = state._certSelectedKeys.size
    state._certSelectedCount = n
  } else {
    n = state._certSelectedCount || state._certSelectedKeys.size || 0
  }
  const countEl = document.getElementById("certEmitCount")
  const btn = document.getElementById("certEmit")
  if (countEl) countEl.textContent = `(${n})`
  if (btn) btn.disabled = n === 0
  const sendCountEl = document.getElementById("certSendCount")
  if (sendCountEl) sendCountEl.textContent = `(${n})`
  refreshCertSendBtn()
  if (state.certStep === 3) renderCertSummary()
}

// ---------------- Canvas / PDF rendering ----------------

function getCertFormData(nomeOverride = null) {
  // Le primeiro de state.certForm (fonte da verdade, populado na etapa 1);
  // cai para o DOM quando a etapa 1 esta visivel e o usuario acabou de digitar.
  const f = state.certForm || {}
  const fromState = key => (f[key] != null ? String(f[key]) : "")
  const fromDom = id => {
    const el = document.getElementById(id)
    return el ? el.value : ""
  }
  const pick = id => (fromDom(id) || fromState(id)).trim()
  return {
    nome: nomeOverride || "NOME COMPLETO DO PARTICIPANTE",
    curso: pick("certCurso") || "TÍTULO DO CURSO",
    dia: pick("certDia") || "XX",
    dia2: pick("certDia2"),
    mes: pick("certMes") || "XXXX",
    ano: pick("certAno") || "XXXX",
    carga: pick("certCarga") || "XX"
  }
}

function drawCertificateInto(canvas, fields) {
  if (!state.templateImg) return
  const w = canvas.width,
    h = canvas.height
  const c = canvas.getContext("2d")
  c.clearRect(0, 0, w, h)
  c.drawImage(state.templateImg, 0, 0, w, h)
  const fontFamily = "'Calibri', 'Carlito', 'Segoe UI', Arial, sans-serif"
  const baseSize = w * 0.026
  c.font = `700 ${baseSize}px ${fontFamily}`
  c.fillStyle = "#000000"
  c.textBaseline = "middle"
  c.textAlign = "center"
  const tplId = state.certTemplateId || "modelo-1"
  const P = getCertPos(tplId)

  // Cada campo tem sua própria escala de fonte (configurável por modelo).
  // Comportamento do dia2:
  //  - Se o modelo tem POS.dia2 (ex.: modelo-6), dia e dia2 são desenhados
  //    em posições separadas (template já tem "e" entre eles).
  //  - Caso contrário, renderiza "X e Y" no MESMO ponto de POS.dia.
  const drawField = (key, text) => {
    const pos = P[key]
    if (!pos) return
    const size = baseSize * getFieldScale(tplId, key)
    c.font = `700 ${size}px ${fontFamily}`
    c.fillText(text, w * pos.x, h * pos.y)
  }
  drawField("nome", fields.nome)
  drawField("curso", fields.curso)
  if (P.dia2 && fields.dia2) {
    drawField("dia", String(fields.dia))
    drawField("dia2", String(fields.dia2))
  } else {
    drawField("dia", fields.dia2 ? `${fields.dia} e ${fields.dia2}` : String(fields.dia))
  }
  drawField("mes", fields.mes)
  drawField("ano", String(fields.ano))
  drawField("carga", String(fields.carga))
}

function renderCertPreview() {
  const canvas = document.getElementById("certCanvas")
  if (!canvas || !state.templateImg) return
  canvas.width = state.templateImg.naturalWidth
  canvas.height = state.templateImg.naturalHeight
  drawCertificateInto(canvas, getCertFormData())
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

async function emitCertificadosLote() {
  if (!state.templateImg) {
    showAlert({ title: "Aguarde", message: "O modelo do certificado ainda está carregando. Tente novamente em alguns segundos.", type: "info" })
    return
  }
  const fd = getCertFormData()
  if (!fd.curso || fd.curso === "TÍTULO DO CURSO" || !fd.mes || fd.mes === "XXXX" || !fd.ano || fd.ano === "XXXX" || !fd.dia || fd.dia === "XX") {
    showAlert({ title: "Campos obrigatórios", message: "Preencha curso, dia, mês, ano e carga horária antes de emitir os certificados.", type: "warn" })
    return
  }
  // Garante que o que esta nas checkboxes visiveis esteja sincronizado em state.
  updateCertEmitCount()
  const selected = getCertSelectedParticipants()
  if (!selected.length) {
    showAlert({ title: "Nenhum participante selecionado", message: "Volte à etapa 2 e selecione ao menos um participante para emitir os certificados.", type: "warn" })
    return
  }

  const btn = document.getElementById("certEmit")
  btn.disabled = true
  const progress = document.getElementById("certProgress")
  const fill = document.getElementById("certProgressFill")
  const pctEl = document.getElementById("certProgressPct")
  const labelEl = document.getElementById("certProgressLabel")
  const statusEl = document.getElementById("certStatus")
  progress.hidden = false
  statusEl.className = "cert-status"
  statusEl.textContent = ""
  fill.style.width = "0%"

  const { jsPDF } = window.jspdf
  const zip = new window.JSZip()
  const tmp = document.createElement("canvas")
  tmp.width = state.templateImg.naturalWidth
  tmp.height = state.templateImg.naturalHeight

  for (let i = 0; i < selected.length; i++) {
    const p = selected[i]
    const fields = { ...fd, nome: p.nome }
    drawCertificateInto(tmp, fields)
    const imgData = tmp.toDataURL("image/jpeg", 0.92)
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
    pdf.addImage(imgData, "JPEG", 0, 0, 297, 210)
    const blob = pdf.output("blob")
    zip.file(`certificado-${slug(p.nome)}-${slug(fd.curso)}.pdf`, blob)
    const pctVal = Math.round(((i + 1) / selected.length) * 100)
    fill.style.width = pctVal + "%"
    pctEl.textContent = pctVal + "%"
    labelEl.textContent = `Gerando ${i + 1} de ${selected.length}`
    await new Promise(r => setTimeout(r, 0))
  }

  labelEl.textContent = "Compactando..."
  const zipBlob = await zip.generateAsync({ type: "blob" })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(zipBlob)
  a.download = `certificados-${new Date().toISOString().slice(0, 10)}.zip`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)

  statusEl.classList.add("is-success")
  statusEl.textContent = `${selected.length} certificado(s) gerado(s) e baixado(s) em ZIP.`
  btn.disabled = false
}

// ---------------- Envio automatico via Apps Script Web App ----------------
// Cravados no codigo: usuario final so clica em "Enviar por e-mail".
// Para atualizar a URL apos republicar o Apps Script, edite a constante abaixo.
// Usa o proxy interno (/api/send-certificate) para evitar bloqueio de CORS
// ao chamar script.google.com direto do browser.
const CERT_WEBAPP_URL = "/api/send-certificate"
const CERT_WEBAPP_TOKEN = "7a6RTOQzWtpkIqJmhYP8xADSculgNy4K0sBLiG15oXFZMCen"
const CERT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function initCertWebappConfig() {
  refreshCertSendBtn()
}

function refreshCertSendBtn() {
  const btn = document.getElementById("certSend")
  if (!btn) return
  const n = state._certSelectedCount || 0
  const configured = CERT_WEBAPP_URL && !CERT_WEBAPP_URL.startsWith("COLE_AQUI") && CERT_WEBAPP_TOKEN
  btn.disabled = !(n > 0 && configured)
  btn.title = configured ? "" : "Endpoint nao configurado (CERT_WEBAPP_URL em app.js)."
}

function _blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(",")[1])
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

async function enviarCertificadosLote() {
  if (!state.templateImg) {
    showAlert({ title: "Aguarde", message: "O modelo do certificado ainda está carregando. Tente novamente em alguns segundos.", type: "info" })
    return
  }
  const fd = getCertFormData()
  if (!fd.curso || fd.curso === "TÍTULO DO CURSO" || !fd.mes || fd.mes === "XXXX" || !fd.ano || fd.ano === "XXXX" || !fd.dia || fd.dia === "XX") {
    showAlert({ title: "Campos obrigatórios", message: "Preencha curso, dia, mês, ano e carga horária antes de enviar os e-mails.", type: "warn" })
    return
  }
  const url = CERT_WEBAPP_URL
  const token = CERT_WEBAPP_TOKEN
  if (!url || url.startsWith("COLE_AQUI") || !token) {
    showAlert({ title: "Configuração ausente", message: "Endpoint de envio não configurado. Edite CERT_WEBAPP_URL em assets/js/app.js antes de enviar e-mails.", type: "error" })
    return
  }

  updateCertEmitCount()
  const selected = getCertSelectedParticipants()
  if (!selected.length) {
    showAlert({ title: "Nenhum participante selecionado", message: "Selecione ao menos um participante antes de enviar.", type: "warn" })
    return
  }

  // Valida e-mails antes de enviar nada
  const semEmail = selected.filter(p => !p.email || !CERT_EMAIL_RE.test(p.email.trim()))
  if (semEmail.length) {
    const nomes = semEmail
      .slice(0, 5)
      .map(p => p.nome)
      .join(", ")
    showAlert({ title: "E-mails inválidos", message: `${semEmail.length} selecionado(s) sem e-mail válido. Ex.: ${nomes}.\n\nCorrija na planilha de origem ou desmarque-os antes de enviar.`, type: "warn" })
    return
  }

  const ok = await showConfirm({
    title: "Confirmar envio de e-mails",
    message: `Você está prestes a gerar e ENVIAR ${selected.length} certificado(s) por e-mail.\n\nCada destinatário receberá apenas o seu PDF. Esta ação não pode ser desfeita. Continuar?`,
    confirmLabel: `Enviar ${selected.length} e-mail(s)`,
    cancelLabel: "Cancelar",
    type: "confirm"
  })
  if (!ok) return

  const btnSend = document.getElementById("certSend")
  const btnZip = document.getElementById("certEmit")
  btnSend.disabled = true
  btnZip.disabled = true
  const progress = document.getElementById("certProgress")
  const fill = document.getElementById("certProgressFill")
  const pctEl = document.getElementById("certProgressPct")
  const labelEl = document.getElementById("certProgressLabel")
  const statusEl = document.getElementById("certStatus")
  progress.hidden = false
  statusEl.className = "cert-status"
  statusEl.textContent = ""
  fill.style.width = "0%"

  const { jsPDF } = window.jspdf
  const tmp = document.createElement("canvas")
  tmp.width = state.templateImg.naturalWidth
  tmp.height = state.templateImg.naturalHeight

  let okCount = 0
  const erros = []

  for (let i = 0; i < selected.length; i++) {
    const p = selected[i]
    const fields = { ...fd, nome: p.nome }
    const filename = `certificado-${slug(p.nome)}-${slug(fd.curso)}.pdf`
    try {
      drawCertificateInto(tmp, fields)
      const imgData = tmp.toDataURL("image/jpeg", 0.92)
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
      pdf.addImage(imgData, "JPEG", 0, 0, 297, 210)
      const pdfBlob = pdf.output("blob")
      const pdfBase64 = await _blobToBase64(pdfBlob)

      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          token,
          nome: p.nome,
          email: p.email.trim(),
          pdfName: filename,
          pdfBase64,
          curso: fd.curso,
          dia: fd.dia,
          dia2: fd.dia2 || "",
          mes: fd.mes,
          ano: fd.ano,
          carga: fd.carga
        }),
        redirect: "follow"
      })
      if (!resp.ok) throw new Error("HTTP " + resp.status)
      const res = await resp.json()
      if (res.ok) okCount++
      else erros.push(`${p.email}: ${res.error}`)
    } catch (err) {
      erros.push(`${p.email}: ${err.message || err}`)
    }

    const pctVal = Math.round(((i + 1) / selected.length) * 100)
    fill.style.width = pctVal + "%"
    pctEl.textContent = pctVal + "%"
    labelEl.textContent = `Enviando ${i + 1} de ${selected.length}`
  }

  if (erros.length === 0) {
    statusEl.classList.add("is-success")
    statusEl.textContent = `${okCount} e-mail(s) enviado(s) com sucesso.`
  } else {
    statusEl.classList.add("is-error")
    statusEl.textContent = `${okCount} ok, ${erros.length} erro(s). Detalhes no console.`
    console.error("Erros no envio:", erros)
  }
  btnZip.disabled = false
  refreshCertSendBtn()
}

// ================ AUTO-RELATÓRIO DE SATISFAÇÃO ================
// Configuração institucional (constantes - vão sempre no PDF).
const AR_CONFIG = {
  orgao: "Diretoria de Gestão de Pessoas",
  cabecalho: ["PREFEITURA MUNICIPAL DE PEDRO LEOPOLDO", "SECRETARIA MUNICIPAL DE GESTÃO E FINANÇAS", "DIRETORIA DE GESTÃO DE PESSOAS"],
  assinaturaCargo: "Diretoria de Gestão de Pessoas"
}

function ensureAutoReportState() {
  if (state.autoReport) return state.autoReport
  state.autoReport = {
    participantes: null, // { fileName, evento, data, local, totalInscritos, totalPresentes, totalAusentes, capacidade }
    pesquisa: null // { fileName, respostas, medias, notas, textos, temas: { altos, melhorias, sugestoes } }
  }
  return state.autoReport
}

function renderViewAutoReport() {
  const s = ensureAutoReportState()
  const view = document.getElementById("view-autoreport")
  view.innerHTML = `
    <div class="auto-report-layout">
      <div class="auto-report-form">
        <div class="grid-2">
          <div class="card">
            <div class="card__header"><div><h3>1. Lista de participantes</h3><p>Selecione um evento já carregado ou envie a planilha.</p></div></div>
            <div class="source-tabs" role="tablist" aria-label="Origem dos participantes">
              <button type="button" class="source-tab is-active" data-ar-source="evento" role="tab">
                <i class="fas fa-calendar-day"></i> Evento do sistema
              </button>
              <button type="button" class="source-tab" data-ar-source="upload" role="tab">
                <i class="fas fa-file-arrow-up"></i> Enviar planilha
              </button>
            </div>

            <div data-ar-pane="evento">
              <label class="filter" style="display:flex; flex-direction:column; gap:6px;">
                <span style="font-size:var(--fs-2xs);font-weight:var(--fw-bold);text-transform:uppercase;letter-spacing:var(--tracking-wider);color:var(--text-muted);">Evento</span>
                <select id="arEventSelect" class="event-picker__select">
                  <option value="">- selecione -</option>
                  ${(state.data?.eventos || [])
                    .slice()
                    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
                    .map(
                      ev => `
                    <option value="${ev.id}" ${s.participantes?.fromEventId === ev.id ? "selected" : ""}>${escapeHtml(ev.title)}${ev.date ? " · " + formatDateBR(ev.date) : ""}</option>
                  `
                    )
                    .join("")}
                </select>
              </label>
              <div id="arEventSummary" class="ar-event-summary">${s.participantes?.fromEventId ? renderArEventSummary(s.participantes) : `<p class="ar-event-summary__empty"><i class="fas fa-circle-info"></i> Escolha um evento já carregado. Os dados de presença vêm direto dos relatórios consolidados.</p>`}</div>
            </div>

            <div data-ar-pane="upload" hidden>
              <label class="dropzone" id="arDropPart">
                <input type="file" id="arFilePart" accept=".xlsx,.xls,.csv" />
                <div class="dropzone__icon"><i class="fas fa-users"></i></div>
                <div class="dropzone__title" id="arDropPartTitle">${s.participantes && !s.participantes.fromEventId ? escapeHtml(s.participantes.fileName) : "Clique ou arraste a planilha"}</div>
                <div class="dropzone__sub" id="arDropPartSub">${s.participantes && !s.participantes.fromEventId ? `${s.participantes.totalInscritos} inscritos · ${s.participantes.totalPresentes} presentes` : "XLSX, XLS ou CSV"}</div>
              </label>
            </div>
          </div>

          <div class="card">
            <div class="card__header"><div><h3>2. Pesquisa de satisfação</h3><p>Use a planilha do evento (se existir) ou envie um arquivo.</p></div></div>
            <div class="source-tabs" role="tablist" aria-label="Origem da pesquisa">
              <button type="button" class="source-tab is-active" data-arq-source="evento" role="tab">
                <i class="fas fa-calendar-day"></i> Evento do sistema
              </button>
              <button type="button" class="source-tab" data-arq-source="upload" role="tab">
                <i class="fas fa-file-arrow-up"></i> Enviar planilha
              </button>
            </div>

            <div data-arq-pane="evento">
              <label class="filter" style="display:flex; flex-direction:column; gap:6px;">
                <span style="font-size:var(--fs-2xs);font-weight:var(--fw-bold);text-transform:uppercase;letter-spacing:var(--tracking-wider);color:var(--text-muted);">Evento</span>
                <select id="arPesqEventSelect" class="event-picker__select">
                  <option value="">- selecione -</option>
                  ${(state.data?.eventos || [])
                    .slice()
                    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
                    .map(
                      ev => `
                    <option value="${ev.id}" ${s.pesquisa?.fromEventId === ev.id ? "selected" : ""}>${escapeHtml(ev.title)}${ev.date ? " · " + formatDateBR(ev.date) : ""}</option>
                  `
                    )
                    .join("")}
                </select>
              </label>
              <div id="arPesqEventStatus" class="ar-event-summary">
                ${s.pesquisa?.fromEventId
                  ? `<p class="ar-event-summary__empty"><i class="fas fa-check-circle"></i> ${escapeHtml(s.pesquisa.fileName)} · ${s.pesquisa.respostas} respostas</p>`
                  : `<p class="ar-event-summary__empty"><i class="fas fa-circle-info"></i> Selecione um evento. Se ele tiver <b>satisfacao.xlsx</b> na pasta, será carregada automaticamente.</p>`}
              </div>
            </div>

            <div data-arq-pane="upload" hidden>
              <label class="dropzone" id="arDropPesq">
                <input type="file" id="arFilePesq" accept=".xlsx,.xls,.csv" />
                <div class="dropzone__icon"><i class="fas fa-clipboard-check"></i></div>
                <div class="dropzone__title" id="arDropPesqTitle">${s.pesquisa && !s.pesquisa.fromEventId ? escapeHtml(s.pesquisa.fileName) : "Clique ou arraste a planilha"}</div>
                <div class="dropzone__sub" id="arDropPesqSub">${s.pesquisa && !s.pesquisa.fromEventId ? `${s.pesquisa.respostas} respostas detectadas` : "Colunas detectadas automaticamente"}</div>
              </label>
            </div>
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
  `

  setupAutoReportUploads()
  setupAutoReportSourceTabs()
  setupAutoReportEventPicker()
  setupAutoReportPesquisaSourceTabs()
  setupAutoReportPesquisaEventPicker()
  document.getElementById("arGenerate").addEventListener("click", generateSatisfacaoPdf)
  document.getElementById("arGenerateDocx").addEventListener("click", generateSatisfacaoDocx)
  const pptxBtn = document.getElementById("arGeneratePptx")
  if (pptxBtn) pptxBtn.addEventListener("click", generateSatisfacaoPptx)
  updateAutoReportSummary()
}

function setupAutoReportPesquisaSourceTabs() {
  const tabs = document.querySelectorAll("[data-arq-source]")
  const panes = {
    evento: document.querySelector('[data-arq-pane="evento"]'),
    upload: document.querySelector('[data-arq-pane="upload"]')
  }
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const key = tab.dataset.arqSource
      tabs.forEach(t => t.classList.toggle("is-active", t === tab))
      Object.entries(panes).forEach(([k, el]) => {
        if (el) el.hidden = k !== key
      })
    })
  })
}

function setupAutoReportPesquisaEventPicker() {
  const sel = document.getElementById("arPesqEventSelect")
  if (!sel) return
  sel.addEventListener("change", async () => {
    const status = document.getElementById("arPesqEventStatus")
    const id = sel.value
    if (!id) {
      state.autoReport.pesquisa = null
      status.innerHTML = `<p class="ar-event-summary__empty"><i class="fas fa-circle-info"></i> Selecione um evento. Se ele tiver <b>satisfacao.xlsx</b> na pasta, será carregada automaticamente.</p>`
      updateAutoReportSummary()
      return
    }
    const ev = (state.data?.eventos || []).find(e => e.id === id)
    if (!ev) return
    status.innerHTML = `<p class="ar-event-summary__empty"><i class="fas fa-circle-notch fa-spin"></i> Procurando pesquisa...</p>`

    // Reúne as PASTAS candidatas onde a satisfacao.xlsx pode estar. A pesquisa
    // mora na mesma pasta da planilha de participantes. Como `ev.fonte` pode vir
    // do AO VIVO (caminho do Drive) e os arquivos servidos são os LOCAIS, também
    // consultamos o manifesto local (build) — que sempre casa com o que está no
    // servidor. Cobre ainda eventos consolidados (sem fonte) via `_turmas`.
    const folderOf = p => String(p || "").split("/").slice(0, -1).join("/")
    const folders = []
    const addFolder = f => { if (f && !folders.includes(f)) folders.push(f) }
    addFolder(folderOf(ev.fonte))
    ;(ev._turmas || []).forEach(t => addFolder(folderOf(t.fonte)))
    try {
      const man = await fetch("assets/docs/relatorios/manifest.json", { cache: "no-cache" }).then(r => (r.ok ? r.json() : null))
      const ids = new Set([id, ...((ev._turmas || []).map(t => t.id))])
      ;(man?.planilhas || []).forEach(p => { if (ids.has(p.id)) addFolder(folderOf(p.arquivo)) })
    } catch (_) {}

    if (!folders.length) {
      state.autoReport.pesquisa = null
      status.innerHTML = `<p class="ar-event-summary__empty"><i class="fas fa-triangle-exclamation"></i> Evento sem pasta vinculada. Use a aba "Enviar planilha".</p>`
      updateAutoReportSummary()
      return
    }

    // tenta variações comuns do nome, em cada pasta candidata
    const tries = ["satisfacao.xlsx", "Satisfação.xlsx", "satisfação.xlsx", "Satisfacao.xlsx", "pesquisa.xlsx", "Pesquisa.xlsx"]
    let blob = null
    let usedName = null
    let usedFolder = null
    const urlsTentadas = []
    outer: for (const folder of folders) {
      for (const name of tries) {
        const url = `assets/docs/relatorios/${encodeURI(folder)}/${encodeURIComponent(name)}`
        urlsTentadas.push(url)
        try {
          const r = await fetch(url)
          if (r.ok) {
            blob = await r.blob()
            usedName = name
            usedFolder = folder
            break outer
          }
        } catch (_) {}
      }
    }
    if (!blob) {
      state.autoReport.pesquisa = null
      console.warn("[auto-relatório] pesquisa não encontrada. URLs tentadas:", urlsTentadas)
      status.innerHTML = `<p class="ar-event-summary__empty"><i class="fas fa-triangle-exclamation"></i> Não encontrei <b>satisfacao.xlsx</b> na(s) pasta(s): ${folders.map(escapeHtml).join(" · ")}. Use a aba "Enviar planilha".</p>`
      updateAutoReportSummary()
      return
    }
    const file = new File([blob], usedName, { type: blob.type })
    handleAutoReportPesquisa(file, { fromEventId: id, displayName: `Evento: ${ev.title}` })
    status.innerHTML = `<p class="ar-event-summary__empty"><i class="fas fa-check-circle"></i> Pesquisa carregada de <b>${escapeHtml(usedFolder + "/" + usedName)}</b>.</p>`
  })
}

function setupAutoReportSourceTabs() {
  const tabs = document.querySelectorAll("[data-ar-source]")
  const panes = {
    evento: document.querySelector('[data-ar-pane="evento"]'),
    upload: document.querySelector('[data-ar-pane="upload"]')
  }
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const key = tab.dataset.arSource
      tabs.forEach(t => t.classList.toggle("is-active", t === tab))
      Object.entries(panes).forEach(([k, el]) => {
        if (el) el.hidden = k !== key
      })
    })
  })
}

function setupAutoReportEventPicker() {
  const sel = document.getElementById("arEventSelect")
  if (!sel) return
  sel.addEventListener("change", () => {
    const id = sel.value
    if (!id) {
      state.autoReport.participantes = null
      document.getElementById("arEventSummary").innerHTML =
        `<p class="ar-event-summary__empty"><i class="fas fa-circle-info"></i> Escolha um evento já carregado.</p>`
      updateAutoReportSummary()
      return
    }
    const ev = (state.data?.eventos || []).find(e => e.id === id)
    if (!ev) return
    const totalInscritos = ev.totalInscritos || 0
    const totalPresentes = ev.totalPresentes || 0
    const totalAusentes = ev.totalAusentes ?? Math.max(0, totalInscritos - totalPresentes)
    const capacidade = ev.vagas || totalInscritos
    state.autoReport.participantes = {
      fromEventId: id,
      fileName: `Evento: ${ev.title}`,
      evento: ev.title,
      data: ev.dateRaw || (ev.date ? formatDateBR(ev.date) : ""),
      local: ev.local || "",
      totalInscritos,
      totalPresentes,
      totalAusentes,
      capacidade,
      capacidadeInferida: !ev.vagas,
      participantes: ev.participantes || [],
      secretarias: ev.secretarias || {},
      secretariasPresentes: ev.secretariasPresentes || {}
    }
    document.getElementById("arEventSummary").innerHTML = renderArEventSummary(state.autoReport.participantes)
    updateAutoReportSummary()
  })
}

function renderArEventSummary(p) {
  if (!p) return ""
  const taxa = p.totalInscritos ? ((p.totalPresentes / p.totalInscritos) * 100).toFixed(1) + "%" : "-"
  // Ocupação = Presentes / (Presentes + Ausentes), igual ao resto do painel.
  const ocupBase = (p.totalPresentes || 0) + (p.totalAusentes || 0)
  const ocup = ocupBase > 0 ? ((p.totalPresentes / ocupBase) * 100).toFixed(1) + "%" : "-"
  return `
    <div class="ar-event-card">
      <div class="ar-event-card__title">${escapeHtml(p.evento)}</div>
      <div class="ar-event-card__meta">
        ${p.data ? `<span><i class="fas fa-calendar"></i> ${escapeHtml(p.data)}</span>` : ""}
        ${p.local ? `<span><i class="fas fa-location-dot"></i> ${escapeHtml(p.local)}</span>` : ""}
      </div>
      <div class="ar-event-card__metrics">
        <div><span>Inscritos</span><b>${p.totalInscritos}</b></div>
        <div><span>Presentes</span><b class="green">${p.totalPresentes}</b></div>
        <div><span>Ausentes</span><b class="${p.totalAusentes > 0 ? "red" : ""}">${p.totalAusentes}</b></div>
        <div><span>Taxa</span><b>${taxa}</b></div>
        <div><span>Capacidade</span><b>${p.capacidade}${p.capacidadeInferida ? "*" : ""}</b></div>
        <div><span>Ocupação</span><b>${ocup}</b></div>
      </div>
    </div>
  `
}

function updateAutoReportSummary() {
  const s = state.autoReport
  const p = s.participantes
  const q = s.pesquisa

  const taxaNum = p && p.totalInscritos ? (p.totalPresentes / p.totalInscritos) * 100 : null
  const taxaStr = taxaNum != null ? taxaNum.toFixed(1) + "%" : "-"
  const taxaTone = taxaNum == null ? "muted" : taxaNum >= 80 ? "good" : taxaNum >= 60 ? "warn" : "bad"

  const renderStars = media => {
    const v = Math.max(0, Math.min(5, Number(media) || 0))
    const full = Math.floor(v)
    const half = v - full >= 0.5 ? 1 : 0
    const empty = 5 - full - half
    return "★".repeat(full) + (half ? "⯨" : "") + "☆".repeat(empty)
  }

  const criteriosHtml = q?.criterios?.length
    ? q.criterios
        .map(c => {
          const media = Number(c.media) || 0
          return `
          <li class="ar-rating-row">
            <span class="ar-rating-row__label">${escapeHtml(c.label)}</span>
            <span class="ar-rating-row__stars" aria-hidden="true">${renderStars(media)}</span>
            <span class="ar-rating-row__value">${media.toFixed(2)}</span>
          </li>`
        })
        .join("")
    : `<li class="ar-rating-row ar-rating-row--empty">Sem critérios disponíveis</li>`

  const temasChips = q?.temas
    ? `
        <span class="ar-chip ar-chip--good"><i class="bi bi-arrow-up-circle-fill"></i> ${q.temas.altos.length} pontos altos</span>
        <span class="ar-chip ar-chip--warn"><i class="bi bi-tools"></i> ${q.temas.melhorias.length} melhorias</span>
        <span class="ar-chip ar-chip--info"><i class="bi bi-lightbulb-fill"></i> ${q.temas.sugestoes.length} sugestões</span>
      `
    : `<span class="ar-chip ar-chip--muted">Nenhum tema extraído</span>`

  const capBadge = p?.capacidadeInferida ? `<span class="ar-tag ar-tag--soft" title="Valor inferido a partir dos dados">inferida</span>` : ""

  document.getElementById("arSummary").innerHTML = `
    <section class="ar-block ar-block--event">
      <h4 class="ar-block__title">${escapeHtml(p?.evento || "Evento não detectado")}</h4>
      <div class="ar-block__meta">
        <span><i class="bi bi-calendar-event"></i> ${escapeHtml(p?.data || "-")}</span>
        <span><i class="bi bi-people-fill"></i> Capacidade ${p?.capacidade ?? "-"} ${capBadge}</span>
      </div>
    </section>

    <section class="ar-block ar-hero ar-hero--${taxaTone}">
      <div class="ar-hero__label">Taxa de presença</div>
      <div class="ar-hero__value">${taxaStr}</div>
      <div class="ar-hero__bar"><span style="width:${taxaNum != null ? Math.min(100, taxaNum) : 0}%"></span></div>
      <div class="ar-hero__caption">${p?.totalPresentes ?? "-"} de ${p?.totalInscritos ?? "-"} inscritos compareceram</div>
    </section>

    <section class="ar-kpis">
      <div class="ar-kpi">
        <div class="ar-kpi__value">${p?.totalInscritos ?? "-"}</div>
        <div class="ar-kpi__label">Inscritos</div>
      </div>
      <div class="ar-kpi ar-kpi--good">
        <div class="ar-kpi__value">${p?.totalPresentes ?? "-"}</div>
        <div class="ar-kpi__label">Presentes</div>
      </div>
      <div class="ar-kpi ar-kpi--bad">
        <div class="ar-kpi__value">${p?.totalAusentes ?? "-"}</div>
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
  `
}

function setupAutoReportUploads() {
  const setupDrop = (dropId, inputId, handler) => {
    const drop = document.getElementById(dropId)
    const input = document.getElementById(inputId)
    if (!drop || !input) return
    input.addEventListener("change", e => {
      if (e.target.files[0]) handler(e.target.files[0])
    })
    ;["dragenter", "dragover"].forEach(ev =>
      drop.addEventListener(ev, e => {
        e.preventDefault()
        drop.classList.add("is-drag")
      })
    )
    ;["dragleave", "drop"].forEach(ev =>
      drop.addEventListener(ev, e => {
        e.preventDefault()
        drop.classList.remove("is-drag")
      })
    )
    drop.addEventListener("drop", e => {
      if (e.dataTransfer.files[0]) handler(e.dataTransfer.files[0])
    })
  }
  setupDrop("arDropPart", "arFilePart", handleAutoReportParticipantes)
  setupDrop("arDropPesq", "arFilePesq", handleAutoReportPesquisa)
}

function handleAutoReportParticipantes(file) {
  const reader = new FileReader()
  reader.onload = e => {
    try {
      const data = new Uint8Array(e.target.result)
      const wb = window.XLSX.read(data, { type: "array" })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const json = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" })

      // Extrai metadados (linhas 0-3): título, data, local
      const get = (i, j) => (json[i] && json[i][j] != null ? String(json[i][j]).trim() : "")
      const evento = get(0, 0).replace(/\s+/g, " ")
      let dataEvento = ""
      let local = ""
      for (let i = 1; i < Math.min(5, json.length); i++) {
        for (let j = 0; j < (json[i] || []).length; j++) {
          const v = get(i, j)
          if (!dataEvento && /^data\s*:/i.test(v)) {
            dataEvento = v.replace(/^data\s*:\s*/i, "").trim()
          }
          if (!local && /^local\s*:/i.test(v)) {
            local = v.replace(/^local\s*:\s*/i, "").trim()
          }
        }
      }

      // Detecta cabeçalho com "Nome" + "Check-in"
      let hdr = -1
      for (let i = 0; i < Math.min(15, json.length); i++) {
        const lower = (json[i] || []).map(c => String(c).toLowerCase())
        if (lower.some(c => c.includes("check-in")) && (lower.some(c => c === "nome") || lower.some(c => c.includes("ordem de")))) {
          hdr = i
          break
        }
      }
      if (hdr < 0) throw new Error("Cabeçalho não encontrado (esperado: Nome + Check-in)")

      const headers = json[hdr].map(h => String(h).toLowerCase())
      const colNome = headers.findIndex(h => h === "nome" || h.startsWith("nome"))
      const colChk = headers.findIndex(h => h.includes("check-in") && !h.includes("data"))
      const rows = json
        .slice(hdr + 1)
        .filter(r => r[colNome] && !String(r[colNome]).toLowerCase().startsWith("exportado") && !String(r[colNome]).startsWith("*"))
      const totalInscritos = rows.length
      const totalPresentes = rows.filter(r => String(r[colChk] || "").toLowerCase() === "sim").length

      // Infere capacidade: tenta match no JSON consolidado primeiro
      let capacidade = null
      let capacidadeInferida = false
      if (state.data && state.data.eventos) {
        const norm = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
        const evNorm = norm(evento)
        const match = state.data.eventos.find(ev => {
          const t = norm(ev.title || "")
          return t && (evNorm.includes(t) || t.includes(evNorm))
        })
        if (match && match.vagas) capacidade = match.vagas
      }
      // Fallback: assume sold out (capacidade = inscritos)
      if (!capacidade) {
        capacidade = totalInscritos
        capacidadeInferida = true
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
        capacidadeInferida
      }
      document.getElementById("arDropPart").classList.add("has-file")
      document.getElementById("arDropPartTitle").textContent = evento || file.name
      document.getElementById("arDropPartSub").textContent =
        `${totalInscritos} inscritos · ${totalPresentes} presentes · capacidade ${capacidade}${capacidadeInferida ? " (inferida)" : ""}`
      updateAutoReportSummary()
    } catch (err) {
      document.getElementById("arDropPartTitle").textContent = "Erro ao ler planilha"
      document.getElementById("arDropPartSub").textContent = err.message
    }
  }
  reader.readAsArrayBuffer(file)
}

function handleAutoReportPesquisa(file, meta = {}) {
  const reader = new FileReader()
  reader.onload = e => {
    try {
      const data = new Uint8Array(e.target.result)
      const wb = window.XLSX.read(data, { type: "array" })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const rows = window.XLSX.utils.sheet_to_json(sheet, { defval: "" })
      if (!rows.length) throw new Error("Planilha vazia")

      const columns = Object.keys(rows[0])
      const numeric = v => {
        const m = String(v)
          .replace(",", ".")
          .match(/-?\d+(\.\d+)?/)
        if (!m) return null
        const n = parseFloat(m[0])
        return isFinite(n) ? n : null
      }

      // Classifica cada coluna automaticamente:
      // - "skip": carimbo de data/email/etc
      // - "numeric": coluna com valores 1-5 (escala Likert)
      // - "text": coluna textual livre
      const numericCols = []
      const textCols = []
      columns.forEach(col => {
        const lc = col.toLowerCase()
        if (/carimbo|timestamp|endere|e-?mail|nome\s|matr|data\b/.test(lc)) return
        // analisa primeiras 30 linhas para classificar
        const sample = rows
          .slice(0, 30)
          .map(r => r[col])
          .filter(v => v !== "" && v != null)
        if (!sample.length) return
        const numericVals = sample.map(numeric).filter(n => n != null && n >= 1 && n <= 5)
        const numericRatio = numericVals.length / sample.length
        if (numericRatio >= 0.7) {
          numericCols.push(col)
        } else {
          // se a maioria dos valores são strings com >=4 caracteres, conta como texto
          const textVals = sample.filter(v => typeof v === "string" && v.trim().length >= 3)
          if (textVals.length / sample.length >= 0.3) textCols.push(col)
        }
      })

      // Para cada coluna numérica: calcula média + distribuição 1-5
      const criterios = numericCols.map(col => {
        const vals = rows.map(r => numeric(r[col])).filter(v => v != null && v >= 1 && v <= 5)
        const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, total: vals.length }
        vals.forEach(v => {
          dist[Math.round(v)] += 1
        })
        const media = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
        return {
          // limpa numeração ("2.   Qual o ponto alto" → "Qual o ponto alto") e dois-pontos finais
          label: col
            .replace(/^\s*\d+[\.\)]\s*/, "")
            .replace(/[:\s]+$/, "")
            .trim(),
          original: col,
          media,
          dist
        }
      })

      // Classifica colunas textuais por finalidade pelo cabeçalho
      const matcher = {
        altos: /ponto.*alto|destaque|positiv|gost|alto.*ponto/i,
        melhorias: /melhor|ruim|negativ|dificul|crít/i,
        sugestoes: /sugest|tema|próxim|proxim|futur/i,
        comentarios: /coment|observa|livr|geral|outr/i
      }
      const textosBy = { altos: [], melhorias: [], sugestoes: [], comentarios: [] }
      const usedTextCols = new Set()
      textCols.forEach(col => {
        for (const key of ["altos", "melhorias", "sugestoes", "comentarios"]) {
          if (matcher[key].test(col)) {
            const vals = rows.map(r => String(r[col] || "").trim()).filter(v => v)
            textosBy[key] = textosBy[key].concat(vals)
            usedTextCols.add(col)
            break
          }
        }
      })
      // Colunas textuais não classificadas viram comentários gerais
      textCols
        .filter(c => !usedTextCols.has(c))
        .forEach(col => {
          const vals = rows.map(r => String(r[col] || "").trim()).filter(v => v)
          textosBy.comentarios = textosBy.comentarios.concat(vals)
        })

      // Recomendação: tenta achar critério "recomend*"; se não, usa o critério com maior média
      // (proxy) para o texto da conclusão.
      let recIdx = criterios.findIndex(c => /recomend/i.test(c.original))
      let recomendacao = recIdx >= 0 ? criterios[recIdx] : null

      state.autoReport.pesquisa = {
        fromEventId: meta.fromEventId || null,
        fileName: meta.displayName || file.name,
        respostas: rows.length,
        criterios, // [{label, media, dist}, ...] - qualquer quantidade
        recomendacao, // critério "recomend*" se existir; senão null
        textos: textosBy,
        temas: {
          altos: extractThemes(textosBy.altos),
          melhorias: extractThemes(textosBy.melhorias),
          sugestoes: extractThemes(textosBy.sugestoes)
        }
      }

      const resumoCriterios = criterios
        .slice(0, 3)
        .map(c => `${c.label.slice(0, 18)}=${c.media.toFixed(2)}`)
        .join(" · ")
      const drop = document.getElementById("arDropPesq")
      const dropTitle = document.getElementById("arDropPesqTitle")
      const dropSub = document.getElementById("arDropPesqSub")
      if (drop) drop.classList.add("has-file")
      if (dropTitle) dropTitle.textContent = meta.displayName || file.name
      if (dropSub) dropSub.textContent = `${rows.length} respostas · ${criterios.length} critérios · ${resumoCriterios}`
      updateAutoReportSummary()
    } catch (err) {
      const dropTitle = document.getElementById("arDropPesqTitle")
      const dropSub = document.getElementById("arDropPesqSub")
      if (dropTitle) dropTitle.textContent = "Erro ao ler planilha"
      if (dropSub) dropSub.textContent = err.message
    }
  }
  reader.readAsArrayBuffer(file)
}

// ---------------- Extração automática de temas (NLP simples) ----------------
const PT_STOPWORDS = new Set([
  "a",
  "o",
  "e",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "em",
  "no",
  "na",
  "nos",
  "nas",
  "um",
  "uma",
  "uns",
  "umas",
  "para",
  "com",
  "por",
  "pelo",
  "pela",
  "pelos",
  "pelas",
  "que",
  "se",
  "ao",
  "aos",
  "à",
  "às",
  "mas",
  "ou",
  "como",
  "quando",
  "onde",
  "então",
  "ja",
  "já",
  "mais",
  "muito",
  "muita",
  "muitos",
  "muitas",
  "também",
  "tambem",
  "só",
  "so",
  "ser",
  "sao",
  "são",
  "foi",
  "foram",
  "tem",
  "têm",
  "tinha",
  "ter",
  "tive",
  "este",
  "esta",
  "esse",
  "essa",
  "isto",
  "isso",
  "aquilo",
  "aquele",
  "aquela",
  "seu",
  "sua",
  "seus",
  "suas",
  "meu",
  "minha",
  "nosso",
  "nossa",
  "todo",
  "toda",
  "todos",
  "todas",
  "outro",
  "outra",
  "outros",
  "outras",
  "não",
  "nao",
  "sim",
  "poder",
  "pode",
  "ainda",
  "já",
  "la",
  "lá",
  "aqui",
  "ali",
  "do",
  "sobre",
  "entre",
  "até",
  "após",
  "antes",
  "contra",
  "sem",
  "sob",
  "durante",
  "evento",
  "eventos",
  "palestra",
  "palestras",
  "atividade",
  "atividades",
  "achei",
  "gostei",
  "acho",
  "gosto",
  "fica",
  "ficar",
  "ficou",
  "houve",
  "boa",
  "bom",
  "boas",
  "bons",
  "melhor",
  "melhores",
  "ótima",
  "otima",
  "ótimo",
  "otimo",
  "ótimas",
  "otimas",
  "ótimos",
  "otimos",
  "tudo",
  "nada",
  "alguma",
  "algum",
  "algumas",
  "alguns",
  "cada",
  "quem",
  "qual",
  "quais",
  "estar",
  "estou",
  "estamos",
  "está",
  "esta",
  "estão",
  "estao",
  "vez",
  "vezes",
  "dia",
  "dias",
  "mês",
  "meses",
  "ano",
  "anos",
  "hora",
  "horas",
  "tempo"
])

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

// Lematização simples para PT-BR: unifica plural/singular e variações comuns.
// "curso" e "cursos" → "curso"; "capacitações" → "capacitacao"; etc.
function lemmatize(w) {
  if (w.length < 4) return w
  // -ções/-coes → -cao
  if (w.endsWith("coes")) return w.slice(0, -4) + "cao"
  // -ões → -ao
  if (w.endsWith("oes")) return w.slice(0, -3) + "ao"
  // -ais → -al (animais → animal)
  if (w.endsWith("ais")) return w.slice(0, -3) + "al"
  // -eis → -el
  if (w.endsWith("eis")) return w.slice(0, -3) + "el"
  // -is → -il (lápis fica de fora pelo length, gentis → gentil)
  if (w.endsWith("is") && w.length >= 5) return w.slice(0, -2) + "il"
  // -res → -r (servidores → servidor)
  if (w.endsWith("res")) return w.slice(0, -2)
  // plural simples -s (mas evita palavras tipo "menos", "antes", "talvez")
  if ((w.endsWith("s") && !["os", "as", "is", "es", "us"].includes(w.slice(-2))) || w.endsWith("os") || w.endsWith("as")) {
    return w.slice(0, -1)
  }
  return w
}

function titleCase(s) {
  return s
    .split(" ")
    .map(w => (w.length >= 3 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
}

// ---------------- Agrupamento semântico de respostas abertas ----------------
// Grupos curados de sinônimos por tema. Cada chave do grupo é o rótulo final.
// Cada termo pode ser uma palavra-base ou expressão; usamos match por contém.
// Importante: o primeiro grupo cujos termos casarem com a resposta "ganha".
const SEMANTIC_GROUPS = [
  { label: "Palestrante / Mediação",       terms: ["palestrant", "mediad", "instrut", "professor", "facilitad", "ministr", "convidad", "expositor"] },
  { label: "Conteúdo / Material",          terms: ["conteud", "materia", "apostil", "tema", "assunt", "abordage", "infor"] },
  { label: "Organização do evento",        terms: ["organiz", "planejament", "coordena", "logístic", "logistic"] },
  { label: "Duração / Carga horária",      terms: ["duraç", "duracao", "tempo", "horári", "horario", "carga", "longo", "curto", "estendid"] },
  { label: "Estrutura / Local",            terms: ["estrutura", "local", "espaço", "espaco", "ambient", "ar-condicion", "ar condicion", "audio", "som", "som ", "iluminaç", "iluminac", "sala"] },
  { label: "Dinâmica / Participação",      terms: ["dinâmic", "dinamic", "interaç", "interac", "particip", "engajament", "atividade", "exercíc", "exercic", "prátic", "pratic"] },
  { label: "Alimentação / Coquetel",       terms: ["alimentaç", "alimentac", "coquet", "lanche", "café", "cafe", "comida", "bebida", "refeiç", "refeic"] },
  { label: "Aplicabilidade / Rotina",      terms: ["aplicabilid", "aplicaç", "aplicac", "prátic", "pratic", "rotina", "dia a dia", "uso real"] },
  { label: "Mais eventos / Frequência",    terms: ["mais event", "mais frequ", "frequenc", "frequên", "regular", "periodic", "mais cursos", "mais capacit"] },
  { label: "Divulgação / Público",         terms: ["divulgaç", "divulgac", "públic", "public ", "convite", "convocaç", "convocac", "comunic"] },
  { label: "Liderança / Gestão",           terms: ["liderança", "lideranca", "lider", "gestão de pesso", "gestao de pesso", "chef"] },
  { label: "Saúde mental / Bem-estar",     terms: ["saúde mental", "saude mental", "bem estar", "bem-estar", "autocuid", "estresse", "ansied", "burnout", "qualidade de vida"] },
  { label: "Ética / Serviço público",      terms: ["étic", "etic", "moral", "integridad", "conduta", "serviç", "servic público", "servidor"] },
  { label: "Comunicação / Atendimento",    terms: ["comunicaç", "comunicac", "atend", "oratóri", "oratoria", "escuta", "diál"] },
  { label: "Inovação / Tecnologia",        terms: ["inovaç", "inovac", "tecnologi", "digital", "inteligência artif", "ia ", "transformaç digital"] },
  { label: "Legislação / Normas",          terms: ["legislaç", "legislac", "lei ", "norma", "regulamen", "decret", "estatut"] },
  { label: "Financeiro / Orçamento",       terms: ["financeir", "orçament", "orcament", "tribut", "fiscal", "contábil", "contabil", "tesourar"] },
  { label: "Diversidade / Inclusão",       terms: ["diversidad", "inclus", "raça", "raca", "gênero", "genero", "lgbt", "pcd", "acessib", "equidade"] },
  { label: "Compras / Licitação",          terms: ["compras", "licitaç", "licitac", "contrataç", "pregão", "pregao"] },
  { label: "Avaliação / Indicadores",      terms: ["avaliaç", "indicad", "métric", "metric", "kpi", "monitorament"] }
]

// Tenta encaixar um texto normalizado em um dos grupos semânticos curados.
function matchSemanticGroup(text) {
  if (!text) return null
  const t = " " + text.toLowerCase() + " "
  for (const grp of SEMANTIC_GROUPS) {
    for (const term of grp.terms) {
      if (t.includes(term)) return grp.label
    }
  }
  return null
}

// Conjunto de tokens significativos (>=4 chars, sem stopwords, lematizados)
// para clustering por similaridade quando não há grupo curado.
function tokenSet(text) {
  return new Set(
    normalizeText(text)
      .split(" ")
      .map(lemmatize)
      .filter(w => w.length >= 4 && !PT_STOPWORDS.has(w))
  )
}

// Similaridade de Jaccard entre dois conjuntos de tokens.
function jaccard(a, b) {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

// Agrupa respostas abertas em temas. Funcionamento:
// 1) Cada resposta tenta ser encaixada em um grupo semântico curado.
// 2) Respostas sem grupo curado são clusterizadas por similaridade de Jaccard
//    (limiar 0.34) - duas respostas com tokens significativos em comum entram
//    no mesmo cluster, cujo rótulo é o trecho-chave mais informativo do grupo.
// 3) Devolve até `max` clusters ordenados por frequência.
function extractThemes(responses, max = 10) {
  if (!Array.isArray(responses) || !responses.length) return []

  // Limpa, descarta vazios e respostas-fantasma ("não", "nenhum", "tudo bom")
  const SKIP = /^(n[ãa]o|nenhum[ao]?|nd|nada|tudo (bom|ok|certo)|sem (coment|sugest|opini)|ok)\.?\s*$/i
  const clean = responses
    .map(r => String(r || "").trim())
    .filter(r => r.length >= 3 && !SKIP.test(r))

  if (!clean.length) return []

  // Etapa 1: encaixe em grupos semânticos curados
  const groupCounts = new Map() // label -> { value, samples: Set }
  const remaining = []
  clean.forEach(r => {
    const g = matchSemanticGroup(r)
    if (g) {
      const entry = groupCounts.get(g) || { value: 0, samples: [] }
      entry.value += 1
      entry.samples.push(r)
      groupCounts.set(g, entry)
    } else {
      remaining.push(r)
    }
  })

  // Etapa 2: clustering das respostas residuais por Jaccard
  const tokenSets = remaining.map(r => ({ text: r, tokens: tokenSet(r) }))
  const clusters = [] // { value, samples, tokens: Set }
  tokenSets.forEach(({ text, tokens }) => {
    if (!tokens.size) return
    let best = null
    let bestSim = 0
    for (const c of clusters) {
      const s = jaccard(c.tokens, tokens)
      if (s > bestSim) { best = c; bestSim = s }
    }
    if (best && bestSim >= 0.34) {
      best.value += 1
      best.samples.push(text)
      // união leve dos tokens
      for (const t of tokens) best.tokens.add(t)
    } else {
      clusters.push({ value: 1, samples: [text], tokens: new Set(tokens) })
    }
  })

  // Rótulo para cluster sem grupo curado: pega o bigrama mais frequente entre
  // seus samples; se não houver, pega a palavra mais "rara" (mais informativa).
  const labelForCluster = c => {
    const bigCounts = new Map()
    const uniCounts = new Map()
    c.samples.forEach(s => {
      const words = normalizeText(s).split(" ").map(lemmatize).filter(w => w.length >= 4 && !PT_STOPWORDS.has(w))
      const seenB = new Set()
      for (let i = 0; i < words.length - 1; i++) {
        const bg = words[i] + " " + words[i + 1]
        if (seenB.has(bg)) continue
        seenB.add(bg)
        bigCounts.set(bg, (bigCounts.get(bg) || 0) + 1)
      }
      new Set(words).forEach(w => uniCounts.set(w, (uniCounts.get(w) || 0) + 1))
    })
    let best = null, bestC = 0
    for (const [k, v] of bigCounts) if (v > bestC) { best = k; bestC = v }
    if (best && bestC >= 1) return titleCase(best)
    for (const [k, v] of uniCounts) if (v > bestC) { best = k; bestC = v }
    return best ? titleCase(best) : "Outros"
  }

  const out = []
  for (const [label, entry] of groupCounts) {
    out.push({ label, value: entry.value, samples: entry.samples })
  }
  for (const c of clusters) {
    out.push({ label: labelForCluster(c), value: c.value, samples: c.samples })
  }

  return out
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, max)
}

// ---------------- Geração do PDF ----------------
function parseCategorias(txt) {
  // Aceita "Nome: 5" ou "Nome - 5" por linha
  return String(txt || "")
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      const m = l.match(/^(.+?)\s*[:\-]\s*(\d+)\s*$/)
      if (m) return { label: m[1].trim(), value: parseInt(m[2], 10) }
      return null
    })
    .filter(Boolean)
    .sort((a, b) => b.value - a.value)
}

async function renderChartToImage(type, config, width = 700, height = 400) {
  return new Promise(resolve => {
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    canvas.style.position = "fixed"
    canvas.style.left = "-9999px"
    document.body.appendChild(canvas)
    const plugins = []
    if (window.ChartDataLabels) plugins.push(window.ChartDataLabels)
    const chart = new window.Chart(canvas, {
      type,
      data: config.data,
      options: {
        ...config.options,
        responsive: false,
        animation: false,
        devicePixelRatio: 2,
        layout: { padding: { top: 24, right: 32, bottom: 8, left: 8, ...(config.options?.layout?.padding || {}) } }
      },
      plugins
    })
    // espera o desenho concluir
    setTimeout(() => {
      const img = canvas.toDataURL("image/png")
      chart.destroy()
      canvas.remove()
      resolve(img)
    }, 80)
  })
}

// Carrega os ativos de marca da Escola de Governo (logos + gradient do
// Modelo de Apresentação) como data URLs, prontos para uso em PPTX.
let _brandAssetsCache = null
async function loadBrandAssets() {
  if (_brandAssetsCache) return _brandAssetsCache
  const toDataUrl = async url => {
    const r = await fetch(url)
    const blob = await r.blob()
    return await new Promise(res => {
      const reader = new FileReader()
      reader.onload = () => res(reader.result)
      reader.readAsDataURL(blob)
    })
  }
  // Lê as dimensões naturais da imagem - essencial para manter aspect ratio.
  const getDims = (dataUrl) => new Promise(res => {
    const img = new Image()
    img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight, ratio: img.naturalWidth / img.naturalHeight })
    img.onerror = () => res({ w: 1, h: 1, ratio: 1 })
    img.src = dataUrl
  })

  const [egovLogo, comboLogo, brasao, hero] = await Promise.all([
    toDataUrl("assets/img/marca/egov-logo.png"),
    toDataUrl("assets/img/marca/egov-pl-combo.png"),
    toDataUrl("assets/img/marca/pl-brasao.png"),
    toDataUrl("assets/img/marca/hero-gradient.png")
  ])
  const [egovLogoDims, comboLogoDims, brasaoDims, heroDims] = await Promise.all([
    getDims(egovLogo), getDims(comboLogo), getDims(brasao), getDims(hero)
  ])
  _brandAssetsCache = {
    egovLogo, comboLogo, brasao, hero,
    dims: { egovLogo: egovLogoDims, comboLogo: comboLogoDims, brasao: brasaoDims, hero: heroDims }
  }
  return _brandAssetsCache
}

// Calcula tamanho "fit-to-box" mantendo aspect ratio.
// Recebe ratio (w/h) e a caixa-alvo (maxW, maxH). Devolve { w, h }.
function fitAspect(ratio, maxW, maxH) {
  if (!ratio || ratio <= 0) return { w: maxW, h: maxH }
  // Tenta usar maxW; se a altura ultrapassar, usa maxH.
  const wByW = maxW
  const hByW = maxW / ratio
  if (hByW <= maxH) return { w: wByW, h: hByW }
  return { w: maxH * ratio, h: maxH }
}

// Define o master institucional da EGov para slides PPTX. Pinta o gradient
// verde→azul do Modelo de Apresentação no canto superior esquerdo, coloca o
// brasão de Pedro Leopoldo no canto superior direito e um rodapé sutil com
// número de página. Garante a identidade visual em todos os slides internos.
function buildEgovPptxMaster(pptx, brand, rodape = "Relatório") {
  pptx.defineSlideMaster({
    title: "EGOV_MASTER",
    background: { color: "FFFFFF" },
    objects: [
      // Faixa decorativa superior (gradient verde→azul do Modelo)
      { image: { x: 0, y: 0, w: 13.333, h: 0.55, data: brand.hero, sizing: { type: "cover", w: 13.333, h: 0.55 } } },
      // Texto institucional no header - sem brasão (evita distorção)
      { text: { text: "Escola de Governo · Prefeitura Municipal de Pedro Leopoldo", options: { x: 0.5, y: 0, w: 12.333, h: 0.55, fontFace: "Calibri", fontSize: 12, bold: true, color: "1B2A4E", valign: "middle", align: "center" } } },
      // Rodapé institucional centralizado
      { rect: { x: 0, y: 7.18, w: 13.333, h: 0.32, fill: { color: "F5F8FB" } } },
      { rect: { x: 0, y: 7.18, w: 13.333, h: 0.04, fill: { color: "4DAD33" } } },
      { text: { text: rodape, options: { x: 0, y: 7.18, w: 13.333, h: 0.32, fontFace: "Calibri", fontSize: 10, color: "5A6B85", valign: "middle", align: "center" } } }
    ],
    slideNumber: { x: 12.75, y: 7.18, w: 0.5, h: 0.32, fontFace: "Calibri", fontSize: 10, color: "5A6B85" }
  })
}

// Cabeçalho padrão de slide interno: barra verde + título marinho.
function egovSlideTitle(slide, text) {
  slide.addShape("rect", { x: 0.7, y: 0.95, w: 0.16, h: 0.55, fill: { color: EGOV_BRAND.green } })
  slide.addText(text, { x: 0.95, y: 0.9, w: 11.8, h: 0.65, fontFace: EGOV_BRAND.font, fontSize: 26, bold: true, color: EGOV_BRAND.navy })
}

// Paleta institucional Pedro Leopoldo / EGov (azul-marinho do brasão + verde
// EGov + tons suaves do Modelo Apresentação)
const EGOV_BRAND = {
  navy: "1B2A4E",        // azul-marinho do brasão
  navyLight: "243759",
  green: "4DAD33",       // verde EGov
  greenLight: "82C56F",
  greenSoft: "DCEFD2",
  blueSoft: "E6EEF7",
  bgSoft: "F5F8FB",
  text: "1B2A4E",
  textMuted: "5A6B85",
  white: "FFFFFF",
  font: "Calibri"
}

// Pizza/donut com efeito 3D (perspectiva) via ApexCharts.
// `tipo`: "pie" ou "donut". Devolve a instância (para destruir/atualizar).
function render3DPie(containerId, labels, valores, opts = {}) {
  const host = document.getElementById(containerId)
  if (!host) return null
  host.innerHTML = ""
  if (!window.ApexCharts || !labels.length) {
    host.innerHTML = `<div class="empty-state"><i class="fas fa-circle-info"></i><h3>Sem dados</h3><p>${opts.emptyMessage || "Nada para exibir."}</p></div>`
    return null
  }
  const PALETA = opts.cores || [
    "#1B2A4E", "#3B5BA5", "#5B9BD5", "#9DC3E6",
    "#2F86C9", "#57C7E0", "#D69A1F", "#C0392B",
    "#7E57C2", "#F0A35E"
  ]
  const isDonut = (opts.tipo || "pie") === "donut"
  const options = {
    chart: {
      type: isDonut ? "donut" : "pie",
      height: opts.height || 360,
      fontFamily: "Manrope, sans-serif",
      // Sombra forte + filtro de borda dá perspectiva 3D em SVG
      dropShadow: {
        enabled: true,
        top: 6,
        left: 0,
        blur: 12,
        color: "#000",
        opacity: 0.28
      },
      animations: { enabled: true, speed: 600 }
    },
    series: valores,
    labels,
    colors: PALETA,
    stroke: { width: 2, colors: ["#fff"] },
    plotOptions: {
      pie: {
        // Efeito de "perspectiva" via offset Y e ampliação
        offsetY: 6,
        expandOnClick: true,
        startAngle: -90,
        endAngle: 270,
        customScale: 0.92,
        donut: isDonut ? { size: "55%", labels: { show: false } } : undefined,
        dataLabels: {
          offset: -8,
          minAngleToShowLabel: 12
        }
      }
    },
    dataLabels: {
      enabled: true,
      style: { fontSize: "13px", fontWeight: 700, colors: ["#fff"] },
      dropShadow: { enabled: true, blur: 3, opacity: 0.6 },
      formatter: (val) => `${val.toFixed(1).replace(".", ",")}%`
    },
    legend: {
      position: opts.legendPosition || "right",
      fontSize: "12px",
      labels: { colors: "#1B2A4E" },
      itemMargin: { horizontal: 4, vertical: 3 }
    },
    tooltip: {
      y: {
        formatter: (val, { seriesIndex, w }) => {
          const total = w.config.series.reduce((a, b) => a + b, 0)
          const pct = total ? ((val / total) * 100).toFixed(1).replace(".", ",") : "0,0"
          return `${val} (${pct}%)`
        }
      }
    },
    responsive: [{
      breakpoint: 768,
      options: { legend: { position: "bottom" } }
    }]
  }
  const chart = new window.ApexCharts(host, options)
  chart.render()
  return chart
}

// Donut 3D padronizado de presença consolidada.
function render3DDonutPresenca(containerId, presentes, ausentes) {
  return render3DPie(containerId, ["Presentes", "Ausentes"], [presentes, ausentes], {
    tipo: "donut",
    cores: ["#5AA9E6", "#C0392B"],
    height: 340,
    legendPosition: "bottom",
    emptyMessage: "Sem dados de presença consolidada."
  })
}

// Paleta institucional do Modelo.docx (azuis Pedro Leopoldo)
const MODELO_CHART = {
  navy: "#1F3864",
  blue: "#4472C4",
  blueMid: "#5B9BD5",
  blueLight: "#9DC3E6",
  blueLighter: "#BDD7EE",
  bgSoft: "#F7FAFD",
  grid: "#E1E7EF",
  text: "#1F3864",
  textMuted: "#5A6B85",
  font: "Calibri, 'Carlito', Arial, sans-serif"
}

// Devolve cores para barras "graded" - valores menores recebem tons mais claros,
// valores maiores recebem azul-marinho, exatamente como no Modelo.
function modeloGradedColors(values) {
  if (!values.length) return []
  const max = Math.max(...values)
  return values.map(v => {
    if (max <= 0) return MODELO_CHART.blueLight
    const r = v / max
    if (r >= 0.75) return MODELO_CHART.navy
    if (r >= 0.5) return MODELO_CHART.blue
    if (r >= 0.25) return MODELO_CHART.blueMid
    return MODELO_CHART.blueLighter
  })
}

// Carrega o brasão de Pedro Leopoldo (assets/img/brasao.png) como data URL,
// com a razão de aspecto natural. Usado no cabeçalho dos relatórios gerados.
let _brasaoCache = null
async function loadBrasao() {
  if (_brasaoCache !== null) return _brasaoCache
  try {
    const r = await fetch("assets/img/brasao.png")
    const blob = await r.blob()
    const dataUrl = await new Promise((res, rej) => {
      const fr = new FileReader()
      fr.onload = () => res(fr.result)
      fr.onerror = rej
      fr.readAsDataURL(blob)
    })
    const ratio = await new Promise(res => {
      const im = new Image()
      im.onload = () => res(im.naturalWidth / im.naturalHeight || 942 / 634)
      im.onerror = () => res(942 / 634)
      im.src = dataUrl
    })
    _brasaoCache = { dataUrl, ratio }
  } catch (e) {
    _brasaoCache = false // marca como tentado-e-falhou; cabeçalho cai p/ só texto
  }
  return _brasaoCache
}

// Agrupa respostas IDÊNTICAS sem alterar o texto. A normalização (minúsculas +
// colapso de espaços) serve APENAS para comparar; o rótulo guarda o texto
// original (verbatim) da primeira ocorrência. Não reescreve, não lematiza e não
// interpreta nada. Devolve [{ label, value }] ordenado por frequência desc.
function groupIdenticalResponses(responses) {
  const map = new Map()
  ;(responses || []).forEach(r => {
    const text = String(r || "").trim()
    if (!text) return
    const key = text.toLowerCase().replace(/\s+/g, " ")
    const hit = map.get(key)
    if (hit) hit.value += 1
    else map.set(key, { label: text, value: 1 })
  })
  return [...map.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
}

// Quebra um texto em até `maxLines` linhas de ~`max` chars para caber como
// rótulo do eixo Y do gráfico. Só afeta a EXIBIÇÃO no gráfico; a resposta segue
// íntegra na lista verbatim logo abaixo (o "…" sinaliza que foi cortada só ali).
function wrapChartLabel(txt, max = 42, maxLines = 3) {
  const words = String(txt).split(/\s+/)
  const lines = [""]
  words.forEach(w => {
    if ((lines[lines.length - 1] + " " + w).trim().length > max) lines.push(w)
    else lines[lines.length - 1] = (lines[lines.length - 1] + " " + w).trim()
  })
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    kept[maxLines - 1] = kept[maxLines - 1] + "…"
    return kept
  }
  return lines
}

// Gráfico de barras horizontais das respostas que se REPETEM (2+ idênticas).
// O rótulo de cada barra é a própria resposta (verbatim). Devolve null quando
// nenhuma resposta se repete.
async function renderRespostasRepetidasChart(titulo, repetidas, canvasW, canvasH) {
  if (!repetidas.length) return null
  const vals = repetidas.map(g => g.value)
  return renderChartToImage(
    "bar",
    {
      data: {
        labels: repetidas.map(g => wrapChartLabel(g.label)),
        datasets: [{ data: vals, backgroundColor: modeloGradedColors(vals), borderWidth: 0, barPercentage: 0.72, categoryPercentage: 0.78 }]
      },
      options: {
        indexAxis: "y",
        scales: {
          x: {
            beginAtZero: true,
            suggestedMax: Math.max(...vals) + 1,
            title: { display: true, text: "Nº de respostas iguais", font: { family: MODELO_CHART.font, size: 13, weight: "600" }, color: MODELO_CHART.text },
            ticks: { stepSize: 1, precision: 0, font: { family: MODELO_CHART.font, size: 12 }, color: MODELO_CHART.textMuted },
            grid: { color: MODELO_CHART.grid, drawBorder: false }
          },
          y: { ticks: { font: { family: MODELO_CHART.font, size: 11 }, color: MODELO_CHART.text }, grid: { display: false, drawBorder: false } }
        },
        plugins: {
          legend: { display: false },
          title: { display: true, text: titulo, font: { size: 15, weight: "bold", family: MODELO_CHART.font }, color: MODELO_CHART.navy, padding: { bottom: 14 } },
          datalabels: { anchor: "end", align: "end", offset: 6, font: { weight: "bold", size: 13, family: MODELO_CHART.font }, color: MODELO_CHART.navy, formatter: v => v }
        }
      }
    },
    canvasW,
    canvasH
  )
}

async function generateSatisfacaoPdf() {
  const s = state.autoReport
  const status = document.getElementById("arStatus")
  status.className = "auto-report-status"
  status.textContent = "Validando dados..."

  if (!s.participantes) {
    status.classList.add("is-error")
    status.textContent = "Faça upload da planilha de participantes."
    return
  }
  if (!s.pesquisa) {
    status.classList.add("is-error")
    status.textContent = "Faça upload da pesquisa de satisfação."
    return
  }

  // Tudo extraído da planilha de participantes
  const evento = s.participantes.evento
  const cap = s.participantes.capacidade
  const intro = `O presente relatório tem por finalidade apresentar a análise do evento "${evento}", promovido pela ${AR_CONFIG.orgao}.\n\nOs gráficos e indicadores apresentados nas seções subsequentes fornecem subsídios estratégicos para a compreensão do nível de engajamento, da qualidade percebida pelos participantes e das perspectivas de aprimoramento, permitindo à gestão pública delinear ações futuras com maior assertividade e aderência às demandas identificadas.`

  status.classList.remove("is-error")
  status.textContent = "Gerando gráficos..."

  const { jsPDF } = window.jspdf
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const M = 20 // margem
  const W = pageW - M * 2
  let y = 0
  let pageNum = 0
  let brasaoImg = null

  const drawHeader = () => {
    pageNum += 1
    let topY = 14
    // Brasão de Pedro Leopoldo centralizado no topo (como no relatório-modelo).
    if (brasaoImg) {
      const h = 13 // mm de altura
      const w = h * brasaoImg.ratio
      doc.addImage(brasaoImg.dataUrl, "PNG", (pageW - w) / 2, 7, w, h)
      topY = 7 + h + 3.5
    }
    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    doc.setTextColor(22, 31, 54)
    doc.text("PREFEITURA MUNICIPAL DE PEDRO LEOPOLDO", pageW / 2, topY, { align: "center" })
    doc.setFontSize(9)
    doc.text("SECRETARIA MUNICIPAL DE GESTÃO E FINANÇAS", pageW / 2, topY + 4.5, { align: "center" })
    doc.setFont("helvetica", "normal")
    doc.text("DIRETORIA DE GESTÃO DE PESSOAS", pageW / 2, topY + 9, { align: "center" })
    doc.setDrawColor(48, 99, 173)
    doc.setLineWidth(0.5)
    const lineY = topY + 12.5
    doc.line(M, lineY, pageW - M, lineY)
    y = lineY + 8
  }

  const drawFooter = () => {
    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.setTextColor(120, 120, 120)
    doc.text(String(pageNum), pageW / 2, pageH - 10, { align: "center" })
  }

  const newPage = () => {
    drawFooter()
    doc.addPage()
    drawHeader()
  }

  const ensureSpace = needed => {
    if (y + needed > pageH - 18) newPage()
  }

  const justified = (text, lineHeight = 5.2) => {
    doc.setFont("helvetica", "normal")
    doc.setFontSize(10.5)
    doc.setTextColor(40, 40, 40)
    const lines = doc.splitTextToSize(text, W)
    lines.forEach(ln => {
      ensureSpace(lineHeight + 1)
      doc.text(ln, M, y)
      y += lineHeight
    })
    y += 2
  }

  const sectionTitle = txt => {
    ensureSpace(12)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(12)
    doc.setTextColor(22, 31, 54)
    doc.text(txt, M, y)
    y += 7
  }

  const bullet = (txt, marker = "➢") => {
    doc.setFont("helvetica", "normal")
    doc.setFontSize(10.5)
    doc.setTextColor(40, 40, 40)
    const lines = doc.splitTextToSize(txt, W - 8)
    ensureSpace(lines.length * 5.2 + 1)
    doc.setFont("helvetica", "bold")
    doc.text(marker, M, y)
    doc.setFont("helvetica", "normal")
    lines.forEach((ln, i) => {
      doc.text(ln, M + 6, y)
      if (i < lines.length - 1) y += 5.2
    })
    y += 6
  }

  // ===== PÁGINA 1: capa + Gráfico 1 =====
  brasaoImg = await loadBrasao()
  drawHeader()
  doc.setFont("helvetica", "bold")
  doc.setFontSize(15)
  doc.setTextColor(22, 31, 54)
  doc.text(`Relatório - Evento ${evento}`, M, y)
  y += 9
  justified(intro)

  // Gráfico 1: participação no evento (vertical bars, padrão Modelo)
  status.textContent = "Renderizando Gráfico 1..."
  const inscritos = s.participantes.totalInscritos
  const presentes = s.participantes.totalPresentes
  const ausentes = s.participantes.totalAusentes
  const naoAdquiridos = cap - inscritos
  const taxaPresenca = ((presentes / inscritos) * 100).toFixed(1)

  const g1Img = await renderChartToImage(
    "bar",
    {
      data: {
        labels: ["Ingressos Disponibilizados", "Ingressos Adquiridos", "Presentes"],
        datasets: [
          {
            data: [cap, inscritos, presentes],
            backgroundColor: [MODELO_CHART.navy, MODELO_CHART.blueMid, MODELO_CHART.blueLighter],
            borderWidth: 0,
            barPercentage: 0.65,
            categoryPercentage: 0.7
          }
        ]
      },
      options: {
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: "Quantidade", font: { family: MODELO_CHART.font, size: 13, weight: "600" }, color: MODELO_CHART.text },
            ticks: { font: { family: MODELO_CHART.font, size: 12 }, color: MODELO_CHART.textMuted, precision: 0 },
            grid: { color: MODELO_CHART.grid, drawBorder: false }
          },
          x: {
            ticks: { font: { family: MODELO_CHART.font, size: 12 }, color: MODELO_CHART.text, maxRotation: 0, autoSkip: false },
            grid: { display: false, drawBorder: false }
          }
        },
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: "Gráfico 1 - Participação no Evento",
            font: { size: 16, weight: "bold", family: MODELO_CHART.font },
            color: MODELO_CHART.navy,
            padding: { bottom: 16 }
          },
          datalabels: {
            anchor: "end",
            align: "top",
            font: { weight: "bold", size: 14, family: MODELO_CHART.font },
            color: MODELO_CHART.navy,
            formatter: v => v
          }
        }
      }
    },
    900,
    520
  )

  ensureSpace(120)
  doc.addImage(g1Img, "PNG", M + 10, y, W - 20, 105)
  y += 110

  justified(`O gráfico acima apresenta a consolidação das presenças confirmadas no evento.`)
  justified(
    `Foram disponibilizados ${cap} ingressos. Destes, ${inscritos} foram adquiridos e ${naoAdquiridos} não foram retirados. Dos participantes inscritos, ${presentes} estiveram presentes e ${ausentes} não compareceram.`
  )
  justified(
    `Sob a perspectiva dos ingressos adquiridos, a taxa de presença alcança ${taxaPresenca.replace(".", ",")}% (${presentes}/${inscritos}). O formulário de satisfação recebeu ${s.pesquisa.respostas} respostas.`
  )

  // ===== PÁGINA 2: Gráfico 2 - médias =====
  newPage()
  status.textContent = "Renderizando Gráfico 2..."
  const criterios = s.pesquisa.criterios || []
  if (!criterios.length) throw new Error("Nenhum critério numérico (escala 1-5) encontrado na pesquisa.")

  // Quebra rótulos longos em até 3 linhas para o gráfico de barras
  const wrapLabel = (txt, max = 16) => {
    const words = txt.split(/\s+/)
    const lines = [""]
    words.forEach(w => {
      if ((lines[lines.length - 1] + " " + w).trim().length > max) lines.push(w)
      else lines[lines.length - 1] = (lines[lines.length - 1] + " " + w).trim()
    })
    return lines.slice(0, 3)
  }

  const mediaValues = criterios.map(c => Number(c.media.toFixed(2)))
  const g2Img = await renderChartToImage(
    "bar",
    {
      data: {
        labels: criterios.map(c => wrapLabel(c.label, 22)),
        datasets: [
          {
            label: "Média (escala 1-5)",
            data: mediaValues,
            backgroundColor: modeloGradedColors(mediaValues),
            borderWidth: 0,
            barPercentage: 0.7,
            categoryPercentage: 0.75
          }
        ]
      },
      options: {
        indexAxis: "y",
        scales: {
          x: {
            beginAtZero: true,
            max: 5,
            title: { display: true, text: "Média (escala 1-5)", font: { family: MODELO_CHART.font, size: 13, weight: "600" }, color: MODELO_CHART.text },
            ticks: { stepSize: 1, font: { family: MODELO_CHART.font, size: 12 }, color: MODELO_CHART.textMuted },
            grid: { color: MODELO_CHART.grid, drawBorder: false }
          },
          y: {
            ticks: { font: { family: MODELO_CHART.font, size: 12 }, color: MODELO_CHART.text },
            grid: { display: false, drawBorder: false }
          }
        },
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: "Gráfico 2 - Médias das Avaliações",
            font: { size: 16, weight: "bold", family: MODELO_CHART.font },
            color: MODELO_CHART.navy,
            padding: { bottom: 16 }
          },
          datalabels: {
            anchor: "end",
            align: "end",
            offset: 6,
            font: { weight: "bold", size: 13, family: MODELO_CHART.font },
            color: MODELO_CHART.navy,
            formatter: v => Number(v).toFixed(2).replace(".", ",")
          }
        }
      }
    },
    900,
    Math.max(360, 90 + criterios.length * 60)
  )
  const g2H = Math.min(120, 40 + criterios.length * 14)
  ensureSpace(g2H + 8)
  doc.addImage(g2Img, "PNG", M, y, W, g2H)
  y += g2H + 6

  const respostas = s.pesquisa.respostas
  justified(
    `Foram coletadas ${respostas} respostas ao formulário de satisfação. As avaliações apresentam médias elevadas nos critérios analisados (escala de 1 a 5):`
  )
  criterios.forEach(c => {
    bullet(`${c.label}: média de ${c.media.toFixed(2).replace(".", ",")};`)
  })

  // Tabela Nota 4 / Nota 5 - dinâmica para todos os critérios
  ensureSpace(40)
  const buildRow = (label, n) => {
    const t = Math.max(n.total, 1)
    const p4 = n[4] ? ` (${((n[4] / t) * 100).toFixed(1).replace(".", ",")}%)` : ""
    const p5 = n[5] ? ` (${((n[5] / t) * 100).toFixed(1).replace(".", ",")}%)` : ""
    return [label, `${n[4]}${p4}`, `${n[5]}${p5}`]
  }
  doc.autoTable({
    startY: y,
    head: [["Critério", "Nota 4", "Nota 5"]],
    body: criterios.map(c => buildRow(c.label, c.dist)),
    styles: { fontSize: 10, cellPadding: 3 },
    headStyles: { fillColor: [48, 99, 173], textColor: 255 },
    margin: { left: M, right: M }
  })
  y = doc.lastAutoTable.finalY + 6

  // Análise: usa critério "recomend*" se existir, senão usa o de maior média
  const destaque = s.pesquisa.recomendacao || criterios.reduce((a, b) => (a.media >= b.media ? a : b))
  const destPct = ((destaque.dist[5] / Math.max(destaque.dist.total, 1)) * 100).toFixed(1).replace(".", ",")
  justified(
    `A uniformidade dos resultados indica satisfação elevada e consistente do público em todos os aspectos avaliados. O critério "${destaque.label}" obteve ${destPct}% de notas máximas, reforçando a percepção positiva da iniciativa.`
  )

  // ===== PÁGINAS 3-5: respostas abertas (na íntegra, sem reprocessamento) =====
  // As respostas do formulário já vêm tratadas da etapa anterior. Aqui apenas
  // listamos verbatim cada resposta registrada - sem agrupar, sem reescrever em
  // rótulos e sem contabilizar "menções". Fidelidade total ao que foi escrito.
  status.textContent = "Listando respostas abertas..."
  const listarAbertas = async (titulo, arr) => {
    const itens = (arr || []).map(t => String(t || "").trim()).filter(Boolean)
    if (!itens.length) return
    ensureSpace(20)
    sectionTitle(titulo)
    // Agrupa respostas IDÊNTICAS (sem alterar o texto) e plota só as que se
    // repetem (2+). A lista completa verbatim vem logo abaixo — nada é omitido.
    const repetidas = groupIdenticalResponses(itens).filter(g => g.value >= 2)
    if (repetidas.length) {
      const canvasH = Math.max(300, 120 + repetidas.length * 56)
      const chartImg = await renderRespostasRepetidasChart(titulo, repetidas, 900, canvasH)
      if (chartImg) {
        const chH = (W * canvasH) / 900 // mantém a proporção do canvas
        ensureSpace(chH + 6)
        doc.addImage(chartImg, "PNG", M, y, W, chH)
        y += chH + 4
        justified(
          `O gráfico acima mostra as respostas que se repetiram (${repetidas.length} ${repetidas.length === 1 ? "resposta idêntica citada" : "respostas idênticas citadas"} por mais de um participante).`
        )
      }
    }
    justified(`${itens.length} ${itens.length === 1 ? "resposta registrada" : "respostas registradas"} (na íntegra):`)
    itens.forEach(t => bullet(`"${t}"`, "•"))
  }
  await listarAbertas("Pontos Altos da Capacitação", s.pesquisa.textos.altos)
  await listarAbertas("O que pode ser melhorado", s.pesquisa.textos.melhorias)
  await listarAbertas("Sugestões de Temas para as Próximas Ações", s.pesquisa.textos.sugestoes)

  // ===== COMENTÁRIOS =====
  // Apenas a coluna de comentários/observações gerais, se existir, na íntegra.
  // Não recolhe respostas das outras colunas (já listadas acima).
  const comentarios = (s.pesquisa.textos.comentarios || []).map(t => String(t || "").trim()).filter(Boolean)
  if (comentarios.length) {
    ensureSpace(20)
    sectionTitle("Comentários e Observações dos Participantes")
    justified("Comentários livres registrados no formulário:")
    comentarios.forEach(c => bullet(`"${c}"`, "•"))
  }

  // ===== CONCLUSÃO (gerada automaticamente das métricas) =====
  newPage()
  sectionTitle("Conclusão")
  const minMedia = criterios.length ? Math.min(...criterios.map(c => c.media)) : 5
  const conclusaoAuto = `Com base na pesquisa de satisfação aplicada ao público-alvo, os dados evidenciam que o evento alcançou elevado nível de aprovação, com médias superiores a ${minMedia.toFixed(2).replace(".", ",")} em todos os ${criterios.length} critérios avaliados (escala de 1 a 5). A taxa de presença de ${taxaPresenca.replace(".", ",")}% das inscrições reforça o engajamento do público com a iniciativa.`
  justified(conclusaoAuto)

  justified(
    `Conclui-se que a iniciativa cumpriu seu objetivo de promover um espaço de valorização, troca e formação para os servidores municipais, consolidando-se como ação estratégica da ${AR_CONFIG.orgao}. A continuidade e a institucionalização desse tipo de evento são fortemente recomendadas.`
  )

  // Assinatura (apenas cargo institucional - sem nome digitado)
  y += 24
  ensureSpace(20)
  // linha para assinatura manuscrita
  doc.setDrawColor(100, 100, 100)
  doc.setLineWidth(0.3)
  doc.line(pageW / 2 - 40, y, pageW / 2 + 40, y)
  y += 5
  doc.setFont("helvetica", "bold")
  doc.setFontSize(10)
  doc.setTextColor(22, 31, 54)
  doc.text(AR_CONFIG.assinaturaCargo, pageW / 2, y, { align: "center" })

  drawFooter()
  const slug = (evento || "evento")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  doc.save(`Relatorio Satisfacao - ${slug}.pdf`)

  status.classList.add("is-success")
  status.textContent = `Relatório "${evento}" gerado!`
}

// ---------------- Geração do DOCX ----------------
function dataUrlToUint8(dataUrl) {
  const base64 = dataUrl.split(",")[1]
  const bin = atob(base64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}

async function generateSatisfacaoDocx() {
  const s = state.autoReport
  const status = document.getElementById("arStatus")
  status.className = "auto-report-status"

  if (!s.participantes) {
    status.classList.add("is-error")
    status.textContent = "Faça upload da planilha de participantes."
    return
  }
  if (!s.pesquisa) {
    status.classList.add("is-error")
    status.textContent = "Faça upload da pesquisa de satisfação."
    return
  }
  if (!window.docx) {
    status.classList.add("is-error")
    status.textContent = "Biblioteca docx não carregou. Recarregue a página."
    return
  }

  status.classList.remove("is-error")
  status.textContent = "Gerando DOCX..."

  const D = window.docx
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    ImageRun,
    HeadingLevel,
    AlignmentType,
    Table,
    TableRow,
    TableCell,
    BorderStyle,
    WidthType,
    PageNumber,
    Header,
    Footer,
    PageBreak,
    HorizontalPositionAlign,
    HorizontalPositionRelativeFrom,
    VerticalPositionRelativeFrom,
    TextWrappingType
  } = D

  const evento = s.participantes.evento
  const cap = s.participantes.capacidade
  const inscritos = s.participantes.totalInscritos
  const presentes = s.participantes.totalPresentes
  const ausentes = s.participantes.totalAusentes
  const naoAdquiridos = cap - inscritos
  const taxaPresenca = ((presentes / inscritos) * 100).toFixed(1).replace(".", ",")
  const criterios = s.pesquisa.criterios || []
  if (!criterios.length) {
    status.classList.add("is-error")
    status.textContent = "Pesquisa sem critérios numéricos detectados."
    return
  }
  const respostas = s.pesquisa.respostas
  const destaque = s.pesquisa.recomendacao || criterios.reduce((a, b) => (a.media >= b.media ? a : b))
  const destPct = ((destaque.dist[5] / Math.max(destaque.dist.total, 1)) * 100).toFixed(1).replace(".", ",")
  const minMedia = Math.min(...criterios.map(c => c.media))
  // Renderiza Charts em PNG (paleta institucional do Modelo)
  status.textContent = "Renderizando Gráfico 1..."
  const g1 = await renderChartToImage(
    "bar",
    {
      data: {
        labels: ["Ingressos Disponibilizados", "Ingressos Adquiridos", "Presentes"],
        datasets: [
          {
            data: [cap, inscritos, presentes],
            backgroundColor: [MODELO_CHART.navy, MODELO_CHART.blueMid, MODELO_CHART.blueLighter],
            borderWidth: 0,
            barPercentage: 0.65,
            categoryPercentage: 0.7
          }
        ]
      },
      options: {
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: "Quantidade", font: { family: MODELO_CHART.font, size: 13, weight: "600" }, color: MODELO_CHART.text },
            ticks: { font: { family: MODELO_CHART.font, size: 12 }, color: MODELO_CHART.textMuted, precision: 0 },
            grid: { color: MODELO_CHART.grid, drawBorder: false }
          },
          x: {
            ticks: { font: { family: MODELO_CHART.font, size: 12 }, color: MODELO_CHART.text, maxRotation: 0, autoSkip: false },
            grid: { display: false, drawBorder: false }
          }
        },
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: "Gráfico 1 - Participação no Evento",
            font: { size: 16, weight: "bold", family: MODELO_CHART.font },
            color: MODELO_CHART.navy,
            padding: { bottom: 16 }
          },
          datalabels: {
            anchor: "end",
            align: "top",
            font: { weight: "bold", size: 14, family: MODELO_CHART.font },
            color: MODELO_CHART.navy,
            formatter: v => v
          }
        }
      }
    },
    900,
    520
  )

  status.textContent = "Renderizando Gráfico 2..."
  const wrapLabel = (txt, max = 16) => {
    const words = txt.split(/\s+/)
    const lines = [""]
    words.forEach(w => {
      if ((lines[lines.length - 1] + " " + w).trim().length > max) lines.push(w)
      else lines[lines.length - 1] = (lines[lines.length - 1] + " " + w).trim()
    })
    return lines.slice(0, 3)
  }
  const mediaValuesDocx = criterios.map(c => Number(c.media.toFixed(2)))
  const g2 = await renderChartToImage(
    "bar",
    {
      data: {
        labels: criterios.map(c => wrapLabel(c.label, 22)),
        datasets: [
          {
            label: "Média (escala 1-5)",
            data: mediaValuesDocx,
            backgroundColor: modeloGradedColors(mediaValuesDocx),
            borderWidth: 0,
            barPercentage: 0.7,
            categoryPercentage: 0.75
          }
        ]
      },
      options: {
        indexAxis: "y",
        scales: {
          x: {
            beginAtZero: true,
            max: 5,
            title: { display: true, text: "Média (escala 1-5)", font: { family: MODELO_CHART.font, size: 13, weight: "600" }, color: MODELO_CHART.text },
            ticks: { stepSize: 1, font: { family: MODELO_CHART.font, size: 12 }, color: MODELO_CHART.textMuted },
            grid: { color: MODELO_CHART.grid, drawBorder: false }
          },
          y: {
            ticks: { font: { family: MODELO_CHART.font, size: 12 }, color: MODELO_CHART.text },
            grid: { display: false, drawBorder: false }
          }
        },
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: "Gráfico 2 - Médias das Avaliações",
            font: { size: 16, weight: "bold", family: MODELO_CHART.font },
            color: MODELO_CHART.navy,
            padding: { bottom: 16 }
          },
          datalabels: {
            anchor: "end",
            align: "end",
            offset: 6,
            font: { weight: "bold", size: 13, family: MODELO_CHART.font },
            color: MODELO_CHART.navy,
            formatter: v => Number(v).toFixed(2).replace(".", ",")
          }
        }
      }
    },
    900,
    Math.max(360, 90 + criterios.length * 60)
  )

  status.textContent = "Montando documento Word..."

  // Helpers
  const para = (text, opts = {}) =>
    new Paragraph({
      spacing: { before: 80, after: 100, line: 320 },
      alignment: opts.align || AlignmentType.JUSTIFIED,
      children: [new TextRun({ text, bold: opts.bold, size: opts.size || 22, color: opts.color || "1F2A48", italics: opts.italic })]
    })
  const heading = text =>
    new Paragraph({
      spacing: { before: 240, after: 120 },
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text, bold: true, size: 26, color: "161F36" })]
    })
  const bullet = (text, marker = "➢") =>
    new Paragraph({
      spacing: { before: 40, after: 60 },
      indent: { left: 360 },
      children: [new TextRun({ text: `${marker}  `, bold: true, size: 22 }), new TextRun({ text, size: 22, color: "1F2A48" })]
    })
  const imgPara = (dataUrl, w, h) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 120 },
      children: [new ImageRun({ data: dataUrlToUint8(dataUrl), transformation: { width: w, height: h } })]
    })
  const titleSection = text =>
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 200, after: 160 },
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text, bold: true, size: 32, color: "161F36" })]
    })

  // Tabela Nota 4 / Nota 5
  const cellTxt = (txt, opts = {}) =>
    new TableCell({
      width: { size: opts.size || 33, type: WidthType.PERCENTAGE },
      shading: opts.shading ? { fill: opts.shading } : undefined,
      children: [
        new Paragraph({
          alignment: opts.align || AlignmentType.LEFT,
          children: [new TextRun({ text: txt, bold: opts.bold, color: opts.color || "1F2A48", size: 22 })]
        })
      ]
    })
  const fmtCount = (n, total) => {
    const pct = total ? ` (${((n / total) * 100).toFixed(1).replace(".", ",")}%)` : ""
    return `${n}${pct}`
  }
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      cellTxt("Critério", { shading: "3063AD", color: "FFFFFF", bold: true }),
      cellTxt("Nota 4", { shading: "3063AD", color: "FFFFFF", bold: true, align: AlignmentType.CENTER }),
      cellTxt("Nota 5", { shading: "3063AD", color: "FFFFFF", bold: true, align: AlignmentType.CENTER })
    ]
  })
  const dataRows = criterios.map(
    c =>
      new TableRow({
        children: [
          cellTxt(c.label),
          cellTxt(fmtCount(c.dist[4], c.dist.total), { align: AlignmentType.CENTER }),
          cellTxt(fmtCount(c.dist[5], c.dist.total), { align: AlignmentType.CENTER })
        ]
      })
  )
  const tabelaNotas = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows]
  })

  // Header e Footer institucionais.
  // Layout fiel ao "Relatorio Satisfacao - Dia Internacional da Mulher.docx":
  // brasão FLUTUANTE à esquerda + 3 linhas de texto centralizadas e em negrito,
  // com tamanhos decrescentes (16pt / 14pt / 12pt).
  const brasaoImg = await loadBrasao()
  const headerChildren = []
  const cabSizes = [32, 28, 24] // half-points: 16pt, 14pt, 12pt
  AR_CONFIG.cabecalho.forEach((t, i) => {
    const runs = [new TextRun({ text: t, bold: true, size: cabSizes[i] || 22, color: "161F36" })]
    // O brasão é ancorado (flutuante) na PRIMEIRA linha, fixado à esquerda da
    // coluna; o texto segue centralizado por cima, como no modelo.
    if (i === 0 && brasaoImg) {
      const bh = 54 // px de altura do brasão no cabeçalho
      runs.unshift(
        new ImageRun({
          data: dataUrlToUint8(brasaoImg.dataUrl),
          transformation: { width: Math.round(bh * brasaoImg.ratio), height: bh },
          floating: {
            horizontalPosition: { relative: HorizontalPositionRelativeFrom.COLUMN, align: HorizontalPositionAlign.LEFT },
            verticalPosition: { relative: VerticalPositionRelativeFrom.PARAGRAPH, offset: -150000 },
            wrap: { type: TextWrappingType.NONE },
            allowOverlap: true
          }
        })
      )
    }
    headerChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
        children: runs
      })
    )
  })
  const headerInst = new Header({ children: headerChildren })
  const footerInst = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "888888" })]
      })
    ]
  })

  // Conteúdo
  const children = []
  children.push(titleSection(`Relatório - Evento ${evento}`))
  para(`O presente relatório tem por finalidade apresentar a análise do evento "${evento}", promovido pela ${AR_CONFIG.orgao}.`).children &&
    children.push(para(`O presente relatório tem por finalidade apresentar a análise do evento "${evento}", promovido pela ${AR_CONFIG.orgao}.`))
  children.push(
    para(
      `Os gráficos e indicadores apresentados nas seções subsequentes fornecem subsídios estratégicos para a compreensão do nível de engajamento, da qualidade percebida pelos participantes e das perspectivas de aprimoramento, permitindo à gestão pública delinear ações futuras com maior assertividade e aderência às demandas identificadas.`
    )
  )

  children.push(imgPara(g1, 480, 320))
  children.push(para("O gráfico acima apresenta a consolidação das presenças confirmadas no evento."))
  children.push(
    para(
      `Foram disponibilizados ${cap} ingressos. Destes, ${inscritos} foram adquiridos e ${naoAdquiridos} não foram retirados. Dos participantes inscritos, ${presentes} estiveram presentes e ${ausentes} não compareceram.`
    )
  )
  children.push(
    para(
      `Sob a perspectiva dos ingressos adquiridos, a taxa de presença alcança ${taxaPresenca}% (${presentes}/${inscritos}). O formulário de satisfação recebeu ${respostas} respostas.`
    )
  )

  // Gráfico 2
  children.push(new Paragraph({ children: [new PageBreak()] }))
  children.push(imgPara(g2, 540, 320))
  children.push(
    para(
      `Foram coletadas ${respostas} respostas ao formulário de satisfação. As avaliações apresentam médias elevadas nos critérios analisados (escala de 1 a 5):`
    )
  )
  criterios.forEach(c => children.push(bullet(`${c.label}: média de ${c.media.toFixed(2).replace(".", ",")};`)))
  children.push(tabelaNotas)
  children.push(
    para(
      `A uniformidade dos resultados indica satisfação elevada e consistente do público em todos os aspectos avaliados. O critério "${destaque.label}" obteve ${destPct}% de notas máximas, reforçando a percepção positiva da iniciativa.`
    )
  )

  // Respostas abertas → GRÁFICO DE BARRA dos temas (igual ao modelo
  // "Relatorio Satisfacao - Dia Internacional da Mulher.docx"): cada seção tem
  // um gráfico de barras com os temas agrupados e o nº de menções, seguido de um
  // parágrafo analítico montado a partir dos próprios dados (sem inventar texto).
  const mencao = n => (n === 1 ? "menção" : "menções")
  const listaMencoes = cats => cats.map(c => `${c.label} (${c.value} ${mencao(c.value)})`).join(", ").replace(/, ([^,]*)$/, " e $1")

  // Gera o gráfico de barras horizontais de um conjunto de temas, no mesmo
  // estilo do PPTX/PDF (eixo "Nº de menções", barras "graded", rótulos navy).
  const renderTemaChart = async (titulo, cats) => {
    if (!cats.length) return null
    const vals = cats.map(c => c.value)
    return renderChartToImage("bar", {
      data: { labels: cats.map(c => c.label), datasets: [{ data: vals, backgroundColor: modeloGradedColors(vals), borderWidth: 0, barPercentage: 0.72, categoryPercentage: 0.78 }] },
      options: {
        indexAxis: "y",
        scales: {
          x: { beginAtZero: true, suggestedMax: Math.max(...vals) + 1, title: { display: true, text: "Nº de menções", font: { family: MODELO_CHART.font, size: 13, weight: "600" }, color: MODELO_CHART.text }, ticks: { stepSize: 1, precision: 0, font: { family: MODELO_CHART.font, size: 12 }, color: MODELO_CHART.textMuted }, grid: { color: MODELO_CHART.grid, drawBorder: false } },
          y: { ticks: { font: { family: MODELO_CHART.font, size: 12 }, color: MODELO_CHART.text }, grid: { display: false, drawBorder: false } }
        },
        plugins: {
          legend: { display: false },
          title: { display: true, text: titulo, font: { size: 18, weight: "bold", family: MODELO_CHART.font }, color: MODELO_CHART.navy, padding: { bottom: 18 } },
          datalabels: { anchor: "end", align: "end", offset: 6, font: { weight: "bold", size: 14, family: MODELO_CHART.font }, color: MODELO_CHART.navy, formatter: v => v }
        }
      }
    }, 1200, Math.max(500, 140 + cats.length * 60))
  }

  // Monta uma seção de respostas abertas: heading "Gráfico N - ...", o gráfico
  // de barra e o parágrafo de análise. Sem chart (sem temas) → seção omitida.
  const secaoTemaDocx = async (numero, tituloGrafico, cats, analise) => {
    if (!cats.length) return
    const chartImg = await renderTemaChart(tituloGrafico, cats)
    if (!chartImg) return
    children.push(new Paragraph({ children: [new PageBreak()] }))
    children.push(heading(`Gráfico ${numero} - ${tituloGrafico}`))
    const canvasH = Math.max(500, 140 + cats.length * 60) // mesma altura do canvas
    const w = 560
    const h = Math.round((w * canvasH) / 1200) // mantém a proporção 1200×canvasH
    children.push(imgPara(chartImg, w, h))
    if (analise) children.push(para(analise))
  }

  const cAltos = s.pesquisa.temas?.altos || []
  const cMelhor = s.pesquisa.temas?.melhorias || []
  const cSugest = s.pesquisa.temas?.sugestoes || []

  const analiseAltos = cAltos.length
    ? `A análise qualitativa das respostas evidencia que os principais pontos altos do evento foram ${listaMencoes(cAltos.slice(0, 2))}, demonstrando a valorização do conteúdo e da abordagem da iniciativa pelos participantes.`
    : ""
  const analiseMelhor = cMelhor.length
    ? `A principal oportunidade de melhoria identificada foi ${cMelhor[0].label.toLowerCase()} (${cMelhor[0].value} ${mencao(cMelhor[0].value)})${cMelhor.length > 1 ? `, seguida de ${listaMencoes(cMelhor.slice(1, 3))}` : ""}, sinalizando caminhos para o aprimoramento de futuras edições.`
    : ""
  const analiseSugest = cSugest.length
    ? `A análise das sugestões evidencia maior interesse em ${listaMencoes(cSugest.slice(0, 3))} como temas para as próximas ações de capacitação.`
    : ""

  await secaoTemaDocx(3, "Principais Pontos Altos", cAltos, analiseAltos)
  await secaoTemaDocx(4, "O que pode ser melhorado?", cMelhor, analiseMelhor)
  await secaoTemaDocx(5, "Sugestões de Temas para as Próximas Ações", cSugest, analiseSugest)

  // Comentários: apenas a coluna de observações gerais, se existir, na íntegra
  const comentarios = (s.pesquisa.textos.comentarios || []).map(t => String(t || "").trim()).filter(Boolean)
  if (comentarios.length) {
    children.push(heading("Comentários e Observações dos Participantes"))
    children.push(para("Comentários livres registrados no formulário:"))
    comentarios.forEach(c => children.push(bullet(`"${c}"`, "•")))
  }

  // Conclusão
  children.push(new Paragraph({ children: [new PageBreak()] }))
  children.push(heading("Conclusão"))
  children.push(
    para(
      `Com base na pesquisa de satisfação aplicada ao público-alvo, os dados evidenciam que o evento alcançou elevado nível de aprovação, com médias superiores a ${minMedia.toFixed(2).replace(".", ",")} em todos os ${criterios.length} critérios avaliados (escala de 1 a 5). A taxa de presença de ${taxaPresenca}% das inscrições reforça o engajamento do público com a iniciativa.`
    )
  )
  children.push(
    para(
      `Conclui-se que a iniciativa cumpriu seu objetivo de promover um espaço de valorização, troca e formação para os servidores municipais, consolidando-se como ação estratégica da ${AR_CONFIG.orgao}. A continuidade e a institucionalização desse tipo de evento são fortemente recomendadas.`
    )
  )

  // Assinatura
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 600, after: 60 },
      border: { top: { style: BorderStyle.SINGLE, size: 6, color: "888888" } },
      children: [new TextRun({ text: "" })]
    })
  )
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [new TextRun({ text: AR_CONFIG.assinaturaCargo, bold: true, size: 22, color: "161F36" })]
    })
  )

  const docDoc = new Document({
    creator: "Escola de Governo - Pedro Leopoldo",
    title: `Relatório de Satisfação - ${evento}`,
    sections: [
      {
        properties: { page: { margin: { top: 1100, bottom: 1100, left: 1100, right: 1100 } } },
        headers: { default: headerInst },
        footers: { default: footerInst },
        children
      }
    ]
  })

  const blob = await Packer.toBlob(docDoc)
  const slug = (evento || "evento")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  window.saveAs(blob, `Relatorio Satisfacao - ${slug}.docx`)

  status.classList.add("is-success")
  status.textContent = `DOCX "${evento}" gerado!`
}

// ---------------- Geração do PPTX ----------------
async function generateSatisfacaoPptx() {
  const s = state.autoReport
  const status = document.getElementById("arStatus")
  status.className = "auto-report-status"
  if (!s.participantes) { status.classList.add("is-error"); status.textContent = "Faça upload da planilha de participantes."; return }
  if (!s.pesquisa) { status.classList.add("is-error"); status.textContent = "Faça upload da pesquisa de satisfação."; return }
  if (!window.PptxGenJS) { status.classList.add("is-error"); status.textContent = "Biblioteca PptxGenJS não carregou. Recarregue a página."; return }
  status.classList.remove("is-error")
  status.textContent = "Gerando apresentação..."

  const evento = s.participantes.evento
  const data = s.participantes.data || ""
  const local = s.participantes.local || ""
  const cap = s.participantes.capacidade
  const inscritos = s.participantes.totalInscritos
  const presentes = s.participantes.totalPresentes
  const ausentes = s.participantes.totalAusentes
  const naoAdquiridos = cap - inscritos
  const taxaPresenca = ((presentes / inscritos) * 100).toFixed(1).replace(".", ",")
  const criterios = s.pesquisa.criterios || []
  if (!criterios.length) { status.classList.add("is-error"); status.textContent = "Pesquisa sem critérios numéricos detectados."; return }
  const respostas = s.pesquisa.respostas
  const destaque = s.pesquisa.recomendacao || criterios.reduce((a, b) => (a.media >= b.media ? a : b))
  const minMedia = Math.min(...criterios.map(c => c.media))
  const cAltos = s.pesquisa.temas?.altos || []
  const cMelhor = s.pesquisa.temas?.melhorias || []
  const cSugest = s.pesquisa.temas?.sugestoes || []

  // Renderiza charts em PNG
  status.textContent = "Renderizando gráficos..."
  const g1 = await renderChartToImage("bar", {
    data: {
      labels: ["Ingressos Disponibilizados", "Ingressos Adquiridos", "Presentes"],
      datasets: [{ data: [cap, inscritos, presentes], backgroundColor: [MODELO_CHART.navy, MODELO_CHART.blueMid, MODELO_CHART.blueLighter], borderWidth: 0, barPercentage: 0.65, categoryPercentage: 0.7 }]
    },
    options: {
      scales: {
        y: { beginAtZero: true, title: { display: true, text: "Quantidade", font: { family: MODELO_CHART.font, size: 13, weight: "600" }, color: MODELO_CHART.text }, ticks: { font: { family: MODELO_CHART.font, size: 12 }, color: MODELO_CHART.textMuted, precision: 0 }, grid: { color: MODELO_CHART.grid, drawBorder: false } },
        x: { ticks: { font: { family: MODELO_CHART.font, size: 12 }, color: MODELO_CHART.text, maxRotation: 0, autoSkip: false }, grid: { display: false, drawBorder: false } }
      },
      plugins: {
        legend: { display: false },
        title: { display: true, text: "Participação no Evento", font: { size: 18, weight: "bold", family: MODELO_CHART.font }, color: MODELO_CHART.navy, padding: { bottom: 18 } },
        datalabels: { anchor: "end", align: "top", font: { weight: "bold", size: 16, family: MODELO_CHART.font }, color: MODELO_CHART.navy, formatter: v => v }
      }
    }
  }, 1200, 700)

  const mediaVals = criterios.map(c => Number(c.media.toFixed(2)))
  const wrapL = (txt, max = 22) => {
    const w = txt.split(/\s+/); const ls = [""]
    w.forEach(x => { if ((ls[ls.length - 1] + " " + x).trim().length > max) ls.push(x); else ls[ls.length - 1] = (ls[ls.length - 1] + " " + x).trim() })
    return ls.slice(0, 3)
  }
  const g2 = await renderChartToImage("bar", {
    data: { labels: criterios.map(c => wrapL(c.label)), datasets: [{ data: mediaVals, backgroundColor: modeloGradedColors(mediaVals), borderWidth: 0, barPercentage: 0.7, categoryPercentage: 0.75 }] },
    options: {
      indexAxis: "y",
      scales: {
        x: { beginAtZero: true, max: 5, title: { display: true, text: "Média (escala 1-5)", font: { family: MODELO_CHART.font, size: 13, weight: "600" }, color: MODELO_CHART.text }, ticks: { stepSize: 1, font: { family: MODELO_CHART.font, size: 12 }, color: MODELO_CHART.textMuted }, grid: { color: MODELO_CHART.grid, drawBorder: false } },
        y: { ticks: { font: { family: MODELO_CHART.font, size: 12 }, color: MODELO_CHART.text }, grid: { display: false, drawBorder: false } }
      },
      plugins: {
        legend: { display: false },
        title: { display: true, text: "Médias das Avaliações", font: { size: 18, weight: "bold", family: MODELO_CHART.font }, color: MODELO_CHART.navy, padding: { bottom: 18 } },
        datalabels: { anchor: "end", align: "end", offset: 6, font: { weight: "bold", size: 14, family: MODELO_CHART.font }, color: MODELO_CHART.navy, formatter: v => Number(v).toFixed(2).replace(".", ",") }
      }
    }
  }, 1200, Math.max(500, 130 + criterios.length * 70))

  const renderCatPpt = async (titulo, cats) => {
    if (!cats.length) return null
    const vals = cats.map(c => c.value)
    return renderChartToImage("bar", {
      data: { labels: cats.map(c => c.label), datasets: [{ data: vals, backgroundColor: modeloGradedColors(vals), borderWidth: 0, barPercentage: 0.72, categoryPercentage: 0.78 }] },
      options: {
        indexAxis: "y",
        scales: {
          x: { beginAtZero: true, suggestedMax: Math.max(...vals) + 1, title: { display: true, text: "Nº de menções", font: { family: MODELO_CHART.font, size: 13, weight: "600" }, color: MODELO_CHART.text }, ticks: { stepSize: 1, precision: 0, font: { family: MODELO_CHART.font, size: 12 }, color: MODELO_CHART.textMuted }, grid: { color: MODELO_CHART.grid, drawBorder: false } },
          y: { ticks: { font: { family: MODELO_CHART.font, size: 12 }, color: MODELO_CHART.text }, grid: { display: false, drawBorder: false } }
        },
        plugins: {
          legend: { display: false },
          title: { display: true, text: titulo, font: { size: 18, weight: "bold", family: MODELO_CHART.font }, color: MODELO_CHART.navy, padding: { bottom: 18 } },
          datalabels: { anchor: "end", align: "end", offset: 6, font: { weight: "bold", size: 14, family: MODELO_CHART.font }, color: MODELO_CHART.navy, formatter: v => v }
        }
      }
    }, 1200, Math.max(500, 140 + cats.length * 60))
  }
  const g3 = await renderCatPpt("Principais Pontos Altos", cAltos)
  const g4 = await renderCatPpt("O que pode ser melhorado?", cMelhor)
  const g5 = await renderCatPpt("Sugestões de Temas para Próximas Ações", cSugest)

  status.textContent = "Montando apresentação..."

  const brand = await loadBrandAssets()
  const pptx = new window.PptxGenJS()
  pptx.layout = "LAYOUT_WIDE" // 13.333 x 7.5
  pptx.author = "Escola de Governo · Pedro Leopoldo"
  pptx.company = "Prefeitura Municipal de Pedro Leopoldo"
  pptx.title = `Relatório de Satisfação · ${evento}`

  buildEgovPptxMaster(pptx, brand, "Relatório de Satisfação")

  // ===== Slide 1: capa institucional (gradient + logo EGov) =====
  const s1 = pptx.addSlide()
  s1.background = { color: EGOV_BRAND.white }
  s1.addImage({ data: brand.hero, x: 0, y: 0, w: 13.333, h: 7.5, sizing: { type: "cover", w: 13.333, h: 7.5 } })
  s1.addShape("rect", { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: EGOV_BRAND.white, transparency: 35 } })
  // Logo aspect ratio preservado - centralizada
  const s1LogoFit = fitAspect(brand.dims.comboLogo.ratio, 5.4, 1.4)
  s1.addImage({ data: brand.comboLogo, x: (13.333 - s1LogoFit.w) / 2, y: 0.9, w: s1LogoFit.w, h: s1LogoFit.h })
  s1.addText("PREFEITURA MUNICIPAL DE PEDRO LEOPOLDO", { x: 1, y: 2.4, w: 11.3, h: 0.5, fontFace: EGOV_BRAND.font, fontSize: 14, bold: true, color: EGOV_BRAND.navy, align: "center", charSpacing: 4 })
  s1.addShape("line", { x: 5.4, y: 3.0, w: 2.5, h: 0, line: { color: EGOV_BRAND.green, width: 2 } })
  s1.addText("Relatório de Satisfação", { x: 1, y: 3.2, w: 11.3, h: 1.1, fontFace: EGOV_BRAND.font, fontSize: 48, bold: true, color: EGOV_BRAND.navy, align: "center" })
  s1.addText(evento, { x: 1, y: 4.5, w: 11.3, h: 1, fontFace: EGOV_BRAND.font, fontSize: 26, italic: true, color: EGOV_BRAND.text, align: "center" })
  if (data) s1.addText(data, { x: 1, y: 5.7, w: 11.3, h: 0.5, fontFace: EGOV_BRAND.font, fontSize: 16, color: EGOV_BRAND.textMuted, align: "center" })
  if (local) s1.addText(local, { x: 1, y: 6.15, w: 11.3, h: 0.5, fontFace: EGOV_BRAND.font, fontSize: 14, color: EGOV_BRAND.textMuted, align: "center" })

  // ===== Slide 2: visão geral / KPIs =====
  const s2 = pptx.addSlide({ masterName: "EGOV_MASTER" })
  egovSlideTitle(s2, "Visão Geral")
  const kpiBox = (slide, x, label, value, accent) => {
    slide.addShape("roundRect", { x, y: 2.0, w: 2.8, h: 2.2, fill: { color: EGOV_BRAND.white }, line: { color: EGOV_BRAND.blueSoft, width: 1 }, rectRadius: 0.15 })
    slide.addShape("rect", { x, y: 2.0, w: 2.8, h: 0.1, fill: { color: accent }, line: { color: accent, width: 0 } })
    slide.addText(String(value), { x, y: 2.25, w: 2.8, h: 1.2, fontFace: EGOV_BRAND.font, fontSize: 52, bold: true, color: accent, align: "center" })
    slide.addText(label, { x, y: 3.45, w: 2.8, h: 0.6, fontFace: EGOV_BRAND.font, fontSize: 15, color: EGOV_BRAND.textMuted, align: "center" })
  }
  kpiBox(s2, 0.7, "Inscritos", inscritos, EGOV_BRAND.navy)
  kpiBox(s2, 3.7, "Presentes", presentes, EGOV_BRAND.green)
  kpiBox(s2, 6.7, "Ausentes", ausentes, "C0392B")
  kpiBox(s2, 9.7, "Taxa de presença", `${taxaPresenca}%`, EGOV_BRAND.navyLight)
  s2.addText(`O evento foi avaliado por ${respostas} participantes através da pesquisa de satisfação.`, { x: 0.95, y: 5.5, w: 11.5, h: 0.6, fontFace: EGOV_BRAND.font, fontSize: 16, italic: true, color: EGOV_BRAND.text, align: "center" })

  // ===== Slide 3: Gráfico 1 =====
  const s3 = pptx.addSlide({ masterName: "EGOV_MASTER" })
  egovSlideTitle(s3, "Participação no Evento")
  s3.addImage({ data: g1, x: 1.2, y: 1.75, w: 11, h: 5.0 })

  // ===== Slide 4: Gráfico 2 =====
  const s4 = pptx.addSlide({ masterName: "EGOV_MASTER" })
  egovSlideTitle(s4, "Médias das Avaliações")
  s4.addImage({ data: g2, x: 1.2, y: 1.75, w: 11, h: 5.0 })

  // ===== Slide 5: tabela Nota 4 / Nota 5 =====
  const s5 = pptx.addSlide({ masterName: "EGOV_MASTER" })
  egovSlideTitle(s5, "Distribuição de Notas Altas")
  const tableRows = [[
    { text: "Critério", options: { bold: true, color: EGOV_BRAND.white, fill: { color: EGOV_BRAND.navy }, align: "left", fontFace: EGOV_BRAND.font, fontSize: 14 } },
    { text: "Nota 4", options: { bold: true, color: EGOV_BRAND.white, fill: { color: EGOV_BRAND.navy }, align: "center", fontFace: EGOV_BRAND.font, fontSize: 14 } },
    { text: "Nota 5", options: { bold: true, color: EGOV_BRAND.white, fill: { color: EGOV_BRAND.navy }, align: "center", fontFace: EGOV_BRAND.font, fontSize: 14 } }
  ]]
  criterios.forEach((c, i) => {
    const tot = Math.max(c.dist.total, 1)
    const p4 = c.dist[4] ? ` (${((c.dist[4]/tot)*100).toFixed(1).replace(".", ",")}%)` : ""
    const p5 = c.dist[5] ? ` (${((c.dist[5]/tot)*100).toFixed(1).replace(".", ",")}%)` : ""
    const bg = i % 2 === 0 ? EGOV_BRAND.white : EGOV_BRAND.bgSoft
    tableRows.push([
      { text: c.label, options: { fill: { color: bg }, color: EGOV_BRAND.text, fontFace: EGOV_BRAND.font, fontSize: 13 } },
      { text: `${c.dist[4]}${p4}`, options: { fill: { color: bg }, color: EGOV_BRAND.text, align: "center", fontFace: EGOV_BRAND.font, fontSize: 13 } },
      { text: `${c.dist[5]}${p5}`, options: { fill: { color: bg }, color: EGOV_BRAND.text, align: "center", fontFace: EGOV_BRAND.font, fontSize: 13 } }
    ])
  })
  s5.addTable(tableRows, { x: 0.95, y: 1.75, w: 11.4, colW: [6.4, 2.5, 2.5], border: { type: "solid", color: EGOV_BRAND.blueSoft, pt: 0.5 } })

  // ===== Slides 6-8: análises qualitativas =====
  const addChartSlide = (titulo, img, narrativa) => {
    if (!img) return
    const slide = pptx.addSlide({ masterName: "EGOV_MASTER" })
    egovSlideTitle(slide, titulo)
    slide.addImage({ data: img, x: 0.95, y: 1.7, w: 8.5, h: 5.1 })
    slide.addShape("roundRect", { x: 9.65, y: 1.7, w: 3.15, h: 5.1, fill: { color: EGOV_BRAND.bgSoft }, line: { color: EGOV_BRAND.blueSoft, width: 1 }, rectRadius: 0.1 })
    slide.addText(narrativa, { x: 9.85, y: 1.85, w: 2.8, h: 4.9, fontFace: EGOV_BRAND.font, fontSize: 13, color: EGOV_BRAND.text, valign: "top" })
  }
  if (g3) addChartSlide("Principais Pontos Altos", g3, `Os participantes destacaram ${cAltos.slice(0, 2).map(c => `${c.label} (${c.value} ${c.value === 1 ? "menção" : "menções"})`).join(" e ")} como os pontos altos do evento.`)
  if (g4) addChartSlide("Oportunidades de Melhoria", g4, `A principal sugestão de melhoria foi ${cMelhor[0].label.toLowerCase()} (${cMelhor[0].value} ${cMelhor[0].value === 1 ? "menção" : "menções"}).`)
  if (g5) addChartSlide("Sugestões para Próximas Ações", g5, `Há interesse predominante em ${cSugest.slice(0, 2).map(c => c.label).join(" e ")} como temas para futuras capacitações.`)

  // ===== Slide final: conclusão =====
  const sN = pptx.addSlide({ masterName: "EGOV_MASTER" })
  egovSlideTitle(sN, "Conclusão")
  sN.addShape("roundRect", { x: 0.95, y: 1.75, w: 11.4, h: 4.8, fill: { color: EGOV_BRAND.bgSoft }, line: { color: EGOV_BRAND.blueSoft, width: 1 }, rectRadius: 0.15 })
  sN.addShape("rect", { x: 0.95, y: 1.75, w: 0.12, h: 4.8, fill: { color: EGOV_BRAND.green } })
  const txt = [
    { text: `O evento "${evento}" alcançou ${taxaPresenca}% de presença e médias superiores a ${minMedia.toFixed(2).replace(".", ",")} em todos os ${criterios.length} critérios avaliados (escala 1 a 5).`, options: { fontFace: EGOV_BRAND.font, fontSize: 18, color: EGOV_BRAND.text } },
    { text: "\n\n", options: {} },
    { text: `O critério "${destaque.label}" obteve o maior reconhecimento do público, consolidando a percepção positiva da iniciativa.`, options: { fontFace: EGOV_BRAND.font, fontSize: 16, color: EGOV_BRAND.text, italic: true } },
    { text: "\n\n", options: {} },
    { text: "Recomenda-se a continuidade e institucionalização desta linha de capacitação como ação estratégica da Escola de Governo.", options: { fontFace: EGOV_BRAND.font, fontSize: 16, color: EGOV_BRAND.navy, bold: true } }
  ]
  sN.addText(txt, { x: 1.4, y: 2.05, w: 10.5, h: 4, valign: "top" })

  const slug = (evento || "evento").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  await pptx.writeFile({ fileName: `Relatorio Satisfacao - ${slug}.pptx` })

  status.classList.add("is-success")
  status.textContent = `PPTX "${evento}" gerado!`
}
