/**
 * notificacoes.js - sino de notificações do topbar.
 *
 * Cobre dois tipos de alerta:
 *   1. Convites de palestrante PENDENTES há 3 dias ou mais (o palestrante ainda
 *      não preencheu o cadastro). Vêm do back-end de palestrantes (listarConvites).
 *   2. Inscrições LOTADAS: eventos com inscrição aberta cujo total de inscritos
 *      (ao vivo) já atingiu as vagas — ou seja, o formulário foi/será encerrado.
 *      Vêm de `getLotados()` (os eventos sintéticos de inscrição aberta do app).
 *
 * O "lido" é por chave e fica no localStorage: abrir o painel marca os alertas
 * atuais como lidos (zera o badge), mas eles continuam listados até deixarem de
 * existir (convite preenchido/revogado; ou o evento já ter passado).
 */

import { escapeHtml, formatDateBR } from "./ui.js"

const DIAS_LIMITE = 3
const LS_KEY = "egovpl-notif-lidas"
const MS_DIA = 86400000

let _deps = { listarConvites: async () => [], getLotados: () => [], navigate: () => {} }
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

// Re-busca os convites e atualiza o badge (e o painel, se aberto). Os "lotados"
// são lidos de forma síncrona do estado atual do app a cada cálculo.
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

// ---- Fonte 1: convites pendentes ----
function _diasDesde(iso) {
  const d = new Date(iso)
  if (isNaN(d)) return 0
  return Math.floor((Date.now() - d.getTime()) / MS_DIA)
}
function _convitesAtrasados() {
  return _convites
    .filter((c) => String(c.status || "").toLowerCase() === "pendente")
    .map((c) => ({ ...c, dias: _diasDesde(c.criadoEm) }))
    .filter((c) => c.dias >= DIAS_LIMITE)
    .sort((a, b) => b.dias - a.dias)
    .map((c) => ({ key: "convite:" + c.token, kind: "convite", data: c }))
}

// ---- Fonte 2: inscrições lotadas ----
function _lotados() {
  const lista = (_deps.getLotados && _deps.getLotados()) || []
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  const seen = new Set()
  const out = []
  for (const ev of lista) {
    const vagas = Number(ev.vagas) || 0
    const total = Number(ev.totalInscritos) || 0
    if (!vagas || total < vagas) continue // ainda tem vaga (ou vagas desconhecidas)
    // Ignora eventos que já passaram (inscrição não é mais relevante).
    if (ev.date) { const d = new Date(ev.date + "T00:00:00"); if (!isNaN(d) && d < hoje) continue }
    const id = ev.id || ev.fonte || ev.title || ""
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      key: "lotado:" + id,
      kind: "lotado",
      data: { title: ev.tituloCurto || ev.title || "Evento", total, vagas, date: ev.date || "" },
    })
  }
  return out
}

// Lista unificada (lotados primeiro — mais acionáveis).
function _notificacoes() {
  return [..._lotados(), ..._convitesAtrasados()]
}

// ---- Badge ----
function _renderBadge() {
  const badge = document.getElementById("notifBadge")
  const bell = document.getElementById("notifBell")
  if (!badge || !bell) return
  const lidas = _lidas()
  const naoLidas = _notificacoes().filter((n) => !lidas.has(n.key)).length
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
  _notificacoes().forEach((n) => lidas.add(n.key))
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
  const lista = _notificacoes()
  panel.innerHTML = `
    <div class="notif__head">
      <strong><i class="fas fa-bell"></i> Notificações</strong>
      <span class="notif__count">${lista.length}</span>
    </div>
    <div class="notif__body">
      ${lista.length ? lista.map(_itemHtml).join("") : `
        <div class="notif__empty">
          <i class="fas fa-circle-check"></i>
          <p>Tudo em dia. Nenhum alerta no momento.</p>
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
      _deps.navigate(b.dataset.goto)
    })
  )
}

function _itemHtml(n) {
  return n.kind === "lotado" ? _itemLotadoHtml(n.data) : _itemConviteHtml(n.data)
}

function _itemLotadoHtml(d) {
  const quando = d.date ? formatDateBR(String(d.date).slice(0, 10)) : ""
  return `
    <div class="notif-item">
      <div class="notif-item__icon" style="background: var(--ind-warn-soft); color: var(--ind-warn);"><i class="fas fa-lock"></i></div>
      <div class="notif-item__body">
        <p class="notif-item__title"><b>${escapeHtml(d.title)}</b> atingiu as vagas — inscrições encerradas.</p>
        <p class="notif-item__meta"><i class="fas fa-users"></i> <b>${d.total}/${d.vagas}</b> inscritos${quando ? ` · ${quando}` : ""}</p>
        <div class="notif-item__actions">
          <button type="button" class="notif-item__btn notif-item__btn--ghost" data-goto="eventos"><i class="fas fa-arrow-right"></i> Ver eventos</button>
        </div>
      </div>
    </div>`
}

function _itemConviteHtml(c) {
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
          <button type="button" class="notif-item__btn notif-item__btn--ghost" data-goto="palestrantes-lista"><i class="fas fa-arrow-right"></i> Palestrantes</button>
        </div>
      </div>
    </div>`
}
