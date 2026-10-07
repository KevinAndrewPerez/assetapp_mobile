import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { STORAGE_BUCKET, supabase } from './supabase';

/**
 * Everything that stores a file reference in this project writes one of two shapes:
 *
 *   • the Expo app itself  → a full Supabase Storage URL
 *     `https://<project>.supabase.co/storage/v1/object/public/assets/photos/…`
 *   • the NUTrace web app  → Laravel's `public` disk
 *     `/storage/assets/xyz.jpg`, `storage/assets/xyz.jpg` or `http://localhost/storage/assets/xyz.jpg`
 *
 * The second shape is invisible on a phone: `localhost` means the phone itself and a
 * web-relative path has no origin at all, which is why web-uploaded asset photos showed
 * up as an empty box on mobile while rendering fine in the browser.
 *
 * Resolution order:
 *   1. absolute URLs are kept (only a `localhost` host is repointed)
 *   2. Laravel paths are joined to the NUTrace origin (`EXPO_PUBLIC_WEB_URL`, otherwise
 *      the host that serves the JS bundle — normally the same PC — on port
 *      `EXPO_PUBLIC_WEB_PORT`, default 8000 = `php artisan serve`)
 *   3. anything left is treated as a Supabase Storage object key
 */

type ExpoExtra = {
  EXPO_PUBLIC_WEB_URL?: string;
  EXPO_PUBLIC_WEB_PORT?: string;
  WEB_URL?: string;
};

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'];
const SUPABASE_PUBLIC_PREFIX = 'storage/v1/object/public/';
/**
 * This project keeps exactly ONE Storage bucket — `assets`. Every other name
 * that looks like a bucket (`assets/`, `photos/`, `profile_photos/`,
 * `request_files/`, `qr/`, `brand/`) is a folder inside it, and the reference
 * stored in the database is the object KEY, so it has to survive untouched.
 *
 * Reading those names as buckets is what broke image loading: a stored
 * `assets/qr/AST-1-17.png` was requested as
 * `/object/public/assets/qr/AST-1-17.png` (404) instead of
 * `/object/public/assets/assets/qr/AST-1-17.png` (200) — the same normalisation
 * the web app does in `Media::normalizePath()`.
 */
const LEGACY_QR_FOLDER = 'qr_codes';
/** Folder QR images live in inside the bucket, for rows that hold only a name. */
const QR_FOLDER = 'assets/qr';
/** Prefixes Laravel's `public` disk files carry on their way out of the database. */
const LARAVEL_STORAGE_PREFIXES = ['public/storage/', 'storage/app/public/', 'wwwroot/storage/', 'storage/'];
/** `php artisan serve` runs here unless told otherwise. */
const DEFAULT_WEB_PORT = '8000';
/**
 * Where the deployed NUTrace web app lives, e.g. `https://nutrace.up.railway.app`.
 *
 * Web-uploaded files (Laravel's `public` disk) only carry a path like
 * `/storage/assets/x.jpg`, so their origin has to come from somewhere. In Expo Go the
 * Metro host was a good guess, but a real build has no dev server — set
 * `EXPO_PUBLIC_WEB_URL` in `.env` (or hard-code it here) before shipping.
 */
/**
 * The deployed NUTrace web app. Used both for Laravel-uploaded files and by the
 * forgot-password flow, which asks the site to mail the verification code.
 * `EXPO_PUBLIC_WEB_URL` still wins when it is set.
 */
const PRODUCTION_WEB_URL = 'https://nutrace-production.up.railway.app';

const isProductionBuild = typeof __DEV__ !== 'undefined' && __DEV__ === false;

const expoExtra = (): ExpoExtra =>
  ((Constants.expoConfig as { extra?: ExpoExtra } | null)?.extra ?? {}) as ExpoExtra;

const warned = new Set<string>();
const warnOnce = (key: string, message: string) => {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
};

