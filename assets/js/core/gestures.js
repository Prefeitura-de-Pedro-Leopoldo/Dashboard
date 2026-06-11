/**
 * gestures.js - experiência de app nativo no painel.
 *
 *  - Edge-swipe: deslizar da borda esquerda abre a gaveta (segue o dedo);
 *    deslizar para a esquerda com a gaveta aberta fecha.
 *  - Swipe entre abas: deslizar horizontal no conteúdo troca a sub-aba.
 *  - Pull-to-refresh: puxar a tela para baixo (no topo) atualiza os dados.
 *  - Ripple: ondinha no toque em botões/cards (estilo material).
 *  - Haptics: vibração curta em interações-chave (Android; iOS ignora).
 *
 * Tudo é passivo/leve e respeita prefers-reduced-motion.
 */

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
const isMobile = () => window.matchMedia("(max-width: 768px)").matches

/** Vibração curta (no-op onde não suportado). */
export function haptic(pattern = 12) {
  try { if (navigator.vibrate) navigator.vibrate(pattern) } catch (_) {}
}

// Elementos que "comem" gestos horizontais/verticais próprios — swipe ignora.
const SWIPE_IGNORE = "canvas, input, select, textarea, .table-scroll, .view-tabs, .turma-switch, .heatmap__grid, .srv-freq, [data-no-swipe]"

/* ================================================================
   EDGE-SWIPE da gaveta (segue o dedo)
   ================================================================ */
export function initDrawerGestures({ sidebar, isOpen, open, close }) {
  if (!sidebar) return
  const W = () => Math.min(284, window.innerWidth * 0.86)
  let tracking = null // { startX, startY, fromEdge, lastX, lastT, vx }

  const setDrag = (x) => {
    sidebar.classList.add("is-dragging")
    sidebar.style.transform = `translateX(${Math.min(0, x)}px)`
  }
  const endDrag = () => {
    sidebar.classList.remove("is-dragging")
    sidebar.style.transform = ""
  }

  document.addEventListener("touchstart", (e) => {
    if (!isMobile() || e.touches.length !== 1) return
    const t = e.touches[0]
    const openNow = isOpen()
    const fromEdge = !openNow && t.clientX <= 26
    if (!fromEdge && !openNow) return
    tracking = { startX: t.clientX, startY: t.clientY, fromEdge, lastX: t.clientX, lastT: performance.now(), vx: 0, active: false, wasOpen: openNow }
  }, { passive: true })

  document.addEventListener("touchmove", (e) => {
    if (!tracking) return
    const t = e.touches[0]
    const dx = t.clientX - tracking.startX
    const dy = t.clientY - tracking.startY
    const now = performance.now()
    tracking.vx = (t.clientX - tracking.lastX) / Math.max(1, now - tracking.lastT)
    tracking.lastX = t.clientX
    tracking.lastT = now

    // Decide se o gesto é horizontal o suficiente
    if (!tracking.active) {
      if (Math.abs(dx) < 14 || Math.abs(dx) < Math.abs(dy) * 1.3) return
      tracking.active = true
      if (tracking.fromEdge && !tracking.wasOpen) open({ silent: true })
    }
    if (reduced()) return
    const w = W()
    if (tracking.fromEdge) setDrag(-w + Math.max(0, Math.min(w, dx)))
    else if (tracking.wasOpen && dx < 0) setDrag(Math.max(-w, dx))
  }, { passive: true })

  document.addEventListener("touchend", () => {
    if (!tracking) { return }
    const tr = tracking
    tracking = null
    if (!tr.active) return
    const w = W()
    const dx = tr.lastX - tr.startX
    endDrag()
    if (tr.fromEdge) {
      const keep = dx > w * 0.34 || tr.vx > 0.45
      if (keep) { open(); haptic(10) } else close()
    } else if (tr.wasOpen) {
      const shut = dx < -w * 0.3 || tr.vx < -0.45
      if (shut) { close(); haptic(8) }
    }
  }, { passive: true })
}

/* ================================================================
   SWIPE entre sub-abas (conteúdo desliza)
   ================================================================ */
