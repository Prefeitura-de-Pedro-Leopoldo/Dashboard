/**
 * Disparo de CERTIFICADOS DE PALESTRANTES (separado dos inscritos).
 *
 * Recebe um POST do admin web (via proxy /api/send-certificate-palestrante),
 * salva o PDF no Drive, registra na aba "Palestrantes" da MESMA planilha dos
 * certificados e envia o e-mail ao palestrante, com CÓPIA OCULTA para a Escola
 * de Governo e para a Fabiana.
 *
 * Texto do e-mail é PRÓPRIO de palestrante (reconhecimento pela contribuição),
 * diferente do e-mail de participação dos inscritos.
 *
 * JA VEM TUDO PREENCHIDO. Como publicar (projeto Apps Script SEPARADO):
 *   1. script.google.com -> Novo projeto -> cole este arquivo (nada a editar).
 *   2. Rode autorizar() uma vez para conceder os escopos (Drive, Gmail, Sheets).
 *   3. Implantar -> Nova implantação -> Tipo: App da Web.
 *        - Executar como: Eu
 *        - Quem pode acessar: Qualquer pessoa
 *   4. Copie a URL /exec e me passe (vai no default do proxy / env CERT_PAL_WEBAPP_URL).
 *
 * Drive + e-mail + cópia oculta + registro na aba "Palestrantes" (com Smart Chip
 * do PDF, igual às demais abas) já vêm configurados. Nada a editar.
 */

// ============ CONFIGURAÇÕES ============
// Pasta raiz no Drive (mesma dos certificados). Os PDFs vão para a subpasta
// "Certificados de Palestrantes" dentro dela.
const FOLDER_ID    = '1Ld3y0gXo7Qzw0q2nUrff41IvaMCtlLYC';
const SUBPASTA     = 'Certificados de Palestrantes';

// Planilha de registro: MESMA dos certificados, aba "Palestrantes" (criada
// automaticamente no 1o envio). Deixe vazio para pular o registro.
const SHEET_ID     = '1TdZSUix7a7BJg4J59mnR8hG1FYcuF350pkKrbOo13EA';
const SHEET_TAB    = 'Palestrantes';

const DRY_RUN      = false;  // true = simula, não envia e-mail
const PROJECT_NAME = 'Escola de Governo · Prefeitura de Pedro Leopoldo';
const EMAIL_SUBJECT = 'Seu certificado de palestrante';

// Remetente (alias configurado em Gmail -> Contas -> "Enviar e-mail como").
const SENDER_EMAIL = 'egov@pedroleopoldo.mg.gov.br';
const REPLY_TO     = 'egov@pedroleopoldo.mg.gov.br';

// Cópia oculta em TODOS os envios de palestrante: Escola de Governo + Fabiana.
const BCC_EMAIL    = 'egov@pedroleopoldo.mg.gov.br, fabiana.silva@pedroleopoldo.mg.gov.br';

// Token compartilhado com o admin web (igual ao usado no front-end).
const SHARED_TOKEN = '7a6RTOQzWtpkIqJmhYP8xADSculgNy4K0sBLiG15oXFZMCen';

// Identidade visual EGOV-PL (igual ao e-mail dos inscritos).
const BRAND_COLOR  = '#3063ad';
const SITE_URL     = 'https://intranet.pedroleopoldo.mg.gov.br/egov/';
const LOGO_URL     = 'https://egov-dashboard.vercel.app/assets/img/logo-light.png';

