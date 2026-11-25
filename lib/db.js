/**
 * Conexão com o Postgres.
 * - Neon (integração do Vercel): usa o driver HTTP serverless.
 * - Outro Postgres (Supabase etc.): usa o driver "pg".
 * Variáveis aceitas: DATABASE_URL ou POSTGRES_URL.
 */
let runner = null;
let runnerPromise = null;
let schemaReady = null;

function getRunner() {
  if (!runnerPromise) runnerPromise = createRunner().catch((e) => { runnerPromise = null; throw e; });
  return runnerPromise;
}

async function createRunner() {
  if (process.env.PGLITE_MODULE) { // só para testes locais
    const { PGlite } = await import(process.env.PGLITE_MODULE);
    const db = new PGlite(process.env.PGLITE_DIR || undefined);
    runner = async (text, params = []) => (await db.query(text, params)).rows;
    return runner;
  }
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || '';
  if (!url) throw new Error('Banco não configurado: defina DATABASE_URL no Vercel (Storage > Neon).');
  if (/neon\.tech/i.test(url)) {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(url);
    runner = (text, params = []) => sql.query(text, params);
  } else {
    const pg = (await import('pg')).default;
    const pool = new pg.Pool({ connectionString: url, max: 3, ssl: /sslmode=disable|localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
    runner = async (text, params = []) => (await pool.query(text, params)).rows;
  }
  return runner;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS leads (
    id BIGSERIAL PRIMARY KEY,
    product TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'novo', notes TEXT NOT NULL DEFAULT '', submissions INTEGER NOT NULL DEFAULT 0,
    utm_source TEXT NOT NULL DEFAULT '', utm_medium TEXT NOT NULL DEFAULT '', utm_campaign TEXT NOT NULL DEFAULT '',
    utm_content TEXT NOT NULL DEFAULT '', utm_term TEXT NOT NULL DEFAULT '', fbclid TEXT NOT NULL DEFAULT '',
    fbp TEXT NOT NULL DEFAULT '', fbc TEXT NOT NULL DEFAULT '', vid TEXT NOT NULL DEFAULT '',
    referrer TEXT NOT NULL DEFAULT '', landing TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '', ua TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT '', submitted_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '',
    paid_at TEXT NOT NULL DEFAULT '', paid_value NUMERIC(12,2) NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS ix_leads_product_email ON leads(product, email)`,
  `CREATE INDEX IF NOT EXISTS ix_leads_product_phone ON leads(product, phone)`,
  `CREATE INDEX IF NOT EXISTS ix_leads_created ON leads(created_at)`,
  `CREATE INDEX IF NOT EXISTS ix_leads_submitted ON leads(submitted_at)`,
  `CREATE INDEX IF NOT EXISTS ix_leads_paid ON leads(paid_at)`,
  `CREATE TABLE IF NOT EXISTS events (day TEXT NOT NULL, product TEXT NOT NULL, name TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, product, name))`,
  `CREATE TABLE IF NOT EXISTS settings (scope TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL DEFAULT '', PRIMARY KEY (scope, k))`,
  `CREATE TABLE IF NOT EXISTS hits (k TEXT PRIMARY KEY, n INTEGER NOT NULL, reset BIGINT NOT NULL)`
];

/** Executa uma consulta com parâmetros $1, $2… e devolve as linhas. Cria as tabelas na primeira chamada. */
export async function q(text, params = []) {
  const run = await getRunner();
  if (!schemaReady) {
    schemaReady = (async () => { for (const s of SCHEMA) await run(s); })().catch((e) => { schemaReady = null; throw e; });
  }
  await schemaReady;
  return run(text, params);
}
