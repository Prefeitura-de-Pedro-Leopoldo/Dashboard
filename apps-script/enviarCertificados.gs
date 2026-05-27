/**
 * Disparo automatico de certificados em PDF.
 * Le a aba `Certificados`, encontra o PDF correspondente na pasta do Drive
 * e envia individualmente via Gmail. Atualiza Status/Log/Enviado em.
 *
 * Colunas esperadas (linha 1 = cabecalho):
 *   A Nome | B Email | C Arquivo PDF | D Status | E Log | F Enviado em
 */

// ============ CONFIGURACOES ============
const FOLDER_ID         = '1Ld3y0gXo7Qzw0q2nUrff41IvaMCtlLYC';
const SHEET_NAME        = 'Certificados';
const MAX_SENDS_PER_RUN = 50;     // trava de seguranca por execucao
const DRY_RUN           = true;   // true = simula, nao envia e-mails
const TEST_EMAIL        = 'lucelho.silva@pedroleopoldo.mg.gov.br';
const PROJECT_NAME      = 'Escola de Governo · Prefeitura de Pedro Leopoldo';
const EMAIL_SUBJECT     = 'Seu certificado de participação';

// Remetente. Para enviar como egov@..., precisa ser um alias configurado em
// Gmail -> Configuracoes -> Contas -> "Enviar e-mail como" -> Adicionar outro
// endereco. Sem alias configurado, deixe string vazia para enviar do proprio
// e-mail que executa o script.
const SENDER_EMAIL      = 'egov@pedroleopoldo.mg.gov.br';
const REPLY_TO          = 'egov@pedroleopoldo.mg.gov.br';
// Copia oculta em todos os envios. Use virgula para varios destinatarios.
// Ex.: 'egov@pedroleopoldo.mg.gov.br, registro@pedroleopoldo.mg.gov.br'
const BCC_EMAIL         = 'fabiana.silva@pedroleopoldo.mg.gov.br';

// Token compartilhado com o admin web. Troque por uma string longa aleatoria.
// O HTML envia esse valor em cada POST; requisicoes sem ele sao rejeitadas.
const SHARED_TOKEN      = '7a6RTOQzWtpkIqJmhYP8xADSculgNy4K0sBLiG15oXFZMCen';

// Indices das colunas (1-based, conforme SpreadsheetApp)
const COL = {
  NOME:        1,
  EMAIL:       2,
  ARQUIVO:     3,
  STATUS:      4,
  LOG:         5,
  ENVIADO_EM:  6,
};

const STATUS_ENVIADO = 'ENVIADO';
const STATUS_ERRO    = 'ERRO';
const STATUS_DRY_RUN = 'DRY_RUN';

// ============ ENTRADAS PRINCIPAIS ============

/**
 * Funcao principal: percorre a planilha e envia os certificados pendentes.
 */
function enviarCertificados() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Aba "' + SHEET_NAME + '" nao encontrada.');

  const folder = DriveApp.getFolderById(FOLDER_ID);
  const data   = sheet.getDataRange().getValues();

  let enviados = 0;

  for (let i = 1; i < data.length; i++) { // pula cabecalho
    if (enviados >= MAX_SENDS_PER_RUN) {
      Logger.log('Limite MAX_SENDS_PER_RUN atingido (' + MAX_SENDS_PER_RUN + ').');
      break;
    }

    const rowIndex = i + 1; // linha real na planilha
    const row = data[i];

    if (String(row[COL.STATUS - 1]).trim().toUpperCase() === STATUS_ENVIADO) continue;

    const erroValidacao = validarLinha(row);
    if (erroValidacao) {
      registrarErro(sheet, rowIndex, erroValidacao);
      continue;
    }

    const nome     = String(row[COL.NOME - 1]).trim();
    const email    = String(row[COL.EMAIL - 1]).trim();
    const arquivo  = String(row[COL.ARQUIVO - 1]).trim();

    try {
      const pdf = buscarArquivoPdf(folder, arquivo);
      const corpo = montarCorpoEmail(nome);

      if (DRY_RUN) {
        sheet.getRange(rowIndex, COL.STATUS).setValue(STATUS_DRY_RUN);
        sheet.getRange(rowIndex, COL.LOG).setValue(
          'DRY_RUN: enviaria para ' + email + ' o arquivo ' + pdf.getName()
        );
        sheet.getRange(rowIndex, COL.ENVIADO_EM).setValue(new Date());
      } else {
        const opts = opcoesEmail_(nome, {});
        opts.attachments = [pdf.getAs('application/pdf')];
        GmailApp.sendEmail(email, EMAIL_SUBJECT, corpo, opts);
        registrarSucesso(sheet, rowIndex);
      }

      enviados++;
    } catch (err) {
      registrarErro(sheet, rowIndex, err && err.message ? err.message : String(err));
    }
  }

  Logger.log('Execucao concluida. Processados: ' + enviados);
}

