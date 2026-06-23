// Mapa canônico de Secretarias + casador, COMPARTILHADO entre o build
// (scripts/build-data.mjs) e o normalizador (scripts/normalize-planilhas.mjs).
//
// Antes este bloco era duplicado nos dois arquivos (mesma regra de negócio em
// dois lugares), com risco de divergência silenciosa nos números do painel.
// Agora há uma única fonte da verdade. Cada script ainda mantém o seu próprio
// `normalizeSecretaria`, porque o tratamento do fallback (quando NADA casa)
// difere entre eles por design.
//
// As chaves são fragmentos buscados no texto normalizado (sem acento,
// minúsculo, contains) - a primeira chave que bater define a Secretaria
// canônica. Ordem importa: chaves mais específicas vêm ANTES das genéricas
// (ex.: "vice" antes de "gabinete"; "chefia de gabinete" antes de "gabinete").

const stripAccents = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const SECRETARIA_MAP = [
  // ===== Gabinete / Vice / Chefia =====
  [["vice-prefeito", "vice prefeito", "gabinete do vice"], "Gabinete do Vice-Prefeito"],
  [["chefia de gabinete"], "Chefia de Gabinete"],
  [["gabinete do prefeito", "gabinete prefeito"], "Gabinete do Prefeito"],

  // ===== Governo (inclui assessoria executiva, SATD, comunicação institucional) =====
  [
    [
      " governo ",
      "secretaria de governo",
      "secretaria municipal de governo",
      "smg",
      "assessoria executiva",
      "ase ",
      " ase",
      "ase,",
      "satd",
      "comunicacao institucional",
      "comunicacao social",
    ],
    "Secretaria Municipal de Governo",
  ],

  // ===== Controladoria =====
  [["controladoria", "cgm", "auditoria interna"], "Controladoria Geral do Município"],

  // ===== Gestão e Finanças (SMGF / DIRGEP / Patrimônio / Protocolo / Receitas) =====
  [
    [
      "gestao e financas",
      "gestao e administracao",
      "gestao financas",
      "gertao e financas",
      "smgf",
      "gefin",
      "saga",
      "transformacao digital",
      "dirgep",
      "dirgerp",
      "digerp",
      "diretoria de gestao de pessoas",
      "diretoria de pessoas",
      "dca ",
      "arquivo e patrimonio",
      "patrimonio",
      "almoxarifado",
      "protocolo",
      "compras",
      "licitacao",
      "pregao",
      "tributos",
      "tributaria",
      "divida ativa",
      "cadastro de imoveis",
      "iptu",
      "receita municipal",
      "tesouraria",
      "contabilidade",
      "tecnologia da informacao",
      " ti ",
    ],
    "Secretaria Municipal de Gestão e Finanças",
  ],

  // ===== Educação =====
  [
    [
      "educacao",
      "smed",
      "escola municipal",
      "creche",
      "cmei",
      "ensino fundamental",
      "ensino infantil",
    ],
    "Secretaria Municipal de Educação",
  ],

  // ===== Saúde (todas as unidades: HMFG, PA, CAPS, ESF, UBS, vigilância) =====
  [
    [
      "saude",
      "saúde",
      "sms ",
      "ses",
      "secretaria municipal de saude",
      "hospital municipal",
      "hmfg",
      "francisco goncal",
      "pa central",
      "pa lagoa",
      "pronto atendimento",
      "pronto-atendimento",
      "caps ",
      "centro de atencao psicossocial",
      "esf ",
      "estrategia saude da familia",
      "ubs ",
      "unidade basica de saude",
      "posto de saude",
      "vigilancia em saude",
      "vigilancia sanitaria",
      "vigilancia epidemiologica",
      "samu",
      "siate",
      "farmacia municipal",
      "cemai",
      "epidemiologia",
      "saude mental",
      "secretaria de saude",
    ],
    "Secretaria Municipal de Saúde",
  ],

  // ===== Desenvolvimento Social (CRAS, CREAS, Casa da Cidadania) =====
  [
    [
      "desenvolvimento social",
      "smds",
      "assistencia social",
      "cras",
      "creas",
      "centro pop",
      "casa da cidadania",
      "abrigo institucional",
      "conselho tutelar",
    ],
    "Secretaria Municipal de Desenvolvimento Social",
  ],

  // ===== Desenvolvimento Econômico =====
  [
    [
      "desenvolvimento economico",
      "smde",
      "agricultura",
      "turismo",
      "trabalho e renda",
      "industria e comercio",
    ],
    "Secretaria Municipal de Desenvolvimento Econômico",
  ],

  // ===== Bem Estar (Esporte, Cultura, Lazer, Juventude) =====
  [
    [
      "bem estar",
      "bem-estar",
      "esporte",
      "esportes",
      "lazer",
      "juventude",
      "cultura",
      "biblioteca municipal",
      "teatro municipal",
    ],
    "Secretaria Municipal de Bem Estar",
  ],

  // ===== Meio Ambiente =====
  [["meio ambiente", "smma"], "Secretaria Municipal de Meio Ambiente"],

  // ===== Obras e Serviços Públicos =====
  [
    [
      "obras",
      "servicos publicos",
      "limpeza urbana",
      "iluminacao publica",
      "manutencao urbana",
      "engenharia",
    ],
    "Secretaria Municipal de Obras",
  ],

  // ===== Segurança Pública =====
  [
    ["seguranca publica", "seguranca", "guarda municipal", "defesa civil", "transito", "trânsito"],
    "Secretaria Municipal de Segurança Pública",
  ],
];

// Tenta encaixar uma string única em uma das Secretarias canônicas.
export function matchSecretariaCanon(value) {
  if (!value) return null;
  const s = String(value)
    .trim()
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
  if (!s) return null;
  // padding com espaços para que chaves curtas como " ase " / " ti " só batam
  // como palavra isolada (evita "ti" pegar "assistente", por exemplo).
  const key = " " + stripAccents(s).toLowerCase().replace(/\s+/g, " ") + " ";
  for (const [chaves, canon] of SECRETARIA_MAP) {
    if (chaves.some((c) => key.includes(c))) return canon;
  }
  return null;
}
