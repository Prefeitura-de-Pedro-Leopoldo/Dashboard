// Build: lê todas as planilhas .xlsx em assets/docs/relatorios/, padroniza,
// e gera eventos-data.json (raiz) + manifest.json (relatorios/).
// Roda em `npm run build` e no Vercel.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RELATORIOS_DIR = path.join(ROOT, "assets", "docs", "relatorios");
const META_PATH = path.join(RELATORIOS_DIR, "eventos-meta.json");
const OUT_JSON = path.join(ROOT, "eventos-data.json");
const OUT_MANIFEST = path.join(RELATORIOS_DIR, "manifest.json");

const COLUNAS_ESPERADAS = [
  "nome", "email", "secretaria", "cargo", "matrícula", "turma",
  "check-in", "data de inscrição", "data de check-in",
];

// Mapa de normalização de Secretarias. As chaves são fragmentos buscados
// no texto normalizado (sem acentos, minúsculo, contains) - a primeira chave
// que bater define a Secretaria canônica.
//
// Ordem importa: chaves mais específicas devem vir ANTES das genéricas
// (ex.: "vice" antes de "gabinete"; "chefia de gabinete" antes de "gabinete").
const SECRETARIA_MAP = [
  // ===== Gabinete / Vice / Chefia =====
  [["vice-prefeito", "vice prefeito", "gabinete do vice"], "Gabinete do Vice-Prefeito"],
  [["chefia de gabinete"], "Chefia de Gabinete"],
  [["gabinete do prefeito", "gabinete prefeito"], "Gabinete do Prefeito"],

  // ===== Governo (inclui assessoria executiva, SATD, comunicação institucional) =====
  [
    [
      " governo ", "secretaria de governo", "secretaria municipal de governo", "smg",
      "assessoria executiva", "ase ", " ase", "ase,", "satd",
      "comunicacao institucional", "comunicacao social"
    ],
    "Secretaria Municipal de Governo"
  ],

  // ===== Controladoria =====
  [["controladoria", "cgm", "auditoria interna"], "Controladoria Geral do Município"],

  // ===== Gestão e Finanças (SMGF / DIRGEP / Patrimônio / Protocolo / Receitas) =====
  [
    [
      "gestao e financas", "gestao e administracao", "gestao financas",
      "gertao e financas", "smgf", "gefin", "saga", "transformacao digital",
      "dirgep", "dirgerp", "digerp", "diretoria de gestao de pessoas",
      "diretoria de pessoas", "dca ",
      "arquivo e patrimonio", "patrimonio", "almoxarifado",
      "protocolo", "compras", "licitacao", "pregao",
      "tributos", "tributaria", "divida ativa", "cadastro de imoveis",
      "iptu", "receita municipal", "tesouraria", "contabilidade",
      "tecnologia da informacao", " ti "
    ],
    "Secretaria Municipal de Gestão e Finanças"
  ],

  // ===== Educação =====
  [
    [
      "educacao", "smed", "escola municipal", "creche", "cmei",
      "ensino fundamental", "ensino infantil"
    ],
    "Secretaria Municipal de Educação"
  ],

  // ===== Saúde (todas as unidades: HMFG, PA, CAPS, ESF, UBS, vigilância) =====
  [
    [
      "saude", "saúde", "sms ", "ses", "secretaria municipal de saude",
      "hospital municipal", "hmfg", "francisco goncal",
      "pa central", "pa lagoa", "pronto atendimento", "pronto-atendimento",
      "caps ", "centro de atencao psicossocial",
      "esf ", "estrategia saude da familia",
      "ubs ", "unidade basica de saude", "posto de saude",
      "vigilancia em saude", "vigilancia sanitaria", "vigilancia epidemiologica",
      "samu", "siate", "farmacia municipal", "cemai", "epidemiologia",
      "saude mental", "secretaria de saude"
    ],
    "Secretaria Municipal de Saúde"
  ],

  // ===== Desenvolvimento Social (CRAS, CREAS, Casa da Cidadania) =====
  [
    [
      "desenvolvimento social", "smds", "assistencia social",
      "cras", "creas", "centro pop", "casa da cidadania",
      "abrigo institucional", "conselho tutelar"
    ],
    "Secretaria Municipal de Desenvolvimento Social"
  ],

  // ===== Desenvolvimento Econômico =====
  [
    [
      "desenvolvimento economico", "smde", "agricultura", "turismo",
      "trabalho e renda", "industria e comercio"
    ],
    "Secretaria Municipal de Desenvolvimento Econômico"
  ],

  // ===== Bem Estar (Esporte, Cultura, Lazer, Juventude) =====
  [
    [
      "bem estar", "bem-estar", "esporte", "esportes", "lazer",
      "juventude", "cultura", "biblioteca municipal", "teatro municipal"
    ],
    "Secretaria Municipal de Bem Estar"
  ],

  // ===== Meio Ambiente =====
  [["meio ambiente", "smma"], "Secretaria Municipal de Meio Ambiente"],

  // ===== Obras e Serviços Públicos =====
  [
    [
      "obras", "servicos publicos", "limpeza urbana", "iluminacao publica",
      "manutencao urbana", "engenharia"
    ],
    "Secretaria Municipal de Obras"
  ],

  // ===== Segurança Pública =====
  [
    [
      "seguranca publica", "seguranca", "guarda municipal", "defesa civil",
      "transito", "trânsito"
    ],
    "Secretaria Municipal de Segurança Pública"
  ],
];

