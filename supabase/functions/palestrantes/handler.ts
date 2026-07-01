// Lógica de palestrantes (testável): proxy para o cadastroPalestrantes.gs +
// provisionamento do acesso após create/update/invite-submit. Contrato idêntico
// ao POST /api/palestrantes da Vercel (que também provisiona server-side).
import { jsonResponse, preflight } from "../_shared/http.ts";
import type { FetchLike } from "../_shared/appscript.ts";

const ALLOWED = new Set([
  "create", "list", "update", "delete",
  "invite-create", "invite-list", "invite-revoke", "invite-check", "invite-submit",
]);

export interface ProvisionArgs { email: string; name: string; eventoId: string | null; loginUrl: string; }

export interface PalestrantesDeps {
  url: string;
  token: string;
  fetchImpl?: FetchLike;
  loginUrl?: string;
  provision?: (args: ProvisionArgs) => Promise<unknown>;
}

export async function handlePalestrantes(req: Request, deps: PalestrantesDeps): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Método não permitido." }, 405);
  if (!deps.url || !deps.token) return jsonResponse({ ok: false, error: "Serviço de palestrantes não configurado." }, 503);

  let body: Record<string, unknown> | null;
  try { body = await req.json(); } catch (_) { body = null; }
  if (!body || typeof body !== "object") return jsonResponse({ ok: false, error: "Payload inválido." }, 400);

  const action = String(body.action || "").trim().toLowerCase();
  if (!ALLOWED.has(action)) return jsonResponse({ ok: false, error: "Ação inválida." }, 400);

  const payload = { ...body, action, token: deps.token };

  let upstreamOk = false;
  let data: unknown;
  try {
    const up = await fetchImpl(deps.url, {
      method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload), redirect: "follow",
    });
    upstreamOk = up.ok;
    const text = await up.text();
    try { data = JSON.parse(text); } catch (_) {
      return jsonResponse({ ok: false, error: "Resposta inválida do Apps Script.", snippet: text.slice(0, 300) }, 502);
    }
  } catch (e) {
    return jsonResponse({ ok: false, error: (e as Error)?.message || "Erro interno." }, 500);
  }

  // Provisiona o acesso após um cadastro bem-sucedido. Tolerante.
  const okData = !!(data && (data as { ok?: boolean }).ok);
  if (deps.provision && upstreamOk && okData && ["create", "update", "invite-submit"].includes(action) && body.email) {
    try {
      await deps.provision({
        email: String(body.email),
        name: String(body.nome || ""),
        eventoId: body.cursoId ? String(body.cursoId) : null,
        loginUrl: deps.loginUrl || "",
      });
    } catch (_) { /* silencioso */ }
  }

  return jsonResponse(data, upstreamOk ? 200 : 502);
}
