/**
 * Cadastro de Palestrantes - Web App (Google Apps Script).
 *
 * Backend gratuito para o modulo "Palestrantes" do painel EGov-PL:
 *   - Planilha Google Sheets como banco de dados (abas `Palestrantes` e `Convites`).
 *   - Pasta do Google Drive para as fotos.
 *
 * Recursos:
 *   - CRUD de palestrantes (admin), com eixo tematico MULTIPLO.
 *   - Links de convite de USO UNICO: o admin gera um link; o palestrante
 *     se cadastra sem login; ao enviar, o link "queima" (status usado).
 *
 * E independente do `enviarCertificados.gs`: token, planilha e pasta proprios.
 * Publique como Web App e consuma via o proxy /api/palestrantes na Vercel.
 *
 * Aba `Palestrantes` (linha 1 = cabecalho):
 *   A ID | B Nome | C Eixos | D CursoId | E CursoTitulo | F MiniBio
 *   G FotoFileId | H CriadoEm | I AtualizadoEm | J Status | K Origem
 *   L Foto (smart chip clicavel / link para o arquivo no Drive)
 *
 * Para o "Foto" virar um smart chip com preview, habilite o servico avancado
 * "Google Sheets API" no projeto (Editor -> Servicos (+) -> Google Sheets API).
 * Sem o servico, vira um HYPERLINK clicavel "Ver foto" (tambem funciona).
 *
 * Aba `Convites`:
 *   A Token | B Status | C CriadoEm | D UsadoEm | E PalestranteId
 */

// ============ CONFIGURACOES ============

// ID da pasta do Drive onde as fotos serao salvas.
//   https://drive.google.com/drive/folders/<FOLDER_ID>
const PHOTOS_FOLDER_ID = 'COLE_AQUI_O_ID_DA_PASTA_DE_FOTOS';

// Abas (criadas automaticamente se nao existirem).
const SHEET_NAME   = 'Palestrantes';
const INVITE_SHEET = 'Convites';

// Token compartilhado com o proxy /api/palestrantes (env PALESTRANTES_TOKEN).
// Troque por uma string longa e aleatoria.
const SHARED_TOKEN = 'TROQUE_POR_UM_TOKEN_LONGO_E_ALEATORIO';

const MINIBIO_MAX = 500;

// Colunas da aba Palestrantes (1-based).
const COL = {
  ID:            1,
  NOME:          2,
  EIXOS:         3,
  CURSO_ID:      4,
  CURSO_TITULO:  5,
  MINIBIO:       6,
  FOTO_FILE_ID:  7,
  CRIADO_EM:     8,
  ATUALIZADO_EM: 9,
  STATUS:        10,
  ORIGEM:        11,
  FOTO:          12,
};
const HEADER = [
  'ID', 'Nome', 'Eixos', 'CursoId', 'CursoTitulo', 'MiniBio',
  'FotoFileId', 'CriadoEm', 'AtualizadoEm', 'Status', 'Origem', 'Foto',
];

// Colunas da aba Convites (1-based).
const ICOL = {
  TOKEN:           1,
  STATUS:          2,
  CRIADO_EM:       3,
  USADO_EM:        4,
  PALESTRANTE_ID:  5,
};
const IHEADER = ['Token', 'Status', 'CriadoEm', 'UsadoEm', 'PalestranteId'];

const STATUS_ATIVO    = 'ativo';
const STATUS_INATIVO  = 'inativo';

const INVITE_PENDENTE = 'pendente';
const INVITE_USADO    = 'usado';
const INVITE_REVOGADO = 'revogado';

// ============ ENTRADAS HTTP ============

/** Healthcheck: abra a URL /exec no navegador para confirmar a publicacao. */
function doGet() {
  return _json({ ok: true, service: 'cadastroPalestrantes' });
}

