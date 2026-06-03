/**
 * Lembretes de Encontros - Web App (Google Apps Script).
 *
 * Guarda a configuração de encontros de cada turma/evento (datas, horários,
 * lembrete ativo e HORÁRIO do disparo) e ENVIA por e-mail um lembrete "1 dia
 * antes" de cada encontro, para todos os inscritos da planilha "Inscrição"
 * daquela pasta (lida ao vivo, via a mesma pasta raiz dos relatórios).
 *
 * Componentes:
 *   - Planilha de armazenamento (abas "Encontros" e "LembretesLog").
 *   - doPost: config-get / config-save (consumido pelo /api/lembretes na Vercel).
 *   - enviarLembretesAgendados(): gatilho de tempo (de hora em hora). Para cada
 *     turma com lembrete ativo cujo horário de disparo = hora atual e que tem um
 *     encontro AMANHÃ ainda não notificado, envia os e-mails e registra no log.
 *
 * Setup (resumo): crie uma planilha, cole a ID em STORAGE_SHEET_ID, publique
 * como Web App ("Qualquer pessoa"), rode instalarGatilhoLembretes() uma vez.
 * Veja apps-script/README-lembretes.md.
 */

// ============ CONFIGURAÇÕES ============

// Planilha (Google Sheets) onde a config e o log ficam guardados. Crie uma
// planilha em branco e cole a ID aqui (a parte do /d/<ID>/edit da URL).
const STORAGE_SHEET_ID = '1Q8a06-d-U5oEle8DkpkcDo9FG3Y4hCLtRRDMRHuKe9Q';

// Pasta "relatorios" no Drive (a MESMA do servirInscricoes.gs) — para achar a
// planilha "Inscrição" de cada turma e ler os destinatários.
const ROOT_FOLDER_ID = '1Jfyl8jE70W05t8YydDvVMEzkqXZZ7QJK';

// Token compartilhado com o proxy /api/lembretes (env LEMBRETES_TOKEN na Vercel).
const SHARED_TOKEN = 'zkZEZ5nMCNQkC9tyiBmeGI4bTwMFKunEFNUsObmnfBEDViuL';

// Remetente dos lembretes (alias configurado em "Enviar e-mail como", ou vazio
// para usar a conta que executa). Reaproveite os do enviarCertificados.gs.
const SENDER_EMAIL = 'egov@pedroleopoldo.mg.gov.br';
const REPLY_TO     = 'egov@pedroleopoldo.mg.gov.br';
const BCC_EMAIL    = 'fabiana.silva@pedroleopoldo.mg.gov.br';
const PROJECT_NAME = 'Escola de Governo · Prefeitura de Pedro Leopoldo';

// true = simula (não envia e-mail), só registra no log. Troque para false ao
// validar o disparo real.
const DRY_RUN = true;

const ENC_SHEET = 'Encontros';
const LOG_SHEET = 'LembretesLog';
const ENC_HEADER = ['EventoKey', 'Titulo', 'Encontros', 'LembreteAtivo', 'HoraDisparo', 'AtualizadoEm'];
const LOG_HEADER = ['EventoKey', 'EncontroData', 'EnviadoEm', 'Destinatarios', 'Status'];

// ============ ENTRADAS HTTP ============

function doGet() {
  return _json({ ok: true, service: 'lembretesEventos' });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return _json({ ok: false, error: 'Corpo vazio.' });
    const payload = JSON.parse(e.postData.contents);
    if (!SHARED_TOKEN || payload.token !== SHARED_TOKEN) return _json({ ok: false, error: 'Token invalido.' });

    const action = String(payload.action || '').trim().toLowerCase();
    if (action === 'config-get')  return _json(_configGet(payload));
    if (action === 'config-save') return _json(_configSave(payload));
    return _json({ ok: false, error: 'Acao desconhecida: ' + action });
  } catch (err) {
    return _json({ ok: false, error: (err && err.message) ? err.message : String(err) });
  }
}

// ============ AÇÕES ============

function _configGet(payload) {
  const key = String(payload.eventoKey || '').trim();
  if (!key) return { ok: false, error: 'eventoKey ausente.' };
  const sheet = _obterAba(ENC_SHEET, ENC_HEADER);
  const linha = _acharLinha(sheet, key);
  if (linha < 0) return { ok: true, config: null }; // ainda não configurado
  const row = sheet.getRange(linha, 1, 1, ENC_HEADER.length).getValues()[0];
  return { ok: true, config: _linhaParaConfig(row) };
}

