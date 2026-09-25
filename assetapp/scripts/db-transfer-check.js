/**
 * READ-ONLY check for the Transfer module + the Asset Registry custom codes.
 *
 *   node scripts/db-transfer-check.js
 *
 * It never writes: it runs the exact queries `lib/transferService.ts` and
 * `findExistingAssetCodes()` use, then prints what the screens would show. Run it
 * whenever the Transfer list, the status chips or the duplicate-code check look
 * wrong.
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}
const db = createClient(url, key);

const USER_SELECT =
  'id, email, role, status, department_id, employee_numbers_id, employee_numbers("Full_Name", "Employee_number", "Department_id", departments("Name"))';

let failures = 0;
const fail = (label, err) => {
  failures++;
  console.log(`  \u2717 ${label}: ${err?.message || JSON.stringify(err)}`);
};

const firstOf = (value) => (Array.isArray(value) ? value[0] : value);
const nameOf = (row) => String(firstOf(row?.employee_numbers)?.Full_Name ?? row?.email ?? '?');
const deptOf = (row) => String(firstOf(firstOf(row?.employee_numbers)?.departments)?.Name ?? '');
const numOf = (row) => String(firstOf(row?.employee_numbers)?.Employee_number ?? '');

(async () => {
  console.log(`\nNUTrace transfer / asset-code check \u2014 ${url}\n`);

  // ---- users + assets + transfer requests ---------------------------------
  const [usersRes, assetsRes, transfersRes] = await Promise.all([
    db.from('users').select(USER_SELECT).order('id', { ascending: true }),
    db.from('assets').select('id, user_id'),
    db
      .from('requests')
      .select('id, user_id, assign_to_user_id, status, request_type, created_at')
      .ilike('request_type', '%transfer%')
      .order('created_at', { ascending: false }),
  ]);
  if (usersRes.error) fail('users select', usersRes.error);
  if (assetsRes.error) fail('assets select', assetsRes.error);
  if (transfersRes.error) fail('transfer requests select', transfersRes.error);

  const users = usersRes.data ?? [];
  const counts = new Map();
  (assetsRes.data ?? []).forEach((row) => {
    const key = String(row.user_id ?? '');
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  const nameById = new Map(users.map((u) => [String(u.id), nameOf(u)]));

  const pending = new Map();
  const completed = new Map();
  (transfersRes.data ?? []).forEach((row) => {
    const key = String(row.user_id ?? '');
    const status = String(row.status ?? '').toLowerCase();
    if (status === 'pending') {
      if (!pending.has(key)) pending.set(key, row);
    } else if (!completed.has(key)) {
      completed.set(key, row);
    }
  });

  console.log('== EMPLOYEE TRANSFER LIST (what app/transfer.tsx shows) ==');
  users
    .map((user) => {
      const id = String(user.id);
      const assetCount = counts.get(id) ?? 0;
      const status = pending.has(id)
        ? 'TRANSFER PENDING'
        : assetCount === 0 && completed.has(id)
          ? 'REASSIGNED'
          : 'CURRENT';
      return { id, name: nameOf(user), dept: deptOf(user), num: numOf(user), assetCount, status };
    })
    .sort((a, b) => b.assetCount - a.assetCount || a.name.localeCompare(b.name))
    .forEach((row) => {
      console.log(
        `  ${String(row.assetCount).padStart(3)} asset(s)  ${row.status.padEnd(16)}  ${row.name}` +
          `${row.num ? ` (${row.num})` : ''}${row.dept ? ` \u2022 ${row.dept}` : ''}`,
      );
    });

  // ---- transfer history + its request_items -------------------------------
  const historyIds = (transfersRes.data ?? []).map((row) => row.id);
  const [itemsRes, peopleRes] = await Promise.all([
    historyIds.length
      ? db.from('request_items').select('request_id, asset_id').in('request_id', historyIds)
      : Promise.resolve({ data: [], error: null }),
    historyIds.length
      ? db
          .from('requests')
          .select('id, user_id, assign_to_user_id, status, Note, created_at, admin_remarks, admin_remarks_by')
          .in('id', historyIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (itemsRes.error) fail('request_items select', itemsRes.error);
  if (peopleRes.error) fail('history select', peopleRes.error);

  console.log('\n== TRANSFER HISTORY ==');
  if ((peopleRes.data ?? []).length === 0) console.log('  (no transfers recorded yet)');
  (peopleRes.data ?? []).forEach((row) => {
    const assets = (itemsRes.data ?? []).filter((item) => String(item.request_id) === String(row.id));
    console.log(
      `  TR-${String(row.id).padStart(3, '0')}  ${nameById.get(String(row.user_id)) ?? '?'} \u2192 ` +
        `${nameById.get(String(row.assign_to_user_id)) ?? '?'}  ${assets.length} asset(s)  ` +
        `[${row.status}] reason="${row.Note ?? ''}" by ${nameById.get(String(row.admin_remarks_by)) ?? 'office'}`,
    );
  });

  // ---- asset accountability history for the newest transfer ---------------
  if ((peopleRes.data ?? []).length > 0) {
    const newest = peopleRes.data[0];
    const { data: accountability, error } = await db
      .from('asset_accountability')
      .select('id, asset_id, user_id, request_id, Is_Current, Assign_date, transfer_reason')
      .eq('request_id', newest.id);
    if (error) fail('asset_accountability select', error);
    console.log('\n== ACCOUNTABILITY ROWS FOR TR- ' + newest.id + ' ==');
    console.log(`  ${(accountability ?? []).length} row(s)`);
    (accountability ?? []).slice(0, 3).forEach((row) => {
      console.log(
        `  asset ${row.asset_id} \u2192 user ${nameById.get(String(row.user_id)) ?? row.user_id} ` +
          `Is_Current=${row.Is_Current} reason=${row.transfer_reason ?? '-'}`,
      );
    });
  }

  // ---- custom asset-code duplicate check ----------------------------------
  console.log('\n== CUSTOM ASSET CODE DUPLICATE CHECK ==');
  const probe = ['TEST-CODE-THAT-DOES-NOT-EXIST'];
  const { data: sample } = await db.from('assets').select('Asset_code').not('Asset_code', 'is', null).limit(1);
  const realCode = sample?.[0]?.Asset_code;
  const codes = realCode ? [...probe, String(realCode)] : probe;
  const escaped = codes.map((code) => code.replace(/[%_\\]/g, (c) => `\\${c}`));
  const { data: found, error: findError } = await db
    .from('assets')
    .select('Asset_code')
    .or(escaped.map((code) => `Asset_code.ilike.${code}`).join(','));
  if (findError) fail('duplicate-code lookup', findError);
  console.log(`  looking up: ${codes.join(', ')}`);
  console.log(
    `  already used: ${(found ?? []).map((row) => row.Asset_code).join(', ') || '(none)'}` +
      `${realCode ? ` \u2014 expected to contain "${realCode}"` : ''}`,
  );
  if (realCode && !(found ?? []).some((row) => String(row.Asset_code) === String(realCode))) {
    fail('duplicate-code lookup missed an existing code', { message: realCode });
  }

  console.log(`\n${failures === 0 ? '\u2713 transfer + asset-code queries OK' : `\u2717 ${failures} issue(s)`}\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