/** `EXPO_PUBLIC_WEB_URL` — the NUTrace web app, e.g. `http://192.168.1.5:8000`. */
const configuredWebBaseUrl = (): string =>
  String(
    process.env.EXPO_PUBLIC_WEB_URL ||
      process.env.EXPO_PUBLIC_WEB_APP_URL ||
      process.env.EXPO_PUBLIC_APP_URL ||
      expoExtra().EXPO_PUBLIC_WEB_URL ||
      expoExtra().WEB_URL ||
      '',
  )
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/storage$/i, '');

const configuredWebPort = (): string => {
  const port = String(process.env.EXPO_PUBLIC_WEB_PORT || expoExtra().EXPO_PUBLIC_WEB_PORT || '').trim();
  return /^\d+$/.test(port) ? port : '';
};

/**
 * The machine serving the JS bundle is almost always the machine serving NUTrace, so its
 * LAN address is the best guess for a `localhost` reference. Emulators use an alias.
 */
const devServerHost = (): string => {
  const hostUri = String(
    (Constants.expoConfig as { hostUri?: string } | null)?.hostUri ??
      (Constants as unknown as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig?.debuggerHost ??
      '',
  );
  const host = hostUri.replace(/^[a-z]+:\/\//i, '').split('/')[0].split(':')[0].trim();
  if (host && !LOOPBACK_HOSTS.includes(host.toLowerCase())) return host;
  return Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
};

/** Origin that serves Laravel's `/storage/...` files (photos uploaded from the web). */
export const webOrigin = (): string => {
  const base = configuredWebBaseUrl() || PRODUCTION_WEB_URL;
  if (base) return /^https?:\/\//i.test(base) ? base : `http://${base}`;

  if (isProductionBuild) {
    // There is no Metro host to fall back on once the app is installed, so this must be
    // configured for web-uploaded photos to render outside Expo Go.
    warnOnce(
      'no-web-origin',
      '[mediaUrl] No NUTrace web origin configured. Files uploaded from the web cannot be '
        + 'resolved in a release build — set EXPO_PUBLIC_WEB_URL in .env (or PRODUCTION_WEB_URL in lib/mediaUrl.ts).',
    );
  }
  return `http://${devServerHost()}:${configuredWebPort() || DEFAULT_WEB_PORT}`;
};

/** Unwrap `asset_files` rows, plain strings or stringified JSON into one reference. */
const referenceOf = (raw: unknown): string => {
  if (!raw) return '';

  let value: unknown = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return '';

  if (typeof value === 'object') {
    const row = value as Record<string, unknown>;
    value = row.url || row.file_path || row.path || row.FilePath || '';
  }

  let str = String(value ?? '').trim();
  if (str.startsWith('{') && str.endsWith('}')) {
    try {
      const parsed = JSON.parse(str) as Record<string, unknown>;
      str = String(parsed.url || parsed.file_path || parsed.path || parsed.FilePath || str).trim();
    } catch {
      // Not JSON after all — keep the original reference.
    }
  }
  return str;
};

/** Repair the double-nested paths older rows picked up. */
const fixNestedPaths = (url: string): string =>
  url
    .replace(/\/storage\/v1\/object\/public\/assets\/storage\/assets\//g, '/storage/v1/object/public/assets/')
    .replace(/\/storage\/v1\/object\/public\/assets\/storage\//g, '/storage/v1/object/public/assets/')
    .replace(/\/storage\/assets\/storage\/assets\//g, '/storage/v1/object/public/assets/')
    .replace(/([^:\/])\/\/+/g, '$1/');

/**
 * A URL pointing at `localhost` can never work from the phone — send it to the NUTrace
 * origin instead, keeping the rest of the path untouched.
 */
const repointLoopbackHost = (url: string): string => {
  const match = /^(https?):\/\/([^/?#:]+)(?::(\d+))?(\/[^?#]*)?([?#].*)?$/i.exec(url);
  if (!match) return url;
  const [, scheme, host, port, path = '', suffix = ''] = match;
  if (!LOOPBACK_HOSTS.includes(host.toLowerCase())) return url;

  const origin = /^(https?):\/\/([^/?#:]+)(?::(\d+))?/i.exec(webOrigin());
  if (!origin) return url;

  const next = `${origin[1] || scheme}://${origin[2]}${
    origin[3] ? `:${origin[3]}` : port ? `:${port}` : ''
  }${path}${suffix}`;
  warnOnce(
    url,
    `[mediaUrl] "${url}" points at the phone itself. Loading "${next}" instead — set EXPO_PUBLIC_WEB_URL (or EXPO_PUBLIC_WEB_PORT) to pin the NUTrace host.`,
  );
  return next;
};

/**
 * Public URL of an object key inside the single `assets` bucket.
 *
 * The key is used verbatim — folder prefixes included — because the bucket
 * layout is the key layout. Only two legacy shapes are repointed: a
 * `qr_codes/...` reference (the QR folder is `assets/qr/` now) and a bare file
 * name coming from the QR column, which belongs in `assets/qr/` too.
 */
const supabasePublicUrl = (key: string, fallbackBucket: string): string => {
  let path = String(key ?? '').replace(/^\/+/, '');

  if (path.toLowerCase().startsWith(`${LEGACY_QR_FOLDER}/`)) {
    path = `${QR_FOLDER}/${path.slice(LEGACY_QR_FOLDER.length + 1)}`;
  } else if (fallbackBucket === LEGACY_QR_FOLDER && ! path.includes('/')) {
    path = `${QR_FOLDER}/${path}`;
  }

  const encodedPath = path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  if (!encodedPath) return '';

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(encodedPath);
  return data?.publicUrl || '';
};

/**
 * Turn any stored file reference into a URL `<Image>` can load.
 *
 * @param raw an `asset_files` / request-file row, or the reference string itself
 * @param fallbackBucket only the legacy `qr_codes` value changes anything: a bare
 *   file name then resolves inside the `assets/qr/` folder
 */
export const resolveMediaUrl = (raw: unknown, fallbackBucket = 'assets'): string => {
  const reference = referenceOf(raw);
  if (!reference) return '';

  if (/^data:/i.test(reference)) return reference;
  if (/^https?:\/\//i.test(reference)) return repointLoopbackHost(fixNestedPaths(reference));

  const path = reference.replace(/^\/+/, '');
  if (!path) return '';

  // A Supabase object path without the project origin. The remainder still
  // starts with the bucket name, which is not part of the object key.
  if (path.toLowerCase().startsWith(SUPABASE_PUBLIC_PREFIX)) {
    const remainder = path.slice(SUPABASE_PUBLIC_PREFIX.length);
    const withoutBucket = remainder.toLowerCase().startsWith(`${STORAGE_BUCKET}/`)
      ? remainder.slice(STORAGE_BUCKET.length + 1)
      : remainder;
    return supabasePublicUrl(withoutBucket, fallbackBucket);
  }

  // A file on the NUTrace web server's public disk.
  const laravelPrefix = LARAVEL_STORAGE_PREFIXES.find((prefix) => path.toLowerCase().startsWith(prefix));
  if (laravelPrefix && path.length > laravelPrefix.length) {
    const origin = webOrigin();
    if (!configuredWebBaseUrl()) {
      warnOnce(
        `laravel:${origin}`,
        `[mediaUrl] Web-uploaded files ("${reference}") are resolved against ${origin}, guessed from the dev server. Set EXPO_PUBLIC_WEB_URL / EXPO_PUBLIC_WEB_PORT in .env if NUTrace runs elsewhere.`,
      );
    }
    return `${origin}/storage/${path.slice(laravelPrefix.length)}`;
  }

  return supabasePublicUrl(path, fallbackBucket);
};

/** Photo of an asset — an `asset_files` row or its stored reference. */
export const resolveAssetImageUrl = (raw: unknown): string => resolveMediaUrl(raw, 'assets');

