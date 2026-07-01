// Lógica do login (testável, sem depender do runtime). O acesso ao banco entra
// por injeção de dependência (getUser), então os testes cobrem todos os caminhos
// sem banco real, e o entry (index.ts) liga o getUser real via supabase-js.
import { verifyPassword, jsonResponse, CORS_HEADERS } from "../_shared/auth.ts";

export interface AppUser {
  email: string;
  name: string | null;
  password_hash: string | null;
  role: string | null;
  active: boolean | null;
  must_change_password: boolean | null;
  evento_id: string | null;
}

// Busca o usuário por e-mail (case-insensitive). Deve LANÇAR em erro de banco
// (para o handler devolver 503), e retornar null quando não existe.
export type GetUser = (email: string) => Promise<AppUser | null>;

export interface LoginDeps {
  getUser: GetUser;
  delayMs?: number; // atraso anti-timing (padrão 250ms; testes passam 0)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Mesmo contrato do POST /api/login da Vercel.
export async function handleLogin(req: Request, deps: LoginDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Método não permitido." }, 405);

  let body: { email?: string; password?: string };
  try { body = await req.json(); } catch (_) { body = {}; }

  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");
  if (!email || !password) {
    return jsonResponse({ ok: false, error: "Informe e-mail e senha." }, 400);
  }

  let user: AppUser | null;
  try {
    user = await deps.getUser(email);
  } catch (_) {
    return jsonResponse({ ok: false, error: "Serviço de autenticação indisponível." }, 503);
  }

  // Atraso fixo para não vazar (por tempo) se o e-mail existe ou não.
  await sleep(deps.delayMs ?? 250);

  const ativo = !!user && user.active !== false;
  const ok = ativo && verifyPassword(password, user!.password_hash);
  if (!ok) return jsonResponse({ ok: false, error: "Credenciais inválidas." }, 401);

  return jsonResponse({
    ok: true,
    email: String(user!.email).toLowerCase(),
    name: user!.name || email.split("@")[0],
    mustChangePassword: user!.must_change_password === true,
    role: user!.role || "admin",
    eventoId: user!.evento_id || null,
  });
}
