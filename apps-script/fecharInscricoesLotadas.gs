/**
 * Fechar inscrições lotadas - Google Apps Script (sem Web App).
 *
 * Varre periodicamente as planilhas "Inscrição" (respostas dos Forms) dentro da
 * pasta de relatórios e, para cada formulário que JÁ ATINGIU as vagas DAQUELE
 * evento, abre o Form vinculado àquela planilha e DESATIVA o recebimento de
 * novas respostas (form.setAcceptingResponses(false)). Ao fechar, envia um
 * e-mail de aviso (padrão institucional) para a Fabiana.
 *
 * VAGAS POR EVENTO (não é um número fixo): o limite de cada formulário vem da
 * MESMA fonte que o painel usa — o campo "vagas" do eventos-meta.json. O script
 * baixa esse JSON e casa cada planilha "Inscrição" com o evento pela PASTA.
 * Usar o eventos-meta.json (e não o eventos-data.json) garante que eventos
 * FUTUROS — que ainda não têm participantes.xlsx, mas já têm inscrição aberta —
 * também tenham as vagas corretas. Eventos sem "vagas" caem no LIMITE_PADRAO.
 * Assim, mudar as vagas é só editar o eventos-meta.json e publicar.
 *
 * Por quê um script? O Google Forms não tem "fechar após N respostas" nativo.
 * Reaproveita a varredura de pastas do confirmacaoInscricao.gs (é um projeto
 * Apps Script PRÓPRIO e independente).
 *
 * Setup:
 *   1. Crie um projeto Apps Script novo (script.google.com → Novo projeto) e
 *      cole este arquivo.
 *   2. Ajuste ROOT_FOLDER_ID (mesma pasta "relatorios") e META_URL.
 *   3. Comece com DRY_RUN = true e rode diagnosticarFormsLotados() para conferir
 *      vagas/inscritos de cada form e o que SERIA fechado. Nada é alterado.
 *   4. Troque DRY_RUN = false e rode instalarGatilhoFecharForms() uma vez.
 *
 * IMPORTANTE: a conta que AUTORIZAR este script precisa ter acesso de EDIÇÃO
 * aos formulários (ser dono/editor), além de acesso às planilhas. Sem isso o
 * FormApp.openByUrl() falha e o form não é fechado (fica registrado no log).
 */

// ============ CONFIGURAÇÕES ============

// Mesma pasta "relatorios" onde ficam as planilhas "Inscrição" (respostas).
const ROOT_FOLDER_ID = '1Jfyl8jE70W05t8YydDvVMEzkqXZZ7QJK';

// Metadados dos eventos (com "vagas" por evento). Fonte ÚNICA de vagas — inclui
// eventos futuros (inscrição aberta) que ainda não estão no eventos-data.json.
const META_URL = 'https://egov-dashboard.vercel.app/assets/docs/relatorios/eventos-meta.json';

// Fallback: usado só quando o evento não tem "vagas" definido (ou a planilha
// não casa com nenhum evento). Deixe um número conservador.
const LIMITE_PADRAO = 40;

// Mensagem exibida a quem abrir o formulário já encerrado (deixe '' p/ manter
// a mensagem padrão do Google Forms).
const MENSAGEM_ENCERRADA =
  'Inscrições encerradas — todas as vagas foram preenchidas. Obrigado pelo interesse!';

// true = só registra no log o que FARIA (não fecha nada nem envia e-mail). Use
// para validar. Troque para false quando estiver pronto para produção.
const DRY_RUN = true;

// ---- Aviso por e-mail ao fechar (padrão institucional, igual aos outros .gs) ----
const AVISAR_EMAIL  = true; // false = fecha o form mas não envia e-mail.
const AVISO_PARA     = 'fabiana.silva@pedroleopoldo.mg.gov.br'; // destinatário do aviso
const SENDER_EMAIL   = 'egov@pedroleopoldo.mg.gov.br';
const REPLY_TO       = 'egov@pedroleopoldo.mg.gov.br';
const PROJECT_NAME   = 'Escola de Governo · Prefeitura de Pedro Leopoldo';
const LOGO_URL       = 'https://egov-dashboard.vercel.app/assets/img/logo-light.png';
const BRAND_COLOR    = '#3063ad';
const SITE_URL       = 'https://intranet.pedroleopoldo.mg.gov.br/egov/';

// ============ ROTINA PRINCIPAL (gatilho de tempo) ============

