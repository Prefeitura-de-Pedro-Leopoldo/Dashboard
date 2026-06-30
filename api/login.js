/**
 * POST /api/login
 * Login por e-mail/senha. A allowlist (quem pode entrar) vem do banco
 * (tabela app_users, via migrations) quando DATABASE_URL está configurado;
 * senão, das envs legadas AUTH_USERS / AUTH_USER_*.
 *
 * Verificação da senha:
 *  - se o usuário tem password_hash no banco → confere com scrypt;
 *  - senão → cai na senha legada em AUTH_USER_* (compat na transição).
 *
 * Convive com o login social (Google) em /api/auth/google, que usa a MESMA
 * allowlist.
 *
 * Os helpers normalizeUser/parseSingleEntry/safeEqual são reexportados de
 * lib/users.mjs para manter a compatibilidade com os testes existentes.
 */
import { createLogger } from "../lib/logger.mjs";
import {
  normalizeUser,
  parseSingleEntry,
  parseEnvUsers,
  safeEqual,
  verifyPassword,
  getAllowedUser,
  hasUserSource,
} from "../lib/users.mjs";

export { normalizeUser, parseSingleEntry, safeEqual };

const log = createLogger("login");

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Método não permitido." });
    }

    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (_) { body = {}; }
    }
    body = body || {};

    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "Informe e-mail e senha." });
    }

    if (!hasUserSource()) {
      return res.status(503).json({ ok: false, error: "Servidor sem usuários configurados." });
    }

    let allowed;
    try {
      allowed = await getAllowedUser(email);
    } catch (e) {
      log.error("falha ao consultar allowlist", { err: e?.message });
      return res.status(503).json({ ok: false, error: "Serviço de autenticação indisponível." });
    }

    // Atraso fixo para não vazar (por tempo) se o e-mail existe ou não.
    await delay(250);

    let ok = false;
    if (allowed) {
      if (allowed.passwordHash) {
        ok = verifyPassword(password, allowed.passwordHash);
      } else {
        // Sem hash no banco: usa a senha legada da env, se houver.
        const envUser = parseEnvUsers().find((u) => u.email === email);
        ok = envUser ? safeEqual(password, envUser.password) : false;
      }
    }

    if (!allowed || !ok) {
      return res.status(401).json({ ok: false, error: "Credenciais inválidas." });
    }

    return res.status(200).json({
      ok: true,
      email: allowed.email,
      name: allowed.name,
      mustChangePassword: !!allowed.mustChangePassword,
    });
  } catch (e) {
    log.error("erro inesperado", { err: e?.message });
    return res.status(500).json({ ok: false, error: "Erro interno." });
  }
}
