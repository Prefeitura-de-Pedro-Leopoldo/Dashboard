/**
 * POST /api/change-password
 * Troca de senha (usada no primeiro acesso, quando must_change_password=true,
 * mas serve para troca voluntária também).
 *
 * Body: { email, currentPassword, newPassword }.
 * Confere a senha atual contra o hash do banco, valida a nova e grava o novo
 * hash (scrypt), limpando a flag de troca obrigatória.
 *
 * Requer banco (DATABASE_URL): a senha é gerida em app_users. Login social
 * (Google) não passa por aqui.
 */
import { createLogger } from "../lib/logger.mjs";
import { hasDatabase } from "../lib/db.mjs";
import {
  getAllowedUser,
  verifyPassword,
  hashPassword,
  setUserPassword,
  validatePasswordChange,
} from "../lib/users.mjs";

const log = createLogger("change-password");

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Método não permitido." });
    }
    if (!hasDatabase()) {
      return res.status(503).json({ ok: false, error: "Troca de senha indisponível (sem banco)." });
    }

    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (_) { body = {}; }
    }
    body = body || {};

    const email = String(body.email || "").trim().toLowerCase();
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");

    if (!email || !currentPassword || !newPassword) {
      return res.status(400).json({ ok: false, error: "Informe e-mail, senha atual e nova senha." });
    }

    const regras = validatePasswordChange({ currentPassword, newPassword });
    if (!regras.ok) {
      return res.status(400).json({ ok: false, error: regras.error });
    }

    let allowed;
    try {
      allowed = await getAllowedUser(email);
    } catch (e) {
      log.error("falha ao consultar allowlist", { err: e?.message });
      return res.status(503).json({ ok: false, error: "Serviço de autenticação indisponível." });
    }

    await delay(250);

    if (!allowed || !allowed.passwordHash || !verifyPassword(currentPassword, allowed.passwordHash)) {
      return res.status(401).json({ ok: false, error: "Senha atual incorreta." });
    }

    try {
      await setUserPassword(email, hashPassword(newPassword));
    } catch (e) {
      log.error("falha ao gravar nova senha", { err: e?.message });
      return res.status(500).json({ ok: false, error: "Não foi possível salvar a nova senha." });
    }

    return res.status(200).json({ ok: true, email: allowed.email, name: allowed.name });
  } catch (e) {
    log.error("erro inesperado", { err: e?.message });
    return res.status(500).json({ ok: false, error: "Erro interno." });
  }
}
