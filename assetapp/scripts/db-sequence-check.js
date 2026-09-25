/**
 * Stale id sequences — read-only.
 *
 *   node scripts/db-sequence-check.js
 *
 * A sequence behind its column's max id means the next INSERT collides and
 * fails (that is what happened to `employee_numbers_id_seq`: max id 5 while the
 * sequence sat at 1, so creating a Department Head from the app errored).
 * Fix with:  SELECT setval('<seq>', (SELECT max(id) FROM <table>));
 */
const fs = require('fs');
const { Client } = require('pg');
const env = fs.readFileSync('.env', 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1] || '';
const url = new URL(get('EXPO_PUBLIC_SUPABASE_URL') || 'https://mpzkrhaxbdvgkvphkqqb.supabase.co');
const ref = url.hostname.split('.')[0];

(async () => {
  const client = new Client({
    host: 'aws-1-ap-southeast-1.pooler.supabase.com',
    port: 5432,
    database: 'postgres',
    user: `postgres.${ref}`,
    password: get('SUPABASE_DB_PASSWORD') || 'Ass3T_M@nA6eMent',
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const res = await client.query(`
    SELECT c.relname AS table_name,
           a.attname AS column_name,
           pg_get_serial_sequence(quote_ident(n.nspname) || '.' || quote_ident(c.relname), a.attname) AS seq
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE c.relkind = 'r' AND a.attname = 'id'
    ORDER BY c.relname
  `);

  for (const row of res.rows) {
    if (!row.seq) continue;
    const state = await client.query(
      `SELECT (SELECT COALESCE(max("${row.column_name}"), 0) FROM public."${row.table_name}") AS max_id,
              (SELECT last_value FROM ${row.seq}) AS last_value`,
    );
    const { max_id: maxId, last_value: lastValue } = state.rows[0];
    const behind = Number(lastValue) < Number(maxId);
    console.log(
      `${behind ? '✗' : '✓'} ${row.table_name}.${row.column_name}: max=${maxId} seq=${lastValue}` +
        (behind ? '   <-- next insert will collide' : ''),
    );
  }

  await client.end();
})().catch((e) => console.log('failed:', e.message));
