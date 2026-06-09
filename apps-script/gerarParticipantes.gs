/**
 * Gerar participantes.xlsx - Google Apps Script (sem Web App).
 *
 * Gera AUTOMATICAMENTE o arquivo `participantes.xlsx` de cada evento a partir
 * das duas planilhas Google que ficam na MESMA pasta do evento:
 *
 *   - "Inscrição"  -> BASE: traz todos os campos do inscrito (nome, e-mail,
 *                     secretaria, cargo, matrícula, tipo de ingresso, etc.) e o
 *                     carimbo de data/hora (= Data de inscrição).
 *   - "Presente(s)" -> lista de check-in: quem compareceu e quando.
 *
 * Regra de Check-in (robusta):
 *   - Check-in = "Sim"  se a pessoa da Inscrição aparece na Presentes casando
 *     por E-MAIL **ou** por NOME (sem acento/maiúsculas). Basta um dos dois bater
 *     (cobre quem se inscreveu com e-mail diferente, ou erro de digitação).
 *   - Check-in = "Não"  caso contrário.
 *   - "Data de check-in" = carimbo (mais antigo) da pessoa na planilha Presentes.
 *
 * Quando gera: roda por gatilho de tempo (de hora em hora) e só gera o
 * participantes.xlsx de um evento depois de passadas HORAS_APOS_EVENTO (3h) da
 * data/hora do evento (lida do eventos-meta.json publicado; se não houver meta,
 * usa o último check-in da Presentes como referência). Regera se as planilhas
 * forem atualizadas depois do último arquivo gerado.
 *
 * O .xlsx gerado segue o cabeçalho que o build do dashboard reconhece, então o
 * evento deixa de ser "inscrição aberta" e passa a exibir presença/análises.
 *
 * SETUP (uma vez):
 *   1. Cole este arquivo num projeto Apps Script standalone.
 *   2. Rode `instalarGatilho()` e autorize (Drive + acesso externo).
 *   3. (Opcional) Rode `gerarParticipantesAgora()` para gerar na hora, ignorando
 *      a janela de 3h (útil para testar).
 */

// ============ CONFIGURAÇÕES ============

// ENTRADA: pasta onde ficam as pastas dos eventos com as planilhas Google
// "Inscrição"/"Presentes" (a mesma de servirInscricoes.gs / confirmacaoInscricao.gs).
// Seus filhos diretos são as pastas dos eventos (ex.: "gestao-...-2026-06").
const INSCRICOES_ROOT_ID = '1Jfyl8jE70W05t8YydDvVMEzkqXZZ7QJK';

// SAÍDA: pasta que o dashboard LÊ os relatórios (servirRelatorios.gs, "Relatorios
// EGov"). É aqui que o participantes.xlsx precisa ficar para aparecer no painel.
const RELATORIOS_ROOT_ID = '1F6omxUG5yYW84m7sVK0RweAO8ge5q27p';

// Subpasta, dentro da raiz de relatórios, onde ficam as pastas de evento (espelha
// o repositório). Deixe '' se as pastas de evento ficarem direto na raiz.
const RELATORIOS_SUBPATH = 'assets/docs/relatorios';

// eventos-meta.json publicado (de onde vem a DATA/HORA de cada evento).
const META_URL = 'https://egov-dashboard.vercel.app/assets/docs/relatorios/eventos-meta.json';

// Quantas horas após a data/hora do evento o participantes.xlsx deve ser gerado.
const HORAS_APOS_EVENTO = 3;

// Nome do arquivo gerado (o build do dashboard procura por *.xlsx; este é o padrão).
const NOME_SAIDA = 'participantes.xlsx';

// ============ ROTINA PRINCIPAL (gatilho de tempo) ============

function gerarParticipantesPendentes() {
  _processar(false);
}

// Força a geração de TODOS os eventos com Inscrição+Presentes, ignorando a
// janela de 3h e a verificação de "já está atualizado". Use para testar.
function gerarParticipantesAgora() {
  _processar(true);
}

