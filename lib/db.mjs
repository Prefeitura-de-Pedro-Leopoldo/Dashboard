/**
 * db.mjs - acesso ao PostgreSQL (allowlist de usuários do painel).
 *
 * A conexão vem de DATABASE_URL. Se a env não estiver definida, hasDatabase()
 * devolve false e o resto da aplicação cai no modo legado (allowlist por
 * AUTH_USER_* no .env) - assim o painel continua funcionando antes do banco
 * ser provisionado.
 *
 * SSL: habilitado por padrão (rejectUnauthorized:false p/ certificados
 * self-signed do servidor institucional). Desliga para localhost ou quando a
 * URL trouxer sslmode=disable / PGSSL=disable.
 */
import pg from "pg";

let _pool = null;

export function hasDatabase() {
  return !!process.env.DATABASE_URL;
}

function sslConfig(url) {
  const isLocal = /@(localhost|127\.0\.0\.1)(:|\/)/.test(url);
  const disabled = /sslmode=disable/i.test(url) || process.env.PGSSL === "disable";
  if (isLocal || disabled) return false;
  return { rejectUnauthorized: false };
}

export function getPool() {
  if (!hasDatabase()) return null;
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  _pool = new pg.Pool({
    connectionString: url,
    ssl: sslConfig(url),
    max: Number(process.env.PGPOOL_MAX || 3),
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000,
  });
  _pool.on("error", () => {
    // Erro em conexão ociosa do pool: não derruba o processo. A próxima query
    // recria a conexão. (Sem isso, um socket caído viraria uncaught exception.)
  });
  return _pool;
}

export async function query(text, params) {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL não configurado.");
  try {
    return await pool.query(text, params);
  } catch (e) {
    // Poolers (ex.: Supabase) podem encerrar conexões ociosas; uma nova
    // tentativa pega uma conexão fresca do pool. Só re-tenta em erro de
    // conexão (não em erro de SQL/dados).
    const msg = String((e && e.message) || "");
    if (/terminated|ECONNRESET|reset by peer|timeout|socket hang up/i.test(msg)) {
      return pool.query(text, params);
    }
    throw e;
  }
}
