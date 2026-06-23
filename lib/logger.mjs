// Logger estruturado mínimo para o back-end (Vercel Functions).
//
// Emite UMA linha JSON por evento, com timestamp, nível, serviço, mensagem e
// um contexto opcional. Estruturado = pesquisável nos logs do Vercel (filtrar
// por serviço, nível, ou um identificador como `folder`/`evento`).
//
// Segurança (seção 9): chaves de contexto cujo nome sugere segredo (senha,
// token, secret, authorization, cookie, api key) são redigidas. Nunca passe
// senhas/tokens como VALOR sob uma chave neutra - a redação é por nome de chave.

const SENSITIVE_KEY = /(senha|password|token|secret|authorization|cookie|api[_-]?key)/i;

function sanitize(context) {
  if (!context || typeof context !== "object") return undefined;
  const out = {};
  for (const [key, value] of Object.entries(context)) {
    out[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : value;
  }
  return out;
}

function emit(level, service, message, context) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    service,
    message: String(message),
  };
  const ctx = sanitize(context);
  if (ctx) entry.context = ctx;

  let line;
  try {
    line = JSON.stringify(entry);
  } catch {
    // Contexto não serializável (ex.: referência circular): cai para o essencial.
    line = JSON.stringify({ ts: entry.ts, level, service, message: entry.message });
  }

  // console.* é o transporte que o Vercel coleta. error/warn vão para stderr.
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  sink(line);
}

// Cria um logger amarrado a um nome de serviço (ex.: "login", "eventos").
export function createLogger(service) {
  return {
    info: (message, context) => emit("info", service, message, context),
    warn: (message, context) => emit("warn", service, message, context),
    error: (message, context) => emit("error", service, message, context),
  };
}
