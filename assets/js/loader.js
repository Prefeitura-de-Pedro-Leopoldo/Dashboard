/**
 * loader.js - loader reutilizável do painel (capelo EGov girando).
 *
 * Mostrado quando uma página/aba/guia ainda não tem 100% das informações.
 * Usa "atraso de revelação": o spinner só aparece se o carregamento passar
 * de um curto atraso — carregamentos rápidos não exibem loading nenhum.
 */

// Capelo (mesmo desenho do site da Escola de Governo). Ids de gradiente
// próprios para não colidir.
const CAP_SVG = `
<svg class="diploma-loader__cap" viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="egov-cap-top" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1a3d70"/>
      <stop offset="55%" stop-color="#3063ad"/>
      <stop offset="100%" stop-color="#4f87d9"/>
    </linearGradient>
    <linearGradient id="egov-cap-base" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#2a4f87"/>
      <stop offset="100%" stop-color="#142a4d"/>
    </linearGradient>
  </defs>
  <path d="M10 22 Q22 26 34 22 L34 30 Q22 34 10 30 Z" fill="url(#egov-cap-base)"/>
  <path d="M4 18 L22 12 L40 18 L22 24 Z" fill="url(#egov-cap-top)"/>
  <circle cx="22" cy="18" r="1.6" fill="#ffb946"/>
  <g class="tassel-group">
    <line x1="22" y1="18" x2="32" y2="22" stroke="#ffb946" stroke-width="1.4" stroke-linecap="round"/>
    <line x1="32" y1="22" x2="32" y2="30" stroke="#ffb946" stroke-width="1.4" stroke-linecap="round"/>
    <circle cx="32" cy="32" r="2.2" fill="#e87b1c"/>
  </g>
</svg>`.trim()

const TEXTO_PADRAO = "Carregando informações…"

/** HTML do loader (capelo + texto). Use dentro de um container. */
export function loaderHtml(texto = TEXTO_PADRAO) {
  return `
    <div class="egov-loader">
      <div class="egov-loader__inner">
        <div class="diploma-loader__stage" aria-hidden="true">
          <span class="diploma-loader__ring"></span>
          <span class="diploma-loader__ring diploma-loader__ring--inner"></span>
          ${CAP_SVG}
        </div>
        <div class="egov-loader__text">${texto}</div>
      </div>
    </div>`
}

/**
 * Cobre um container com o loader enquanto algo carrega.
 * Retorna uma função para esconder. O capelo só é revelado se o load
 * passar de `revealMs` (load rápido = sem spinner visível).
 */
export function showCover(container, texto = TEXTO_PADRAO, revealMs = 200) {
  if (!container) return () => {}
  if (getComputedStyle(container).position === "static") {
    container.style.position = "relative"
  }
  const el = document.createElement("div")
  el.className = "egov-loader egov-loader--cover"
  el.innerHTML = `
    <div class="egov-loader__inner">
      <div class="diploma-loader__stage" aria-hidden="true">
        <span class="diploma-loader__ring"></span>
        <span class="diploma-loader__ring diploma-loader__ring--inner"></span>
        ${CAP_SVG}
      </div>
      <div class="egov-loader__text">${texto}</div>
    </div>`
  container.appendChild(el)
  const revealTimer = setTimeout(() => el.classList.add("is-revealed"), revealMs)
  let done = false
  return () => {
    if (done) return
    done = true
    clearTimeout(revealTimer)
    el.classList.add("is-hiding")
    setTimeout(() => el.remove(), 320)
  }
}
