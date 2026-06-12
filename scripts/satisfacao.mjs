/**
 * satisfacao.mjs - parser fiel da pesquisa de satisfação (satisfacao.xlsx).
 *
 * Os arquivos são exports do Google Forms. Detecta automaticamente as colunas
 * de nota 1–5 (Likert) — ignorando carimbo de data/hora, e-mail e perguntas
 * abertas (texto) — e agrega média + distribuição por indicador.
 *
 * 100% fiel aos dados: só conta respostas reais; nunca inventa valores.
 * Reusado pelo build estático (build-data) e pela API ao vivo (api/eventos).
 */
import XLSX from "xlsx";

// Uma coluna é "nota 1–5" quando ≥80% das respostas preenchidas são inteiros
// de 1 a 5 (tolera alguma linha vazia/atípica sem descartar o indicador).
function ehColunaNota(data, idx) {
  let nums = 0, total = 0;
  for (const r of data) {
    const v = r[idx];
    if (v === "" || v == null) continue;
    total++;
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1 && n <= 5) nums++;
  }
  return total > 0 && nums / total >= 0.8;
}

export function parseSatisfacaoFromWorkbook(wb) {
  if (!wb || !Array.isArray(wb.SheetNames) || !wb.SheetNames.length) return null;
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
  if (rows.length < 2) return null;

  const header = rows[0].map((h) => String(h == null ? "" : h).trim());
  const data = rows.slice(1);

  const indicadores = [];
  for (let i = 0; i < header.length; i++) {
    const h = header[i];
    if (!h || /carimbo|e-?mail|hora/i.test(h)) continue;
    if (!ehColunaNota(data, i)) continue;
    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let soma = 0, n = 0;
    for (const r of data) {
      const v = Number(r[i]);
      if (Number.isInteger(v) && v >= 1 && v <= 5) { dist[v]++; soma += v; n++; }
    }
    if (!n) continue;
    indicadores.push({
      label: h.replace(/[:：]\s*$/, "").trim(),
      media: Math.round((soma / n) * 100) / 100,
      n,
      dist,
    });
  }
  if (!indicadores.length) return null;

  const mediaGeral =
    Math.round((indicadores.reduce((s, x) => s + x.media, 0) / indicadores.length) * 100) / 100;
  return { totalRespostas: data.length, mediaGeral, indicadores };
}

// Conveniência: a partir de um Buffer (.xlsx) → objeto de satisfação (ou null).
export function parseSatisfacaoFromBuffer(buffer) {
  try {
    return parseSatisfacaoFromWorkbook(XLSX.read(buffer, { cellDates: true }));
  } catch (_) {
    return null;
  }
}
