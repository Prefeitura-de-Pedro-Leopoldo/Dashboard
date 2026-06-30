/**
 * users.mjs - allowlist e credenciais dos usuários do painel.
 *
 * Fonte de verdade da allowlist:
 *   1) Se DATABASE_URL estiver configurado → tabela `app_users` (criada via
 *      migrations). Só e-mails ativos nessa tabela conseguem entrar.
 *   2) Senão (modo legado) → envs AUTH_USERS / AUTH_USER_* do .env.
 *
 * Senhas: a tabela guarda `password_hash` (scrypt). Quando o usuário não tem
 * hash no banco, o login por senha cai no valor legado em AUTH_USER_* (compat
 * durante a transição). O login social (Google) só consulta a allowlist.
 */
import crypto from "node:crypto";
import { hasDatabase, query } from "./db.mjs";
import { createLogger } from "./logger.mjs";

const log = createLogger("users");

// ---- parsing das envs legadas (AUTH_USERS / AUTH_USER_*) --------------------

export function normalizeUser(u) {
  if (!u || typeof u.email !== "string" || typeof u.password !== "string") return null;
  return {
    email: u.email.trim().toLowerCase(),
    password: u.password,
    name: u.name || u.email.split("@")[0],
  };
}

export function parseSingleEntry(raw) {
  const trimmed = String(raw).trim();
  if (trimmed.startsWith("{")) {
    try {
      return normalizeUser(JSON.parse(trimmed));
    } catch (e) {
      log.warn("entrada de usuário com JSON inválido", { err: e.message });
      return null;
    }
  }
  const parts = trimmed.split("|");
  if (parts.length < 2) return null;
  return normalizeUser({ email: parts[0], password: parts[1], name: parts[2] || "" });
}

export function parseEnvUsers() {
  const out = [];

  const bulk = process.env.AUTH_USERS;
  if (bulk) {
    try {
      const arr = JSON.parse(bulk);
      if (Array.isArray(arr)) {
        for (const u of arr) {
          const n = normalizeUser(u);
          if (n) out.push(n);
        }
      } else {
        log.warn("AUTH_USERS não é um array JSON");
      }
    } catch (e) {
      log.warn("falha ao parsear AUTH_USERS", { err: e.message });
    }
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("AUTH_USER_") || !value) continue;
    const u = parseSingleEntry(value);
    if (u) out.push(u);
    else log.warn('env de usuário inválida (use "email|senha|Nome")', { env: key });
  }

  const seen = new Set();
  const dedup = [];
  for (const u of out) {
    if (seen.has(u.email)) continue;
    seen.add(u.email);
    dedup.push(u);
  }
  return dedup;
}

// ---- comparação/senha -------------------------------------------------------

export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Hash de senha no formato "scrypt$<salt-hex>$<derivado-hex>".
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const dk = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt$${salt}$${dk}`;
}

export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string") return false;
  const [scheme, salt, dk] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !dk) return false;
  const calc = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return safeEqual(calc, dk);
}

// ---- allowlist (DB ou env) --------------------------------------------------

/**
 * Devolve o usuário permitido (ativo) para o e-mail, ou null se não autorizado.
 * Formato: { email, name, passwordHash, role, source }.
 * Usa o banco quando configurado; senão, as envs legadas.
 */
export async function getAllowedUser(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return null;

  if (hasDatabase()) {
    const { rows } = await query(
      `SELECT email, name, password_hash, role, active, must_change_password
         FROM app_users
        WHERE lower(email) = lower($1)
        LIMIT 1`,
      [e]
    );
    const u = rows[0];
    if (!u || u.active === false) return null;
    return {
      email: String(u.email).toLowerCase(),
      name: u.name || e.split("@")[0],
      passwordHash: u.password_hash || null,
      role: u.role || "admin",
      mustChangePassword: u.must_change_password === true,
      source: "db",
    };
  }

  const envUser = parseEnvUsers().find((u) => u.email === e);
  if (!envUser) return null;
  return {
    email: envUser.email,
    name: envUser.name,
    passwordHash: null,
    role: "admin",
    mustChangePassword: false,
    source: "env",
  };
}

// Grava nova senha (hash scrypt) e limpa a flag de troca obrigatória. Só DB.
export async function setUserPassword(email, passwordHash) {
  const e = String(email || "").trim().toLowerCase();
  const { rowCount } = await query(
    `UPDATE app_users
        SET password_hash = $2,
            must_change_password = false,
            updated_at = now()
      WHERE lower(email) = lower($1)`,
    [e, passwordHash]
  );
  return rowCount > 0;
}

// Regras da nova senha na troca. Pura (testável). Devolve { ok, error }.
export function validatePasswordChange({ currentPassword, newPassword }) {
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
    return { ok: false, error: "A nova senha deve ter pelo menos 8 caracteres." };
  }
  if (newPassword === currentPassword) {
    return { ok: false, error: "A nova senha deve ser diferente da atual." };
  }
  return { ok: true };
}

// Indica se há ALGUMA fonte de allowlist configurada (banco ou envs).
export function hasUserSource() {
  return hasDatabase() || parseEnvUsers().length > 0;
}
