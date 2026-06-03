/**
 * lembretes.js - INTERFACE (somente visual / protótipo).
 *
 * Duas abas no detalhe do evento:
 *   - "Inscrições"          → lista ao vivo dos inscritos (Google Forms).
 *   - "Encontros & Lembretes" → cadastro das datas/horários de cada encontro
 *                                e do lembrete automático "1 dia antes".
 *
 * IMPORTANTE: nesta fase NÃO há back-end. Os dados são SIMULADOS em memória
 * (store local por evento). Os botões "Salvar"/"Atualizar" apenas demonstram
 * o fluxo. A integração com Apps Script (planilha de respostas + envio de
 * e-mail + gatilho diário) entra na fase seguinte.
 */

import { escapeHtml, formatDateBR } from "./ui.js"
import { showAlert } from "./core/modal.js"
import { loaderHtml } from "./loader.js"


// ---- Store em memória (mock), por evento. Persiste durante a sessão. ----
const _store = {}
let _uid = 0
const uid = () => `enc-${++_uid}`

function store(ev) {
  if (!_store[ev.id]) {
    // Semeia 1 encontro usando a data do evento, se existir.
    const encontros = ev.date
      ? [{ id: uid(), titulo: "Encontro 1", data: ev.date, horaInicio: "19:00", horaFim: "22:00", ativo: true }]
      : []

    _store[ev.id] = {
      lembreteAtivo: true, dispararHora: "08:00", encontros,
      inscritos: [], inscState: "idle", inscAt: "",
      encLoaded: false, encState: "idle",
    }
  }
  return _store[ev.id]
}

// Chave de persistência do evento = pasta da planilha "Inscrição".
function eventoKey(ev) { return pastaDoEvento(ev) }

// Pasta do evento (de onde sai o participantes.xlsx) → usada para achar a
// planilha "Inscrição" no Apps Script. Ex.: "mapa.../turma 1".
function pastaDoEvento(ev) {
  if (ev && ev.pastaInscricao) return ev.pastaInscricao
  return ev && ev.fonte ? String(ev.fonte).replace(/\/[^/]*$/, "") : ""
}

// Busca no Apps Script as pastas que têm planilha "Inscrição" e cria eventos
// SINTÉTICOS ("inscrições abertas") para as pastas que ainda NÃO são eventos
// (não têm participantes.xlsx). Assim turmas com inscrição aberta aparecem no
// dashboard. Retorna [] se a API não estiver configurada ou falhar.
export async function eventosComInscricaoAberta(eventosExistentes) {
  let data
  try {
    const ctrl = new AbortController()
    const to = setTimeout(() => ctrl.abort(), 28000) // margem; roda em 2º plano
    const res = await fetch("/api/inscricoes?manifest=1", { cache: "no-cache", signal: ctrl.signal })
    clearTimeout(to)
    if (!res.ok) return []
    data = await res.json()
  } catch (_) { return [] }
  if (!data || !data.ok || !Array.isArray(data.sheets)) return []

  const jaExiste = new Set((eventosExistentes || []).map((e) => pastaDoEvento(e)).filter(Boolean))
  const novos = []
  for (const s of data.sheets) {
    const folder = String(s.folder || "").trim()
    if (!folder || jaExiste.has(folder)) continue
    const slug = folder.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    novos.push({
      id: "insc-" + slug,
      title: folder.split("/").pop(),
      fonte: folder + "/Inscrição",
      pastaInscricao: folder,
      date: null, dateRaw: null, time: "", local: "", city: "",
      status: "inscricoes-abertas",
      inscricaoAberta: true,
      cargaHoraria: null,
      totalInscritos: 0, totalAprovados: 0, totalPresentes: 0, totalAusentes: 0, totalAptos: 0,
      taxaPresenca: null, modulos: null,
      turmas: {}, turmasPresentes: {}, secretarias: {}, secretariasPresentes: {},
      timelineInscricoes: [], timelineCheckins: [],
      participantes: [], vagas: null, taxaOcupacao: null,
      grupo: null,
    })
  }
  return novos
}

