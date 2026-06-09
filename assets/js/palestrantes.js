/**
 * palestrantes.js - módulo de cadastro de palestrantes.
 *
 * UI (formulário + galeria) que persiste via /api/palestrantes → Apps Script
 * (planilha Google Sheets + fotos no Drive). Sem dependências externas além
 * dos helpers de UI do projeto.
 *
 * Integração: app.js chama initPalestrantes(deps) uma vez e renderLista() na
 * view ativa (Galeria). O cadastro/edição acontece via openCadastroModal().
 */

import { escapeHtml, formatDateBR } from "./ui.js"
import { loaderHtml } from "./loader.js"

// ---- Eixos temáticos sugeridos (padroniza a digitação; aceita "Outro") ----
const EIXOS_TEMATICOS = [
  "Governança e Gestão Pública",
  "Planejamento, Orçamento e Responsabilidade Fiscal",
  "Licitações e Contratos Administrativos",
  "Controle Interno, Integridade e Compliance",
  "Governo Digital, Transformação Digital e Inovação",
  "Proteção de Dados e Segurança da Informação",
  "Liderança Pública e Gestão de Pessoas",
  "Atendimento ao Cidadão e Experiência do Usuário",
  "Sustentabilidade e Desenvolvimento Territorial",
]

const MINIBIO_MAX = 500

const BIO_TEMPLATE =
  "[Nome] é [cargo e especialidade]. " +
  "[Formação ou experiência: marco acadêmico, tempo de carreira ou empresa]. " +
  "[Foco/propósito: diferencial ou objetivo profissional]."

// ================ Dependências injetadas pelo app.js ================
let deps = {
  showAlert: (o) => window.alert(typeof o === "string" ? o : o.message),
  showConfirm: async (o) => window.confirm(typeof o === "string" ? o : o.message),
  showPrompt: async (o) => window.prompt(typeof o === "string" ? o : (o.label || o.message || "")),
  getEventos: () => [],
  navigate: () => {},
}

export function initPalestrantes(overrides) {
  deps = { ...deps, ...overrides }
}

// ================ Estado do módulo ================
let _cache = null          // lista de palestrantes já carregada
let _loading = false
let _editId = null         // id em edição (null = criação)
let _fotoPendente = null   // { dataUrl, mime } da nova foto escolhida
let _removerFoto = false   // marca remoção da foto existente (edição)

