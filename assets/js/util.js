/**
 * util.js - utilitários genéricos compartilhados pelo painel.
 */

/** Dispara o download de um Blob com o nome de arquivo informado. */
export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