/**
 * Funcao de teste: envia um unico e-mail para TEST_EMAIL usando o
 * primeiro PDF disponivel na pasta. Nao altera a planilha.
 */
function enviarCertificadoTeste() {
  if (!TEST_EMAIL || !isEmailValido(TEST_EMAIL)) {
    throw new Error('TEST_EMAIL nao configurado ou invalido.');
  }

  const folder = DriveApp.getFolderById(FOLDER_ID);
  const it = folder.getFilesByType(MimeType.PDF);
  if (!it.hasNext()) throw new Error('Nenhum PDF encontrado na pasta para teste.');

  const pdf   = it.next();
  const ctx   = { curso: 'Workshop de Teste', dia: '01', mes: 'janeiro', ano: '2026', carga: '4' };
  const corpo = montarCorpoEmail('Teste', ctx);
  const opts  = opcoesEmail_('Teste', ctx);
  opts.attachments = [pdf.getAs('application/pdf')];

  GmailApp.sendEmail(TEST_EMAIL, '[TESTE] ' + EMAIL_SUBJECT, corpo, opts);

  Logger.log('Teste enviado para ' + TEST_EMAIL + ' com ' + pdf.getName());
}

// ============ HELPERS ============

function validarLinha(row) {
  const nome    = String(row[COL.NOME - 1] || '').trim();
  const email   = String(row[COL.EMAIL - 1] || '').trim();
  const arquivo = String(row[COL.ARQUIVO - 1] || '').trim();

  if (!nome)    return 'Nome vazio.';
  if (!email)   return 'Email vazio.';
  if (!arquivo) return 'Nome do arquivo PDF vazio.';
  if (!isEmailValido(email)) return 'Email invalido: ' + email;
  return null;
}

function isEmailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Busca um PDF pelo nome exato dentro da pasta. Falha se 0 ou >1 match.
 */
function buscarArquivoPdf(folder, filename) {
  const it = folder.getFilesByName(filename);
  const encontrados = [];
  while (it.hasNext()) encontrados.push(it.next());

  if (encontrados.length === 0) {
    throw new Error('Arquivo nao encontrado na pasta: ' + filename);
  }
  if (encontrados.length > 1) {
    throw new Error('Mais de um arquivo com o nome "' + filename + '" na pasta.');
  }

  const file = encontrados[0];
  if (file.getMimeType() !== MimeType.PDF) {
    throw new Error('Arquivo "' + filename + '" nao e PDF (mime: ' + file.getMimeType() + ').');
  }
  return file;
}

