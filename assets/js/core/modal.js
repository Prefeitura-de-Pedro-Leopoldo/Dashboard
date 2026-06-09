/**
 * modal.js - modal do painel (substitui alert/confirm nativos).
 *
 * API:
 *   showAlert({title, message, type, confirmLabel}) -> Promise<void>
 *   showConfirm({title, message, type, confirmLabel, cancelLabel, danger}) -> Promise<boolean>
 *   showPrompt({title, message, label, placeholder, value, required, maxLength,
 *               confirmLabel, cancelLabel}) -> Promise<string|null>  (null = cancelou)
 *
 * Apenas 1 modal por vez; ESC e clique no overlay fecham (confirm = cancela).
 */
import { escapeHtml } from "../ui.js"

let _activeModal = null

function _closeModal(resolveValue) {
  if (!_activeModal) return
  const { overlay, resolve, escHandler } = _activeModal
  document.removeEventListener("keydown", escHandler)
  overlay.classList.add("is-closing")
  _activeModal = null
  setTimeout(() => overlay.remove(), 160)
  resolve(resolveValue)
}

function _openModal({ title, message, type = "info", confirmLabel = "OK", cancelLabel = null, danger = false }) {
  // Se já tem um aberto, fecha primeiro (cancela)
  if (_activeModal) _closeModal(false)

  const icons = {
    info: "fa-circle-info",
    success: "fa-circle-check",
    warn: "fa-triangle-exclamation",
    error: "fa-circle-exclamation",
    confirm: "fa-circle-question"
  }
  const variant = cancelLabel ? "confirm" : type
  const icon = icons[type] || icons.info

  const overlay = document.createElement("div")
  overlay.className = "app-modal__overlay"
  overlay.setAttribute("role", "dialog")
  overlay.setAttribute("aria-modal", "true")
  overlay.innerHTML = `
    <div class="app-modal app-modal--${variant}" style="position:relative">
      <button type="button" class="app-modal__close" aria-label="Fechar"><i class="fas fa-xmark"></i></button>
      <div class="app-modal__head">
        <div class="app-modal__icon"><i class="fas ${icon}"></i></div>
        <div class="app-modal__text">
          ${title ? `<h3 class="app-modal__title">${escapeHtml(title)}</h3>` : ""}
          <p class="app-modal__message">${escapeHtml(message || "").replace(/\n/g, "<br>")}</p>
        </div>
      </div>
      <div class="app-modal__actions">
        ${cancelLabel ? `<button type="button" class="app-modal__btn app-modal__btn--ghost" data-modal-cancel>${escapeHtml(cancelLabel)}</button>` : ""}
        <button type="button" class="app-modal__btn ${danger ? "app-modal__btn--danger" : "app-modal__btn--primary"}" data-modal-confirm>${escapeHtml(confirmLabel)}</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)

  return new Promise(resolve => {
    const escHandler = (e) => { if (e.key === "Escape") _closeModal(cancelLabel ? false : undefined) }
    _activeModal = { overlay, resolve, escHandler }
    document.addEventListener("keydown", escHandler)

    overlay.addEventListener("click", (e) => { if (e.target === overlay) _closeModal(cancelLabel ? false : undefined) })
    overlay.querySelector(".app-modal__close").addEventListener("click", () => _closeModal(cancelLabel ? false : undefined))
    overlay.querySelector("[data-modal-confirm]").addEventListener("click", () => _closeModal(cancelLabel ? true : undefined))
    const cancelBtn = overlay.querySelector("[data-modal-cancel]")
    if (cancelBtn) cancelBtn.addEventListener("click", () => _closeModal(false))

    // Foco no botão primário
    setTimeout(() => overlay.querySelector("[data-modal-confirm]")?.focus(), 50)
  })
}

export function showAlert(opts) {
  if (typeof opts === "string") opts = { message: opts }
  return _openModal({ ...opts, cancelLabel: null })
}

export function showConfirm(opts) {
  if (typeof opts === "string") opts = { message: opts }
  return _openModal({ type: "confirm", cancelLabel: "Cancelar", confirmLabel: "Confirmar", ...opts })
}

// Modal com um campo de texto. Resolve com o valor digitado (string) ou null se
// o usuário cancelar/fechar. Se `required`, o botão confirmar fica desabilitado
// enquanto o campo estiver vazio.
export function showPrompt(opts = {}) {
  if (_activeModal) _closeModal(undefined)
  const {
    title = "", message = "", label = "", placeholder = "", value = "",
    required = true, maxLength = null,
    confirmLabel = "Confirmar", cancelLabel = "Cancelar", type = "confirm",
  } = opts
  const icons = { info: "fa-circle-info", success: "fa-circle-check", warn: "fa-triangle-exclamation", error: "fa-circle-exclamation", confirm: "fa-circle-question" }
  const icon = icons[type] || icons.confirm

  const overlay = document.createElement("div")
  overlay.className = "app-modal__overlay"
  overlay.setAttribute("role", "dialog")
  overlay.setAttribute("aria-modal", "true")
  overlay.innerHTML = `
    <div class="app-modal app-modal--confirm" style="position:relative">
      <button type="button" class="app-modal__close" aria-label="Fechar"><i class="fas fa-xmark"></i></button>
      <div class="app-modal__head">
        <div class="app-modal__icon"><i class="fas ${icon}"></i></div>
        <div class="app-modal__text">
          ${title ? `<h3 class="app-modal__title">${escapeHtml(title)}</h3>` : ""}
          ${message ? `<p class="app-modal__message">${escapeHtml(message).replace(/\n/g, "<br>")}</p>` : ""}
        </div>
      </div>
      <div class="app-modal__field">
        ${label ? `<label class="app-modal__label">${escapeHtml(label)}</label>` : ""}
        <input type="text" class="app-modal__input" placeholder="${escapeHtml(placeholder)}"
               value="${escapeHtml(value)}" ${maxLength ? `maxlength="${maxLength}"` : ""} />
      </div>
      <div class="app-modal__actions">
        <button type="button" class="app-modal__btn app-modal__btn--ghost" data-modal-cancel>${escapeHtml(cancelLabel)}</button>
        <button type="button" class="app-modal__btn app-modal__btn--primary" data-modal-confirm>${escapeHtml(confirmLabel)}</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)

  return new Promise(resolve => {
    const input = overlay.querySelector(".app-modal__input")
    const okBtn = overlay.querySelector("[data-modal-confirm]")
    const sync = () => { if (required) okBtn.disabled = !input.value.trim() }
    sync()

    const escHandler = (e) => {
      if (e.key === "Escape") _closeModal(null)
      else if (e.key === "Enter" && document.activeElement === input && (!required || input.value.trim())) {
        _closeModal(input.value.trim())
      }
    }
    _activeModal = { overlay, resolve, escHandler }
    document.addEventListener("keydown", escHandler)

    input.addEventListener("input", sync)
    overlay.addEventListener("click", (e) => { if (e.target === overlay) _closeModal(null) })
    overlay.querySelector(".app-modal__close").addEventListener("click", () => _closeModal(null))
    overlay.querySelector("[data-modal-cancel]").addEventListener("click", () => _closeModal(null))
    okBtn.addEventListener("click", () => { if (!required || input.value.trim()) _closeModal(input.value.trim()) })

    setTimeout(() => { input.focus(); input.select() }, 50)
  })
}
