/**
 * NUTrace mobile — performance test harness.
 *
 *   node scripts/perf-test.js            # 5 runs per scenario (the test document's count)
 *   node scripts/perf-test.js --runs=3   # fewer/more runs
 *
 * The mobile performance test document measures three things per role:
 * Application Load Time (<2s), Application Response Time (1-3s) and Screen
 * Rendering Time (1-3s). Only the middle one can be measured off-device — it is
 * the round trip to Supabase, which is what all three screens wait on.
 *
 * This harness therefore reproduces, request for request, the queries each
 * screen issues (same tables, same embeds, same filters, same limits — see the
 * `Screen` reference on every scenario) and times them against the live project
 * with the app's own anon key. Five runs per scenario, warm-up discarded.
 *
 * Read-only: every GET is a plain select. The two write scenarios (submitting a
 * request) run their INSERTs inside a transaction that is ROLLED BACK, so the
 * database is left exactly as it was — no probe row, no audit entry.
 *
 * What this cannot measure — and what the device still has to supply — is the
 * on-phone startup and frame cost (Android Studio Profiler / `adb`); see
 * perf-results.md for the procedure.
 */
/* global __dirname, Buffer */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'perf-results');

// ---------------------------------------------------------------- environment

const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const getEnv = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim() || '';
const SUPABASE_URL = getEnv('EXPO_PUBLIC_SUPABASE_URL');
const ANON_KEY = getEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

const HEADERS = {
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
  'Content-Type': 'application/json',
};

const RUNS = Number((process.argv.find((a) => a.startsWith('--runs=')) || '').split('=')[1]) || 5;
const NOW = new Date();

/** One REST call, timed end to end (request sent → body consumed). */
async function api(restPath, init = {}, allowed = []) {
  const started = performance.now();
  const res = await fetch(`${SUPABASE_URL}${restPath}`, { ...init, headers: { ...HEADERS, ...(init.headers || {}) } });
  const body = await res.text();
  const ms = performance.now() - started;
  if (!res.ok && res.status !== 406 && !allowed.includes(res.status)) {
    throw new Error(`${init.method || 'GET'} ${restPath} → ${res.status} ${body.slice(0, 200)}`);
  }
  return { ms, status: res.status, bytes: Buffer.byteLength(body), rows: safeLength(body) };
}

const safeLength = (body) => {
  try {
    const parsed = JSON.parse(body);
    return Array.isArray(parsed) ? parsed.length : 1;
  } catch {
    return 0;
  }
};

const enc = (v) => encodeURIComponent(v);
const desc = (col) => `order=${col}.desc`;

// --------------------------------------------------------- the app's queries

const ASSET_SELECT = '*,users!assets_user_id_foreign(department_id,employee_numbers(%22Full_Name%22),departments(id,%22Name%22)),asset_files(%22Asset_file_ID%22,file_name,file_path,url,mime_type)';
const TIMELINE_AUDIT = '*,assets(%22Asset_name%22,%22Asset_code%22),users(role,employee_numbers(%22Full_Name%22)),requests(id,request_type)';
const USER_ASSETS_SELECT = '*,users(employee_numbers(%22Full_Name%22),departments(%22Name%22))';
/** What the QR scanner asks for (components/asset-scanner.tsx). */
const SCAN_SELECT = 'id,Asset_code,Asset_name,Lifecycle_Status';
const PROFILE_SELECT = 'id,email,department_id,role,status,profile_photo,created_at,updated_at,employee_numbers(%22Full_Name%22,%22Department_id%22,%22Employee_number%22),departments:department_id(%22Name%22)';

/** Accept: …object+json is what supabase-js sends for maybeSingle(). */
const SINGLE = { Accept: 'application/vnd.pgrst.object+json' };

/**
 * Every scenario names the screen it stands for, so the numbers can be lifted
 * straight into the test document.
 */