function montarCorpoEmail(nome, ctx) {
  ctx = ctx || {};
  const primeiroNome = String(nome).trim().split(/\s+/)[0];
  const linhaCurso = ctx.curso
    ? 'É com satisfação que enviamos o seu certificado de participação no curso "' + ctx.curso + '"'
    : 'É com satisfação que enviamos o seu certificado de participação';
  const diaTexto = (ctx.dia && ctx.dia2) ? (ctx.dia + ' e ' + ctx.dia2) : ctx.dia;
  const linhaData = (ctx.dia && ctx.mes && ctx.ano)
    ? ', realizado ' + (ctx.dia2 ? 'nos dias ' : 'em ') + diaTexto + ' de ' + ctx.mes + ' de ' + ctx.ano
    : '';
  const linhaCarga = ctx.carga
    ? ' com carga horária de ' + ctx.carga + ' hora(s)'
    : '';
  return (
    'Olá, ' + primeiroNome + '!\n\n' +
    linhaCurso + linhaData + linhaCarga + '.\n\n' +
    'O documento está anexado a este e-mail em formato PDF.\n\n' +
    'Agradecemos sua presença e seguimos firmes no compromisso com a capacitação contínua dos servidores públicos de Pedro Leopoldo.\n\n' +
    'Atenciosamente,\n\n' +
    'Escola de Governo\n' +
    'Diretoria de Gestão de Pessoas\n' +
    'Prefeitura Municipal de Pedro Leopoldo\n\n' +
    '---\n' +
    'Este é um e-mail automático. Em caso de dúvidas, responda esta mensagem.'
  );
}

// Identidade visual EGOV-PL
const LOGO_URL    = 'https://dashboard-lime-chi-98.vercel.app/assets/img/logo-light.png';
const BRAND_COLOR = '#3063ad';
const SITE_URL    = 'https://intranet.pedroleopoldo.mg.gov.br/egov/';

