/**
 * views/comparar.js - view "Comparar" (seleção de eventos + gráficos comparativos).
 */
import { state } from "../core/state.js"
import { escapeHtml, renderComparativeTable } from "../ui.js"
import { comparativoEventos } from "../metrics.js"
import { barGrupoComparativo, radarComparativo, barGroupedByCategory, PALETTE } from "../charts.js"

export function renderViewComparar() {
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
