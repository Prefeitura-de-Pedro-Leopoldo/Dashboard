// Edge Function: satisfacao (entry). Equivalente ao GET /api/satisfacao.
//   supabase functions deploy satisfacao --project-ref gbtbkviprqnblgdwkaxk --no-verify-jwt
import { handleSatisfacao } from "./handler.ts";

Deno.serve((req) =>
  handleSatisfacao(req, {
    webappUrl: Deno.env.get("RELATORIOS_WEBAPP_URL") || "",
    token: Deno.env.get("RELATORIOS_TOKEN") || "",
  })
);