// ================ API ================
async function api(action, payload = {}) {
  const res = await fetch("/api/palestrantes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  })
  let data
  try { data = await res.json() } catch { data = { ok: false, error: "Resposta inválida do servidor." } }
  if (!res.ok || !data.ok) throw new Error(data.error || `Falha na requisição (${res.status}).`)
  return data
}

async function carregarLista(force = false) {
  if (_cache && !force) return _cache
  const data = await api("list")
  _cache = Array.isArray(data.palestrantes) ? data.palestrantes : []
  return _cache
}

// ================ Utilidades ================
// Comprime a imagem no client (redimensiona e converte p/ JPEG) antes do
// upload, para caber no limite do proxy e poupar Drive.
function comprimirImagem(file, maxLado = 800, quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) {
      reject(new Error("Selecione um arquivo de imagem (JPG ou PNG)."))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Falha ao ler a imagem."))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error("Arquivo de imagem inválido."))
      img.onload = () => {
        let { width, height } = img
        if (width >= height && width > maxLado) {
          height = Math.round((height * maxLado) / width)
          width = maxLado
        } else if (height > width && height > maxLado) {
          width = Math.round((width * maxLado) / height)
          height = maxLado
        }
        const canvas = document.createElement("canvas")
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext("2d")
        ctx.fillStyle = "#fff"
        ctx.fillRect(0, 0, width, height)
        ctx.drawImage(img, 0, 0, width, height)
        resolve({ dataUrl: canvas.toDataURL("image/jpeg", quality), mime: "image/jpeg" })
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

function iniciais(nome) {
  const partes = String(nome || "").trim().split(/\s+/).filter(Boolean)
  if (!partes.length) return "?"
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}

function avatarHtml(p, size = "lg") {
  const url = _fotoPendente ? _fotoPendente.dataUrl : (!_removerFoto && p && p.fotoUrl ? p.fotoUrl : "")
  if (url) {
    return `<img class="pal-avatar pal-avatar--${size}" src="${escapeHtml(url)}" alt="Foto de ${escapeHtml(p?.nome || "palestrante")}" loading="lazy" referrerpolicy="no-referrer" />`
  }
  return `<div class="pal-avatar pal-avatar--${size} pal-avatar--ph" aria-hidden="true">${escapeHtml(iniciais(p?.nome))}</div>`
}

function resetForm() {
  _editId = null
  _fotoPendente = null
  _removerFoto = false
}

// ================ Modal: CADASTRAR / EDITAR (etapas) ================
let _palModalEl = null
function _palEsc(e) { if (e.key === "Escape") fecharCadastroModal() }
function fecharCadastroModal() {
  if (!_palModalEl) return
  document.removeEventListener("keydown", _palEsc)
  _palModalEl.remove()
  _palModalEl = null
}

export async function openCadastroModal(id = null) {
  _editId = id || null
  _fotoPendente = null
  _removerFoto = false
  if (_editId && !_cache) { try { await carregarLista() } catch (_) {} }
  const atual = _editId ? (_cache || []).find((p) => p.id === _editId) : null
  if (_editId && !atual) _editId = null
  const editando = !!_editId
  const p = atual || {}

  const eventos = (deps.getEventos() || []).filter((e) => e && e.title)
  // Curso salvo que não corresponde a um evento da lista atual. Dois casos:
  //  - evento removido/arquivado (tem cursoId que não existe mais);
  //  - cadastro via convite, onde o curso é texto livre (sem cursoId).
  // Em ambos preservamos a opção na edição p/ não travar a navegação nem perder o dado.
  const cursoSalvoExiste = !!p.cursoId && eventos.some((e) => String(e.id) === String(p.cursoId))
  const cursoSalvoValor = p.cursoId || p.cursoTitulo || ""
  const cursoFallback = editando && cursoSalvoValor && !cursoSalvoExiste
    ? `<option value="${escapeHtml(cursoSalvoValor)}" selected>${escapeHtml(p.cursoTitulo || "Curso atual")}</option>`
    : ""
  const cursoOptions = eventos
    .map((e) => `<option value="${escapeHtml(e.id)}" ${String(p.cursoId || "") === String(e.id) ? "selected" : ""}>${escapeHtml(e.title)}</option>`)
    .join("")
  const cursoSelDisabled = eventos.length || cursoFallback ? "" : "disabled"
  const eixosSel = Array.isArray(p.eixos)
    ? p.eixos
    : (p.eixo ? String(p.eixo).split(/;\s*/).map((x) => x.trim()).filter(Boolean) : [])
  const eixosTodos = EIXOS_TEMATICOS.concat(eixosSel.filter((x) => !EIXOS_TEMATICOS.includes(x)))
  const eixosChecks = eixosTodos
    .map((x) => {
      const ck = eixosSel.includes(x) ? "checked" : ""
      return `<label class="${ck ? "pal-eixo-opt is-checked" : "pal-eixo-opt"}"><input type="checkbox" name="palEixo" value="${escapeHtml(x)}" ${ck} /><span>${escapeHtml(x)}</span></label>`
    })
    .join("")
  const bioLen = (p.miniBio || "").length

  fecharCadastroModal()
  const overlay = document.createElement("div")
  overlay.className = "pal-modal__overlay"
  overlay.innerHTML = `
    <div class="pal-modal" role="dialog" aria-modal="true" aria-label="${editando ? "Editar palestrante" : "Novo palestrante"}">
      <div class="pal-modal__head">
        <h3><i class="fas fa-microphone-lines"></i> ${editando ? "Editar palestrante" : "Novo palestrante"}</h3>
        <button type="button" class="pal-modal__close" id="palModalClose" aria-label="Fechar"><i class="fas fa-xmark"></i></button>
      </div>
      <div class="pal-modal__steps" id="palSteps">
        <button type="button" data-step="0" class="is-active">1. Identificação</button>
        <button type="button" data-step="1">2. Eixos temáticos</button>
        <button type="button" data-step="2">3. Mini bio</button>
      </div>
      <form id="palForm" class="pal-modal__body pal-form-card" novalidate>
        <section class="pal-step" data-panel="0">
          <div class="pal-top">
            <div class="pal-photo">
              <label class="field__label-block">Foto</label>
              <div class="pal-photo-box" id="palPhotoBox">${avatarHtml(p, "xl")}</div>
              <div class="pal-photo-actions">
                <label class="btn btn--sm pal-upload-btn">
                  <i class="fas fa-image"></i> <span>${p.fotoUrl || _fotoPendente ? "Trocar foto" : "Escolher foto"}</span>
                  <input type="file" id="palFoto" accept="image/png,image/jpeg" hidden />
                </label>
                <button type="button" class="btn btn--sm pal-photo-remove" id="palFotoRemove" ${(_fotoPendente || (p.fotoUrl && !_removerFoto)) ? "" : "hidden"}>
                  <i class="fas fa-trash-can"></i> Remover
                </button>
              </div>
              <p class="pal-hint pal-hint--center">JPG ou PNG. Redimensionada automaticamente.</p>
            </div>
            <div class="pal-top-fields">
              <div class="field">
                <label for="palNome">Nome completo *</label>
                <input type="text" id="palNome" required minlength="3" maxlength="120" placeholder="Use o nome completo ou profissional" value="${escapeHtml(p.nome || "")}" autocomplete="off" />
              </div>
              <div class="field">
                <label for="palCurso">Curso ministrado *</label>
                <select id="palCurso" required ${cursoSelDisabled}>
                  <option value="" ${p.cursoId ? "" : "selected"} disabled>${eventos.length ? "Selecione o curso/evento" : "Nenhum evento disponível"}</option>
                  ${cursoFallback}
                  ${cursoOptions}
                </select>
              </div>
            </div>
          </div>
        </section>
        <section class="pal-step" data-panel="1" hidden>
          <div class="field">
            <label>Eixo temático * <span class="pal-label-aux">(selecione um ou mais)</span></label>
            <div class="pal-eixos" id="palEixos">${eixosChecks}</div>
          </div>
        </section>
        <section class="pal-step" data-panel="2" hidden>
          <div class="field">
            <div class="pal-bio-head">
              <label for="palBio">Mini bio</label>
              <div class="pal-bio-tools">
                <button type="button" class="pal-link-btn" id="palBioTemplate" title="Inserir estrutura padrão"><i class="fas fa-wand-magic-sparkles"></i> Inserir estrutura</button>
                <span class="pal-bio-count" id="palBioCount">${bioLen}/${MINIBIO_MAX}</span>
              </div>
            </div>
            <textarea id="palBio" rows="6" maxlength="${MINIBIO_MAX}" placeholder="Quem é, cargo/especialidade, formação/experiência e foco/propósito.">${escapeHtml(p.miniBio || "")}</textarea>
            <p class="pal-hint"><b>Estrutura recomendada:</b> Nome, Cargo e Especialidade, Formação ou Experiência, Foco/Propósito.</p>
          </div>
        </section>
      </form>
      <div class="pal-modal__foot">
        <div class="err" id="palErr" role="alert"></div>
        <div class="pal-modal__nav">
          <button type="button" class="btn btn--sm" id="palPrev" hidden><i class="fas fa-arrow-left"></i> Voltar</button>
          <button type="button" class="btn btn--primary btn--sm" id="palNext">Próximo <i class="fas fa-arrow-right"></i></button>
          <button type="submit" form="palForm" class="btn btn--primary btn--sm" id="palSubmit" hidden><i class="fas fa-floppy-disk"></i> <span>${editando ? "Salvar alterações" : "Cadastrar"}</span></button>
        </div>
      </div>
    </div>
  `
  document.body.appendChild(overlay)
  _palModalEl = overlay
  document.addEventListener("keydown", _palEsc)
  overlay.addEventListener("click", (e) => { if (e.target === overlay) fecharCadastroModal() })
  overlay.querySelector("#palModalClose").addEventListener("click", fecharCadastroModal)

  wirePalModal(p)
}

function wirePalModal(p) {
  const ov = _palModalEl
  const q = (sel) => ov.querySelector(sel)
  const form = q("#palForm")
  const bio = q("#palBio")
  const count = q("#palBioCount")
  const errBox = q("#palErr")
  const photoBox = q("#palPhotoBox")
  const removeBtn = q("#palFotoRemove")
  const prevBtn = q("#palPrev"), nextBtn = q("#palNext"), submitBtn = q("#palSubmit")
  const stepsBtns = [...ov.querySelectorAll("#palSteps button")]
  const panels = [...ov.querySelectorAll(".pal-step")]
  let step = 0

  const showErr = (msg) => { errBox.innerHTML = msg ? `<i class="fas fa-circle-exclamation"></i> ${escapeHtml(msg)}` : "" }
  const autoGrow = () => { bio.style.height = "auto"; bio.style.height = Math.max(bio.scrollHeight, 120) + "px" }
  const updateCount = () => {
    const len = bio.value.length
    count.textContent = `${len}/${MINIBIO_MAX}`
    count.classList.toggle("is-warn", len >= MINIBIO_MAX * 0.85 && len < MINIBIO_MAX)
    count.classList.toggle("is-full", len >= MINIBIO_MAX)
  }
  const showStep = (i) => {
    step = i
    panels.forEach((pl, idx) => { pl.hidden = idx !== i })
    stepsBtns.forEach((b, idx) => { b.classList.toggle("is-active", idx === i); b.classList.toggle("is-done", idx < i) })
    prevBtn.hidden = i === 0
    nextBtn.hidden = i === panels.length - 1
    submitBtn.hidden = i !== panels.length - 1
    if (i === 2) requestAnimationFrame(autoGrow)
  }
  const validateStep = (i) => {
    if (i === 0) {
      if (q("#palNome").value.trim().length < 3) { showErr("Informe o nome completo (mínimo 3 caracteres)."); return false }
      if (!q("#palCurso").value) { showErr("Selecione o curso ministrado."); return false }
    }
    if (i === 1 && !ov.querySelectorAll('#palEixos input:checked').length) { showErr("Selecione ao menos um eixo temático."); return false }
    showErr("")
    return true
  }

  nextBtn.addEventListener("click", () => { if (validateStep(step)) showStep(Math.min(step + 1, panels.length - 1)) })
  prevBtn.addEventListener("click", () => { showErr(""); showStep(Math.max(step - 1, 0)) })
  stepsBtns.forEach((b) => b.addEventListener("click", () => {
    const target = +b.dataset.step
    if (target > step) { for (let k = step; k < target; k++) { if (!validateStep(k)) { showStep(k); return } } }
    showErr(""); showStep(target)
  }))

  bio.addEventListener("input", () => { updateCount(); autoGrow() })
  updateCount()
  q("#palBioTemplate").addEventListener("click", () => {
    if (!bio.value.trim()) { bio.value = BIO_TEMPLATE; updateCount(); autoGrow() }
    bio.focus()
  })

  ov.querySelectorAll("#palEixos .pal-eixo-opt").forEach((opt) => {
    const cb = opt.querySelector("input")
    cb.addEventListener("change", () => opt.classList.toggle("is-checked", cb.checked))
  })

  const refreshPhoto = () => {
    photoBox.innerHTML = avatarHtml(p, "xl")
    removeBtn.hidden = !(_fotoPendente || (p.fotoUrl && !_removerFoto))
  }
  q("#palFoto").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    try { _fotoPendente = await comprimirImagem(file); _removerFoto = false; refreshPhoto(); showErr("") }
    catch (err) { showErr(err.message) }
    finally { e.target.value = "" }
  })
  removeBtn.addEventListener("click", () => { _fotoPendente = null; _removerFoto = true; refreshPhoto() })

  form.addEventListener("submit", async (e) => {
    e.preventDefault()
    showErr("")
    const nome = q("#palNome").value.trim()
    const eixos = [...ov.querySelectorAll('#palEixos input[name="palEixo"]:checked')].map((c) => c.value)
    const cursoSel = q("#palCurso")
    const cursoId = cursoSel.value
    const cursoTitulo = cursoSel.selectedOptions[0]?.value ? cursoSel.selectedOptions[0].textContent.trim() : ""
    const miniBio = bio.value.trim()

    if (nome.length < 3) { showStep(0); return showErr("Informe o nome completo (mínimo 3 caracteres).") }
    if (!cursoId || !cursoTitulo) { showStep(0); return showErr("Selecione o curso ministrado.") }
    if (!eixos.length) { showStep(1); return showErr("Selecione ao menos um eixo temático.") }
    if (!miniBio) { showStep(2); return showErr("Escreva a mini bio.") }
    if (miniBio.length > MINIBIO_MAX) { showStep(2); return showErr(`A mini bio excede ${MINIBIO_MAX} caracteres.`) }

    submitBtn.disabled = true
    submitBtn.classList.add("is-loading")
    const labelSpan = submitBtn.querySelector("span")
    const labelPrev = labelSpan ? labelSpan.textContent : ""
    if (labelSpan) labelSpan.textContent = "Salvando..."

    const payload = { nome, eixos, cursoId, cursoTitulo, miniBio }
    if (_fotoPendente) { payload.fotoBase64 = _fotoPendente.dataUrl; payload.fotoMime = _fotoPendente.mime }
    else if (_editId && _removerFoto) { payload.removerFoto = true }

    try {
      if (_editId) {
        const data = await api("update", { id: _editId, ...payload })
        if (_cache) { const idx = _cache.findIndex((x) => x.id === _editId); if (idx >= 0 && data.palestrante) _cache[idx] = data.palestrante }
      } else {
        const data = await api("create", payload)
        if (_cache && data.palestrante) _cache.unshift(data.palestrante)
      }
      const eraEdicao = !!_editId
      resetForm()
      fecharCadastroModal()
      await deps.showAlert({
        type: "success",
        title: eraEdicao ? "Palestrante atualizado" : "Palestrante cadastrado",
        message: eraEdicao ? "As alterações foram salvas." : "O palestrante foi adicionado com sucesso.",
      })
      renderLista()
    } catch (err) {
      submitBtn.disabled = false
      submitBtn.classList.remove("is-loading")
      if (labelSpan) labelSpan.textContent = labelPrev
      showErr(err.message || "Não foi possível salvar. Tente novamente.")
    }
  })

  showStep(0)
}

// ================ View: GALERIA / LISTA ================
export async function renderLista() {
  const view = document.getElementById("view-palestrantes-lista")
  if (!view) return

  // Loader enquanto a lista não chegou da API.
  if (!_cache) {
    view.innerHTML = `
      <div class="card">
        <div class="card__header">
          <div><h3><i class="fas fa-users-rectangle"></i> Palestrantes</h3><p>Buscando cadastros…</p></div>
        </div>
        ${loaderHtml("Carregando informações…")}
      </div>`
  }

  let lista
  try {
    lista = await carregarLista()
  } catch (err) {
    const naoConfig = /não configurado|nao configurado|503/i.test(err.message)
    view.innerHTML = naoConfig
      ? `<div class="empty-state">
          <div class="empty-state__art"><i class="fas fa-plug-circle-xmark"></i></div>
          <h3>Módulo de palestrantes ainda não configurado</h3>
          <p>Falta publicar o Apps Script <b>cadastroPalestrantes.gs</b> e definir as variáveis
             <code>PALESTRANTES_WEBAPP_URL</code> e <code>PALESTRANTES_TOKEN</code> na Vercel.
             Veja <b>apps-script/README-palestrantes.md</b>.</p>
          <div class="empty-state__actions">
            <button class="btn btn--primary" id="palRetry"><i class="fas fa-arrows-rotate"></i> Tentar novamente</button>
          </div>
        </div>`
      : `<div class="empty-state">
          <div class="empty-state__art"><i class="fas fa-circle-exclamation"></i></div>
          <h3>Não foi possível carregar os palestrantes</h3>
          <p>${escapeHtml(err.message)}</p>
          <div class="empty-state__actions">
            <button class="btn btn--primary" id="palRetry"><i class="fas fa-arrows-rotate"></i> Tentar novamente</button>
          </div>
        </div>`
    document.getElementById("palRetry")?.addEventListener("click", () => {
      _cache = null
      renderLista()
    })
    return
  }

  view.innerHTML = `
    <div class="card">
      <div class="card__header">
        <div>
          <h3><i class="fas fa-users-rectangle"></i> Palestrantes</h3>
          <p>Cadastrados na escola de governo.</p>
        </div>
        <div class="pal-list-actions">
          <span class="card__header-meta" id="palMeta">${lista.length} palestrante(s)</span>
          <button type="button" class="btn btn--sm" id="palReload" title="Recarregar"><i class="fas fa-arrows-rotate"></i></button>
          <button type="button" class="btn btn--sm" id="palConvite"><i class="fas fa-link"></i> Gerar link de convite</button>
          <button type="button" class="btn btn--primary btn--sm" id="palNovo"><i class="fas fa-plus"></i> Novo</button>
        </div>
      </div>
      <div id="palInviteHost"></div>
      ${lista.length ? `
        <div class="filter" style="margin-bottom: var(--space-3);">
          <label for="palBusca">Buscar</label>
          <input type="search" id="palBusca" placeholder="nome, eixo ou curso" />
        </div>` : ""}
      <div id="palGridHost"></div>
    </div>
  `

  const gridHost = document.getElementById("palGridHost")
  const meta = document.getElementById("palMeta")

  const draw = (arr) => {
    if (!arr.length) {
      gridHost.innerHTML = `
        <div class="empty-state empty-state--inline">
          <div class="empty-state__art"><i class="fas fa-microphone-slash"></i></div>
          <h3>${lista.length ? "Nenhum resultado" : "Nenhum palestrante cadastrado"}</h3>
          <p>${lista.length ? "Ajuste a busca." : "Clique em \"Novo\" para cadastrar o primeiro."}</p>
        </div>`
      return
    }
    gridHost.innerHTML = `<div class="pal-grid">${arr.map(cardHtml).join("")}</div>`
    gridHost.querySelectorAll("[data-pal-edit]").forEach((b) =>
      b.addEventListener("click", () => abrirEdicao(b.dataset.palEdit))
    )
    gridHost.querySelectorAll("[data-pal-del]").forEach((b) =>
      b.addEventListener("click", () => excluir(b.dataset.palDel))
    )
  }
  draw(lista)

  document.getElementById("palNovo")?.addEventListener("click", () => {
    openCadastroModal()
  })
  document.getElementById("palReload")?.addEventListener("click", async () => {
    _cache = null
    renderLista()
  })
  document.getElementById("palConvite")?.addEventListener("click", gerarConvite)

  const busca = document.getElementById("palBusca")
  if (busca) {
    busca.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase().trim()
      const filtrada = !q ? lista : lista.filter((p) =>
        (p.nome || "").toLowerCase().includes(q) ||
        eixosDe(p).join(" ").toLowerCase().includes(q) ||
        (p.cursoTitulo || "").toLowerCase().includes(q)
      )
      meta.textContent = `${filtrada.length} palestrante(s)`
      draw(filtrada)
    })
  }
}

