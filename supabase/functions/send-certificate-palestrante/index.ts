// Edge Function: send-certificate-palestrante (entry). Equivalente ao POST
// /api/send-certificate-palestrante. Repassa ao Apps Script dos certificados de
// PALESTRANTES. URL embutida (mesmo default do /api); env sobrepõe se definida.
import { handlePostProxy } from "../_shared/appscript.ts";

const WEBAPP_URL =
  Deno.env.get("CERT_PAL_WEBAPP_URL") ||
  "https://script.google.com/macros/s/AKfycbyCyREbNiSnzEmhSByQDon10pUeLHNNCS_GButNdiPnT0AeQU5pjlSN_9xB_qtSKf5H/exec";

Deno.serve((req) => handlePostProxy(req, { url: WEBAPP_URL }));