function buildScenarios(accounts, fleet, departmentIds) {
  const byRole = (role) => accounts.find((a) => a.role === role);  const admin = byRole('Admin');
  const head = byRole('Department Head');
  const employee = byRole('Employee');

  const ownOf = (account) => fleet.find((a) => String(a.user_id) === String(account?.id)) || fleet[0];

  const counts = [
    ['total assets', '/rest/v1/assets?select=id', { Prefer: 'count=exact' }],
    ['deployed', `/rest/v1/assets?select=id&Lifecycle_Status=eq.${enc('Active')}`, { Prefer: 'count=exact' }],
    ['for repair', `/rest/v1/assets?select=id&Lifecycle_Status=eq.${enc('For Repair')}`, { Prefer: 'count=exact' }],
    ['pending requests', '/rest/v1/requests?select=id&status=eq.Pending', { Prefer: 'count=exact' }],
  ];

  const timeline = [
    `/rest/v1/audit_logs?select=${TIMELINE_AUDIT}&${desc('created_at')}&limit=100`,
    '/rest/v1/repairs?select=*,assets(%22Asset_name%22,%22Asset_code%22),requests(id,request_type)&order=created_at.desc&limit=100',
    '/rest/v1/replacements?select=*,old_assets:old_assets_id(Asset_name,Asset_code),requests(id,request_type)&order=created_at.desc&limit=100',
    '/rest/v1/disposals?select=*,assets(Asset_name,Asset_code),requests(id,request_type)&order=created_at.desc&limit=100',
  ];

  const dashboard = (account, role) => ({
    id: `dashboard-${role.toLowerCase().replace(/\s+/g, '-')}`,
    document: `Dashboard opens — ${role}`,
    precondition: `${role} is authenticated and the mobile dashboard can be opened.`,
    metric: 'Application Response Time',
    screen: 'app/(tabs)/index.tsx → fetchDashboardData()',
    concurrency: 'parallel (Promise.all, as the screen does)',
    steps: [...counts, ...timeline.map((p) => [null, p, undefined])],
  });

  const signIn = (account, role) => ({
    id: `sign-in-${role.toLowerCase().replace(/\s+/g, '-')}`,
    document: `App launch / sign-in — ${role}`,
    precondition: `${role} account is available and the NU TRACE mobile app is installed.`,
    metric: 'Application Load Time (backend portion)',
    screen: 'app/login.tsx → supabase.rpc(verify_user_password) + enrichUserWithEmployeeData()',
    concurrency: 'sequential',
    // The password is deliberately wrong: the RPC runs the same SELECT and the
    // same bcrypt/pgcrypto comparison either way, so the cost is identical and
    // no credential is needed. A wrong password answers 200 with `[]`.
    steps: [
      [null, '/rest/v1/rpc/verify_user_password', {
        method: 'POST',
        body: JSON.stringify({ email_input: account?.email || 'unknown@example.invalid', password_input: 'perf-test-wrong-password' }),
      }],
      [null, `/rest/v1/users?select=*,employee_numbers(%22Full_Name%22,%22Department_id%22,%22Employee_number%22),departments:department_id(%22Name%22)&id=eq.${enc(account?.id ?? 0)}`, SINGLE],
    ],
  });

  return [
    signIn(admin, 'Admin'),
    signIn(head, 'Department Head'),
    signIn(employee, 'Employee'),

    dashboard(admin, 'Admin'),
    dashboard(head, 'Department Head'),
    dashboard(employee, 'Employee'),

    {
      id: 'asset-list-head',
      document: 'Assigned asset list opens — Department Head',
      precondition: 'Department Head is authenticated and has at least one assigned asset.',
      metric: 'Application Response Time',
      screen: '(user-tabs) asset list → fetchUserAssets(user, \'own\')',
      concurrency: 'sequential — the embedded select is rejected, so the screen immediately re-queries without the embeds',
      steps: [
        [null, `/rest/v1/assets?select=${USER_ASSETS_SELECT}&user_id=eq.${enc(head?.id ?? 0)}&${desc('updated_at')}`, undefined, [300]],
        [null, `/rest/v1/assets?select=*&user_id=eq.${enc(head?.id ?? 0)}&${desc('updated_at')}`, undefined, []],
      ],
      count: () => countRows(`/rest/v1/assets?select=id&user_id=eq.${enc(head?.id ?? 0)}`),
    },
    {
      id: 'asset-list-employee',
      document: 'Assigned asset list opens — Employee',
      precondition: 'Employee is authenticated and has at least one assigned asset.',
      metric: 'Application Response Time',
      screen: '(user-tabs) asset list → fetchUserAssets(user, \'own\')',
      concurrency: 'sequential — the embedded select is rejected, so the screen immediately re-queries without the embeds',
      steps: [
        [null, `/rest/v1/assets?select=${USER_ASSETS_SELECT}&user_id=eq.${enc(employee?.id ?? 0)}&${desc('updated_at')}`, undefined, [300]],
        [null, `/rest/v1/assets?select=*&user_id=eq.${enc(employee?.id ?? 0)}&${desc('updated_at')}`, undefined, []],
      ],
      count: () => countRows(`/rest/v1/assets?select=id&user_id=eq.${enc(employee?.id ?? 0)}`),
    },

    {
      id: 'asset-details-head',
      document: 'Asset details render — Department Head',
      precondition: 'Department Head has an assigned asset available for viewing.',
      metric: 'Application Response Time',
      screen: 'app/asset-details.tsx → fetchAssetDetail(code)',
      concurrency: 'single query',
      steps: [[null, `/rest/v1/assets?select=${ASSET_SELECT}&Asset_code=eq.${enc(ownOf(head)?.Asset_code ?? '')}`, SINGLE]],
    },
    {
      id: 'asset-details-employee',
      document: 'Asset details render — Employee',
      precondition: 'Employee has an assigned asset available for viewing.',
      metric: 'Application Response Time',
      screen: 'app/asset-details.tsx → fetchAssetDetail(code)',
      concurrency: 'single query',
      steps: [[null, `/rest/v1/assets?select=${ASSET_SELECT}&Asset_code=eq.${enc(ownOf(employee)?.Asset_code ?? '')}`, SINGLE]],
    },

    {
      id: 'qr-scan-admin',
      document: 'QR / barcode scan resolves an asset — Admin',
      precondition: 'Admin is authenticated and a valid NU TRACE asset QR/barcode is available.',
      metric: 'Application Response Time',
      screen: 'components/asset-scanner.tsx → findAssetByScan() then /asset-details',
      concurrency: 'sequential (exact match, then case-insensitive retry only if it misses)',
      steps: [[null, `/rest/v1/assets?select=${SCAN_SELECT}&Asset_code=eq.${enc(fleet[0]?.Asset_code ?? '')}`, SINGLE]],
    },
    {
      id: 'qr-scan-head',
      document: 'QR / barcode scan resolves an asset — Department Head',
      precondition: 'Department Head is authenticated and a valid NU TRACE asset QR/barcode is available.',
      metric: 'Application Response Time',
      screen: 'components/asset-scanner.tsx → findAssetByScan() then /asset-details',
      concurrency: 'sequential',
      steps: [[null, `/rest/v1/assets?select=${SCAN_SELECT}&Asset_code=eq.${enc(ownOf(head)?.Asset_code ?? '')}`, SINGLE]],
    },
    {
      id: 'qr-scan-employee',
      document: 'QR / barcode scan resolves an asset — Employee',
      precondition: 'Employee is authenticated and a valid NU TRACE asset QR/barcode is available.',
      metric: 'Application Response Time',
      screen: 'components/asset-scanner.tsx → findAssetByScan() then /asset-details',
      concurrency: 'sequential',
      steps: [[null, `/rest/v1/assets?select=${SCAN_SELECT}&Asset_code=eq.${enc(ownOf(employee)?.Asset_code ?? '')}`, SINGLE]],
    },

    {
      id: 'asset-tab-admin',
      document: 'Assets tab (registry) opens — Admin',
      precondition: 'Admin is authenticated and the asset registry tab can be opened.',
      metric: 'Application Response Time',
      screen: 'app/(tabs)/assets.tsx → loadData(): assets+departments, then one head lookup per department',
      concurrency: 'two phases — assets+departments in parallel, then one users query per department in parallel',
      phases: [
        [
          [null, `/rest/v1/assets?select=${ASSET_SELECT}`, undefined],
          [null, '/rest/v1/departments?select=*&status=eq.Active', undefined],
        ],
        ...departmentIds.map((id) => [
          [null, `/rest/v1/users?select=email,employee_numbers(%22Full_Name%22)&department_id=eq.${enc(id)}&role=eq.${enc('Department Head')}&limit=1`, SINGLE],
        ]),
      ],
    },

    {
      id: 'notifications-head',
      document: 'Notifications load — Department Head',
      precondition: 'Department Head is authenticated and notification records are available.',
      metric: 'Application Response Time',
      screen: 'app/notifications.tsx → fetchNotifications(userId)',
      concurrency: 'sequential (list, then unread count)',
      steps: [
        [null, `/rest/v1/notifications?select=*&user_id=eq.${enc(head?.id ?? 0)}&${desc('created_at')}&limit=50`, undefined],
        [null, `/rest/v1/notifications?select=id&user_id=eq.${enc(head?.id ?? 0)}&is_read=eq.false`, { Prefer: 'count=exact' }],
      ],
    },
    {
      id: 'notifications-employee',
      document: 'Notifications load — Employee',
      precondition: 'Employee is authenticated and notification records are available.',
      metric: 'Application Response Time',
      screen: 'app/notifications.tsx → fetchNotifications(userId)',
      concurrency: 'sequential (list, then unread count)',
      steps: [
        [null, `/rest/v1/notifications?select=*&user_id=eq.${enc(employee?.id ?? 0)}&${desc('created_at')}&limit=50`, undefined],
        [null, `/rest/v1/notifications?select=id&user_id=eq.${enc(employee?.id ?? 0)}&is_read=eq.false`, { Prefer: 'count=exact' }],
      ],
    },

    {
      id: 'profile-employee',
      document: 'Profile / account page opens — Employee',
      precondition: 'Employee is authenticated and the profile/account page is accessible.',
      metric: 'Application Response Time',
      screen: 'app/(tabs)/profile.tsx → fetchLiveUser(id)',
      concurrency: 'single query',
      steps: [[null, `/rest/v1/users?select=${PROFILE_SELECT}&id=eq.${enc(employee?.id ?? 0)}`, SINGLE]],
    },
  ];
}

