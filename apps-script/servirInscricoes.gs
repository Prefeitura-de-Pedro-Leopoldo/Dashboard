/**
 * Servir Inscrições - Web App (Google Apps Script).
 *
 * Lê AO VIVO as planilhas de respostas do Google Forms ("Inscrição") que ficam
 * dentro de cada pasta de evento, na MESMA pasta raiz dos relatórios
 * (assets/docs/relatorios/ espelhada no Drive). Devolve os inscritos em JSON
 * para o dashboard acompanhar as inscrições em tempo real.
 *
 * Convenção: dentro da pasta de cada evento/turma/módulo existe uma PLANILHA
 * GOOGLE (não .xlsx) cujo nome começa com "Inscrição" (acentos/maiúsculas
 * são ignorados). É a planilha de respostas vinculada ao Forms daquele evento.
 *
 * É STANDALONE (não precisa estar vinculado a planilha) e tem token próprio.
 * Publique como Web App ("Qualquer pessoa") e consuma via /api/inscricoes na
 * Vercel.
 *
 * Endpoints (GET):
 *   ?action=manifest&token=...            -> { ok, sheets:[{ folder, name, id }] }
 *   ?action=inscritos&token=...&path=<pasta do evento>
 *   ?action=inscritos&token=...&id=<sheetId>
 *        -> { ok, folder, sheetId, headers, total, inscritos:[{nome,email,dataInscricao}], atualizadoEm }
 */

// ============ CONFIGURACOES ============

// Pasta "relatorios" no Drive: seus filhos diretos são as pastas dos eventos
// (ex.: "mapa-gerenciamento-risco-2026-05/turma 1"). É o caminho relativo que o
// dashboard envia (derivado de ev.fonte). NÃO é a pasta "assets".
const ROOT_FOLDER_ID = '1Jfyl8jE70W05t8YydDvVMEzkqXZZ7QJK';

// Token compartilhado com o proxy /api/inscricoes (env INSCRICOES_TOKEN na
// Vercel). DEVE ser idêntico ao valor de INSCRICOES_TOKEN na Vercel.
const SHARED_TOKEN = 'MWDvQ5aoNT6ENroa9NAiDFawL5mVVti6VQA6W4WacWYISGsd';

// ============ ENTRADA HTTP ============

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (!SHARED_TOKEN || p.token !== SHARED_TOKEN) {
      return _json({ ok: false, error: 'Token invalido.' });
    }
    const action = String(p.action || 'manifest').trim().toLowerCase();
    if (action === 'manifest')  return _json(_manifest());
    if (action === 'inscritos') {
      if (p.id)   return _json(_inscritosById(p.id));
      if (p.path != null) return _json(_inscritosByPath(p.path));
      return _json({ ok: false, error: 'Informe "path" (pasta do evento) ou "id" (planilha).' });
    }
    return _json({ ok: false, error: 'Acao desconhecida: ' + action });
  } catch (err) {
    return _json({ ok: false, error: (err && err.message) ? err.message : String(err) });
  }
}

// ============ ACOES ============

// Lista as planilhas "Inscrição" com o caminho da pasta (relativo ao ROOT).
// Usa busca INDEXADA do Drive (rápida) em vez de varrer a árvore inteira.
function _manifest() {
  const rootId = DriveApp.getFolderById(ROOT_FOLDER_ID).getId();
  const out = [];
  // "nscri" cobre Inscrição/inscricao/Inscrições; o filtro fino é _ehInscricao.
  const it = DriveApp.searchFiles(
    'mimeType = "application/vnd.google-apps.spreadsheet" and title contains "nscri" and trashed = false'
  );
  while (it.hasNext()) {
    const f = it.next();
    if (!_ehInscricao(f.getName())) continue;
    const folder = _caminhoRelativo(f, rootId);
    if (folder == null) continue; // fora da pasta de relatórios
    out.push({ folder: folder, name: f.getName(), id: f.getId() });
  }
  out.sort(function (a, b) { return a.folder.localeCompare(b.folder); });
  return { ok: true, sheets: out };
}