// Eixos como array, aceitando o formato novo (array) ou legado (string "A; B").
function eixosDe(p) {
  if (Array.isArray(p.eixos)) return p.eixos
  if (p.eixo) return String(p.eixo).split(/;\s*/).map((x) => x.trim()).filter(Boolean)
  return []
}

function cardHtml(p) {
  const fotoBkp = _fotoPendente, removeBkp = _removerFoto
  _fotoPendente = null; _removerFoto = false // garante uso de p.fotoUrl
  const avatar = avatarHtml(p, "card")
  _fotoPendente = fotoBkp; _removerFoto = removeBkp

  const bio = p.miniBio
    ? `<p class="pal-card__bio">${escapeHtml(p.miniBio)}</p>`
    : `<p class="pal-card__bio pal-card__bio--empty">Sem mini bio.</p>`

  const chips = eixosDe(p).map((x) => `<span class="pal-chip">${escapeHtml(x)}</span>`).join("")
  const origemBadge = p.origem === "convite"
    ? `<span class="pal-origem" title="Cadastrado via link de convite"><i class="fas fa-link"></i></span>`
    : ""

  // Layout vertical: a FOTO é o destaque (topo), depois nome, eixo, curso, bio.
  return `
    <article class="pal-card pal-card--v">
      <div class="pal-card__photo">${avatar}</div>
      <h4 class="pal-card__name" title="${escapeHtml(p.nome)}">${origemBadge}${escapeHtml(p.nome)}</h4>
      ${chips ? `<div class="pal-card__chips">${chips}</div>` : ""}
      ${p.cursoTitulo ? `<div class="pal-card__curso"><i class="fas fa-chalkboard-user"></i> ${escapeHtml(p.cursoTitulo)}</div>` : ""}
      ${bio}
      <div class="pal-card__foot">
        <span class="pal-card__date">${p.criadoEm ? formatDateBR(String(p.criadoEm).slice(0, 10)) : ""}</span>
        <div class="pal-card__actions">
          <button type="button" class="pal-icon-btn" data-pal-edit="${escapeHtml(p.id)}" title="Editar"><i class="fas fa-pen"></i></button>
          <button type="button" class="pal-icon-btn pal-icon-btn--danger" data-pal-del="${escapeHtml(p.id)}" title="Excluir"><i class="fas fa-trash-can"></i></button>
        </div>
      </div>
    </article>
  `
}

