// Edge Function: eventos (entry). Equivalente ao GET /api/eventos.
// Reusa o pipeline do build (normalize -> workbook -> build-data) via import map.
//   supabase functions deploy eventos --project-ref gbtbkviprqnblgdwkaxk --no-verify-jwt --import-map supabase/functions/deno.json
import XLSX from "xlsx";
// @ts-ignore: .mjs Node reaproveitados (mesma lógica do build).
import { buildSchemaA, buildSchemaB, extractRegistrosFromWorkbook } from "../../../scripts/normalize-planilhas.mjs";
// @ts-ignore
import { buildEvento, buildResumo, parsePlanilhaFromWorkbook, slugify } from "../../../scripts/build-data.mjs";
// @ts-ignore
import { parseSatisfacaoFromBuffer } from "../../../scripts/satisfacao.mjs";
import { handleEventos } from "./handler.ts";

const SITE_URL = Deno.env.get("SITE_URL") || "https://egov-dashboard.vercel.app/";

// Reproduz o pipeline do build em memória (idêntico ao /api/eventos da Vercel).
function processarArquivo(bytes: Uint8Array, arquivo: string, metaEntry: Record<string, unknown>) {
  const wbRaw = XLSX.read(bytes, { cellDates: true });
  const { registros, sourceHasModulos } = extractRegistrosFromWorkbook(wbRaw);
  const metaHasModulos = Array.isArray(metaEntry.modulos) && (metaEntry.modulos as unknown[]).length > 0;
  const useSchemaA = metaHasModulos || sourceHasModulos;
  const aoa = useSchemaA ? buildSchemaA(registros, sourceHasModulos) : buildSchemaB(registros, sourceHasModulos);
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const wbNorm = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbNorm, sheet, "Lista de participantes");
  const participantes = parsePlanilhaFromWorkbook(wbNorm);
  const defaults = {
    id: slugify(arquivo.replace(/\.xlsx$/i, "").replace(/\//g, "-")),
    title: arquivo.replace(/\.xlsx$/i, "").replace(/\//g, " · "),
  };
  return buildEvento(arquivo, { ...defaults, ...metaEntry }, participantes);
}

// Cache de 30s por instância (best-effort, igual ao /api/eventos).
let _cache: { at: number; body: string } | null = null;
const TTL = 30_000;

Deno.serve(async (req) => {
  const fresh = new URL(req.url).searchParams.get("fresh");
  if (req.method === "GET" && !fresh && _cache && (Date.now() - _cache.at) < TTL) {
    return new Response(_cache.body, {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "X-Eventos-Cache": "hit" },
    });
  }
  const res = await handleEventos(req, {
    webappUrl: Deno.env.get("RELATORIOS_WEBAPP_URL") || "",
    token: Deno.env.get("RELATORIOS_TOKEN") || "",
    metaUrl: SITE_URL.replace(/\/?$/, "/") + "assets/docs/relatorios/eventos-meta.json",
    processarArquivo,
    buildEvento: (a: string, meta: Record<string, unknown>, p: unknown[]) => buildEvento(a, meta, p),
    buildResumo: (evs: unknown[]) => buildResumo(evs),
    parseSatisfacao: (bytes: Uint8Array) => parseSatisfacaoFromBuffer(bytes),
    slugify: (s: string) => slugify(s),
  });
  if (req.method === "GET" && res.status === 200) {
    try { _cache = { at: Date.now(), body: await res.clone().text() }; } catch (_) { /* ignore */ }
  }
  return res;
});