function _configSave(payload) {
  const key = String(payload.eventoKey || '').trim();
  if (!key) return { ok: false, error: 'eventoKey ausente.' };
  const encontros = Array.isArray(payload.encontros) ? payload.encontros : [];
  const lembreteAtivo = payload.lembreteAtivo !== false;
  const horaDisparo = _normalizarHora(payload.horaDisparo);
  const titulo = String(payload.titulo || '').trim();

  const sheet = _obterAba(ENC_SHEET, ENC_HEADER);
  const valores = [key, titulo, JSON.stringify(encontros), lembreteAtivo ? 'sim' : 'nao', horaDisparo, new Date()];
  const linha = _acharLinha(sheet, key);
  if (linha < 0) sheet.appendRow(valores);
  else sheet.getRange(linha, 1, 1, ENC_HEADER.length).setValues([valores]);

  return { ok: true, config: { eventoKey: key, titulo: titulo, encontros: encontros, lembreteAtivo: lembreteAtivo, horaDisparo: horaDisparo } };
}

// ============ DISPARO (gatilho de tempo, de hora em hora) ============

function enviarLembretesAgendados() {
  const tz = Session.getScriptTimeZone();
  const agora = new Date();
  const horaAtual = Utilities.formatDate(agora, tz, 'HH:00');
  const amanha = new Date(agora.getTime());
  amanha.setDate(amanha.getDate() + 1);
  const amanhaISO = Utilities.formatDate(amanha, tz, 'yyyy-MM-dd');

  const sheet = _obterAba(ENC_SHEET, ENC_HEADER);
  const dados = sheet.getDataRange().getValues();

  for (let i = 1; i < dados.length; i++) {
    const cfg = _linhaParaConfig(dados[i]);
    if (!cfg.eventoKey || !cfg.lembreteAtivo) continue;
    if (cfg.horaDisparo !== horaAtual) continue; // só na hora escolhida pelo usuário

    const doAmanha = (cfg.encontros || []).filter(function (en) {
      return en && en.ativo !== false && String(en.data) === amanhaISO;
    });
    if (!doAmanha.length) continue;
    if (_jaEnviado(cfg.eventoKey, amanhaISO)) continue;

    try {
      const inscritos = _lerInscritos(cfg.eventoKey);
      const emails = inscritos.map(function (p) { return p.email; }).filter(_emailValido);
      const encontro = doAmanha[0];
      if (!DRY_RUN && emails.length) {
        _enviarLembrete(inscritos, cfg, encontro);
      }
      _registrarLog(cfg.eventoKey, amanhaISO, emails.length, DRY_RUN ? 'DRY_RUN' : 'ENVIADO');
    } catch (err) {
      _registrarLog(cfg.eventoKey, amanhaISO, 0, 'ERRO: ' + (err && err.message ? err.message : String(err)));
    }
  }
}

// Identidade visual EGOV-PL (mesma do enviarCertificados.gs).
const LOGO_URL    = 'https://dashboard-lime-chi-98.vercel.app/assets/img/logo-light.png';
const BRAND_COLOR = '#3063ad';
const SITE_URL    = 'https://intranet.pedroleopoldo.mg.gov.br/egov/';

// Envia o lembrete (HTML institucional, personalizado por inscrito). Um e-mail
// por destinatário (privacidade — ninguém vê a lista dos outros).
function _enviarLembrete(inscritos, cfg, encontro) {
  const titulo = cfg.titulo || cfg.eventoKey;
  const nomeEncontro = encontro.titulo || 'próximo encontro';
  const quando = _dataBR(encontro.data) +
    (encontro.horaInicio ? ' às ' + encontro.horaInicio : '');
  const assunto = 'Lembrete: ' + nomeEncontro + ' é amanhã - ' + titulo;
  const ctx = { curso: titulo, encontro: nomeEncontro, quando: quando };

  for (let i = 0; i < inscritos.length; i++) {
    const p = inscritos[i];
    if (!_emailValido(p.email)) continue;
    const opts = { name: PROJECT_NAME, htmlBody: _corpoHtmlLembrete(p.nome, ctx) };
    if (SENDER_EMAIL) opts.from = SENDER_EMAIL;
    if (REPLY_TO) opts.replyTo = REPLY_TO;
    if (BCC_EMAIL) opts.bcc = BCC_EMAIL;
    GmailApp.sendEmail(p.email, assunto, _corpoTextoLembrete(p.nome, ctx), opts);
  }
}

