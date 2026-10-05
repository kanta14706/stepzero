// Record real OpenTripPlanner answers as test fixtures (src/features/journey/fixtures/).
// Needs a running OTP built from the Toei Pathways feed: cd otp && ./build.sh toei-pathway &&
// docker compose up otp. Run: node scripts/record-otp.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../src/features/journey');
const url = process.env.OTP_URL ?? 'http://localhost:8080';
const plan = readFileSync(resolve(dir, 'plan.graphql'), 'utf8');
const stop = (id) => ({ location: { stopLocation: { stopLocationId: id } } });
const point = (latitude, longitude) => ({ location: { coordinate: { latitude, longitude } } });
const time = '2026-10-07T09:00:00+09:00'; // a Wednesday inside the feed's service period

const cases = {
  'daimon-shinjuku': { origin: stop('1:421'), destination: stop('1:428') },
  'daimon-tochomae': { origin: stop('1:421'), destination: stop('1:429') },
  'daimon-oshiage': { origin: stop('1:421'), destination: stop('1:120') },
  // 東京タワー (35.65858, 139.74543) to 新宿: OTP walks to 赤羽橋 (tier 2) first.
  'tower-shinjuku': { origin: point(35.65858, 139.74543), destination: stop('1:428') },
};

for (const [name, ends] of Object.entries(cases)) {
  const variables = { ...ends, time, wheelchair: true, first: 6 };
  const res = await fetch(`${url}/otp/gtfs/v1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: plan, variables }),
  });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const body = await res.json();
  if (!body.data) throw new Error(`${name}: ${JSON.stringify(body.errors)}`);
  const out = {
    recorded: new Date().toISOString(),
    otp: 'opentripplanner 2.10.0, toei-pathway',
    variables,
    data: body.data,
  };
  writeFileSync(resolve(dir, 'fixtures', `${name}.json`), JSON.stringify(out, null, 1) + '\n');
  console.log(`${name}: ${body.data.planConnection.edges.length} itineraries`);
}