/**
 * Roteador unico. POST JSON: { token, action, ...dados }.
 * Acoes admin:   create | list | update | delete
 * Acoes convite: invite-create | invite-list | invite-revoke (admin)
 *                invite-check | invite-submit (publico, via link)
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return _json({ ok: false, error: 'Corpo da requisicao vazio.' });
    }
    const payload = JSON.parse(e.postData.contents);

    if (!SHARED_TOKEN || payload.token !== SHARED_TOKEN) {
      return _json({ ok: false, error: 'Token invalido.' });
    }

    const action = String(payload.action || '').trim().toLowerCase();
    switch (action) {
      case 'create':        return _json(_create(payload));
      case 'list':          return _json(_list());
      case 'update':        return _json(_update(payload));
      case 'delete':        return _json(_delete(payload));
      case 'invite-create': return _json(_inviteCreate());
      case 'invite-list':   return _json(_inviteList());
      case 'invite-revoke': return _json(_inviteRevoke(payload));
      case 'invite-check':  return _json(_inviteCheck(payload));
      case 'invite-submit': return _json(_inviteSubmit(payload));
      default:              return _json({ ok: false, error: 'Acao desconhecida: ' + action });
    }
  } catch (err) {
    return _json({ ok: false, error: (err && err.message) ? err.message : String(err) });
  }
}

// ============ ACOES: PALESTRANTES ============

function _create(payload) {
  const dados = _validar(payload, { fotoObrigatoria: false });
  if (dados.erro) return { ok: false, error: dados.erro };
  const row = _inserirPalestrante(dados, payload, 'admin');
  return { ok: true, palestrante: _linhaParaObjeto(row) };
}

function _list() {
  const sheet = _obterAba(SHEET_NAME, HEADER);
  const valores = sheet.getDataRange().getValues();
  const palestrantes = [];
  for (let i = 1; i < valores.length; i++) {
    const row = valores[i];
    if (String(row[COL.STATUS - 1]).trim().toLowerCase() === STATUS_INATIVO) continue;
    if (!String(row[COL.ID - 1]).trim()) continue;
    palestrantes.push(_linhaParaObjeto(row));
  }
  palestrantes.sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
  return { ok: true, palestrantes: palestrantes };
}

function _update(payload) {
  const id = String(payload.id || '').trim();
  if (!id) return { ok: false, error: 'ID ausente.' };

  const dados = _validar(payload, { fotoObrigatoria: false });
  if (dados.erro) return { ok: false, error: dados.erro };

  const sheet = _obterAba(SHEET_NAME, HEADER);
  const linha = _encontrarLinha(sheet, id);
  if (linha < 0) return { ok: false, error: 'Palestrante nao encontrado.' };

  let fotoFileId = String(sheet.getRange(linha, COL.FOTO_FILE_ID).getValue() || '');
  if (payload.fotoBase64) {
    const novoId = _salvarFoto(payload.fotoBase64, payload.fotoMime, dados.nome, id);
    if (fotoFileId) _descartarArquivo(fotoFileId);
    fotoFileId = novoId;
  } else if (payload.removerFoto) {
    if (fotoFileId) _descartarArquivo(fotoFileId);
    fotoFileId = '';
  }

  sheet.getRange(linha, COL.NOME).setValue(dados.nome);
  sheet.getRange(linha, COL.EIXOS).setValue(dados.eixos);
  sheet.getRange(linha, COL.CURSO_ID).setValue(dados.cursoId);
  sheet.getRange(linha, COL.CURSO_TITULO).setValue(dados.cursoTitulo);
  sheet.getRange(linha, COL.MINIBIO).setValue(dados.miniBio);
  sheet.getRange(linha, COL.FOTO_FILE_ID).setValue(fotoFileId);
  sheet.getRange(linha, COL.ATUALIZADO_EM).setValue(new Date());
  _marcarFoto(sheet, linha, fotoFileId);

  const row = sheet.getRange(linha, 1, 1, HEADER.length).getValues()[0];
  return { ok: true, palestrante: _linhaParaObjeto(row) };
}

function _delete(payload) {
  const id = String(payload.id || '').trim();
  if (!id) return { ok: false, error: 'ID ausente.' };

  const sheet = _obterAba(SHEET_NAME, HEADER);
  const linha = _encontrarLinha(sheet, id);
  if (linha < 0) return { ok: false, error: 'Palestrante nao encontrado.' };

  // Exclusao logica + descarte da foto.
  const fotoFileId = String(sheet.getRange(linha, COL.FOTO_FILE_ID).getValue() || '');
  if (fotoFileId) _descartarArquivo(fotoFileId);
  sheet.getRange(linha, COL.STATUS).setValue(STATUS_INATIVO);
  sheet.getRange(linha, COL.ATUALIZADO_EM).setValue(new Date());
  return { ok: true, id: id };
}

// Insere a linha do palestrante e retorna o array da linha gravada.
function _inserirPalestrante(dados, payload, origem) {
  const sheet = _obterAba(SHEET_NAME, HEADER);
  const id = Utilities.getUuid();
  const agora = new Date();

  let fotoFileId = '';
  if (payload.fotoBase64) {
    fotoFileId = _salvarFoto(payload.fotoBase64, payload.fotoMime, dados.nome, id);
  }

  const row = [
    id, dados.nome, dados.eixos, dados.cursoId, dados.cursoTitulo,
    dados.miniBio, fotoFileId, agora, agora, STATUS_ATIVO, origem,
  ];
  sheet.appendRow(row);
  // Coluna "Foto": smart chip / link clicavel para o arquivo no Drive.
  _marcarFoto(sheet, sheet.getLastRow(), fotoFileId);
  return row;
}

// ============ ACOES: CONVITES (uso unico) ============

// Admin gera um link de convite. Retorna o token (UUID, impossivel de adivinhar).
function _inviteCreate() {
  const sheet = _obterAba(INVITE_SHEET, IHEADER);
  const token = Utilities.getUuid();
  sheet.appendRow([token, INVITE_PENDENTE, new Date(), '', '']);
  return { ok: true, token: token };
}

// Admin lista convites pendentes (para acompanhar/copiar/revogar).
function _inviteList() {
  const sheet = _obterAba(INVITE_SHEET, IHEADER);
  const valores = sheet.getDataRange().getValues();
  const convites = [];
  for (let i = 1; i < valores.length; i++) {
    const r = valores[i];
    if (!String(r[ICOL.TOKEN - 1]).trim()) continue;
    convites.push({
      token:   String(r[ICOL.TOKEN - 1]),
      status:  String(r[ICOL.STATUS - 1] || INVITE_PENDENTE),
      criadoEm: _isoData(r[ICOL.CRIADO_EM - 1]),
      usadoEm:  _isoData(r[ICOL.USADO_EM - 1]),
      palestranteId: String(r[ICOL.PALESTRANTE_ID - 1] || ''),
    });
  }
  convites.sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
  return { ok: true, convites: convites };
}

// Admin revoga (inutiliza) um convite ainda pendente.
function _inviteRevoke(payload) {
  const token = String(payload.convite || payload.token2 || '').trim();
  if (!token) return { ok: false, error: 'Convite ausente.' };
  const sheet = _obterAba(INVITE_SHEET, IHEADER);
  const linha = _encontrarLinhaConvite(sheet, token);
  if (linha < 0) return { ok: false, error: 'Convite nao encontrado.' };
  const status = String(sheet.getRange(linha, ICOL.STATUS).getValue()).trim().toLowerCase();
  if (status === INVITE_USADO) return { ok: false, error: 'Convite ja foi utilizado.' };
  sheet.getRange(linha, ICOL.STATUS).setValue(INVITE_REVOGADO);
  return { ok: true, token: token };
}

// Publico: a pagina de convite verifica se o link e valido antes de mostrar o form.
function _inviteCheck(payload) {
  const token = String(payload.convite || '').trim();
  if (!token) return { ok: true, valid: false, reason: 'missing' };
  const sheet = _obterAba(INVITE_SHEET, IHEADER);
  const linha = _encontrarLinhaConvite(sheet, token);
  if (linha < 0) return { ok: true, valid: false, reason: 'notfound' };
  const status = String(sheet.getRange(linha, ICOL.STATUS).getValue()).trim().toLowerCase();
  if (status === INVITE_USADO)    return { ok: true, valid: false, reason: 'used' };
  if (status === INVITE_REVOGADO) return { ok: true, valid: false, reason: 'revoked' };
  return { ok: true, valid: true };
}

// Publico: o palestrante envia o cadastro. Valida o convite (deve estar
// pendente), grava o palestrante e QUEIMA o convite (status usado).
function _inviteSubmit(payload) {
  const token = String(payload.convite || '').trim();
  if (!token) return { ok: false, error: 'Convite ausente.' };

  const iSheet = _obterAba(INVITE_SHEET, IHEADER);
  const linha = _encontrarLinhaConvite(iSheet, token);
  if (linha < 0) return { ok: false, error: 'Convite invalido.' };
  const status = String(iSheet.getRange(linha, ICOL.STATUS).getValue()).trim().toLowerCase();
  if (status === INVITE_USADO)    return { ok: false, error: 'Este link ja foi utilizado.' };
  if (status === INVITE_REVOGADO) return { ok: false, error: 'Este link foi revogado.' };

  // No formulario publico, todos os campos (inclusive foto) sao obrigatorios.
  const dados = _validar(payload, { fotoObrigatoria: true });
  if (dados.erro) return { ok: false, error: dados.erro };

  const row = _inserirPalestrante(dados, payload, 'convite');
  const palestranteId = row[COL.ID - 1];

  // Queima o convite.
  iSheet.getRange(linha, ICOL.STATUS).setValue(INVITE_USADO);
  iSheet.getRange(linha, ICOL.USADO_EM).setValue(new Date());
  iSheet.getRange(linha, ICOL.PALESTRANTE_ID).setValue(palestranteId);

  return { ok: true };
}

// ============ HELPERS ============

function _validar(payload, opts) {
  opts = opts || {};
  const nome        = String(payload.nome || '').trim();
  const eixos       = _eixosParaString(payload.eixos != null ? payload.eixos : payload.eixo);
  const cursoId     = String(payload.cursoId || '').trim();
  const cursoTitulo = String(payload.cursoTitulo || '').trim();
  const miniBio     = String(payload.miniBio || '').trim();

  if (nome.length < 3)  return { erro: 'Nome completo invalido (minimo 3 caracteres).' };
  if (!eixos)           return { erro: 'Selecione ao menos um eixo tematico.' };
  if (!cursoTitulo)     return { erro: 'Curso ministrado obrigatorio.' };
  if (!miniBio)         return { erro: 'Mini bio obrigatoria.' };
  if (miniBio.length > MINIBIO_MAX) return { erro: 'Mini bio excede ' + MINIBIO_MAX + ' caracteres.' };
  if (opts.fotoObrigatoria && !payload.fotoBase64) return { erro: 'Foto obrigatoria.' };

  return { nome: nome, eixos: eixos, cursoId: cursoId, cursoTitulo: cursoTitulo, miniBio: miniBio };
}

// Normaliza eixos (array ou string) para "A; B; C".
function _eixosParaString(eixos) {
  let lista = [];
  if (Array.isArray(eixos)) lista = eixos;
  else if (typeof eixos === 'string') lista = eixos.split(/;|\n/);
  return lista.map(function (x) { return String(x).trim(); })
    .filter(function (x) { return x; })
    .join('; ');
}

function _salvarFoto(fotoBase64, fotoMime, nome, id) {
  const mime = String(fotoMime || 'image/jpeg');
  const ext = mime.indexOf('png') >= 0 ? 'png' : 'jpg';
  const limpo = String(fotoBase64).replace(/^data:[^,]+,/, '');
  const bytes = Utilities.base64Decode(limpo);
  const blob = Utilities.newBlob(bytes, mime, _slug(nome) + '-' + id + '.' + ext);

  const folder = DriveApp.getFolderById(PHOTOS_FOLDER_ID);
  const file = folder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    Logger.log('setSharing falhou: ' + (err && err.message));
  }
  return file.getId();
}

function _descartarArquivo(fileId) {
  try { DriveApp.getFileById(fileId).setTrashed(true); }
  catch (err) { Logger.log('Falha ao descartar ' + fileId + ': ' + (err && err.message)); }
}

/**
 * Marca a coluna "Foto" como um Smart Chip clicavel apontando para o arquivo
 * da foto no Drive (com preview). Se o servico avancado "Google Sheets API"
 * nao estiver habilitado, cai num HYPERLINK clicavel "Ver foto".
 * A coluna FotoFileId continua guardando o ID puro (o sistema le de la).
 */
