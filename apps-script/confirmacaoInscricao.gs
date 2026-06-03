/**
 * Confirmação de Inscrição - Google Apps Script (sem Web App).
 *
 * Varre periodicamente as planilhas "Inscrição" (respostas dos Forms) dentro da
 * pasta de relatórios e, para cada novo inscrito que ainda não foi confirmado,
 * envia um e-mail de CONFIRMAÇÃO DE INSCRIÇÃO no mesmo padrão visual do
 * certificado (mudando só o texto).
 *
 * - Usa a MESMA planilha de armazenamento do lembretesEventos.gs (STORAGE_SHEET_ID),
 *   numa aba própria "ConfirmacoesLog", para lembrar quem já recebeu.
 * - É acionado por um gatilho de tempo (a cada 1 min) → "assim que a pessoa
 *   aparece na planilha, recebe".
 *
 * Setup: cole a ID da planilha em STORAGE_SHEET_ID, ajuste o remetente, rode
 * instalarGatilhoConfirmacoes() uma vez. Comece com DRY_RUN = true para semear
 * o log com os inscritos já existentes (sem enviar nada); depois troque para
 * false e só os NOVOS inscritos passam a receber.
 */

// ============ CONFIGURAÇÕES ============

// Mesma planilha de armazenamento do lembretesEventos.gs.
const STORAGE_SHEET_ID = '1Q8a06-d-U5oEle8DkpkcDo9FG3Y4hCLtRRDMRHuKe9Q';

// Mesma pasta "relatorios" (onde ficam as planilhas "Inscrição").
const ROOT_FOLDER_ID = '1Jfyl8jE70W05t8YydDvVMEzkqXZZ7QJK';

// Remetente (reaproveite os do enviarCertificados.gs / lembretesEventos.gs).
const SENDER_EMAIL = 'egov@pedroleopoldo.mg.gov.br';
const REPLY_TO     = 'egov@pedroleopoldo.mg.gov.br';
const BCC_EMAIL    = 'fabiana.silva@pedroleopoldo.mg.gov.br';
const PROJECT_NAME = 'Escola de Governo · Prefeitura de Pedro Leopoldo';

// true = não envia; apenas registra no log (use para semear os já existentes).
const DRY_RUN = false;

const CONFIRM_SHEET = 'ConfirmacoesLog';
const CONFIRM_HEADER = ['SheetId', 'Email', 'Nome', 'EventoKey', 'EnviadoEm', 'Status'];

// Identidade visual EGOV-PL (mesma do certificado/lembrete).
const LOGO_URL    = 'https://dashboard-lime-chi-98.vercel.app/assets/img/logo-light.png';
const BRAND_COLOR = '#3063ad';
const SITE_URL    = 'https://intranet.pedroleopoldo.mg.gov.br/egov/';

// ============ ROTINA PRINCIPAL (gatilho de tempo) ============

function enviarConfirmacoesPendentes() {
  const sheets = _planilhasInscricao();
  const jaEnviado = _carregarConfirmados();
  const logSheet = _obterAba(CONFIRM_SHEET, CONFIRM_HEADER);

  for (let s = 0; s < sheets.length; s++) {
    const info = sheets[s];
    const titulo = _tituloDoEvento(info.folder);
    let inscritos;
    try { inscritos = _lerInscritos(info.id); }
    catch (e) { continue; }

    for (let i = 0; i < inscritos.length; i++) {
      const p = inscritos[i];
      if (!_emailValido(p.email)) continue;
      const chave = info.id + '|' + p.email.toLowerCase();
      if (jaEnviado[chave]) continue; // já confirmado antes

      let status = 'DRY_RUN';
      try {
        if (!DRY_RUN) {
          _enviarConfirmacao(p.email, p.nome, { curso: titulo });
          status = 'ENVIADO';
        }
      } catch (err) {
        status = 'ERRO: ' + (err && err.message ? err.message : String(err));
      }
      logSheet.appendRow([info.id, p.email, p.nome, info.folder, new Date(), status]);
      jaEnviado[chave] = true; // evita duplicar na mesma execução
    }
  }
}

// ============ E-MAIL (mesmo template, texto de confirmação) ============

function _enviarConfirmacao(email, nome, ctx) {
  const assunto = 'Inscrição confirmada' + (ctx.curso ? ' - ' + ctx.curso : '');
  const opts = { name: PROJECT_NAME, htmlBody: _corpoHtmlConfirmacao(nome, ctx) };
  if (SENDER_EMAIL) opts.from = SENDER_EMAIL;
  if (REPLY_TO) opts.replyTo = REPLY_TO;
  if (BCC_EMAIL) opts.bcc = BCC_EMAIL;
  GmailApp.sendEmail(email, assunto, _corpoTextoConfirmacao(nome, ctx), opts);
}

