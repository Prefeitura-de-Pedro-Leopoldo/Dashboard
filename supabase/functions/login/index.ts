// Supabase Edge Function: login (POC da migração dos /api da Vercel).
//
// Equivalente ao POST /api/login da Vercel: valida e-mail/senha contra a tabela
// app_users (mesma que o painel já usa), conferindo a senha em scrypt. Devolve
// o mesmo contrato: { ok, email, name, mustChangePassword, role, eventoId }.
//
// Diferenças de plataforma (Vercel Node -> Supabase Deno):
//   - Deno.serve em vez de handler(req,res); Request/Response da Web.
//   - Banco via supabase-js com a SERVICE_ROLE (ignora RLS, como o dono do BD
//     na Vercel). SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetadas
//     automaticamente no ambiente da função.
//   - CORS explícito (na Vercel era same-origin).
//
// Deploy (você roda):
//   supabase functions deploy login --project-ref gbtbkviprqnblgdwkaxk --no-verify-jwt
//   (--no-verify-jwt porque o login é público; a proteção é a própria senha.)
//
// Testar:
//   curl -i -X POST \
//     https://gbtbkviprqnblgdwkaxk.supabase.co/functions/v1/login \
//     -H "Content-Type: application/json" \
//     -d '{"email":"seu-email","password":"sua-senha"}'

import { createClient } from "jsr:@supabase/supabase-js@2";
import { scryptSync, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Confere senha no formato "scrypt$<salt-hex>$<derivado-hex>" (igual ao Node).
function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored || typeof stored !== "string") return false;
  const [scheme, salt, dk] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !dk) return false;
  const calc = scryptSync(String(password), salt, 64);
  const want = Buffer.from(dk, "hex");
  return calc.length === want.length && timingSafeEqual(calc, want);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Método não permitido." }, 405);

  let body: { email?: string; password?: string };
  try { body = await req.json(); } catch (_) { body = {}; }

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!email || !password) {
    return json({ ok: false, error: "Informe e-mail e senha." }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  let user: {
    email: string; name: string | null; password_hash: string | null;
    role: string | null; active: boolean | null; must_change_password: boolean | null;
    evento_id: string | null;
  } | null = null;
  try {
    const { data, error } = await supabase
      .from("app_users")
      .select("email, name, password_hash, role, active, must_change_password, evento_id")
      .ilike("email", email)
      .limit(1);
    if (error) throw error;
    user = (data && data[0]) || null;
  } catch (_) {
    return json({ ok: false, error: "Serviço de autenticação indisponível." }, 503);
  }

  // Atraso fixo para não vazar (por tempo) se o e-mail existe ou não.
  await delay(250);

  const ativo = user && user.active !== false;
  const ok = !!(ativo && verifyPassword(password, user!.password_hash));
  if (!ok) return json({ ok: false, error: "Credenciais inválidas." }, 401);

  return json({
    ok: true,
    email: String(user!.email).toLowerCase(),
    name: user!.name || email.split("@")[0],
    mustChangePassword: user!.must_change_password === true,
    role: user!.role || "admin",
    eventoId: user!.evento_id || null,
  });
});
