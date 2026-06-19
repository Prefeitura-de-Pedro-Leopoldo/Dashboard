// Normalizador de planilhas de participantes.
//
// Varre assets/docs/relatorios/**/participantes.xlsx (ignora _originais,
// satisfação e arquivos auxiliares) e reescreve cada uma no formato canônico:
//
//   Schema A (com módulos):
//     Nome | Email | Secretaria | Cargo/Função | Matrícula | Turma |
//     Check-in | Check-in M1 | Check-in M2 | Apto |
//     Data de Inscrição | Data de Check-in M1 | Data de Check-in M2
//
//   Schema B (check-in simples):
//     Nome | Email | Secretaria | Cargo/Função | Matrícula | Turma |
//     Check-in | Data de Inscrição | Data de Check-in
//
// A escolha A/B é feita pelo eventos-meta.json: se a entrada do arquivo tem
// "modulos": [...], usa Schema A; caso contrário, Schema B.
//
// Transformações aplicadas:
//   • Junta Nome + Sobrenome em uma coluna (Title Case respeitando
//     preposições "de/da/do/dos/das/e/di/du/del/la/le").
//   • Normaliza Secretaria contra um mapa canônico, usando Lotação como
//     fallback quando a Secretaria está vazia ou contém só sigla.
//   • Converte datas (serial Excel ou string) para "YYYY-MM-DD HH:MM:SS".
//   • Descarta colunas extras (CPF, telefone, UTM_*, etc.).
//   • Insere autofilter na faixa completa.
//   • Sheet "Lista de participantes".
//
// Idempotente: rodar várias vezes não muda mais nada depois da 1ª passada.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RELATORIOS_DIR = path.join(ROOT, "assets", "docs", "relatorios");
const META_PATH = path.join(RELATORIOS_DIR, "eventos-meta.json");

// ---------- Schemas ----------
const HEADER_A = [
  "Nome", "Email", "Secretaria", "Cargo/Função", "Matrícula", "Turma",
  "Check-in", "Check-in M1", "Check-in M2", "Apto",
  "Data de Inscrição", "Data de Check-in M1", "Data de Check-in M2",
];

const HEADER_B = [
  "Nome", "Email", "Secretaria", "Cargo/Função", "Matrícula", "Turma",
  "Check-in", "Data de Inscrição", "Data de Check-in",
];

// ---------- Helpers genéricos ----------
const stripAccents = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");

const LOWER_NAME = new Set([
  "de", "da", "do", "dos", "das", "e",
  "di", "du", "del", "la", "le",
]);

function titleCaseName(s) {
  if (!s) return "";
  return String(s).trim().toLowerCase().split(/\s+/).map((w, i) => {
    if (i > 0 && LOWER_NAME.has(w)) return w;
    if (!w.length) return w;
    return w[0].toUpperCase() + w.slice(1);
  }).join(" ");
}

// Conserta exports do LibreOffice com `dimension ref` truncado (só coluna A).
function fixSheetRange(sheet) {
  if (!sheet || !sheet["!ref"]) return;
  let mc = 0, mr = 0;
  for (const k of Object.keys(sheet)) {
    if (k.startsWith("!")) continue;
    const a = XLSX.utils.decode_cell(k);
    if (a.c > mc) mc = a.c;
    if (a.r > mr) mr = a.r;
  }
  const d = XLSX.utils.decode_range(sheet["!ref"]);
  if (mc > d.e.c || mr > d.e.r) {
    sheet["!ref"] = XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: mc, r: mr } });
  }
}

function fmtDate(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date) {
    if (isNaN(v)) return "";
    const p = (n) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
  }
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return "";
    const p = (n) => String(n).padStart(2, "0");
    return `${d.y}-${p(d.m)}-${p(d.d)} ${p(d.H || 0)}:${p(d.M || 0)}:${p(Math.floor(d.S || 0))}`;
  }
  // Strings: normaliza alguns formatos comuns, senão devolve como veio
  const s = String(v).trim();
  if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6] || "00"}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} 00:00:00`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]} ${m[4] || "00"}:${m[5] || "00"}:${m[6] || "00"}`;
  return s;
}

const isSimVal = (v) =>
  ["sim", "yes", "true", "1", "presente"].includes(String(v ?? "").trim().toLowerCase());
const fmtChk = (v) => {
  if (v == null || v === "") return "";
  return isSimVal(v) ? "Sim" : "Não";
};