// Versão texto puro (fallback de clientes sem HTML).
function _corpoTextoLembrete(nome, ctx) {
  const primeiro = String(nome || '').trim().split(/\s+/)[0] || 'participante';
  return (
    'Olá, ' + primeiro + '!\n\n' +
    'Lembrete do seu próximo encontro do curso "' + ctx.curso + '".\n\n' +
    '• Encontro: ' + ctx.encontro + '\n' +
    '• Quando: amanhã, ' + ctx.quando + '\n\n' +
    'Contamos com a sua presença.\n\n' +
    'Atenciosamente,\nEscola de Governo\nPrefeitura Municipal de Pedro Leopoldo\n\n' +
    '---\nE-mail automático. Em caso de dúvidas, responda esta mensagem.'
  );
}

// Versão HTML institucional (mesmo layout do certificado, texto p/ lembrete).
function _corpoHtmlLembrete(nome, ctx) {
  const primeiro = String(nome || '').trim().split(/\s+/)[0] || 'participante';

  const detalhes = [];
  if (ctx.curso)    detalhes.push(['Curso', ctx.curso]);
  if (ctx.encontro) detalhes.push(['Encontro', ctx.encontro]);
  if (ctx.quando)   detalhes.push(['Quando', 'Amanhã, ' + ctx.quando]);

  const detalhesHtml =
    '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:18px 0 4px 0;border-collapse:separate;">' +
      detalhes.map(function (d, i) {
        var bg = (i % 2 === 0) ? '#f6f8fc' : '#ffffff';
        return '<tr>' +
          '<td style="padding:10px 14px;background:' + bg + ';font-family:\'Open Sans\',Arial,sans-serif;font-size:13px;color:#5d6b88;width:38%;font-weight:600;border-left:3px solid ' + BRAND_COLOR + ';">' + escapeHtml_(d[0]) + '</td>' +
          '<td style="padding:10px 14px;background:' + bg + ';font-family:\'Open Sans\',Arial,sans-serif;font-size:14px;color:#40414d;">' + escapeHtml_(d[1]) + '</td>' +
        '</tr>';
      }).join('') +
    '</table>';

  return (
    '<div width="100%" style="margin:0;padding:0!important;background-color:#eeeeee;">' +
      '<center style="width:100%;background-color:#eeeeee;padding-bottom:5%;">' +
        '<div style="max-width:680px;margin:0 auto;">' +
          '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="95%" style="margin:0 auto;"><tbody>' +
            '<tr><td style="padding:24px 0 16px 0;text-align:center;">' +
              '<img src="' + LOGO_URL + '" height="160" alt="Escola de Governo · Pedro Leopoldo" border="0" style="max-width:80%;height:160px;display:inline-block;">' +
            '</td></tr>' +
            '<tr style="padding-bottom:21px;"><td style="background-color:#ffffff;padding-bottom:21px;border-top-left-radius:4px!important;border-top-right-radius:4px!important;">' +
              '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-top:4px solid ' + BRAND_COLOR + ';border-radius:4px!important;"><tbody>' +
                '<tr><td style="padding:0 4%;">' +
                  '<h1 style="margin:24px 0 0 0;font-family:\'Raleway\',Arial,sans-serif;font-size:190%;font-weight:900;line-height:1.4;color:#1a3d70;text-align:center;border-bottom:1px solid #d6d8db;padding-bottom:24px;">Seu próximo encontro é amanhã</h1>' +
                  '<p style="margin:23px 0 0 0;font-family:\'Open Sans\',Arial,sans-serif;font-size:16px;line-height:1.5;color:#40414d;text-align:left;">Olá, <b>' + escapeHtml_(primeiro) + '</b></p>' +
                  '<p style="margin:16px 0 16px 0;font-family:\'Open Sans\',Arial,sans-serif;font-size:14px;line-height:1.5;color:#40414d;">Este é um lembrete do seu próximo encontro do curso <b>' + escapeHtml_(ctx.curso) + '</b>.</p>' +
                  detalhesHtml +
                  '<p style="margin:18px 0 0 0;font-family:\'Open Sans\',Arial,sans-serif;font-size:14px;line-height:1.6;color:#40414d;">Contamos com a sua presença. Em caso de imprevisto, avise a organização.</p>' +
                '</td></tr>' +
                '<tr><td style="padding:18px 4% 0 4%;">' +
                  '<p style="font-family:\'Open Sans\',Arial,sans-serif;font-size:14px;line-height:1.5;color:#494b57;margin:0;">Dúvidas? Fale com a organização:<br>' +
                  '<a href="mailto:' + (REPLY_TO || SENDER_EMAIL || '') + '" style="font-family:\'Open Sans\',Arial,sans-serif;font-size:14px;font-weight:bold;color:' + BRAND_COLOR + ';text-decoration:none;" target="_blank">Escola de Governo · Prefeitura de Pedro Leopoldo</a></p>' +
                '</td></tr>' +
              '</tbody></table>' +
            '</td></tr>' +
            '<tr style="height:13px;"><td aria-hidden="true" style="font-size:0;line-height:0;">&nbsp;</td></tr>' +
            '<tr><td style="padding:3.5% 4%;background-color:#ffffff;border-radius:4px!important;">' +
              '<table align="center" role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"><tbody><tr><td>' +
                '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="text-align:left;"><tbody><tr>' +
                  '<td style="width:110px;vertical-align:middle;"><a href="' + SITE_URL + '" target="_blank" style="text-decoration:none;"><img src="' + LOGO_URL + '" height="100" alt="EGOV-PL" style="height:100px;display:block;"></a></td>' +
                  '<td style="padding-left:16px;vertical-align:middle;">' +
                    '<p style="color:#494957;font-family:\'Raleway\',Arial,sans-serif;font-size:16px;font-weight:700;line-height:1.5;margin:0;">Capacite-se. Cresça.<br>Transforme o serviço público.</p>' +
                    '<p style="margin:6px 0 0 0;font-family:\'Open Sans\',Arial,sans-serif;font-size:13px;color:#5d6b88;"><a href="' + SITE_URL + '" target="_blank" style="color:' + BRAND_COLOR + ';text-decoration:none;font-weight:600;">intranet.pedroleopoldo.mg.gov.br/egov</a></p>' +
                  '</td>' +
                '</tr></tbody></table>' +
              '</td></tr></tbody></table>' +
            '</td></tr>' +
          '</tbody></table>' +
          '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="93%" style="margin:0 auto;"><tbody>' +
            '<tr><td style="padding:3% 0 0 0;">' +
              '<p style="font-family:\'Open Sans\',Arial,sans-serif;font-size:14px;line-height:1.75;text-align:center;color:#494b57;margin-bottom:0;"><b>Escola de Governo</b> - Prefeitura Municipal de Pedro Leopoldo.</p>' +
              '<p style="font-family:\'Open Sans\',Arial,sans-serif;font-size:14px;line-height:1.75;text-align:center;color:#494b57;margin-top:0;">Este é um e-mail automático.</p>' +
            '</td></tr>' +
          '</tbody></table>' +
        '</div>' +
      '</center>' +
    '</div>'
  );
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// ============ LEITURA DA PLANILHA "INSCRIÇÃO" (reusa a convenção da pasta) ====

function _lerInscritos(eventoKey) {
  const segs = String(eventoKey).split('/').map(function (s) { return s.trim(); }).filter(Boolean);
  let folder = DriveApp.getFolderById(ROOT_FOLDER_ID);
  for (let i = 0; i < segs.length; i++) {
    const child = _acharSubpasta(folder, segs[i]);
    if (!child) throw new Error('Pasta não encontrada: ' + segs[i]);
    folder = child;
  }
  const file = _acharInscricao(folder);
  if (!file) throw new Error('Planilha "Inscrição" não encontrada em ' + eventoKey);
  const ss = SpreadsheetApp.openById(file.getId());
  const values = ss.getSheets()[0].getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(function (h) { return _norm(h); });
  let emailCol = -1, nomeCol = -1;
  for (let i = 0; i < headers.length; i++) {
    if (emailCol < 0 && headers[i].indexOf('mail') >= 0) emailCol = i;
    if (nomeCol < 0 && headers[i].indexOf('nome') >= 0) nomeCol = i;
  }
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const email = emailCol >= 0 ? String(values[i][emailCol] || '').trim() : '';
    const nome = nomeCol >= 0 ? String(values[i][nomeCol] || '').trim() : '';
    if (email) out.push({ nome: nome, email: email });
  }
  return out;
}