function montarCorpoHtml(nome, ctx) {
  ctx = ctx || {};
  const nomeCompleto = String(nome).trim();
  const cursoLinha   = ctx.curso ? '<b>' + escapeHtml_(ctx.curso) + '.</b>' : '<b>sua participação.</b>';

  const detalhes = [];
  if (ctx.curso) detalhes.push(['Curso', ctx.curso]);
  if (ctx.dia && ctx.mes && ctx.ano) {
    var diaTxt = ctx.dia2 ? (ctx.dia + ' e ' + ctx.dia2) : ctx.dia;
    detalhes.push(['Data de realização', diaTxt + ' de ' + ctx.mes + ' de ' + ctx.ano]);
  }
  if (ctx.carga) detalhes.push(['Carga horária', ctx.carga + ' hora(s)']);

  const detalhesHtml = detalhes.length
    ? '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:18px 0 4px 0;border-collapse:separate;">' +
        detalhes.map(function(d, i){
          var bg = (i % 2 === 0) ? '#f6f8fc' : '#ffffff';
          return '<tr>' +
            '<td style="padding:10px 14px;background:' + bg + ';font-family:\'Open Sans\',Arial,sans-serif;font-size:13px;color:#5d6b88;width:38%;font-weight:600;border-left:3px solid ' + BRAND_COLOR + ';">' + escapeHtml_(d[0]) + '</td>' +
            '<td style="padding:10px 14px;background:' + bg + ';font-family:\'Open Sans\',Arial,sans-serif;font-size:14px;color:#40414d;">' + escapeHtml_(d[1]) + '</td>' +
          '</tr>';
        }).join('') +
      '</table>'
    : '';

  return (
    '<div width="100%" style="margin:0;padding:0!important;background-color:#eeeeee;">' +
      '<center style="width:100%;background-color:#eeeeee;padding-bottom:5%;">' +
        '<div style="max-width:680px;margin:0 auto;">' +
          '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="95%" style="margin:0 auto;">' +
            '<tbody>' +

              // LOGO
              '<tr><td style="padding:24px 0 16px 0;text-align:center;">' +
                '<img src="https://dashboard-lime-chi-98.vercel.app/assets/img/logo-light.png" height="160" alt="Escola de Governo · Pedro Leopoldo" title="Escola de Governo · Pedro Leopoldo" border="0" style="max-width:80%;height:160px;display:inline-block;">' +
              '</td></tr>' +

              // CARD PRINCIPAL
              '<tr style="padding-bottom:21px;"><td style="background-color:#ffffff;padding-bottom:21px;border-top-left-radius:4px!important;border-top-right-radius:4px!important;">' +
                '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-top:4px solid ' + BRAND_COLOR + ';border-radius:4px!important;">' +
                  '<tbody>' +
                    '<tr><td style="padding:0 4%;">' +
                      '<h1 style="margin:24px 0 0 0;font-family:\'Raleway\',Arial,sans-serif;font-size:190%;font-weight:900;font-style:normal;line-height:1.4;letter-spacing:0.1px;color:#1a3d70;text-align:center;border-bottom:1px solid #d6d8db;padding-bottom:24px;">Seu certificado está disponível</h1>' +
                      '<p style="margin:23px 0 0 0;font-family:\'Open Sans\',Arial,sans-serif;font-size:16px;line-height:1.5;color:#40414d;text-align:left;">Olá, <b>' + escapeHtml_(nomeCompleto) + '</b></p>' +
                      '<p style="margin:16px 0 16px 0;font-family:\'Open Sans\',Arial,sans-serif;font-size:14px;line-height:1.5;color:#40414d;">Em anexo a este e-mail está o seu certificado em PDF referente a: ' + cursoLinha + '</p>' +
                      detalhesHtml +
                      '<p style="margin:18px 0 0 0;font-family:\'Open Sans\',Arial,sans-serif;font-size:14px;line-height:1.6;color:#40414d;">Agradecemos sua presença e seguimos firmes no compromisso com a capacitação contínua dos servidores públicos de Pedro Leopoldo.</p>' +
                    '</td></tr>' +
                    '<tr><td style="padding:18px 4% 0 4%;">' +
                      '<p style="font-family:\'Open Sans\',Arial,sans-serif;font-size:14px;line-height:1.5;color:#494b57;margin:0;">Em caso de dúvidas, entre em contato com a organização:<br>' +
                      '<a href="mailto:' + (REPLY_TO || SENDER_EMAIL || '') + '" style="font-family:\'Open Sans\',Arial,sans-serif;font-size:14px;font-weight:bold;color:' + BRAND_COLOR + ';text-decoration:none;" target="_blank">Escola de Governo · Prefeitura de Pedro Leopoldo</a></p>' +
                    '</td></tr>' +
                  '</tbody>' +
                '</table>' +
              '</td></tr>' +

              '<tr style="height:13px;"><td aria-hidden="true" style="font-size:0;line-height:0;">&nbsp;</td></tr>' +

              // BLOCO INSTITUCIONAL
              '<tr><td style="padding:3.5% 4%;background-color:#ffffff;border-radius:4px!important;">' +
                '<table align="center" role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">' +
                  '<tbody><tr><td>' +
                    '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="text-align:left;">' +
                      '<tbody><tr>' +
                        '<td style="width:110px;vertical-align:middle;"><a href="https://intranet.pedroleopoldo.mg.gov.br/egov/" target="_blank" style="text-decoration:none;"><img src="https://dashboard-lime-chi-98.vercel.app/assets/img/logo-light.png" height="100" alt="EGOV-PL" style="height:100px;display:block;"></a></td>' +
                        '<td style="padding-left:16px;vertical-align:middle;">' +
                          '<p style="color:#494957;font-family:\'Raleway\',Arial,sans-serif;font-size:16px;font-weight:700;line-height:1.5;margin:0;padding:0;text-align:left;">Capacite-se. Cresça.<br>Transforme o serviço público.</p>' +
                          '<p style="margin:6px 0 0 0;font-family:\'Open Sans\',Arial,sans-serif;font-size:13px;color:#5d6b88;"><a href="' + SITE_URL + '" target="_blank" style="color:' + BRAND_COLOR + ';text-decoration:none;font-weight:600;">intranet.pedroleopoldo.mg.gov.br/egov</a></p>' +
                        '</td>' +
                      '</tr></tbody>' +
                    '</table>' +
                  '</td></tr></tbody>' +
                '</table>' +
              '</td></tr>' +

            '</tbody>' +
          '</table>' +

          // FOOTER
          '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="93%" style="margin:0 auto;">' +
            '<tbody>' +
              '<tr><td style="padding:3% 0 0 0;">' +
                '<p style="font-family:\'Open Sans\',Arial,sans-serif;font-size:14px;line-height:1.75;text-align:center;color:#494b57;margin-bottom:0;"><b>© ' + new Date().getFullYear() + ' Escola de Governo</b> - Prefeitura Municipal de Pedro Leopoldo.</p>' +
                '<p style="font-family:\'Open Sans\',Arial,sans-serif;font-size:14px;line-height:1.75;text-align:center;color:#494b57;margin-top:0;">Este é um e-mail automático.</p>' +
              '</td></tr>' +
            '</tbody>' +
          '</table>' +

        '</div>' +
      '</center>' +
    '</div>'
  );
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, function(c){
    return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
  });
}