function _processar(forcar) {
  const meta = _carregarMeta();
  const root = DriveApp.getFolderById(INSCRICOES_ROOT_ID);
  const pastas = [];
  _varrerPastas(root, '', pastas, 0);

  const agora = new Date();
  let gerados = 0, pulados = 0;

  for (let i = 0; i < pastas.length; i++) {
    const folder = pastas[i].folder; // pasta do evento na raiz de INSCRIÇÕES
    const rel = pastas[i].rel;        // caminho relativo (ex.: "ciclo.../turma 3")

    const insc = _acharArquivo(folder, _ehInscricao);
    if (!insc) continue; // pasta sem Inscrição não é evento

    // Pasta de SAÍDA correspondente na raiz de RELATÓRIOS (onde o dashboard lê).
    // Procura sem criar (para o teste de "já existe"); só cria na hora de gravar.
    const pastaSaidaExist = _navegarSaida(rel, false);
    const existente = pastaSaidaExist ? _acharSaida(pastaSaidaExist) : null;

    // Eventos que JÁ têm um participantes.xlsx COM DADOS (reais) não são regerados
    // — só geramos para os que estão sem arquivo ou com o placeholder vazio (o
    // arquivo só-cabeçalho criado para o evento aparecer na Visão Geral).
    if (existente && _temDados(existente)) { pulados++; continue; }

    const pres = _acharArquivo(folder, _ehPresente);
    if (!pres) { Logger.log('— %s: sem planilha "Presentes" (pulado).', rel); pulados++; continue; }

    // Janela de 3h: só gera depois de HORAS_APOS_EVENTO da data/hora do evento.
    if (!forcar) {
      const refEvento = _dataDoEvento(meta, rel, pres);
      if (!refEvento) { Logger.log('— %s: sem data do evento (meta/Presentes). Pulado.', rel); pulados++; continue; }
      const liberaEm = new Date(refEvento.getTime() + HORAS_APOS_EVENTO * 3600 * 1000);
      if (agora < liberaEm) { pulados++; continue; } // ainda não passaram as 3h
    }

    try {
      const destino = _navegarSaida(rel, true); // cria a árvore de pastas se faltar
      _gerarUm(destino, insc, pres, _acharSaida(destino));
      Logger.log('✓ %s: participantes.xlsx gerado em relatórios.', rel);
      gerados++;
    } catch (e) {
      Logger.log('✗ %s: %s', rel, (e && e.message) ? e.message : e);
    }
  }
  Logger.log('Concluído. Gerados: %s | Pulados: %s | Pastas: %s', gerados, pulados, pastas.length);
}

// Navega da raiz de RELATÓRIOS até a pasta de saída do evento (RELATORIOS_SUBPATH
// + rel). Com criar=true, cria as subpastas que faltarem; com false, devolve null
// se alguma não existir.
function _navegarSaida(rel, criar) {
  let folder = DriveApp.getFolderById(RELATORIOS_ROOT_ID);
  const partes = (RELATORIOS_SUBPATH ? RELATORIOS_SUBPATH + '/' + rel : rel)
    .split('/').map(function (s) { return s.trim(); }).filter(Boolean);
  for (let i = 0; i < partes.length; i++) {
    let sub = _acharSubpasta(folder, partes[i]);
    if (!sub) {
      if (!criar) return null;
      sub = folder.createFolder(partes[i]);
    }
    folder = sub;
  }
  return folder;
}

function _acharSubpasta(folder, nome) {
  const alvo = _norm(nome);
  const it = folder.getFolders();
  while (it.hasNext()) {
    const f = it.next();
    if (_norm(f.getName()) === alvo) return f;
  }
  return null;
}

// ============ GERAÇÃO DE UM EVENTO ============

