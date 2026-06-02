// Script pontual: acrescenta ao participantes.xlsx do "Ciclo de Debates PL por
// Elas" os participantes presentes na lista exportada (SOURCE) que ainda NÃO
// estão no arquivo do painel (TARGET). Comparação por e-mail OU nome.
import XLSX from "xlsx";

const TARGET = "./assets/docs/relatorios/ciclo-de-debates-pl-por-elas-2026-05/turma 1/participantes.xlsx";
const SOURCE = "./Lista de participantes - Ciclo_de_Debates_PL_por_Elas (3376906) (2).xlsx";

const norm = (s) =>
  String(s || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");

// Colapsa palavras repetidas CONSECUTIVAS (ex.: "Roberto Roberto" -> "Roberto").
function colapsaDuplicadas(nome) {
  const out = [];
  for (const w of String(nome).trim().split(/\s+/)) {
    if (!out.length || norm(out[out.length - 1]) !== norm(w)) out.push(w);
  }
  return out.join(" ");
}

// Title Case pt-BR (mantém conectores minúsculos quando não são a 1ª palavra).
const MIN = new Set(["de", "da", "do", "dos", "das", "e", "di", "del"]);
function titleCase(nome) {
  return colapsaDuplicadas(nome)
    .toLowerCase()
    .split(" ")
    .map((w, i) => (i > 0 && MIN.has(w) ? w : (w[0] ? w[0].toUpperCase() + w.slice(1) : w)))
    .join(" ");
}

// Mapeia a secretaria da origem para o nome canônico do painel (por palavra-chave).
function secretariaCanonica(raw) {
  const s = norm(raw);
  if (!s) return "";
  if (s.includes("bem estar")) return "Secretaria Municipal de Bem Estar";
  if (s.includes("controlad")) return "Controladoria Geral do Município";
  if (s.includes("saud")) return "Secretaria Municipal de Saúde";
  if (s.includes("desenvolvimento social")) return "Secretaria Municipal de Desenvolvimento Social";
  if (s.includes("desenvolvimento econ")) return "Secretaria Municipal de Desenvolvimento Econômico";
  if (s.includes("meio ambiente")) return "Secretaria Municipal de Meio Ambiente";
  if (s.includes("seguranc")) return "Secretaria Municipal de Segurança Pública";
  if (s.includes("educa")) return "Secretaria Municipal de Educação";
  if (s.includes("obras")) return "Secretaria Municipal de Obras";
  if (s.includes("gest") && s.includes("finan")) return "Secretaria Municipal de Gestão e Finanças";
  if (s.includes("govern")) return "Secretaria Municipal de Governo";
  if (s.includes("gabinete") && s.includes("vice")) return "Gabinete do Vice-Prefeito";
  if (s.includes("gabinete")) return "Gabinete do Prefeito";
  return raw; // sem correspondência: mantém original (será reportado)
}

const wbT = XLSX.readFile(TARGET);
const sheetName = wbT.SheetNames[0];
const sheetT = wbT.Sheets[sheetName];
const HEADER = XLSX.utils.sheet_to_json(sheetT, { header: 1, defval: "" })[0];
const rowsT = XLSX.utils.sheet_to_json(sheetT, { defval: "" });

const wbS = XLSX.readFile(SOURCE, { cellDates: true });
const rowsS = XLSX.utils.sheet_to_json(wbS.Sheets[wbS.SheetNames[0]], { defval: "" });

const emailsT = new Set(rowsT.map((r) => norm(r.Email)).filter(Boolean));
const nomesT = new Set(rowsT.map((r) => norm(r.Nome)).filter(Boolean));

const novos = [];
const naoMapeadas = new Set();
for (const r of rowsS) {
  const full = `${String(r.Nome || "").trim()} ${String(r.Sobrenome || "").trim()}`.trim();
  const email = norm(r.Email);
  const nome = norm(full);
  const jaExiste = (email && emailsT.has(email)) || (nome && nomesT.has(nome));
  if (jaExiste) continue;
  // evita duplicar dentro da própria origem
  if (email) emailsT.add(email);
  if (nome) nomesT.add(nome);

  const sec = secretariaCanonica(r.Secretaria);
  if (sec === r.Secretaria && !/^Secretaria|^Gabinete|^Controladoria|^Chefia/.test(sec)) naoMapeadas.add(r.Secretaria);

  // Linha no schema do TARGET (mesma ordem do HEADER).
  const linha = {
    "Nome": titleCase(full),
    "Email": String(r.Email || "").trim(),
    "Secretaria": sec,
    "Cargo/Função": String(r["Cargo/Função"] || "").trim(),
    "Matrícula": "",
    "Turma": "",
    "Check-in": String(r["Check-in"] || "Não").trim(),
    "Data de Inscrição": "",
    "Data de Check-in": "",
  };
  novos.push(HEADER.map((h) => linha[h] ?? ""));
}

// Anexa as novas linhas ao final, preservando as existentes intactas.
XLSX.utils.sheet_add_aoa(sheetT, novos, { origin: -1 });
XLSX.writeFile(wbT, TARGET);

console.log(`Linhas existentes: ${rowsT.length}`);
console.log(`Novas linhas adicionadas: ${novos.length}`);
console.log(`Total agora: ${rowsT.length + novos.length}`);
if (naoMapeadas.size) console.log("Secretarias SEM mapeamento canônico (mantidas como vieram):", [...naoMapeadas]);
console.log("\nNomes adicionados:");
novos.forEach((l, i) => console.log(`${i + 1}. ${l[0]} | ${l[1]} | ${l[2]} | ${l[6]}`));