function opcoesEmail_(nome, ctx) {
  const opts = {
    attachments: [],
    name: PROJECT_NAME,
    htmlBody: montarCorpoHtml(nome, ctx),
  };
  if (SENDER_EMAIL) opts.from = SENDER_EMAIL;
  if (REPLY_TO)     opts.replyTo = REPLY_TO;
  if (BCC_EMAIL)    opts.bcc = BCC_EMAIL;
  return opts;
}

function registrarSucesso(sheet, rowIndex) {
  sheet.getRange(rowIndex, COL.STATUS).setValue(STATUS_ENVIADO);
  sheet.getRange(rowIndex, COL.LOG).setValue('');
  sheet.getRange(rowIndex, COL.ENVIADO_EM).setValue(new Date());
}

function registrarErro(sheet, rowIndex, mensagem) {
  sheet.getRange(rowIndex, COL.STATUS).setValue(STATUS_ERRO);
  sheet.getRange(rowIndex, COL.LOG).setValue(mensagem);
}

// ============ WEB APP ENDPOINT ============
/**
 * Recebe um certificado do admin web, salva o PDF no Drive, registra na
 * planilha e dispara o e-mail. Um POST por destinatario.
 *
 * Payload JSON esperado:
 *   { token, nome, email, pdfName, pdfBase64 }
 * Resposta JSON:
 *   { ok: true, file } ou { ok: false, error }
 */
function doPost(e) {
  const out = (obj) => ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);

  try {
    const payload = JSON.parse(e.postData.contents);

    if (!SHARED_TOKEN || payload.token !== SHARED_TOKEN) {
      return out({ ok: false, error: 'Token invalido.' });
    }

    const nome      = String(payload.nome || '').trim();
    const email     = String(payload.email || '').trim();
    const pdfName   = String(payload.pdfName || '').trim();
    const pdfBase64 = String(payload.pdfBase64 || '');

    if (!nome)              return out({ ok: false, error: 'Nome vazio.' });
    if (!email)             return out({ ok: false, error: 'Email vazio.' });
    if (!isEmailValido(email)) return out({ ok: false, error: 'Email invalido.' });
    if (!pdfName)           return out({ ok: false, error: 'Nome do arquivo vazio.' });
    if (!pdfBase64)         return out({ ok: false, error: 'PDF vazio.' });

    const nomeAba   = abaParaCurso_(payload.curso);
    const rootFolder = DriveApp.getFolderById(FOLDER_ID);
    const folder    = obterOuCriarSubpasta_(rootFolder, nomeAba);

    // Evita duplicatas: se ja existe arquivo com esse nome na subpasta, falha.
    if (folder.getFilesByName(pdfName).hasNext()) {
      return out({ ok: false, error: 'Arquivo ja existe no Drive: ' + nomeAba + '/' + pdfName });
    }

    const bytes = Utilities.base64Decode(pdfBase64);
    const blob  = Utilities.newBlob(bytes, 'application/pdf', pdfName);
    const file  = folder.createFile(blob);

    // Garante que a aba do curso existe e tem cabecalho
    const sheet = obterOuCriarAba(nomeAba);

    if (DRY_RUN) {
      const row = appendRowComChip_(sheet,
        [nome, email, file.getName(), STATUS_DRY_RUN, 'DRY_RUN: enviaria via Web App', new Date()],
        COL.ARQUIVO, file);
      return out({ ok: true, file: file.getName(), dryRun: true, row: row });
    }

    const ctx = {
      curso: payload.curso,
      dia:   payload.dia,
      dia2:  payload.dia2,
      mes:   payload.mes,
      ano:   payload.ano,
      carga: payload.carga,
    };
    const opts = opcoesEmail_(nome, ctx);
    opts.attachments = [file.getAs('application/pdf')];
    GmailApp.sendEmail(email, EMAIL_SUBJECT, montarCorpoEmail(nome, ctx), opts);

    appendRowComChip_(sheet,
      [nome, email, file.getName(), STATUS_ENVIADO, '', new Date()],
      COL.ARQUIVO, file);
    return out({ ok: true, file: file.getName() });

  } catch (err) {
    return out({ ok: false, error: (err && err.message) ? err.message : String(err) });
  }
}

