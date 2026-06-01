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
 *   ?action=manifest&token=...      -> { ok, files: [{ path, id, size }] }
 *   ?action=file&token=...&id=<id>  -> { ok, name, base64 }
 */

// ============ CONFIGURACOES ============

// ID da pasta RAIZ no Drive que espelha assets/docs/relatorios/.
//   https://drive.google.com/drive/folders/<FOLDER_ID>
const ROOT_FOLDER_ID = 'COLE_AQUI_O_ID_DA_PASTA_RAIZ_DOS_RELATORIOS';

// Token compartilhado com o build (env RELATORIOS_TOKEN na Vercel).
const SHARED_TOKEN = 'TROQUE_POR_UM_TOKEN_LONGO_E_ALEATORIO';

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
  const blob = f.getBlob();
  return { ok: true, name: f.getName(), base64: Utilities.base64Encode(blob.getBytes()) };
}

// ============ HELPERS ============

function _temExtensao(nome) {
  const lower = String(nome).toLowerCase();
  return EXTENSOES.some(function (ext) { return lower.slice(-ext.length) === ext; });
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