function _marcarFoto(sheet, linha, fileId) {
  const cel = sheet.getRange(linha, COL.FOTO);
  if (!fileId) { cel.clearContent(); return; }

  let url = 'https://drive.google.com/file/d/' + fileId + '/view';
  let mime = 'image/jpeg';
  try {
    const f = DriveApp.getFileById(fileId);
    url = f.getUrl();
    mime = f.getMimeType() || mime;
  } catch (e) {}

  // Tenta o Smart Chip (precisa do servico avancado "Google Sheets API").
  try {
    const ss = sheet.getParent();
    Sheets.Spreadsheets.batchUpdate({
      requests: [{
        updateCells: {
          range: {
            sheetId: sheet.getSheetId(),
            startRowIndex: linha - 1,
            endRowIndex: linha,
            startColumnIndex: COL.FOTO - 1,
            endColumnIndex: COL.FOTO,
          },
          rows: [{
            values: [{
              userEnteredValue: { stringValue: '@' },
              chipRuns: [{
                startIndex: 0,
                chip: { richLinkProperties: { uri: url, mimeType: mime } },
              }],
            }],
          }],
          fields: 'userEnteredValue,chipRuns',
        },
      }],
    }, ss.getId());
  } catch (err) {
    // Fallback universal (sem servico avancado): link clicavel.
    cel.setFormula('=HYPERLINK("' + url + '","Ver foto")');
    Logger.log('Smart chip da foto falhou, usei HYPERLINK. Detalhe: ' + (err && err.message));
  }
}

