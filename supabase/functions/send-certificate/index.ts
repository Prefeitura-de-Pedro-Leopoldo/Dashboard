// Edge Function: send-certificate (entry). Equivalente ao POST /api/send-certificate.
// Repassa o corpo (com o PDF) ao Apps Script que envia o certificado do inscrito.
// A URL vem embutida (mesmo default do /api da Vercel); a env sobrepõe se definida.
import { handlePostProxy } from "../_shared/appscript.ts";

const WEBAPP_URL =
  Deno.env.get("CERT_WEBAPP_URL") ||
  "https://script.google.com/macros/s/AKfycbwAVbJ8bKzBpKSlSwPEsX815JJrTkhZu0mXwDccL6H9FrIc_g0kd3GCLiVtzZA29-Kc/exec";

Deno.serve((req) => handlePostProxy(req, { url: WEBAPP_URL }));
