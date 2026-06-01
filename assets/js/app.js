/**
 * app.js - controller principal: roteamento entre views, sidebar,
 * comparacao, filtros e tela de certificados com upload dinamico.
 */

import { loadData, getEvento } from "./data.js"
import {
  resumoGlobal,
  rankingSecretarias,
  rankingEvasaoSecretarias,
  comparativoEventos,
  taxaPresenca,
  participacaoPorSecretaria,
  evasaoPorSecretariaEvento,
  distribuicaoPorTurma,
  consolidarPorGrupo
} from "./metrics.js"
import {
  barInscritosVsPresentes,
  barTaxaPresenca,
  donutPresenca,
  barSecretarias,
  pieTurmas,
  pieCategorias,
  barCategorias,
  lineTimeline,
  lineEvolucaoEventos,
  radarComparativo,
  barGrupoComparativo,
  barGroupedByCategory,
  barModulosPresenca,
  destroyAll,
  PALETTE
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
  renderComparativeTable
} from "./ui.js"
import { gerarInsightsGlobais, gerarInsightsEvento } from "./insights.js"
import { initPalestrantes, renderCadastro as renderPalestrantesCadastro, renderLista as renderPalestrantesLista } from "./palestrantes.js"

// ================ Modal (substitui alert/confirm nativos) ================
// API: showAlert({title, message, type, confirmLabel}) -> Promise<void>
//      showConfirm({title, message, type, confirmLabel, cancelLabel, danger}) -> Promise<boolean>
// Apenas 1 modal por vez; ESC e clique no overlay fecham (confirm = cancela).
let _activeModal = null
function _closeModal(resolveValue) {
  if (!_activeModal) return
  const { overlay, resolve, escHandler } = _activeModal
  document.removeEventListener("keydown", escHandler)
  overlay.classList.add("is-closing")
  _activeModal = null
  setTimeout(() => overlay.remove(), 160)
  resolve(resolveValue)
}
function _openModal({ title, message, type = "info", confirmLabel = "OK", cancelLabel = null, danger = false }) {
  // Se já tem um aberto, fecha primeiro (cancela)
  if (_activeModal) _closeModal(false)

  const icons = {
    info: "fa-circle-info",
    success: "fa-circle-check",
    warn: "fa-triangle-exclamation",
    error: "fa-circle-exclamation",
    confirm: "fa-circle-question"
  }
  const variant = cancelLabel ? "confirm" : type
  const icon = icons[type] || icons.info

  const overlay = document.createElement("div")
  overlay.className = "app-modal__overlay"
  overlay.setAttribute("role", "dialog")
  overlay.setAttribute("aria-modal", "true")
  overlay.innerHTML = `
    <div class="app-modal app-modal--${variant}" style="position:relative">
      <button type="button" class="app-modal__close" aria-label="Fechar"><i class="fas fa-xmark"></i></button>
      <div class="app-modal__head">
        <div class="app-modal__icon"><i class="fas ${icon}"></i></div>
        <div class="app-modal__text">
          ${title ? `<h3 class="app-modal__title">${escapeHtml(title)}</h3>` : ""}
          <p class="app-modal__message">${escapeHtml(message || "").replace(/\n/g, "<br>")}</p>
        </div>
      </div>
      <div class="app-modal__actions">
        ${cancelLabel ? `<button type="button" class="app-modal__btn app-modal__btn--ghost" data-modal-cancel>${escapeHtml(cancelLabel)}</button>` : ""}
        <button type="button" class="app-modal__btn ${danger ? "app-modal__btn--danger" : "app-modal__btn--primary"}" data-modal-confirm>${escapeHtml(confirmLabel)}</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)

  return new Promise(resolve => {
    const escHandler = (e) => { if (e.key === "Escape") _closeModal(cancelLabel ? false : undefined) }
    _activeModal = { overlay, resolve, escHandler }
    document.addEventListener("keydown", escHandler)

    overlay.addEventListener("click", (e) => { if (e.target === overlay) _closeModal(cancelLabel ? false : undefined) })
    overlay.querySelector(".app-modal__close").addEventListener("click", () => _closeModal(cancelLabel ? false : undefined))
    overlay.querySelector("[data-modal-confirm]").addEventListener("click", () => _closeModal(cancelLabel ? true : undefined))
    const cancelBtn = overlay.querySelector("[data-modal-cancel]")
    if (cancelBtn) cancelBtn.addEventListener("click", () => _closeModal(false))

    // Foco no botão primário
    setTimeout(() => overlay.querySelector("[data-modal-confirm]")?.focus(), 50)
  })
}
function showAlert(opts) {
  if (typeof opts === "string") opts = { message: opts }
  return _openModal({ ...opts, cancelLabel: null })
}
function showConfirm(opts) {
  if (typeof opts === "string") opts = { message: opts }
  return _openModal({ type: "confirm", cancelLabel: "Cancelar", confirmLabel: "Confirmar", ...opts })
}

// ================ Auth gate ================
const session = sessionStorage.getItem("egov_admin_session")
if (!session) window.location.replace("login.html")
const userData = (() => {
  try {
    return JSON.parse(session)
  } catch {
    return { email: "admin", name: "Admin" }
  }
})()

// ================ State ================
const state = {
  data: null,
  view: "dashboard",
  _certTypoLinked: true,    // padrão: manter proporções entre os campos
  _certDragEnabled: true,   // padrão: arrasta-e-solta ligado
  selectedEventId: null,
  compareIds: new Set(),
  reportFilters: { eventoId: "", secretaria: "", turma: "", busca: "" },
  certEventId: null, // id da planilha do sistema selecionada (aba "Do sistema")
  certSource: "evento", // 'evento' (planilha do sistema) ou 'planilha' (upload)
  certUploaded: null, // dados de planilha enviada via upload
  certManifest: null, // índice lido de relatorios/manifest.json
  certSystemCache: {}, // id -> participantes elegíveis já parseados da planilha
  certPendingArquivo: null, // arquivo a resolver quando o manifesto terminar de carregar
  templateImg: null, // Image do modelo atualmente carregado
  certTemplateId: "modelo-1" // id em CERT_TEMPLATES (selecionado na etapa 3)
}

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
      { view: "cargos",        label: "Cargos",              icon: "fa-briefcase" },
      { view: "faltas",        label: "Faltas recorrentes",  icon: "fa-user-xmark" },
      { view: "participantes", label: "Participantes",       icon: "fa-users" }
    ]
  },
  { id: "palestrantes",
    label: "Palestrantes",
    title: "Palestrantes",
    subtitle: "Cadastro de palestrantes: eixo temático, curso ministrado, mini bio e foto.",
    defaultView: "palestrantes-cadastro",
    tabs: [
      { view: "palestrantes-cadastro", label: "Cadastrar", icon: "fa-user-plus" },
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
    getEventos: () => (state.data && state.data.eventos) || [],
    navigate
  })
  preloadTemplate()
  await reloadData()
})()

async function reloadData() {
  showDashboardSkeleton()
  try {
    const raw = await loadData()
    // Consolida eventos com mesmo grupo (turmas/módulos) em um único evento agregado.
    // Mantém referência aos eventos originais em `_turmas` caso seja preciso o detalhe.
    state.data = { ...raw, eventos: consolidarPorGrupo(raw.eventos || []) }
    state.dataRaw = raw
    renderAll()
  } catch (err) {
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
    window.location.replace("login.html")
  })
  document.getElementById("refreshBtn").addEventListener("click", reloadData)
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
// state.viewTabs[viewName] guarda a aba ativa de cada pagina
state.viewTabs = state.viewTabs || {}
// Estado de paginação por escopo (e.g. "ev-{id}", "participantes-global")
state.pagerPages = state.pagerPages || {}

function renderPaginatedTable(containerId, participantes, scopeId, opts = {}) {
  const pageSize = opts.pageSize || 10
  const container = document.getElementById(containerId)
  if (!container) return
  const totalPages = Math.max(1, Math.ceil(participantes.length / pageSize))
  // Garante que a página atual ainda existe (caso filtros tenham encolhido o
  // total). Se a anterior virou inválida, volta pra 1.
  const cur = state.pagerPages[scopeId] || 1
  if (cur > totalPages) state.pagerPages[scopeId] = 1
  if (!state.pagerPages[scopeId]) state.pagerPages[scopeId] = 1

  const draw = () => {
    const page = state.pagerPages[scopeId] || 1
    container.innerHTML = renderParticipantsTable(participantes, { paginate: true, pageSize, page, scopeId, hideEmail: !!opts.hideEmail, hideTurma: !!opts.hideTurma })
    container.querySelectorAll(`[data-pager-scope="${scopeId}"][data-pager-page]`).forEach(btn => {
      btn.addEventListener("click", e => {
        e.preventDefault()
        const p = parseInt(btn.dataset.pagerPage, 10)
        if (!Number.isFinite(p) || p < 1) return
        state.pagerPages[scopeId] = p
        draw()
      })
    })
  }
  draw()
}

function renderTabsNav(viewKey, tabs) {
  const active = state.viewTabs[viewKey] || tabs[0].id
  return `
    <nav class="view-tabs" role="tablist" data-view="${viewKey}">
      ${tabs
        .map(
          t => `
        <button class="view-tab ${active === t.id ? "is-active" : ""}" data-tab="${t.id}" role="tab" aria-selected="${active === t.id}">
          ${t.icon ? `<i class="fas ${t.icon}"></i>` : ""}
          <span>${escapeHtml(t.label)}</span>
          ${t.badge != null ? `<span class="view-tab__badge">${escapeHtml(String(t.badge))}</span>` : ""}
        </button>
      `
        )
        .join("")}
    </nav>
  `
}

function wireTabs(viewKey, onSwitch) {
  const nav = document.querySelector(`.view-tabs[data-view="${viewKey}"]`)
  if (!nav) return
  nav.querySelectorAll(".view-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.tab
      state.viewTabs[viewKey] = id
      onSwitch(id)
    })
  })
}

function getActiveTab(viewKey, defaultId) {
  return state.viewTabs[viewKey] || defaultId
}

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
  else if (state.view === "palestrantes-cadastro") renderPalestrantesCadastro()
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
  const gruposEventos = agruparEventos(eventos)
    .slice()
    .sort((a, b) => {
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
        if (e.target.closest("[data-action]")) return
        state.selectedEventId = card.dataset.event
        navigate("eventos")
      })
    )
    document.querySelectorAll(".course-card__turma").forEach(b =>
      b.addEventListener("click", () => {
        state.selectedEventId = b.dataset.event
        navigate("eventos")
      })
    )
    document.querySelectorAll('[data-action="detalhe"]').forEach(b =>
      b.addEventListener("click", e => {
        e.stopPropagation()
        state.selectedEventId = b.dataset.event
        navigate("eventos")
      })
    )
    document.querySelectorAll('[data-action="certificados"]').forEach(b =>
      b.addEventListener("click", e => {
        e.stopPropagation()
        const ev = getEvento(state.data, b.dataset.event)
        state.certPendingArquivo = ev ? ev.fonte : null
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
        const turmas = ev._turmas || []
        // Se o evento foi consolidado a partir de 2+ turmas, exibe o course card
        if (turmas.length > 1) {
          return renderCourseCard({
            grupo: ev.grupo,
            eventos: turmas
          })
        }
        return g.eventos.length > 1 ? renderCourseCard(g) : renderEventCard(ev)
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
function renderViewEventos() {
  const { data } = state
  const eventos = data.eventos
  if (!state.selectedEventId && eventos.length) state.selectedEventId = eventos[0].id
  const ev = getEvento(data, state.selectedEventId)

  const view = document.getElementById("view-eventos")
  view.innerHTML = `
    <div class="event-picker">
      <label class="event-picker__label" for="evSelect">
        <i class="fas fa-calendar-day"></i> Evento
      </label>
      <select id="evSelect" class="event-picker__select">
        ${eventos.map(e => `<option value="${e.id}" ${e.id === state.selectedEventId ? "selected" : ""}>${escapeHtml(e.title)} ${e.date ? "(" + formatDateBR(e.date) + ")" : ""}</option>`).join("")}
      </select>
    </div>
    <div id="eventDetailBlock"></div>
  `
  document.getElementById("evSelect").addEventListener("change", e => {
    state.selectedEventId = e.target.value
    renderViewEventos()
  })
  if (ev) renderEventBlock(ev)
}

function renderEventBlock(ev) {
  const block = document.getElementById("eventDetailBlock")
  const tabsKey = "eventos"
  const active = getActiveTab(tabsKey, "resumo")

  block.innerHTML = `
    ${renderEventDetail(ev)}
    ${renderTabsNav(tabsKey, [
      { id: "resumo", label: "Resumo & Insights", icon: "fa-circle-info" },
      { id: "distribuicoes", label: "Distribuições", icon: "fa-chart-pie" },
      { id: "participantes", label: "Participantes", icon: "fa-users", badge: ev.participantes.length }
    ])}

    <div class="view-tabs__panel" data-tab-panel="resumo" ${active === "resumo" ? "" : "hidden"}>
      <div class="card">
        <div class="card__header"><div><h3>Observações automáticas</h3><p>Insights deste evento.</p></div></div>
        <div class="insights-grid" style="grid-template-columns:1fr;" id="evInsights"></div>
      </div>
    </div>

    <div class="view-tabs__panel" data-tab-panel="distribuicoes" ${active === "distribuicoes" ? "" : "hidden"}>
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
    </div>

    <div class="view-tabs__panel" data-tab-panel="participantes" ${active === "participantes" ? "" : "hidden"}>
      <div class="grid-2 participantes-grid">
        <div class="table-wrap">
          <div class="table-wrap__head">
            <h3><i class="fas fa-circle-check" style="color: var(--green-600)"></i> Presentes</h3>
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
    </div>
  `

  wireTabs(tabsKey, () => renderEventBlock(ev))

  if (active === "participantes") {
    const presentes = (ev.participantes || []).filter(p => p.presente)
    const faltou = (ev.participantes || []).filter(p => !p.presente)
    renderPaginatedTable("evPresentesTable", presentes, `ev-${ev.id}-presentes`)
    renderPaginatedTable("evFaltouTable", faltou, `ev-${ev.id}-faltou`)
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
    barSecretarias("chartEvEvasao", evasaoPorSecretariaEvento(ev))
    lineTimeline("chartEvTimeline", ev.timelineInscricoes || [], "Inscrições no dia")
  }
}

// ================ COMPARAR ================
function renderViewComparar() {
  const { data } = state
  const compareItems = data.eventos
    .map(e => {
      const checked = state.compareIds.has(e.id)
      return `
        <label class="checkbox ${checked ? "is-checked" : ""}">
          <input type="checkbox" value="${e.id}" ${checked ? "checked" : ""} />
          <span class="checkbox__label">${escapeHtml(e.title)}</span>
        </label>
      `
    })
    .join("")

  const view = document.getElementById("view-comparar")
  view.innerHTML = `
    <div class="compare-bar">
      <span class="compare-bar__label"><i class="fas fa-scale-balanced"></i> Eventos:</span>
      ${compareItems}
      <button class="btn btn--sm" id="compareClear"><i class="fas fa-rotate-left"></i> Limpar</button>
    </div>
    <div id="compareContent"></div>
  `

  view.querySelectorAll(".checkbox input").forEach(input =>
    input.addEventListener("change", () => {
      if (input.checked) state.compareIds.add(input.value)
      else state.compareIds.delete(input.value)
      renderViewComparar()
    })
  )
  document.getElementById("compareClear").addEventListener("click", () => {
    state.compareIds.clear()
    renderViewComparar()
  })
  renderCompareContent()
}

function renderCompareContent() {
  const ids = [...state.compareIds]
  const selected = state.data.eventos.filter(e => ids.includes(e.id))
  const target = document.getElementById("compareContent")

  if (selected.length < 2) {
    target.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-scale-balanced"></i>
        <h3>Selecione 2 ou mais eventos</h3>
        <p>A comparação ficará disponível ao marcar pelo menos dois eventos acima.</p>
      </div>`
    return
  }

  const comparativos = comparativoEventos(selected)
  const allSecs = new Set()
  selected.forEach(e => Object.keys(e.secretarias || {}).forEach(s => allSecs.add(s)))
  const secLabels = [...allSecs]
  const allTurmas = new Set()
  selected.forEach(e => Object.keys(e.turmas || {}).forEach(t => allTurmas.add(t)))
  const turmaLabels = [...allTurmas]

  const manyEvents = selected.length >= 4
  const topGridCls = manyEvents ? "stack" : "grid-2"
  const chartWrapCls = manyEvents ? "chart-wrap xl" : "chart-wrap lg"

  target.innerHTML = `
    <div class="${topGridCls}">
      <div class="card">
        <div class="card__header"><div><h3>Volume comparado</h3><p>Inscritos, presentes e ausentes.</p></div></div>
        <div class="${chartWrapCls}"><canvas id="cmpBar"></canvas></div>
      </div>
      <div class="card">
        <div class="card__header"><div><h3>Perfil comparativo</h3><p><b>Quanto maior a área, melhor o evento.</b> Cada ponta mostra um critério (Inscritos, Presentes, Taxa de presença, Secretarias). O evento com o melhor valor em cada critério toca a borda (100%); os demais aparecem proporcionalmente menores.</p></div></div>
        <div class="${chartWrapCls}"><canvas id="cmpRadar"></canvas></div>
      </div>
    </div>

    ${
      secLabels.length
        ? `
      <div class="card">
        <div class="card__header"><div><h3>Por secretaria</h3><p>Inscrições por secretaria em cada evento.</p></div></div>
        <div class="${chartWrapCls}"><canvas id="cmpSec"></canvas></div>
      </div>`
        : ""
    }

    <div class="table-wrap">
      <div class="table-wrap__head">
        <h3><i class="fas fa-table"></i> Quadro comparativo</h3>
        <span class="card__header-meta">${selected.length} eventos</span>
      </div>
      ${renderComparativeTable(comparativos)}
    </div>
  `

  barGrupoComparativo("cmpBar", comparativos)
  radarComparativo("cmpRadar", comparativos)

  if (secLabels.length) {
    const datasets = selected.map((e, i) => ({
      label: e.title.length > 22 ? e.title.slice(0, 20) + "..." : e.title,
      data: secLabels.map(s => (e.secretarias || {})[s] || 0),
      backgroundColor: PALETTE.series[i % PALETTE.series.length],
      maxBarThickness: 22
    }))
    barGroupedByCategory("cmpSec", secLabels, datasets, { indexAxis: "y" })
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

// Chave estável para identificar um servidor entre eventos. Preferência:
// e-mail (lowercased). Fallback: nome normalizado (sem acentos, lower).
function chaveServidor(p) {
  const email = String(p.email || "").trim().toLowerCase()
  if (email && !/^user-anonymous/i.test(email)) return "e:" + email
  const nome = String(p.nome || "").trim().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ")
  if (nome) return "n:" + nome
  return null
}

// Agrega presenças únicas de cada servidor através de todos os eventos.
// Retorna [{ chave, nome, email, secretaria, cargo, eventos: [{id,title,date,presente}], totalEventos, totalPresentes }, ...]
function agregarServidores(eventos) {
  const mapa = new Map()
  eventos.forEach(ev => {
    (ev.participantes || []).forEach(p => {
      const k = chaveServidor(p)
      if (!k) return
      let entry = mapa.get(k)
      if (!entry) {
        entry = {
          chave: k,
          nome: p.nome || "",
          email: p.email || "",
          secretaria: p.secretaria || "",
          cargo: p.cargo || "",
          eventos: [],
          totalEventos: 0,
          totalPresentes: 0
        }
        mapa.set(k, entry)
      }
      // Usa o nome mais bonito (mais longo) quando há variações
      if ((p.nome || "").length > entry.nome.length) entry.nome = p.nome
      if (!entry.email && p.email) entry.email = p.email
      if (!entry.secretaria && p.secretaria) entry.secretaria = p.secretaria
      if (!entry.cargo && p.cargo) entry.cargo = p.cargo
      entry.eventos.push({
        id: ev.id,
        title: ev.title,
        date: ev.date,
        presente: !!p.presente,
        turma: p.turma || "",
        dataCheckin: p.dataCheckin || null,
        dataInscricao: p.dataInscricao || null,
        local: ev.local || "",
        time: ev.time || ""
      })
      entry.totalEventos += 1
      if (p.presente) entry.totalPresentes += 1
    })
  })
  return [...mapa.values()]
}

// Normaliza um cargo para Title Case + remove caracteres redundantes.
// Não inventa dados - só padroniza formatação para agrupar variantes
// como "COORDENAÇÃO" / "Coordenação" / "coordenacao".
// ================ PERFIL DO SERVIDOR (drill-down) ================
// Busca um servidor pela chave (e:email ou n:nome) atravessando os eventos
// agregados. Devolve a entrada completa de agregarServidores ou null.
function buscarServidorPorChave(chave) {
  if (!chave) return null
  const lista = agregarServidores(state.data?.eventos || [])
  return lista.find(s => s.chave === chave) || null
}

// Iniciais para o avatar.
function iniciaisDoNome(nome) {
  if (!nome) return "?"
  const partes = String(nome).trim().split(/\s+/).filter(Boolean)
  if (!partes.length) return "?"
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}

// Frequência mensal: { "2026-04": N, "2026-05": N, ... } - apenas presenças.
function frequenciaMensal(eventos) {
  const map = new Map()
  eventos.forEach(ev => {
    if (!ev.presente || !ev.date) return
    const m = ev.date.match(/^(\d{4})-(\d{2})/)
    if (!m) return
    const key = `${m[1]}-${m[2]}`
    map.set(key, (map.get(key) || 0) + 1)
  })
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => ({ mes: k, qtd: v }))
}

