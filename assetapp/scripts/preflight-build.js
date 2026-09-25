/**
 * Pre-flight the production bundle BEFORE spending an EAS build.
 *
 * Why this exists: the failing EAS task was
 *   :app:createReleaseUpdatesResources  (expo-updates -> createManifestForBuildAsync -> Metro)
 * and the error underneath it was
 *   "As of SDK 56, expo-router is no longer compatible with react-navigation"
 *
 * Both are checked here, locally, in about a minute:
 *   1. static check — does any of OUR code import `@react-navigation/*`?
 *      (the guard only fires for files outside node_modules, and only in builds
 *      that have no local .env overrides, which is exactly what EAS runs)
 *   2. the real Gradle script — `createUpdatesResources.js` for the target
 *      platform, run with the local env overrides stripped so the result matches
 *      a clean EAS machine.
 *
 * Nothing is written outside node_modules/.cache and nothing touches Supabase.
 *
 * Usage:  node scripts/preflight-build.js [android|ios]     (default: android)
 * Exit 0 = safe to run `eas build`. Exit 1 = fix what it prints first.
 */
/* global __dirname */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const platform = (process.argv[2] || 'android').toLowerCase();

if (!['android', 'ios'].includes(platform)) {
  console.error(`Unsupported platform: ${platform} (use "android" or "ios")`);
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 * 1. Static check for the SDK 56+ react-navigation incompatibility
 * ------------------------------------------------------------------ */

const SOURCE_DIRS = ['app', 'components', 'lib', 'hooks', 'constants'];
const NAV_IMPORT = /(?:from|require\(|import\()\s*['"]@react-navigation\//;

function sourceFiles() {
  const files = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) files.push(full);
    }
  };

  for (const dir of SOURCE_DIRS) {
    const full = path.join(projectRoot, dir);
    if (fs.existsSync(full)) walk(full);
  }

  // Root-level entry files (index.js, stray screens) are bundled too.
  for (const entry of fs.readdirSync(projectRoot, { withFileTypes: true })) {
    if (entry.isFile() && /\.(js|jsx|ts|tsx)$/.test(entry.name)) {
      files.push(path.join(projectRoot, entry.name));
    }
  }

  return files;
}

const offenders = [];
for (const file of sourceFiles()) {
  fs.readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (NAV_IMPORT.test(line)) {
        offenders.push(`${path.relative(projectRoot, file)}:${i + 1}  ${line.trim()}`);
      }
    });
}

if (offenders.length > 0) {
  console.error('\nFAIL — this code imports react-navigation, which SDK 56+ forbids:\n');
  offenders.forEach((line) => console.error('  ' + line));
  console.error(
    [
      '',
      'expo-router re-exports what you usually need, so swap the import source:',
      "  import { Stack } from 'expo-router';                 // not @react-navigation/native-stack",
      "  import { Drawer } from 'expo-router/drawer';         // not @react-navigation/drawer",
      "  import { ThemeProvider, DefaultTheme, DarkTheme } from 'expo-router';",
      '',
      'Migrating: https://docs.expo.dev/router/migrate/sdk-55-to-56/',
      'A production build will fail with: "expo-router is no longer compatible with react-navigation".',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

console.log('✓ no react-navigation imports in app code');

/* ------------------------------------------------------------------ *
 * 2. Run the exact script the Gradle task runs
 * ------------------------------------------------------------------ */

const script = path.join(
  projectRoot,
  'node_modules/expo-updates/utils/build/createUpdatesResources.js',
);

if (!fs.existsSync(script)) {
  console.log('• expo-updates is not installed; nothing to pre-flight.');
  process.exit(0);
}

const outDir = path.join(projectRoot, 'node_modules/.cache/nutrace-preflight', platform);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// Local .env values must not mask a problem that only shows up on EAS.
const env = { ...process.env };
delete env.EXPO_ROUTER_DISABLE_RN_NAVIGATION_CHECK;

console.log(`• bundling ${platform} release resources (this is the step EAS runs)…`);

let ok = true;
try {
  execFileSync(process.execPath, [script, platform, projectRoot, outDir, 'all'], {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
  });
} catch {
  ok = false;
}

const manifest = path.join(outDir, 'app.manifest');
let assetCount = 0;
if (ok && fs.existsSync(manifest)) {
  try {
    assetCount = JSON.parse(fs.readFileSync(manifest, 'utf8')).assets.length;
  } catch {
    ok = false;
  }
} else if (ok) {
  ok = false;
}

fs.rmSync(outDir, { recursive: true, force: true });

if (!ok) {
  console.error('\nFAIL — the release bundle did not build. Fix the output above first.');
  process.exit(1);
}

console.log(`✓ release ${platform} bundle OK (${assetCount} embedded assets)`);
console.log('  safe to run: npx eas-cli build --platform ' + platform + ' --profile preview');
