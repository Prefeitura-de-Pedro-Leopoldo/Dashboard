/**
 * views/pessoas.js - sub-abas de Pessoas: lista completa de Servidores
 * (busca + paginação) e ranking de Cargos (donut + tabela paginada).
 */
import { state } from "../core/state.js"
import { escapeHtml } from "../ui.js"
import { agregarServidores, agregarVinculosServidores, filtrarServidoresPorPeriodo } from "../servidores.js"
import { pieCategorias } from "../charts.js"

// Períodos do ranking de servidores destaque. Janelas rolantes a partir de hoje.
const SRV_PERIODOS = [
  { id: "todos", label: "Todos" },
  { id: "mensal", label: "Mensal" },
  { id: "trimestral", label: "Trimestral" },
  { id: "semestral", label: "Semestral" }
]

// ================ SERVIDORES (sub-aba de Participantes) ================
export function renderViewServidores() {
  const view = document.getElementById("view-servidores")
  const eventos = state.data.eventos

  // Base: todos os servidores com ao menos 1 inscrição (dedup por pessoa).
  const base = agregarServidores(eventos).filter(s => s.totalEventos >= 1)

  // Monta a lista ordenada + dense rank para um dado período. O filtro por
  // período recorta os eventos de cada servidor e recalcula os totais.
  const montarLista = (periodo) => {
    const ordenados = filtrarServidoresPorPeriodo(base, periodo)
      .sort((a, b) =>
        b.totalPresentes - a.totalPresentes ||
        b.totalEventos - a.totalEventos ||
        (a.nome || "").localeCompare(b.nome || "", "pt-BR")
      )
    // Dense rank baseado em totalPresentes (empatados compartilham o rank).
    let rank = 0
    let ultimaContagem = null
    return ordenados.map(s => {
      if (s.totalPresentes !== ultimaContagem) {
        rank += 1
        ultimaContagem = s.totalPresentes
      }
      return { ...s, rank }
    })
  }

  let periodo = state.srvPeriodo || "todos"
  let lista = montarLista(periodo)

  view.innerHTML = `
    <div class="card">
      <div class="card__header">
        <div>
          <h3><i class="fas fa-list-ol"></i> Lista completa de servidores</h3>
          <p>Todos os servidores que se inscreveram em algum evento, ordenados por presenças.</p>
        </div>
        <span class="card__header-meta" id="srvMeta">${lista.length} servidor(es)</span>
      </div>
      <div class="group-tabs" role="tablist" aria-label="Período do ranking" id="srvPeriodo" style="margin-bottom: var(--space-3);">
        ${SRV_PERIODOS.map(p => `<button type="button" class="group-tab ${p.id === periodo ? "is-active" : ""}" data-periodo="${p.id}" aria-pressed="${p.id === periodo}">${p.label}</button>`).join("")}
      </div>
      <div class="filter" style="margin-bottom: var(--space-3);">
        <label for="srvBusca">Buscar</label>
        <input type="search" id="srvBusca" placeholder="nome do servidor ou secretaria" />
      </div>
      <div id="srvListaHost"></div>
    </div>
  `

  const getBusca = () => (document.getElementById("srvBusca")?.value || "").toLowerCase().trim()
  const aplicaBusca = (arr) => {
    const q = getBusca()
    return !q ? arr : arr.filter(s =>
      (s.nome || "").toLowerCase().includes(q) ||
      (s.secretaria || "").toLowerCase().includes(q)
    )
  }

  let filtroAtual = lista
  const draw = () => {
    renderDemaisServidores("srvListaHost", filtroAtual, "servidores-lista", 10)
    document.getElementById("srvMeta").textContent = `${filtroAtual.length} servidor(es)`
  }
  draw()

  document.getElementById("srvBusca").addEventListener("input", () => {
    filtroAtual = aplicaBusca(lista)
    state.pagerPages["servidores-lista"] = 1
    draw()
  })

  document.getElementById("srvPeriodo").addEventListener("click", e => {
    const btn = e.target.closest("[data-periodo]")
    if (!btn) return
    periodo = btn.dataset.periodo
    state.srvPeriodo = periodo
    lista = montarLista(periodo)
    filtroAtual = aplicaBusca(lista)
    state.pagerPages["servidores-lista"] = 1
    document.querySelectorAll("#srvPeriodo .group-tab").forEach(b => {
      const on = b.dataset.periodo === periodo
      b.classList.toggle("is-active", on)
      b.setAttribute("aria-pressed", on)
    })
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
              <th style="width:70px;">#</th>
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
export function renderViewCargos() {
  const view = document.getElementById("view-cargos")
  const eventos = state.data.eventos
  // Conta por SERVIDOR ÚNICO (não por inscrição) — a soma fecha com o total
  // de servidores. Classificação estimada pelo cargo; sem cargo = "Não informado".
  const servidores = agregarServidores(eventos).filter(s => s.totalEventos >= 1)
  const vinculos = agregarVinculosServidores(servidores)

  view.innerHTML = `
    <div class="grid-2 secretarias-grid">
      <div class="card">
        <div class="card__header"><div><h3><i class="fas fa-chart-pie"></i> Distribuição por vínculo</h3><p>Servidores únicos por tipo de vínculo. Classificação <b>estimada pelo cargo</b>; sem cargo informado entra como "Não informado".</p></div></div>
        <div class="chart-wrap lg"><canvas id="chartCargos"></canvas></div>
      </div>
      <div class="table-wrap" style="margin-bottom:0;">
        <div class="table-wrap__head">
          <h3><i class="fas fa-list-ol"></i> Ranking detalhado</h3>
          <span class="card__header-meta">${vinculos.length} vínculo(s)</span>
        </div>
        <div id="cargosRankHost"></div>
      </div>
    </div>
  `

  // Ranking por vínculo (sem paginação relevante - poucas linhas).
  const totalVinculos = vinculos.reduce((s, x) => s + x.value, 0)
  renderCargosPaginated("cargosRankHost", vinculos, totalVinculos, "cargos-rank", 10)

  // Donut por vínculo, mesmo estilo de pieTurmas.
  pieCategorias("chartCargos", vinculos, "Nenhum servidor com cargo registrado nas planilhas.")
}

function renderCargosPaginated(containerId, cargos, totalGlobal, scopeId, pageSize = 10) {
  const container = document.getElementById(containerId)
  if (!container) return
  if (!cargos.length) {
    container.innerHTML = `<div class="table-scroll"><table class="data"><thead><tr><th>#</th><th>Vínculo</th><th>Servidores</th><th>Participação</th></tr></thead><tbody><tr><td colspan="4" class="empty-cell">Sem cargos informados.</td></tr></tbody></table></div>`
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
          <thead><tr><th>#</th><th>Vínculo</th><th>Servidores</th><th>Participação</th></tr></thead>
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