const stripAccents = (s) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");

export const slugify = (s) =>
  stripAccents(s).toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

// Tenta encaixar uma string única em uma das Secretarias canônicas.
function matchSecretariaCanon(value) {
  if (!value) return null;
  const s = String(value).trim().replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (!s) return null;
  // padding com espaços para que chaves curtas como " ase " / " ti " só batam
  // como palavra isolada (evita "ti" pegar "assistente", por exemplo).
  const key = " " + stripAccents(s).toLowerCase().replace(/\s+/g, " ") + " ";
  for (const [chaves, canon] of SECRETARIA_MAP) {
    if (chaves.some((c) => key.includes(c))) return canon;
  }
  return null;
}

// Normaliza Secretaria. Aceita opcionalmente a Lotação como fallback -
// útil quando a coluna Secretaria está vazia ou contém só uma sigla local
// ("CGM", "GEFIN", "SATD") e a Lotação ("Caps Livremente", "PA Central",
// "DIRGEP") revela a Secretaria real. Estratégia:
//   1. Tenta casar Secretaria com o mapa canônico.
//   2. Se não casar, tenta casar Lotação com o mapa canônico.
//   3. Se nenhuma casar, devolve a Secretaria em Title Case (ou Lotação,
//      ou null) para o relatório de inconsistências.
function normalizeSecretaria(secretaria, lotacao) {
  const canonSec = matchSecretariaCanon(secretaria);
  if (canonSec) return canonSec;
  const canonLot = matchSecretariaCanon(lotacao);
  if (canonLot) return canonLot;
  const raw = (secretaria && String(secretaria).trim()) || (lotacao && String(lotacao).trim()) || "";
  if (!raw) return null;
  return raw.replace(/\S+/g, (w) =>
    w.length > 2 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()
  );
}

function parseExcelDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === "number") {
    // Excel serial -> Date (UTC then trate como local)
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return new Date(d.y, d.m - 1, d.d, d.H || 0, d.M || 0, Math.floor(d.S || 0));
  }
  const s = String(v).trim();
  if (!s) return null;
  // Formatos comuns: "2026-04-24 08:43:44" ou "2026-04-24T08:43:44" ou "24/04/2026 08:43"
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +(m[6]||0));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2]-1, +m[3]);
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return new Date(+m[3], +m[2]-1, +m[1], +(m[4]||0), +(m[5]||0), +(m[6]||0));
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function isoLocal(d) {
  if (!d) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function isoDate(d) {
  if (!d) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function detectHeaderRow(rows) {
  // Procura linha cujos textos cubram a maior parte de COLUNAS_ESPERADAS.
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const cells = (rows[i] || []).map((c) =>
      stripAccents(String(c || "")).toLowerCase().trim()
    );
    if (!cells.length) continue;
    const score = COLUNAS_ESPERADAS.filter((col) =>
      cells.some((c) => c === col || c.startsWith(col) || c.includes(col))
    ).length;
    if (score >= 5) return i;
    // Compat: aceita planilha que tenha "ordem de inscrição"
    if (cells.some((c) => c.includes("ordem de"))) return i;
  }
  return -1;
}

function mapHeader(headerRow) {
  const norm = headerRow.map((h) =>
    stripAccents(String(h || "")).toLowerCase().trim()
  );
  const find = (...needles) => {
    for (let i = 0; i < norm.length; i++) {
      for (const n of needles) {
        if (norm[i] === n || norm[i].startsWith(n) || norm[i].includes(n)) return i;
      }
    }
    return -1;
  };
  // findExact: bate a célula inteira (após startsWith) só para evitar que
  // "check-in" engula "check-in m1" e vice-versa.
  const findExactStart = (needle) => {
    for (let i = 0; i < norm.length; i++) {
      if (norm[i] === needle) return i;
    }
    return -1;
  };
  return {
    nome:        find("nome completo", "nome"),
    sobrenome:   find("sobrenome"),
    email:       find("e-mail", "email"),
    secretaria:  find("secretaria"),
    lotacao:     find("lotacao", "lotação", "setor", "departamento"),
    cargo:       find("cargo/funcao", "cargo/função", "cargo", "funcao", "função"),
    matricula:   find("matricula", "matrícula"),
    turma:       find("tipo de ingresso", "turma"),
    checkin:     findExactStart("check-in") >= 0 ? findExactStart("check-in") : find("check in", "checkin", "presente"),
    checkinM1:   findExactStart("check-in m1"),
    checkinM2:   findExactStart("check-in m2"),
    apto:        findExactStart("apto"),
    dataInsc:    find("data de inscricao", "data de inscrição", "inscricao", "inscrição"),
    dataCheck:   findExactStart("data de check-in") >= 0 ? findExactStart("data de check-in") : find("data check-in", "check-in em"),
    dataCheckM1: findExactStart("data de check-in m1"),
    dataCheckM2: findExactStart("data de check-in m2"),
  };
}

function isLinhaRodape(nome) {
  const n = (nome || "").trim().toLowerCase();
  return !n || n.startsWith("*") || n.startsWith("exportado em") ||
         n.includes("horário de brasília") || n.includes("horario de brasilia");
}

// Alguns exports (notavelmente do LibreOffice) gravam um `dimension ref`
// truncado - só a primeira coluna -, o que faz o SheetJS ignorar todas as
// outras. Recalcula o range a partir das células reais para recuperar os dados.
function fixSheetRange(sheet) {
  if (!sheet || !sheet["!ref"]) return;
  let maxCol = 0, maxRow = 0;
  for (const k of Object.keys(sheet)) {
    if (k.startsWith("!")) continue;
    const a = XLSX.utils.decode_cell(k);
    if (a.c > maxCol) maxCol = a.c;
    if (a.r > maxRow) maxRow = a.r;
  }
  const declared = XLSX.utils.decode_range(sheet["!ref"]);
  if (maxCol > declared.e.c || maxRow > declared.e.r) {
    sheet["!ref"] = XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: maxCol, r: maxRow } });
  }
}

function parsePlanilha(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  return parsePlanilhaFromWorkbook(wb);
}