// ============ HELPERS ============

function _linhaParaConfig(row) {
  let encontros = [];
  try { encontros = JSON.parse(row[2] || '[]'); } catch (e) { encontros = []; }
  return {
    eventoKey: String(row[0] || ''),
    titulo: String(row[1] || ''),
    encontros: Array.isArray(encontros) ? encontros : [],
    lembreteAtivo: String(row[3] || 'sim').toLowerCase() !== 'nao',
    horaDisparo: _normalizarHora(row[4]),
  };
}

function _normalizarHora(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:00');
  const m = String(v || '').match(/(\d{1,2})/);
  if (!m) return '08:00';
  const h = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  return (h < 10 ? '0' + h : '' + h) + ':00';
}

function _jaEnviado(key, dataISO) {
  const sheet = _obterAba(LOG_SHEET, LOG_HEADER);
  const dados = sheet.getDataRange().getValues();
  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][0]) === key && String(dados[i][1]) === dataISO &&
        String(dados[i][4] || '').indexOf('ERRO') < 0) return true;
  }
  return false;
}

function _registrarLog(key, dataISO, qtd, status) {
  _obterAba(LOG_SHEET, LOG_HEADER).appendRow([key, dataISO, new Date(), qtd, status]);
}

function _acharLinha(sheet, key) {
  const n = sheet.getLastRow();
  if (n < 2) return -1;
  const col = sheet.getRange(1, 1, n, 1).getValues();
  for (let i = 1; i < col.length; i++) if (String(col[i][0]).trim() === key) return i + 1;
  return -1;
}