// Badges automáticas com base na trajetória do servidor.
function badgesDoServidor(s) {
  const out = []
  if (s.totalPresentes >= 1)  out.push({ icon: "fa-star", label: "Primeiro evento", cls: "badge-bronze" })
  if (s.totalPresentes >= 3)  out.push({ icon: "fa-fire", label: "Engajado",       cls: "badge-silver" })
  if (s.totalPresentes >= 5)  out.push({ icon: "fa-trophy", label: "Veterano",     cls: "badge-gold" })
  if (s.totalPresentes >= 10) out.push({ icon: "fa-crown", label: "Líder de capacitação", cls: "badge-diamond" })
  if (s.totalEventos > 0 && s.totalPresentes === s.totalEventos && s.totalEventos >= 2) {
    out.push({ icon: "fa-bullseye", label: "Pontualidade 100%", cls: "badge-green" })
  }
  if (s.totalEventos > 0 && s.totalPresentes === 0) {
    out.push({ icon: "fa-triangle-exclamation", label: "Sem comparecimentos", cls: "badge-warn" })
  }
  return out
}

// Estima carga horária total. Como eventos-data.json não traz cargaHoraria
// explícita, faz uma estimativa conservadora de 8h por presença confirmada.
// Se a fonte trouxer ev.cargaHoraria no futuro, é só consumir aqui.
function estimarHorasServidor(s) {
  return s.eventos.reduce((acc, ev) => acc + (ev.presente ? 8 : 0), 0)
}

// Abre o modal de perfil do servidor.
function openServidorPerfil(chave) {
  const s = buscarServidorPorChave(chave)
  if (!s) return showAlert({ title: "Servidor não encontrado", message: "Os dados do servidor não estão disponíveis no recorte atual.", type: "warn" })

  // Ordena eventos por data (mais recentes primeiro)
  const eventosOrd = s.eventos.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""))
  const presentes = eventosOrd.filter(e => e.presente)
  const faltas    = eventosOrd.filter(e => !e.presente)
  const taxa = s.totalEventos ? ((s.totalPresentes / s.totalEventos) * 100).toFixed(0) + "%" : "-"
  const horas = estimarHorasServidor(s)
  const freq = frequenciaMensal(s.eventos)
  const maxFreq = freq.reduce((m, x) => Math.max(m, x.qtd), 0)
  const badges = badgesDoServidor(s)

  const overlay = document.createElement("div")
  overlay.className = "app-modal__overlay servidor-perfil-overlay"
  overlay.setAttribute("role", "dialog")
  overlay.setAttribute("aria-modal", "true")
  overlay.innerHTML = `
    <div class="app-modal servidor-perfil">
      <button type="button" class="app-modal__close" aria-label="Fechar"><i class="fas fa-xmark"></i></button>

      <header class="servidor-perfil__header">
        <div class="servidor-perfil__avatar">${escapeHtml(iniciaisDoNome(s.nome))}</div>
        <div class="servidor-perfil__id">
          <h2 class="servidor-perfil__name">${escapeHtml(s.nome || "Sem nome")}</h2>
          <div class="servidor-perfil__meta">
            ${s.cargo ? `<span><i class="fas fa-briefcase"></i> ${escapeHtml(s.cargo)}</span>` : ""}
            ${s.secretaria ? `<span><i class="fas fa-building-columns"></i> ${escapeHtml(s.secretaria)}</span>` : ""}
            ${s.email && !/^user-anonymous/i.test(s.email) ? `<span><i class="fas fa-envelope"></i> ${escapeHtml(s.email)}</span>` : ""}
          </div>
        </div>
      </header>

      <div class="servidor-perfil__kpis">
        <div class="srv-kpi"><span class="srv-kpi__num">${s.totalEventos}</span><span class="srv-kpi__lbl">Inscrições</span></div>
        <div class="srv-kpi srv-kpi--good"><span class="srv-kpi__num">${s.totalPresentes}</span><span class="srv-kpi__lbl">Presenças</span></div>
        <div class="srv-kpi srv-kpi--bad"><span class="srv-kpi__num">${s.totalEventos - s.totalPresentes}</span><span class="srv-kpi__lbl">Faltas</span></div>
        <div class="srv-kpi"><span class="srv-kpi__num">${taxa}</span><span class="srv-kpi__lbl">Taxa</span></div>
        <div class="srv-kpi"><span class="srv-kpi__num">${horas}h</span><span class="srv-kpi__lbl">Carga estimada</span></div>
      </div>

      ${badges.length ? `
      <section class="servidor-perfil__section">
        <h3 class="servidor-perfil__h3"><i class="fas fa-medal"></i> Conquistas</h3>
        <div class="srv-badges">
          ${badges.map(b => `
            <span class="srv-badge ${b.cls}">
              <i class="fas ${b.icon}"></i> ${escapeHtml(b.label)}
            </span>
          `).join("")}
        </div>
      </section>` : ""}

      ${freq.length ? `
      <section class="servidor-perfil__section">
        <h3 class="servidor-perfil__h3"><i class="fas fa-chart-column"></i> Frequência por mês</h3>
        <div class="srv-freq">
          ${freq.map(f => {
            const h = maxFreq ? Math.max(8, (f.qtd / maxFreq) * 70) : 8
            const [yyyy, mm] = f.mes.split("-")
            const mesLabel = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][parseInt(mm, 10) - 1]
            return `
              <div class="srv-freq__col" title="${mesLabel}/${yyyy}: ${f.qtd} presença(s)">
                <div class="srv-freq__bar" style="height:${h}px"></div>
                <span class="srv-freq__lbl">${mesLabel}/${yyyy.slice(-2)}</span>
                <span class="srv-freq__val">${f.qtd}</span>
              </div>
            `
          }).join("")}
        </div>
      </section>` : ""}

      ${presentes.length ? `
      <section class="servidor-perfil__section">
        <h3 class="servidor-perfil__h3"><i class="fas fa-check-circle" style="color:#4DAD33"></i> Eventos com presença (${presentes.length})</h3>
        <ul class="srv-events">
          ${presentes.map(ev => `
            <li class="srv-event srv-event--ok">
              <div class="srv-event__date">${ev.date ? new Date(ev.date).toLocaleDateString("pt-BR") : "-"}</div>
              <div class="srv-event__body">
                <div class="srv-event__title">${escapeHtml(ev.title || "-")}</div>
                ${ev.turma ? `<div class="srv-event__sub">Turma: ${escapeHtml(ev.turma)}</div>` : ""}
              </div>
              <span class="srv-event__status srv-event__status--ok"><i class="fas fa-check"></i> Presente</span>
            </li>
          `).join("")}
        </ul>
      </section>` : ""}

      ${faltas.length ? `
      <section class="servidor-perfil__section">
        <h3 class="servidor-perfil__h3"><i class="fas fa-circle-xmark" style="color:#C0392B"></i> Eventos com falta (${faltas.length})</h3>
        <ul class="srv-events">
          ${faltas.map(ev => `
            <li class="srv-event srv-event--bad">
              <div class="srv-event__date">${ev.date ? new Date(ev.date).toLocaleDateString("pt-BR") : "-"}</div>
              <div class="srv-event__body">
                <div class="srv-event__title">${escapeHtml(ev.title || "-")}</div>
                ${ev.turma ? `<div class="srv-event__sub">Turma: ${escapeHtml(ev.turma)}</div>` : ""}
              </div>
              <span class="srv-event__status srv-event__status--bad"><i class="fas fa-xmark"></i> Faltou</span>
            </li>
          `).join("")}
        </ul>
      </section>` : ""}

      <footer class="servidor-perfil__footer">
        <small>Carga estimada em 8h por presença - reflita ajuste caso o evento tenha duração diferente.</small>
      </footer>
    </div>
  `
  document.body.appendChild(overlay)
  const close = () => overlay.remove()
  overlay.addEventListener("click", e => { if (e.target === overlay) close() })
  overlay.querySelector(".app-modal__close").addEventListener("click", close)
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc) }
  })
}

