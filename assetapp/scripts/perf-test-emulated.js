/**
 * NUTrace mobile — screen timing harness (Chrome mobile emulation over CDP).
 *
 *   node scripts/perf-test-emulated.js --dir=<web export> [--runs=5] [--cpu=4] [--only=<id>]
 *
 * The mobile document asks for three numbers per screen: Application Load Time,
 * Application Response Time and Screen Rendering Time. This harness produces all
 * three from the app itself, without a phone:
 *
 *   - it serves the production web export (`expo export --platform web`)
 *   - drives a headless Chrome over the DevTools protocol with a phone viewport,
 *     touch input and a CPU slowdown (the convention Lighthouse mobile uses)
 *   - injects an instrumented `fetch` so every Supabase request the screen makes is
 *     timed from send to last byte
 *
 * For every run it records:
 *   load    = navigation start → the screen's own content is on the page
 *   response= the slowest of that screen's Supabase requests (send → fully received)
 *   render  = from the last response arriving → the content being on the page
 *
 * It is read-only: GETs against the app's own anon key, no writes, no sign-in (the
 * stored session is seeded into localStorage, exactly what the app writes after login).
 *
 * Results: perf-results/perf-results-emulated.json
 */
/* global __dirname */
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'perf-results');

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};
const RUNS = Number(arg('runs', 5));
const CPU_RATE = Number(arg('cpu', 4));
const ONLY = arg('only', '');
const PORT = Number(arg('port', 8155));
const CDP_PORT = Number(arg('cdp', 9333));
const TIMEOUT_MS = Number(arg('timeout', 45000));

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const getEnv = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim() || '';
const SUPABASE_URL = getEnv('EXPO_PUBLIC_SUPABASE_URL');
const ANON_KEY = getEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');
const SUPABASE_HOST = SUPABASE_URL ? new URL(SUPABASE_URL).host : '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Read-only API call with a couple of retries — the lookups here are only for markers. */
const api = async (restPath, attempts = 4) => {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${SUPABASE_URL}${restPath}`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`GET ${restPath} → ${res.status}`);
      return await res.json();
    } catch (error) {
      lastError = error;
      await sleep(1000 * (i + 1));
    }
  }
  throw lastError;
};

// --------------------------------------------------------------------- CDP client

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data || '')})`));
        else resolve(msg.result);
      }
    });
  }

  send(method, params = {}) {
    this.id += 1;
    const id = this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 60000);
    });
  }

  async evalJson(expression) {
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || 'evaluate failed');
    return res.result.value;
  }
}

// ------------------------------------------------------------- the run definition

/**
 * One measured screen. `marker` identifies the screen (and, where a screen only shows it
 * once its records are in, the records too); readiness is completed by the settle rule and
 * by "every Supabase request this screen makes has been received", so a screen is never
 * timed before its data is on the page.
 *
 * The accounts here are the same accounts whose stored session is seeded for the run, so a
 * marker can never come from a different user's data.
 */
