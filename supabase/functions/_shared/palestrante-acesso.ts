// Provisiona o acesso do palestrante (port do lib/palestrante-acesso.mjs).
// Cria/atualiza o app_users e, na 1ª criação, envia o e-mail com as credenciais
// (mailer Apps Script, BCC egov+Fabiana). Idempotente e tolerante.
import { randomInt } from "node:crypto";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { hashPassword } from "./auth.ts";

const MAILER_URL = Deno.env.get("ACESSO_PAL_WEBAPP_URL") ||
  "https://script.google.com/macros/s/AKfycbzDq9D6vC3p8FFAMwISuPVP_ul3oBfcIKi9VKFmqOpb8duGGndrt-DnN8OM8_oP1dqZfw/exec";
const MAILER_TOKEN = Deno.env.get("ACESSO_PAL_TOKEN") || "4Nk4KjOmQv5nXuAUTdRoFctbDED8iNXz9Y048Sl4GVPQjJxh";

export function gerarSenhaProvisoria(): string {
  const U = "ABCDEFGHJKLMNPQRSTUVWXYZ", L = "abcdefghijkmnpqrstuvwxyz", N = "23456789", S = "!@#$%&*";
  const pick = (set: string) => set[randomInt(set.length)];
  const base = [pick(U), pick(L), pick(N), pick(S)];
  const todos = U + L + N + S;
  for (let i = 0; i < 8; i++) base.push(pick(todos));
  for (let i = base.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [base[i], base[j]] = [base[j], base[i]];
  }
  return base.join("");
}

async function enviarEmailAcesso(info: { nome: string; email: string; senha: string; loginUrl: string }): Promise<boolean> {
  if (!MAILER_URL || !MAILER_TOKEN) return false;
  try {
    const r = await fetch(MAILER_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ token: MAILER_TOKEN, ...info }),
      redirect: "follow",
    });
    const j = await r.json().catch(() => null);
    return !!(j && j.ok);
  } catch (_) { return false; }
}

export interface ProvisionInfo { email: string; name: string; eventoId: string | null; loginUrl: string; }

// Cria (1ª vez) ou atualiza o acesso. Nunca lança. { created } indica 1ª criação.
export async function provisionarAcessoPalestrante(
  supabase: SupabaseClient,
  info: ProvisionInfo,
): Promise<{ ok: boolean; created: boolean; emailed: boolean }> {
  const email = String(info.email || "").trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, created: false, emailed: false };
  try {
    const { data: existing, error: selErr } = await supabase
      .from("app_users").select("email").ilike("email", email).limit(1);
    if (selErr) throw selErr;

    if (existing && existing.length) {
      // Já tem acesso: atualiza nome/evento (mantém a senha; sem novo e-mail).
      await supabase.from("app_users").update({
        name: info.name || email.split("@")[0],
        role: "palestrante", active: true, evento_id: info.eventoId, updated_at: new Date().toISOString(),
      }).ilike("email", email);
      return { ok: true, created: false, emailed: false };
    }

    const senha = gerarSenhaProvisoria();
    const { error: insErr } = await supabase.from("app_users").insert({
      email, name: info.name || email.split("@")[0], password_hash: hashPassword(senha),
      role: "palestrante", active: true, must_change_password: true, evento_id: info.eventoId,
    });
    if (insErr) throw insErr;
    const emailed = await enviarEmailAcesso({ nome: info.name || email, email, senha, loginUrl: info.loginUrl });
    return { ok: true, created: true, emailed };
  } catch (_) {
    return { ok: false, created: false, emailed: false };
  }
}
