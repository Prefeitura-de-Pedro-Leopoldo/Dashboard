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
 *   ?action=manifest&token=...            -> { ok, sheets:[{ folder, name, id, total, aceitando }] }
 *        ("total" = nº de inscritos da planilha; usado pelo painel para avisar
 *         "inscrições lotadas". É null se a planilha não pôde ser lida.
 *         "aceitando" = true/false se o Form vinculado ainda aceita respostas
 *         (usado pelo painel para mostrar "inscrições encerradas" quando o Form
 *         foi fechado manualmente). É null se não há form vinculado ou erro.)
 *   ?action=inscritos&token=...&path=<pasta do evento>
 *   ?action=inscritos&token=...&id=<sheetId>
 *        -> { ok, folder, sheetId, headers, total, inscritos:[{nome,email,dataInscricao}], atualizadoEm }
 *   ?action=presentes&token=...&path=<pasta do evento>
 *        -> idem inscritos, mas lendo a planilha cujo nome comeca com "Presente(s)".
 *           O carimbo de cada linha (dataInscricao) indica o encontro/data da presenca.
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
    if (action === 'presentes') {
      if (p.id)   return _json(_presentesById(p.id));
      if (p.path != null) return _json(_presentesByPath(p.path));
      return _json({ ok: false, error: 'Informe "path" (pasta do evento) ou "id" (planilha).' });
    }
    return _json({ ok: false, error: 'Acao desconhecida: ' + action });
  } catch (err) {
    return _json({ ok: false, error: (err && err.message) ? err.message : String(err) });
  }
}

// ============ ACOES ============

// Lista as planilhas "Inscrição" varrendo a árvore de pastas a partir da raiz.
// (NÃO usa DriveApp.searchFiles: o operador `contains` faz prefixo de PALAVRA,
//  então "nscri" não casa com "Inscrição" e a busca indexada também pode não
//  enxergar planilhas acessíveis só por herança da pasta compartilhada.)
function _manifest() {
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const out = [];
  _varrerPasta(root, '', out, 0);
  out.sort(function (a, b) { return a.folder.localeCompare(b.folder); });
  return { ok: true, sheets: out };
}

// Varre recursivamente a pasta acumulando as planilhas "Inscrição" achadas,
// montando o caminho relativo ao ROOT (mesma estratégia do confirmacaoInscricao.gs).
function _varrerPasta(folder, prefixo, out, depth) {
  if (depth > 25) return;
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    if (f.getMimeType() === MimeType.GOOGLE_SHEETS && _ehInscricao(f.getName())) {
      // total = nº de inscritos (para o painel avisar "lotado"). aceitando =
      // se o Form vinculado ainda aceita respostas (para o painel mostrar
      // "encerradas" quando fechado manualmente). Falha de leitura não quebra
      // o manifesto: segue com total/aceitando = null.
      var total = null, aceitando = null;
      try { total = _lerInscricao(f).total; } catch (e) { total = null; }
      try { aceitando = _formAceitando(f.getId()); } catch (e) { aceitando = null; }
      out.push({ folder: prefixo, name: f.getName(), id: f.getId(), total: total, aceitando: aceitando });
    }
  }
  const subs = folder.getFolders();
  while (subs.hasNext()) {
    const sub = subs.next();
    const novo = prefixo ? prefixo + '/' + sub.getName() : sub.getName();
    _varrerPasta(sub, novo, out, depth + 1);
  }
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

// Lê a planilha "Presente(s)" navegando até a pasta do evento. Mesmo formato da
// inscrição; o carimbo de cada linha indica o encontro (data) da presença.
function _presentesByPath(path) {
  const segs = String(path || '').split('/').map(function (s) { return s.trim(); }).filter(Boolean);
  let folder = DriveApp.getFolderById(ROOT_FOLDER_ID);
  for (let i = 0; i < segs.length; i++) {
    const child = _acharSubpasta(folder, segs[i]);
    if (!child) return { ok: false, error: 'Pasta não encontrada: ' + segs[i], reason: 'folder' };
    folder = child;
  }
  const file = _acharArquivo(folder, _ehPresente);
  if (!file) return { ok: false, error: 'Nenhuma planilha "Presente" nesta pasta.', reason: 'nopresente' };
  const dados = _lerInscricao(file, false); // presença: 1 linha por encontro, não deduplica
  // expõe como "presentes" mantendo nome/email/dataInscricao(=carimbo do check-in)
  return { ok: true, folder: segs.join('/'), sheetId: file.getId(),
           headers: dados.headers, total: dados.total, atualizadoEm: dados.atualizadoEm,
           presentes: dados.inscritos };
}

// Lê a planilha "Presente(s)" diretamente por ID.
function _presentesById(id) {
  const file = DriveApp.getFileById(id);
  const dados = _lerInscricao(file, false); // presença: 1 linha por encontro, não deduplica
  return { ok: true, sheetId: id, headers: dados.headers, total: dados.total,
           atualizadoEm: dados.atualizadoEm, presentes: dados.inscritos };
}

// Retorna true/false se o Google Form vinculado à planilha de respostas ainda
// aceita respostas; null se a planilha não tem form vinculado (getFormUrl vazio)
// ou se houve erro/sem permissão. Usado pelo painel para diferenciar "inscrições
// abertas" de "encerradas" quando o Form é fechado manualmente.
function _formAceitando(sheetId) {
  var url = SpreadsheetApp.openById(sheetId).getFormUrl();
  if (!url) return null;
  return FormApp.openByUrl(url).isAcceptingResponses();
}

// ============ LEITURA DA PLANILHA ============

// dedup=true (inscrições): conta PESSOAS distintas por e-mail — uma pessoa = uma
// vaga, então inscrições repetidas não inflam o total nem fecham o form antes da
// hora. dedup=false (presenças): NÃO deduplica, pois a mesma pessoa aparece em
// várias linhas (uma por encontro/dia, ex.: M1/M2) e cada linha é um check-in.
function _lerInscricao(file, dedup) {
  if (dedup === undefined) dedup = true;
  const ss = SpreadsheetApp.openById(file.getId());
  const sheet = ss.getSheets()[0]; // aba de respostas do Forms
  const range = sheet.getDataRange();
  const values = range.getValues();
  if (!values.length) return { headers: [], inscritos: [], total: 0, atualizadoEm: _agora() };

  const headers = values[0].map(function (h) { return String(h).trim(); });
  const idx = _detectarColunas(headers);
  const inscritos = [];
  const vistos = {}; // e-mails já contados (uma pessoa = uma vaga)
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const email = idx.email >= 0 ? String(row[idx.email] || '').trim() : '';
    const nome  = idx.nome  >= 0 ? String(row[idx.nome]  || '').trim() : '';
    if (!email && !nome) continue; // pula linhas vazias
    const chave = email.toLowerCase();
    if (dedup && chave) {
      if (vistos[chave]) continue; // inscrição repetida da mesma pessoa: ignora
      vistos[chave] = true;
    }
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
  return _acharArquivo(folder, _ehInscricao);
}

// Acha na pasta a 1ª planilha Google cujo nome satisfaz o predicado.
function _acharArquivo(folder, pred) {
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getMimeType() === MimeType.GOOGLE_SHEETS && pred(f.getName())) return f;
  }
  return null;
}

function _ehInscricao(nome) {
  return _norm(nome).indexOf('inscri') === 0; // "inscrição", "inscricao", "inscrições"...
}

function _ehPresente(nome) {
  return _norm(nome).indexOf('presente') === 0; // "presente", "presentes"...
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