/**
 * Acrescenta uma linha na planilha e converte a celula da coluna `chipCol`
 * num Smart Chip apontando para o arquivo do Drive (clicavel, com preview).
 * Requer o servico avancado "Sheets API" habilitado no projeto Apps Script
 * (Editor -> Services -> + -> Google Sheets API).
 */
function appendRowComChip_(sheet, values, chipCol, file) {
  sheet.appendRow(values);
  const row = sheet.getLastRow();
  try {
    const ss = sheet.getParent();
    Sheets.Spreadsheets.batchUpdate({
      requests: [{
        updateCells: {
          range: {
            sheetId: sheet.getSheetId(),
            startRowIndex: row - 1,
            endRowIndex: row,
            startColumnIndex: chipCol - 1,
            endColumnIndex: chipCol,
          },
          rows: [{
            values: [{
              userEnteredValue: { stringValue: '@' },
              chipRuns: [{
                startIndex: 0,
                chip: {
                  richLinkProperties: {
                    uri: file.getUrl(),
                    mimeType: 'application/pdf',
                  },
                },
              }],
            }],
          }],
          fields: 'userEnteredValue,chipRuns',
        },
      }],
    }, ss.getId());
  } catch (err) {
    // Fallback: se a Sheets API nao estiver habilitada, mantem o texto
    // simples e adiciona pelo menos um hyperlink para o arquivo.
    sheet.getRange(row, chipCol).setFormula(
      '=HYPERLINK("' + file.getUrl() + '","' + file.getName().replace(/"/g, '""') + '")'
    );
    Logger.log('Smart chip falhou, usei HYPERLINK. Detalhe: ' + (err && err.message));
  }
  return row;
}

function obterOuCriarAba(nomeAba) {
  const ss = SpreadsheetApp.getActive();
  const finalName = String(nomeAba || SHEET_NAME).slice(0, 99);
  let sheet = ss.getSheetByName(finalName);
  if (!sheet) {
    sheet = ss.insertSheet(finalName);
    sheet.appendRow(['Nome', 'Email', 'Arquivo PDF', 'Status', 'Log', 'Enviado em']);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Nome', 'Email', 'Arquivo PDF', 'Status', 'Log', 'Enviado em']);
  }
  return sheet;
}

/**
 * Converte o nome do curso/evento num nome de aba valido.
 * Nomes de aba do Sheets nao aceitam : \ / ? * [ ] e tem limite de 100 chars.
 */
function abaParaCurso_(curso) {
  const c = String(curso || '').trim();
  if (!c) return SHEET_NAME;
  return c.replace(/[:\\\/\?\*\[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 99);
}

/**
 * Retorna a subpasta com `nome` dentro de `parent`, criando se nao existir.
 * Usado para agrupar os PDFs por curso dentro da pasta principal do Drive.
 */
function obterOuCriarSubpasta_(parent, nome) {
  const nomeLimpo = String(nome || '').trim();
  if (!nomeLimpo) return parent;
  const it = parent.getFoldersByName(nomeLimpo);
  return it.hasNext() ? it.next() : parent.createFolder(nomeLimpo);
}

/** Healthcheck para abrir a URL no navegador e confirmar que esta publicada. */
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, service: 'enviarCertificados' }))
    .setMimeType(ContentService.MimeType.JSON);
}