async function countRows(restPath) {
  const res = await fetch(`${SUPABASE_URL}${restPath}`, { headers: { ...HEADERS, Prefer: 'count=exact' } });
  return Number((res.headers.get('content-range') || '0/0').split('/')[1] || 0);
}

// -------------------------------------------------------------- the write path

/**
 * Submitting a request is the one scenario that writes. It runs the same
 * statements the app runs (see `submitUserRequest`) inside a transaction that is
 * rolled back, so nothing is left behind — the number is the database's own
 * write cost without the HTTP round trip.
 */
async function measureSubmitRolledBack(pg, account, assetId) {
  const runs = [];
  for (let i = 0; i < RUNS; i += 1) {
    const started = performance.now();
    await pg.query('BEGIN');
    const { rows } = await pg.query(
      `insert into requests (user_id, asset_id, request_type, status, "Note", created_at, updated_at)
       values ($1, $2, 'Repair', 'Pending', 'Performance test (rolled back)', now(), now())
       returning id`,
      [account.id, assetId],
    );
    await pg.query(
      `insert into request_items (request_id, asset_id, created_at, updated_at) values ($1, $2, now(), now())`,
      [rows[0].id, assetId],
    );
    await pg.query(
      `insert into audit_logs (user_id, request_id, asset_id, action_type, action_description, notes, created_at, updated_at)
       values ($1, $2, $3, 'CREATE', 'Performance test', 'rolled back', now(), now())`,
      [account.id, rows[0].id, assetId],
    );
    await pg.query('ROLLBACK');
    runs.push(performance.now() - started);
  }
  return runs;
}