// ============ WEB APP ============
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

    if (!nome)                 return out({ ok: false, error: 'Nome vazio.' });
    if (!email)                return out({ ok: false, error: 'Email vazio.' });
    if (!isEmailValido_(email)) return out({ ok: false, error: 'Email invalido.' });
    if (!pdfName)              return out({ ok: false, error: 'Nome do arquivo vazio.' });
    if (!pdfBase64)            return out({ ok: false, error: 'PDF vazio.' });

    // Salva o PDF no Drive (subpasta de palestrantes). Reenvio sobrescreve.
    const rootFolder = DriveApp.getFolderById(FOLDER_ID);
    const folder     = obterOuCriarSubpasta_(rootFolder, SUBPASTA);
    const existentes = folder.getFilesByName(pdfName);
    while (existentes.hasNext()) existentes.next().setTrashed(true);

    const bytes = Utilities.base64Decode(pdfBase64);
    const blob  = Utilities.newBlob(bytes, 'application/pdf', pdfName);
    const file  = folder.createFile(blob);

    const ctx = {
      titulo: payload.curso,   // título da palestra/curso
      dia:    payload.dia,
      mes:    payload.mes,
      ano:    payload.ano,
    };

    if (DRY_RUN) {
      registrar_(nome, email, file, ctx, 'DRY_RUN', 'DRY_RUN: enviaria o e-mail');
      return out({ ok: true, file: file.getName(), dryRun: true });
    }

    const opts = {
      name: PROJECT_NAME,
      htmlBody: montarCorpoHtml_(nome, ctx),
      attachments: [file.getAs('application/pdf')],
    };
    if (SENDER_EMAIL) opts.from = SENDER_EMAIL;
    if (REPLY_TO)     opts.replyTo = REPLY_TO;
    if (BCC_EMAIL)    opts.bcc = BCC_EMAIL;

    GmailApp.sendEmail(email, EMAIL_SUBJECT, montarCorpoTexto_(nome, ctx), opts);

    registrar_(nome, email, file, ctx, 'ENVIADO', '');
    return out({ ok: true, file: file.getName() });

  } catch (err) {
    return out({ ok: false, error: (err && err.message) ? err.message : String(err) });
  }
}

/** Healthcheck. */
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, service: 'enviarCertificadosPalestrantes' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============ E-MAIL (texto de PALESTRANTE) ============
function montarCorpoTexto_(nome, ctx) {
  ctx = ctx || {};
  const primeiroNome = String(nome).trim().split(/\s+/)[0];
  const evento = ctx.titulo ? ' no evento "' + ctx.titulo + '"' : '';
  const data = (ctx.dia && ctx.mes && ctx.ano)
    ? ', realizado no dia ' + ctx.dia + ' de ' + ctx.mes + ' de ' + ctx.ano
    : '';
  return (
    'Olá, ' + primeiroNome + '!\n\n' +
    'Expressamos nosso reconhecimento pela valiosa contribuição como palestrante' + evento + data + '.\n\n' +
    'Em anexo, em formato PDF, está o seu certificado.\n\n' +
    'A atividade compõe o programa de formação continuada promovido pela Escola de Governo do Município de Pedro Leopoldo - EGOV-PL, e sua participação contribuiu para o desenvolvimento dos servidores deste município.\n\n' +
    'Atenciosamente,\n\n' +
    'Escola de Governo\n' +
    'Diretoria de Gestão de Pessoas\n' +
    'Prefeitura Municipal de Pedro Leopoldo\n\n' +
    '---\n' +
    'Este é um e-mail automático. Em caso de dúvidas, responda esta mensagem.'
  );
}

function montarCorpoHtml_(nome, ctx) {
  ctx = ctx || {};
  const nomeCompleto = String(nome).trim();
  const eventoLinha = ctx.titulo
    ? 'sua contribuição como palestrante no evento <b>"' + escapeHtml_(ctx.titulo) + '"</b>.'
    : '<b>sua contribuição como palestrante.</b>';

  const detalhes = [];
  if (ctx.titulo) detalhes.push(['Palestra / Curso', ctx.titulo]);
  if (ctx.dia && ctx.mes && ctx.ano) detalhes.push(['Data de realização', ctx.dia + ' de ' + ctx.mes + ' de ' + ctx.ano]);

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
          '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="95%" style="margin:0 auto;"><tbody>' +
            '<tr><td style="padding:24px 0 16px 0;text-align:center;">' +
              '<img src="' + LOGO_URL + '" height="160" alt="Escola de Governo · Pedro Leopoldo" border="0" style="max-width:80%;height:160px;display:inline-block;">' +
            '</td></tr>' +
            '<tr style="padding-bottom:21px;"><td style="background-color:#ffffff;padding-bottom:21px;border-top-left-radius:4px!important;border-top-right-radius:4px!important;">' +
              '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-top:4px solid ' + BRAND_COLOR + ';border-radius:4px!important;"><tbody>' +
                '<tr><td style="padding:0 4%;">' +
                  '<h1 style="margin:24px 0 0 0;font-family:\'Raleway\',Arial,sans-serif;font-size:190%;font-weight:900;line-height:1.4;color:#1a3d70;text-align:center;border-bottom:1px solid #d6d8db;padding-bottom:24px;">Seu certificado de palestrante</h1>' +
                  '<p style="margin:23px 0 0 0;font-family:\'Open Sans\',Arial,sans-serif;font-size:16px;line-height:1.5;color:#40414d;text-align:left;">Olá, <b>' + escapeHtml_(nomeCompleto) + '</b></p>' +
                  '<p style="margin:16px 0 16px 0;font-family:\'Open Sans\',Arial,sans-serif;font-size:14px;line-height:1.5;color:#40414d;">Expressamos nosso reconhecimento por ' + eventoLinha + ' O certificado em PDF está anexado a este e-mail.</p>' +
                  detalhesHtml +
                  '<p style="margin:18px 0 0 0;font-family:\'Open Sans\',Arial,sans-serif;font-size:14px;line-height:1.6;color:#40414d;">A atividade compõe o programa de formação continuada promovido pela Escola de Governo do Município de Pedro Leopoldo - EGOV-PL, e sua participação contribuiu para o desenvolvimento dos servidores deste município.</p>' +
                '</td></tr>' +
                '<tr><td style="padding:18px 4% 0 4%;">' +
                  '<p style="font-family:\'Open Sans\',Arial,sans-serif;font-size:14px;line-height:1.5;color:#494b57;margin:0;">Em caso de dúvidas, entre em contato com a organização:<br>' +
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
              '<p style="font-family:\'Open Sans\',Arial,sans-serif;font-size:14px;line-height:1.75;text-align:center;color:#494b57;margin-bottom:0;"><b>© ' + new Date().getFullYear() + ' Escola de Governo</b> - Prefeitura Municipal de Pedro Leopoldo.</p>' +
              '<p style="font-family:\'Open Sans\',Arial,sans-serif;font-size:14px;line-height:1.75;text-align:center;color:#494b57;margin-top:0;">Este é um e-mail automático.</p>' +
            '</td></tr>' +
          '</tbody></table>' +
        '</div>' +
      '</center>' +
    '</div>'
  );
}

