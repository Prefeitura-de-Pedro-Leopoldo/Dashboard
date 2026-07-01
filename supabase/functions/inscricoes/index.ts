// Edge Function: inscricoes (entry). Equivalente ao GET /api/inscricoes.
//   supabase functions deploy inscricoes --project-ref gbtbkviprqnblgdwkaxk --no-verify-jwt
import { handleInscricoes } from "./handler.ts";

const cfg = {
  webappUrl: Deno.env.get("INSCRICOES_WEBAPP_URL") || "",
  token: Deno.env.get("INSCRICOES_TOKEN") || "",
};

Deno.serve((req) => handleInscricoes(req, cfg));
