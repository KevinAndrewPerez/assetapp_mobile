// Report period <-> stored timestamp conversion, checked without a database:
// `node scripts/time-bounds-check.mjs`.
//
// The database stores `timestamp without time zone` values that are naive UTC,
// while a report period ("1–31 October") is a local calendar window. The check
// asserts the round trip through the same parser the screens use, so it holds
// on any machine time zone, including DST zones.
import {
  localDateEndStored,
  localDateStartStored,
  parseStoredTimestamp,
  todayLocalIso,
} from '../lib/time.ts';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok   ${label}`);
  }
};

const localMidnight = (year, month, day) => new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
const localEndOfDay = (year, month, day) =>
  new Date(year, month - 1, day, 23, 59, 59, 999).getTime();

const storedStart = localDateStartStored('2026-10-01');
const storedEnd = localDateEndStored('2026-10-31');

// A local day boundary is not necessarily the same wall-clock date in UTC
// (Manila midnight is the previous day at 16:00), so only the shape is fixed.
check('start is a naive-UTC timestamp', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(storedStart), true);
check('end is a naive-UTC timestamp with millis', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/.test(storedEnd), true);
check(
  'start parses back to local midnight',
  parseStoredTimestamp(storedStart)?.getTime(),
  localMidnight(2026, 10, 1),
);
check(
  'end parses back to local end of day',
  parseStoredTimestamp(storedEnd)?.getTime(),
  localEndOfDay(2026, 10, 31),
);
check('invalid input yields no bound', localDateStartStored('October'), '');
check('empty input yields no bound', localDateEndStored(''), '');
check('local date string is the device calendar day', todayLocalIso(new Date(2026, 9, 1, 23, 30)), '2026-10-01');

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll report period bounds round-trip correctly.');
