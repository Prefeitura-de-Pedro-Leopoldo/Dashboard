// Lógica da função participantes (testável). Acha e lê o participantes.xlsx ao
// vivo (via servirRelatorios.gs) e monta o evento com o MESMO parser do Node
// (parseWorkbook/buildEvento injetados). Contrato idêntico ao /api/participantes.
import { jsonResponse, preflight } from "../_shared/http.ts";
import type { FetchLike } from "../_shared/appscript.ts";

const PREFIXO = "assets/docs/relatorios/";

const norm = (s: string) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

function relativo(p: string): string {
  return String(p).replace(/\\/g, "/").replace(/^\/+/, "").replace(new RegExp("^" + PREFIXO, "i"), "");
}
function ehParticipantes(base: string): boolean {
  const b = base.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return b.startsWith("participantes") && b.endsWith(".xlsx") && !b.startsWith("~$");
}

export interface ParticipantesDeps {
  webappUrl: string;
  token: string;
  metaUrl: string;
  fetchImpl?: FetchLike;
  parseWorkbook: (base64: string) => unknown[]; // XLSX.read + parsePlanilhaFromWorkbook
  buildEvento: (rel: string, meta: Record<string, unknown>, participantes: unknown[]) => unknown;
  loadMeta?: (metaUrl: string, fetchImpl: FetchLike) => Promise<Map<string, Record<string, unknown>>>;
}

async function getJson(url: string, fetchImpl: FetchLike): Promise<{ ok: boolean; [k: string]: unknown }> {
  const r = await fetchImpl(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json();
}

async function loadMetaDefault(metaUrl: string, fetchImpl: FetchLike): Promise<Map<string, Record<string, unknown>>> {
  const json = await getJson(metaUrl, fetchImpl);
  const eventos = (json && (json.eventos as Record<string, Record<string, unknown>>)) || {};
  const byKey = new Map<string, Record<string, unknown>>();
  for (const [k, v] of Object.entries(eventos)) byKey.set(norm(k), v);
  return byKey;
}

export async function handleParticipantes(req: Request, deps: ParticipantesDeps): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "GET") return jsonResponse({ ok: false, error: "Método não permitido." }, 405);
  if (!deps.webappUrl || !deps.token) return jsonResponse({ ok: false, error: "Relatórios ao vivo não configurados." }, 503);

  const folder = String(new URL(req.url).searchParams.get("folder") || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!folder) return jsonResponse({ ok: false, error: "Parâmetro 'folder' obrigatório." }, 400);
  const folderN = norm(folder);

  try {
    const manifest = await getJson(`${deps.webappUrl}?action=manifest&token=${encodeURIComponent(deps.token)}`, fetchImpl);
    if (!manifest.ok) throw new Error(String(manifest.error || "Falha no manifesto do Drive."));

    const arquivo = ((manifest.files as { path: string; id: string }[]) || [])
      .map((f) => ({ ...f, rel: relativo(f.path) }))
      .find((f) => {
        const slash = f.rel.lastIndexOf("/");
        const dir = slash >= 0 ? f.rel.slice(0, slash) : "";
        const base = slash >= 0 ? f.rel.slice(slash + 1) : f.rel;
        return norm(dir) === folderN && ehParticipantes(base);
      });

    if (!arquivo) return jsonResponse({ ok: true, found: false, hasData: false });

    const file = await getJson(`${deps.webappUrl}?action=file&token=${encodeURIComponent(deps.token)}&id=${encodeURIComponent(arquivo.id)}`, fetchImpl);
    if (!file.ok || !file.base64) throw new Error("Falha ao baixar o participantes.xlsx do Drive.");

    const participantes = deps.parseWorkbook(String(file.base64));
    if (!participantes.length) return jsonResponse({ ok: true, found: true, hasData: false });

    const metaByKey = await (deps.loadMeta || loadMetaDefault)(deps.metaUrl, fetchImpl);
    const meta = metaByKey.get(norm(arquivo.rel)) || {};
    const evento = deps.buildEvento(arquivo.rel, meta, participantes);

    return jsonResponse({ ok: true, found: true, hasData: true, evento });
  } catch (err) {
    return jsonResponse({ ok: false, error: (err as Error)?.message || "Erro ao ler participantes." }, 502);
  }
}
