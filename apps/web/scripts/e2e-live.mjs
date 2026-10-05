// Runs the Playwright tests that need a real back end (e2e/*.live.spec.ts) against the local
// Supabase stack: reads its URL and keys from `supabase status`, builds the app with them into
// dist-live/ and serves it on port 4180. Extra arguments go to Playwright.
//   supabase start && pnpm e2e:live
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
let status;
try {
  status = JSON.parse(
    execFileSync('supabase', ['status', '-o', 'json'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  );
} catch {
  console.error('e2e-live: local Supabase is not running. Start it with `supabase start`.');
  process.exit(1);
}

const result = spawnSync('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    E2E_LIVE: '1',
    VITE_SUPABASE_URL: status.API_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY ?? status.ANON_KEY,
    // Used only by the tests, to clear reports between runs; never built into the app.
    SUPABASE_SECRET_KEY: status.SECRET_KEY ?? status.SERVICE_ROLE_KEY,
  },
});
process.exit(result.status ?? 1);
