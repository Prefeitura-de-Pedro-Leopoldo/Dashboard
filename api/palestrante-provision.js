/**
 * POST /api/palestrante-provision
 * Cria (uma vez) o acesso do palestrante ao painel restrito:
 *   - gera uma senha provisória, faz hash (scrypt) e grava em app_users com
 *     role=palestrante, evento_id=<cursoId> e must_change_password=true;
 *   - na 1ª criação, envia o e-mail com as credenciais (via Apps Script
 *     ACESSO_PAL_WEBAPP_URL), com BCC para Escola de Governo + Fabiana.
 * Se o palestrante já tem acesso, atualiza nome/evento e NÃO reseta a senha
 * nem reenvia o e-mail.
 *
 * Body: { email, name, eventoId }
 * Env:  DATABASE_URL, ACESSO_PAL_WEBAPP_URL, ACESSO_PAL_TOKEN
 */
import crypto from "node:crypto";
import { createLogger } from "../lib/logger.mjs";
import { hasDatabase } from "../lib/db.mjs";
import { hashPassword, upsertPalestranteUser } from "../lib/users.mjs";

const log = createLogger("palestrante-provision");

const MAILER_URL = process.env.ACESSO_PAL_WEBAPP_URL || "";
const MAILER_TOKEN = process.env.ACESSO_PAL_TOKEN || "";

// Senha provisória forte e legível (sem caracteres ambíguos). Atende às regras
// de troca de senha (maiúscula, minúscula, número e especial); o must_change
// obriga o palestrante a definir a dele no 1º acesso de qualquer forma.
function gerarSenhaProvisoria() {
  const U = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const L = "abcdefghijkmnpqrstuvwxyz";
  const N = "23456789";
  const S = "!@#$%&*";
  const pick = (set) => set[crypto.randomInt(set.length)];
  const base = [pick(U), pick(L), pick(N), pick(S)];
  const todos = U + L + N + S;
  for (let i = 0; i < 8; i++) base.push(pick(todos));
  // Embaralha (Fisher-Yates com randomInt).
  for (let i = base.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [base[i], base[j]] = [base[j], base[i]];
  }
  return base.join("");
}

async function enviarEmailAcesso({ nome, email, senha, loginUrl }) {
  if (!MAILER_URL || !MAILER_TOKEN) {
    log.warn("mailer de acesso não configurado (ACESSO_PAL_WEBAPP_URL/TOKEN)");
    return { ok: false, error: "mailer-nao-configurado" };
  }
  const r = await fetch(MAILER_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ token: MAILER_TOKEN, nome, email, senha, loginUrl }),
    redirect: "follow",
  });
  const text = await r.text();
  try { return JSON.parse(text); } catch (_) { return { ok: false, error: text.slice(0, 200) }; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Método não permitido." });
  }
  if (!hasDatabase()) {
    return res.status(503).json({ ok: false, error: "Banco de usuários não configurado." });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = null; } }
  body = body || {};

  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const eventoId = String(body.eventoId || "").trim() || null;

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: "E-mail inválido." });
  }

  try {
    const senha = gerarSenhaProvisoria();
    const passwordHash = hashPassword(senha);
    const { created } = await upsertPalestranteUser({ email, name, eventoId, passwordHash });

    let emailed = false;
    if (created) {
      const proto = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers.host;
      const loginUrl = `${proto}://${host}/`;
      const mail = await enviarEmailAcesso({ nome: name || email, email, senha, loginUrl });
      emailed = !!(mail && mail.ok);
      if (!emailed) log.warn("acesso criado mas e-mail não enviado", { email, err: mail?.error });
    }

    // Nunca devolve a senha ao cliente (vai só por e-mail).
    return res.status(200).json({ ok: true, created, emailed });
  } catch (e) {
    log.error("falha ao provisionar palestrante", { email, err: e?.message });
    return res.status(500).json({ ok: false, error: "Erro ao criar o acesso do palestrante." });
  }
}
