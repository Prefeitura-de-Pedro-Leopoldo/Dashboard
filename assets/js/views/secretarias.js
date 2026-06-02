/**
 * views/secretarias.js - view "Secretarias" (ranking + gráfico global).
 */
import { state } from "../core/state.js"
import { rankingSecretarias, rankingEvasaoSecretarias } from "../metrics.js"
import { escapeHtml, fmt, renderSecretariasTable, renderFaltasSecretariasTable } from "../ui.js"
import { barSecretarias } from "../charts.js"

export function renderViewSecretarias() {
  const { data } = state
  const ranking = rankingSecretarias(data.eventos)
  const rankingFaltas = rankingEvasaoSecretarias(data.eventos)

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

    <div class="grid-2 secretarias-grid">
      <div class="card">
        <div class="card__header"><div><h3>Distribuição global</h3><p>Faltas por secretaria (todos os eventos).</p></div></div>
        <div class="chart-wrap" id="secFaltasChartWrap"><canvas id="secFaltasChart"></canvas></div>
      </div>
      <div class="table-wrap" id="secFaltasRankingWrap" style="margin-bottom:0;">
        <div class="table-wrap__head">
          <h3><i class="fas fa-user-slash"></i> Ranking detalhado</h3>
          <span class="card__header-meta">${rankingFaltas.length} secretaria(s)</span>
        </div>
        ${renderFaltasSecretariasTable(rankingFaltas)}
      </div>
    </div>
  `
  // Tabela com altura natural; o CSS Grid (.secretarias-grid) iguala os
  // dois cards automaticamente via align-items: stretch. O gráfico usa
  // o card pai como referência de altura (100%).
  for (const wrapId of ["secRankingWrap", "secFaltasRankingWrap"]) {
    const wrap = document.getElementById(wrapId)
    const scroll = wrap && wrap.querySelector(".table-scroll")
    if (scroll) {
      scroll.style.maxHeight = "none"
      scroll.style.overflow = "visible"
    }
  }
  barSecretarias("secChart", ranking, { limit: 15 })
  barSecretarias("secFaltasChart", rankingFaltas, {
    limit: 15,
    datasetLabel: "Faltas",
    unitLabel: "falta(s)",
    emptyLabel: "Sem faltas registradas.",
    tooltipExtra: (entry) =>
      entry ? [`Inscritos: ${entry.inscritos}`, `Presentes: ${entry.presentes}`, `Evasão: ${entry.taxaEvasao}%`] : [],
  })
}
