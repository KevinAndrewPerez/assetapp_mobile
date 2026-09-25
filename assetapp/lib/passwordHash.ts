import bcrypt from 'bcryptjs';

/**
 * Passwords live in one column, `users.password`, and are checked by the
 * database rather than by the app:
 *
 *     REPLACE(u.password,'$2y$','$2a$') = crypt(password_input, REPLACE(u.password,'$2y$','$2a$'))
 *
 * Postgres' pgcrypto only understands the `$2a$` form. A `$2b$` digest — what
 * bcryptjs emits by default, and what the app used to store on sign-up — is not
 * recognised, falls through to DES crypt and can never match, so the account
 * could not sign in at all.
 *
 * Re-tagging the digest as `$2y$` (identical computation, Laravel's own prefix)
 * puts it on the path the RPC rewrites to `$2a$`, which pgcrypto verifies and
 * Laravel's `Hash::check` accepts.
 */
export const DATABASE_HASH_PREFIX = '$2y$';

export async function hashPasswordForDatabase(password: string): Promise<string> {
  const digest = await bcrypt.hash(password, 12);
  return digest.replace(/^\$2[ab]\$/, DATABASE_HASH_PREFIX);
}

/**
 * Comparing from the app. `bcryptjs` reads `$2a$`, `$2b$` and `$2y$` digests,
 * so hashes written by this app and by the Laravel web app both verify — the
 * reset-code check relies on that.
 */
export async function verifyStoredHash(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash) return false;
  try {
    return await bcrypt.compare(password, storedHash);
  } catch {
    return false;
  }
}