export function parsePlanilhaFromWorkbook(wb) {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("Planilha sem aba.");
  fixSheetRange(sheet);
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  const headerIdx = detectHeaderRow(rows);
  if (headerIdx < 0) {
    throw new Error(
      `Cabeçalho não reconhecido. Esperado colunas: ${COLUNAS_ESPERADAS.join(", ")}.`
    );
  }
  const cols = mapHeader(rows[headerIdx]);
  if (cols.nome < 0) throw new Error("Coluna 'Nome' não encontrada.");

  const temColCheckin = cols.checkin >= 0;
  const temModulos = cols.checkinM1 >= 0 && cols.checkinM2 >= 0;
  const isSim = (v) => ["sim", "yes", "true", "1", "presente"].includes(
    String(v ?? "").trim().toLowerCase()
  );

  const participantes = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (!r.some((v) => String(v ?? "").trim())) continue;
    let nome = String(r[cols.nome] ?? "").trim();
    if (cols.sobrenome >= 0) {
      const sb = String(r[cols.sobrenome] ?? "").trim();
      if (sb) nome = (nome + " " + sb).trim();
    }
    if (isLinhaRodape(nome)) continue;

    const presenteM1 = temModulos ? isSim(r[cols.checkinM1]) : null;
    const presenteM2 = temModulos ? isSim(r[cols.checkinM2]) : null;
    const aptoExplicito = cols.apto >= 0 ? isSim(r[cols.apto]) : null;
    // Em planilhas com módulos, presente/apto = M1 ∩ M2 (ou coluna explícita).
    // Em planilhas tradicionais, mantém a coluna Check-in.
    const presente = temModulos
      ? (aptoExplicito !== null ? aptoExplicito : (presenteM1 && presenteM2))
      : (temColCheckin ? isSim(r[cols.checkin]) : true);

    const dataInsc   = cols.dataInsc   >= 0 ? parseExcelDate(r[cols.dataInsc])   : null;
    const dataCheck  = cols.dataCheck  >= 0 ? parseExcelDate(r[cols.dataCheck])  : null;
    const dataCheckM1 = cols.dataCheckM1 >= 0 ? parseExcelDate(r[cols.dataCheckM1]) : null;
    const dataCheckM2 = cols.dataCheckM2 >= 0 ? parseExcelDate(r[cols.dataCheckM2]) : null;

    participantes.push({
      nome,
      email: cols.email >= 0 ? String(r[cols.email] ?? "").trim() || null : null,
      turma: cols.turma >= 0 ? (String(r[cols.turma] ?? "").trim() || null) : null,
      secretaria: normalizeSecretaria(
        cols.secretaria >= 0 ? r[cols.secretaria] : null,
        cols.lotacao    >= 0 ? r[cols.lotacao]    : null
      ),
      // Lotação preservada como veio na planilha - pode revelar a unidade real
      // (PA Central, CAPS, DIRGEP, etc.) e ser útil para análises futuras.
      lotacao: cols.lotacao >= 0 ? (String(r[cols.lotacao] ?? "").trim() || null) : null,
      cargo: cols.cargo >= 0 ? (String(r[cols.cargo] ?? "").trim() || null) : null,
      matricula: cols.matricula >= 0 ? (String(r[cols.matricula] ?? "").trim() || null) : null,
      pagamento: null,
      presente,
      apto: temModulos ? presente : null,
      presenteM1,
      presenteM2,
      dataCheckin: isoLocal(temModulos ? (dataCheckM2 || dataCheckM1) : dataCheck),
      dataCheckinM1: isoLocal(dataCheckM1),
      dataCheckinM2: isoLocal(dataCheckM2),
      dataInscricao: isoLocal(dataInsc),
    });
  }
  return participantes;
}