export function initSwipeTabs({ getTabs, getCurrent, goTo }) {
  const main = document.getElementById("mainContent")
  if (!main) return
  let st = null

  main.addEventListener("touchstart", (e) => {
    if (!isMobile() || e.touches.length !== 1) return
    if (e.target.closest(SWIPE_IGNORE)) return
    const t = e.touches[0]
    if (t.clientX <= 26) return // borda é da gaveta
    st = { x: t.clientX, y: t.clientY, t: performance.now() }
  }, { passive: true })

  main.addEventListener("touchend", (e) => {
    if (!st) return
    const s = st; st = null
    const t = e.changedTouches[0]
    const dx = t.clientX - s.x
    const dy = t.clientY - s.y
    const dt = performance.now() - s.t
    // Gesto: rápido, horizontal, deslocamento relevante
    if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 2 || dt > 600) return

    const tabs = getTabs()
    if (!tabs || tabs.length < 2) return
    const cur = tabs.indexOf(getCurrent())
    if (cur < 0) return
    const next = dx < 0 ? cur + 1 : cur - 1
    if (next < 0 || next >= tabs.length) return

    haptic(8)
    const inner = document.querySelector(".main-inner")
    if (inner && !reduced()) {
      inner.classList.remove("swipe-in-left", "swipe-in-right")
      void inner.offsetWidth
      inner.classList.add(dx < 0 ? "swipe-in-left" : "swipe-in-right")
      setTimeout(() => inner.classList.remove("swipe-in-left", "swipe-in-right"), 340)
    }
    goTo(tabs[next])
  }, { passive: true })
}

/* ================================================================
   PULL-TO-REFRESH
   ================================================================ */
export function initPullToRefresh({ onRefresh }) {
  if (!("ontouchstart" in window)) return
  const THRESH = 84
  let indicator = null
  let st = null
  let refreshing = false

  const getIndicator = () => {
    if (!indicator) {
      indicator = document.createElement("div")
      indicator.className = "ptr-indicator"
      indicator.innerHTML = `<i class="fas fa-arrow-down" aria-hidden="true"></i>`
      document.body.appendChild(indicator)
    }
    return indicator
  }
  const setPull = (px) => {
    const el = getIndicator()
    const y = Math.min(THRESH + 18, px) - 68
    el.style.transform = `translate(-50%, ${y}px)`
    el.classList.toggle("is-ready", px >= THRESH)
  }
  const reset = () => {
    if (!indicator) return
    indicator.style.transition = "transform 0.25s ease"
    indicator.style.transform = "translate(-50%, -68px)"
    indicator.classList.remove("is-ready", "is-refreshing")
    setTimeout(() => { if (indicator) indicator.style.transition = "" }, 280)
  }

  document.addEventListener("touchstart", (e) => {
    if (refreshing || e.touches.length !== 1) return
    const scroller = document.scrollingElement || document.documentElement
    if (scroller.scrollTop > 0) return
    if (e.target.closest(SWIPE_IGNORE + ", .sidebar, .app-modal, .pal-modal, .notif-panel, .servidor-perfil-overlay")) return
    st = { y: e.touches[0].clientY, pulling: false }
  }, { passive: true })

  document.addEventListener("touchmove", (e) => {
    if (!st || refreshing) return
    const dy = e.touches[0].clientY - st.y
    const scroller = document.scrollingElement || document.documentElement
    if (scroller.scrollTop > 0) { st = null; reset(); return }
    if (dy <= 8) { if (st.pulling) { st.pulling = false; reset() } return }
    st.pulling = true
    st.dist = dy * 0.5 // resistência
    setPull(st.dist)
  }, { passive: true })

  document.addEventListener("touchend", async () => {
    if (!st) return
    const s = st; st = null
    if (!s.pulling) return
    if ((s.dist || 0) >= THRESH) {
      refreshing = true
      haptic([10, 40, 14])
      const el = getIndicator()
      el.classList.add("is-refreshing")
      el.querySelector("i").className = "fas fa-arrows-rotate"
      el.style.transform = "translate(-50%, 14px)"
      try { await onRefresh() } catch (_) {}
      refreshing = false
      el.querySelector("i").className = "fas fa-arrow-down"
      reset()
    } else {
      reset()
    }
  }, { passive: true })
}

