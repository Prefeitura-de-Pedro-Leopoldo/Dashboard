/**
 * ui-kit.js - helpers de UI compartilhados (núcleo): paginação de tabelas
 * e abas internas de uma view. Usados por app.js e pelos módulos de view.
 */
import { state } from "./state.js"
import { escapeHtml, renderParticipantsTable } from "../ui.js"

// state.viewTabs[viewName] guarda a aba ativa de cada página.
state.viewTabs = state.viewTabs || {}
// Estado de paginação por escopo (e.g. "ev-{id}", "participantes-global").
state.pagerPages = state.pagerPages || {}

export function renderPaginatedTable(containerId, participantes, scopeId, opts = {}) {
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

export function renderTabsNav(viewKey, tabs) {
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

export function wireTabs(viewKey, onSwitch) {
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

export function getActiveTab(viewKey, defaultId) {
  return state.viewTabs[viewKey] || defaultId
}