function fecharFormsLotados() {
  const sheets = _planilhasInscricao();
  const vagasPorPasta = _mapaVagasPorPasta(); // pasta normalizada -> { vagas, id, title }
  let fechados = 0;

  for (let s = 0; s < sheets.length; s++) {
    const info = sheets[s];

    let total;
    try { total = _contarInscritos(info.id); }
    catch (e) { Logger.log('ERRO lendo "%s": %s', info.folder, e && e.message); continue; }

    const ev = vagasPorPasta[_normPath(info.folder)];
    const limite = (ev && ev.vagas > 0) ? ev.vagas : LIMITE_PADRAO;
    const origem = (ev && ev.vagas > 0) ? ('vagas do evento "' + ev.id + '"') : 'LIMITE_PADRAO';
    const titulo = (ev && ev.title) ? ev.title : info.folder;

    if (total < limite) continue; // ainda tem vaga

    let formUrl;
    try { formUrl = SpreadsheetApp.openById(info.id).getFormUrl(); }
    catch (e) { Logger.log('ERRO abrindo planilha "%s": %s', info.folder, e && e.message); continue; }

    if (!formUrl) {
      Logger.log('SEM form vinculado: "%s" (%s/%s inscritos) — feche manualmente se precisar.', info.folder, total, limite);
      continue;
    }

    try {
      const form = FormApp.openByUrl(formUrl);
      if (!form.isAcceptingResponses()) continue; // já estava fechado

      Logger.log('%sFECHAR "%s" — %s/%s inscritos (%s) — form=%s',
        DRY_RUN ? '[DRY_RUN] ' : '', info.folder, total, limite, origem, form.getId());

      if (!DRY_RUN) {
        form.setAcceptingResponses(false);
        if (MENSAGEM_ENCERRADA) form.setCustomClosedMessage(MENSAGEM_ENCERRADA);
        fechados++;
        if (AVISAR_EMAIL) {
          try { _avisarFechamento({ titulo: titulo, folder: info.folder, total: total, limite: limite }); }
          catch (mailErr) { Logger.log('AVISO: form fechado, mas falhou o e-mail de "%s": %s', info.folder, mailErr && mailErr.message); }
        }
      }
    } catch (e) {
      Logger.log('ERRO fechando form de "%s": %s (a conta tem acesso de edição ao form?)', info.folder, e && e.message);
    }
  }

  Logger.log('Concluído. Forms fechados nesta execução: %s (DRY_RUN=%s).', fechados, DRY_RUN);
}

// ============ E-MAIL DE AVISO (padrão institucional) ============

function _avisarFechamento(ctx) {
  const assunto = 'Inscrições encerradas — ' + ctx.titulo;
  const opts = { name: PROJECT_NAME, htmlBody: _corpoHtmlFechamento(ctx) };
  if (SENDER_EMAIL) opts.from = SENDER_EMAIL;
  if (REPLY_TO) opts.replyTo = REPLY_TO;
  GmailApp.sendEmail(AVISO_PARA, assunto, _corpoTextoFechamento(ctx), opts);
}

function _corpoTextoFechamento(ctx) {
  return (
    'Aviso automático da Escola de Governo.\n\n' +
    'As inscrições do evento "' + ctx.titulo + '" foram ENCERRADAS automaticamente — ' +
    'o limite de vagas foi atingido.\n\n' +
    'Evento: ' + ctx.titulo + '\n' +
    'Vagas (limite): ' + ctx.limite + '\n' +
    'Inscritos: ' + ctx.total + '\n' +
    'Pasta: ' + ctx.folder + '\n' +
    'Encerrado em: ' + _agora() + '\n\n' +
    'O formulário não está mais recebendo respostas.\n\n' +
    '---\nE-mail automático. Em caso de dúvidas, responda esta mensagem.'
  );
}

