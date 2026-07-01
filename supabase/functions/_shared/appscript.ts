// Proxy genérico para os Web Apps do Apps Script (mesma lógica dos /api da
// Vercel: injeta token no servidor, repassa a resposta, trata erros). O fetch é
// injetável para os testes cobrirem todos os caminhos sem rede real.
import { jsonResponse, preflight } from "./http.ts";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface PostProxyConfig {
  url: string;
  token?: string;            // se definido, injeta {token} no corpo enviado
  allowedActions?: Set<string>; // se definido, valida body.action (senão 400)
}

// Repassa um POST JSON para o Apps Script. Contrato idêntico aos proxies Vercel.
export async function handlePostProxy(
  req: Request,
  cfg: PostProxyConfig,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Método não permitido." }, 405);
  if (!cfg.url) return jsonResponse({ ok: false, error: "Serviço não configurado." }, 503);

  let body: Record<string, unknown> | null;
  try { body = await req.json(); } catch (_) { body = null; }
  if (!body || typeof body !== "object") {
    return jsonResponse({ ok: false, error: "Payload inválido." }, 400);
  }

  if (cfg.allowedActions) {
    const action = String(body.action || "").trim().toLowerCase();
    if (!cfg.allowedActions.has(action)) {
      return jsonResponse({ ok: false, error: "Ação inválida." }, 400);
    }
    body = { ...body, action };
  }

  // Injeta o token no servidor (ignora qualquer token vindo do client).
  const payload = cfg.token ? { ...body, token: cfg.token } : body;

  return forward(cfg.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload), redirect: "follow" }, fetchImpl);
}

// Repassa um GET (a URL já vem montada com querystring/token).
export async function handleGetProxy(
  req: Request,
  url: string,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "GET") return jsonResponse({ ok: false, error: "Método não permitido." }, 405);
  if (!url) return jsonResponse({ ok: false, error: "Serviço não configurado." }, 503);
  return forward(url, { redirect: "follow" }, fetchImpl);
}

async function forward(url: string, init: RequestInit, fetchImpl: FetchLike): Promise<Response> {
  try {
    const up = await fetchImpl(url, init);
    const text = await up.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch (_) {
      return jsonResponse({ ok: false, error: "Resposta inválida do Apps Script.", snippet: text.slice(0, 300) }, 502);
    }
    return jsonResponse(data, up.ok ? 200 : 502);
  } catch (e) {
    return jsonResponse({ ok: false, error: (e as Error)?.message || "Erro interno." }, 500);
  }
}
