/**
 * Servir Relatorios - Web App (Google Apps Script).
 *
 * Entrega os arquivos .xlsx de relatorios que ficam numa pasta do Drive,
 * para que o BUILD da Vercel (scripts/pull-relatorios.mjs) os baixe na hora
 * de publicar. Assim os .xlsx vivem no Drive (fonte da verdade), o repositorio
 * fica limpo, e o site continua funcionando (dashboard, certificados e
 * auto-relatorio) porque os arquivos sao recriados no output do build.
 *
 * E um script STANDALONE (nao precisa estar vinculado a planilha). Tem token
 * proprio. Espelha a estrutura de subpastas da pasta raiz.
 *
 * Endpoints (GET):
 *   ?action=manifest&token=...      -> { ok, files: [{ path, id, size, gsheet? }] }
 *   ?action=file&token=...&id=<id>  -> { ok, name, base64 }
 *
 * Google Sheets NATIVOS de satisfacao/pesquisa: alem dos .xlsx/.xls, o manifesto
 * tambem lista planilhas Google (sem extensao) cujo nome comeca com "satisfacao"
 * ou "pesquisa", expondo o path com ".xlsx" no fim. O action=file exporta essas
 * planilhas como .xlsx on-the-fly (via Drive export). Assim o build e as APIs
 * tratam a pesquisa do Google Forms (que vive como Google Sheets) igual a um
 * arquivo .xlsx, sem precisar baixar/converter manualmente.
 */

// ============ CONFIGURACOES ============

// ID da pasta RAIZ no Drive que espelha assets/docs/relatorios/ (pasta "Relatorios EGov").
//   https://drive.google.com/drive/folders/<FOLDER_ID>
const ROOT_FOLDER_ID = '1F6omxUG5yYW84m7sVK0RweAO8ge5q27p';

// Token compartilhado com o build (env RELATORIOS_TOKEN na Vercel).
// DEVE ser identico ao valor de RELATORIOS_TOKEN na Vercel.
const SHARED_TOKEN = 'a3hYegIm6Nt085dP4nEc7LWGTykxqvzuCjAfwDZQU2OiJ9sV';

// Apenas estes tipos sao listados/servidos (ignora eventos-meta.json etc.).
const EXTENSOES = ['.xlsx', '.xls'];

// ============ ENTRADA HTTP ============

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (!SHARED_TOKEN || p.token !== SHARED_TOKEN) {
      return _json({ ok: false, error: 'Token invalido.' });
    }
    const action = String(p.action || 'manifest').trim().toLowerCase();
    if (action === 'manifest') return _json(_manifest());
    if (action === 'file')     return _json(_file(p.id));
    return _json({ ok: false, error: 'Acao desconhecida: ' + action });
  } catch (err) {
    return _json({ ok: false, error: (err && err.message) ? err.message : String(err) });
  }
}

// ============ ACOES ============

function _manifest() {
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const arquivos = [];
  _walk(root, '', arquivos);
  arquivos.sort(function (a, b) { return a.path.localeCompare(b.path); });
  return { ok: true, files: arquivos };
}

// Percorre recursivamente, montando o caminho relativo (separador "/").
function _walk(folder, prefix, out) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    const nome = f.getName();
    if (_temExtensao(nome)) {
      out.push({ path: prefix + nome, id: f.getId(), size: f.getSize() });
    } else if (f.getMimeType() === MimeType.GOOGLE_SHEETS && _ehSatisfacaoNome(nome)) {
      // Planilha Google nativa de satisfacao/pesquisa (sem extensao no nome):
      // expoe como ".xlsx" para o build e as APIs tratarem como arquivo; o
      // action=file exporta on-the-fly. Evita listar OUTROS Google Sheets
      // (ex.: "Inscricao", "Presente") que nao sao pesquisa.
      out.push({ path: prefix + nome + '.xlsx', id: f.getId(), size: 0, gsheet: true });
    }
  }
  const subs = folder.getFolders();
  while (subs.hasNext()) {
    const sub = subs.next();
    _walk(sub, prefix + sub.getName() + '/', out);
  }
}

function _file(id) {
  if (!id) return { ok: false, error: 'id ausente.' };
  const f = DriveApp.getFileById(id);
  // Google Sheets nativo: exporta como .xlsx (getBlob() devolveria PDF). Demais
  // arquivos (.xlsx/.xls reais): bytes diretos.
  const blob = (f.getMimeType() === MimeType.GOOGLE_SHEETS)
    ? _exportarXlsx(id)
    : f.getBlob();
  return { ok: true, name: f.getName(), base64: Utilities.base64Encode(blob.getBytes()) };
}

// ============ HELPERS ============

// Exporta uma planilha Google (id) como .xlsx via Drive export. Usa o token
// OAuth do proprio script (escopo Drive, ja concedido pelo DriveApp). Requer a
// permissao de "conexoes externas" (UrlFetch) na 1a autorizacao apos publicar.
const _XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
function _exportarXlsx(id) {
  const url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) +
    '/export?mimeType=' + encodeURIComponent(_XLSX_MIME);
  const resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('Falha ao exportar planilha como xlsx (HTTP ' + resp.getResponseCode() + ').');
  }
  return resp.getBlob();
}

// Nome (sem extensao) de planilha Google que e pesquisa de satisfacao: comeca
// com "satisfacao" ou "pesquisa" (ignora acentos/maiusculas). Mesma regra do
// build (mapaSatisfacao) e das APIs (ehSatisfacao).
function _ehSatisfacaoNome(nome) {
  const b = String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return b.indexOf('satisfacao') === 0 || b.indexOf('pesquisa') === 0;
}

function _temExtensao(nome) {
  const lower = String(nome).toLowerCase();
  return EXTENSOES.some(function (ext) { return lower.slice(-ext.length) === ext; });
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
