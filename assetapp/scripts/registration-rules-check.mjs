// The registration gate, checked against the web's `POST /register` rules.
// Pure logic, no database: `node scripts/registration-rules-check.mjs`.
import {
  EMAIL_INVALID_MESSAGE,
  EMPLOYEE_EMAIL_MISMATCH_MESSAGE,
  EMPLOYEE_INACTIVE_MESSAGE,
  EMPLOYEE_NOT_FOUND_MESSAGE,
  EMPLOYEE_TAKEN_MESSAGE,
  escapeLikePattern,
  isEmployeeRecordActive,
  isRegistrationRole,
  officialEmailMismatch,
  roleForNewAccount,
  validateRegistrationEmail,
} from '../lib/registrationRules.ts';

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

/* ── employee record eligibility (web: ($employee->status ?? 'Active') !== 'Active') ── */
check('active record is eligible', isEmployeeRecordActive('Active'), true);
check('lower-case active is eligible', isEmployeeRecordActive(' active '), true);
check('a record with no status counts as active', isEmployeeRecordActive(null), true);
check('empty status counts as active', isEmployeeRecordActive(''), true);
check('Inactive record is refused', isEmployeeRecordActive('Inactive'), false);
check('lower-case inactive is refused', isEmployeeRecordActive('inactive'), false);
check('any other status is refused', isEmployeeRecordActive('Suspended'), false);

/* ── official email on the masterlist ── */
check('no official email imposes nothing', officialEmailMismatch('', 'someone@nu.edu.ph'), false);
check('null official email imposes nothing', officialEmailMismatch(null, 'someone@nu.edu.ph'), false);
check('exact official email matches', officialEmailMismatch('juan@nu.edu.ph', 'juan@nu.edu.ph'), false);
check('matching ignores case', officialEmailMismatch('Juan@NU.edu.ph', 'juan@nu.edu.ph'), false);
check('matching ignores surrounding spaces', officialEmailMismatch(' juan@nu.edu.ph ', ' juan@nu.edu.ph'), false);
check('a different address is refused', officialEmailMismatch('juan@nu.edu.ph', 'other@nu.edu.ph'), true);

/* ── the role a new account may receive ── */
check('the first account ever is the Admin bootstrap', roleForNewAccount(0), 'Admin');
check('the second account is an Employee', roleForNewAccount(1), 'Employee');
check('later accounts are Employees', roleForNewAccount(25), 'Employee');
check('a numeric string count is handled', roleForNewAccount('3'), 'Employee');
check('registration can only produce Admin or Employee', isRegistrationRole('Department Head'), false);
check('Employee is a registration role', isRegistrationRole('Employee'), true);
check('Admin is a registration role', isRegistrationRole('Admin'), true);
check('Facilities is not a registration role', isRegistrationRole('Facilities'), false);

/* ── email format (web: required|email|max:100|unique:users,email) ── */
check('empty email is required', validateRegistrationEmail(''), 'Email is required.');
check('whitespace-only email is required', validateRegistrationEmail('   '), 'Email is required.');
check('email without an @ is invalid', validateRegistrationEmail('juan.nu.edu.ph'), EMAIL_INVALID_MESSAGE);
check('email without a domain is invalid', validateRegistrationEmail('juan@'), EMAIL_INVALID_MESSAGE);
check('email with a space is invalid', validateRegistrationEmail('juan dela cruz@nu.edu.ph'), EMAIL_INVALID_MESSAGE);
check('normal email is valid', validateRegistrationEmail('juan.delacruz@nu.edu.ph'), null);
check('surrounding spaces are trimmed', validateRegistrationEmail('  juan@nu.edu.ph  '), null);

/* ── duplicate-email lookup: the address is a value, not a pattern ── */
check('a plain address is unchanged', escapeLikePattern('juan@nu.edu.ph'), 'juan@nu.edu.ph');
check('underscore is escaped', escapeLikePattern('juan_dc@nu.edu.ph'), 'juan\\_dc@nu.edu.ph');
check('percent is escaped', escapeLikePattern('100%@nu.edu.ph'), '100\\%@nu.edu.ph');
check('backslash is escaped', escapeLikePattern('a\\b@nu.edu.ph'), 'a\\\\b@nu.edu.ph');
check('null is an empty pattern', escapeLikePattern(null), '');

/* ── the messages are the web's messages ── */
check(
  'unknown employee number message',
  EMPLOYEE_NOT_FOUND_MESSAGE,
  'Employee number not found in the system. Please contact the administrator.',
);
check(
  'inactive employee message explains activation',
  EMPLOYEE_INACTIVE_MESSAGE.includes('not active in the employee masterlist'),
  true,
);
check(
  'already-registered message is the web one',
  EMPLOYEE_TAKEN_MESSAGE.startsWith('This employee number is already registered.'),
  true,
);
check(
  'email mismatch points at the official address',
  EMPLOYEE_EMAIL_MISMATCH_MESSAGE.includes('official email on your employee record'),
  true,
);

console.log('');
if (failures > 0) {
  console.log(`${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('All registration-rule assertions passed.');
