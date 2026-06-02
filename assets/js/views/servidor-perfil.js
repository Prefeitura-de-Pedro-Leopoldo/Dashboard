/**
 * views/servidor-perfil.js - modal de drill-down do servidor: aberto ao clicar
 * em qualquer [data-servidor-chave] no app. Mostra KPIs, conquistas, frequência
 * mensal e o histórico de eventos com presença/falta.
 *
 * O listener global de clique é registrado no import (efeito colateral), então
 * basta importar este módulo uma vez em app.js.
 */
import { state } from "../core/state.js"
import { escapeHtml } from "../ui.js"
import { showAlert } from "../core/modal.js"
import {
  agregarServidores,
  iniciaisDoNome,
  frequenciaMensal,
  badgesDoServidor,
  estimarHorasServidor,
  horasSaoReais
} from "../servidores.js"

// Busca um servidor pela chave (e:email ou n:nome) atravessando os eventos
// agregados. Devolve a entrada completa de agregarServidores ou null.
function buscarServidorPorChave(chave) {
  if (!chave) return null
  const lista = agregarServidores(state.data?.eventos || [])
  // O servidor unificado pode ter várias chaves (e-mails/nomes mesclados);
  // casa por qualquer uma delas.
  return lista.find(s => s.chave === chave || (s.chaves && s.chaves.includes(chave))) || null
}

// Abre o modal de perfil do servidor.
export function openServidorPerfil(chave) {
  const s = buscarServidorPorChave(chave)
  if (!s) return showAlert({ title: "Servidor não encontrado", message: "Os dados do servidor não estão disponíveis no recorte atual.", type: "warn" })

  // Ordena eventos por data (mais recentes primeiro)
  const eventosOrd = s.eventos.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""))
  const presentes = eventosOrd.filter(e => e.presente)
  const faltas    = eventosOrd.filter(e => !e.presente)
  const taxa = s.totalEventos ? ((s.totalPresentes / s.totalEventos) * 100).toFixed(0) + "%" : "-"
  const horas = estimarHorasServidor(s)
  const horasReais = horasSaoReais(s)
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
        <div class="srv-kpi"><span class="srv-kpi__num">${horas}h</span><span class="srv-kpi__lbl">${horasReais ? "Carga horária" : "Carga estimada"}</span></div>
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
        <h3 class="servidor-perfil__h3"><i class="fas fa-check-circle" style="color:var(--ind-good,#3063ad)"></i> Eventos com presença (${presentes.length})</h3>
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
        <small>${horasReais ? "Carga horária somada a partir da duração informada de cada evento." : "Carga estimada em 8h por presença quando a duração do evento não está informada."}</small>
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
