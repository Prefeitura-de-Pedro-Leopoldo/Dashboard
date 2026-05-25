/**
 * POST /api/login
 * Valida credenciais contra a env var AUTH_USERS (JSON) configurada na Vercel.
 *
 * AUTH_USERS exemplo:
 * [
 *   {"email":"fabiana.silva@pedroleopoldo.mg.gov.br","password":"...","name":"Fabiana Silva"},
 *   ...
 * ]
 */

function parseUsers() {
  const raw = process.env.AUTH_USERS;
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((u) => u && typeof u.email === "string" && typeof u.password === "string")
      .map((u) => ({
        email: u.email.trim().toLowerCase(),
        password: u.password,
        name: u.name || u.email.split("@")[0],
      }));
  } catch (_) {
    return [];
  }
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default async function handler(req, res) {
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
    return res.status(500).json({ ok: false, error: "Servidor sem usuários configurados." });
  }

  const user = users.find((u) => u.email === email);
  // delay constante para mitigar timing/enumeration
  await new Promise((r) => setTimeout(r, 250));

  if (!user || !safeEqual(password, user.password)) {
    return res.status(401).json({ ok: false, error: "Credenciais inválidas." });
  }

  return res.status(200).json({ ok: true, email: user.email, name: user.name });
}