function _corpoTextoConfirmacao(nome, ctx) {
  const primeiro = String(nome || '').trim().split(/\s+/)[0] || 'participante';
  return (
    'Olá, ' + primeiro + '!\n\n' +
    'Sua inscrição no curso "' + ctx.curso + '" foi confirmada com sucesso.\n\n' +
    'Atenciosamente,\nEscola de Governo\nPrefeitura Municipal de Pedro Leopoldo\n\n' +
    '---\nE-mail automático. Em caso de dúvidas, responda esta mensagem.'
  );
}

function _corpoHtmlConfirmacao(nome, ctx) {
  const primeiro = String(nome || '').trim().split(/\s+/)[0] || 'participante';

  const detalhes = [];
  if (ctx.curso) detalhes.push(['Curso', ctx.curso]);
  detalhes.push(['Situação', 'Inscrição confirmada']);

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
                  '<h1 style="margin:24px 0 0 0;font-family:\'Raleway\',Arial,sans-serif;font-size:190%;font-weight:900;line-height:1.4;color:#1a3d70;text-align:center;border-bottom:1px solid #d6d8db;padding-bottom:24px;">Inscrição confirmada!</h1>' +
                  '<p style="margin:23px 0 0 0;font-family:\'Open Sans\',Arial,sans-serif;font-size:16px;line-height:1.5;color:#40414d;text-align:left;">Olá, <b>' + escapeHtml_(primeiro) + '</b></p>' +
                  '<p style="margin:16px 0 16px 0;font-family:\'Open Sans\',Arial,sans-serif;font-size:14px;line-height:1.5;color:#40414d;">Recebemos a sua inscrição no curso <b>' + escapeHtml_(ctx.curso) + '</b> e sua vaga está <b>confirmada</b>.</p>' +
                  detalhesHtml +
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

// ============ DESCOBERTA E LEITURA ============

// Lista as planilhas "Inscrição" varrendo a árvore de pastas a partir da raiz.
// (Não usa DriveApp.searchFiles: o operador `contains` faz prefixo de PALAVRA,
//  então "nscri" não casa com "Inscrição" e a busca indexada também pode não
//  enxergar planilhas acessíveis só por herança da pasta compartilhada.)
function _planilhasInscricao() {
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const out = [];
  _varrerPasta(root, '', out, 0);
  return out;
}

function _varrerPasta(folder, prefixo, out, depth) {
  if (depth > 25) return;
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    if (f.getMimeType() === MimeType.GOOGLE_SHEETS && _norm(f.getName()).indexOf('inscri') === 0) {
      out.push({ id: f.getId(), folder: prefixo });
    }
  }
  const subs = folder.getFolders();
  while (subs.hasNext()) {
    const sub = subs.next();
    const novo = prefixo ? prefixo + '/' + sub.getName() : sub.getName();
    _varrerPasta(sub, novo, out, depth + 1);
  }
}

// Lê os inscritos (nome + email) de uma planilha de respostas por ID.
function _lerInscritos(sheetId) {
  const values = SpreadsheetApp.openById(sheetId).getSheets()[0].getDataRange().getValues();
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
    if (email) out.push({ nome: nome, email: email, _email: email });
  }
  return out;
}

// Título do curso: usa o "Titulo" salvo na aba Encontros (se houver) senão
// humaniza o nome da pasta-topo.
function _tituloDoEvento(eventoKey) {
  try {
    const sh = SpreadsheetApp.openById(STORAGE_SHEET_ID).getSheetByName('Encontros');
    if (sh && sh.getLastRow() >= 2) {
      const vals = sh.getDataRange().getValues();
      for (let i = 1; i < vals.length; i++) {
        if (String(vals[i][0]).trim() === eventoKey && String(vals[i][1] || '').trim()) {
          return String(vals[i][1]).trim();
        }
      }
    }
  } catch (e) {}
  return _humanize(String(eventoKey).split('/')[0] || eventoKey);
}

// ============ LOG / HELPERS ============

function _carregarConfirmados() {
  const sheet = _obterAba(CONFIRM_SHEET, CONFIRM_HEADER);
  const dados = sheet.getDataRange().getValues();
  const set = {};
  for (let i = 1; i < dados.length; i++) {
    const id = String(dados[i][0] || '');
    const email = String(dados[i][1] || '').toLowerCase();
    if (id && email) set[id + '|' + email] = true;
  }
  return set;
}