function _obterAba(nome, header) {
  const ss = SpreadsheetApp.openById(STORAGE_SHEET_ID);
  let sheet = ss.getSheetByName(nome);
  if (!sheet) { sheet = ss.insertSheet(nome); sheet.appendRow(header); sheet.setFrozenRows(1); }
  else if (sheet.getLastRow() === 0) { sheet.appendRow(header); sheet.setFrozenRows(1); }
  return sheet;
}

function _acharSubpasta(folder, nome) {
  const alvo = _norm(nome);
  const it = folder.getFolders();
  while (it.hasNext()) { const f = it.next(); if (_norm(f.getName()) === alvo) return f; }
  return null;
}

function _acharInscricao(folder) {
  const it = folder.getFiles();
  while (it.hasNext()) { const f = it.next(); if (f.getMimeType() === MimeType.GOOGLE_SHEETS && _norm(f.getName()).indexOf('inscri') === 0) return f; }
  return null;
}

function _emailValido(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

function _dataBR(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? (m[3] + '/' + m[2] + '/' + m[1]) : String(iso || '');
}

function _norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ============ TESTE DO E-MAIL ============
// Ajuste TEST_EMAIL e rode esta função no editor para receber um e-mail de
// exemplo e conferir o layout (envia de verdade, mesmo com DRY_RUN ligado).
const TEST_EMAIL = 'lucelho.silva@pedroleopoldo.mg.gov.br';
function enviarLembreteTeste() {
  const ctx = { curso: 'Ciclo de Debates PL por Elas', encontro: 'Encontro 1', quando: '20/05/2026 às 14:00' };
  const opts = { name: PROJECT_NAME, htmlBody: _corpoHtmlLembrete('Teste da Silva', ctx) };
  if (SENDER_EMAIL) opts.from = SENDER_EMAIL;
  if (REPLY_TO) opts.replyTo = REPLY_TO;
  GmailApp.sendEmail(TEST_EMAIL, '[TESTE] Lembrete de encontro', _corpoTextoLembrete('Teste da Silva', ctx), opts);
  Logger.log('E-mail de teste enviado para ' + TEST_EMAIL);
}

// ============ INSTALAÇÃO DO GATILHO ============
// Rode UMA vez no editor para criar o disparo de hora em hora.
function instalarGatilhoLembretes() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'enviarLembretesAgendados') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('enviarLembretesAgendados').timeBased().everyHours(1).create();
}
