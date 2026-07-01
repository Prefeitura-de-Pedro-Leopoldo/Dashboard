// Lógica da função satisfacao (testável). Acha a satisfacao.xlsx da pasta no
// Drive e devolve o BINÁRIO (o front parseia). Contrato idêntico ao
// GET /api/satisfacao da Vercel. Sem parse aqui -> não depende de xlsx.
import { Buffer } from "node:buffer";
import { CORS_HEADERS, jsonResponse, preflight } from "../_shared/http.ts";
import type { FetchLike } from "../_shared/appscript.ts";

const PREFIXO = "assets/docs/relatorios/";
const norm = (s: string) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
const relativo = (p: string) =>
  String(p).replace(/\\/g, "/").replace(/^\/+/, "").replace(new RegExp("^" + PREFIXO, "i"), "");
function ehSatisfacao(base: string): boolean {
  const b = base.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!b.endsWith(".xlsx") || b.startsWith("~$")) return false;
  return b.startsWith("satisfacao") || b.startsWith("pesquisa");
}
async function getJson(url: string, fetchImpl: FetchLike): Promise<{ ok: boolean; [k: string]: unknown }> {
  const r = await fetchImpl(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json();
}

export interface SatisfacaoDeps { webappUrl: string; token: string; fetchImpl?: FetchLike; }

export async function handleSatisfacao(req: Request, deps: SatisfacaoDeps): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "GET") return jsonResponse({ ok: false, error: "Método não permitido." }, 405);
  if (!deps.webappUrl || !deps.token) return jsonResponse({ ok: false, error: "Relatorios ao vivo nao configurados." }, 503);

  const folder = String(new URL(req.url).searchParams.get("folder") || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!folder) return jsonResponse({ ok: false, error: "Parametro 'folder' obrigatorio." }, 400);
  const folderN = norm(folder);

  try {
    const manifest = await getJson(`${deps.webappUrl}?action=manifest&token=${encodeURIComponent(deps.token)}`, fetchImpl);
    if (!manifest.ok) throw new Error(String(manifest.error || "Falha no manifesto do Drive."));

    const hit = ((manifest.files as { path: string; id: string }[]) || [])
      .map((f) => ({ ...f, rel: relativo(f.path) }))
      .find((f) => {
        const slash = f.rel.lastIndexOf("/");
        const dir = slash >= 0 ? f.rel.slice(0, slash) : "";
        const base = slash >= 0 ? f.rel.slice(slash + 1) : f.rel;
        return norm(dir) === folderN && ehSatisfacao(base);
      });

    if (!hit) return jsonResponse({ ok: false, error: `Sem satisfacao na pasta "${folder}".` }, 404);

    const data = await getJson(`${deps.webappUrl}?action=file&token=${encodeURIComponent(deps.token)}&id=${encodeURIComponent(hit.id)}`, fetchImpl);
    if (!data.ok || !data.base64) return jsonResponse({ ok: false, error: "Falha ao baixar do Drive." }, 502);

    const bytes = Buffer.from(String(data.base64), "base64");
    return new Response(bytes, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `inline; filename="${hit.rel.split("/").pop()}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: (err as Error)?.message || "Erro ao buscar satisfacao." }, 502);
  }
}
