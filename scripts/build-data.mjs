#!/usr/bin/env node
// Build: lê todas as planilhas .xlsx em assets/docs/relatorios/, padroniza,
// e gera eventos-data.json (raiz) + manifest.json (relatorios/).
// Roda em `npm run build` e no Vercel.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const SECRETARIA_MAP = [
  [["educacao"], "Secretaria Municipal de Educação"],
  [["saude"], "Secretaria Municipal de Saúde"],
  [["gestao e financas", "gestao e administracao", "transformacao digital", "saga"],
    "Secretaria Municipal de Gestão e Finanças"],
  [["desenvolvimento economico"], "Secretaria Municipal de Desenvolvimento Econômico"],
  [["desenvolvimento social"], "Secretaria Municipal de Desenvolvimento Social"],
  [["bem estar", "bem-estar"], "Secretaria Municipal de Bem Estar"],
  [["meio ambiente"], "Secretaria Municipal de Meio Ambiente"],
  [["seguranca"], "Secretaria Municipal de Segurança Pública"],
  [["obras"], "Secretaria Municipal de Obras"],
  [["controladoria"], "Controladoria Geral do Município"],
  [["vice"], "Gabinete do Vice-Prefeito"],
  [["gabinete do prefeito"], "Gabinete do Prefeito"],
  [["chefia de gabinete"], "Chefia de Gabinete"],
  [["governo"], "Secretaria Municipal de Governo"],
];

const stripAccents = (s) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");

const slugify = (s) =>
  stripAccents(s).toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

function normalizeSecretaria(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (!s) return null;
  const key = stripAccents(s).toLowerCase();
  for (const [chaves, canon] of SECRETARIA_MAP) {
    if (chaves.some((c) => key.includes(c))) return canon;
  }
  return s.replace(/\S+/g, (w) =>
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
  return {
    nome:        find("nome completo", "nome"),
    sobrenome:   find("sobrenome"),
    email:       find("e-mail", "email"),
    secretaria:  find("secretaria", "lotacao", "lotação"),
    cargo:       find("cargo/funcao", "cargo/função", "cargo", "funcao", "função"),
    matricula:   find("matricula", "matrícula"),
    turma:       find("tipo de ingresso", "turma"),
    checkin:     find("check-in", "check in", "checkin", "presente"),
    dataInsc:    find("data de inscricao", "data de inscrição", "inscricao", "inscrição"),
    dataCheck:   find("data de check-in", "data check-in", "check-in em"),
  };
}

function isLinhaRodape(nome) {
  const n = (nome || "").trim().toLowerCase();
  return !n || n.startsWith("*") || n.startsWith("exportado em") ||
         n.includes("horário de brasília") || n.includes("horario de brasilia");
}

function parsePlanilha(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("Planilha sem aba.");
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

    const checkinRaw = temColCheckin ? String(r[cols.checkin] ?? "").trim().toLowerCase() : "";
    const presente = temColCheckin
      ? ["sim", "yes", "true", "1", "presente"].includes(checkinRaw)
      : true;
    const dataInsc  = cols.dataInsc  >= 0 ? parseExcelDate(r[cols.dataInsc])  : null;
    const dataCheck = cols.dataCheck >= 0 ? parseExcelDate(r[cols.dataCheck]) : null;

    participantes.push({
      nome,
      email: cols.email >= 0 ? String(r[cols.email] ?? "").trim() || null : null,
      turma: cols.turma >= 0 ? (String(r[cols.turma] ?? "").trim() || null) : null,
      secretaria: cols.secretaria >= 0 ? normalizeSecretaria(r[cols.secretaria]) : null,
      cargo: cols.cargo >= 0 ? (String(r[cols.cargo] ?? "").trim() || null) : null,
      matricula: cols.matricula >= 0 ? (String(r[cols.matricula] ?? "").trim() || null) : null,
      pagamento: null,
      presente,
      dataCheckin: isoLocal(dataCheck),
      dataInscricao: isoLocal(dataInsc),
    });
  }
  return participantes;
}

