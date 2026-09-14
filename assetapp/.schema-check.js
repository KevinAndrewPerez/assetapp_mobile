const { Client } = require('pg');

// Read-only schema inspection using the project's own .env connection string.
const env = require('fs').readFileSync('.env', 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1] || '';
const url = new URL(get('EXPO_PUBLIC_SUPABASE_URL') || 'https://mpzkrhaxbdvgkvphkqqb.supabase.co');
const ref = url.hostname.split('.')[0];

const client = new Client({
  host: `aws-1-ap-southeast-1.pooler.supabase.com`,
  port: 5432,
  database: 'postgres',
  user: `postgres.${ref}`,
  password: get('SUPABASE_DB_PASSWORD') || 'Ass3T_M@nA6eMent',
  ssl: { rejectUnauthorized: false },
});

(async () => {
  try {
    await client.connect();
    const res = await client.query(`
      SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid IN ('public.requests'::regclass, 'public.repairs'::regclass)
        AND contype = 'c'
      ORDER BY 1, 2
    `);
    for (const row of res.rows) console.log(`${row.tbl} :: ${row.conname}: ${row.def}`);

    const cols = await client.query(`
      SELECT table_name, column_name, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('requests', 'repairs', 'pullouts')
        AND column_name ILIKE '%status%'
      ORDER BY table_name, column_name
    `);
    for (const c of cols.rows) console.log(`${c.table_name}.${c.column_name}: ${c.udt_name}`);
  } catch (err) {
    console.error('Error:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