function _obterAba(nome, header) {
  const ss = SpreadsheetApp.openById(STORAGE_SHEET_ID);
  let sheet = ss.getSheetByName(nome);
  if (!sheet) { sheet = ss.insertSheet(nome); sheet.appendRow(header); sheet.setFrozenRows(1); }
  else if (sheet.getLastRow() === 0) { sheet.appendRow(header); sheet.setFrozenRows(1); }
  return sheet;
}

function _emailValido(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

const _SMALL = { de: 1, da: 1, do: 1, das: 1, dos: 1, e: 1, por: 1, para: 1, com: 1, em: 1, a: 1, o: 1 };
const _ACR = { pl: 'PL', sei: 'SEI', egov: 'EGov' };
function _humanize(seg) {
  return String(seg).replace(/[-_]?\d{4}-\d{2}$/, '').replace(/[-_]+/g, ' ').trim()
    .split(/\s+/).map(function (w, i) {
      const lw = w.toLowerCase();
      if (_ACR[lw]) return _ACR[lw];
      if (i > 0 && _SMALL[lw]) return lw;
      return lw.charAt(0).toUpperCase() + lw.slice(1);
    }).join(' ');
}

function _norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ============ TESTE / INSTALAÇÃO ============

// Ajuste e rode para receber um exemplo (envia de verdade, ignora DRY_RUN).
const TEST_EMAIL = 'lucelho.silva@pedroleopoldo.mg.gov.br';
function enviarConfirmacaoTeste() {
  const ctx = { curso: 'Ciclo de Debates PL por Elas', _email: TEST_EMAIL };
  const opts = { name: PROJECT_NAME, htmlBody: _corpoHtmlConfirmacao('Teste da Silva', ctx) };
  if (SENDER_EMAIL) opts.from = SENDER_EMAIL;
  if (REPLY_TO) opts.replyTo = REPLY_TO;
  GmailApp.sendEmail(TEST_EMAIL, '[TESTE] Inscrição confirmada', _corpoTextoConfirmacao('Teste da Silva', ctx), opts);
}

// Diagnóstico: mostra quantas planilhas "Inscrição" foram achadas, quantos
// inscritos em cada uma, e quem seria pulado/enviado. Rode e veja "Execuções"
// (ou Ver > Registros / Ctrl+Enter) para ler o resultado.
function diagnosticarConfirmacoes() {
  let raiz;
  try { raiz = DriveApp.getFolderById(ROOT_FOLDER_ID).getName(); }
  catch (e) { Logger.log('ERRO acessando ROOT_FOLDER_ID: ' + e.message); return; }
  Logger.log('Pasta raiz: "%s"', raiz);

  const sheets = _planilhasInscricao();
  Logger.log('Planilhas "Inscrição" encontradas: %s', sheets.length);
  if (!sheets.length) {
    Logger.log('>> Nenhuma planilha achada. Verifique: (a) a conta que autorizou ESTE script tem acesso às planilhas de respostas; (b) o nome começa com "Inscri"; (c) estão dentro da pasta raiz.');
    return;
  }

  const jaEnviado = _carregarConfirmados();
  for (let s = 0; s < sheets.length; s++) {
    const info = sheets[s];
    Logger.log('--- [%s] id=%s pasta="%s"', s + 1, info.id, info.folder);
    let inscritos;
    try { inscritos = _lerInscritos(info.id); }
    catch (e) { Logger.log('   ERRO lendo planilha: %s', e.message); continue; }
    Logger.log('   inscritos lidos: %s', inscritos.length);
    for (let i = 0; i < inscritos.length; i++) {
      const p = inscritos[i];
      const valido = _emailValido(p.email);
      const chave = info.id + '|' + String(p.email).toLowerCase();
      const ja = !!jaEnviado[chave];
      let acao = 'ENVIARIA';
      if (!valido) acao = 'PULA (email inválido: "' + p.email + '")';
      else if (ja) acao = 'PULA (já no log)';
      Logger.log('   - %s <%s> => %s', p.nome || '(sem nome)', p.email, acao);
    }
  }
  Logger.log('DRY_RUN = %s', DRY_RUN);
}

// Rode UMA vez para criar o gatilho que verifica novas inscrições a cada 1 min.
function instalarGatilhoConfirmacoes() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'enviarConfirmacoesPendentes') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('enviarConfirmacoesPendentes').timeBased().everyMinutes(1).create();
}
