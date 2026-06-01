/**
 * views/qrcode.js - gerador de QR Code (view "QR Code").
 * Autossuficiente: usa a lib global QRCode e o util triggerDownload.
 */
import { triggerDownload } from "../util.js"

export function renderViewQrCode() {
  const view = document.getElementById("view-qrcode")
  view.innerHTML = `
    <div class="qr-layout">
      <div class="card qr-form-card">
        <div class="card__header qr-form-header">
          <div>
            <h3><i class="fas fa-qrcode"></i> Gerador de QR Code</h3>
            <p>Preencha os campos abaixo para gerar.</p>
          </div>
          <span class="qr-size-badge"><i class="fas fa-expand"></i> 2000 px</span>
        </div>

        <div class="filter qr-field">
          <label for="qrName"><i class="fas fa-file-signature"></i> Nome do arquivo</label>
          <input type="text" id="qrName" placeholder="ex.: inscricoes-curso-gestao" />
        </div>

        <div class="filter qr-field">
          <label for="qrUrl"><i class="fas fa-link"></i> URL ou texto</label>
          <input type="text" id="qrUrl" placeholder="https://escoladegoverno.pedroleopoldo.mg.gov.br" value="" />
          <div class="qr-char-counter"><span id="qrCharCount">0</span> caracteres</div>
        </div>

        <div class="filter qr-field">
          <label for="qrBg"><i class="fas fa-palette"></i> Cor de fundo</label>
          <input type="color" id="qrBg" value="#ffffff" />
        </div>

        <div class="qr-actions">
          <button class="btn btn--accent btn--lg" id="qrCreate">
            <i class="fas fa-bolt"></i> Gerar QR Code
          </button>
          <button class="btn btn--lg" id="qrDownload" disabled>
            <i class="fas fa-download"></i> Baixar PNG
          </button>
        </div>

        <div id="qrFeedback" class="qr-feedback" hidden></div>
      </div>

      <div class="card qr-preview-card">
        <div class="card__header">
          <div>
            <h3><i class="fas fa-eye"></i> Pré-visualização</h3>
            <p>Pronto para impressão em alta resolução.</p>
          </div>
          <span class="qr-status-badge" id="qrStatusBadge" data-state="idle">
            <i class="fas fa-circle"></i> Aguardando
          </span>
        </div>
        <div class="qr-canvas-frame" id="qrFrame">
          <div class="qr-placeholder" id="qrPlaceholder">
            <div class="qr-placeholder-icon"><i class="fas fa-qrcode"></i></div>
            <p>Clique em <b>Gerar QR Code</b> para visualizar o resultado.</p>
          </div>
          <canvas id="qrCanvas" width="2000" height="2000" hidden></canvas>
        </div>
      </div>
    </div>
  `

  document.getElementById("qrCreate").addEventListener("click", generateQrCode)
  document.getElementById("qrDownload").addEventListener("click", downloadQrCode)

  const urlInput = document.getElementById("qrUrl")
  const charCount = document.getElementById("qrCharCount")
  urlInput.addEventListener("keydown", e => {
    if (e.key === "Enter") generateQrCode()
  })
  urlInput.addEventListener("input", () => {
    charCount.textContent = urlInput.value.length
  })
  document.getElementById("qrName").addEventListener("keydown", e => {
    if (e.key === "Enter") generateQrCode()
  })
}

function generateQrCode() {
  const url = document.getElementById("qrUrl").value.trim()
  const ecl = "H" // fixo: melhor correção de erro
  const color = "#000000" // fixo: preto
  const bg = document.getElementById("qrBg").value
  const feedback = document.getElementById("qrFeedback")
  const badge = document.getElementById("qrStatusBadge")
  const setBadge = (state, text, icon) => {
    if (!badge) return
    badge.dataset.state = state
    badge.innerHTML = `<i class="fas fa-${icon}"></i> ${text}`
  }

  if (!url) {
    feedback.hidden = false
    feedback.className = "qr-feedback is-error"
    feedback.innerHTML = '<i class="fas fa-circle-exclamation"></i> Informe uma URL ou texto.'
    setBadge("error", "Erro", "circle-exclamation")
    return
  }
  if (!window.QRCode) {
    feedback.hidden = false
    feedback.className = "qr-feedback is-error"
    feedback.innerHTML = '<i class="fas fa-circle-exclamation"></i> Biblioteca QR não carregou. Recarregue a página.'
    setBadge("error", "Erro", "circle-exclamation")
    return
  }
  setBadge("loading", "Gerando…", "spinner fa-spin")

  // qrcodejs renderiza num <div>; usamos um container temporário 1000x1000
  // e depois copiamos para o canvas 2000x2000 com nitidez.
  const tmp = document.createElement("div")
  tmp.style.position = "fixed"
  tmp.style.left = "-9999px"
  document.body.appendChild(tmp)

  const eclMap = {
    L: window.QRCode.CorrectLevel.L,
    M: window.QRCode.CorrectLevel.M,
    Q: window.QRCode.CorrectLevel.Q,
    H: window.QRCode.CorrectLevel.H
  }
  new window.QRCode(tmp, {
    text: url,
    width: 1000,
    height: 1000,
    colorDark: color,
    colorLight: bg,
    correctLevel: eclMap[ecl] || eclMap.Q
  })

  // qrcodejs gera um <img> (base64) - esperamos renderizar e desenhar no canvas 2000
  setTimeout(() => {
    const img = tmp.querySelector("img") || tmp.querySelector("canvas")
    if (!img) {
      document.body.removeChild(tmp)
      feedback.hidden = false
      feedback.className = "qr-feedback is-error"
      feedback.innerHTML = '<i class="fas fa-circle-exclamation"></i> Falha ao gerar o QR.'
      setBadge("error", "Erro", "circle-exclamation")
      return
    }
    const canvas = document.getElementById("qrCanvas")
    const ctx = canvas.getContext("2d")
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, 2000, 2000)

    const render = () => {
      ctx.drawImage(img, 0, 0, 2000, 2000)
      document.body.removeChild(tmp)
      canvas.hidden = false
      document.getElementById("qrPlaceholder").hidden = true
      document.getElementById("qrDownload").disabled = false
      feedback.hidden = false
      feedback.className = "qr-feedback is-success"
      feedback.innerHTML = '<i class="fas fa-circle-check"></i> QR Code gerado · 2000 × 2000 px'
      setBadge("ready", "Pronto", "circle-check")
    }
    if (img.tagName === "IMG" && !img.complete) {
      img.onload = render
    } else {
      render()
    }
  }, 40)
}

function downloadQrCode() {
  const canvas = document.getElementById("qrCanvas")
  if (!canvas || canvas.hidden) return
  canvas.toBlob(blob => {
    if (!blob) return
    // Prefere o nome informado pelo usuario; cai para a URL como fallback.
    const nomeInput = document.getElementById("qrName")?.value.trim() || ""
    const url = document.getElementById("qrUrl").value.trim() || "qrcode"
    const base = nomeInput || url.replace(/^https?:\/\//, "")
    const safe = base
      .replace(/[^a-z0-9]+/gi, "-")
      .slice(0, 60)
      .replace(/^-|-$/g, "")
    triggerDownload(blob, `${safe || "qrcode-egov"}.png`)
  }, "image/png")
}
