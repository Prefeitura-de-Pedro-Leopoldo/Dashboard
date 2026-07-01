// Lógica do login social Google (testável). Contrato idêntico ao
// POST /api/auth/google da Vercel: valida o ID token, confere as claims e a
// allowlist (app_users), devolve { ok, email, name, role, eventoId }.
import { jsonResponse, preflight } from "../_shared/auth.ts";
import { type GoogleClaims, validateGoogleClaims } from "../_shared/google.ts";
import type { AppUser } from "../login/handler.ts";

export type FetchTokenInfo = (idToken: string) => Promise<GoogleClaims | null>;
export type GetUser = (email: string) => Promise<AppUser | null>;

export interface GoogleDeps {
  clientId: string;
  fetchTokenInfo: FetchTokenInfo;
  getUser: GetUser;
  now?: number;
}

export async function handleGoogle(req: Request, deps: GoogleDeps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Método não permitido." }, 405);
  if (!deps.clientId) return jsonResponse({ ok: false, error: "Login Google não configurado." }, 503);

  let body: { credential?: string; idToken?: string; id_token?: string };
  try { body = await req.json(); } catch (_) { body = {}; }
  const idToken = String(body?.credential || body?.idToken || body?.id_token || "");
  if (!idToken) return jsonResponse({ ok: false, error: "Token do Google ausente." }, 400);

  let claims: GoogleClaims | null = null;
  try { claims = await deps.fetchTokenInfo(idToken); } catch (_) { claims = null; }
  if (!claims) return jsonResponse({ ok: false, error: "Não foi possível validar o token do Google." }, 401);

  const v = validateGoogleClaims(claims, { clientId: deps.clientId, now: deps.now });
  if (!v.ok) return jsonResponse({ ok: false, error: v.error }, 401);

  let allowed: AppUser | null;
  try { allowed = await deps.getUser(v.email!); } catch (_) {
    return jsonResponse({ ok: false, error: "Serviço de autenticação indisponível." }, 503);
  }
  if (!allowed || allowed.active === false) {
    return jsonResponse({ ok: false, error: "Sua conta Google não tem acesso ao painel." }, 403);
  }

  return jsonResponse({
    ok: true,
    email: String(allowed.email).toLowerCase(),
    name: allowed.name || v.name,
    role: allowed.role || "admin",
    eventoId: allowed.evento_id || null,
  });
}
