/**
 * The rules that decide whether an employee may activate a NU Trace account —
 * the mobile copy of the web's `POST /register` controller.
 *
 * Pure functions and constants only: no database, no Expo. Both the register
 * screen (to show the right message before asking for anything else) and
 * `lib/userService.ts` (which performs the write) use these, so the screen and
 * the service cannot drift apart.
 *
 * The masterlist is the authority, not this file:
 *
 *   - the employee number must exist in `employee_numbers`;
 *   - the record's `status` must be Active;
 *   - when the office has recorded an official `Email` for the employee, the
 *     address typed at registration must be that address;
 *   - an employee number that already owns an account cannot own a second one.
 *
 * Role assignment is deliberately not a choice: the web grants only the
 * Employee role at registration (the very first account ever is the Admin
 * bootstrap the system needs), and the Asset Management Office grants anything
 * beyond that on the Accounts tab. Registration used to make the first person
 * to sign up in a department its Department Head, which quietly handed approval
 * authority to whoever registered first — that is gone.
 */

/** Same wording the web register form returns for these cases. */
export const EMPLOYEE_NOT_FOUND_MESSAGE =
  'Employee number not found in the system. Please contact the administrator.';

export const EMPLOYEE_TAKEN_MESSAGE =
  'This employee number is already registered. Please use a different employee number or contact the administrator.';

export const EMAIL_TAKEN_MESSAGE = 'This email is already registered. Please sign in instead.';

export const EMPLOYEE_INACTIVE_MESSAGE =
  'This employee number is not active in the employee masterlist, so an account cannot be activated for it. Please contact the administrator.';

export const EMPLOYEE_EMAIL_MISMATCH_MESSAGE =
  'The email you entered does not match the official email on your employee record. Please use that address, or contact the administrator.';

/** The two roles registration can produce. Everything else is granted later. */
export type RegistrationRole = 'Admin' | 'Employee';

/**
 * Is this employee record eligible for an account?
 *
 * A row with no status at all counts as active: the column is enum-defaulted to
 * 'Active', and an older row that predates it must not be locked out. Only an
 * explicit non-Active value (Inactive) blocks, which is exactly what the web
 * checks (`($employee->status ?? 'Active') !== 'Active'`).
 */
export function isEmployeeRecordActive(status: string | null | undefined): boolean {
  const value = String(status ?? '').trim();
  return value === '' || value.toLowerCase() === 'active';
}

/**
 * Does the typed address contradict the official one on file?
 *
 * Only a recorded address can contradict: an empty one imposes nothing. The
 * comparison is case-insensitive because email domains and mailboxes are, and
 * the address is trimmed the way the controller trims input. The address itself
 * is never returned — a caller only needs the yes/no.
 */
export function officialEmailMismatch(
  officialEmail: string | null | undefined,
  enteredEmail: string | null | undefined,
): boolean {
  const official = String(officialEmail ?? '').trim().toLowerCase();
  if (!official) return false;
  return official !== String(enteredEmail ?? '').trim().toLowerCase();
}

/**
 * The role a brand-new account receives.
 *
 * Web parity: the very first account ever is the Administrator the system
 * cannot exist without; every other account is an Employee. No department is
 * consulted, and nobody is made a Department Head by registering.
 */
export function roleForNewAccount(existingAccountCount: number): RegistrationRole {
  return Number(existingAccountCount) === 0 ? 'Admin' : 'Employee';
}

/**
 * Escape a value used as a LIKE/ILIKE pattern.
 *
 * The duplicate-email check is a case-insensitive *equality* test built from
 * `ilike`, and `_` (legal in an email local part) would otherwise match any one
 * character. Escaping makes `a_b@nu.edu.ph` match only itself.
 */
export function escapeLikePattern(value: string | null | undefined): string {
  return String(value ?? '').replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Is the typed address a syntactically valid email?
 *
 * The same shape rule the register screen has always used, named so the service
 * applies it too — the screen is a convenience, the service is the gate.
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const EMAIL_INVALID_MESSAGE = 'Enter a valid email address.';

export function validateRegistrationEmail(email: string | null | undefined): string | null {
  const value = String(email ?? '').trim();
  if (!value) return 'Email is required.';
  if (!EMAIL_PATTERN.test(value)) return EMAIL_INVALID_MESSAGE;
  return null;
}

/** Is this one of the roles registration may produce? */
export const isRegistrationRole = (role: unknown): role is RegistrationRole =>
  role === 'Admin' || role === 'Employee';
