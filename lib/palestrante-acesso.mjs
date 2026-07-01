/**
 * Provisiona o acesso do palestrante ao painel restrito:
 *   - gera senha provisória, faz hash (scrypt) e grava em app_users com
 *     role=palestrante, evento_id=<cursoId> e must_change_password=true;
 *   - na 1ª criação, envia o e-mail com as credenciais (Apps Script mailer),
 *     com BCC para Escola de Governo + Fabiana.
 * Se o palestrante já tem acesso, atualiza nome/evento e NÃO reseta a senha
 * nem reenvia o e-mail.
 *
 * Fica fora de api/ para não contar como Serverless Function (limite do plano).
 */
import crypto from "node:crypto";
import { hasDatabase } from "./db.mjs";
import { hashPassword, upsertPalestranteUser } from "./users.mjs";
import { createLogger } from "./logger.mjs";

const log = createLogger("palestrante-acesso");

// URL e token do mailer já vêm embutidos (mesmo padrão do send-certificate.js);
// as envs, se definidas, têm precedência.
const MAILER_URL =
  process.env.ACESSO_PAL_WEBAPP_URL ||
  "https://script.google.com/macros/s/AKfycbzDq9D6vC3p8FFAMwISuPVP_ul3oBfcIKi9VKFmqOpb8duGGndrt-DnN8OM8_oP1dqZfw/exec";
const MAILER_TOKEN =
  process.env.ACESSO_PAL_TOKEN || "4Nk4KjOmQv5nXuAUTdRoFctbDED8iNXz9Y048Sl4GVPQjJxh";

// Senha provisória forte e legível (sem caracteres ambíguos).
function gerarSenhaProvisoria() {
  const U = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const L = "abcdefghijkmnpqrstuvwxyz";
  const N = "23456789";
  const S = "!@#$%&*";
  const pick = (set) => set[crypto.randomInt(set.length)];
  const base = [pick(U), pick(L), pick(N), pick(S)];
  const todos = U + L + N + S;
  for (let i = 0; i < 8; i++) base.push(pick(todos));
  for (let i = base.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [base[i], base[j]] = [base[j], base[i]];
  }
  return base.join("");
}

async function enviarEmailAcesso({ nome, email, senha, loginUrl }) {
  if (!MAILER_URL || !MAILER_TOKEN) {
    log.warn("mailer de acesso não configurado");
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

// Provisiona (idempotente). Nunca lança: devolve { ok, created, emailed }.
export async function provisionarAcessoPalestrante({ email, name, eventoId, loginUrl }) {
  const e = String(email || "").trim().toLowerCase();
  if (!hasDatabase()) return { ok: false, created: false, emailed: false, error: "sem-banco" };
  if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
    return { ok: false, created: false, emailed: false, error: "email-invalido" };
  }
  try {
    const senha = gerarSenhaProvisoria();
    const passwordHash = hashPassword(senha);
    const { created } = await upsertPalestranteUser({ email: e, name, eventoId: eventoId || null, passwordHash });
    let emailed = false;
    if (created) {
      const mail = await enviarEmailAcesso({ nome: name || e, email: e, senha, loginUrl });
      emailed = !!(mail && mail.ok);
      if (!emailed) log.warn("acesso criado mas e-mail não enviado", { email: e, err: mail?.error });
    }
    return { ok: true, created, emailed };
  } catch (err) {
    log.error("falha ao provisionar acesso do palestrante", { email: e, err: err?.message });
    return { ok: false, created: false, emailed: false, error: "erro" };
  }
}
