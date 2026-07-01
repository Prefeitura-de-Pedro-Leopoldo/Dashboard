// Edge Function: certificado (entry). Equivalente ao /api/certificado.
// IMPORTANTE: se a Vercel usa um CERT_SECRET custom, configure o MESMO como
// secret aqui (supabase secrets set CERT_SECRET=...), senão os códigos já
// emitidos não validam. Sem env, usa o mesmo default do código Node.
//   supabase functions deploy certificado --project-ref gbtbkviprqnblgdwkaxk --no-verify-jwt
import { handleCertificado } from "./handler.ts";

const SECRET = Deno.env.get("CERT_SECRET") || "egov-pl-cert-dev-secret-DEFINA-CERT_SECRET";

Deno.serve((req) => handleCertificado(req, SECRET));
