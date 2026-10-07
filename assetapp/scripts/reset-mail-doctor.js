/**
 * Why did the 6-digit code never arrive?
 *
 *   node scripts/reset-mail-doctor.js [email]
 *
 * The app asks the NUTrace website to mail the reset code. When the message
 * never arrives the app still shows "code sent", because it only checks that a
 * new `password_resets` row was written — and the site writes that row BEFORE
 * handing the message to the mail server.
 *
 * This walks the same path the app's fallback takes (GET form -> CSRF token +
 * session cookie -> POST -> follow the 302 with the same cookie), then prints:
 *   1. whatever the site reports back (success flash, mail error, dev code),
 *   2. the row it wrote to `password_resets`.
 *
 * Compare the two: a fresh row plus a mail error means the site stored a code it
 * could not deliver. No row at all means the POST was refused. A fresh row, a
 * success banner and a POST that answered as fast as a plain GET means the site
 * has no `MAIL_*` configuration at all — Laravel used its `log` mailer and
 * nothing was sent, which is the state this doctor was written to catch.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// ---- load .env -------------------------------------------------------------
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const BASE = process.env.WEB_URL || 'https://nutrace-production.up.railway.app';
const EMAIL = (process.argv[2] || 'miggybalmes9@gmail.com').trim();

const cookieJarFrom = (res) => {
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const jar = raw.length ? raw : [res.headers.get('set-cookie')].filter(Boolean);
  return jar
    .map((c) => String(c).split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
};

/** Laravel flashes land either in the HTML (old session) or the session store. */
const flashLines = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 3 && line.length < 400);

const interesting = (line) =>
  /mail|sent|could not|failed|error|expire|verification|code|invalid|try again/i.test(line);

(async () => {
  console.log(`Site:  ${BASE}`);
  console.log(`Email: ${EMAIL}\n`);

  // ---- 1. the form ---------------------------------------------------------
  const page = await fetch(`${BASE}/forgot-password`, {
    headers: { Accept: 'text/html' },
    redirect: 'manual',
  });
  const html = await page.text();
  const cookies = cookieJarFrom(page);
  const token = (/name="_token"\s+value="([^"]+)"/.exec(html) || [])[1] || '';
  console.log(`GET /forgot-password   status ${page.status}`);
  console.log(`  cookies: ${cookies || '(none)'}`);
  console.log(`  csrf:    ${token ? `${token.slice(0, 12)}… (${token.length} chars)` : '(not found)'}`);
  if (!token) {
    console.log('\nNo CSRF token: the form is not reachable, so nothing can be posted.');
    return;
  }

  // ---- 2. the POST ---------------------------------------------------------
  const posted = await fetch(`${BASE}/forgot-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/html,application/xhtml+xml',
      Cookie: cookies,
    },
    body: new URLSearchParams({ _token: token, email: EMAIL }).toString(),
    redirect: 'manual',
  });
  const location = posted.headers.get('location') || '';
  const postBody = posted.status < 400 ? await posted.text() : '';
  console.log(`\nPOST /forgot-password  status ${posted.status}`);
  console.log(`  location: ${location || '(none)'}`);

  // ---- 3. follow the redirect with the same cookie --------------------------
  if (posted.status === 302 && location) {
    const target = new URL(location, BASE).toString();
    const step = await fetch(target, {
      headers: { Accept: 'text/html', Cookie: cookies },
      redirect: 'manual',
    });
    const stepHtml = await step.text();
    console.log(`GET  ${target.replace(BASE, '')}  status ${step.status}`);

    const lines = flashLines(stepHtml).filter(interesting);
    console.log('\nWhat the site says back:');
    if (lines.length === 0) console.log('  (nothing on the page looks like a notice)');
    for (const line of [...new Set(lines)].slice(0, 20)) console.log(`  • ${line}`);

    // Laravel notices usually carry a class like "alert alert-danger".
    const notices = [...stepHtml.matchAll(/<[^>]*class="[^"]*alert[^"]*"[^>]*>([\s\S]{0,400}?)<\//gi)].map(
      (m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    );
    if (notices.length) {
      console.log('\nNotice blocks:');
      for (const notice of [...new Set(notices)]) console.log(`  • ${notice}`);
    }

    const mailError = /(could not be sent|could not send|failed to send|unable to send|mail error|smtp)/i.test(stepHtml);
    const success = /(code has been sent|we sent|sent to)/i.test(stepHtml);
    const devCode = (/dev[ _-]?code/i.test(stepHtml) && (stepHtml.match(/\b\d{6}\b/g) || []).slice(0, 3)) || [];
    console.log('\nReadings:');
    console.log(`  success banner: ${success ? 'YES' : 'no'}`);
    console.log(`  mail error:     ${mailError ? 'YES' : 'no'}`);
    console.log(`  dev code shown: ${devCode.length ? devCode.join(', ') : 'no'}`);
  } else if (postBody) {
    const lines = flashLines(postBody).filter(interesting);
    console.log('\nWhat the POST answered with:');
    for (const line of [...new Set(lines)].slice(0, 14)) console.log(`  • ${line}`);
  }

  // ---- 4. what was written to the table ------------------------------------
  const password = process.env.SUPABASE_DB_PASSWORD || 'Ass3T_M@nA6eMent';
  if (!password) {
    console.log('\nSUPABASE_DB_PASSWORD not set — skipping the password_resets check.');
    return;
  }
  const client = new Client({
    host: 'aws-1-ap-southeast-1.pooler.supabase.com',
    port: 5432,
    user: 'postgres.mpzkrhaxbdvgkvphkqqb',
    password,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  // The columns are `timestamp without time zone` holding UTC. Read them as
  // text: node-postgres would parse the bare value in the *local* timezone and
  // print a time that is 8 hours off in Manila, which is how a just-created row
  // first looked hours old.
  const { rows } = await client.query(
    `select id, email, used, length(token) as hash_len,
            to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') as created_utc,
            to_char(expires_at, 'YYYY-MM-DD HH24:MI:SS') as expires_utc,
            (expires_at > (now() at time zone 'utc')) as still_valid,
            round(extract(epoch from ((now() at time zone 'utc') - created_at))) as age_seconds
       from password_resets
      where lower(email) = lower($1)
      order by id desc
      limit 3`,
    [EMAIL],
  );
  console.log('\npassword_resets rows for this address (times are UTC):');
  if (rows.length === 0) console.log('  (none — no code was stored)');
  for (const r of rows) {
    console.log(
      `  id ${r.id} | created ${r.created_utc} (${r.age_seconds}s ago) | expires ${r.expires_utc} | used ${r.used} | hash ${r.hash_len} chars | valid now ${r.still_valid}`,
    );
  }
  await client.end();
})().catch((err) => {
  console.error('\nProbe failed:', err.message);
  process.exitCode = 1;
});
