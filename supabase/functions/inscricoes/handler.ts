// Lógica da função inscricoes (testável). Monta a URL upstream a partir da query
// e repassa via proxy GET. Contrato idêntico ao GET /api/inscricoes da Vercel.
import { jsonResponse, preflight } from "../_shared/http.ts";
import { type FetchLike, handleGetProxy } from "../_shared/appscript.ts";

export interface InscricoesConfig {
  webappUrl: string;
  token: string;
}

// Monta a URL do Apps Script conforme os parâmetros. Pura e testável.
export function buildUpstreamUrl(
  params: URLSearchParams,
  cfg: InscricoesConfig,
): { url?: string; error?: string; status?: number } {
  if (!cfg.webappUrl || !cfg.token) return { error: "Serviço de inscrições não configurado.", status: 503 };
  const enc = encodeURIComponent;
  const isManifest = params.get("manifest") === "1" || params.get("manifest") === "true";
  if (isManifest) {
    return { url: `${cfg.webappUrl}?action=manifest&token=${enc(cfg.token)}` };
  }
  const path = String(params.get("path") || "").trim();
  if (!path) return { error: 'Parâmetro "path" ausente.', status: 400 };
  const action = params.get("kind") === "presentes" ? "presentes" : "inscritos";
  return { url: `${cfg.webappUrl}?action=${action}&token=${enc(cfg.token)}&path=${enc(path)}` };
}

export async function handleInscricoes(
  req: Request,
  cfg: InscricoesConfig,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "GET") return jsonResponse({ ok: false, error: "Método não permitido." }, 405);
  const params = new URL(req.url).searchParams;
  const built = buildUpstreamUrl(params, cfg);
  if (built.error) return jsonResponse({ ok: false, error: built.error }, built.status || 400);
  return handleGetProxy(req, built.url!, fetchImpl);
}
