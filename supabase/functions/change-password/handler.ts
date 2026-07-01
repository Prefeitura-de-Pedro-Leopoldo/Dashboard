// Lógica da troca de senha (testável, DB injetado). Contrato idêntico ao
// POST /api/change-password da Vercel.
import { hashPassword, jsonResponse, preflight, validatePasswordChange, verifyPassword } from "../_shared/auth.ts";
import type { AppUser } from "../login/handler.ts";

export type GetUser = (email: string) => Promise<AppUser | null>;
export type SetPassword = (email: string, passwordHash: string) => Promise<void>; // LANÇA em erro

export interface ChangeDeps {
  getUser: GetUser;
  setPassword: SetPassword;
  delayMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function handleChangePassword(req: Request, deps: ChangeDeps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Método não permitido." }, 405);

  let body: { email?: string; currentPassword?: string; newPassword?: string };
  try { body = await req.json(); } catch (_) { body = {}; }

  const email = String(body?.email || "").trim().toLowerCase();
  const currentPassword = String(body?.currentPassword || "");
  const newPassword = String(body?.newPassword || "");
  if (!email || !currentPassword || !newPassword) {
    return jsonResponse({ ok: false, error: "Informe e-mail, senha atual e nova senha." }, 400);
  }

  const regras = validatePasswordChange({ currentPassword, newPassword });
  if (!regras.ok) return jsonResponse({ ok: false, error: regras.error }, 400);

  let user: AppUser | null;
  try { user = await deps.getUser(email); } catch (_) {
    return jsonResponse({ ok: false, error: "Serviço de autenticação indisponível." }, 503);
  }

  await sleep(deps.delayMs ?? 250);

  if (!user || !user.password_hash || !verifyPassword(currentPassword, user.password_hash)) {
    return jsonResponse({ ok: false, error: "Senha atual incorreta." }, 401);
  }

  try {
    await deps.setPassword(email, hashPassword(newPassword));
  } catch (_) {
    return jsonResponse({ ok: false, error: "Não foi possível salvar a nova senha." }, 500);
  }

  return jsonResponse({ ok: true, email: String(user.email).toLowerCase(), name: user.name || email.split("@")[0] });
}
