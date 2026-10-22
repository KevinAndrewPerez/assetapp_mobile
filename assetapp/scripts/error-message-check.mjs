// Verifies lib/errorMessage.ts: failures users can act on are explained, while
// database/JavaScript internals are never shown. `node scripts/error-message-check.mjs`.
import { friendlyErrorMessage } from '../lib/errorMessage.ts';

const cases = [
  [new TypeError('Network request failed'), /internet connection/i, 'offline fetch'],
  [{ message: 'fetch failed' }, /internet connection/i, 'fetch failed'],
  [{ message: 'The operation timed out', status: 504 }, /took too long/i, 'timeout'],
  [{ message: 'JWSError: invalid JWT', status: 401 }, /sign in again/i, 'expired session'],
  [{ message: 'permission denied for table repairs', status: 403 }, /sign in again/i, 'forbidden'],
  [
    { message: 'duplicate key value violates unique constraint "requests_pkey"', code: '23505' },
    /could not complete that change|something went wrong/i,
    'database detail hidden',
  ],
  [
    { message: 'new row for relation "requests" violates check constraint "requests_status_check"', code: '23514' },
    /could not complete that change|something went wrong/i,
    'check-constraint text hidden',
  ],
  [{ message: 'internal server error', status: 500 }, /could not complete that change/i, 'server error'],
  [{ message: 'A reason is required so the user knows why the asset is being replaced.' }, /A reason is required/i, 'own validation message passthrough'],
  [{ message: 'Asset not available' }, /Asset not available/i, 'short workflow message passthrough'],
  [null, /Something went wrong/i, 'empty error'],
];

let failures = 0;
for (const [error, expected, label] of cases) {
  const message = friendlyErrorMessage(error);
  const pass = expected.test(message) && !/violates|constraint|JWT|PGRST|SQLSTATE/i.test(message);
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label} -> ${message}`);
  if (!pass) failures += 1;
}

// A caller's fallback must win when the error carries nothing usable.
const fallback = friendlyErrorMessage({}, 'Could not load requests. Please try again.');
if (fallback !== 'Could not load requests. Please try again.') {
  console.log(`FAIL fallback not used -> ${fallback}`);
  failures += 1;
} else {
  console.log(`ok   fallback used -> ${fallback}`);
}

console.log(failures === 0 ? '\nAll error messages are user-safe.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