/* ================================================================
   RIPPLE de toque
   ================================================================ */
const RIPPLE_TARGETS = ".btn, .topbar__btn, .topbar__menu, .view-tab, .pill, .source-tab, .pager__btn, .event-card, .pal-icon-btn, .notif-item__btn, .wizard__step, .turma-pill"

export function initRipple() {
  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return
    const host = e.target.closest(RIPPLE_TARGETS)
    if (!host || reduced()) return
    const rect = host.getBoundingClientRect()
    if (getComputedStyle(host).position === "static") host.style.position = "relative"

    const wrap = document.createElement("span")
    wrap.className = "ripple-wrap"
    const r = Math.hypot(Math.max(e.clientX - rect.left, rect.right - e.clientX),
                         Math.max(e.clientY - rect.top, rect.bottom - e.clientY))
    const dot = document.createElement("span")
    dot.className = "ripple"
    dot.style.width = dot.style.height = `${r * 2}px`
    dot.style.left = `${e.clientX - rect.left - r}px`
    dot.style.top = `${e.clientY - rect.top - r}px`
    wrap.appendChild(dot)
    host.appendChild(wrap)
    setTimeout(() => wrap.remove(), 600)
  }, { passive: true })
}

/* ================================================================
   TILT 3D nos cards (desktop, ponteiro fino)
   ================================================================ */
const TILT_MAX = 3.2 // graus

export function initTilt() {
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return
  const wired = new WeakSet()

  document.addEventListener("pointerover", (e) => {
    if (reduced()) return
    const el = e.target.closest(".kpi, .card:has(> .chart-wrap), .card:has(> div > .chart-wrap), .event-card")
    if (!el || wired.has(el)) return
    wired.add(el)
    el.setAttribute("data-tilt", "")

    let raf = 0
    const onMove = (ev) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect()
        const px = (ev.clientX - r.left) / r.width
        const py = (ev.clientY - r.top) / r.height
        el.style.setProperty("--gx", `${(px * 100).toFixed(1)}%`)
        el.style.setProperty("--gy", `${(py * 100).toFixed(1)}%`)
        const rx = ((0.5 - py) * TILT_MAX * 2).toFixed(2)
        const ry = ((px - 0.5) * TILT_MAX * 2).toFixed(2)
        el.style.transform = `perspective(760px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-2px)`
      })
    }
    const onLeave = () => {
      cancelAnimationFrame(raf)
      el.style.transform = ""
      el.style.removeProperty("--gx")
      el.style.removeProperty("--gy")
    }
    el.addEventListener("pointermove", onMove)
    el.addEventListener("pointerleave", onLeave)
  })
}

/* ================================================================
   COUNT-UP de números (KPIs)
   ================================================================ */
export function countUp(host, selector = ".kpi__value") {
  if (!host || reduced()) return
  host.querySelectorAll(selector).forEach((el) => {
    // Anima apenas o primeiro nó de texto numérico ("257", "77.4", "77,4")
    const node = [...el.childNodes].find((n) => n.nodeType === 3 && /\d/.test(n.textContent))
    if (!node) return
    const raw = node.textContent
    const m = raw.match(/^(\s*)([\d.,]+)/)
    if (!m) return
    const sep = m[2].includes(",") ? "," : m[2].includes(".") ? "." : null
    const target = parseFloat(m[2].replace(",", "."))
    if (!Number.isFinite(target)) return
    const decimals = sep ? (m[2].split(sep)[1] || "").length : 0
    const t0 = performance.now()
    const DUR = 850
    const fmt = (v) => {
      let s = v.toFixed(decimals)
      if (sep === ",") s = s.replace(".", ",")
      return m[1] + s + raw.slice(m[0].length)
    }
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / DUR)
      const ease = 1 - Math.pow(1 - p, 3)
      node.textContent = fmt(target * ease)
      if (p < 1) requestAnimationFrame(tick)
      else node.textContent = raw
    }
    requestAnimationFrame(tick)
  })
}