// Caminho da pasta do arquivo relativo ao ROOT (null se não estiver sob o root).
function _caminhoRelativo(file, rootId) {
  const parents = file.getParents();
  if (!parents.hasNext()) return null;
  let folder = parents.next();
  const segs = [];
  let guard = 0;
  while (folder && guard++ < 25) {
    if (folder.getId() === rootId) return segs.reverse().join('/');
    segs.push(folder.getName());
    const ps = folder.getParents();
    folder = ps.hasNext() ? ps.next() : null;
  }
  return null; // não chegou ao root
}

// Lê a inscrição navegando até a pasta do evento (ex.: "mapa.../turma 1").
function _inscritosByPath(path) {
  const segs = String(path || '').split('/').map(function (s) { return s.trim(); }).filter(Boolean);
  let folder = DriveApp.getFolderById(ROOT_FOLDER_ID);
  for (let i = 0; i < segs.length; i++) {
    const child = _acharSubpasta(folder, segs[i]);
    if (!child) return { ok: false, error: 'Pasta não encontrada: ' + segs[i], reason: 'folder' };
    folder = child;
  }
  const file = _acharInscricao(folder);
  if (!file) return { ok: false, error: 'Nenhuma planilha "Inscrição" nesta pasta.', reason: 'noinscricao' };
  const dados = _lerInscricao(file);
  return Object.assign({ ok: true, folder: segs.join('/'), sheetId: file.getId() }, dados);
}

// Lê a inscrição diretamente por ID da planilha.
function _inscritosById(id) {
  const file = DriveApp.getFileById(id);
  const dados = _lerInscricao(file);
  return Object.assign({ ok: true, sheetId: id }, dados);
}

// ============ LEITURA DA PLANILHA ============

function _lerInscricao(file) {
  const ss = SpreadsheetApp.openById(file.getId());
  const sheet = ss.getSheets()[0]; // aba de respostas do Forms
  const range = sheet.getDataRange();
  const values = range.getValues();
  if (!values.length) return { headers: [], inscritos: [], total: 0, atualizadoEm: _agora() };

  const headers = values[0].map(function (h) { return String(h).trim(); });
  const idx = _detectarColunas(headers);
  const inscritos = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const email = idx.email >= 0 ? String(row[idx.email] || '').trim() : '';
    const nome  = idx.nome  >= 0 ? String(row[idx.nome]  || '').trim() : '';
    if (!email && !nome) continue; // pula linhas vazias
    inscritos.push({
      nome: nome,
      email: email,
      dataInscricao: idx.data >= 0 ? _iso(row[idx.data]) : '',
    });
  }
  return { headers: headers, inscritos: inscritos, total: inscritos.length, atualizadoEm: _agora() };
}

// Acha as colunas de nome, e-mail e carimbo de data pelos cabeçalhos.
function _detectarColunas(headers) {
  let data = -1, email = -1, nome = -1, nomeCompleto = -1;
  for (let i = 0; i < headers.length; i++) {
    const h = _norm(headers[i]);
    if (data < 0 && (h.indexOf('carimbo de data') >= 0 || h === 'timestamp' || h.indexOf('data/hora') >= 0)) data = i;
    if (email < 0 && (h.indexOf('e-mail') >= 0 || h.indexOf('email') >= 0 || h.indexOf('mail') >= 0)) email = i;
    if (h.indexOf('nome completo') >= 0) nomeCompleto = i;
    if (nome < 0 && h.indexOf('nome') >= 0) nome = i;
  }
  if (nomeCompleto >= 0) nome = nomeCompleto; // preferir "nome completo"
  return { data: data, email: email, nome: nome };
}

// ============ HELPERS ============

function _acharSubpasta(folder, nome) {
  const alvo = _norm(nome);
  const it = folder.getFolders();
  while (it.hasNext()) {
    const f = it.next();
    if (_norm(f.getName()) === alvo) return f;
  }
  return null;
}

function _acharInscricao(folder) {
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getMimeType() === MimeType.GOOGLE_SHEETS && _ehInscricao(f.getName())) return f;
  }
  return null;
}

function _ehInscricao(nome) {
  return _norm(nome).indexOf('inscri') === 0; // "inscrição", "inscricao", "inscrições"...
}

// minúsculas + sem acentos + espaços colapsados.
function _norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function _iso(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
  }
  return String(v || '');
}

function _agora() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
