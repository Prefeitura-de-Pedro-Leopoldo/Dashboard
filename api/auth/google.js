/**
 * POST /api/auth/google
 * Login social com Google (Google Identity Services).
 *
 * O front envia o ID token (JWT) retornado pelo botão "Entrar com Google".
 * Aqui validamos o token junto ao Google (endpoint tokeninfo, que confere
 * assinatura e expiração), checamos as claims (audiência, emissor, e-mail
 * verificado) e só então conferimos a allowlist (mesma do /api/login: banco
 * app_users quando configurado, senão AUTH_USER_*).
 *
 * Não usa o client secret: o fluxo de ID token só precisa do GOOGLE_CLIENT_ID.
 * Mantém o mesmo contrato de resposta do /api/login: { ok, email, name }.
 */
import { createLogger } from "../../lib/logger.mjs";
import { getAllowedUser } from "../../lib/users.mjs";

const log = createLogger("auth-google");

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";

const VALID_ISS = new Set(["accounts.google.com", "https://accounts.google.com"]);

/**
 * Valida as claims já decodificadas de um ID token do Google.
 * Pura (sem rede) para ser testável. Devolve { ok, email, name } ou { ok:false, error }.
 */
export function validateGoogleClaims(claims, { clientId, now = Date.now() } = {}) {
  if (!claims || typeof claims !== "object") {
    return { ok: false, error: "Token inválido." };
  }
  if (!clientId || claims.aud !== clientId) {
    return { ok: false, error: "Token não destinado a esta aplicação." };
  }
  if (!VALID_ISS.has(claims.iss)) {
    return { ok: false, error: "Emissor do token inválido." };
  }
  const expMs = Number(claims.exp) * 1000;
  if (!expMs || expMs < now) {
    return { ok: false, error: "Token expirado." };
  }
  const emailVerified = claims.email_verified === true || claims.email_verified === "true";
  const email = String(claims.email || "").trim().toLowerCase();
  if (!email || !emailVerified) {
    return { ok: false, error: "E-mail do Google não verificado." };
  }
  return { ok: true, email, name: claims.name || email.split("@")[0] };
}

async function fetchTokenInfo(idToken) {
  const r = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
  );
  if (!r.ok) return null;
  return r.json();
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Método não permitido." });
    }
    if (!CLIENT_ID) {
      return res.status(503).json({ ok: false, error: "Login Google não configurado." });
    }

    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (_) { body = {}; }
    }
    body = body || {};

    const idToken = String(body.credential || body.idToken || body.id_token || "");
    if (!idToken) {
      return res.status(400).json({ ok: false, error: "Token do Google ausente." });
    }

    let claims = null;
    try {
      claims = await fetchTokenInfo(idToken);
    } catch (e) {
      log.warn("falha ao validar token no Google", { err: e?.message });
    }
    if (!claims) {
      return res.status(401).json({ ok: false, error: "Não foi possível validar o token do Google." });
    }

    const v = validateGoogleClaims(claims, { clientId: CLIENT_ID });
    if (!v.ok) {
      log.warn("claims do Google rejeitadas", { err: v.error });
      return res.status(401).json({ ok: false, error: v.error });
    }

    let allowed;
    try {
      allowed = await getAllowedUser(v.email);
    } catch (e) {
      log.error("falha ao consultar allowlist (google)", { err: e?.message });
      return res.status(503).json({ ok: false, error: "Serviço de autenticação indisponível." });
    }

    if (!allowed) {
      log.warn("e-mail do Google fora da allowlist", { email: v.email });
      return res.status(403).json({ ok: false, error: "Sua conta Google não tem acesso ao painel." });
    }

    return res.status(200).json({
      ok: true,
      email: allowed.email,
      name: allowed.name || v.name,
      role: allowed.role || "admin",
      eventoId: allowed.eventoId || null,
    });
  } catch (e) {
    log.error("erro inesperado", { err: e?.message });
    return res.status(500).json({ ok: false, error: "Erro interno." });
  }
}
