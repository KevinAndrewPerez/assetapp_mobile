/**
 * Can the app drive the website's forgot-password form?
 *
 *   node scripts/reset-handshake-check.js
 *
 * The app asks the NUTrace site to mail the verification code, which means it
 * has to post the site's CSRF-protected form from outside a browser. This posts
 * an address that is NOT in `users`, so nothing is written and no email is sent:
 * it only reports whether the token + session-cookie handshake is accepted
 * (419 = Laravel rejected it, i.e. the app would have to fall back to the
 * in-app browser). Run it whenever the website is redeployed.
 */
const BASE = process.env.WEB_URL || 'https://nutrace-production.up.railway.app';
const EMAIL = 'probe-no-such-account@example.invalid';

const cookieHeaderFrom = (res) => {
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const jar = raw.length
    ? raw
    : [res.headers.get('set-cookie')].filter(Boolean);
  return jar
    .map((c) => String(c).split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
};

(async () => {
  const page = await fetch(`${BASE}/forgot-password`);
  const html = await page.text();
  const cookies = cookieHeaderFrom(page);
  const match = /name="_token"\s+value="([^"]+)"/.exec(html);

  console.log('GET  status:', page.status);
  console.log('GET  cookies:', cookies || '(none)');
  console.log('GET  token:', match ? `${match[1].slice(0, 12)}… (${match[1].length} chars)` : '(not found)');
  if (!match) return;

  for (const [label, headers] of [
    ['with cookies', { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies }],
    ['without cookies', { 'Content-Type': 'application/x-www-form-urlencoded' }],
  ]) {
    const body = new URLSearchParams({ _token: match[1], email: EMAIL }).toString();
    const res = await fetch(`${BASE}/forgot-password`, {
      method: 'POST',
      headers: { ...headers, Accept: 'text/html,application/json' },
      body,
      redirect: 'manual',
    });
    const text = res.status < 400 ? await res.text() : '';
    const csrfOk = res.status !== 419;
    const processed =
      /No account is registered with that email address/i.test(text) ||
      res.status === 302;
    console.log(
      `POST ${label}: status ${res.status} | csrf ${csrfOk ? 'OK' : 'REJECTED'} | form handled ${
        processed ? 'YES' : 'NO'
      }`,
    );
  }
})();
