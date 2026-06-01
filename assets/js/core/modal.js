/**
 * modal.js - modal do painel (substitui alert/confirm nativos).
 *
 * API:
 *   showAlert({title, message, type, confirmLabel}) -> Promise<void>
 *   showConfirm({title, message, type, confirmLabel, cancelLabel, danger}) -> Promise<boolean>
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
