// migrate.mjs - runner de migrations SQL simples (sem dependências além de pg).
//
// Aplica, em ordem, os arquivos migrations/*.sql ainda não registrados na
// tabela schema_migrations. Cada arquivo roda em uma transação; em erro, faz
// ROLLBACK e aborta. É idempotente: rodar de novo só aplica os pendentes.
//
// Uso: node --env-file=.env.local scripts/migrate.mjs
//      (ou defina DATABASE_URL no ambiente)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "migrations");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL ausente. Defina no .env.local (ou no ambiente).");
  process.exit(1);
}

const isLocal = /@(localhost|127\.0\.0\.1)(:|\/)/.test(url);
const sslDisabled = /sslmode=disable/i.test(url) || process.env.PGSSL === "disable";

const client = new pg.Client({
  connectionString: url,
  ssl: isLocal || sslDisabled ? false : { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename   TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`
  );

  const applied = new Set(
    (await client.query("SELECT filename FROM schema_migrations")).rows.map((r) => r.filename)
  );

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.toLowerCase().endsWith(".sql"))
    .sort();

  if (!files.length) {
    console.warn(`[migrate] nenhum .sql em ${MIGRATIONS_DIR}.`);
  }

  let aplicadas = 0;
  for (const f of files) {
    if (applied.has(f)) {
      console.log(`[migrate] = ${f} (já aplicada)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf-8");
    console.log(`[migrate] ▶ aplicando ${f}…`);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [f]);
      await client.query("COMMIT");
      aplicadas++;
      console.log(`[migrate] ✓ ${f}`);
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(`[migrate] ✗ ${f}: ${e.message}`);
      throw e;
    }
  }

  console.log(`[migrate] concluído: ${aplicadas} aplicada(s) agora, ${files.length} no total.`);
  await client.end();
}

main().catch(async (e) => {
  console.error("[migrate] ERRO:", e.message);
  try { await client.end(); } catch (_) { /* ignore */ }
  process.exit(1);
});
