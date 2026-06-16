/**
 * state.js - estado compartilhado do painel (núcleo).
 * Objeto único mutável, importado por app.js e pelos módulos de view.
 */
export const state = {
  data: null,
  participantesAoVivo: {}, // fonte -> evento lido ao vivo do participantes.xlsx (sobrepõe o estático a cada rebuild)
  view: "dashboard",
  _certTypoLinked: true, // padrão: manter proporções entre os campos
  _certDragEnabled: true, // padrão: arrasta-e-solta ligado
  selectedEventId: null,
  compareIds: new Set(),
  reportFilters: { eventoId: "", secretaria: "", turma: "", busca: "" },
  certEventId: null, // id da planilha do sistema selecionada (aba "Do sistema")
  certSource: "evento", // 'evento' (planilha do sistema) ou 'planilha' (upload)
  certUploaded: null, // dados de planilha enviada via upload
  certManifest: null, // índice lido de relatorios/manifest.json
  certSystemCache: {}, // id -> participantes elegíveis já parseados da planilha
  certPendingArquivo: null, // arquivo a resolver quando o manifesto terminar de carregar
  templateImg: null, // Image do modelo atualmente carregado
  certTemplateId: "modelo-1", // id em CERT_TEMPLATES (selecionado na etapa 3)
}
