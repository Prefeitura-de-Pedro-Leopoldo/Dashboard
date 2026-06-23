/**
 * POST /api/login
 * Valida credenciais contra env vars configuradas na Vercel.
 *
 * Aceita dois formatos:
 *  1) Uma única env AUTH_USERS contendo array JSON.
 *  2) Várias envs com prefixo AUTH_USER_ (ex: AUTH_USER_FABIANA), cada uma
 *     no formato "email|senha|Nome Completo" OU um JSON
 *     {"email":"...","password":"...","name":"..."}.
 */

import { createLogger } from "../lib/logger.mjs";

const log = createLogger("login");

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
      const obj = JSON.parse(trimmed);
      return normalizeUser(obj);
    } catch (e) {
      log.warn("entrada de usuário com JSON inválido", { err: e.message });
      return null;
    }
  }
  const parts = trimmed.split("|");
  if (parts.length < 2) return null;
  return normalizeUser({
    email: parts[0],
    password: parts[1],
    name: parts[2] || "",
  });
}

function parseUsers() {
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
    if (!key.startsWith("AUTH_USER_")) continue;
    if (!value) continue;
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

  if (dedup.length === 0) {
    log.error("nenhum usuário configurado (defina AUTH_USERS ou AUTH_USER_*)");
  }
  return dedup;
}

export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

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

    const users = parseUsers();
    if (users.length === 0) {
      return res.status(503).json({ ok: false, error: "Servidor sem usuários configurados." });
    }

    const user = users.find((u) => u.email === email);
    await new Promise((r) => setTimeout(r, 250));

    if (!user || !safeEqual(password, user.password)) {
      return res.status(401).json({ ok: false, error: "Credenciais inválidas." });
    }

    return res.status(200).json({ ok: true, email: user.email, name: user.name });
  } catch (e) {
    log.error("erro inesperado", { err: e?.message });
    return res.status(500).json({ ok: false, error: "Erro interno." });
  }
}