// ---------- Mapa de normalização de Secretarias ----------
const SECRETARIA_MAP = [
  [["vice-prefeito", "vice prefeito", "gabinete do vice"], "Gabinete do Vice-Prefeito"],
  [["chefia de gabinete"], "Chefia de Gabinete"],
  [["gabinete do prefeito", "gabinete prefeito"], "Gabinete do Prefeito"],
  [[
    " governo ", "secretaria de governo", "secretaria municipal de governo", "smg",
    "assessoria executiva", "ase ", " ase", "ase,", "satd",
    "comunicacao institucional", "comunicacao social",
  ], "Secretaria Municipal de Governo"],
  [["controladoria", "cgm", "auditoria interna"], "Controladoria Geral do Município"],
  [[
    "gestao e financas", "gestao e administracao", "gestao financas",
    "gertao e financas", "smgf", "gefin", "saga", "transformacao digital",
    "dirgep", "dirgerp", "digerp", "diretoria de gestao de pessoas",
    "diretoria de pessoas", "dca ",
    "arquivo e patrimonio", "patrimonio", "almoxarifado",
    "protocolo", "compras", "licitacao", "pregao",
    "tributos", "tributaria", "divida ativa", "cadastro de imoveis",
    "iptu", "receita municipal", "tesouraria", "contabilidade",
    "tecnologia da informacao", " ti ",
  ], "Secretaria Municipal de Gestão e Finanças"],
  [["educacao", "smed", "escola municipal", "creche", "cmei", "ensino fundamental", "ensino infantil"],
    "Secretaria Municipal de Educação"],
  [[
    "saude", "sms ", "ses", "secretaria municipal de saude",
    "hospital municipal", "hmfg", "francisco goncal",
    "pa central", "pa lagoa", "pronto atendimento", "pronto-atendimento",
    "caps ", "centro de atencao psicossocial",
    "esf ", "estrategia saude da familia",
    "ubs ", "unidade basica de saude", "posto de saude",
    "vigilancia em saude", "vigilancia sanitaria", "vigilancia epidemiologica",
    "samu", "siate", "farmacia municipal", "cemai", "epidemiologia",
    "saude mental", "secretaria de saude",
  ], "Secretaria Municipal de Saúde"],
  [["desenvolvimento social", "smds", "assistencia social", "cras", "creas", "centro pop", "casa da cidadania", "abrigo institucional", "conselho tutelar"],
    "Secretaria Municipal de Desenvolvimento Social"],
  [["desenvolvimento economico", "smde", "agricultura", "turismo", "trabalho e renda", "industria e comercio"],
    "Secretaria Municipal de Desenvolvimento Econômico"],
  [["bem estar", "bem-estar", "esporte", "esportes", "lazer", "juventude", "cultura", "biblioteca municipal", "teatro municipal"],
    "Secretaria Municipal de Bem Estar"],
  [["meio ambiente", "smma"], "Secretaria Municipal de Meio Ambiente"],
  [["obras", "servicos publicos", "limpeza urbana", "iluminacao publica", "manutencao urbana", "engenharia"],
    "Secretaria Municipal de Obras"],
  [["seguranca publica", "seguranca", "guarda municipal", "defesa civil", "transito"],
    "Secretaria Municipal de Segurança Pública"],
];

function matchSecretariaCanon(value) {
  if (!value) return null;
  const s = String(value).trim().replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (!s) return null;
  const key = " " + stripAccents(s).toLowerCase().replace(/\s+/g, " ") + " ";
  for (const [chaves, canon] of SECRETARIA_MAP) {
    if (chaves.some((c) => key.includes(c))) return canon;
  }
  return null;
}

function normalizeSecretaria(sec, lot) {
  return (
    matchSecretariaCanon(sec) ||
    matchSecretariaCanon(lot) ||
    (sec ? String(sec).trim() : (lot ? String(lot).trim() : "")) ||
    ""
  );
}

// ---------- Detecção de colunas (genérica) ----------
function detectHeaderRow(rows) {
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const r = rows[i] || [];
    const txt = r.map((c) => stripAccents(String(c || "")).toLowerCase().trim());
    // Aceita "Nome" e variantes como "Nome completo" (o participantes.xlsx gerado
    // ao vivo copia o cabeçalho do formulário de Inscrição, que usa "Nome completo").
    // `startsWith("nome")` não casa "sobrenome", então não há falso positivo.
    if (txt.some((c) => c === "nome" || c.startsWith("nome ")) || txt.some((c) => c.includes("ordem de"))) return i;
  }
  return -1;
}

