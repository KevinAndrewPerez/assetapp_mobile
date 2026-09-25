/**
 * Can a password written by the app actually sign in?
 *
 *   node scripts/db-password-check.js
 *
 * Everything runs inside a transaction that is ROLLED BACK, so the database is
 * left exactly as it was. It proves the whole mobile password story against the
 * real schema:
 *   1. a `$2y$`-tagged bcryptjs hash (what the app now writes) signs in
 *      through `verify_user_password`
 *   2. the untagged `$2b$` digest (what the app used to write) does not
 *   3. the code the web stores in `password_resets` verifies with bcryptjs
 */
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

const env = fs.readFileSync('.env', 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1] || '';
const url = new URL(get('EXPO_PUBLIC_SUPABASE_URL') || 'https://mpzkrhaxbdvgkvphkqqb.supabase.co');
const ref = url.hostname.split('.')[0];

const PASSWORD = 'Capstone!2026';
const tag = (digest) => digest.replace(/^\$2[ab]\$/, '$2y$');
const EMAIL = 'probe-rollback@example.invalid';

(async () => {
  const client = new Client({
    host: 'aws-1-ap-southeast-1.pooler.supabase.com',
    port: 5432,
    database: 'postgres',
    user: `postgres.${ref}`,
    password: get('SUPABASE_DB_PASSWORD') || 'Ass3T_M@nA6eMent',
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query('BEGIN');

    const good = tag(await bcrypt.hash(PASSWORD, 12));
    const legacy = await bcrypt.hash(PASSWORD, 12);

    const dept = await client.query('SELECT id FROM public.departments ORDER BY id LIMIT 1');
    const deptId = dept.rows[0]?.id ?? null;
    // NOTE: employee_numbers_id_seq is stale in this database (max id 5, seq 1),
    // so an insert without an explicit id collides. Supplying the id here keeps
    // the test independent of that pre-existing data problem.
    const nextId = await client.query('SELECT COALESCE(max(id), 0) + 1 AS next FROM public.employee_numbers');
    const emp = await client.query(
      `INSERT INTO public.employee_numbers (id, "Full_Name", "Employee_number", "Department_id", status, created_at, updated_at)
       VALUES ($2, 'Probe Rollback', 'PROBE-0001', $1, 'Active', now(), now())
       RETURNING id`,
      [deptId, nextId.rows[0].next],
    );
    const empId = emp.rows[0].id;

    await client.query(
      `INSERT INTO public.users (email, password, role, status, employee_numbers_id, department_id, created_at, updated_at)
       VALUES ($1, $2, 'Employee', 'Active', $5, $6, now(), now()),
              ($3, $4, 'Employee', 'Active', $5, $6, now(), now())`,
      [EMAIL, good, `legacy-${EMAIL}`, legacy, empId, deptId],
    );

    const goodLogin = await client.query('SELECT id FROM public.verify_user_password($1, $2)', [EMAIL, PASSWORD]);
    const legacyLogin = await client.query('SELECT id FROM public.verify_user_password($1, $2)', [
      `legacy-${EMAIL}`,
      PASSWORD,
    ]);
    const wrongLogin = await client.query('SELECT id FROM public.verify_user_password($1, $2)', [
      EMAIL,
      'wrong-password',
    ]);

    console.log('1. app-written $2y$ hash signs in  :', goodLogin.rows.length === 1 ? 'PASS' : 'FAIL');
    console.log('2. old $2b$ hash could sign in    :', legacyLogin.rows.length === 1 ? 'PASS (unexpected)' : 'FAIL (as expected)');
    console.log('3. wrong password rejected        :', wrongLogin.rows.length === 0 ? 'PASS' : 'FAIL');

    // The web writes the reset code as Hash::make($code) → `$2y$…`; the app
    // verifies it with bcryptjs and then burns the row.
    const code = '482913';
    const phpStyle = tag(await bcrypt.hash(code, 12));
    await client.query(
      `INSERT INTO public.password_resets (email, token, expires_at, used, created_at, updated_at)
       VALUES ($1, $2, now() + interval '15 minutes', false, now(), now())`,
      [EMAIL, phpStyle],
    );
    // `to_char` gives the same naive ISO string PostgREST sends the app.
    const rows = await client.query(
      `SELECT id, token, used, to_char(expires_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS expires_at
       FROM public.password_resets WHERE email = $1 ORDER BY id DESC LIMIT 1`,
      [EMAIL],
    );
    const row = rows.rows[0];
    console.log('4. code row stored                 :', row ? `id ${row.id}, used ${row.used}` : 'MISSING');
    if (row) {
      console.log('   bcryptjs reads it               :', (await bcrypt.compare(code, row.token)) ? 'PASS' : 'FAIL');
      console.log('   wrong code rejected             :', (await bcrypt.compare('000000', row.token)) ? 'FAIL' : 'PASS');
      // Same rule the app uses: naive DB timestamps are UTC, not local time.
      const raw = String(row.expires_at).trim();
      const asUtc = new Date(/([zZ]|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`);
      const asLocal = new Date(raw);
      console.log('   expiry parsed as UTC            :', asUtc.getTime() > Date.now() ? 'PASS' : 'FAIL');
      console.log('   expiry parsed as LOCAL (old bug):', asLocal.getTime() > Date.now() ? 'valid' : 'EXPIRED');
    }

    await client.query('DELETE FROM public.password_resets WHERE email = $1', [EMAIL]);
    await client.query('ROLLBACK');
    console.log('\nrolled back — no rows kept.');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.log('test failed:', e.message);
  } finally {
    await client.end().catch(() => {});
  }
})();