// Delegação global de clique para qualquer [data-servidor-chave] no app.
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-servidor-chave]")
  if (!el) return
  const chave = el.dataset.servidorChave
  if (chave) openServidorPerfil(chave)
})

function normalizarCargo(raw) {
  if (!raw) return null
  const s = String(raw).trim().replace(/\s+/g, " ")
  if (!s) return null
  const LOWER = new Set(["de", "da", "do", "dos", "das", "e"])
  return s.toLowerCase().split(" ").map((w, i) => {
    if (i > 0 && LOWER.has(w)) return w
    return w[0] ? w[0].toUpperCase() + w.slice(1) : w
  }).join(" ")
}

// Agrega cargos a partir de todos os participantes (sem deduplicar por
// servidor - conta inscrições). Retorna [{ label, value }] ordenado.
function agregarCargos(eventos) {
  const cont = new Map()
  eventos.forEach(ev => {
    (ev.participantes || []).forEach(p => {
      const c = normalizarCargo(p.cargo)
      if (!c) return
      cont.set(c, (cont.get(c) || 0) + 1)
    })
  })
  return [...cont.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
}

// Taxa de retenção: % de servidores únicos que participaram (presentes)
// em 2 ou mais eventos.
function taxaRetencao(servidores) {
  const presentesEmAlgumEvento = servidores.filter(s => s.totalPresentes >= 1)
  if (!presentesEmAlgumEvento.length) return { pct: 0, unicos: 0, retidos: 0 }
  const retidos = presentesEmAlgumEvento.filter(s => s.totalPresentes >= 2).length
  return {
    pct: (retidos / presentesEmAlgumEvento.length) * 100,
    unicos: presentesEmAlgumEvento.length,
    retidos
  }
}

// ================ INSIGHTS (aba) ================
function renderInsightsTab() {
  const host = document.getElementById("insightsHost")
  if (!host) return
  const eventos = state.data.eventos.filter(e => e.status === "realizado")
  const servidores = agregarServidores(eventos)
  const cargos = agregarCargos(eventos)
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
          <div class="kpi__icon"><i class="fas fa-briefcase"></i></div>
          <div class="kpi__label">Cargos distintos</div>
          <div class="kpi__value">${cargos.length}</div>
          <div class="kpi__delta">no público total</div>
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
              { label: "Presentes",        value: tPres, base: tCap, color: "var(--green-500,#4DAD33)" }
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
            ${tCap ? `Ocupação: <b>${((tIns / tCap) * 100).toFixed(1).replace(".", ",")}%</b>` : "Capacidade não informada."}
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

      <!-- Linha 3: Top 5 cargos (barras horizontais) - visual diferente da pizza completa em Cargos -->
      <div class="card">
        <div class="card__header">
          <div><h3><i class="fas fa-briefcase"></i> Cargos mais frequentes</h3><p>Resumo dos 5 cargos com mais inscrições. Veja a distribuição completa em Cargos.</p></div>
        </div>
        <div class="chart-wrap lg" id="insCargosWrap"><canvas id="chartInsCargos"></canvas></div>
      </div>
    </div>
  `

  // Top servidores paginado 5 em 5 (mantém ordem do dense rank)
  renderPodioInsightsPaginated("insTopHost", topServidores, "insights-top", 5)

  // Top 5 cargos (mesmo estilo de barSecretarias - chart diferente da pizza de Cargos)
  barCategorias("chartInsCargos", cargos.slice(0, 5), {
    horizontal: true,
    limit: 5,
    datasetLabel: "Inscrições",
    unitLabel: "inscrição(ões)",
    emptyLabel: "Nenhum participante tem cargo registrado."
  })
}

// Pódio do Insights - recebe lista já com `rank` denso. Empates
// compartilham medalha. Ouro=1º, Prata=2º, Bronze=3º; 4º e 5º sem medalha.
function renderPodioInsights(lista) {
  if (!lista.length) return `<ol class="rank-list"><li class="rank-list__empty">Nenhum servidor com presença ainda.</li></ol>`
  return `<ol class="rank-list">${lista.map(renderPodioItem).join("")}</ol>`
}

// Item individual do pódio (dense rank). Empates compartilham a medalha.
function renderPodioItem(s) {
  const cls = s.rank === 1 ? "rank-list__item--gold"
    : s.rank === 2 ? "rank-list__item--silver"
    : s.rank === 3 ? "rank-list__item--bronze"
    : ""
  return `
    <li class="rank-list__item ${cls}">
      <span class="rank-list__pos">${s.rank <= 3 ? `<i class="fas fa-medal"></i>` : ""}<small>${s.rank}º</small></span>
      <div class="rank-list__body">
        <div class="rank-list__name"><a class="servidor-link" data-servidor-chave="${escapeHtml(s.chave || "")}" tabindex="0" role="button">${escapeHtml(s.nome || "(sem nome)")}</a></div>
        <div class="rank-list__meta">${escapeHtml(s.cargo || "-")} · ${escapeHtml(s.secretaria || "-")}</div>
      </div>
      <span class="rank-list__badge">${s.totalPresentes}<small>presente${s.totalPresentes === 1 ? "" : "s"}</small></span>
    </li>
  `
}

// Pódio paginado - preserva o dense rank e mostra `pageSize` itens por página.
function renderPodioInsightsPaginated(containerId, lista, scopeId, pageSize = 5) {
  const container = document.getElementById(containerId)
  if (!container) return
  if (!lista.length) {
    container.innerHTML = `<ol class="rank-list"><li class="rank-list__empty">Nenhum servidor com presença ainda.</li></ol>`
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
    container.innerHTML = `
      <ol class="rank-list">${slice.map(renderPodioItem).join("")}</ol>
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

// ================ SERVIDORES (sub-aba de Participantes) ================
function renderViewServidores() {
  const view = document.getElementById("view-servidores")
  const eventos = state.data.eventos

  // Lista completa de servidores ordenada por presenças (empates por nome
  // em ordem alfabética). Sem pódio/medalhas - elas ficam exclusivas em
  // Visão Geral > Insights. Aqui é a tabela completa de TODOS os servidores
  // com inscrição, paginada.
  const ordenados = agregarServidores(eventos)
    .filter(s => s.totalEventos >= 1)
    .sort((a, b) =>
      b.totalPresentes - a.totalPresentes ||
      b.totalEventos - a.totalEventos ||
      (a.nome || "").localeCompare(b.nome || "", "pt-BR")
    )

  // Anexa um dense rank baseado em totalPresentes (empatados compartilham
  // o rank). Mesma lógica usada em Visão Geral > Insights > Top servidores.
  let rank = 0
  let ultimaContagem = null
  const lista = ordenados.map(s => {
    if (s.totalPresentes !== ultimaContagem) {
      rank += 1
      ultimaContagem = s.totalPresentes
    }
    return { ...s, rank }
  })

  view.innerHTML = `
    <div class="card">
      <div class="card__header">
        <div>
          <h3><i class="fas fa-list-ol"></i> Lista completa de servidores</h3>
          <p>Todos os servidores que se inscreveram em algum evento, ordenados por presenças.</p>
        </div>
        <span class="card__header-meta" id="srvMeta">${lista.length} servidor(es)</span>
      </div>
      <div class="filter" style="margin-bottom: var(--space-3);">
        <label for="srvBusca">Buscar</label>
        <input type="search" id="srvBusca" placeholder="nome do servidor ou secretaria" />
      </div>
      <div id="srvListaHost"></div>
    </div>
  `

  let filtroAtual = lista
  const draw = () => {
    renderDemaisServidores("srvListaHost", filtroAtual, "servidores-lista", 10)
    document.getElementById("srvMeta").textContent = `${filtroAtual.length} servidor(es)`
  }
  draw()

  document.getElementById("srvBusca").addEventListener("input", e => {
    const q = e.target.value.toLowerCase().trim()
    filtroAtual = !q ? lista : lista.filter(s =>
      (s.nome || "").toLowerCase().includes(q) ||
      (s.secretaria || "").toLowerCase().includes(q)
    )
    state.pagerPages["servidores-lista"] = 1
    draw()
  })
}

// Tabela paginada da lista completa de servidores. Mostra #, Nome,
// Secretaria, Inscrições, Presenças e Taxa - sem Cargo e sem Email.
function renderDemaisServidores(containerId, lista, scopeId, pageSize = 10) {
  const container = document.getElementById(containerId)
  if (!container) return
  const totalPages = Math.max(1, Math.ceil(lista.length / pageSize))
  const cur = state.pagerPages[scopeId] || 1
  if (cur > totalPages) state.pagerPages[scopeId] = 1
  if (!state.pagerPages[scopeId]) state.pagerPages[scopeId] = 1

  const renderRows = (slice, offset) => {
    if (!slice.length) return `<tr><td colspan="6" class="empty-cell">Nenhum servidor encontrado.</td></tr>`
    return slice.map((s, i) => {
      const pos = offset + i + 1
      const taxa = s.totalEventos ? ((s.totalPresentes / s.totalEventos) * 100).toFixed(0) + "%" : "-"
      // Dense rank: empates compartilham a medalha. 1º ouro, 2º prata, 3º bronze.
      // Demais (rank > 3 ou sem rank) sem cor.
      const r = s.rank
      const medalCls = r === 1 ? "row-medal-gold"
        : r === 2 ? "row-medal-silver"
        : r === 3 ? "row-medal-bronze"
        : ""
      const medalIcon = r != null && r <= 3 ? `<i class="fas fa-medal" style="margin-right:6px;"></i>` : ""
      return `
        <tr class="${medalCls}">
          <td class="cell-num">${medalIcon}${pos}</td>
          <td class="cell-name"><a class="servidor-link" data-servidor-chave="${escapeHtml(s.chave || "")}" tabindex="0" role="button">${escapeHtml(s.nome || "-")}</a></td>
          <td>${escapeHtml(s.secretaria || "-")}</td>
          <td class="cell-num">${s.totalEventos}</td>
          <td class="cell-num"><b class="green">${s.totalPresentes}</b></td>
          <td class="cell-num">${taxa}</td>
        </tr>
      `
    }).join("")
  }

  const draw = () => {
    const page = state.pagerPages[scopeId] || 1
    const slice = lista.slice((page - 1) * pageSize, page * pageSize)
    const from = lista.length ? (page - 1) * pageSize + 1 : 0
    const to = Math.min(page * pageSize, lista.length)
    container.innerHTML = `
      <div class="table-scroll">
        <table class="data">
          <thead>
            <tr>
              <th style="width:54px;">#</th>
              <th>Servidor</th>
              <th>Secretaria</th>
              <th>Inscrições</th>
              <th>Presenças</th>
              <th>Taxa</th>
            </tr>
          </thead>
          <tbody>${renderRows(slice, (page - 1) * pageSize)}</tbody>
        </table>
      </div>
      ${lista.length > pageSize ? `
        <div class="pager" data-pager-scope="${scopeId}">
          <span class="pager__info"><b>${from}-${to}</b> de <b>${lista.length}</b></span>
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

// ================ CARGOS (sub-aba de Pessoas) ================
function renderViewCargos() {
  const view = document.getElementById("view-cargos")
  const eventos = state.data.eventos
  const cargos = agregarCargos(eventos)

  view.innerHTML = `
    <div class="grid-2 secretarias-grid">
      <div class="card">
        <div class="card__header"><div><h3><i class="fas fa-chart-pie"></i> Distribuição por cargo</h3><p>Top 10 cargos, sem agrupamento em "outros".</p></div></div>
        <div class="chart-wrap lg"><canvas id="chartCargos"></canvas></div>
      </div>
      <div class="table-wrap" style="margin-bottom:0;">
        <div class="table-wrap__head">
          <h3><i class="fas fa-list-ol"></i> Ranking detalhado</h3>
          <span class="card__header-meta">${cargos.length} cargo(s)</span>
        </div>
        <div id="cargosRankHost"></div>
      </div>
    </div>
  `

  // Ranking paginado 10 em 10
  const totalCargos = cargos.reduce((s, x) => s + x.value, 0)
  renderCargosPaginated("cargosRankHost", cargos, totalCargos, "cargos-rank", 10)

  // Donut top 10 no mesmo estilo de pieTurmas (Distribuição por turma)
  pieCategorias("chartCargos", cargos.slice(0, 10), "Nenhum participante tem cargo registrado nas planilhas.")
}

function renderCargosPaginated(containerId, cargos, totalGlobal, scopeId, pageSize = 10) {
  const container = document.getElementById(containerId)
  if (!container) return
  if (!cargos.length) {
    container.innerHTML = `<div class="table-scroll"><table class="data"><thead><tr><th>#</th><th>Cargo</th><th>Inscrições</th><th>Participação</th></tr></thead><tbody><tr><td colspan="4" class="empty-cell">Sem cargos informados.</td></tr></tbody></table></div>`
    return
  }
  const totalPages = Math.max(1, Math.ceil(cargos.length / pageSize))
  const cur = state.pagerPages[scopeId] || 1
  if (cur > totalPages) state.pagerPages[scopeId] = 1
  if (!state.pagerPages[scopeId]) state.pagerPages[scopeId] = 1

  const draw = () => {
    const page = state.pagerPages[scopeId] || 1
    const slice = cargos.slice((page - 1) * pageSize, page * pageSize)
    const from = (page - 1) * pageSize + 1
    const to = Math.min(page * pageSize, cargos.length)
    container.innerHTML = `
      <div class="table-scroll">
        <table class="data">
          <thead><tr><th>#</th><th>Cargo</th><th>Inscrições</th><th>Participação</th></tr></thead>
          <tbody>
            ${slice.map((c, i) => {
              const pos = (page - 1) * pageSize + i + 1
              const pct = totalGlobal ? ((c.value / totalGlobal) * 100).toFixed(1).replace(".", ",") + "%" : "-"
              return `<tr>
                <td class="cell-num">${pos}</td>
                <td class="cell-name">${escapeHtml(c.label)}</td>
                <td class="cell-num">${c.value}</td>
                <td class="cell-num">${pct}</td>
              </tr>`
            }).join("")}
          </tbody>
        </table>
      </div>
      ${cargos.length > pageSize ? `
        <div class="pager" data-pager-scope="${scopeId}">
          <span class="pager__info"><b>${from}–${to}</b> de <b>${cargos.length}</b></span>
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

// ================ SECRETARIAS ================
function renderViewSecretarias() {
  const { data } = state
  const ranking = rankingSecretarias(data.eventos)

  const view = document.getElementById("view-secretarias")
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

    <div class="grid-2 secretarias-grid">
      <div class="card">
        <div class="card__header"><div><h3>Distribuição global</h3><p>Inscrições por secretaria (todos os eventos).</p></div></div>
        <div class="chart-wrap" id="secChartWrap"><canvas id="secChart"></canvas></div>
      </div>
      <div class="table-wrap" id="secRankingWrap" style="margin-bottom:0;">
        <div class="table-wrap__head">
          <h3><i class="fas fa-list-ol"></i> Ranking detalhado</h3>
          <span class="card__header-meta">${ranking.length} secretaria(s)</span>
        </div>
        ${renderSecretariasTable(ranking)}
      </div>
    </div>
  `
  // Tabela com altura natural; o CSS Grid (.secretarias-grid) iguala os
  // dois cards automaticamente via align-items: stretch. O gráfico usa
  // o card pai como referência de altura (100%).
  const tableWrap = document.getElementById("secRankingWrap")
  if (tableWrap) {
    const scroll = tableWrap.querySelector(".table-scroll")
    if (scroll) {
      scroll.style.maxHeight = "none"
      scroll.style.overflow = "visible"
    }
  }
  barSecretarias("secChart", ranking, { limit: 15 })
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
          <div><h3><i class="fas fa-check-circle" style="color:var(--green-500,#4DAD33);"></i> Presentes</h3><p>Quem fez check-in.</p></div>
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

function getReportDatasets() {
  const f = state.reportFilters
  let evs = state.data.eventos
  if (f.eventoId) evs = evs.filter(e => e.id === f.eventoId)

  const secAgg = {}
  evs.forEach(e => {
    Object.entries(e.secretarias || {}).forEach(([k, v]) => {
      if (f.secretaria && k !== f.secretaria) return
      secAgg[k] = (secAgg[k] || 0) + v
    })
  })
  const ranking = Object.entries(secAgg)
    .map(([nome, qtd]) => ({ nome, qtd }))
    .sort((a, b) => b.qtd - a.qtd)
  const parts = collectParticipantes()
  return { evs, ranking, parts }
}

// ---- Charts compartilhados nos exports de Relatórios ----
async function buildRelatorioCharts(evs, ranking) {
  if (!window.Chart || !evs.length) return {}
  const evLabels = evs.map(e => e.title.length > 26 ? e.title.slice(0, 24) + "…" : e.title)
  const inscritos = evs.map(e => e.totalInscritos || 0)
  const presentes = evs.map(e => e.totalPresentes || 0)
  const totIns = inscritos.reduce((a, b) => a + b, 0)
  const totPres = presentes.reduce((a, b) => a + b, 0)
  const totAus = Math.max(0, totIns - totPres)
  const top = ranking.slice(0, 10)

  const chEventos = await renderChartToImage("bar", {
    data: {
      labels: evLabels,
      datasets: [
        { label: "Inscritos", data: inscritos, backgroundColor: MODELO_CHART.navy, borderWidth: 0 },
        { label: "Presentes", data: presentes, backgroundColor: MODELO_CHART.blueMid, borderWidth: 0 }
      ]
    },
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

  const chPresenca = await renderChartToImage("doughnut", {
    data: { labels: ["Presentes", "Ausentes"], datasets: [{ data: [totPres, totAus], backgroundColor: [MODELO_CHART.navy, MODELO_CHART.blueLighter], borderWidth: 2, borderColor: "#fff" }] },
    options: {
      plugins: {
        legend: { position: "bottom", labels: { font: { family: MODELO_CHART.font, size: 13 }, color: MODELO_CHART.text } },
        title: { display: true, text: "Presença Consolidada", font: { size: 16, weight: "bold", family: MODELO_CHART.font }, color: MODELO_CHART.navy, padding: { bottom: 12 } },
        datalabels: { color: "#fff", font: { weight: "bold", size: 14, family: MODELO_CHART.font }, formatter: (v, ctx) => { const t = ctx.dataset.data.reduce((a, b) => a + b, 0); return t ? `${v}\n${((v / t) * 100).toFixed(1)}%` : v } }
      }
    }
  }, 700, 520)

  const chSec = top.length ? await renderChartToImage("bar", {
    data: { labels: top.map(r => r.nome.length > 32 ? r.nome.slice(0, 30) + "…" : r.nome), datasets: [{ data: top.map(r => r.qtd), backgroundColor: modeloGradedColors(top.map(r => r.qtd)), borderWidth: 0, barPercentage: 0.75, categoryPercentage: 0.8 }] },
    options: {
      indexAxis: "y",
      scales: {
        x: { beginAtZero: true, title: { display: true, text: "Inscrições", font: { family: MODELO_CHART.font, size: 13, weight: "600" }, color: MODELO_CHART.text }, ticks: { precision: 0, font: { family: MODELO_CHART.font, size: 12 }, color: MODELO_CHART.textMuted }, grid: { color: MODELO_CHART.grid } },
        y: { ticks: { font: { family: MODELO_CHART.font, size: 11 }, color: MODELO_CHART.text }, grid: { display: false } }
      },
      plugins: {
        legend: { display: false },
        title: { display: true, text: "Top Secretarias por Inscrições", font: { size: 16, weight: "bold", family: MODELO_CHART.font }, color: MODELO_CHART.navy, padding: { bottom: 12 } },
        datalabels: { anchor: "end", align: "end", offset: 6, color: MODELO_CHART.navy, font: { weight: "bold", size: 12, family: MODELO_CHART.font }, formatter: v => v }
      }
    }
  }, 1100, Math.max(360, 100 + top.length * 36)) : null

  return { chEventos, chPresenca, chSec, totIns, totPres, totAus }
}

function exportCsv() {
  const { parts, evs, ranking } = getReportDatasets()
  if (!parts.length && !evs.length) {
    showAlert({ title: "Nada para exportar", message: "Nenhum participante para exportar com os filtros atuais.", type: "warn" })
    return
  }
  const totIns = evs.reduce((s, e) => s + (e.totalInscritos || 0), 0)
  const totPres = evs.reduce((s, e) => s + (e.totalPresentes || 0), 0)
  const totFalt = totIns - totPres
  const taxa = totIns ? ((totPres / totIns) * 100).toFixed(1).replace(".", ",") + "%" : "-"
  const presentes = parts.filter(p => p.presente)
  const faltantes = parts.filter(p => !p.presente)
  const dataGer = new Date().toLocaleString("pt-BR")

  const rows = [
    ["======================================================================"],
    ["  ESCOLA DE GOVERNO · PREFEITURA MUNICIPAL DE PEDRO LEOPOLDO"],
    ["  Relatório Consolidado de Eventos e Participação"],
    ["======================================================================"],
    [`Gerado em: ${dataGer}`],
    [`Eventos no recorte: ${evs.length}`],
    [`Inscritos: ${totIns} · Presentes: ${totPres} · Faltantes: ${totFalt} · Taxa de presença: ${taxa}`],
    [""],
    ["----------------------------------------------------------------------"],
    ["EVENTOS"],
    ["----------------------------------------------------------------------"],
    ["Evento", "Data", "Vagas", "Inscritos", "Presentes", "Faltantes", "Taxa de Presença (%)", "Taxa de Ocupação (%)"],
    ...evs.map(e => [e.title, e.date || "", e.vagas ?? "", e.totalInscritos, e.totalPresentes, e.totalAusentes, e.taxaPresenca ?? "", e.taxaOcupacao ?? ""]),
    [""],
    ["----------------------------------------------------------------------"],
    ["SECRETARIAS"],
    ["----------------------------------------------------------------------"],
    ["#", "Secretaria", "Inscrições"],
    ...ranking.map((r, i) => [i + 1, r.nome, r.qtd]),
    [""],
    ["----------------------------------------------------------------------"],
    [`PRESENTES (${presentes.length})`],
    ["----------------------------------------------------------------------"],
    ["Evento", "Nome", "E-mail", "Turma", "Secretaria", "Cargo", "Data Check-in"],
    ...presentes.map(p => [p.eventoTitle, p.nome, p.email || "", p.turma || "", p.secretaria || "", p.cargo || "", p.dataCheckin || ""]),
    [""],
    ["----------------------------------------------------------------------"],
    [`FALTANTES (${faltantes.length})`],
    ["----------------------------------------------------------------------"],
    ["Evento", "Nome", "E-mail", "Turma", "Secretaria", "Cargo", "Data Inscrição"],
    ...faltantes.map(p => [p.eventoTitle, p.nome, p.email || "", p.turma || "", p.secretaria || "", p.cargo || "", p.dataInscricao || ""]),
    [""],
    ["======================================================================"],
    [`Documento gerado automaticamente pelo Painel EGov · ${dataGer}`],
    ["======================================================================"]
  ]
  const csv = rows
    .map(r =>
      r
        .map(c => {
          const s = String(c ?? "").replace(/"/g, '""')
          return /[",;\n]/.test(s) ? `"${s}"` : s
        })
        .join(";")
    )
    .join("\n")
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })
  triggerDownload(blob, `relatorio-egov-${new Date().toISOString().slice(0, 10)}.csv`)
}

async function exportXlsx() {
  const { evs, ranking, parts } = getReportDatasets()
  if (!evs.length && !ranking.length && !parts.length) {
    showAlert({ title: "Nada para exportar", message: "Não há dados para exportar com os filtros atuais.", type: "warn" })
    return
  }
  if (!window.ExcelJS) {
    showAlert({ title: "Biblioteca ausente", message: "ExcelJS não foi carregada. Recarregue a página.", type: "warn" })
    return
  }
  const charts = await buildRelatorioCharts(evs, ranking)
  const brand = await loadBrandAssets()
  const wb = new window.ExcelJS.Workbook()
  wb.creator = "Escola de Governo · Pedro Leopoldo"
  wb.company = "Prefeitura Municipal de Pedro Leopoldo"
  wb.title = "Relatório Consolidado"
  wb.created = new Date()

  // Paleta EGov (mesma do PPTX): navy do brasão + verde EGov
  const NAVY = "FF1B2A4E"
  const GREEN = "FF4DAD33"
  const BLUE_SOFT = "FFE6EEF7"
  const BG_SOFT = "FFF5F8FB"
  const RED = "FFC0392B"
  const WHITE = "FFFFFFFF"
  const TEXT_MUTED = "FF5A6B85"

  const headerStyle = (sheet, color = NAVY) => {
    const r = sheet.getRow(1)
    r.font = { name: "Calibri", bold: true, color: { argb: WHITE }, size: 11 }
    r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } }
    r.height = 22
    r.alignment = { vertical: "middle" }
  }
  const stripeFill = { type: "pattern", pattern: "solid", fgColor: { argb: BG_SOFT } }
  const applyStripes = (sheet) => {
    for (let i = 2; i <= sheet.rowCount; i++) {
      if (i % 2 === 0) sheet.getRow(i).fill = stripeFill
    }
  }

  // ============== Sheet 1: Capa institucional ==============
  const cap = wb.addWorksheet("Capa", { views: [{ showGridLines: false }] })
  cap.columns = Array.from({ length: 10 }, () => ({ width: 12 }))
  cap.mergeCells("B2:J3")
  cap.getCell("B2").value = "Escola de Governo · Pedro Leopoldo"
  cap.getCell("B2").font = { name: "Calibri", size: 24, bold: true, color: { argb: NAVY } }
  cap.getCell("B2").alignment = { vertical: "middle" }
  cap.mergeCells("B4:J4")
  cap.getCell("B4").value = "Prefeitura Municipal de Pedro Leopoldo"
  cap.getCell("B4").font = { name: "Calibri", size: 13, color: { argb: TEXT_MUTED }, italic: true }
  cap.mergeCells("B6:J7")
  cap.getCell("B6").value = "RELATÓRIO CONSOLIDADO DE EVENTOS E PARTICIPAÇÃO"
  cap.getCell("B6").font = { name: "Calibri", size: 18, bold: true, color: { argb: NAVY } }
  cap.getCell("B6").alignment = { vertical: "middle" }
  cap.getCell("B9").value = `Gerado em ${new Date().toLocaleString("pt-BR")}`
  cap.getCell("B9").font = { name: "Calibri", size: 10, color: { argb: TEXT_MUTED }, italic: true }

  // Logo combo EGov + Pedro Leopoldo - aspect ratio preservado
  try {
    const logoId = wb.addImage({ base64: brand.comboLogo, extension: "png" })
    const fit = fitAspect(brand.dims.comboLogo.ratio, 320, 90)
    cap.addImage(logoId, { tl: { col: 7, row: 1 }, ext: { width: fit.w, height: fit.h } })
  } catch (_) {}

  // KPIs visíveis na capa
  const totIns = evs.reduce((s, e) => s + (e.totalInscritos || 0), 0)
  const totPres = evs.reduce((s, e) => s + (e.totalPresentes || 0), 0)
  const totFalt = totIns - totPres
  const taxa = totIns ? ((totPres / totIns) * 100).toFixed(1).replace(".", ",") + "%" : "-"
  const kpiRow = 12
  const kpis = [
    { label: "Eventos", value: evs.length, color: NAVY },
    { label: "Inscritos", value: totIns, color: NAVY },
    { label: "Presentes", value: totPres, color: GREEN },
    { label: "Faltantes", value: totFalt, color: RED },
    { label: "Taxa de presença", value: taxa, color: NAVY }
  ]
  kpis.forEach((k, i) => {
    const col = 2 + i * 2
    const cellLabel = cap.getCell(kpiRow, col)
    const cellValue = cap.getCell(kpiRow + 1, col)
    cap.mergeCells(kpiRow, col, kpiRow, col + 1)
    cap.mergeCells(kpiRow + 1, col, kpiRow + 1, col + 1)
    cellLabel.value = k.label.toUpperCase()
    cellLabel.font = { name: "Calibri", size: 10, bold: true, color: { argb: TEXT_MUTED } }
    cellLabel.alignment = { horizontal: "center", vertical: "middle" }
    cellValue.value = k.value
    cellValue.font = { name: "Calibri", size: 22, bold: true, color: { argb: k.color } }
    cellValue.alignment = { horizontal: "center", vertical: "middle" }
    cellValue.border = { top: { style: "thick", color: { argb: k.color } } }
  })
  cap.getRow(kpiRow + 1).height = 30

  // ============== Sheet 2: Gráficos ==============
  const gSheet = wb.addWorksheet("Gráficos", { views: [{ showGridLines: false }] })
  gSheet.getCell("B2").value = "Visão Gráfica do Recorte"
  gSheet.getCell("B2").font = { name: "Calibri", size: 18, bold: true, color: { argb: NAVY } }
  gSheet.getCell("B3").value = `Gerado em ${new Date().toLocaleString("pt-BR")}`
  gSheet.getCell("B3").font = { name: "Calibri", size: 10, color: { argb: TEXT_MUTED }, italic: true }
  let row = 5
  const addImg = async (dataUrl, w, h) => {
    if (!dataUrl) return
    const id = wb.addImage({ base64: dataUrl, extension: "png" })
    gSheet.addImage(id, { tl: { col: 1, row: row - 1 }, ext: { width: w, height: h } })
    row += Math.ceil(h / 20) + 2
  }
  await addImg(charts.chEventos, 720, 340)
  await addImg(charts.chPresenca, 460, 340)
  if (charts.chSec) await addImg(charts.chSec, 720, Math.max(240, 80 + (ranking.slice(0, 10).length) * 24))
  gSheet.getColumn(2).width = 110

  // ============== Sheet 3: Eventos ==============
  const sEv = wb.addWorksheet("Eventos")
  sEv.columns = [
    { header: "Evento", key: "title", width: 42 },
    { header: "Data", key: "date", width: 12 },
    { header: "Local", key: "local", width: 30 },
    { header: "Vagas", key: "vagas", width: 8 },
    { header: "Inscritos", key: "ins", width: 11 },
    { header: "Presentes", key: "pres", width: 11 },
    { header: "Faltantes", key: "aus", width: 11 },
    { header: "Taxa Presença (%)", key: "tp", width: 18 },
    { header: "Taxa Ocupação (%)", key: "to", width: 18 },
    { header: "Status", key: "st", width: 12 }
  ]
  headerStyle(sEv)
  evs.forEach(e => sEv.addRow({ title: e.title, date: e.date || "", local: e.local || "", vagas: e.vagas ?? "", ins: e.totalInscritos, pres: e.totalPresentes, aus: e.totalAusentes, tp: e.taxaPresenca ?? "", to: e.taxaOcupacao ?? "", st: e.status }))
  applyStripes(sEv)

  // ============== Sheet 4: Secretarias ==============
  const sSec = wb.addWorksheet("Secretarias")
  sSec.columns = [{ header: "#", key: "i", width: 6 }, { header: "Secretaria", key: "n", width: 50 }, { header: "Inscrições", key: "q", width: 14 }]
  headerStyle(sSec)
  ranking.forEach((r, i) => sSec.addRow({ i: i + 1, n: r.nome, q: r.qtd }))
  applyStripes(sSec)

  // ============== Sheet 5: Presentes ==============
  const presentes = parts.filter(p => p.presente)
  const sPres = wb.addWorksheet("Presentes")
  sPres.columns = [
    { header: "Evento", key: "ev", width: 35 },
    { header: "Nome", key: "n", width: 30 },
    { header: "E-mail", key: "e", width: 30 },
    { header: "Turma", key: "t", width: 16 },
    { header: "Secretaria", key: "s", width: 30 },
    { header: "Cargo", key: "c", width: 22 },
    { header: "Matrícula", key: "m", width: 14 },
    { header: "Data Check-in", key: "dc", width: 18 },
    { header: "Data Inscrição", key: "di", width: 18 }
  ]
  headerStyle(sPres, GREEN)
  presentes.forEach(p => sPres.addRow({ ev: p.eventoTitle, n: p.nome, e: p.email || "", t: p.turma || "", s: p.secretaria || "", c: p.cargo || "", m: p.matricula || "", dc: p.dataCheckin || "", di: p.dataInscricao || "" }))
  applyStripes(sPres)

  // ============== Sheet 6: Faltantes ==============
  const faltantes = parts.filter(p => !p.presente)
  const sFalt = wb.addWorksheet("Faltantes")
  sFalt.columns = [
    { header: "Evento", key: "ev", width: 35 },
    { header: "Nome", key: "n", width: 30 },
    { header: "E-mail", key: "e", width: 30 },
    { header: "Turma", key: "t", width: 16 },
    { header: "Secretaria", key: "s", width: 30 },
    { header: "Cargo", key: "c", width: 22 },
    { header: "Matrícula", key: "m", width: 14 },
    { header: "Data Inscrição", key: "di", width: 18 }
  ]
  headerStyle(sFalt, RED)
  faltantes.forEach(p => sFalt.addRow({ ev: p.eventoTitle, n: p.nome, e: p.email || "", t: p.turma || "", s: p.secretaria || "", c: p.cargo || "", m: p.matricula || "", di: p.dataInscricao || "" }))
  applyStripes(sFalt)

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  triggerDownload(blob, `relatorio-egov-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

async function exportPdf() {
  const { evs, ranking, parts } = getReportDatasets()
  if (!evs.length && !ranking.length && !parts.length) {
    showAlert({ title: "Nada para exportar", message: "Não há dados para exportar com os filtros atuais.", type: "warn" })
    return
  }
  const charts = await buildRelatorioCharts(evs, ranking)
  const brand = await loadBrandAssets()
  const { jsPDF } = window.jspdf
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()

  // Paleta EGov (mesma do PPTX)
  const NAVY = [27, 42, 78]
  const GREEN = [77, 173, 51]
  const TEXT_MUTED = [90, 107, 133]
  const BG_SOFT = [245, 248, 251]

  // KPIs do recorte
  const totIns = evs.reduce((s, e) => s + (e.totalInscritos || 0), 0)
  const totPres = evs.reduce((s, e) => s + (e.totalPresentes || 0), 0)
  const totFalt = totIns - totPres
  const taxa = totIns ? ((totPres / totIns) * 100).toFixed(1).replace(".", ",") + "%" : "-"

  // ============== PÁGINA 1: CAPA institucional limpa ==============
  // Hero gradient ocupando a faixa do topo
  try { doc.addImage(brand.hero, "PNG", 0, 0, pageW, 90) } catch (_) {}
  doc.setFillColor(255, 255, 255)
  doc.rect(0, 90, pageW, pageH - 90, "F")

  // Logo combo EGov + Pedro Leopoldo - centralizado, aspect ratio preservado
  try {
    const fit = fitAspect(brand.dims.comboLogo.ratio, 110, 38)
    doc.addImage(brand.comboLogo, "PNG", (pageW - fit.w) / 2, 30, fit.w, fit.h)
  } catch (_) {}

  // Nome da prefeitura - centralizado abaixo do logo (sem charSpace para evitar corte na margem)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(14)
  doc.setTextColor(...NAVY)
  doc.text("PREFEITURA MUNICIPAL DE PEDRO LEOPOLDO", pageW / 2, 112, { align: "center" })

  // Divisor verde centralizado
  doc.setDrawColor(...GREEN)
  doc.setLineWidth(1)
  doc.line(pageW / 2 - 30, 118, pageW / 2 + 30, 118)

  // Subtítulo institucional
  doc.setFont("helvetica", "normal")
  doc.setFontSize(13)
  doc.setTextColor(...TEXT_MUTED)
  doc.text("Escola de Governo", pageW / 2, 130, { align: "center" })

  // Título "Relatório Consolidado" - centro visual da capa
  doc.setFont("helvetica", "bold")
  doc.setFontSize(26)
  doc.setTextColor(...NAVY)
  doc.text("Relatório Consolidado", pageW / 2, 165, { align: "center" })
  doc.setFont("helvetica", "normal")
  doc.setFontSize(12)
  doc.setTextColor(...TEXT_MUTED)
  doc.text("de Eventos e Participação", pageW / 2, 174, { align: "center" })

  // Data de geração - logo abaixo do título
  doc.setFont("helvetica", "italic")
  doc.setFontSize(11)
  doc.setTextColor(...TEXT_MUTED)
  doc.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, pageW / 2, 190, { align: "center" })

  // Assinatura institucional ao final da capa (sem charSpace para evitar corte)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(11)
  doc.setTextColor(...NAVY)
  doc.text("ESCOLA DE GOVERNO  ·  PEDRO LEOPOLDO", pageW / 2, pageH - 22, { align: "center" })

  // ============== Header e Footer institucionais (páginas internas) ==============
  const drawHeaderFooter = () => {
    // Header
    doc.setFillColor(...NAVY)
    doc.rect(0, 0, pageW, 14, "F")
    doc.setTextColor(255, 255, 255)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    // "Escola de Governo · Pedro Leopoldo" CENTRALIZADO no header
    doc.text("Escola de Governo · Pedro Leopoldo", pageW / 2, 9, { align: "center" })
    doc.setDrawColor(...GREEN)
    doc.setLineWidth(0.5)
    doc.line(0, 14, pageW, 14)
    // Footer institucional - "Prefeitura Municipal" CENTRALIZADO
    doc.setFillColor(...BG_SOFT)
    doc.rect(0, pageH - 10, pageW, 10, "F")
    doc.setTextColor(...TEXT_MUTED)
    doc.setFontSize(9)
    doc.setFont("helvetica", "normal")
    doc.text("Prefeitura Municipal de Pedro Leopoldo", pageW / 2, pageH - 4, { align: "center" })
  }

  // ============== PÁGINA 2: KPIs + Sumário ==============
  doc.addPage()
  drawHeaderFooter()

  // Título da página
  doc.setFont("helvetica", "bold")
  doc.setFontSize(20)
  doc.setTextColor(...NAVY)
  doc.text("Indicadores Consolidados", pageW / 2, 40, { align: "center" })

  // Divisor verde
  doc.setDrawColor(...GREEN)
  doc.setLineWidth(0.8)
  doc.line(pageW / 2 - 30, 46, pageW / 2 + 30, 46)

  // KPIs em 5 cards centralizados
  const drawCapaKpi = (x, y, w, label, value, accent) => {
    doc.setDrawColor(...accent)
    doc.setLineWidth(1.5)
    doc.line(x, y, x + w, y) // topo colorido
    doc.setDrawColor(200, 210, 225)
    doc.setLineWidth(0.2)
    doc.line(x, y + 30, x + w, y + 30)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(24)
    doc.setTextColor(...accent)
    doc.text(String(value), x + w / 2, y + 15, { align: "center" })
    doc.setFontSize(9)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(...TEXT_MUTED)
    doc.text(label, x + w / 2, y + 24, { align: "center" })
  }
  const kpiW = 36
  const kpiY = 90
  const kpiX0 = (pageW - (kpiW * 5 + 4 * 3)) / 2
  drawCapaKpi(kpiX0 + 0 * (kpiW + 3), kpiY, kpiW, "EVENTOS",       evs.length, NAVY)
  drawCapaKpi(kpiX0 + 1 * (kpiW + 3), kpiY, kpiW, "INSCRITOS",     totIns,     NAVY)
  drawCapaKpi(kpiX0 + 2 * (kpiW + 3), kpiY, kpiW, "PRESENTES",     totPres,    GREEN)
  drawCapaKpi(kpiX0 + 3 * (kpiW + 3), kpiY, kpiW, "FALTANTES",     totFalt,    [192, 57, 43])
  drawCapaKpi(kpiX0 + 4 * (kpiW + 3), kpiY, kpiW, "TAXA PRESENÇA", taxa,       NAVY)

  // Sumário do relatório
  doc.setFont("helvetica", "bold")
  doc.setFontSize(13)
  doc.setTextColor(...NAVY)
  doc.text("Sumário", 14, 160)
  doc.setDrawColor(...NAVY)
  doc.setLineWidth(0.3)
  doc.line(14, 162, 40, 162)

  const sumario = [
    "1. Inscritos x Presentes por Evento",
    "2. Distribuição de Presença Consolidada",
    "3. Top Secretarias por Inscrições",
    "4. Quadro Consolidado de Eventos",
    "5. Ranking de Secretarias",
    `6. Presentes (${parts.filter(p => p.presente).length})`,
    `7. Faltantes (${parts.filter(p => !p.presente).length})`
  ]
  doc.setFont("helvetica", "normal")
  doc.setFontSize(11)
  doc.setTextColor(...NAVY)
  sumario.forEach((line, i) => {
    doc.text(line, 20, 175 + i * 8)
  })

  // ============== PÁGINAS DE GRÁFICOS (1 por página) ==============
  // Preserva o aspect ratio original do canvas para não distorcer barras e textos.
  const drawChartPage = (title, dataUrl, srcW, srcH) => {
    if (!dataUrl) return
    doc.addPage()
    drawHeaderFooter()
    doc.setFont("helvetica", "bold")
    doc.setFontSize(14)
    doc.setTextColor(...NAVY)
    doc.text(title, pageW / 2, 28, { align: "center" })
    doc.setDrawColor(...GREEN)
    doc.setLineWidth(0.6)
    doc.line(pageW / 2 - 24, 32, pageW / 2 + 24, 32)
    // Área útil entre cabeçalho (~36) e rodapé (~12)
    const maxW = pageW - 28
    const maxH = pageH - 80
    const ratio = srcW / srcH
    let w = maxW
    let h = w / ratio
    if (h > maxH) { h = maxH; w = h * ratio }
    const x = (pageW - w) / 2
    const y = 42 + (maxH - h) / 2
    doc.addImage(dataUrl, "PNG", x, y, w, h)
  }

  drawChartPage("Inscritos x Presentes por Evento", charts.chEventos, 1100, 520)
  drawChartPage("Distribuição de Presença Consolidada", charts.chPresenca, 700, 520)
  drawChartPage("Top Secretarias por Inscrições", charts.chSec, 1100, Math.max(360, 100 + (ranking?.length ? Math.min(ranking.length, 10) : 6) * 36))

  // ============== Página: Quadro Consolidado de Eventos ==============
  doc.addPage()
  drawHeaderFooter()
  doc.setTextColor(...NAVY)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(13)
  doc.text("Quadro Consolidado de Eventos", 14, 26)

  doc.autoTable({
    startY: 30,
    head: [["Evento", "Data", "Vagas", "Inscr.", "Pres.", "Falt.", "Presença", "Ocupação"]],
    body: evs.map(e => [
      e.title.length > 38 ? e.title.slice(0, 36) + "..." : e.title,
      e.date ? new Date(e.date).toLocaleDateString("pt-BR") : "-",
      e.vagas ?? "-",
      e.totalInscritos,
      e.totalPresentes,
      e.totalAusentes,
      e.taxaPresenca != null ? e.taxaPresenca + "%" : "-",
      e.taxaOcupacao != null ? e.taxaOcupacao + "%" : "-"
    ]),
    styles: { fontSize: 10, cellPadding: 3, font: "helvetica" },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: BG_SOFT }
  })

  // ============== Página: Ranking de Secretarias ==============
  if (ranking.length) {
    doc.addPage()
    drawHeaderFooter()
    doc.setFont("helvetica", "bold")
    doc.setFontSize(13)
    doc.setTextColor(...NAVY)
    doc.text("Ranking de Secretarias", 14, 26)
    doc.autoTable({
      startY: 30,
      head: [["#", "Secretaria", "Inscrições"]],
      body: ranking.slice(0, 25).map((r, i) => [i + 1, r.nome, r.qtd]),
      styles: { fontSize: 10, cellPadding: 3 },
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: BG_SOFT },
      didDrawPage: drawHeaderFooter
    })
  }

  // ============== Página de Presentes ==============
  const presentes = parts.filter(p => p.presente)
  const faltantes = parts.filter(p => !p.presente)

  if (presentes.length) {
    doc.addPage()
    drawHeaderFooter()
    doc.setFillColor(...GREEN)
    doc.rect(14, 22, 4, 8, "F")
    doc.setFont("helvetica", "bold")
    doc.setFontSize(13)
    doc.setTextColor(...NAVY)
    doc.text(`Presentes (${presentes.length})`, 20, 28)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.setTextColor(...TEXT_MUTED)
    doc.text("Servidores que fizeram check-in no recorte.", 20, 33)
    doc.autoTable({
      startY: 38,
      head: [["Evento", "Nome", "Secretaria", "Turma", "Data Check-in"]],
      body: presentes.map(p => [
        p.eventoTitle.length > 24 ? p.eventoTitle.slice(0, 22) + "..." : p.eventoTitle,
        p.nome,
        p.secretaria || "-",
        p.turma || "-",
        p.dataCheckin || "-"
      ]),
      styles: { fontSize: 10, cellPadding: 3 },
      headStyles: { fillColor: GREEN, textColor: 255, fontStyle: "bold", fontSize: 11 },
      alternateRowStyles: { fillColor: BG_SOFT },
      didDrawPage: drawHeaderFooter
    })
  }

  // ============== Página de Faltantes ==============
  if (faltantes.length) {
    doc.addPage()
    drawHeaderFooter()
    doc.setFillColor(192, 57, 43)
    doc.rect(14, 22, 4, 8, "F")
    doc.setFont("helvetica", "bold")
    doc.setFontSize(13)
    doc.setTextColor(...NAVY)
    doc.text(`Faltantes (${faltantes.length})`, 20, 28)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.setTextColor(...TEXT_MUTED)
    doc.text("Inscritos que não compareceram - candidatos a campanha de reengajamento.", 20, 33)
    doc.autoTable({
      startY: 38,
      head: [["Evento", "Nome", "Secretaria", "Turma", "Data Inscrição"]],
      body: faltantes.map(p => [
        p.eventoTitle.length > 24 ? p.eventoTitle.slice(0, 22) + "..." : p.eventoTitle,
        p.nome,
        p.secretaria || "-",
        p.turma || "-",
        p.dataInscricao || "-"
      ]),
      styles: { fontSize: 10, cellPadding: 3 },
      headStyles: { fillColor: [192, 57, 43], textColor: 255, fontStyle: "bold", fontSize: 11 },
      alternateRowStyles: { fillColor: BG_SOFT },
      didDrawPage: drawHeaderFooter
    })
  }

  // Rodapé com paginação em todas as páginas (exceto capa)
  const total = doc.internal.getNumberOfPages()
  for (let i = 2; i <= total; i++) {
    doc.setPage(i)
    doc.setFontSize(9)
    doc.setTextColor(...TEXT_MUTED)
    doc.text(`Página ${i - 1} de ${total - 1}`, pageW - 14, pageH - 4, { align: "right" })
  }

  doc.save(`relatorio-egov-${new Date().toISOString().slice(0, 10)}.pdf`)
}

async function exportPptx() {
  const { evs, ranking, parts } = getReportDatasets()
  if (!evs.length && !ranking.length) {
    showAlert({ title: "Nada para exportar", message: "Não há dados para exportar com os filtros atuais.", type: "warn" })
    return
  }
  if (!window.PptxGenJS) {
    showAlert({ title: "Biblioteca ausente", message: "PptxGenJS não foi carregada. Recarregue a página.", type: "warn" })
    return
  }
  const charts = await buildRelatorioCharts(evs, ranking)
  const brand = await loadBrandAssets()

  const pptx = new window.PptxGenJS()
  pptx.layout = "LAYOUT_WIDE"
  pptx.author = "Escola de Governo · Pedro Leopoldo"
  pptx.company = "Prefeitura Municipal de Pedro Leopoldo"
  pptx.title = "Relatório Consolidado"

  buildEgovPptxMaster(pptx, brand, "Relatório Consolidado")

  // Capa institucional
  const sCover = pptx.addSlide()
  sCover.background = { color: EGOV_BRAND.white }
  sCover.addImage({ data: brand.hero, x: 0, y: 0, w: 13.333, h: 7.5, sizing: { type: "cover", w: 13.333, h: 7.5 } })
  sCover.addShape("rect", { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: EGOV_BRAND.white, transparency: 35 } })
  // Logo aspect ratio preservado - centralizada
  const sCoverFit = fitAspect(brand.dims.comboLogo.ratio, 5.4, 1.4)
  sCover.addImage({ data: brand.comboLogo, x: (13.333 - sCoverFit.w) / 2, y: 0.9, w: sCoverFit.w, h: sCoverFit.h })
  sCover.addText("PREFEITURA MUNICIPAL DE PEDRO LEOPOLDO", { x: 1, y: 2.4, w: 11.3, h: 0.5, fontFace: EGOV_BRAND.font, fontSize: 14, bold: true, color: EGOV_BRAND.navy, align: "center", charSpacing: 4 })
  sCover.addShape("line", { x: 5.4, y: 3.0, w: 2.5, h: 0, line: { color: EGOV_BRAND.green, width: 2 } })
  sCover.addText("Relatório Consolidado", { x: 1, y: 3.2, w: 11.3, h: 1.1, fontFace: EGOV_BRAND.font, fontSize: 48, bold: true, color: EGOV_BRAND.navy, align: "center" })
  sCover.addText(`${evs.length} evento(s) · ${parts.length} participante(s)`, { x: 1, y: 4.5, w: 11.3, h: 0.7, fontFace: EGOV_BRAND.font, fontSize: 22, italic: true, color: EGOV_BRAND.text, align: "center" })
  sCover.addText(new Date().toLocaleDateString("pt-BR"), { x: 1, y: 5.6, w: 11.3, h: 0.5, fontFace: EGOV_BRAND.font, fontSize: 16, color: EGOV_BRAND.textMuted, align: "center" })

  // Visão geral / KPIs
  const sK = pptx.addSlide({ masterName: "EGOV_MASTER" })
  egovSlideTitle(sK, "Visão Geral")
  const totIns = charts.totIns || 0, totPres = charts.totPres || 0, totAus = charts.totAus || 0
  const taxa = totIns ? ((totPres / totIns) * 100).toFixed(1).replace(".", ",") + "%" : "-"
  const kpi = (slide, x, label, value, accent) => {
    slide.addShape("roundRect", { x, y: 2.1, w: 2.8, h: 2.2, fill: { color: EGOV_BRAND.white }, line: { color: EGOV_BRAND.blueSoft, width: 1 }, rectRadius: 0.15 })
    slide.addShape("rect", { x, y: 2.1, w: 2.8, h: 0.1, fill: { color: accent } })
    slide.addText(String(value), { x, y: 2.35, w: 2.8, h: 1.2, fontFace: EGOV_BRAND.font, fontSize: 48, bold: true, color: accent, align: "center" })
    slide.addText(label, { x, y: 3.55, w: 2.8, h: 0.6, fontFace: EGOV_BRAND.font, fontSize: 15, color: EGOV_BRAND.textMuted, align: "center" })
  }
  kpi(sK, 0.7, "Eventos", evs.length, EGOV_BRAND.navy)
  kpi(sK, 3.7, "Inscritos", totIns, EGOV_BRAND.navyLight)
  kpi(sK, 6.7, "Presentes", totPres, EGOV_BRAND.green)
  kpi(sK, 9.7, "Taxa de presença", taxa, EGOV_BRAND.navyLight)
  sK.addText(`${totPres} servidores capacitados · ${totAus} ausências em todos os eventos consolidados.`, { x: 0.95, y: 5.5, w: 11.5, h: 0.5, fontFace: EGOV_BRAND.font, fontSize: 15, italic: true, color: EGOV_BRAND.text, align: "center" })

  if (charts.chEventos) {
    const s = pptx.addSlide({ masterName: "EGOV_MASTER" })
    egovSlideTitle(s, "Inscritos x Presentes por Evento")
    s.addImage({ data: charts.chEventos, x: 1.2, y: 1.75, w: 11, h: 5.0 })
  }
  if (charts.chPresenca) {
    const s = pptx.addSlide({ masterName: "EGOV_MASTER" })
    egovSlideTitle(s, "Presença Consolidada")
    s.addImage({ data: charts.chPresenca, x: 3.5, y: 1.75, w: 6.3, h: 5.0 })
  }
  if (charts.chSec) {
    const s = pptx.addSlide({ masterName: "EGOV_MASTER" })
    egovSlideTitle(s, "Top Secretarias por Inscrições")
    s.addImage({ data: charts.chSec, x: 1.2, y: 1.75, w: 11, h: 5.0 })
  }

  // Tabela de eventos
  const sT = pptx.addSlide({ masterName: "EGOV_MASTER" })
  egovSlideTitle(sT, "Quadro Consolidado de Eventos")
  const tableRows = [[
    { text: "Evento", options: { bold: true, color: EGOV_BRAND.white, fill: { color: EGOV_BRAND.navy }, fontFace: EGOV_BRAND.font, fontSize: 12 } },
    { text: "Data", options: { bold: true, color: EGOV_BRAND.white, fill: { color: EGOV_BRAND.navy }, fontFace: EGOV_BRAND.font, fontSize: 12, align: "center" } },
    { text: "Inscritos", options: { bold: true, color: EGOV_BRAND.white, fill: { color: EGOV_BRAND.navy }, fontFace: EGOV_BRAND.font, fontSize: 12, align: "center" } },
    { text: "Presentes", options: { bold: true, color: EGOV_BRAND.white, fill: { color: EGOV_BRAND.navy }, fontFace: EGOV_BRAND.font, fontSize: 12, align: "center" } },
    { text: "Presença", options: { bold: true, color: EGOV_BRAND.white, fill: { color: EGOV_BRAND.navy }, fontFace: EGOV_BRAND.font, fontSize: 12, align: "center" } }
  ]]
  evs.slice(0, 14).forEach((e, i) => {
    const bg = i % 2 === 0 ? EGOV_BRAND.white : EGOV_BRAND.bgSoft
    tableRows.push([
      { text: e.title, options: { fill: { color: bg }, fontFace: EGOV_BRAND.font, fontSize: 12, color: EGOV_BRAND.text } },
      { text: e.date ? new Date(e.date).toLocaleDateString("pt-BR") : "-", options: { fill: { color: bg }, fontFace: EGOV_BRAND.font, fontSize: 11, align: "center", color: EGOV_BRAND.text } },
      { text: String(e.totalInscritos), options: { fill: { color: bg }, fontFace: EGOV_BRAND.font, fontSize: 11, align: "center", color: EGOV_BRAND.text } },
      { text: String(e.totalPresentes), options: { fill: { color: bg }, fontFace: EGOV_BRAND.font, fontSize: 11, align: "center", color: EGOV_BRAND.text } },
      { text: e.taxaPresenca != null ? e.taxaPresenca + "%" : "-", options: { fill: { color: bg }, fontFace: EGOV_BRAND.font, fontSize: 11, align: "center", color: EGOV_BRAND.text, bold: true } }
    ])
  })
  sT.addTable(tableRows, { x: 0.7, y: 1.75, w: 11.9, colW: [5.7, 1.7, 1.5, 1.5, 1.5], border: { type: "solid", color: EGOV_BRAND.blueSoft, pt: 0.5 } })

  // ============ Slide Presentes / Faltantes ============
  const presentesAll = parts.filter(p => p.presente)
  const faltantesAll = parts.filter(p => !p.presente)

  // Layout calculado para não estourar o slide (slide útil: 1.75 a 7.0 = 5.25in)
  // Cabeçalho 1 linha + 13 linhas de corpo = 14 linhas × 0.36in = 5.04in. Sobra
  // margem de respiro antes do rodapé do master (7.18in).
  const PAGE_LIMIT = 13
  const HEADER_H = 0.4
  const ROW_H = 0.36

  const trunc = (s, n) => {
    s = String(s || "")
    return s.length > n ? s.slice(0, n - 1) + "..." : s
  }

  const addParticipantesSlides = (titulo, lista, headerColor, dataLabel, dataKey) => {
    if (!lista.length) return
    const pages = Math.ceil(lista.length / PAGE_LIMIT)
    for (let p = 0; p < pages; p++) {
      const slice = lista.slice(p * PAGE_LIMIT, (p + 1) * PAGE_LIMIT)
      const slide = pptx.addSlide({ masterName: "EGOV_MASTER" })
      egovSlideTitle(slide, pages > 1 ? `${titulo} (${p + 1}/${pages})` : `${titulo} (${lista.length})`)
      const headOpts = { bold: true, color: EGOV_BRAND.white, fill: { color: headerColor }, fontFace: EGOV_BRAND.font, fontSize: 12, valign: "middle" }
      const rows = [[
        { text: "Evento",      options: headOpts },
        { text: "Nome",        options: headOpts },
        { text: "Secretaria",  options: headOpts },
        { text: "Turma",       options: headOpts },
        { text: dataLabel,     options: headOpts }
      ]]
      slice.forEach((item, i) => {
        const bg = i % 2 === 0 ? EGOV_BRAND.white : EGOV_BRAND.bgSoft
        const cellOpts = { fill: { color: bg }, fontFace: EGOV_BRAND.font, fontSize: 10, color: EGOV_BRAND.text, valign: "middle" }
        rows.push([
          { text: trunc(item.eventoTitle, 26),       options: cellOpts },
          { text: trunc(item.nome, 26),              options: cellOpts },
          { text: trunc(item.secretaria || "-", 30), options: cellOpts },
          { text: trunc(item.turma || "-", 16),      options: cellOpts },
          { text: item[dataKey] || "-",              options: cellOpts }
        ])
      })
      // rowH como array: 1 header + N body
      const rowH = [HEADER_H, ...Array(slice.length).fill(ROW_H)]
      slide.addTable(rows, {
        x: 0.5, y: 1.7, w: 12.333,
        colW: [3.0, 2.8, 3.2, 1.6, 1.733],
        rowH,
        border: { type: "solid", color: EGOV_BRAND.blueSoft, pt: 0.5 }
      })
    }
  }

  addParticipantesSlides("Presentes",  presentesAll, "4DAD33", "Data Check-in",  "dataCheckin")
  addParticipantesSlides("Faltantes",  faltantesAll, "C0392B", "Data Inscrição", "dataInscricao")

  await pptx.writeFile({ fileName: `relatorio-egov-${new Date().toISOString().slice(0, 10)}.pptx` })
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

// ================ QR CODE ================
function renderViewQrCode() {
  const view = document.getElementById("view-qrcode")
  view.innerHTML = `
    <div class="qr-layout">
      <div class="card qr-form-card">
        <div class="card__header qr-form-header">
          <div>
            <h3><i class="fas fa-qrcode"></i> Gerador de QR Code</h3>
            <p>Preencha os campos abaixo para gerar.</p>
          </div>
          <span class="qr-size-badge"><i class="fas fa-expand"></i> 2000 px</span>
        </div>

        <div class="filter qr-field">
          <label for="qrName"><i class="fas fa-file-signature"></i> Nome do arquivo</label>
          <input type="text" id="qrName" placeholder="ex.: inscricoes-curso-gestao" />
        </div>

        <div class="filter qr-field">
          <label for="qrUrl"><i class="fas fa-link"></i> URL ou texto</label>
          <input type="text" id="qrUrl" placeholder="https://escoladegoverno.pedroleopoldo.mg.gov.br" value="" />
          <div class="qr-char-counter"><span id="qrCharCount">0</span> caracteres</div>
        </div>

        <div class="filter qr-field">
          <label for="qrBg"><i class="fas fa-palette"></i> Cor de fundo</label>
          <input type="color" id="qrBg" value="#ffffff" />
        </div>

        <div class="qr-actions">
          <button class="btn btn--accent btn--lg" id="qrCreate">
            <i class="fas fa-bolt"></i> Gerar QR Code
          </button>
          <button class="btn btn--lg" id="qrDownload" disabled>
            <i class="fas fa-download"></i> Baixar PNG
          </button>
        </div>

        <div id="qrFeedback" class="qr-feedback" hidden></div>
      </div>

      <div class="card qr-preview-card">
        <div class="card__header">
          <div>
            <h3><i class="fas fa-eye"></i> Pré-visualização</h3>
            <p>Pronto para impressão em alta resolução.</p>
          </div>
          <span class="qr-status-badge" id="qrStatusBadge" data-state="idle">
            <i class="fas fa-circle"></i> Aguardando
          </span>
        </div>
        <div class="qr-canvas-frame" id="qrFrame">
          <div class="qr-placeholder" id="qrPlaceholder">
            <div class="qr-placeholder-icon"><i class="fas fa-qrcode"></i></div>
            <p>Clique em <b>Gerar QR Code</b> para visualizar o resultado.</p>
          </div>
          <canvas id="qrCanvas" width="2000" height="2000" hidden></canvas>
        </div>
      </div>
    </div>
  `

  document.getElementById("qrCreate").addEventListener("click", generateQrCode)
  document.getElementById("qrDownload").addEventListener("click", downloadQrCode)

  const urlInput = document.getElementById("qrUrl")
  const charCount = document.getElementById("qrCharCount")
  urlInput.addEventListener("keydown", e => {
    if (e.key === "Enter") generateQrCode()
  })
  urlInput.addEventListener("input", () => {
    charCount.textContent = urlInput.value.length
  })
  document.getElementById("qrName").addEventListener("keydown", e => {
    if (e.key === "Enter") generateQrCode()
  })
}

function generateQrCode() {
  const url = document.getElementById("qrUrl").value.trim()
  const ecl = "H" // fixo: melhor correção de erro
  const color = "#000000" // fixo: preto
  const bg = document.getElementById("qrBg").value
  const feedback = document.getElementById("qrFeedback")
  const badge = document.getElementById("qrStatusBadge")
  const setBadge = (state, text, icon) => {
    if (!badge) return
    badge.dataset.state = state
    badge.innerHTML = `<i class="fas fa-${icon}"></i> ${text}`
  }

  if (!url) {
    feedback.hidden = false
    feedback.className = "qr-feedback is-error"
    feedback.innerHTML = '<i class="fas fa-circle-exclamation"></i> Informe uma URL ou texto.'
    setBadge("error", "Erro", "circle-exclamation")
    return
  }
  if (!window.QRCode) {
    feedback.hidden = false
    feedback.className = "qr-feedback is-error"
    feedback.innerHTML = '<i class="fas fa-circle-exclamation"></i> Biblioteca QR não carregou. Recarregue a página.'
    setBadge("error", "Erro", "circle-exclamation")
    return
  }
  setBadge("loading", "Gerando…", "spinner fa-spin")

  // qrcodejs renderiza num <div>; usamos um container temporário 1000x1000
  // e depois copiamos para o canvas 2000x2000 com nitidez.
  const tmp = document.createElement("div")
  tmp.style.position = "fixed"
  tmp.style.left = "-9999px"
  document.body.appendChild(tmp)

  const eclMap = {
    L: window.QRCode.CorrectLevel.L,
    M: window.QRCode.CorrectLevel.M,
    Q: window.QRCode.CorrectLevel.Q,
    H: window.QRCode.CorrectLevel.H
  }
  new window.QRCode(tmp, {
    text: url,
    width: 1000,
    height: 1000,
    colorDark: color,
    colorLight: bg,
    correctLevel: eclMap[ecl] || eclMap.Q
  })

  // qrcodejs gera um <img> (base64) - esperamos renderizar e desenhar no canvas 2000
  setTimeout(() => {
    const img = tmp.querySelector("img") || tmp.querySelector("canvas")
    if (!img) {
      document.body.removeChild(tmp)
      feedback.hidden = false
      feedback.className = "qr-feedback is-error"
      feedback.innerHTML = '<i class="fas fa-circle-exclamation"></i> Falha ao gerar o QR.'
      setBadge("error", "Erro", "circle-exclamation")
      return
    }
    const canvas = document.getElementById("qrCanvas")
    const ctx = canvas.getContext("2d")
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, 2000, 2000)

    const render = () => {
      ctx.drawImage(img, 0, 0, 2000, 2000)
      document.body.removeChild(tmp)
      canvas.hidden = false
      document.getElementById("qrPlaceholder").hidden = true
      document.getElementById("qrDownload").disabled = false
      feedback.hidden = false
      feedback.className = "qr-feedback is-success"
      feedback.innerHTML = '<i class="fas fa-circle-check"></i> QR Code gerado · 2000 × 2000 px'
      setBadge("ready", "Pronto", "circle-check")
    }
    if (img.tagName === "IMG" && !img.complete) {
      img.onload = render
    } else {
      render()
    }
  }, 40)
}

function downloadQrCode() {
  const canvas = document.getElementById("qrCanvas")
  if (!canvas || canvas.hidden) return
  canvas.toBlob(blob => {
    if (!blob) return
    // Prefere o nome informado pelo usuario; cai para a URL como fallback.
    const nomeInput = document.getElementById("qrName")?.value.trim() || ""
    const url = document.getElementById("qrUrl").value.trim() || "qrcode"
    const base = nomeInput || url.replace(/^https?:\/\//, "")
    const safe = base
      .replace(/[^a-z0-9]+/gi, "-")
      .slice(0, 60)
      .replace(/^-|-$/g, "")
    triggerDownload(blob, `${safe || "qrcode-egov"}.png`)
  }, "image/png")
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

  const planilhas = (state.certManifest && state.certManifest.planilhas) || []
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
    // Estima carga horária a partir do dateRaw (ex.: "Data: 24/04/2026 08h30 - 17h")
    let carga = ""
    if (evMeta?.dateRaw) {
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
    if (!ev || !ev.fonte) return
    const folder = ev.fonte.split("/").slice(0, -1).join("/")
    if (!folder) {
      status.innerHTML = `<p class="ar-event-summary__empty"><i class="fas fa-triangle-exclamation"></i> Evento sem pasta vinculada.</p>`
      return
    }
    status.innerHTML = `<p class="ar-event-summary__empty"><i class="fas fa-circle-notch fa-spin"></i> Procurando pesquisa...</p>`
    // tenta variações comuns do nome
    const tries = ["satisfacao.xlsx", "Satisfação.xlsx", "satisfação.xlsx", "Satisfacao.xlsx", "pesquisa.xlsx", "Pesquisa.xlsx"]
    let blob = null
    let usedName = null
    for (const name of tries) {
      const url = `assets/docs/relatorios/${encodeURI(folder)}/${encodeURIComponent(name)}`
      try {
        const r = await fetch(url)
        if (r.ok) {
          blob = await r.blob()
          usedName = name
          break
        }
      } catch (_) {}
    }
    if (!blob) {
      state.autoReport.pesquisa = null
      status.innerHTML = `<p class="ar-event-summary__empty"><i class="fas fa-triangle-exclamation"></i> Este evento não possui <b>satisfacao.xlsx</b>. Use a aba "Enviar planilha".</p>`
      updateAutoReportSummary()
      return
    }
    const file = new File([blob], usedName, { type: blob.type })
    handleAutoReportPesquisa(file, { fromEventId: id, displayName: `Evento: ${ev.title}` })
    status.innerHTML = `<p class="ar-event-summary__empty"><i class="fas fa-check-circle"></i> Pesquisa carregada de <b>${escapeHtml(usedName)}</b>.</p>`
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
  const ocup = p.capacidade ? ((p.totalInscritos / p.capacidade) * 100).toFixed(1) + "%" : "-"
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
    "#4DAD33", "#82C56F", "#D69A1F", "#C0392B",
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
    cores: ["#4DAD33", "#C0392B"],
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

  const drawHeader = () => {
    pageNum += 1
    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    doc.setTextColor(22, 31, 54)
    doc.text("PREFEITURA MUNICIPAL DE PEDRO LEOPOLDO", pageW / 2, 14, { align: "center" })
    doc.setFontSize(9)
    doc.text("SECRETARIA MUNICIPAL DE GESTÃO E FINANÇAS", pageW / 2, 19, { align: "center" })
    doc.setFont("helvetica", "normal")
    doc.text("DIRETORIA DE GESTÃO DE PESSOAS", pageW / 2, 24, { align: "center" })
    doc.setDrawColor(48, 99, 173)
    doc.setLineWidth(0.5)
    doc.line(M, 28, pageW - M, 28)
    y = 36
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

  // ===== PÁGINAS 3-5: análises qualitativas =====
  const renderCategoryChart = async (titulo, cats) => {
    if (!cats.length) return
    const vals = cats.map(c => c.value)
    const maxV = Math.max(...vals)
    const img = await renderChartToImage(
      "bar",
      {
        data: {
          labels: cats.map(c => c.label),
          datasets: [
            {
              label: "Nº de menções",
              data: vals,
              backgroundColor: modeloGradedColors(vals),
              borderWidth: 0,
              barPercentage: 0.72,
              categoryPercentage: 0.78
            }
          ]
        },
        options: {
          indexAxis: "y",
          scales: {
            x: {
              beginAtZero: true,
              suggestedMax: maxV + 1,
              title: { display: true, text: "Nº de menções", font: { family: MODELO_CHART.font, size: 13, weight: "600" }, color: MODELO_CHART.text },
              ticks: { stepSize: 1, precision: 0, font: { family: MODELO_CHART.font, size: 12 }, color: MODELO_CHART.textMuted },
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
              text: titulo,
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
              formatter: v => v
            }
          }
        }
      },
      900,
      Math.max(320, 100 + cats.length * 48)
    )
    newPage()
    ensureSpace(95)
    const h = Math.min(150, 44 + cats.length * 14)
    doc.addImage(img, "PNG", M, y, W, h)
    y += h + 4
  }

  status.textContent = "Renderizando Gráficos 3-5..."
  const cAltos = s.pesquisa.temas?.altos || []
  const cMelhor = s.pesquisa.temas?.melhorias || []
  const cSugest = s.pesquisa.temas?.sugestoes || []

  if (cAltos.length) {
    await renderCategoryChart("Gráfico 3 - Principais Pontos Altos", cAltos)
    justified(
      `A análise qualitativa das respostas evidencia que os principais pontos altos do evento foram ${cAltos
        .slice(0, 2)
        .map(c => `${c.label} (${c.value} ${c.value === 1 ? "menção" : "menções"})`)
        .join(" e ")}, demonstrando a valorização desses aspectos pelo público.`
    )
  }
  if (cMelhor.length) {
    await renderCategoryChart("Gráfico 4 - O que pode ser melhorado?", cMelhor)
    justified(
      `A principal oportunidade de melhoria identificada é ${cMelhor[0].label.toLowerCase()} (${cMelhor[0].value} ${cMelhor[0].value === 1 ? "menção" : "menções"}).`
    )
    if (cMelhor.length > 1) {
      justified("Também foram apontadas:")
      cMelhor.slice(1).forEach(c => bullet(`${c.label} (${c.value} ${c.value === 1 ? "menção" : "menções"});`))
    }
  }
  if (cSugest.length) {
    await renderCategoryChart("Gráfico 5 - Sugestões de Temas para as Próximas Ações", cSugest)
    justified(
      `A análise das sugestões evidencia maior interesse em ${cSugest
        .slice(0, 2)
        .map(c => c.label)
        .join(" e ")}, sinalizando prioridade nesses temas.`
    )
    if (cSugest.length > 2) {
      justified("Também foram sugeridos:")
      cSugest.slice(2).forEach(c => bullet(`${c.label};`))
    }
  }

  // ===== COMENTÁRIOS =====
  // Usa coluna "comentarios" se existir; senão recolhe as respostas mais
  // expressivas (>30 chars) das outras colunas textuais como destaque.
  let comentarios = (s.pesquisa.textos.comentarios || []).filter(t => t.length > 8)
  if (!comentarios.length) {
    const all = [...(s.pesquisa.textos.altos || []), ...(s.pesquisa.textos.melhorias || []), ...(s.pesquisa.textos.sugestoes || [])]
    comentarios = all
      .filter(t => t.length > 30)
      .sort((a, b) => b.length - a.length)
      .slice(0, 8)
  } else {
    comentarios = comentarios.slice(0, 8)
  }
  if (comentarios.length) {
    ensureSpace(20)
    sectionTitle("Comentários e Sugestões dos Participantes")
    justified("Os comentários livres registrados no formulário refletem a percepção dos participantes. Destacam-se:")
    comentarios.forEach(c => bullet(`"${c}"`, "•"))
  }

  // ===== CONCLUSÃO (gerada automaticamente das métricas) =====
  newPage()
  sectionTitle("Conclusão")
  const minMedia = criterios.length ? Math.min(...criterios.map(c => c.media)) : 5
  const conclusaoAuto = `Com base na pesquisa de satisfação aplicada ao público-alvo, os dados evidenciam que o evento alcançou elevado nível de aprovação, com médias superiores a ${minMedia.toFixed(2).replace(".", ",")} em todos os ${criterios.length} critérios avaliados (escala de 1 a 5). A taxa de presença de ${taxaPresenca.replace(".", ",")}% das inscrições reforça o engajamento do público com a iniciativa.`
  justified(conclusaoAuto)

  if (cSugest.length) {
    justified(
      `Os resultados sinalizam demanda por ações contínuas voltadas aos temas mais recorrentes nas sugestões dos participantes - em especial ${cSugest
        .slice(0, 2)
        .map(c => c.label)
        .join(" e ")}. Recomenda-se considerar essas temáticas como eixo permanente nas atividades de capacitação da e-Gov PL.`
    )
  }
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
    PageBreak
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

  status.textContent = "Renderizando Gráficos 3-5..."
  const cAltos = s.pesquisa.temas?.altos || []
  const cMelhor = s.pesquisa.temas?.melhorias || []
  const cSugest = s.pesquisa.temas?.sugestoes || []
  const renderCat = async (titulo, cats) => {
    if (!cats.length) return null
    const vals = cats.map(c => c.value)
    const maxV = Math.max(...vals)
    return renderChartToImage(
      "bar",
      {
        data: {
          labels: cats.map(c => c.label),
          datasets: [
            {
              label: "Nº de menções",
              data: vals,
              backgroundColor: modeloGradedColors(vals),
              borderWidth: 0,
              barPercentage: 0.72,
              categoryPercentage: 0.78
            }
          ]
        },
        options: {
          indexAxis: "y",
          scales: {
            x: {
              beginAtZero: true,
              suggestedMax: maxV + 1,
              title: { display: true, text: "Nº de menções", font: { family: MODELO_CHART.font, size: 13, weight: "600" }, color: MODELO_CHART.text },
              ticks: { stepSize: 1, precision: 0, font: { family: MODELO_CHART.font, size: 12 }, color: MODELO_CHART.textMuted },
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
              text: titulo,
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
              formatter: v => v
            }
          }
        }
      },
      900,
      Math.max(320, 100 + cats.length * 48)
    )
  }
  const g3 = await renderCat("Gráfico 3 - Principais Pontos Altos", cAltos)
  const g4 = await renderCat("Gráfico 4 - O que pode ser melhorado?", cMelhor)
  const g5 = await renderCat("Gráfico 5 - Sugestões de Temas para as Próximas Ações", cSugest)

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

  // Header e Footer institucionais
  const headerInst = new Header({
    children: AR_CONFIG.cabecalho.map(
      (t, i) =>
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
          children: [new TextRun({ text: t, bold: i < 2, size: i === 0 ? 20 : 18, color: "161F36" })]
        })
    )
  })
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

  // Gráficos 3-5
  if (g3) {
    children.push(new Paragraph({ children: [new PageBreak()] }))
    const h = Math.min(420, 120 + cAltos.length * 40)
    children.push(imgPara(g3, 540, h))
    children.push(
      para(
        `A análise qualitativa das respostas evidencia que os principais pontos altos do evento foram ${cAltos
          .slice(0, 2)
          .map(c => `${c.label} (${c.value} menções)`)
          .join(" e ")}, demonstrando a valorização desses aspectos pelo público.`
      )
    )
  }
  if (g4) {
    children.push(new Paragraph({ children: [new PageBreak()] }))
    const h = Math.min(420, 120 + cMelhor.length * 40)
    children.push(imgPara(g4, 540, h))
    children.push(para(`A principal oportunidade de melhoria identificada é ${cMelhor[0].label.toLowerCase()} (${cMelhor[0].value} menções).`))
    if (cMelhor.length > 1) {
      children.push(para("Também foram apontadas:"))
      cMelhor.slice(1).forEach(c => children.push(bullet(`${c.label} (${c.value} menções);`)))
    }
  }
  if (g5) {
    children.push(new Paragraph({ children: [new PageBreak()] }))
    const h = Math.min(420, 120 + cSugest.length * 40)
    children.push(imgPara(g5, 540, h))
    children.push(
      para(
        `A análise das sugestões evidencia maior interesse em ${cSugest
          .slice(0, 2)
          .map(c => c.label)
          .join(" e ")}, sinalizando prioridade nesses temas.`
      )
    )
    if (cSugest.length > 2) {
      children.push(para("Também foram sugeridos:"))
      cSugest.slice(2).forEach(c => children.push(bullet(`${c.label};`)))
    }
  }

  // Comentários
  let comentarios = (s.pesquisa.textos.comentarios || []).filter(t => t.length > 8)
  if (!comentarios.length) {
    comentarios = [...(s.pesquisa.textos.altos || []), ...(s.pesquisa.textos.melhorias || []), ...(s.pesquisa.textos.sugestoes || [])]
      .filter(t => t.length > 30)
      .sort((a, b) => b.length - a.length)
      .slice(0, 8)
  } else {
    comentarios = comentarios.slice(0, 8)
  }
  if (comentarios.length) {
    children.push(heading("Comentários e Sugestões dos Participantes"))
    children.push(para("Os comentários livres registrados no formulário refletem a percepção dos participantes. Destacam-se:"))
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
  if (cSugest.length) {
    children.push(
      para(
        `Os resultados sinalizam demanda por ações contínuas voltadas aos temas mais recorrentes nas sugestões dos participantes - em especial ${cSugest
          .slice(0, 2)
          .map(c => c.label)
          .join(" e ")}. Recomenda-se considerar essas temáticas como eixo permanente nas atividades de capacitação da e-Gov PL.`
      )
    )
  }
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
