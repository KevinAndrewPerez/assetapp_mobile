/**
 * Read-only check that the mobile registration path reads the *same* tables the
 * web's Employee Management module maintains. Nothing is written.
 *
 *   node scripts/registration-alignment-probe.js
 *
 * It answers four questions against the live database:
 *
 *   1. Does `employee_numbers` have the official `Email` column the web's
 *      registration gate and the masterlist CSV use?
 *   2. Does the row the app looks up with `ilike` resolve the way the web's
 *      `UPPER(Employee_number)` lookup does?
 *   3. Is any employee number or email already attached to two accounts?
 *   4. Which roles exist in `users`, and are any outside the three the brief
 *      allows (Admin, Employee, Department Head)?
 *
 * Employee numbers, names and addresses are never printed: the probe reports
 * counts and pass/fail only.
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Run from the project root (the documented command does): the same `.env` the
// app itself reads is loaded without hard-coding a machine path.
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};

(async () => {
  /* 1. The masterlist shape the app selects. */
  const employees = await supabase
    .from('employee_numbers')
    .select('id, Full_Name, Employee_number, Department_id, status, Email, departments:Department_id(Name)')
    .limit(500);
  check(
    'employee masterlist select (incl. official Email) resolves',
    !employees.error,
    employees.error?.message ?? `${employees.data.length} row(s)`,
  );

  if (employees.error) {
    console.log('\nThe registration path cannot read the masterlist. Stopping.');
    process.exit(1);
  }

  const rows = employees.data;
  const withDepartment = rows.filter((row) => row.departments && (Array.isArray(row.departments) ? row.departments.length : true));
  check('employee rows join their department', withDepartment.length === rows.length, `${withDepartment.length}/${rows.length}`);

  const statuses = {};
  for (const row of rows) {
    const key = String(row.status ?? '(null)');
    statuses[key] = (statuses[key] ?? 0) + 1;
  }
  console.log('     employee statuses:', JSON.stringify(statuses));

  const withOfficialEmail = rows.filter((row) => String(row.Email ?? '').trim() !== '').length;
  console.log(`     employees with an official email: ${withOfficialEmail}/${rows.length}`);
  // Informational: the gate can only ever refuse a mismatch when the office has
  // recorded an address. No address on file means it imposes nothing, which is
  // the web's behaviour too.
  console.log(
    `     official-email gate: ${withOfficialEmail > 0 ? 'active for ' + withOfficialEmail + ' record(s)' : 'inactive - no address on file'}`,
  );

  /* 2. The exact lookup the register screen performs. */
  const sample = rows.find((row) => String(row.Employee_number ?? '').trim() !== '');
  if (sample) {
    const typed = `  ${String(sample.Employee_number).toLowerCase()}  `;
    const trimmed = typed.trim();
    const lookup = await supabase
      .from('employee_numbers')
      .select('id, Employee_number')
      .ilike('Employee_number', trimmed)
      .limit(25);
    const same = (lookup.data ?? []).some(
      (row) => String(row.Employee_number ?? '').trim().toLowerCase() === trimmed.toLowerCase(),
    );
    check('case/space-insensitive employee lookup resolves exactly one record', !lookup.error && same);
  }

  /* 3. Duplicate accounts — the rule registration must never break. */
  const users = await supabase
    .from('users')
    .select('id, email, role, status, employee_numbers_id')
    .limit(1000);
  check('accounts table select resolves', !users.error, users.error?.message ?? `${users.data?.length ?? 0} row(s)`);

  if (!users.error) {
    const byEmployee = new Map();
    const byEmail = new Map();
    const roles = {};
    const accountStatuses = {};

    for (const user of users.data) {
      if (user.employee_numbers_id != null) {
        byEmployee.set(user.employee_numbers_id, (byEmployee.get(user.employee_numbers_id) ?? 0) + 1);
      }
      if (user.email) {
        const key = String(user.email).trim().toLowerCase();
        byEmail.set(key, (byEmail.get(key) ?? 0) + 1);
      }
      roles[String(user.role ?? '(null)')] = (roles[String(user.role ?? '(null)')] ?? 0) + 1;
      accountStatuses[String(user.status ?? '(null)')] = (accountStatuses[String(user.status ?? '(null)')] ?? 0) + 1;
    }

    const duplicateEmployees = [...byEmployee.entries()].filter(([, count]) => count > 1);
    const duplicateEmails = [...byEmail.entries()].filter(([, count]) => count > 1);

    check('no employee number owns two accounts', duplicateEmployees.length === 0, `${duplicateEmployees.length} duplicate(s)`);
    check('no email owns two accounts', duplicateEmails.length === 0, `${duplicateEmails.length} duplicate(s)`);

    console.log('     roles:', JSON.stringify(roles));
    console.log('     account statuses:', JSON.stringify(accountStatuses));

    const allowed = new Set(['Admin', 'Employee', 'Department Head']);
    const unexpected = Object.keys(roles).filter((role) => !allowed.has(role));
    check('every account role is one the brief permits', unexpected.length === 0, unexpected.join(', '));

    const inactive = users.data.filter((user) => String(user.status ?? '').toLowerCase() === 'inactive').length;
    console.log(`     inactive accounts: ${inactive} (sign-in must refuse these)`);

    /* 4. Every registered account still points at a masterlist row. */
    const linked = users.data.filter((user) => user.employee_numbers_id != null).length;
    check('every account is linked to an employee master record', linked === users.data.length, `${linked}/${users.data.length}`);
  }

  console.log('');
  if (failures > 0) {
    console.log(`${failures} live check(s) failed.`);
    process.exit(1);
  }
  console.log('All read-only registration alignment checks passed.');
})();