function buildEvento(arquivo, meta, participantes) {
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
  const turmas = tally(participantes, (p) => p.turma);
  const turmasPresentes = tally(presentes, (p) => p.turma);

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

  const vagas = meta.vagas ?? totalInscritos;
  const taxaOcupacao = vagas ? Math.round((totalInscritos / vagas) * 1000) / 10 : 0;

  return {
    id: meta.id,
    title: meta.title,
    date: meta.date || null,
    dateRaw: meta.dateRaw || meta.date || null,
    time: meta.time || "",
    local: meta.local || "",
    city: meta.city || "",
    status: totalInscritos > 0 ? "realizado" : "agendado",
    totalInscritos,
    totalAprovados: totalInscritos,
    totalPresentes,
    totalAusentes,
    taxaPresenca,
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

function buildResumo(eventos) {
  const totalEventos = eventos.length;
  const eventosRealizados = eventos.filter((e) => e.status === "realizado").length;
  const eventosAgendados = totalEventos - eventosRealizados;
  const totalInscritos = eventos.reduce((s, e) => s + e.totalInscritos, 0);
  const totalPresentes = eventos.reduce((s, e) => s + e.totalPresentes, 0);
  const totalAusentes = totalInscritos - totalPresentes;
  const totalVagas = eventos.reduce((s, e) => s + (e.vagas || 0), 0);
  const taxaPresencaGlobal = totalInscritos
    ? Math.round((totalPresentes / totalInscritos) * 1000) / 10 : 0;
  const taxaOcupacaoGlobal = totalVagas
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

function main() {
  const meta = JSON.parse(fs.readFileSync(META_PATH, "utf-8")).eventos || {};
  const arquivos = fs.readdirSync(RELATORIOS_DIR)
    .filter((f) => f.toLowerCase().startsWith("lista de participantes") && f.toLowerCase().endsWith(".xlsx"))
    .sort();

  if (!arquivos.length) {
    console.warn(`[build-data] Nenhuma planilha em ${RELATORIOS_DIR}.`);
  }

  const eventos = [];
  const erros = [];
  for (const arquivo of arquivos) {
    const filePath = path.join(RELATORIOS_DIR, arquivo);
    try {
      const m = meta[arquivo] || {};
      const defaults = {
        id: slugify(arquivo.replace(/^Lista de participantes - /i, "").replace(/\.xlsx$/i, "")),
        title: arquivo.replace(/^Lista de participantes - /i, "").replace(/\.xlsx$/i, ""),
      };
      const eventoMeta = { ...defaults, ...m };
      if (!meta[arquivo]) {
        console.warn(`[build-data] ⚠ Sem metadata para "${arquivo}". Usando defaults derivados do nome do arquivo. Adicione uma entrada em eventos-meta.json.`);
      }
      const participantes = parsePlanilha(filePath);
      eventos.push(buildEvento(arquivo, eventoMeta, participantes));
      console.log(`[build-data] ✓ ${arquivo} → ${participantes.length} participantes (${eventoMeta.id})`);
    } catch (err) {
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
    fonte: "assets/docs/relatorios/Lista de participantes - *.xlsx",
    eventos,
    resumo: buildResumo(eventos),
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + "\n", "utf-8");
  console.log(`[build-data] eventos-data.json escrito (${eventos.length} eventos).`);

  const manifest = {
    geradoEm: new Date().toISOString(),
    fonte: "assets/docs/relatorios/Lista de participantes - *.xlsx",
    planilhas: eventos.map((e) => ({
      id: e.id,
      arquivo: e.fonte,
      titulo: (meta[e.fonte] && meta[e.fonte].tituloCurto) || e.title,
    })),
  };
  fs.writeFileSync(OUT_MANIFEST, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  console.log(`[build-data] manifest.json escrito (${manifest.planilhas.length} planilhas).`);
}

main();