function abrirEdicao(id) {
  openCadastroModal(id)
}

async function excluir(id) {
  const p = (_cache || []).find((x) => x.id === id)
  const ok = await deps.showConfirm({
    type: "warn",
    danger: true,
    title: "Excluir palestrante",
    message: `Remover "${p?.nome || "este palestrante"}"? A foto será apagada do Drive. Esta ação pode ser revertida na planilha (Status = ativo).`,
    confirmLabel: "Excluir",
  })
  if (!ok) return
  try {
    await api("delete", { id })
    if (_cache) _cache = _cache.filter((x) => x.id !== id)
    renderLista()
  } catch (err) {
    deps.showAlert({ type: "error", title: "Falha ao excluir", message: err.message })
  }
}

// Busca a lista de convites (para o sino de notificações acompanhar pendentes).
// Retorna [] em caso de erro/serviço indisponível (não quebra o dashboard).
export async function listarConvites() {
  try {
    const data = await api("invite-list")
    return Array.isArray(data.convites) ? data.convites : []
  } catch (_) {
    return []
  }
}

// ================ Convites de uso único ================
async function gerarConvite() {
  const host = document.getElementById("palInviteHost")
  const btn = document.getElementById("palConvite")
  if (!host) return

  // Pede o nome do palestrante antes de gerar (alimenta o alerta de "ainda não
  // preencheu" após 3 dias, no sino de notificações).
  const nome = await deps.showPrompt({
    title: "Gerar link de convite",
    label: "Nome do palestrante",
    placeholder: "Ex.: Maria Souza",
    message: "Usamos o nome só para acompanhar quem ainda não preencheu o cadastro.",
    confirmLabel: "Gerar link",
    maxLength: 120,
  })
  if (!nome) return // cancelou

  if (btn) btn.disabled = true
  host.innerHTML = `<div class="pal-invite pal-invite--loading"><i class="fas fa-circle-notch fa-spin"></i> Gerando link…</div>`
  try {
    const data = await api("invite-create", { nome })
    const url = `${location.origin}/cadastro-palestrante?convite=${encodeURIComponent(data.token)}`
    host.innerHTML = `
      <div class="pal-invite">
        <div class="pal-invite__head">
          <strong><i class="fas fa-link"></i> Link de convite gerado</strong>
          <span class="pal-invite__badge">uso único</span>
          <button type="button" class="pal-invite__close" id="palInviteClose" title="Fechar"><i class="fas fa-xmark"></i></button>
        </div>
        <div class="pal-invite__row">
          <input type="text" id="palInviteUrl" readonly value="${escapeHtml(url)}" />
          <button type="button" class="btn btn--primary btn--sm" id="palInviteCopy"><i class="fas fa-copy"></i> Copiar</button>
        </div>
        <p class="pal-invite__hint">Envie este link para <b>${escapeHtml(nome)}</b>. O cadastro pode ser preenchido <b>uma única vez</b>; após o envio o link expira. Se não preencher em 3 dias, um alerta aparece no sino de notificações.</p>
      </div>`
    const input = document.getElementById("palInviteUrl")
    input.focus()
    input.select()
    document.getElementById("palInviteCopy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(url)
      } catch {
        input.select()
        document.execCommand("copy")
      }
      const b = document.getElementById("palInviteCopy")
      b.innerHTML = `<i class="fas fa-check"></i> Copiado`
      setTimeout(() => { b.innerHTML = `<i class="fas fa-copy"></i> Copiar` }, 1800)
    })
    document.getElementById("palInviteClose").addEventListener("click", () => { host.innerHTML = "" })
  } catch (err) {
    host.innerHTML = `<div class="pal-invite pal-invite--err"><i class="fas fa-circle-exclamation"></i> ${escapeHtml(err.message)}</div>`
  } finally {
    if (btn) btn.disabled = false
  }
}