function _gerarUm(folder, inscFile, presFile, existente) {
  // 1) Lê a Inscrição (base).
  const insc = _lerValores(inscFile);
  if (!insc.values.length) throw new Error('Inscrição vazia.');
  const inHeaders = insc.values[0].map(function (h) { return String(h).trim(); });
  const inIdx = _detectarColunas(inHeaders);

  // 2) Lê a Presentes e monta os índices de presença (por e-mail e por nome),
  //    guardando o carimbo (check-in) MAIS ANTIGO de cada pessoa.
  const presIdx = _indicePresenca(presFile);

  // 3) Monta o cabeçalho de saída: copia o da Inscrição, renomeia a coluna de
  //    carimbo para "Data de inscrição" e acrescenta "Check-in" + "Data de check-in".
  const outHeader = inHeaders.slice();
  if (inIdx.data >= 0) outHeader[inIdx.data] = 'Data de inscrição';
  outHeader.push('Check-in', 'Data de check-in');

  const out = [outHeader];

  // 4) Para cada inscrito, decide Check-in e Data de check-in.
  for (let r = 1; r < insc.values.length; r++) {
    const row = insc.values[r];
    const nome = inIdx.nome >= 0 ? String(row[inIdx.nome] || '').trim() : '';
    const email = inIdx.email >= 0 ? String(row[inIdx.email] || '').trim() : '';
    if (!nome && !email) continue; // linha vazia

    const carimbo = _checkinDe(presIdx, nome, email); // Date ou null
    const presente = !!carimbo;

    const novaLinha = row.slice();
    novaLinha.push(presente ? 'Sim' : 'Não');
    novaLinha.push(carimbo ? _fmtData(carimbo) : '');
    out.push(novaLinha);
  }

  // 5) Cria uma planilha temporária, escreve, exporta como .xlsx e salva na pasta.
  _salvarComoXlsx(folder, out, existente);
}

// Constrói índices de presença a partir da planilha Presentes.
// Retorna { byEmail: {normEmail: Date}, byName: {normNome: Date} } com o carimbo
// mais antigo de cada pessoa.
function _indicePresenca(presFile) {
  const dados = _lerValores(presFile);
  const byEmail = {}, byName = {};
  if (!dados.values.length) return { byEmail: byEmail, byName: byName };

  const headers = dados.values[0].map(function (h) { return String(h).trim(); });
  const idx = _detectarColunas(headers);

  for (let i = 1; i < dados.values.length; i++) {
    const row = dados.values[i];
    const nome = idx.nome >= 0 ? String(row[idx.nome] || '').trim() : '';
    const email = idx.email >= 0 ? String(row[idx.email] || '').trim() : '';
    if (!nome && !email) continue;
    const carimbo = idx.data >= 0 ? _comoData(row[idx.data]) : null;

    if (email) _guardarMaisAntigo(byEmail, _norm(email), carimbo);
    if (nome)  _guardarMaisAntigo(byName,  _norm(nome),  carimbo);
  }
  return { byEmail: byEmail, byName: byName };
}

// Presença de uma pessoa: bate por e-mail OU por nome. Devolve o carimbo (Date)
// — preferindo o do e-mail — ou null se ausente.
function _checkinDe(presIdx, nome, email) {
  const ke = email ? _norm(email) : '';
  const kn = nome ? _norm(nome) : '';
  if (ke && Object.prototype.hasOwnProperty.call(presIdx.byEmail, ke)) {
    return presIdx.byEmail[ke] || presIdx.byName[kn] || _SENTINELA_PRESENTE;
  }
  if (kn && Object.prototype.hasOwnProperty.call(presIdx.byName, kn)) {
    return presIdx.byName[kn] || _SENTINELA_PRESENTE;
  }
  return null;
}

// Presente mas sem carimbo legível (Presentes sem coluna de data/hora). Marca
// "Sim" mesmo assim; a Data de check-in fica vazia.
var _SENTINELA_PRESENTE = 'presente';

function _guardarMaisAntigo(map, chave, carimbo) {
  if (!chave) return;
  if (!Object.prototype.hasOwnProperty.call(map, chave)) { map[chave] = carimbo || null; return; }
  const atual = map[chave];
  if (carimbo && (!atual || (atual instanceof Date && carimbo < atual))) map[chave] = carimbo;
}

