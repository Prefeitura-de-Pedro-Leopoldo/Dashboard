// Edge Function: palestrantes (entry). Equivalente ao POST /api/palestrantes.
//   supabase functions deploy palestrantes --project-ref gbtbkviprqnblgdwkaxk --no-verify-jwt
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handlePalestrantes } from "./handler.ts";
import { provisionarAcessoPalestrante } from "../_shared/palestrante-acesso.ts";

const URL_ = Deno.env.get("PALESTRANTES_WEBAPP_URL") || "";
const TOKEN = Deno.env.get("PALESTRANTES_TOKEN") || "";
const LOGIN_URL = Deno.env.get("SITE_URL") || "https://egov-dashboard.vercel.app/";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

Deno.serve((req) =>
  handlePalestrantes(req, {
    url: URL_,
    token: TOKEN,
    loginUrl: LOGIN_URL,
    provision: (args) => provisionarAcessoPalestrante(supabase, args),
  })
);
