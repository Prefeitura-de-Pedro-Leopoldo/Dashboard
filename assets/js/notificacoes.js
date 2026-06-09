/**
 * notificacoes.js - sino de notificações do topbar.
 *
 * Hoje cobre um tipo de alerta: convites de palestrante que continuam
 * PENDENTES há 3 dias ou mais (o palestrante ainda não preencheu o cadastro).
 * Os dados vêm do mesmo back-end de palestrantes (action invite-list), via a
 * função injetada `listarConvites`.
 *
 * O "lido" é por token e fica no localStorage: abrir o painel marca os alertas
 * atuais como lidos (zera o badge), mas eles continuam listados até o convite
 * ser preenchido/revogado.
 */

import { escapeHtml, formatDateBR } from "./ui.js"

const DIAS_LIMITE = 3
const LS_KEY = "egovpl-notif-lidas"
const MS_DIA = 86400000

let _deps = { listarConvites: async () => [], navigate: () => {} }
let _convites = []
let _open = false

export function initNotificacoes(overrides) {
  _deps = { ..._deps, ...overrides }
  const bell = document.getElementById("notifBell")
  if (!bell) return
  bell.addEventListener("click", (e) => { e.stopPropagation(); _toggle() })
  document.addEventListener("click", (e) => {
    const panel = document.getElementById("notifPanel")
    if (_open && panel && !panel.contains(e.target) && !bell.contains(e.target)) _close()
  })
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && _open) _close() })
  refreshNotificacoes()
}

// Re-busca os convites e atualiza o badge (e o painel, se aberto).
export async function refreshNotificacoes() {
  _convites = await _deps.listarConvites()
  _renderBadge()
  if (_open) _renderPanel()
}

// ---- Estado "lido" (localStorage) ----
function _lidas() {
  try { return new Set(JSON.parse(localStorage.getItem(LS_KEY) || "[]")) } catch (_) { return new Set() }
}
function _salvarLidas(set) {
  try { localStorage.setItem(LS_KEY, JSON.stringify([...set])) } catch (_) {}
}

// ---- Cálculo dos atrasados ----
function _diasDesde(iso) {
  const d = new Date(iso)
  if (isNaN(d)) return 0
  return Math.floor((Date.now() - d.getTime()) / MS_DIA)
}

// Convites pendentes há >= DIAS_LIMITE dias (ordenados do mais antigo p/ o topo).
function _atrasados() {
  return _convites
    .filter((c) => String(c.status || "").toLowerCase() === "pendente")
    .map((c) => ({ ...c, dias: _diasDesde(c.criadoEm) }))
    .filter((c) => c.dias >= DIAS_LIMITE)
    .sort((a, b) => b.dias - a.dias)
}

// ---- Badge ----
function _renderBadge() {
  const badge = document.getElementById("notifBadge")
  const bell = document.getElementById("notifBell")
  if (!badge || !bell) return
  const lidas = _lidas()
  const naoLidas = _atrasados().filter((c) => !lidas.has(c.token)).length
  if (naoLidas > 0) {
    badge.textContent = naoLidas > 9 ? "9+" : String(naoLidas)
    badge.hidden = false
    bell.classList.add("has-unread")
  } else {
    badge.hidden = true
    bell.classList.remove("has-unread")
  }
}

// ---- Abrir/fechar ----
function _toggle() { _open ? _close() : _abrir() }

function _abrir() {
  _open = true
  const bell = document.getElementById("notifBell")
  bell?.setAttribute("aria-expanded", "true")
  _renderPanel()
  const panel = document.getElementById("notifPanel")
  if (panel) panel.hidden = false
  // Abrir = marcar os alertas atuais como lidos (zera o badge).
  const lidas = _lidas()
  _atrasados().forEach((c) => lidas.add(c.token))
  _salvarLidas(lidas)
  _renderBadge()
}

function _close() {
  _open = false
  const panel = document.getElementById("notifPanel")
  if (panel) panel.hidden = true
  document.getElementById("notifBell")?.setAttribute("aria-expanded", "false")
}

// ---- Painel ----
function _renderPanel() {
  const panel = document.getElementById("notifPanel")
  if (!panel) return
  const lista = _atrasados()
  panel.innerHTML = `
    <div class="notif__head">
      <strong><i class="fas fa-bell"></i> Notificações</strong>
      <span class="notif__count">${lista.length}</span>
    </div>
    <div class="notif__body">
      ${lista.length ? lista.map(_itemHtml).join("") : `
        <div class="notif__empty">
          <i class="fas fa-circle-check"></i>
          <p>Nenhum convite pendente há mais de ${DIAS_LIMITE} dias.</p>
        </div>`}
    </div>`

  panel.querySelectorAll("[data-copy]").forEach((b) =>
    b.addEventListener("click", async () => {
      const url = `${location.origin}/cadastro-palestrante?convite=${encodeURIComponent(b.dataset.copy)}`
      try { await navigator.clipboard.writeText(url) } catch (_) {}
      const orig = b.innerHTML
      b.innerHTML = `<i class="fas fa-check"></i> Copiado`
      setTimeout(() => { b.innerHTML = orig }, 1600)
    })
  )
  panel.querySelectorAll("[data-goto]").forEach((b) =>
    b.addEventListener("click", () => {
      _close()
      _deps.navigate("palestrantes-lista")
    })
  )
}

function _itemHtml(c) {
  const nome = String(c.nome || "").trim()
  const quando = c.criadoEm ? formatDateBR(String(c.criadoEm).slice(0, 10)) : ""
  return `
    <div class="notif-item">
      <div class="notif-item__icon"><i class="fas fa-user-clock"></i></div>
      <div class="notif-item__body">
        <p class="notif-item__title"><b>${nome ? escapeHtml(nome) : "Palestrante (sem nome)"}</b> ainda não preencheu o cadastro.</p>
        <p class="notif-item__meta"><i class="fas fa-clock"></i> Convite gerado há <b>${c.dias} dia${c.dias === 1 ? "" : "s"}</b>${quando ? ` · ${quando}` : ""}</p>
        <div class="notif-item__actions">
          <button type="button" class="notif-item__btn" data-copy="${escapeHtml(c.token)}"><i class="fas fa-copy"></i> Copiar link</button>
          <button type="button" class="notif-item__btn notif-item__btn--ghost" data-goto><i class="fas fa-arrow-right"></i> Palestrantes</button>
        </div>
      </div>
    </div>`
}
