// Edge Function: lembretes (entry). Equivalente ao POST /api/lembretes.
// Proxy para o lembretesEventos.gs (config de encontros/lembrete). Injeta o token
// no servidor e valida a ação. Usa o proxy compartilhado (testado).
//   supabase functions deploy lembretes --project-ref gbtbkviprqnblgdwkaxk --no-verify-jwt
import { handlePostProxy } from "../_shared/appscript.ts";

const WEBAPP_URL = Deno.env.get("LEMBRETES_WEBAPP_URL") || "";
const TOKEN = Deno.env.get("LEMBRETES_TOKEN") || "";
const ALLOWED = new Set(["config-get", "config-save"]);

Deno.serve((req) => handlePostProxy(req, { url: WEBAPP_URL, token: TOKEN, allowedActions: ALLOWED }));