function buildPlan(accounts, fleet, sessions) {
  const head = accounts.head;
  const employee = accounts.employee;

  const ownAssets = (account) => fleet.filter((a) => String(a.user_id) === String(account?.id));
  const firstCode = (account) => ownAssets(account)[0]?.Asset_code || fleet[0].Asset_code;
  const idOfCode = (code) => fleet.find((a) => a.Asset_code === code)?.id;
  const LIST = 'Total Assets'; // the stat card both assigned-asset lists show

  return [
    // Launch forms 1–3: the signed-out launch, identical for every role.
    // The signed-out launch makes no Supabase request — the screen itself is the result.
    { id: 'launch-admin', role: null, url: '/login', marker: 'Welcome to NU TRACE', forms: ['launch-admin'], needsFetch: false },
    { id: 'launch-head', role: null, url: '/login', marker: 'Welcome to NU TRACE', forms: ['launch-head'], needsFetch: false },
    { id: 'launch-employee', role: null, url: '/login', marker: 'Welcome to NU TRACE', forms: ['launch-employee'], needsFetch: false },

    // Dashboard forms 4–6. The admin dashboard carries the "Total Assets" card; the
    // user dashboards carry the lifecycle card instead.
    { id: 'dashboard-admin', role: 'Admin', url: '/', marker: 'Total Assets', forms: ['dashboard-admin'] },
    {
      id: 'dashboard-head',
      role: 'Department Head',
      url: '/',
      marker: 'Asset Lifecycle Status',
      forms: ['dashboard-head'],
    },
    {
      id: 'dashboard-employee',
      role: 'Employee',
      url: '/',
      marker: 'Asset Lifecycle Status',
      forms: ['dashboard-employee'],
    },

    // The admin registry tab (not a form in the document, but the biggest list screen).
    { id: 'asset-tab-admin', role: 'Admin', url: '/assets', marker: 'Total Assets:', forms: [] },

    // Assigned asset list forms 7–8.
    { id: 'my-assets-head', role: 'Department Head', url: '/my-assets', marker: LIST, forms: ['my-assets-head'] },
    {
      id: 'my-assets-employee',
      role: 'Employee',
      url: '/my-assets',
      marker: LIST,
      forms: ['my-assets-employee'],
    },

    // Asset details forms 9–10 (and the render half of the QR forms 15–17).
    {
      id: 'asset-details-admin',
      role: 'Admin',
      url: `/asset-details?id=${idOfCode(fleet[0].Asset_code)}`,
      marker: fleet[0].Asset_code,
      forms: [],
    },
    {
      id: 'asset-details-head',
      role: 'Department Head',
      url: `/asset-details?id=${idOfCode(firstCode(head))}`,
      marker: firstCode(head),
      forms: ['asset-details-head'],
    },
    {
      id: 'asset-details-employee',
      role: 'Employee',
      url: `/asset-details?id=${idOfCode(firstCode(employee))}`,
      marker: firstCode(employee),
      forms: ['asset-details-employee'],
    },

    // Submit-request forms 11–12: the form itself reads nothing, so the only request
    // in play is the submit the form performs (timed by the API harness, rolled back).
    {
      id: 'submit-request-head',
      role: 'Department Head',
      url: '/submit-request',
      marker: 'Request type',
      needsFetch: false,
      forms: ['submit-request-head'],
    },
    {
      id: 'submit-request-employee',
      role: 'Employee',
      url: '/submit-request',
      marker: 'Request type',
      needsFetch: false,
      forms: ['submit-request-employee'],
    },

    // Notifications forms 13–14.
    {
      id: 'notifications-head',
      role: 'Department Head',
      url: '/notifications',
      marker: 'Notifications',
      forms: ['notifications-head'],
    },
    {
      id: 'notifications-employee',
      role: 'Employee',
      url: '/notifications',
      marker: 'Notifications',
      forms: ['notifications-employee'],
    },

    // Profile form 18 — the screen reads the stored session, so the account's own name
    // is the one thing on it that no other screen shows.
    {
      id: 'profile-employee',
      role: 'Employee',
      url: '/profile',
      marker: sessions.employeeName || 'Profile',
      needsFetch: false,
      forms: ['profile-employee'],
    },
  ];
}

// -------------------------------------------------------------- the instrumentation