export function buildEvento(arquivo, meta, participantes) {
  const totalInscritos = participantes.length;
  const presentes = participantes.filter((p) => p.presente);
  const totalPresentes = presentes.length;
  const totalAusentes = totalInscritos - totalPresentes;
  const taxaPresenca = totalInscritos
    ? Math.round((totalPresentes / totalInscritos) * 1000) / 10
    : 0;

  const tally = (arr, keyFn) => {
    const out = {};
    for (const p of arr) {
      const k = keyFn(p);
      if (!k) continue;
      out[k] = (out[k] || 0) + 1;
    }
    // Ordena desc por contagem
    return Object.fromEntries(
      Object.entries(out).sort((a, b) => b[1] - a[1])
    );
  };
  const secretarias = tally(participantes, (p) => p.secretaria);
  const secretariasPresentes = tally(presentes, (p) => p.secretaria);
  let turmas = tally(participantes, (p) => p.turma);
  let turmasPresentes = tally(presentes, (p) => p.turma);

  // Suporte a eventos multi-módulo: se a planilha tem colunas Check-in M1/M2,
  // expõe stats por módulo e usa-os como "turmas" no gráfico
  // (para reusar o pie/bar de turmas como pie/bar de módulos).
  const temModulosData = participantes.some(
    (p) => p.presenteM1 !== null && p.presenteM1 !== undefined
  );
  let modulos = null;
  let totalAptos = totalPresentes;
  if (temModulosData) {
    const presentesM1 = participantes.filter((p) => p.presenteM1).length;
    const presentesM2 = participantes.filter((p) => p.presenteM2).length;
    totalAptos = participantes.filter((p) => p.apto).length;
    modulos = {
      M1: {
        label: (meta.modulos && meta.modulos[0] && meta.modulos[0].label) || "Módulo 1",
        date: (meta.modulos && meta.modulos[0] && meta.modulos[0].date) || null,
        presentes: presentesM1,
        ausentes: totalInscritos - presentesM1,
        taxaPresenca: totalInscritos
          ? Math.round((presentesM1 / totalInscritos) * 1000) / 10 : 0,
      },
      M2: {
        label: (meta.modulos && meta.modulos[1] && meta.modulos[1].label) || "Módulo 2",
        date: (meta.modulos && meta.modulos[1] && meta.modulos[1].date) || null,
        presentes: presentesM2,
        ausentes: totalInscritos - presentesM2,
        taxaPresenca: totalInscritos
          ? Math.round((presentesM2 / totalInscritos) * 1000) / 10 : 0,
      },
    };
    // Sobrescreve turmas/turmasPresentes para o dashboard exibir módulos.
    turmas = { [modulos.M1.label]: totalInscritos, [modulos.M2.label]: totalInscritos };
    turmasPresentes = {
      [modulos.M1.label]: presentesM1,
      [modulos.M2.label]: presentesM2,
    };
  }

  const tlInsc = {};
  for (const p of participantes) {
    if (!p.dataInscricao) continue;
    const d = p.dataInscricao.slice(0, 10);
    tlInsc[d] = (tlInsc[d] || 0) + 1;
  }
  const timelineInscricoes = Object.entries(tlInsc).sort((a, b) => a[0].localeCompare(b[0]));

  const tlChk = {};
  for (const p of presentes) {
    if (!p.dataCheckin) continue;
    const k = p.dataCheckin.slice(0, 13).replace("T", " ");
    tlChk[k] = (tlChk[k] || 0) + 1;
  }
  const timelineCheckins = Object.entries(tlChk).sort((a, b) => a[0].localeCompare(b[0]));

  // Status: data FUTURA → "agendado" (ainda vai acontecer, mesmo com inscritos
  // pré-lançados). Caso contrário → "realizado" se houve inscritos/presença.
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dataEv = meta.date ? new Date(meta.date + "T00:00:00") : null;
  const futuro = dataEv && !isNaN(dataEv) && dataEv > hoje;
  const status = futuro
    ? "agendado"
    : totalPresentes > 0 || totalInscritos > 0 ? "realizado" : "agendado";

  const vagas = meta.vagas ?? totalInscritos;
  // Ocupação = Inscritos / Vagas oferecidas — quanto da capacidade foi preenchido.
  const taxaOcupacao = vagas > 0
    ? Math.round((totalInscritos / vagas) * 1000) / 10
    : 0;

  return {
    id: meta.id,
    title: meta.title,
    cargaHoraria: meta.cargaHoraria ?? null,
    date: meta.date || null,
    dateFim: meta.dateFim || null,
    dateRaw: meta.dateRaw || meta.date || null,
    time: meta.time || "",
    local: meta.local || "",
    city: meta.city || "",
    status,
    totalInscritos,
    totalAprovados: totalInscritos,
    totalPresentes,
    totalAusentes,
    totalAptos,
    taxaPresenca,
    modulos,
    turmas,
    turmasPresentes,
    secretarias,
    secretariasPresentes,
    timelineInscricoes,
    timelineCheckins,
    participantes,
    vagas,
    taxaOcupacao,
    fonte: arquivo,
    grupo: meta.grupo || null,
  };
}

export function buildResumo(eventos) {
  const totalEventos = eventos.length;
  const eventosRealizados = eventos.filter((e) => e.status === "realizado").length;
  const eventosAgendados = totalEventos - eventosRealizados;
  const totalInscritos = eventos.reduce((s, e) => s + e.totalInscritos, 0);
  const totalPresentes = eventos.reduce((s, e) => s + e.totalPresentes, 0);
  const totalAusentes = totalInscritos - totalPresentes;
  const totalVagas = eventos.reduce((s, e) => s + (e.vagas || 0), 0);
  const taxaPresencaGlobal = totalInscritos
    ? Math.round((totalPresentes / totalInscritos) * 1000) / 10 : 0;
  // Ocupação = Inscritos / Vagas oferecidas.
  const taxaOcupacaoGlobal = totalVagas > 0
    ? Math.round((totalInscritos / totalVagas) * 1000) / 10 : 0;

  const ranking = {};
  for (const e of eventos) {
    for (const [sec, n] of Object.entries(e.secretarias || {})) {
      ranking[sec] = (ranking[sec] || 0) + n;
    }
  }
  const rankingSecretarias = Object.fromEntries(
    Object.entries(ranking).sort((a, b) => b[1] - a[1])
  );

  return {
    totalEventos,
    eventosRealizados,
    eventosAgendados,
    totalInscritos,
    totalPresentes,
    totalAusentes,
    totalVagas,
    taxaPresencaGlobal,
    taxaOcupacaoGlobal,
    rankingSecretarias,
  };
}