// ------------------------------------------------------------------- the run

async function main() {
  console.log(`NUTrace mobile performance test — ${RUNS} runs per scenario`);
  console.log(`Project: ${SUPABASE_URL}`);
  console.log(`Started: ${NOW.toISOString()}\n`);

  const list = async (restPath) => {
    const res = await fetch(`${SUPABASE_URL}${restPath}`, { headers: HEADERS });
    if (!res.ok) throw new Error(`GET ${restPath} → ${res.status}`);
    return res.json();
  };

  const accounts = await list('/rest/v1/users?select=id,email,role,status&status=eq.Active&order=id.asc');
  const fleet = await list('/rest/v1/assets?select=id,user_id,Asset_code&order=id.asc');
  const departments = await list('/rest/v1/departments?select=id&status=eq.Active&order=id.asc');
  console.log(
    `Accounts: ${accounts.map((a) => `${a.role}#${a.id}`).join(', ')} — ${fleet.length} assets, ${departments.length} active departments\n`,
  );

  // Cold connection (DNS + TLS + first response) — paid once per app launch.
  const coldStart = performance.now();
  await fetch(`${SUPABASE_URL}/rest/v1/assets?select=id&limit=1`, { headers: HEADERS });
  const coldMs = performance.now() - coldStart;

  const ping = [];
  for (let i = 0; i < RUNS; i += 1) {
    ping.push((await api('/rest/v1/assets?select=id&limit=1')).ms);
  }

  const scenarios = buildScenarios(accounts, fleet, departments.map((d) => d.id));
  const results = [];

  for (const scenario of scenarios) {
    // Warm-up (discarded): the first call of a scenario pays connection reuse.
    await runOnce(scenario);
    const runs = [];
    let bytes = 0;
    let rows = 0;
    for (let i = 0; i < RUNS; i += 1) {
      const run = await runOnce(scenario);
      runs.push(run.ms);
      bytes += run.bytes;
      rows = run.rows;
    }
    const total = runs.reduce((a, b) => a + b, 0);
    results.push({
      ...scenario,
      runs,
      avg: total / runs.length,
      min: Math.min(...runs),
      max: Math.max(...runs),
      bytes: Math.round(bytes / runs.length),
      rows,
      count: scenario.count ? await scenario.count() : null,
    });
    console.log(
      `${scenario.document.padEnd(52)} ${runs.map((r) => String(Math.round(r)).padStart(5)).join('')}  avg ${(total / runs.length).toFixed(0).padStart(5)} ms`,
    );
  }

  // Submit-request: database-side cost, rolled back.
  const pg = new Client({
    host: 'aws-1-ap-southeast-1.pooler.supabase.com',
    port: 5432,
    database: 'postgres',
    user: `postgres.${new URL(SUPABASE_URL).hostname.split('.')[0]}`,
    password: getEnv('SUPABASE_DB_PASSWORD') || 'Ass3T_M@nA6eMent',
    ssl: { rejectUnauthorized: false },
  });
  const writeResults = [];
  try {
    await pg.connect();
    for (const role of ['Department Head', 'Employee']) {
      const account = accounts.find((a) => a.role === role);
      const asset = fleet.find((a) => String(a.user_id) === String(account?.id)) || fleet[0];
      await measureSubmitRolledBack(pg, account, asset.id); // warm-up
      const runs = await measureSubmitRolledBack(pg, account, asset.id);
      const avg = runs.reduce((a, b) => a + b, 0) / runs.length;
      writeResults.push({ role, runs, avg });
      console.log(
        `${`Submit a request (DB write, rolled back) — ${role}`.padEnd(52)} ${runs.map((r) => String(Math.round(r)).padStart(5)).join('')}  avg ${avg.toFixed(0).padStart(5)} ms`,
      );
    }
  } catch (e) {
    console.error('Write-path measurement failed:', e.message);
  } finally {
    await pg.end().catch(() => {});
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const env_ = {
    runs: RUNS,
    coldMs,
    ping: { runs: ping, avg: ping.reduce((a, b) => a + b, 0) / ping.length },
    results,
    writeResults,
    accounts: accounts.map((a) => ({ id: a.id, role: a.role, email: a.email })),
    assetTotal: fleet.length,
    departmentTotal: departments.length,
    finishedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'perf-results.json'), JSON.stringify(env_, null, 2));

  fs.writeFileSync(path.join(OUT_DIR, 'perf-results.csv'), [
    'scenario,role,run1_ms,run2_ms,run3_ms,run4_ms,run5_ms,average_ms,per_request_bytes,rows,threshold_s,verdict',
    ...results.map((r) => {
      const threshold = r.metric.startsWith('Application Load') ? 2 : 3;
      return [r.id, roleOf(r), ...r.runs.map((x) => Math.round(x)), Math.round(r.avg), r.bytes, r.rows, threshold,
        r.avg / 1000 <= threshold ? 'PASS' : 'FAIL'].join(',');
    }),
  ].join('\n'));

  console.log(`\ncold connect (DNS+TLS): ${Math.round(coldMs)} ms`);
  console.log(`warm single-row query:  ${Math.round(env_.ping.avg)} ms`);
  console.log(`\nWritten: ${path.relative(ROOT, path.join(OUT_DIR, 'perf-results.csv'))} and perf-results.json`);
  console.log(`Finish: ${env_.finishedAt}`);
}

const roleOf = (r) => (r.precondition.match(/^(Admin|Department Head|Employee)/) || [])[1] || '';

async function runOnce(scenario) {
  const phases = scenario.phases
    ? scenario.phases
    : scenario.concurrency.startsWith('sequential')
      ? scenario.steps.map((s) => [s])
      : [scenario.steps];
  const started = performance.now();
  let bytes = 0;
  let rows = 0;
  for (const phase of phases) {
    const settled = await Promise.all(phase.map(([, p, init, allowed]) => api(p, init, allowed)));
    bytes += settled.reduce((a, s) => a + s.bytes, 0);
    rows += settled.reduce((a, s) => a + s.rows, 0);
  }
  const ms = performance.now() - started;
  return { ms, bytes, rows };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