const instrumentation = (config) => `
(() => {
  const cfg = ${JSON.stringify(config)};
  const perf = { readyAt: null, lastResponseEnd: null, fetches: [], fcp: null, timedOut: false, marker: cfg.marker };
  window.__perf = perf;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint' && perf.fcp === null) perf.fcp = entry.startTime;
      }
    }).observe({ type: 'paint', buffered: true });
  } catch (e) {}

  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const record = { url: String(url).slice(0, 80), start: performance.now(), end: null };
    const promise = originalFetch.apply(this, arguments);
    if (String(url).includes(cfg.host)) {
      perf.fetches.push(record);
      return promise.then((res) => {
        const clone = res.clone();
        clone.text().then(() => {}, () => {}).finally(() => {
          record.end = performance.now();
          perf.lastResponseEnd = record.end;
        });
        return res;
      });
    }
    return promise;
  };

  const deadline = performance.now() + cfg.timeoutMs;
  const dataArrived = () => {
    if (!cfg.needsFetch) return true;
    if (perf.fetches.length === 0) return false; // this screen always calls the API
    return perf.fetches.every((f) => f.end !== null);
  };
  // The screen is ready when its own text is showing, its data has arrived and the
  // page has stopped changing — the moment the finished screen is on the page.
  let lastText = null;
  let stable = 0;
  const tick = () => {
    const text = document.body ? document.body.innerText : '';
    if (text.includes(cfg.marker)) {
      if (text === lastText) stable += 1;
      else { stable = 0; lastText = text; }
    } else {
      stable = 0;
      lastText = null;
    }
    if (stable >= 2 && dataArrived()) {
      // Two more frames, so what is on screen is painted, not merely in the DOM.
      requestAnimationFrame(() => requestAnimationFrame(() => { perf.readyAt = performance.now(); }));
      return;
    }
    if (performance.now() > deadline) { perf.timedOut = true; return; }
    setTimeout(tick, 16);
  };
  setTimeout(tick, 0);
})();
`;

// ---------------------------------------------------------------------- the runner

const SERVE_SCRIPT = path.join(__dirname, 'serve-web-build.js');

async function waitForServer(url, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error(`Static server never answered at ${url}`);
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('websocket failed')), { once: true });
  });
  return ws;
}

