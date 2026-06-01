// Build step: baixa os relatorios .xlsx do Drive (via Web App servirRelatorios.gs)
// para assets/docs/relatorios/, espelhando a estrutura de subpastas.
//
// Roda ANTES de normalize-planilhas.mjs e build-data.mjs. Se as env vars
// RELATORIOS_WEBAPP_URL / RELATORIOS_TOKEN nao estiverem definidas, apenas
// avisa e segue com os arquivos que ja estiverem em disco (util no local).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RELATORIOS_DIR = path.join(ROOT, "assets", "docs", "relatorios");

const WEBAPP_URL = process.env.RELATORIOS_WEBAPP_URL || "";
const TOKEN = process.env.RELATORIOS_TOKEN || "";

async function getJson(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Impede que um caminho do Drive escape de RELATORIOS_DIR.
function destinoSeguro(relPath) {
  let limpo = String(relPath).replace(/\\/g, "/").replace(/^\/+/, "");
  // Tolera pastas no Drive que incluam o prefixo "assets/docs/relatorios/"
  // (quando se arrasta a pasta inteira do projeto para o Drive).
  limpo = limpo.replace(/^(?:\.?\/)?assets\/docs\/relatorios\//i, "");
  const dest = path.normalize(path.join(RELATORIOS_DIR, limpo));
  if (dest !== RELATORIOS_DIR && !dest.startsWith(RELATORIOS_DIR + path.sep)) {
    throw new Error(`Caminho suspeito ignorado: ${relPath}`);
  }
  return dest;
}

async function main() {
  if (!WEBAPP_URL || !TOKEN) {
    console.warn(
      "[pull-relatorios] RELATORIOS_WEBAPP_URL/RELATORIOS_TOKEN ausentes — " +
        "pulando download e usando os arquivos locais existentes."
    );
    return;
  }

  console.log("[pull-relatorios] baixando manifesto do Drive…");
  const man = await getJson(`${WEBAPP_URL}?action=manifest&token=${encodeURIComponent(TOKEN)}`);
  if (!man.ok) throw new Error(`manifest: ${man.error || "falha"}`);

  const files = Array.isArray(man.files) ? man.files : [];
  console.log(`[pull-relatorios] ${files.length} arquivo(s) no Drive.`);

  let baixados = 0;
  for (const file of files) {
    let dest;
    try {
      dest = destinoSeguro(file.path);
    } catch (e) {
      console.warn(`  ! ${e.message}`);
      continue;
    }
    const data = await getJson(
      `${WEBAPP_URL}?action=file&token=${encodeURIComponent(TOKEN)}&id=${encodeURIComponent(file.id)}`
    );
    if (!data.ok || !data.base64) {
      console.warn(`  ! falha ao baixar ${file.path}: ${data.error || "sem conteudo"}`);
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(data.base64, "base64"));
    baixados++;
  }

  console.log(`[pull-relatorios] ${baixados}/${files.length} arquivo(s) salvos em assets/docs/relatorios/.`);
}

main().catch((err) => {
  console.error("[pull-relatorios] ERRO:", err.message);
  process.exit(1);
});