function listarPlanilhas(dir) {
  // Varre recursivamente o diretório de relatórios e devolve caminhos
  // relativos a `dir` (com separador "/") para todo .xlsx de participantes.
  // Ignora _originais/ e arquivos de pesquisa/satisfação (qualquer grafia,
  // com ou sem acento) e lock files do Excel.
  const normalize = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const resultado = [];
  const walk = (sub) => {
    const full = path.join(dir, sub);
    for (const ent of fs.readdirSync(full, { withFileTypes: true })) {
      if (ent.name.startsWith(".") || ent.name === "_originais") continue;
      const rel = sub ? `${sub}/${ent.name}` : ent.name;
      if (ent.isDirectory()) { walk(rel); continue; }
      if (!ent.name.toLowerCase().endsWith(".xlsx")) continue;
      const base = normalize(ent.name);
      if (base.startsWith("~$")) continue;
      if (base.startsWith("satisfacao") || base.startsWith("pesquisa")) continue;
      resultado.push(rel.replace(/\\/g, "/"));
    }
  };
  walk("");
  return resultado.sort();
}

function main() {
  const meta = JSON.parse(fs.readFileSync(META_PATH, "utf-8")).eventos || {};
  const arquivos = listarPlanilhas(RELATORIOS_DIR);

  if (!arquivos.length) {
    console.warn(`[build-data] Nenhuma planilha em ${RELATORIOS_DIR}.`);
  }

  const eventos = [];
  const erros = [];
  for (const arquivo of arquivos) {
    const filePath = path.join(RELATORIOS_DIR, arquivo);
    try {
      const m = meta[arquivo] || {};
      // Planilha marcada como ignore no eventos-meta.json (ex.: arquivo legado
      // já consolidado em outra turma). Não vira evento nem entra no manifest.
      if (m.ignore) {
        console.log(`[build-data] ⏭ Ignorando "${arquivo}" (ignore=true no eventos-meta.json).`);
        continue;
      }
      const defaults = {
        id: slugify(arquivo.replace(/\.xlsx$/i, "").replace(/\//g, "-")),
        title: arquivo.replace(/\.xlsx$/i, "").replace(/\//g, " · "),
      };
      const eventoMeta = { ...defaults, ...m };
      if (!meta[arquivo]) {
        console.warn(`[build-data] ⚠ Sem metadata para "${arquivo}". Usando defaults derivados do nome do arquivo. Adicione uma entrada em eventos-meta.json.`);
      }
      const participantes = parsePlanilha(filePath);
      eventos.push(buildEvento(arquivo, eventoMeta, participantes));
      console.log(`[build-data] ✓ ${arquivo} → ${participantes.length} participantes (${eventoMeta.id})`);
    } catch (err) {
      // Cabeçalho não reconhecido = arquivo não é lista de participantes
      // (ex.: export de Google Forms). Pula com aviso, não trava o build.
      if (/Cabeçalho não reconhecido/.test(err.message)) {
        console.warn(`[build-data] ⚠ Pulando "${arquivo}": ${err.message}`);
        continue;
      }
      erros.push(`${arquivo}: ${err.message}`);
      console.error(`[build-data] ✗ ${arquivo}: ${err.message}`);
    }
  }
  if (erros.length) {
    console.error(`\n[build-data] Falhou em ${erros.length} planilha(s). Corrija o formato antes de publicar.`);
    process.exit(1);
  }

  // Ordena por data desc (eventos sem data ao final)
  eventos.sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return 0;
  });

  const out = {
    geradoEm: new Date().toISOString(),
    fonte: "assets/docs/relatorios/**/*.xlsx",
    eventos,
    resumo: buildResumo(eventos),
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + "\n", "utf-8");
  console.log(`[build-data] eventos-data.json escrito (${eventos.length} eventos).`);

  const manifest = {
    geradoEm: new Date().toISOString(),
    fonte: "assets/docs/relatorios/**/*.xlsx",
    planilhas: eventos.map((e) => ({
      id: e.id,
      arquivo: e.fonte,
      titulo: (meta[e.fonte] && meta[e.fonte].tituloCurto) || e.title,
    })),
  };
  fs.writeFileSync(OUT_MANIFEST, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  console.log(`[build-data] manifest.json escrito (${manifest.planilhas.length} planilhas).`);
}

// Só roda o build quando executado diretamente (node scripts/build-data.mjs),
// não quando importado por api/eventos.js.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