async function main() {
  const dir = arg('dir', '');
  if (!dir || !fs.existsSync(dir)) {
    console.error('Pass the export directory: --dir=<folder from `expo export --platform web`>');
    process.exit(1);
  }

  // Two harnesses sharing a port is what wrecks a run: the second one kills the first
  // one's server and every screen after that fails. Fail fast instead.
  const portOpen = (port) =>
    new Promise((resolve) => {
      const socket = net.connect({ port, host: '127.0.0.1' });
      const done = (open) => {
        socket.destroy();
        resolve(open);
      };
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
      socket.setTimeout(1000, () => done(false));
    });
  for (const [name, port] of [
    ['static server', PORT],
    ['Chrome debugging', CDP_PORT],
  ]) {
    if (await portOpen(port)) {
      console.error(
        `Port ${port} (${name}) is already in use — another harness or browser is running. Stop it first.`,
      );
      process.exit(1);
    }
  }
  const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!chromePath) {
    console.error('No Chrome/Edge binary found.');
    process.exit(1);
  }

  // ---- data for the markers
  const accounts = await api('/rest/v1/users?select=id,email,role,status&status=eq.Active&order=id.asc');
  const fleet = await api('/rest/v1/assets?select=id,user_id,Asset_code,Asset_name&order=updated_at.desc');
  // One account per role, chosen once — the same account supplies the stored session and
  // every marker, so no screen can be measured while signed in as a different user.
  const chosen = {
    admin: accounts.find((a) => a.role === 'Admin'),
    head: accounts.find((a) => a.role === 'Department Head'),
    employee: accounts.find((a) => a.role === 'Employee'),
  };
  for (const [key, account] of Object.entries(chosen)) {
    if (!account) throw new Error(`No active account with the ${key} role — cannot sign in`);
  }

  const sessions = {};
  for (const [key, account] of Object.entries(chosen)) {
    const row = await api(
      `/rest/v1/users?select=id,email,role,status,department_id,profile_photo,employee_numbers(%22Full_Name%22,%22Department_id%22,%22Employee_number%22),departments:department_id(%22Name%22)&id=eq.${account.id}`,
    );
    sessions[key] = row[0];
    console.log(`Session ${key.padEnd(9)} ${account.email} (${account.role})`);
  }
  const ROLE_KEY = { Admin: 'admin', 'Department Head': 'head', Employee: 'employee' };

  let plan = buildPlan(chosen, fleet, {
    employeeName: (sessions.employee || {}).employee_numbers?.Full_Name || 'Profile',
  });
  if (ONLY) plan = plan.filter((p) => p.id.includes(ONLY));
  if (plan.length === 0) throw new Error(`--only=${ONLY} matched nothing`);

  // ---- static server + browser (both are replaceable: a dead DevTools connection or a
  // stopped static server is restarted and the run is re-measured, never recorded as a number)
  const profileDirs = [];
  let server = null;
  let chrome = null;
  let ws = null;
  let cdp = null;
  let restarts = 0;

  const stopBrowser = () => {
    try { if (ws) ws.close(); } catch { /* already gone */ }
    try { if (chrome && chrome.exitCode === null) chrome.kill(); } catch { /* already gone */ }
    try { if (server && server.exitCode === null) server.kill(); } catch { /* already gone */ }
    ws = null; chrome = null; server = null; cdp = null;
  };

  const startBrowser = async () => {
    server = spawn(process.execPath, [SERVE_SCRIPT, dir, String(PORT)], { stdio: 'ignore' });
    await waitForServer(`http://127.0.0.1:${PORT}/login`);

    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nutrace-perf-'));
    profileDirs.push(profileDir);
    chrome = spawn(
      chromePath,
      [
        '--headless=new',
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        'about:blank',
      ],
      { stdio: 'ignore' },
    );

    let pageTarget = null;
    for (let i = 0; i < 80 && !pageTarget; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
        pageTarget = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      } catch {
        /* not up yet */
      }
      if (!pageTarget) await sleep(250);
    }
    if (!pageTarget) throw new Error('Chrome never exposed a page target');

    ws = await connect(pageTarget.webSocketDebuggerUrl);
    cdp = new Cdp(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 412,
      height: 915,
      deviceScaleFactor: 2.625,
      mobile: true,
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_RATE });
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  };

  await startBrowser();

  console.log(`Chrome: ${path.basename(chromePath)} | viewport 412×915 mobile | CPU ×${CPU_RATE} | ${RUNS} runs per screen`);

  const outPath = path.join(OUT_DIR, 'perf-results-emulated.json');
  const debug = arg('debug', '') !== '';
  const results = [];

  /** Written after every screen, so a crash half-way still leaves the finished screens. */
  const writeResults = () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          environment: {
            browser: path.basename(chromePath),
            mobileEmulation: '412×915, DPR 2.625, touch',
            cpuThrottle: CPU_RATE,
            cache: 'disabled (cold load of the bundle from the local static server)',
            bundle: 'expo export --platform web (production)',
            readiness: 'screen text showing + every request of the screen received + page settled',
            browserRestarts: restarts,
          },
          runs: RUNS,
          results,
        },
        null,
        2,
      ),
    );
  };

  /** One measured run of one screen. Throws when the browser connection is unusable. */
  const runOnce = async (scenario, session) => {
    const config = {
      marker: scenario.marker,
      host: SUPABASE_HOST,
      timeoutMs: TIMEOUT_MS,
      needsFetch: scenario.needsFetch !== false,
    };
    // The stored session is written at document start — the app is never booted for
    // setup, so every measured run is a real launch and the first one is cold.
    const seed = session
      ? `try { localStorage.setItem('user', ${JSON.stringify(JSON.stringify(session))}); } catch (e) {}`
      : `try { localStorage.removeItem('user'); } catch (e) {}`;

    const seedScript = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: seed });
    const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: instrumentation(config),
    });
    try {
      await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${scenario.url}` });

      let perf = null;
      const until = Date.now() + TIMEOUT_MS + 5000;
      while (Date.now() < until) {
        await sleep(200);
        try {
          const raw = await cdp.evalJson('JSON.stringify(window.__perf || null)');
          perf = raw ? JSON.parse(raw) : null;
        } catch {
          perf = null; // context torn down mid-navigation; keep polling
        }
        if (perf && (perf.readyAt !== null || perf.timedOut)) break;
      }
      return perf;
    } finally {
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => {});
      await cdp
        .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: seedScript.identifier })
        .catch(() => {});
    }
  };

  /**
   * load    = navigation start → the screen's own content is on the page
   * response= slowest request that screen made, send → last byte received
   * render  = from the last response arriving → the content being on the page
   */
  const toRecord = (perf) => {
    const responses = perf.fetches.filter((f) => f.end !== null).map((f) => f.end - f.start);
    const responseMs = responses.length ? Math.max(...responses) : null;
    // The response the screen was drawn from is the last one to arrive *before* the screen
    // settled — a request the screen fires after that (a refresh, a read receipt) must not
    // make the render time negative.
    const ended = perf.fetches
      .map((f) => f.end)
      .filter((end) => typeof end === 'number' && end <= perf.readyAt)
      .sort((a, b) => a - b);
    const lastEnd = ended.length ? ended[ended.length - 1] : null;
    return {
      load: Math.round(perf.readyAt),
      response: responseMs === null ? null : Math.round(responseMs),
      render: Math.round(lastEnd ? perf.readyAt - lastEnd : perf.readyAt - (perf.fcp || 0)),
      fcp: perf.fcp === null ? null : Math.round(perf.fcp),
      requests: perf.fetches.length,
    };
  };

  for (const scenario of plan) {
    const session = scenario.role ? sessions[ROLE_KEY[scenario.role]] : null;
    console.log(
      `\n[${scenario.id}] ${scenario.url}${session ? ` as ${session.email}` : ' signed out'} · waiting for "${scenario.marker}"`,
    );

    const runs = [];
    for (let i = 0; i < RUNS; i += 1) {
      let record = null;
      for (let attempt = 0; attempt < 3 && !record; attempt += 1) {
        try {
          const perf = await runOnce(scenario, session);
          if (perf && perf.readyAt !== null) {
            record = toRecord(perf);
            process.stdout.write('.');
            break;
          }

          const state = debug
            ? await cdp
                .evalJson(
                  `JSON.stringify({ href: location.href, readyState: document.readyState, now: Math.round(performance.now()),
                    perf: window.__perf ? { readyAt: window.__perf.readyAt, timedOut: window.__perf.timedOut, fetches: window.__perf.fetches.length } : null,
                    text: document.body ? document.body.innerText.slice(0, 160) : null })`,
                )
                .catch((e) => `diagnostics failed: ${e.message}`)
            : null;

          // A page that never loaded is a dead browser, not a slow screen.
          if (state && /chrome-error|ERR_CONNECTION_REFUSED/.test(JSON.stringify(state))) {
            throw new Error('the page never loaded');
          }

          record = {
            error: 'screen never settled',
            marker: scenario.marker,
            requests: perf ? perf.fetches.length : 0,
            debug: state,
          };
          process.stdout.write('x');
          if (state) console.log(`\n  debug: ${JSON.stringify(state).slice(0, 400)}`);
        } catch (error) {
          console.log(`\n  ! ${scenario.id} run ${i + 1}: ${error.message} — restarting the browser`);
          stopBrowser();
          await sleep(750);
          await startBrowser();
          restarts += 1;
        }
      }
      runs.push(record || { error: 'browser kept failing' });
    }

    const ok = runs.filter((r) => !r.error);
    const avg = (key) => {
      const values = ok.map((r) => r[key]).filter((v) => typeof v === 'number');
      return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
    };
    results.push({
      scenario: scenario.id,
      url: scenario.url,
      role: scenario.role,
      account: session ? session.email : null,
      marker: scenario.marker,
      forms: scenario.forms,
      runs,
      load: avg('load'),
      response: avg('response'),
      render: avg('render'),
      failures: runs.length - ok.length,
    });
    console.log(
      `\n${scenario.id.padEnd(24)} load ${String(avg('load')).padStart(6)} ms | response ${String(avg('response')).padStart(5)} ms | render ${String(avg('render')).padStart(6)} ms${runs.length - ok.length ? `  (${runs.length - ok.length} failed)` : ''}`,
    );
    writeResults(); // a crash half-way still leaves the screens already measured
  }

  stopBrowser();
  writeResults();
  console.log(
    `\nWritten: ${path.relative(ROOT, outPath)}${restarts ? ` (${restarts} browser restart${restarts === 1 ? '' : 's'})` : ''}`,
  );
  for (const profileDir of profileDirs) {
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // Chrome can still hold the profile for a moment; it lives in the temp folder anyway.
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
