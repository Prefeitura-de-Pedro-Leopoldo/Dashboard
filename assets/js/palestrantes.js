/**
 * palestrantes.js - módulo de cadastro de palestrantes.
 *
 * UI (formulário + galeria) que persiste via /api/palestrantes → Apps Script
 * (planilha Google Sheets + fotos no Drive). Sem dependências externas além
 * dos helpers de UI do projeto.
 *
 * Integração: app.js chama initPalestrantes(deps) uma vez e, no roteador,
 * renderCadastro()/renderLista() conforme a view ativa.
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

// ================ View: CADASTRAR / EDITAR ================
export function renderCadastro() {
  const view = document.getElementById("view-palestrantes-cadastro")
  if (!view) return

  const editando = !!_editId
  const atual = editando ? (_cache || []).find((p) => p.id === _editId) : null
  if (editando && !atual) {
    // Item não está no cache (refresh direto): cai para criação.
    resetForm()
  }
  const p = atual || {}

  const eventos = (deps.getEventos() || []).filter((e) => e && e.title)
  const cursoOptions = eventos
    .map((e) => {
      const sel = String(p.cursoId || "") === String(e.id) ? "selected" : ""
      return `<option value="${escapeHtml(e.id)}" ${sel}>${escapeHtml(e.title)}</option>`
    })
    .join("")

  // Eixos selecionados (array vindo da API, ou string legada "A; B").
  const eixosSel = Array.isArray(p.eixos)
    ? p.eixos
    : (p.eixo ? String(p.eixo).split(/;\s*/).map((x) => x.trim()).filter(Boolean) : [])
  // União com a lista padrão para exibir também eixos custom já gravados.
  const eixosTodos = EIXOS_TEMATICOS.concat(eixosSel.filter((x) => !EIXOS_TEMATICOS.includes(x)))
  const eixosChecks = eixosTodos
    .map((x) => {
      const ck = eixosSel.includes(x) ? "checked" : ""
      const cls = ck ? "pal-eixo-opt is-checked" : "pal-eixo-opt"
      return `<label class="${cls}"><input type="checkbox" name="palEixo" value="${escapeHtml(x)}" ${ck} /><span>${escapeHtml(x)}</span></label>`
    })
    .join("")

  const bioLen = (p.miniBio || "").length

  view.innerHTML = `
    <div class="card pal-form-card">
      <div class="card__header">
        <div>
          <h3><i class="fas fa-microphone-lines"></i> ${editando ? "Editar palestrante" : "Cadastrar palestrante"}</h3>
          <p>${editando ? "Atualize os dados e salve." : "Preencha os campos abaixo. Os dados são salvos na planilha e a foto no Drive."}</p>
        </div>
        ${editando ? `<button type="button" class="btn btn--sm" id="palCancelEdit"><i class="fas fa-xmark"></i> Cancelar edição</button>` : ""}
      </div>

      <form id="palForm" novalidate>
        <div class="pal-form2">
          <div class="pal-top">
            <div class="pal-photo">
              <label class="field__label-block">Foto</label>
              <div class="pal-photo-box" id="palPhotoBox">
                ${avatarHtml(p, "xl")}
              </div>
              <div class="pal-photo-actions">
                <label class="btn btn--sm pal-upload-btn">
                  <i class="fas fa-image"></i> <span>${p.fotoUrl || _fotoPendente ? "Trocar foto" : "Escolher foto"}</span>
                  <input type="file" id="palFoto" accept="image/png,image/jpeg" hidden />
                </label>
                <button type="button" class="btn btn--sm pal-photo-remove" id="palFotoRemove"
                  ${(_fotoPendente || (p.fotoUrl && !_removerFoto)) ? "" : "hidden"}>
                  <i class="fas fa-trash-can"></i> Remover
                </button>
              </div>
              <p class="pal-hint pal-hint--center">JPG ou PNG. Redimensionada automaticamente.</p>
            </div>

            <div class="pal-top-fields">
              <div class="field">
                <label for="palNome">Nome completo *</label>
                <input type="text" id="palNome" required minlength="3" maxlength="120"
                  placeholder="Use o nome completo ou profissional"
                  value="${escapeHtml(p.nome || "")}" autocomplete="off" />
              </div>
              <div class="field">
                <label for="palCurso">Curso ministrado *</label>
                <select id="palCurso" required ${eventos.length ? "" : "disabled"}>
                  <option value="" ${p.cursoId ? "" : "selected"} disabled>${eventos.length ? "Selecione o curso/evento" : "Nenhum evento disponível"}</option>
                  ${cursoOptions}
                </select>
              </div>
            </div>
          </div>

          <div class="field">
            <label>Eixo temático * <span class="pal-label-aux">(selecione um ou mais)</span></label>
            <div class="pal-eixos" id="palEixos">${eixosChecks}</div>
          </div>

          <div class="field">
            <div class="pal-bio-head">
              <label for="palBio">Mini bio</label>
              <div class="pal-bio-tools">
                <button type="button" class="pal-link-btn" id="palBioTemplate" title="Inserir estrutura padrão">
                  <i class="fas fa-wand-magic-sparkles"></i> Inserir estrutura
                </button>
                <span class="pal-bio-count" id="palBioCount">${bioLen}/${MINIBIO_MAX}</span>
              </div>
            </div>
            <textarea id="palBio" rows="6" maxlength="${MINIBIO_MAX}"
              placeholder="Quem é, cargo/especialidade, formação/experiência e foco/propósito.">${escapeHtml(p.miniBio || "")}</textarea>
            <p class="pal-hint">
              <b>Estrutura recomendada:</b> Nome → Cargo e Especialidade →
              Formação ou Experiência → Foco/Propósito.
            </p>
          </div>
        </div>

        <div class="pal-form-footer">
          <div class="err" id="palErr" role="alert"></div>
          <div class="pal-form-footer__actions">
            <button type="submit" class="btn btn--primary" id="palSubmit">
              <i class="fas fa-floppy-disk"></i>
              <span>${editando ? "Salvar alterações" : "Cadastrar palestrante"}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  `

  wireCadastro(p)
}