function _encontrarLinha(sheet, id) {
  const n = sheet.getLastRow();
  if (n < 2) return -1;
  const valores = sheet.getRange(1, COL.ID, n, 1).getValues();
  for (let i = 1; i < valores.length; i++) {
    if (String(valores[i][0]).trim() === id) return i + 1;
  }
  return -1;
}

function _encontrarLinhaConvite(sheet, token) {
  const n = sheet.getLastRow();
  if (n < 2) return -1;
  const valores = sheet.getRange(1, ICOL.TOKEN, n, 1).getValues();
  for (let i = 1; i < valores.length; i++) {
    if (String(valores[i][0]).trim() === token) return i + 1;
  }
  return -1;
}

function _linhaParaObjeto(row) {
  const fileId = String(row[COL.FOTO_FILE_ID - 1] || '').trim();
  const eixosStr = String(row[COL.EIXOS - 1] || '');
  return {
    id:          String(row[COL.ID - 1] || ''),
    nome:        String(row[COL.NOME - 1] || ''),
    eixos:       eixosStr.split(/;\s*/).map(function (x) { return x.trim(); }).filter(Boolean),
    eixo:        eixosStr, // compat: string completa
    cursoId:     String(row[COL.CURSO_ID - 1] || ''),
    cursoTitulo: String(row[COL.CURSO_TITULO - 1] || ''),
    miniBio:     String(row[COL.MINIBIO - 1] || ''),
    fotoFileId:  fileId,
    fotoUrl:     fileId ? ('https://drive.google.com/thumbnail?id=' + fileId + '&sz=w600') : '',
    criadoEm:    _isoData(row[COL.CRIADO_EM - 1]),
    atualizadoEm: _isoData(row[COL.ATUALIZADO_EM - 1]),
    status:      String(row[COL.STATUS - 1] || STATUS_ATIVO),
    origem:      String(row[COL.ORIGEM - 1] || 'admin'),
  };
}

// Retorna a aba pelo nome, criando com cabecalho se necessario.
function _obterAba(nome, header) {
  const ss = SpreadsheetApp.getActive();
  if (!ss) {
    throw new Error('Script nao esta vinculado a uma planilha. Cole o codigo em ' +
      'Extensoes -> Apps Script de dentro da planilha.');
  }
  let sheet = ss.getSheetByName(nome);
  if (!sheet) {
    sheet = ss.insertSheet(nome);
    sheet.appendRow(header);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(header);
    sheet.setFrozenRows(1);
  } else {
    // Garante o cabecalho completo em planilhas ja existentes (ex.: a nova
    // coluna "Foto"). So reescreve se algo diferir.
    const atual = sheet.getRange(1, 1, 1, header.length).getValues()[0];
    let difere = false;
    for (let i = 0; i < header.length; i++) {
      if (String(atual[i] || '').trim() !== header[i]) { difere = true; break; }
    }
    if (difere) sheet.getRange(1, 1, 1, header.length).setValues([header]);
  }
  return sheet;
}

function _isoData(v) {
  if (v instanceof Date) return v.toISOString();
  return String(v || '');
}

function _slug(s) {
  return String(s || 'palestrante')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'palestrante';
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
