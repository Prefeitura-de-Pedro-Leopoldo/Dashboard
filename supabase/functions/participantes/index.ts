// Edge Function: participantes (entry). Equivalente ao GET /api/participantes.
// Reusa o MESMO parser do build-data.mjs (paridade literal com o Node), via o
// import map (xlsx -> npm:xlsx).
//   supabase functions deploy participantes --project-ref gbtbkviprqnblgdwkaxk --no-verify-jwt
import XLSX from "xlsx";
// @ts-ignore: .mjs Node reaproveitado (mesma lógica de parse do build).
import { buildEvento, parsePlanilhaFromWorkbook } from "../../../scripts/build-data.mjs";
import { handleParticipantes } from "./handler.ts";

const SITE_URL = Deno.env.get("SITE_URL") || "https://egov-dashboard.vercel.app/";

Deno.serve((req) =>
  handleParticipantes(req, {
    webappUrl: Deno.env.get("RELATORIOS_WEBAPP_URL") || "",
    token: Deno.env.get("RELATORIOS_TOKEN") || "",
    metaUrl: SITE_URL.replace(/\/?$/, "/") + "assets/docs/relatorios/eventos-meta.json",
    parseWorkbook: (base64: string) => {
      const wb = XLSX.read(base64, { type: "base64", cellDates: true });
      return parsePlanilhaFromWorkbook(wb);
    },
    buildEvento: (rel: string, meta: Record<string, unknown>, participantes: unknown[]) =>
      buildEvento(rel, meta, participantes),
  })
);