function mapHeader(headerRow) {
  const norm = headerRow.map((h) => stripAccents(String(h || "")).toLowerCase().trim());
  const find = (...needles) => {
    for (let i = 0; i < norm.length; i++) {
      for (const n of needles) {
        if (norm[i] === n || norm[i].startsWith(n) || norm[i].includes(n)) return i;
      }
    }
    return -1;
  };
  const findExact = (needle) => {
    for (let i = 0; i < norm.length; i++) if (norm[i] === needle) return i;
    return -1;
  };
  const findStartsWith = (needle) => {
    for (let i = 0; i < norm.length; i++) if (norm[i].startsWith(needle)) return i;
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
    checkin:     findExact("check-in") >= 0 ? findExact("check-in") : find("check in", "checkin", "presente"),
    checkinM1:   findStartsWith("check-in m1"),
    checkinM2:   findStartsWith("check-in m2"),
    apto:        findStartsWith("apto"),
    dataInsc:    find("data de inscricao", "data de inscrição", "data inscricao", "data inscrição", "data compra"),
    dataCheck:   findStartsWith("data de check-in") >= 0 && findStartsWith("data de check-in m1") < 0
      ? findStartsWith("data de check-in")
      : find("data check-in"),
    dataCheckM1: findStartsWith("data de check-in m1"),
    dataCheckM2: findStartsWith("data de check-in m2"),
  };
}

function isLinhaRodape(nome) {
  const n = String(nome || "").trim().toLowerCase();
  return !n || n.startsWith("*") || n.startsWith("exportado") ||
         n.includes("horário de brasília") || n.includes("horario de brasilia");
}

// ---------- Extração de registros do arquivo de origem ----------
function extractRegistros(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  return extractRegistrosFromWorkbook(wb);
}

export function extractRegistrosFromWorkbook(wb) {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("Planilha sem aba.");
  fixSheetRange(sheet);
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });

  const hdrIdx = detectHeaderRow(rows);
  if (hdrIdx < 0) throw new Error("Cabeçalho não encontrado (esperava coluna 'Nome').");
  const cols = mapHeader(rows[hdrIdx]);
  if (cols.nome < 0) throw new Error("Coluna 'Nome' não encontrada.");

  const temModulos = cols.checkinM1 >= 0 && cols.checkinM2 >= 0;
  const registros = [];

  for (let i = hdrIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (!r.some((v) => String(v ?? "").trim())) continue;
    const nomeRaw = String(r[cols.nome] ?? "").trim();
    const sobRaw = cols.sobrenome >= 0 ? String(r[cols.sobrenome] ?? "").trim() : "";
    if (isLinhaRodape(nomeRaw)) continue;
    if (!nomeRaw && !sobRaw) continue;

    // Evita duplicar sobrenome quando o Nome já o contém (caso Sympla com
    // "Daniela Mara de Oliveira Roberto" + Sobrenome "Roberto").
    const sobJoinable = sobRaw &&
      !stripAccents(nomeRaw).toLowerCase().split(/\s+/).includes(stripAccents(sobRaw).toLowerCase())
        ? sobRaw : "";
    const nomeCompleto = titleCaseName((nomeRaw + " " + sobJoinable).trim());

    registros.push({
      nome: nomeCompleto,
      email: cols.email >= 0 ? String(r[cols.email] ?? "").trim() : "",
      secretaria: normalizeSecretaria(
        cols.secretaria >= 0 ? r[cols.secretaria] : "",
        cols.lotacao    >= 0 ? r[cols.lotacao]    : ""
      ),
      cargo: cols.cargo >= 0 ? String(r[cols.cargo] ?? "").trim() : "",
      matricula: cols.matricula >= 0 ? String(r[cols.matricula] ?? "").trim() : "",
      turma: cols.turma >= 0 ? String(r[cols.turma] ?? "").trim() : "",
      checkin: cols.checkin >= 0 ? fmtChk(r[cols.checkin]) : "",
      checkinM1: temModulos ? fmtChk(r[cols.checkinM1]) : "",
      checkinM2: temModulos ? fmtChk(r[cols.checkinM2]) : "",
      apto: cols.apto >= 0
        ? fmtChk(r[cols.apto])
        : (temModulos ? (isSimVal(r[cols.checkinM1]) && isSimVal(r[cols.checkinM2]) ? "Sim" : "Não") : ""),
      dataInsc: cols.dataInsc >= 0 ? fmtDate(r[cols.dataInsc]) : "",
      dataCheck: cols.dataCheck >= 0 ? fmtDate(r[cols.dataCheck]) : "",
      dataCheckM1: cols.dataCheckM1 >= 0 ? fmtDate(r[cols.dataCheckM1]) : "",
      dataCheckM2: cols.dataCheckM2 >= 0 ? fmtDate(r[cols.dataCheckM2]) : "",
    });
  }
  return { registros, sourceHasModulos: temModulos };
}

