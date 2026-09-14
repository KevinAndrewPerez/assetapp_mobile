import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from './supabase';

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
const KNOWN_STORAGE_BUCKETS = ['assets', 'qr_codes', 'photos', 'request_files', 'public', 'asset_files'];
/** Prefixes Laravel's `public` disk files carry on their way out of the database. */
const LARAVEL_STORAGE_PREFIXES = ['public/storage/', 'storage/app/public/', 'wwwroot/storage/', 'storage/'];
/** `php artisan serve` runs here unless told otherwise. */
const DEFAULT_WEB_PORT = '8000';

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
  const base = configuredWebBaseUrl();
  if (base) return /^https?:\/\//i.test(base) ? base : `http://${base}`;
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

/** Supabase Storage public URL for an object key, detecting the bucket from the key. */
const supabasePublicUrl = (key: string, fallbackBucket: string): string => {
  let bucket = fallbackBucket;
  let path = key;

  for (const known of KNOWN_STORAGE_BUCKETS) {
    if (path.toLowerCase().startsWith(`${known}/`)) {
      bucket = known;
      path = path.slice(known.length + 1);
      break;
    }
  }

  // QR codes live under the `assets` bucket in `qr/`.
  if (bucket === 'qr_codes') {
    bucket = 'assets';
    if (!path.startsWith('qr/')) path = `qr/${path}`;
  }

  const encodedPath = path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  if (!encodedPath) return '';

  const { data } = supabase.storage.from(bucket).getPublicUrl(encodedPath);
  return data?.publicUrl || '';
};

/**
 * Turn any stored file reference into a URL `<Image>` can load.
 *
 * @param raw an `asset_files` / request-file row, or the reference string itself
 * @param fallbackBucket bucket used when the reference carries no bucket of its own
 */
export const resolveMediaUrl = (raw: unknown, fallbackBucket = 'assets'): string => {
  const reference = referenceOf(raw);
  if (!reference) return '';

  if (/^data:/i.test(reference)) return reference;
  if (/^https?:\/\//i.test(reference)) return repointLoopbackHost(fixNestedPaths(reference));

  const path = reference.replace(/^\/+/, '');
  if (!path) return '';

  // A Supabase object path without the project origin.
  if (path.toLowerCase().startsWith(SUPABASE_PUBLIC_PREFIX)) {
    return supabasePublicUrl(path.slice(SUPABASE_PUBLIC_PREFIX.length), fallbackBucket);
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