// ================ Utilidades de data ================
function dataHoraBR(iso) {
  if (!iso) return "-"
  const s = String(iso)
  const dia = formatDateBR(s.slice(0, 10))
  const hora = s.slice(11, 16)
  return hora ? `${dia} ${hora}` : dia
}

function toISO(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

// Próximo encontro futuro com lembrete ativo → calcula a data do lembrete (D-1).
function proximoLembrete(st) {
  if (!st.lembreteAtivo) return null
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const futuros = st.encontros
    .filter((e) => e.ativo && e.data)
    .map((e) => ({ ...e, d: new Date(e.data + "T00:00:00") }))
    .filter((e) => !isNaN(e.d) && e.d >= hoje)
    .sort((a, b) => a.d - b.d)
  if (!futuros.length) return null
  const n = futuros[0]
  const lemb = new Date(n.d)
  lemb.setDate(lemb.getDate() - 1)
  return { ...n, lembreteData: toISO(lemb) }
}

// ================ ABA: INSCRIÇÕES (ao vivo) ================
export function renderInscricoes(containerId, ev) {
  const host = document.getElementById(containerId)
  if (!host) return
  const st = store(ev)

  host.innerHTML = `
    <div class="card">
      <div class="card__header">
        <div>
          <h3><i class="fas fa-user-plus"></i> Inscrições</h3>
          <p>Respostas do formulário deste evento, em tempo real.</p>
        </div>
        <div class="lemb-bar">
          <span class="card__header-meta" id="lembInscMeta">${st.inscState === "ok" ? `${st.inscritos.length} inscrito(s)` : "-"}</span>
          <button type="button" class="btn btn--sm" id="lembInscReload"><i class="fas fa-arrows-rotate"></i> Atualizar</button>
        </div>
      </div>
      <div id="lembInscBody">${loaderHtml("Buscando inscrições…")}</div>
    </div>
  `

  host.querySelector("#lembInscReload")?.addEventListener("click", () => carregarInscritos(containerId, ev, true))
  carregarInscritos(containerId, ev, false)
}

async function carregarInscritos(containerId, ev, fresh) {
  const host = document.getElementById(containerId)
  if (!host) return
  const st = store(ev)
  const body = host.querySelector("#lembInscBody")
  const meta = host.querySelector("#lembInscMeta")
  const pasta = pastaDoEvento(ev)

  if (!pasta) {
    st.inscState = "error"
    if (body) body.innerHTML = inscInfoHtml("warn", "Sem pasta de origem", "Este evento não tem um arquivo de origem (<code>fonte</code>), então não há pasta onde procurar a planilha “Inscrição”.")
    return
  }

  if (body) body.innerHTML = loaderHtml("Buscando inscrições…")
  try {
    const url = `/api/inscricoes?path=${encodeURIComponent(pasta)}${fresh ? "&fresh=1" : ""}`
    const res = await fetch(url, { cache: "no-cache" })

    if (res.status === 503) {
      st.inscState = "unconfigured"
      if (meta) meta.textContent = "-"
      if (body) body.innerHTML = inscInfoHtml(
        "plug",
        "Inscrições ao vivo ainda não configuradas",
        "Falta publicar o Apps Script <b>servirInscricoes.gs</b> e definir <code>INSCRICOES_WEBAPP_URL</code> e <code>INSCRICOES_TOKEN</code> na Vercel."
      )
      return
    }

    const data = await res.json().catch(() => null)

    if (!data || !data.ok) {
      const reason = data && data.reason
      if (reason === "noinscricao" || reason === "folder") {
        st.inscState = "empty"
        if (meta) meta.textContent = "0 inscrito(s)"
        if (body) body.innerHTML = inscInfoHtml(
          "file",
          "Nenhuma planilha “Inscrição” encontrada",
          `Coloque a planilha de respostas do Forms (nomeada <b>“Inscrição”</b>) na pasta <code>${escapeHtml(pasta)}</code> e clique em Atualizar.`
        )
        return
      }
      st.inscState = "error"
      if (body) body.innerHTML = inscInfoHtml("error", "Não foi possível ler as inscrições", escapeHtml((data && data.error) || "Erro desconhecido."))
      return
    }

    st.inscritos = Array.isArray(data.inscritos) ? data.inscritos : []
    st.inscState = "ok"
    st.inscAt = data.atualizadoEm || ""
    if (meta) meta.textContent = `${st.inscritos.length} inscrito(s)`
    if (body) body.innerHTML = inscTableHtml(st.inscritos, st.inscAt)
  } catch (err) {
    st.inscState = "error"
    if (body) body.innerHTML = inscInfoHtml("error", "Falha de conexão", escapeHtml(err.message || "Tente novamente."))
  }
}

function inscTableHtml(insc, atualizadoEm) {
  if (!insc.length) {
    return `<div class="cell-empty">Nenhuma inscrição ainda. Quando o formulário receber respostas, elas aparecem aqui.</div>`
  }
  const rows = insc
    .map(
      (p, i) => `
      <tr>
        <td class="cell-num">${i + 1}</td>
        <td class="cell-name">${escapeHtml(p.nome || "")}</td>
        <td>${escapeHtml(p.email || "-")}</td>
        <td class="cell-num">${dataHoraBR(p.dataInscricao)}</td>
      </tr>`
    )
    .join("")
  return `
    <div class="table-scroll">
      <table class="data">
        <thead><tr><th style="width:48px">#</th><th>Nome</th><th>E-mail</th><th style="width:160px">Inscrito em</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${atualizadoEm ? `<p class="lemb-hint" style="margin-top:var(--space-3)"><i class="fas fa-clock"></i> Atualizado em ${dataHoraBR(atualizadoEm)}.</p>` : ""}`
}

const _inscIcon = { plug: "fa-plug-circle-xmark", file: "fa-file-circle-question", error: "fa-circle-exclamation", warn: "fa-triangle-exclamation" }
function inscInfoHtml(tipo, titulo, msg) {
  return `
    <div class="empty-state empty-state--inline">
      <div class="empty-state__art"><i class="fas ${_inscIcon[tipo] || "fa-circle-info"}"></i></div>
      <h3>${escapeHtml(titulo)}</h3>
      <p>${msg}</p>
    </div>`
}

// ================ ABA: ENCONTROS & LEMBRETES ================
export function renderEncontros(containerId, ev) {
  const host = document.getElementById(containerId)
  if (!host) return
  const st = store(ev)

  // Carrega a config salva (uma vez) antes de montar a tela.
  if (!st.encLoaded && st.encState !== "loading") {
    st.encState = "loading"
    host.innerHTML = `<div class="card">${loaderHtml("Carregando configuração de lembretes…")}</div>`
    carregarConfigEncontros(ev, st).finally(() => {
      st.encLoaded = true
      st.encState = "ok"
      renderEncontros(containerId, ev)
    })
    return
  }

  host.innerHTML = `
    <div class="card">
      <div class="card__header">
        <div>
          <h3><i class="fas fa-bell"></i> Encontros & Lembretes</h3>
          <p>Cadastre as datas e horários dos encontros. O sistema envia um lembrete por e-mail <b>1 dia antes</b> de cada um.</p>
        </div>
      </div>

      <div class="lemb-config">
        <label class="lemb-switch">
          <input type="checkbox" id="lembAtivo" ${st.lembreteAtivo ? "checked" : ""} />
          <span class="lemb-switch__track"><span class="lemb-switch__thumb"></span></span>
          <span class="lemb-switch__label">Enviar lembrete automático 1 dia antes de cada encontro</span>
        </label>
        <div class="field lemb-hora-field">
          <label for="lembHora"><i class="fas fa-clock"></i> Horário do disparo diário</label>
          <input type="time" id="lembHora" value="${escapeHtml(st.dispararHora)}" />
          <span class="lemb-hint">Horário de Brasília. O lembrete é enviado 1 dia antes de cada encontro, nesse horário.</span>
        </div>
      </div>

      <div class="lemb-enc-head">
        <h4>Encontros <span class="lemb-count">${st.encontros.length}</span></h4>
        <button type="button" class="btn btn--sm btn--primary" id="lembAddEnc"><i class="fas fa-plus"></i> Adicionar encontro</button>
      </div>

      <div class="lemb-enc-list" id="lembEncList">${encListHtml(st)}</div>

      <div id="lembStatus">${statusHtml(st)}</div>

      <div class="lemb-foot">
        <button type="button" class="btn btn--primary" id="lembSave"><i class="fas fa-floppy-disk"></i> Salvar configuração</button>
      </div>
    </div>
  `

  wireEncontros(host, containerId, ev, st)
}

function encListHtml(st) {
  if (!st.encontros.length) {
    return `<div class="cell-empty">Nenhum encontro cadastrado. Clique em “Adicionar encontro”.</div>`
  }
  return st.encontros
    .map(
      (e, i) => `
      <div class="lemb-enc" data-enc="${e.id}">
        <div class="lemb-enc__ord">${i + 1}</div>
        <div class="lemb-enc__fields">
          <div class="field lemb-enc__titulo">
            <label>Título</label>
            <input type="text" data-f="titulo" value="${escapeHtml(e.titulo || "")}" placeholder="Ex.: Encontro ${i + 1}" />
          </div>
          <div class="field">
            <label>Data</label>
            <input type="date" data-f="data" value="${escapeHtml(e.data || "")}" />
          </div>
          <div class="field field--time">
            <label>Início</label>
            <input type="time" data-f="horaInicio" value="${escapeHtml(e.horaInicio || "")}" />
          </div>
          <div class="field field--time">
            <label>Fim</label>
            <input type="time" data-f="horaFim" value="${escapeHtml(e.horaFim || "")}" />
          </div>
        </div>
        <div class="lemb-enc__side">
          <label class="lemb-switch lemb-switch--sm" title="Lembrete deste encontro">
            <input type="checkbox" data-f="ativo" ${e.ativo ? "checked" : ""} />
            <span class="lemb-switch__track"><span class="lemb-switch__thumb"></span></span>
          </label>
          <button type="button" class="pal-icon-btn pal-icon-btn--danger" data-del-enc="${e.id}" title="Remover encontro"><i class="fas fa-trash-can"></i></button>
        </div>
      </div>`
    )
    .join("")
}

function statusHtml(st) {
  if (!st.lembreteAtivo) {
    return `<div class="lemb-status lemb-status--off"><i class="fas fa-bell-slash"></i> Lembretes desativados para este evento.</div>`
  }
  const prox = proximoLembrete(st)
  if (!prox) {
    return `<div class="lemb-status"><i class="fas fa-circle-info"></i> Nenhum encontro futuro com lembrete ativo.</div>`
  }
  const destino = st.inscState === "ok" ? `<b>${st.inscritos.length}</b> inscrito(s)` : "os inscritos do evento"
  return `
    <div class="lemb-status lemb-status--on">
      <i class="fas fa-paper-plane"></i>
      <span>Próximo lembrete em <b>${formatDateBR(prox.lembreteData)} às ${escapeHtml(st.dispararHora)}</b> - encontro <b>“${escapeHtml(prox.titulo || "")}”</b> (${formatDateBR(prox.data)}) para ${destino}.</span>
    </div>`
}

function refreshStatus(host, st) {
  const box = host.querySelector("#lembStatus")
  if (box) box.innerHTML = statusHtml(st)
}

function wireEncontros(host, containerId, ev, st) {
  const q = (s) => host.querySelector(s)

  q("#lembAtivo")?.addEventListener("change", (e) => {
    st.lembreteAtivo = e.target.checked
    refreshStatus(host, st)
  })

  q("#lembHora")?.addEventListener("change", (e) => {
    st.dispararHora = e.target.value || "08:00"
    refreshStatus(host, st)
  })

  q("#lembAddEnc")?.addEventListener("click", () => {
    const n = st.encontros.length + 1
    st.encontros.push({ id: uid(), titulo: `Encontro ${n}`, data: "", horaInicio: "19:00", horaFim: "22:00", ativo: true })
    renderEncontros(containerId, ev)
  })

  host.querySelectorAll(".lemb-enc").forEach((row) => {
    const enc = st.encontros.find((x) => x.id === row.dataset.enc)
    if (!enc) return
    row.querySelectorAll("[data-f]").forEach((inp) => {
      const f = inp.dataset.f
      const evt = inp.type === "text" ? "input" : "change"
      inp.addEventListener(evt, () => {
        enc[f] = inp.type === "checkbox" ? inp.checked : inp.value
        if (f === "data" || f === "ativo") refreshStatus(host, st)
      })
    })
  })

  host.querySelectorAll("[data-del-enc]").forEach((b) =>
    b.addEventListener("click", () => {
      st.encontros = st.encontros.filter((x) => x.id !== b.dataset.delEnc)
      renderEncontros(containerId, ev)
    })
  )

  q("#lembSave")?.addEventListener("click", async () => {
    const btn = q("#lembSave")
    btn.disabled = true
    btn.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> Salvando…`
    try {
      const res = await fetch("/api/lembretes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "config-save",
          eventoKey: eventoKey(ev),
          titulo: (ev.grupo && ev.grupo.titulo) || ev.title || "",
          encontros: st.encontros,
          lembreteAtivo: st.lembreteAtivo,
          horaDisparo: st.dispararHora,
        }),
      })
      const data = await res.json().catch(() => null)
      if (res.status === 503) {
        showAlert({ type: "warn", title: "Lembretes ainda não configurados", message: "Falta publicar o Apps Script lembretesEventos.gs e definir LEMBRETES_WEBAPP_URL e LEMBRETES_TOKEN na Vercel." })
      } else if (data && data.ok) {
        showAlert({ type: "success", title: "Configuração salva", message: "Os lembretes serão enviados 1 dia antes de cada encontro, no horário definido." })
      } else {
        showAlert({ type: "error", title: "Não foi possível salvar", message: (data && data.error) || "Tente novamente." })
      }
    } catch (err) {
      showAlert({ type: "error", title: "Falha de conexão", message: err.message || "Tente novamente." })
    } finally {
      btn.disabled = false
      btn.innerHTML = `<i class="fas fa-floppy-disk"></i> Salvar configuração`
    }
  })
}

// Carrega a config salva (encontros + horário + ativo) do back-end.
async function carregarConfigEncontros(ev, st) {
  const key = eventoKey(ev)
  if (!key) return
  try {
    const res = await fetch("/api/lembretes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "config-get", eventoKey: key }),
    })
    if (!res.ok) return
    const data = await res.json()
    const c = data && data.ok ? data.config : null
    if (!c) return
    if (Array.isArray(c.encontros) && c.encontros.length) {
      st.encontros = c.encontros.map((e) => ({
        id: e.id || uid(),
        titulo: e.titulo || "",
        data: e.data || "",
        horaInicio: e.horaInicio || "",
        horaFim: e.horaFim || "",
        ativo: e.ativo !== false,
      }))
    }
    if (typeof c.lembreteAtivo === "boolean") st.lembreteAtivo = c.lembreteAtivo
    if (c.horaDisparo) st.dispararHora = c.horaDisparo
  } catch (_) {}
}