// ============ EXPORTAÇÃO PARA .XLSX ============

function _salvarComoXlsx(folder, aoa, existente) {
  // Cria planilha temporária, escreve a matriz e exporta como xlsx.
  const tmp = SpreadsheetApp.create('tmp_participantes_' + Utilities.getUuid().slice(0, 8));
  const tmpId = tmp.getId();
  try {
    const sheet = tmp.getSheets()[0];
    sheet.setName('Lista de participantes');
    const nLin = aoa.length;
    const nCol = aoa.reduce(function (m, r) { return Math.max(m, r.length); }, 1);
    // Normaliza largura das linhas (setValues exige matriz retangular).
    const matriz = aoa.map(function (r) {
      const c = r.slice();
      while (c.length < nCol) c.push('');
      return c;
    });
    sheet.getRange(1, 1, nLin, nCol).setValues(matriz);
    SpreadsheetApp.flush();

    const url = 'https://docs.google.com/spreadsheets/d/' + tmpId + '/export?format=xlsx';
    const resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    });
    if (resp.getResponseCode() !== 200) {
      throw new Error('Falha ao exportar xlsx (HTTP ' + resp.getResponseCode() + ').');
    }
    const blob = resp.getBlob().setName(NOME_SAIDA);

    // Substitui o arquivo anterior (se houver) para não duplicar.
    if (existente) existente.setTrashed(true);
    folder.createFile(blob);
  } finally {
    DriveApp.getFileById(tmpId).setTrashed(true);
  }
}

// ============ DATA DO EVENTO (janela de 3h) ============

function _carregarMeta() {
  try {
    const resp = UrlFetchApp.fetch(META_URL, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return {};
    const json = JSON.parse(resp.getContentText());
    return (json && json.eventos) || {};
  } catch (e) {
    return {};
  }
}

// Data/hora de referência do evento: tenta o eventos-meta.json (chave
// "<pasta>/participantes.xlsx"); se não houver, usa o ÚLTIMO check-in da Presentes.
function _dataDoEvento(meta, rel, presFile) {
  const m = meta[rel + '/' + NOME_SAIDA];
  if (m && m.date) {
    const d = _parseDataHora(m.date, m.time);
    if (d) return d;
  }
  // Fallback: último carimbo da planilha Presentes.
  try {
    const dados = _lerValores(presFile);
    if (dados.values.length > 1) {
      const idx = _detectarColunas(dados.values[0].map(function (h) { return String(h).trim(); }));
      if (idx.data >= 0) {
        let ult = null;
        for (let i = 1; i < dados.values.length; i++) {
          const d = _comoData(dados.values[i][idx.data]);
          if (d && (!ult || d > ult)) ult = d;
        }
        if (ult) return ult;
      }
    }
  } catch (e) {}
  return null;
}

// "2026-06-16" + "09h30" / "09h" / "14h" / "" -> Date (hora padrão: 12:00).
function _parseDataHora(dateStr, timeStr) {
  const md = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!md) return null;
  let hh = 12, mm = 0;
  const mt = String(timeStr || '').match(/(\d{1,2})\s*[h:]\s*(\d{2})?/i);
  if (mt) { hh = parseInt(mt[1], 10); mm = mt[2] ? parseInt(mt[2], 10) : 0; }
  return new Date(parseInt(md[1], 10), parseInt(md[2], 10) - 1, parseInt(md[3], 10), hh, mm, 0);
}

// ============ VARREDURA / LEITURA (Drive + Sheets) ============

// Varre recursivamente acumulando { folder, rel } de cada pasta (o caminho rel
// relativo à raiz é o mesmo que o dashboard usa, ex.: "mapa.../turma 1").
function _varrerPastas(folder, prefixo, out, depth) {
  if (depth > 25) return;
  out.push({ folder: folder, rel: prefixo });
  const subs = folder.getFolders();
  while (subs.hasNext()) {
    const sub = subs.next();
    const novo = prefixo ? prefixo + '/' + sub.getName() : sub.getName();
    _varrerPastas(sub, novo, out, depth + 1);
  }
}

