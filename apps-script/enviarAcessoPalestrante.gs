/**
 * Envio de ACESSO DO PALESTRANTE ao painel restrito.
 *
 * Recebe um POST do backend (via /api/palestrante-provision) com o e-mail, o
 * nome, a SENHA gerada e o link de login, e envia ao palestrante um e-mail com
 * as credenciais, em CÓPIA OCULTA para a Escola de Governo e para a Fabiana.
 *
 * É um projeto Apps Script SEPARADO (token/remetente próprios). Modelado no
 * enviarCertificadosPalestrantes.gs (mesmo padrão visual e de envio).
 *
 * Como publicar:
 *   1. script.google.com -> Novo projeto -> cole este arquivo.
 *   2. Rode autorizar() uma vez (concede o escopo do Gmail).
 *   3. Implantar -> Nova implantação -> App da Web:
 *        - Executar como: Eu
 *        - Quem pode acessar: Qualquer pessoa
 *   4. Copie a URL /exec e ponha na env ACESSO_PAL_WEBAPP_URL na Vercel.
 *   5. Ponha o MESMO token abaixo na env ACESSO_PAL_TOKEN na Vercel.
 */

// ============ CONFIGURAÇÕES ============
const PROJECT_NAME  = 'Escola de Governo · Prefeitura de Pedro Leopoldo';
const EMAIL_SUBJECT = 'Seu acesso ao painel de palestrante';

// Remetente (alias "Enviar e-mail como" no Gmail) e resposta.
const SENDER_EMAIL  = 'egov@pedroleopoldo.mg.gov.br';
const REPLY_TO      = 'egov@pedroleopoldo.mg.gov.br';

// Cópia oculta em TODO envio: Escola de Governo + Fabiana (mesmo padrão dos
// certificados de palestrante).
const BCC_EMAIL     = 'egov@pedroleopoldo.mg.gov.br, fabiana.silva@pedroleopoldo.mg.gov.br';

// Token compartilhado com o backend (env ACESSO_PAL_TOKEN na Vercel). Já vem
// preenchido: use EXATAMENTE este mesmo valor na env ACESSO_PAL_TOKEN.
const SHARED_TOKEN  = '4Nk4KjOmQv5nXuAUTdRoFctbDED8iNXz9Y048Sl4GVPQjJxh';

const DRY_RUN       = false; // true = não envia, só loga

// Identidade visual.
const BRAND_COLOR   = '#3063ad';
const LOGO_URL      = 'https://egov-dashboard.vercel.app/assets/img/logo-light.png';
const LOGIN_URL_PADRAO = 'https://egov-dashboard.vercel.app/';

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

    const nome     = String(payload.nome || '').trim();
    const email    = String(payload.email || '').trim();
    const senha    = String(payload.senha || '');
    const loginUrl = String(payload.loginUrl || LOGIN_URL_PADRAO);

    if (!nome)                  return out({ ok: false, error: 'Nome vazio.' });
    if (!isEmailValido_(email)) return out({ ok: false, error: 'Email invalido.' });
    if (!senha)                 return out({ ok: false, error: 'Senha vazia.' });

    if (DRY_RUN) {
      Logger.log('DRY_RUN: enviaria acesso para %s (%s)', nome, email);
      return out({ ok: true, dryRun: true });
    }

    const opts = {
      name: PROJECT_NAME,
      htmlBody: corpoHtml_(nome, email, senha, loginUrl),
    };
    if (SENDER_EMAIL) opts.from = SENDER_EMAIL;
    if (REPLY_TO)     opts.replyTo = REPLY_TO;
    if (BCC_EMAIL)    opts.bcc = BCC_EMAIL;

    GmailApp.sendEmail(email, EMAIL_SUBJECT, corpoTexto_(nome, email, senha, loginUrl), opts);
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, error: (err && err.message) ? err.message : String(err) });
  }
}

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, service: 'enviarAcessoPalestrante' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============ CORPO DO E-MAIL ============
function corpoTexto_(nome, email, senha, loginUrl) {
  const primeiro = String(nome).trim().split(/\s+/)[0];
  return [
    'Olá, ' + primeiro + '!',
    '',
    'Seu acesso ao painel de palestrante da Escola de Governo foi criado. Nele você',
    'acompanha a lista de inscritos do seu evento (nome e secretaria).',
    '',
    'Endereço: ' + loginUrl,
    'Login (e-mail): ' + email,
    'Senha provisória: ' + senha,
    '',
    'Por segurança, no primeiro acesso o sistema vai pedir para você trocar a senha.',
    '',
    'Qualquer dúvida, responda este e-mail.',
    '',
    'Escola de Governo · Prefeitura de Pedro Leopoldo',
  ].join('\n');
}

function corpoHtml_(nome, email, senha, loginUrl) {
  const primeiro = escapeHtml_(String(nome).trim().split(/\s+/)[0]);
  return '' +
  '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1f2430;">' +
    '<div style="text-align:center;padding:20px 0;">' +
      '<img src="' + LOGO_URL + '" alt="Escola de Governo" style="height:48px;" />' +
    '</div>' +
    '<div style="border:1px solid #dde2ea;border-radius:12px;padding:24px;">' +
      '<h2 style="margin:0 0 12px;color:' + BRAND_COLOR + ';font-size:18px;">Olá, ' + primeiro + '!</h2>' +
      '<p style="margin:0 0 14px;line-height:1.6;">Seu acesso ao <b>painel de palestrante</b> da Escola de Governo foi criado. ' +
        'Nele você acompanha a <b>lista de inscritos do seu evento</b> (nome e secretaria).</p>' +
      '<div style="background:#f5f7fa;border-radius:8px;padding:14px 16px;margin:16px 0;line-height:1.9;">' +
        '<div><b>Endereço:</b> <a href="' + escapeHtml_(loginUrl) + '" style="color:' + BRAND_COLOR + ';">' + escapeHtml_(loginUrl) + '</a></div>' +
        '<div><b>Login (e-mail):</b> ' + escapeHtml_(email) + '</div>' +
        '<div><b>Senha provisória:</b> <code style="background:#eceff4;padding:2px 6px;border-radius:4px;">' + escapeHtml_(senha) + '</code></div>' +
      '</div>' +
      '<p style="margin:0 0 14px;line-height:1.6;">Por segurança, no <b>primeiro acesso</b> o sistema vai pedir para você trocar a senha.</p>' +
      '<div style="text-align:center;margin:22px 0 6px;">' +
        '<a href="' + escapeHtml_(loginUrl) + '" style="background:' + BRAND_COLOR + ';color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;">Acessar o painel</a>' +
      '</div>' +
    '</div>' +
    '<p style="text-align:center;color:#6b7180;font-size:12px;margin:18px 0;">Escola de Governo · Prefeitura de Pedro Leopoldo</p>' +
  '</div>';
}

// ============ HELPERS ============
function isEmailValido_(email) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || ''));
}

function escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// Rode UMA vez no editor para conceder o escopo do Gmail.
function autorizar() {
  GmailApp.getAliases();
  Logger.log('Escopo do Gmail autorizado. Publique como App da Web.');
}