// ============ REGISTRO NA PLANILHA (aba "Palestrantes") ============
// Mesma estrutura das abas de certificados de inscritos:
//   Nome | Email | Arquivo PDF | Status | Log | Enviado em
// A coluna "Arquivo PDF" vira um Smart Chip do Drive (igual aos demais).
const CHIP_COL = 3; // coluna "Arquivo PDF"
function registrar_(nome, email, file, ctx, status, log) {
  if (!SHEET_ID) return; // registro desativado
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let sheet = ss.getSheetByName(SHEET_TAB);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_TAB);
      sheet.appendRow(['Nome', 'Email', 'Arquivo PDF', 'Status', 'Log', 'Enviado em']);
    } else if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Nome', 'Email', 'Arquivo PDF', 'Status', 'Log', 'Enviado em']);
    }
    appendRowComChip_(sheet, [nome, email, file.getName(), status, log, new Date()], CHIP_COL, file);
  } catch (err) {
    Logger.log('Falha ao registrar na planilha: ' + (err && err.message));
  }
}

/**
 * Acrescenta uma linha e converte a célula `chipCol` num Smart Chip do Drive
 * (clicável, com preview) - exatamente como o enviarCertificados.gs faz.
 * Requer o serviço avançado "Google Sheets API" habilitado no projeto
 * (Editor -> Serviços -> + -> Google Sheets API). Sem ele, cai para HYPERLINK.
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
                chip: { richLinkProperties: { uri: file.getUrl(), mimeType: 'application/pdf' } },
              }],
            }],
          }],
          fields: 'userEnteredValue,chipRuns',
        },
      }],
    }, ss.getId());
  } catch (err) {
    sheet.getRange(row, chipCol).setFormula(
      '=HYPERLINK("' + file.getUrl() + '","' + file.getName().replace(/"/g, '""') + '")'
    );
    Logger.log('Smart chip falhou, usei HYPERLINK. Detalhe: ' + (err && err.message));
  }
  return row;
}

// ============ HELPERS ============
function obterOuCriarSubpasta_(parent, nome) {
  const nomeLimpo = String(nome || '').trim();
  if (!nomeLimpo) return parent;
  const it = parent.getFoldersByName(nomeLimpo);
  return it.hasNext() ? it.next() : parent.createFolder(nomeLimpo);
}

function isEmailValido_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, function(c){
    return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
  });
}

/**
 * Rode UMA vez (botão Executar) para conceder os escopos Drive/Gmail/Sheets.
 * Republicar a implantação NÃO concede escopo novo — é preciso autorizar aqui.
 */
function autorizar() {
  DriveApp.getRootFolder();
  GmailApp.getAliases();
  if (SHEET_ID) SpreadsheetApp.openById(SHEET_ID);
  Logger.log('Escopos concedidos.');
}