function _corpoHtmlFechamento(ctx) {
  const linhas = [
    ['Evento', ctx.titulo],
    ['Vagas (limite)', String(ctx.limite)],
    ['Inscritos', String(ctx.total)],
    ['Pasta', ctx.folder],
    ['Encerrado em', _agora()],
  ];
  const detalhesHtml =
    '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:18px 0 4px 0;border-collapse:separate;">' +
      linhas.map(function (d, i) {
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
                  '<h1 style="margin:24px 0 0 0;font-family:\'Raleway\',Arial,sans-serif;font-size:170%;font-weight:900;line-height:1.4;color:#1a3d70;text-align:center;border-bottom:1px solid #d6d8db;padding-bottom:24px;">Inscrições encerradas</h1>' +
                  '<p style="margin:23px 0 0 0;font-family:\'Open Sans\',Arial,sans-serif;font-size:16px;line-height:1.5;color:#40414d;text-align:left;">As inscrições do evento <b>' + escapeHtml_(ctx.titulo) + '</b> foram <b>encerradas automaticamente</b> — o limite de vagas foi atingido. O formulário não está mais recebendo respostas.</p>' +
                  detalhesHtml +
                '</td></tr>' +
                '<tr><td style="padding:18px 4% 0 4%;">' +
                  '<p style="font-family:\'Open Sans\',Arial,sans-serif;font-size:14px;line-height:1.5;color:#494b57;margin:0;">Escola de Governo · Prefeitura de Pedro Leopoldo</p>' +
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

function _agora() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy 'às' HH:mm");
}

// Envia um aviso de teste (ignora DRY_RUN) para conferir o visual do e-mail.
function avisarFechamentoTeste() {
  _avisarFechamento({ titulo: 'Evento de Teste', folder: 'evento-teste-2026-06/turma 1', total: 40, limite: 40 });
}

// ============ VAGAS POR EVENTO (fonte única: eventos-meta.json) ============

// Baixa o eventos-meta.json e monta um mapa: PASTA normalizada -> {vagas,id,title}.
// As chaves do meta são os caminhos de participantes.xlsx; a "pasta" é o
// diretório dessa chave (ex.: "comissao-recursal-2026-05/turma 1/participantes
// .xlsx" -> "comissao-recursal-2026-05/turma 1"), que é a mesma pasta da
// planilha "Inscrição" daquele evento.
function _mapaVagasPorPasta() {
  const mapa = {};
  let dados;
  try {
    const resp = UrlFetchApp.fetch(META_URL, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) {
      Logger.log('AVISO: %s respondeu %s — usando LIMITE_PADRAO para todos.', META_URL, resp.getResponseCode());
      return mapa;
    }
    dados = JSON.parse(resp.getContentText());
  } catch (e) {
    Logger.log('AVISO: falha ao buscar/ler %s (%s) — usando LIMITE_PADRAO para todos.', META_URL, e && e.message);
    return mapa;
  }
  const eventos = (dados && dados.eventos) || {};
  Object.keys(eventos).forEach(function (chave) {
    const m = eventos[chave] || {};
    if (m.ignore) return; // entrada legada marcada como ignore
    const pasta = String(chave).split('/').slice(0, -1).join('/'); // tira "/participantes.xlsx"
    mapa[_normPath(pasta)] = { vagas: Number(m.vagas) || 0, id: m.id || '', title: m.title || '' };
  });
  return mapa;
}

// Normaliza um caminho de pasta para casar Drive x meta (sem acento, minúsculo,
// espaços colapsados, sem barras nas pontas).
function _normPath(p) {
  return String(p || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').replace(/^\/+|\/+$/g, '').trim();
}

// ============ CONTAGEM DE INSCRITOS ============

// Conta inscritos = linhas com e-mail preenchido (mesma regra de leitura do
// confirmacaoInscricao.gs, para o número bater com o painel).
function _contarInscritos(sheetId) {
  const values = SpreadsheetApp.openById(sheetId).getSheets()[0].getDataRange().getValues();
  if (values.length < 2) return 0;
  const headers = values[0].map(_norm);
  let emailCol = -1;
  for (let i = 0; i < headers.length; i++) {
    if (headers[i].indexOf('mail') >= 0) { emailCol = i; break; }
  }
  let n = 0;
  for (let i = 1; i < values.length; i++) {
    const email = emailCol >= 0
      ? String(values[i][emailCol] || '').trim()
      : String(values[i][1] || values[i][0] || '').trim();
    if (email) n++;
  }
  return n;
}

// ============ DESCOBERTA (varredura de pastas) ============
// Espelha o confirmacaoInscricao.gs: não usa DriveApp.searchFiles porque o
// operador `contains` casa só prefixo de PALAVRA e pode não enxergar planilhas
// acessíveis só por herança da pasta compartilhada.

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

function _norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

// ============ DIAGNÓSTICO / INSTALAÇÃO ============

// Rode com DRY_RUN = true para ver, sem alterar nada, as vagas/inscritos de cada
// formulário e quais SERIAM fechados.
function diagnosticarFormsLotados() {
  let raiz;
  try { raiz = DriveApp.getFolderById(ROOT_FOLDER_ID).getName(); }
  catch (e) { Logger.log('ERRO acessando ROOT_FOLDER_ID: ' + (e && e.message)); return; }

  const vagasPorPasta = _mapaVagasPorPasta();
  Logger.log('Pasta raiz: "%s" | Eventos com vagas no meta: %s | LIMITE_PADRAO: %s | DRY_RUN: %s',
    raiz, Object.keys(vagasPorPasta).length, LIMITE_PADRAO, DRY_RUN);

  const sheets = _planilhasInscricao();
  Logger.log('Planilhas "Inscrição" encontradas: %s', sheets.length);

  for (let s = 0; s < sheets.length; s++) {
    const info = sheets[s];
    let total = '?';
    try { total = _contarInscritos(info.id); } catch (e) { total = 'ERRO: ' + (e && e.message); }

    const ev = vagasPorPasta[_normPath(info.folder)];
    const limite = (ev && ev.vagas > 0) ? ev.vagas : LIMITE_PADRAO;
    const origem = (ev && ev.vagas > 0) ? ('evento "' + ev.id + '"') : 'PADRÃO (sem match)';

    let estado = '';
    try {
      const url = SpreadsheetApp.openById(info.id).getFormUrl();
      if (!url) estado = 'sem form vinculado';
      else {
        const form = FormApp.openByUrl(url);
        estado = form.isAcceptingResponses() ? 'ABERTO' : 'já fechado';
      }
    } catch (e) { estado = 'ERRO form: ' + (e && e.message); }

    const acao = (typeof total === 'number' && total >= limite && estado === 'ABERTO')
      ? '>>> FECHARIA' : '(mantém)';
    Logger.log('- "%s": %s/%s inscritos [%s] | form: %s | %s',
      info.folder, total, limite, origem, estado, acao);
  }
}

// Rode UMA vez (com DRY_RUN = false) para criar o gatilho que fecha forms
// lotados a cada 10 minutos.
function instalarGatilhoFecharForms() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'fecharFormsLotados') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('fecharFormsLotados').timeBased().everyMinutes(10).create();
}