function wireCadastro(p) {
  const form = document.getElementById("palForm")
  const bio = document.getElementById("palBio")
  const count = document.getElementById("palBioCount")
  const errBox = document.getElementById("palErr")
  const photoBox = document.getElementById("palPhotoBox")
  const removeBtn = document.getElementById("palFotoRemove")

  const showErr = (msg) => {
    errBox.innerHTML = msg ? `<i class="fas fa-circle-exclamation"></i> ${escapeHtml(msg)}` : ""
  }
  const refreshPhoto = () => {
    photoBox.innerHTML = avatarHtml(p, "xl")
    const temFoto = !!_fotoPendente || (!!p.fotoUrl && !_removerFoto)
    removeBtn.hidden = !temFoto
  }

  // Cresce a textarea conforme o conteúdo (sem scroll), para caber os 500 chars.
  const autoGrow = () => {
    bio.style.height = "auto"
    bio.style.height = Math.max(bio.scrollHeight, 120) + "px"
  }
  // Contador da bio com cor progressiva.
  const updateCount = () => {
    const len = bio.value.length
    count.textContent = `${len}/${MINIBIO_MAX}`
    count.classList.toggle("is-warn", len >= MINIBIO_MAX * 0.85 && len < MINIBIO_MAX)
    count.classList.toggle("is-full", len >= MINIBIO_MAX)
  }
  bio.addEventListener("input", () => { updateCount(); autoGrow() })
  updateCount()
  // autoGrow após render (a view já está visível neste ponto).
  requestAnimationFrame(autoGrow)

  // Realça os eixos marcados.
  document.querySelectorAll("#palEixos .pal-eixo-opt").forEach((opt) => {
    const cb = opt.querySelector("input")
    cb.addEventListener("change", () => opt.classList.toggle("is-checked", cb.checked))
  })

  document.getElementById("palBioTemplate").addEventListener("click", () => {
    if (bio.value.trim() && bio.value.trim() !== BIO_TEMPLATE) {
      // não sobrescreve conteúdo sem confirmação implícita: só insere se vazio
      // ou se já é o próprio template.
    }
    if (!bio.value.trim()) {
      bio.value = BIO_TEMPLATE
      updateCount()
      autoGrow()
    }
    bio.focus()
  })

  // Upload de foto.
  document.getElementById("palFoto").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    try {
      _fotoPendente = await comprimirImagem(file)
      _removerFoto = false
      refreshPhoto()
      showErr("")
    } catch (err) {
      showErr(err.message)
    } finally {
      e.target.value = "" // permite reescolher o mesmo arquivo
    }
  })

  removeBtn.addEventListener("click", () => {
    _fotoPendente = null
    _removerFoto = true
    refreshPhoto()
  })

  const cancelBtn = document.getElementById("palCancelEdit")
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      resetForm()
      renderCadastro()
    })
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault()
    showErr("")

    const nome = document.getElementById("palNome").value.trim()
    const eixos = Array.from(document.querySelectorAll('#palEixos input[name="palEixo"]:checked')).map((c) => c.value)
    const cursoSel = document.getElementById("palCurso")
    const cursoId = cursoSel.value
    const cursoTitulo = cursoSel.selectedOptions[0]?.value ? cursoSel.selectedOptions[0].textContent.trim() : ""
    const miniBio = bio.value.trim()

    if (nome.length < 3) return showErr("Informe o nome completo (mínimo 3 caracteres).")
    if (!eixos.length) return showErr("Selecione ao menos um eixo temático.")
    if (!cursoId || !cursoTitulo) return showErr("Selecione o curso ministrado.")
    if (!miniBio) return showErr("Escreva a mini bio.")
    if (miniBio.length > MINIBIO_MAX) return showErr(`A mini bio excede ${MINIBIO_MAX} caracteres.`)

    const submitBtn = document.getElementById("palSubmit")
    submitBtn.disabled = true
    submitBtn.classList.add("is-loading")
    const labelSpan = submitBtn.querySelector("span")
    const labelPrev = labelSpan.textContent
    labelSpan.textContent = "Salvando..."

    const payload = { nome, eixos, cursoId, cursoTitulo, miniBio }
    if (_fotoPendente) {
      payload.fotoBase64 = _fotoPendente.dataUrl
      payload.fotoMime = _fotoPendente.mime
    } else if (_editId && _removerFoto) {
      payload.removerFoto = true
    }

    try {
      if (_editId) {
        const data = await api("update", { id: _editId, ...payload })
        // Atualiza cache localmente.
        if (_cache) {
          const idx = _cache.findIndex((x) => x.id === _editId)
          if (idx >= 0 && data.palestrante) _cache[idx] = data.palestrante
        }
      } else {
        const data = await api("create", payload)
        if (_cache && data.palestrante) _cache.unshift(data.palestrante)
      }
      const eraEdicao = !!_editId
      resetForm()
      await deps.showAlert({
        type: "success",
        title: eraEdicao ? "Palestrante atualizado" : "Palestrante cadastrado",
        message: eraEdicao ? "As alterações foram salvas." : "O palestrante foi adicionado com sucesso.",
      })
      deps.navigate("palestrantes-lista")
    } catch (err) {
      submitBtn.disabled = false
      submitBtn.classList.remove("is-loading")
      labelSpan.textContent = labelPrev
      showErr(err.message || "Não foi possível salvar. Tente novamente.")
    }
  })
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
    resetForm()
    deps.navigate("palestrantes-cadastro")
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
  _editId = id
  _fotoPendente = null
  _removerFoto = false
  deps.navigate("palestrantes-cadastro")
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

// ================ Convites de uso único ================
async function gerarConvite() {
  const host = document.getElementById("palInviteHost")
  const btn = document.getElementById("palConvite")
  if (!host) return
  if (btn) btn.disabled = true
  host.innerHTML = `<div class="pal-invite pal-invite--loading"><i class="fas fa-circle-notch fa-spin"></i> Gerando link…</div>`
  try {
    const data = await api("invite-create")
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
        <p class="pal-invite__hint">Envie este link ao palestrante. Ele poderá preencher o cadastro <b>uma única vez</b>; após o envio o link expira automaticamente.</p>
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