function _lerValores(file) {
  const ss = SpreadsheetApp.openById(file.getId());
  const sheet = ss.getSheets()[0];
  return { values: sheet.getDataRange().getValues() };
}

// Acha colunas de carimbo (data), e-mail e nome pelos cabeçalhos.
function _detectarColunas(headers) {
  let data = -1, email = -1, nome = -1, nomeCompleto = -1;
  for (let i = 0; i < headers.length; i++) {
    const h = _norm(headers[i]);
    if (data < 0 && (h.indexOf('carimbo de data') >= 0 || h === 'timestamp' || h.indexOf('data/hora') >= 0 || h.indexOf('data de inscricao') >= 0)) data = i;
    if (email < 0 && (h.indexOf('e-mail') >= 0 || h.indexOf('email') >= 0 || h.indexOf('mail') >= 0)) email = i;
    if (h.indexOf('nome completo') >= 0) nomeCompleto = i;
    if (nome < 0 && h.indexOf('nome') >= 0) nome = i;
  }
  if (nomeCompleto >= 0) nome = nomeCompleto;
  return { data: data, email: email, nome: nome };
}

function _acharArquivo(folder, pred) {
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getMimeType() === MimeType.GOOGLE_SHEETS && pred(f.getName())) return f;
  }
  return null;
}

// Arquivo de saída já existente (xlsx) cujo nome começa com "participantes".
function _acharSaida(folder) {
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const n = _norm(f.getName());
    if (n.indexOf('participantes') === 0 && n.slice(-5) === '.xlsx') return f;
  }
  return null;
}

// Diz se um participantes.xlsx tem DADOS (mais que o cabeçalho). Converte o .xlsx
// numa planilha Google temporária e olha o nº de linhas. Requer o "Drive API"
// (Serviço avançado) habilitado no projeto. Em caso de erro, age CONSERVADOR e
// devolve true (não sobrescreve um arquivo que pode ter dados reais).
function _temDados(xlsxFile) {
  var tmpId = null;
  try {
    const blob = xlsxFile.getBlob();
    const meta = { title: 'tmp_chk_' + Utilities.getUuid().slice(0, 8), mimeType: MimeType.GOOGLE_SHEETS };
    const conv = Drive.Files.insert(meta, blob, { convert: true });
    tmpId = conv.id;
    const ss = SpreadsheetApp.openById(tmpId);
    return ss.getSheets()[0].getLastRow() > 1;
  } catch (e) {
    Logger.log('  ! _temDados falhou (%s) — assumindo que tem dados.', (e && e.message) ? e.message : e);
    return true;
  } finally {
    if (tmpId) { try { DriveApp.getFileById(tmpId).setTrashed(true); } catch (e2) {} }
  }
}

function _ehInscricao(nome) { return _norm(nome).indexOf('inscri') === 0; }
function _ehPresente(nome) { return _norm(nome).indexOf('presente') === 0; }

// ============ HELPERS ============

function _norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function _comoData(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v || '').trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function _fmtData(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
  }
  return ''; // sentinela "presente" (sem carimbo) -> Data de check-in vazia
}

// ============ GATILHO ============

// Instala (uma vez) um gatilho de tempo que roda de hora em hora.
function instalarGatilho() {
  const existentes = ScriptApp.getProjectTriggers();
  for (let i = 0; i < existentes.length; i++) {
    if (existentes[i].getHandlerFunction() === 'gerarParticipantesPendentes') {
      ScriptApp.deleteTrigger(existentes[i]);
    }
  }
  ScriptApp.newTrigger('gerarParticipantesPendentes').timeBased().everyHours(1).create();
  Logger.log('Gatilho instalado: gerarParticipantesPendentes a cada 1 hora.');
}