// ---------- Montagem do output ----------
export function buildSchemaA(regs, sourceHasModulos) {
  // Se a fonte só tem Check-in simples mas o evento exige Schema A, propaga
  // o Check-in único para M1 = M2 = Apto.
  return [
    HEADER_A.slice(),
    ...regs.map((p) => {
      const m1 = sourceHasModulos ? p.checkinM1 : p.checkin;
      const m2 = sourceHasModulos ? p.checkinM2 : p.checkin;
      const apto = p.apto || (m1 === "Sim" && m2 === "Sim" ? "Sim" : (m1 || m2 ? "Não" : ""));
      const dCM1 = sourceHasModulos ? p.dataCheckM1 : p.dataCheck;
      const dCM2 = sourceHasModulos ? p.dataCheckM2 : "";
      return [
        p.nome, p.email, p.secretaria, p.cargo, p.matricula, p.turma,
        p.checkin || apto, m1, m2, apto,
        p.dataInsc, dCM1, dCM2,
      ];
    }),
  ];
}

export function buildSchemaB(regs, sourceHasModulos) {
  return [
    HEADER_B.slice(),
    ...regs.map((p) => {
      // Se a fonte é multi-módulo mas o destino é Schema B, "Check-in" =
      // Apto (compareceu nos dois módulos) e "Data de Check-in" = última.
      const chk = sourceHasModulos ? (p.apto || "") : p.checkin;
      const dChk = sourceHasModulos
        ? (p.dataCheckM2 || p.dataCheckM1 || p.dataCheck)
        : p.dataCheck;
      return [
        p.nome, p.email, p.secretaria, p.cargo, p.matricula, p.turma,
        chk, p.dataInsc, dChk,
      ];
    }),
  ];
}

function writeAOA(filePath, aoa) {
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet["!autofilter"] = {
    ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: aoa[0].length - 1, r: aoa.length - 1 } }),
  };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Lista de participantes");
  XLSX.writeFile(wb, filePath);
}

// ---------- Walker ----------
function listarPlanilhas(dir) {
  const resultado = [];
  const walk = (sub) => {
    const full = path.join(dir, sub);
    for (const ent of fs.readdirSync(full, { withFileTypes: true })) {
      if (ent.name.startsWith(".") || ent.name === "_originais") continue;
      const rel = sub ? `${sub}/${ent.name}` : ent.name;
      if (ent.isDirectory()) { walk(rel); continue; }
      if (!ent.name.toLowerCase().endsWith(".xlsx")) continue;
      const base = stripAccents(ent.name).toLowerCase();
      if (base.startsWith("~$")) continue;
      // Pula auxiliares e o próprio arquivo de satisfação (esses não são listas
      // de participantes - não normalizar).
      if (base.startsWith("satisfacao") || base.startsWith("pesquisa")) continue;
      if (base.includes("sympla")) continue; // raw original do Sympla (manter como referência)
      resultado.push(rel.replace(/\\/g, "/"));
    }
  };
  walk("");
  return resultado.sort();
}

// ---------- Main ----------
function main() {
  if (!fs.existsSync(META_PATH)) {
    console.error("[normalize-planilhas] eventos-meta.json não encontrado em " + META_PATH);
    process.exit(1);
  }
  const meta = JSON.parse(fs.readFileSync(META_PATH, "utf-8")).eventos || {};
  const arquivos = listarPlanilhas(RELATORIOS_DIR);

  let ok = 0, fail = 0;
  for (const arquivo of arquivos) {
    const filePath = path.join(RELATORIOS_DIR, arquivo);
    try {
      const { registros, sourceHasModulos } = extractRegistros(filePath);
      // Schema A se o meta marca esse arquivo como tendo "modulos"; senão B.
      // Fallback: se a planilha-fonte JÁ traz módulos mas a meta não declara,
      // ainda persiste Schema A para não perder informação.
      const metaEntry = meta[arquivo] || {};
      const metaHasModulos = Array.isArray(metaEntry.modulos) && metaEntry.modulos.length > 0;
      const useSchemaA = metaHasModulos || sourceHasModulos;
      const aoa = useSchemaA
        ? buildSchemaA(registros, sourceHasModulos)
        : buildSchemaB(registros, sourceHasModulos);
      writeAOA(filePath, aoa);
      console.log(`[normalize-planilhas] ✓ ${arquivo} → Schema ${useSchemaA ? "A" : "B"} (${registros.length} pessoas)`);
      ok++;
    } catch (err) {
      console.warn(`[normalize-planilhas] ⚠ Pulando ${arquivo}: ${err.message}`);
      fail++;
    }
  }
  console.log(`[normalize-planilhas] Concluído: ${ok} normalizadas, ${fail} puladas.`);
}

// Só roda quando executado diretamente, não quando importado por api/eventos.js.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
