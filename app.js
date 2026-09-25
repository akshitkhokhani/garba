import './assets/runtime/route-readiness.js';
import './assets/runtime/share-intent.js';
import './assets/runtime/morphicons.js';
import './assets/runtime/live-station.js';
import { normalizeSearchText, rankSearchRecords } from './assets/runtime/search-core.js';
import { initMorphicons } from './assets/runtime/morphicons.js';
import { getLiveBroadcastState, getNextLiveTrack } from './assets/runtime/live-station.js';
const { routeReadiness, canExecuteSong } = window.GARBA_ROUTE_READINESS;
const {
  parseShareTimestamp,
  buildSongShareUrl,
  formatShareText,
  executeShare,
} = window.GARBA_SHARE_INTENT || {};

const storage = {
  get(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value == null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode / storage denied */ }
  },
};

const RECENT_SONGS_KEY = 'garba:recentSongs';
const RECENT_STARTERS_KEY = 'garba:recentInitialSongs';
const MAX_RECENT_HISTORY = 150;

function getRecentPlayedSongs() {
  const list = storage.get(RECENT_SONGS_KEY, storage.get(RECENT_STARTERS_KEY, []));
  return Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [];
}

function recordRecentPlayedSong(songId) {
  if (!songId || typeof songId !== 'string') return;
  const current = getRecentPlayedSongs();
  const next = [...current.filter((id) => id !== songId), songId].slice(-MAX_RECENT_HISTORY);
  storage.set(RECENT_SONGS_KEY, next);
  storage.set(RECENT_STARTERS_KEY, next);
}

const state = {
  genres: [],
  songs: [],
  genreId: 'traditional',
  songId: null,
  favourites: new Set(storage.get('garba:favourites', [])),
  manualQueue: [...new Set(storage.get('garba:queue', []).filter((id) => typeof id === 'string'))].slice(0, 30),
  listeningHistory: [],
  playContextGenreId: 'traditional',
  playContextSongId: null,
  releaseContextId: null,
  releaseContextSongId: null,
  releaseContextConsumedIds: new Set(),
  playing: false,
  elapsed: 0,
  duration: 0,
  sheetFilter: 'traditional',
  sheetMode: 'all',
  sheetSnap: 'closed',
  sheetMatchCount: 0,
  toastTimer: null,
  transitionToken: 0,
  installPrompt: null,
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  lastPersistedElapsed: -1,
  catalogueSignature: '',
  catalogueLoadedAt: 0,
  pendingSongId: null,
  sheetTrigger: null,
  searchFocusTimer: null,
  presentationRedirects: new Map(),
  hasExplicitNavigation: false,
  shuffleMode: storage.get('garba:shuffle', false),
  liveMode: false,
  morphs: null,
};

const $ = (id) => document.getElementById(id);
const els = {
  app: $('app'),
  worldA: $('worldA'),
  worldB: $('worldB'),
  worldAmbient: $('worldAmbient'),
  trackBlock: $('trackBlock'),
  genreEyebrow: $('genreEyebrow'),
  songTitle: $('songTitle'),
  songArtist: $('songArtist'),
  playButton: $('playButton'),
  shuffleButton: $('shuffleButton'),
  liveStationButton: $('liveStationButton'),
  prevButton: $('prevButton'),
  nextButton: $('nextButton'),
  progress: $('progress'),
  elapsedTime: $('elapsedTime'),
  durationTime: $('durationTime'),
  genreStrip: $('genreStrip'),
  browseButton: $('browseButton'),
  songSheet: $('songSheet'),
  sheetHandle: $('sheetHandle'),
  sheetTitle: $('sheetTitle'),
  sheetSummary: $('sheetSummary'),
  sheetClose: $('sheetClose'),
  sheetBackdrop: $('sheetBackdrop'),
  sheetGenreStrip: $('sheetGenreStrip'),
  songList: $('songList'),
  searchButton: $('searchButton'),
  shareButton: $('shareButton'),
  favouritesButton: $('favouritesButton'),
  queueButton: $('queueButton'),
  queueBadge: $('queueBadge'),
  searchInput: $('searchInput'),
  mobileFavourite: $('mobileFavourite'),
  miniTitle: $('miniTitle'),
  miniArtist: $('miniArtist'),
  miniProgress: $('miniProgress'),
  miniPlay: $('miniPlay'),
  miniPrev: $('miniPrev'),
  miniNext: $('miniNext'),
  audio: $('audio'),
  toast: $('toast'),
  installBanner: $('installBanner'),
  installTitle: $('installTitle'),
  installText: $('installText'),
  installButton: $('installButton'),
  installDismiss: $('installDismiss'),
};

const mobileQuery = window.matchMedia('(max-width: 700px)');
const standaloneQuery = window.matchMedia('(display-mode: standalone)');
const SEARCH_RESULT_LIMIT = 160;

const formatTime = (seconds = 0) => {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
};

const formatDuration = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--:--';
  return formatTime(seconds);
};

const currentSong = () => state.songs.find((song) => song.id === state.songId) || null;
const currentGenre = () => state.genres.find((genre) => genre.id === state.genreId) || null;
const songsForGenre = (genreId) => state.songs.filter((song) => song.genre === genreId);

const numericTrackNumber = (song) => {
  const value = Number(song?.trackNumber);
  return Number.isFinite(value) && value > 0 ? value : null;
};

function orderedReleaseSongs(releaseId) {
  if (!releaseId) return [];
  const byId = new Map();
  for (const song of state.songs) {
    if (!song?.id || song.releaseId !== releaseId || numericTrackNumber(song) == null) continue;
    byId.set(song.id, song);
  }
  return [...byId.values()].sort((left, right) => {
    const trackDelta = numericTrackNumber(left) - numericTrackNumber(right);
    return trackDelta || left.id.localeCompare(right.id);
  });
}

function releaseContextMatch(releaseId, songId) {
  const ordered = orderedReleaseSongs(releaseId);
  if (ordered.length < 2 || !songId) return null;
  return ordered.some((song) => song.id === songId) ? { releaseId, songId, ordered } : null;
}

function clearReleaseContext() {
  state.releaseContextId = null;
  state.releaseContextSongId = null;
  state.releaseContextConsumedIds.clear();
}

function setReleaseContext(releaseId, songId) {
  const match = releaseContextMatch(releaseId, songId);
  if (!match) {
    clearReleaseContext();
    return false;
  }
  state.releaseContextId = match.releaseId;
  state.releaseContextSongId = match.songId;
  state.releaseContextConsumedIds.clear();
  return true;
}

function songBelongsToActiveRelease(song) {
  return Boolean(
    song?.id
    && state.releaseContextId
    && song.releaseId === state.releaseContextId
    && numericTrackNumber(song) != null
    && orderedReleaseSongs(state.releaseContextId).some((entry) => entry.id === song.id)
  );
}

function releaseContinuationSongs(limit = Infinity) {
  const match = releaseContextMatch(state.releaseContextId, state.releaseContextSongId);
  if (!match) return [];
  const index = match.ordered.findIndex((song) => song.id === state.releaseContextSongId);
  const remaining = index >= 0
    ? match.ordered.slice(index + 1).filter((song) => (
      !state.releaseContextConsumedIds.has(song.id) && canExecuteSong(song)
    ))
    : [];
  return Number.isFinite(limit) ? remaining.slice(0, Math.max(0, limit)) : remaining;
}

function automaticGenreContinuation(limit = 12, {
  genreId = state.playContextGenreId || state.genreId,
  anchorId = state.playContextSongId || state.songId,
  excludeIds = new Set(),
} = {}) {
  const list = songsForGenre(genreId);
  if (!list.length || limit <= 0) return [];
  const excluded = excludeIds instanceof Set ? excludeIds : new Set(excludeIds || []);
  const anchorIndex = list.findIndex((song) => song.id === anchorId);
  const ordered = anchorIndex < 0
    ? [...list]
    : [...list.slice(anchorIndex + 1), ...list.slice(0, anchorIndex)];
  const seen = new Set();
  const result = [];
  for (const song of ordered) {
    if (!song?.id || song.id === state.songId || excluded.has(song.id) || seen.has(song.id) || !canExecuteSong(song)) continue;
    seen.add(song.id);
    result.push(song);
    if (result.length >= limit) break;
  }
  return result;
}

function persistFavourites() {
  storage.set('garba:favourites', [...state.favourites]);
}

function reconcilePresentationFavourites() {
  const visibleIds = new Set(state.songs.map((song) => song.id));
  const next = new Set();
  let changed = false;
  for (const id of state.favourites) {
    const redirect = state.presentationRedirects.get(id);
    const mapped = redirect?.canonicalSongId || id;
    if (visibleIds.has(mapped)) next.add(mapped);
    if (mapped !== id || !visibleIds.has(id)) changed = true;
  }
  if (changed || next.size !== state.favourites.size) {
    state.favourites = next;
    persistFavourites();
  }
}

function persistManualQueue() {
  storage.set('garba:queue', state.manualQueue);
}

function sanitiseManualQueue() {
  const byId = new Map(state.songs.map((song) => [song.id, song]));
  const next = [];
  const seen = new Set();
  for (const id of state.manualQueue) {
    const song = byId.get(id);
    if (!song || !canExecuteSong(song) || id === state.songId || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
    if (next.length >= 30) break;
  }
  const changed = next.length !== state.manualQueue.length || next.some((id, index) => id !== state.manualQueue[index]);
  state.manualQueue = next;
  if (changed) persistManualQueue();
}

function persistSession() {
  storage.set('garba:session', {
    genreId: state.genreId,
    songId: state.songId,
    elapsed: Math.round(state.elapsed || 0),
  });
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2500);
}

function setAccent(accent) {
  document.documentElement.style.setProperty('--accent', accent || '#d6b06f');
}

function setPlaying(playing) {
  state.playing = playing;
  els.app.classList.toggle('is-playing', playing);
  els.playButton.classList.toggle('is-playing', playing);
  els.miniPlay.classList.toggle('is-playing', playing);
  els.playButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  els.miniPlay.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  state.morphs?.get('play')?.morphTo(playing ? 'pause' : 'play');
  state.morphs?.get('miniPlay')?.morphTo(playing ? 'pause' : 'play');
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
}

function configureGenreButton(button, genre, activeId, onSelect) {
  if (button.dataset.genreBound !== 'true') {
    button.dataset.genreBound = 'true';
    button.addEventListener('click', () => {
      if (typeof button._garbaGenreSelect === 'function') button._garbaGenreSelect(button.dataset.genre);
    });
  }

  button._garbaGenreSelect = onSelect;
  button.classList.add('genre-button');
  button.classList.toggle('active', genre.id === activeId);
  button.type = 'button';
  button.dataset.genre = genre.id;

  let iconFrame = button.querySelector(':scope > .genre-icon-frame');
  let label = button.querySelector(':scope > .genre-label');
  if (!iconFrame || !label) {
    button.replaceChildren();
    iconFrame = document.createElement('span');
    iconFrame.className = 'genre-icon-frame';
    iconFrame.setAttribute('aria-hidden', 'true');
    const iconImg = document.createElement('span');
    iconImg.className = 'genre-icon-img';
    iconFrame.appendChild(iconImg);
    label = document.createElement('span');
    label.className = 'genre-label';
    label.textContent = genre.name;
    button.appendChild(iconFrame);
    button.appendChild(label);
  } else if (label.textContent !== genre.name) {
    label.textContent = genre.name;
  }

  if (genre.id === activeId) button.setAttribute('aria-current', 'true');
  else button.removeAttribute('aria-current');
}

function reconcileGenreButtons(container, activeId, onSelect) {
  if (!container) return;
  const previousScrollLeft = Math.max(0, container.scrollLeft || 0);
  const focusedGenre = container.contains(document.activeElement) ? document.activeElement?.dataset?.genre : null;
  const desiredIds = new Set(state.genres.map((genre) => genre.id));
  const existing = new Map(
    [...container.querySelectorAll(':scope > .genre-button[data-genre]')]
      .map((button) => [button.dataset.genre, button])
  );

  const desiredButtons = state.genres.map((genre) => {
    const button = existing.get(genre.id) || document.createElement('button');
    configureGenreButton(button, genre, activeId, onSelect);
    existing.delete(genre.id);
    return button;
  });

  existing.forEach((button, genreId) => {
    if (!desiredIds.has(genreId)) button.remove();
  });

  const nonstop = container.querySelector(':scope > #nonstopButton');
  if (nonstop && container.firstElementChild !== nonstop) container.insertBefore(nonstop, container.firstElementChild);
  const offset = nonstop ? 1 : 0;
  desiredButtons.forEach((button, index) => {
    const slot = container.children[offset + index] || null;
    if (slot !== button) container.insertBefore(button, slot);
  });

  const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
  container.scrollLeft = Math.min(previousScrollLeft, maxLeft);
  container.scrollTop = 0;

  if (focusedGenre && !container.contains(document.activeElement)) {
    container.querySelector(`[data-genre="${CSS.escape(focusedGenre)}"]`)?.focus({ preventScroll: true });
  }
}

function revealGenreHorizontally(strip, button, { smooth = true } = {}) {
  if (!strip || !button) return;
  const stripRect = strip.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  const edgeInset = Math.min(28, Math.max(16, strip.clientWidth * .055));
  const safeLeft = stripRect.left + edgeInset;
  const safeRight = stripRect.right - edgeInset;
  let delta = 0;

  if (buttonRect.left < safeLeft) delta = buttonRect.left - safeLeft;
  else if (buttonRect.right > safeRight) delta = buttonRect.right - safeRight;

  strip.scrollTop = 0;
  if (Math.abs(delta) < 1) return;

  const maxLeft = Math.max(0, strip.scrollWidth - strip.clientWidth);
  const left = Math.min(maxLeft, Math.max(0, strip.scrollLeft + delta));
  const behavior = smooth && !state.reducedMotion ? 'smooth' : 'auto';
  if (typeof strip.scrollTo === 'function') strip.scrollTo({ left, top: 0, behavior });
  else strip.scrollLeft = left;
}

function syncGenreStrips({ smooth = true } = {}) {
  reconcileGenreButtons(els.genreStrip, state.genreId, selectGenre);
  syncSheetGenresOnly();

  requestAnimationFrame(() => {
    revealGenreHorizontally(els.genreStrip, els.genreStrip.querySelector('.active'), { smooth });
    revealGenreHorizontally(els.sheetGenreStrip, els.sheetGenreStrip.querySelector('.active'), { smooth });
  });
}

function syncSheetGenresOnly() {
  reconcileGenreButtons(els.sheetGenreStrip, state.sheetFilter, (genreId) => {
    state.sheetFilter = genreId;
    state.sheetMode = 'all';
    renderSheet();
  });
}

function updateUrl() {
  if (!state.hasExplicitNavigation && !location.search && !location.hash) {
    return;
  }
  const url = new URL(location.href);
  const songId = state.pendingSongId || state.songId;
  const song = state.songs.find((entry) => entry.id === songId) || null;

  if (songId) {
    url.searchParams.set('song', songId);
    url.searchParams.delete('genre');
  } else {
    url.searchParams.delete('song');
    if (state.genreId && state.genreId !== 'traditional') {
      url.searchParams.set('genre', state.genreId);
    } else {
      url.searchParams.delete('genre');
    }
  }

  if (
    state.releaseContextId
    && song?.releaseId === state.releaseContextId
    && numericTrackNumber(song) != null
  ) url.searchParams.set('release', state.releaseContextId);
  else url.searchParams.delete('release');

  url.searchParams.delete('browse');
  url.searchParams.delete('source');
  url.searchParams.delete('library');

  const search = url.searchParams.toString();
  const next = `${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
  const current = `${location.pathname}${location.search}${location.hash}`;
  if (next !== current) {
    history.replaceState(history.state, '', next);
  }
}

function updateFavouriteUI() {
  const song = currentSong();
  const active = song ? state.favourites.has(song.id) : false;
  els.mobileFavourite?.classList.toggle('active', active);
  els.mobileFavourite?.setAttribute('aria-pressed', String(active));
  els.favouritesButton?.classList.toggle('active', active);
  els.favouritesButton?.setAttribute('aria-pressed', String(active));
  state.morphs?.get('favourites')?.morphTo(active ? 'heartFilled' : 'heartOutline');
  state.morphs?.get('mobileFavourite')?.morphTo(active ? 'heartFilled' : 'heartOutline');
}

function automaticUpNextSongs(limit = 12) {
  if (state.releaseContextId) {
    const releaseSongs = orderedReleaseSongs(state.releaseContextId);
    const releaseIds = new Set(releaseSongs.map((song) => song.id));
    const remaining = releaseContinuationSongs(limit);
    if (remaining.length >= limit) return remaining;
    const anchorId = state.releaseContextSongId || state.songId;
    const anchorSong = state.songs.find((song) => song.id === anchorId) || null;
    const generic = automaticGenreContinuation(limit - remaining.length, {
      genreId: anchorSong?.genre || state.playContextGenreId || state.genreId,
      anchorId,
      excludeIds: releaseIds,
    });
    return [...remaining, ...generic].slice(0, limit);
  }
  return automaticGenreContinuation(limit);
}

function manualQueueSongs() {
  sanitiseManualQueue();
  const byId = new Map(state.songs.map((song) => [song.id, song]));
  return state.manualQueue.map((id) => byId.get(id)).filter(Boolean);
}

function getUpNextSongs() {
  const queued = manualQueueSongs();
  const queuedIds = new Set(queued.map((song) => song.id));
  const automatic = automaticUpNextSongs(12).filter((song) => song.id !== state.songId && !queuedIds.has(song.id));
  return [...queued, ...automatic].slice(0, Math.max(12, queued.length + Math.min(8, automatic.length)));
}

function queueSong(songId) {
  if (!songId || songId === state.songId) {
    showToast('That song is already playing.');
    return;
  }
  const queuedSong = state.songs.find((song) => song.id === songId);
  if (!queuedSong) return;
  if (!canExecuteSong(queuedSong)) {
    showToast('This recording is not available to play yet.');
    return;
  }
  if (state.manualQueue.includes(songId)) {
    showToast('Already in Up next.');
    return;
  }
  state.manualQueue.push(songId);
  state.manualQueue = state.manualQueue.slice(0, 30);
  persistManualQueue();
  updateQueueBadge();
  if (state.sheetMode === 'queue') renderSheet();
  showToast('Added to Up next.');
}

function removeQueuedSong(songId, { announce = true } = {}) {
  const before = state.manualQueue.length;
  state.manualQueue = state.manualQueue.filter((id) => id !== songId);
  if (state.manualQueue.length === before) return false;
  persistManualQueue();
  updateQueueBadge();
  if (state.sheetMode === 'queue') renderSheet();
  if (announce) showToast('Removed from Up next.');
  return true;
}

function clearManualQueue() {
  if (!state.manualQueue.length) return;
  state.manualQueue = [];
  persistManualQueue();
  updateQueueBadge();
  if (state.sheetMode === 'queue') renderSheet();
  showToast('Up next cleared.');
}

function updateQueueBadge() {
  const manualCount = manualQueueSongs().length;
  const count = getUpNextSongs().length;
  els.queueBadge.textContent = manualCount ? (manualCount > 9 ? '9+' : String(manualCount)) : (count > 9 ? '9+' : String(count));
  els.queueBadge.classList.toggle('show', count > 0 && !mobileQuery.matches);
  els.queueButton.dataset.manualCount = String(manualCount);
}

function updateMediaSession() {
  const song = currentSong();
  const genre = currentGenre();
  if (!song || !('mediaSession' in navigator)) return;

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist,
      album: genre?.label || 'GARBA',
      artwork: [
        { src: 'assets/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      ],
    });
  } catch { /* MediaMetadata may be unavailable inside some webviews */ }
}

function updateMediaPositionState() {
  if (!('mediaSession' in navigator) || !state.duration || !Number.isFinite(state.duration)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: Math.max(1, state.duration),
      playbackRate: els.audio.playbackRate || 1,
      position: Math.min(Math.max(0, state.elapsed), state.duration),
    });
  } catch { /* Not supported in every browser */ }
}

function renderPlayer() {
  const song = currentSong();
  const genre = currentGenre();
  if (!song || !genre) return;

  if (state.liveMode) {
    els.genreEyebrow.textContent = '🔴 LIVE 24/7 · Global Radio';
    els.app.dataset.liveMode = 'true';
    els.liveStationButton?.setAttribute('aria-pressed', 'true');
  } else {
    els.genreEyebrow.textContent = genre.label;
    els.app.removeAttribute('data-live-mode');
    els.liveStationButton?.setAttribute('aria-pressed', 'false');
  }
  els.shuffleButton?.setAttribute('aria-pressed', String(state.shuffleMode));
  els.songTitle.textContent = song.title;
  els.songTitle.dataset.songId = song.id;
  const titleLength = [...song.title].length;
  els.trackBlock.classList.toggle('is-long-title', titleLength > 28);
  els.trackBlock.classList.toggle('is-very-long-title', titleLength > 44);
  els.songArtist.textContent = song.artist;
  els.miniTitle.textContent = song.title;
  els.miniArtist.textContent = song.artist;
  els.durationTime.textContent = formatDuration(state.duration || song.durationSeconds);
  els.elapsedTime.textContent = formatTime(state.elapsed);

  const readiness = routeReadiness(song);
  els.app.dataset.playbackReady = String(readiness.executable);
  for (const button of [els.playButton, els.miniPlay]) {
    button.disabled = !readiness.executable;
    button.setAttribute('aria-disabled', String(!readiness.executable));
    if (!readiness.executable) button.title = 'This recording is not available to play yet';
    else if (!state.playing) button.title = 'Play';
  }

  const ratio = state.duration ? Math.min(1, Math.max(0, state.elapsed / state.duration)) : 0;
  els.progress.value = Math.round(ratio * 1000);
  els.progress.style.setProperty('--progress', `${ratio * 100}%`);
  els.miniProgress.style.width = `${ratio * 100}%`;

  updateFavouriteUI();
  updateQueueBadge();
  updateMediaPositionState();
  if (els.shareButton) {
    const shareLabel = song ? `Share ${song.title} by ${song.artist}` : 'Share current song';
    els.shareButton.setAttribute('aria-label', shareLabel);
    els.shareButton.title = shareLabel;
  }
}

async function animateTrackSwap(update) {
  const token = ++state.transitionToken;
  if (state.reducedMotion || !els.trackBlock.animate) {
    update();
    return;
  }

  const out = els.trackBlock.animate(
    [
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: 'translateY(-12px)' },
    ],
    { duration: 170, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' }
  );

  try { await out.finished; } catch { /* animation cancelled */ }
  if (token !== state.transitionToken) return;
  update();
  out.cancel();

  els.trackBlock.animate(
    [
      { opacity: 0, transform: 'translateY(12px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ],
    { duration: 230, easing: 'cubic-bezier(.2,.75,.2,1)' }
  );
}

function configureAudio(song, restoreElapsed = 0) {
  els.audio.pause();
  els.audio.removeAttribute('src');
  els.audio.load();
  setPlaying(false);

  state.elapsed = 0;
  state.duration = song.durationSeconds || 0;

  if (song.audioUrl) {
    els.audio.src = song.audioUrl;
    els.audio.load();
    if (restoreElapsed > 0) {
      const setTime = () => {
        els.audio.currentTime = Math.min(restoreElapsed, Number.isFinite(els.audio.duration) ? els.audio.duration : restoreElapsed);
        els.audio.removeEventListener('loadedmetadata', setTime);
      };
      els.audio.addEventListener('loadedmetadata', setTime);
    }
  } else if (restoreElapsed > 0) {
    state.elapsed = Math.min(restoreElapsed, state.duration || restoreElapsed);
  }
}

async function selectSong(songId, options = {}) {
  const song = state.songs.find((entry) => entry.id === songId);
  if (!song) return;

  if (!options.initial) state.pendingSongId = null;
  if (!options.preserveReleaseContext && !options.initial) clearReleaseContext();
  if (options.liveMode) state.liveMode = true;
  else if (!options.preserveContext && !options.initial) state.liveMode = false;

  const previousSongId = state.songId;
  if (previousSongId && previousSongId !== song.id && !options.initial && !options.fromHistory) {
    state.listeningHistory.push(previousSongId);
    state.listeningHistory = state.listeningHistory.slice(-60);
  }
  recordRecentPlayedSong(song.id);
  if (options.consumeQueued) removeQueuedSong(song.id, { announce: false });

  const genre = state.genres.find((entry) => entry.id === song.genre);
  if (!genre) return;

  const wasPlaying = state.playing || els.app?.classList.contains('is-playing') || (window.GARBA_YOUTUBE_PLAYER?.playing === true);
  const genreChanged = song.genre !== state.genreId;
  const restoreElapsed = options.restoreElapsed || 0;

  if (genreChanged) {
    state.genreId = song.genre;
    state.sheetFilter = song.genre;
    els.app.dataset.genre = song.genre;
    setAccent(genre.accent);
  }

  const apply = () => {
    state.songId = song.id;
    state.genreId = song.genre;
    state.sheetFilter = song.genre;
    if (!options.preserveContext) {
      state.playContextGenreId = song.genre;
      state.playContextSongId = song.id;
    }
    if ((options.releaseContextAdvance || options.syncReleaseAnchor) && songBelongsToActiveRelease(song)) {
      state.releaseContextSongId = song.id;
    }
    if (options.consumeQueued && songBelongsToActiveRelease(song)) {
      state.releaseContextConsumedIds.add(song.id);
    }
    configureAudio(song, restoreElapsed);
    renderPlayer();
    updateMediaSession();
    syncGenreStrips({ smooth: !options.initial });
    renderSheet();
    persistSession();
    if (!options.initial) {
      state.hasExplicitNavigation = true;
      updateUrl();
    }
  };

  if (options.animate === false || options.initial) apply();
  else await animateTrackSwap(apply);

  const shouldPlay = Boolean(options.forceAutoplay || state.liveMode || wasPlaying);

  if (wasPlaying && song.audioUrl && options.preservePlayback !== false) {
    if (typeof navigator.onLine === 'boolean' && !navigator.onLine) {
      setPlaying(false);
      showToast('You’re offline. Catalogue browsing is available, but music playback requires an internet connection.');
    } else {
      try { await els.audio.play(); } catch { /* browser can block autoplay after async transitions */ }
    }
  } else if (shouldPlay && options.preservePlayback !== false && canExecuteSong(song)) {
    if (window.GARBA_YOUTUBE_PLAYER?.open) {
      const startSec = Number(options.restoreElapsed || 0);
      window.GARBA_YOUTUBE_PLAYER.open(song, {
        autoplay: true,
        resume: startSec > 0,
        startSeconds: startSec,
      }).catch(() => {});
    }
  }

  if (!options.keepSheet && mobileQuery.matches && state.sheetSnap !== 'closed') setSheetSnap('collapsed');
}

function selectGenre(genreId) {
  state.hasExplicitNavigation = true;
  const genre = state.genres.find((entry) => entry.id === genreId);
  if (!genre) return;
  if (genreId === state.genreId) {
    clearReleaseContext();
    const song = currentSong();
    if (song) {
      state.playContextGenreId = song.genre;
      state.playContextSongId = song.id;
    }
    state.sheetFilter = genreId;
    syncGenreStrips();
    updateQueueBadge();
    updateUrl();
    return;
  }

  const next = songsForGenre(genreId)[0];
  if (next) selectSong(next.id, { keepSheet: true });
  else {
    state.genreId = genreId;
    state.sheetFilter = genreId;
    els.app.dataset.genre = genreId;
    setAccent(genre.accent);
    syncGenreStrips();
    renderSheet();
    updateUrl();
  }
}

function playerSearchRecord(song) {
  return {
    id: song.id,
    title: [song.title, song.displayTitle].filter(Boolean),
    titleAliases: song.aliases,
    artist: song.artist,
    artistAliases: song.artistAliases,
    taxonomyTerms: [
      song.genre,
      song.category,
      ...(song.styles || []),
      ...(song.taxonomyStyles || []),
    ],
    song,
  };
}

function rankPlayerSongs(songs, query) {
  return rankSearchRecords(songs.map(playerSearchRecord), query)
    .map(({ record }) => record.song);
}

function getSheetSongs() {
  const rawQuery = els.searchInput.value.trim();
  const query = normalizeSearchText(rawQuery);
  let songs;

  if (state.sheetMode === 'favourites') {
    songs = state.songs.filter((song) => state.favourites.has(song.id));
  } else if (state.sheetMode === 'queue') {
    songs = getUpNextSongs();
  } else if (state.sheetMode === 'search') {
    if (!query) {
      state.sheetMatchCount = state.songs.length;
      return [];
    }
    songs = state.songs;
  } else {
    songs = state.songs.filter((song) => song.genre === state.sheetFilter);
  }

  if (query) songs = rankPlayerSongs(songs, rawQuery);
  state.sheetMatchCount = songs.length;
  if (state.sheetMode === 'search' && songs.length > SEARCH_RESULT_LIMIT) return songs.slice(0, SEARCH_RESULT_LIMIT);
  return songs;
}

function updateSheetSummary(songs, query) {
  if (!els.sheetSummary) return;

  if (state.sheetMode === 'search') {
    if (!query) els.sheetSummary.textContent = `${state.songs.length.toLocaleString()} songs`;
    else if (state.sheetMatchCount > songs.length) els.sheetSummary.textContent = `Showing ${songs.length} of ${state.sheetMatchCount.toLocaleString()}`;
    else els.sheetSummary.textContent = `${state.sheetMatchCount.toLocaleString()} ${state.sheetMatchCount === 1 ? 'match' : 'matches'}`;
  } else if (state.sheetMode === 'queue') {
    const queued = manualQueueSongs().length;
    const continuing = Math.max(0, songs.length - queued);
    els.sheetSummary.textContent = queued ? `${queued} queued · ${continuing} continue` : `${continuing} continue`;
  } else {
    els.sheetSummary.textContent = `${state.sheetMatchCount.toLocaleString()} ${state.sheetMatchCount === 1 ? 'song' : 'songs'}`;
  }
}

function renderEmptySheetState(query) {
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  const strong = document.createElement('strong');
  const copy = document.createElement('span');
  if (state.sheetMode === 'favourites') {
    strong.textContent = 'My Garba is empty';
    copy.textContent = 'Tap the heart beside a song to save it here.';
  } else if (state.sheetMode === 'queue') {
    strong.textContent = 'Nothing up next';
    copy.textContent = 'Choose a genre or another song to continue listening.';
  } else if (state.sheetMode === 'search' && !query) {
    strong.textContent = `Search ${state.songs.length.toLocaleString()} songs`;
    copy.textContent = 'Type a song, artist, genre or style to see matching results.';
  } else {
    strong.textContent = 'No songs found';
    copy.textContent = query ? 'Try a different search.' : 'This genre is waiting for catalogue data.';
  }
  empty.append(strong, copy);
  return empty;
}

function createSongRow(song, index, queued) {
  const row = document.createElement('div');
  row.className = `song-row${song.id === state.songId ? ' current' : ''}`;
  row.role = 'listitem';

  const idx = document.createElement('span');
  idx.className = 'song-index';
  idx.textContent = String(index + 1).padStart(2, '0');

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'song-copy';
  copy.setAttribute('aria-label', `Play ${song.title} by ${song.artist}`);
  const title = document.createElement('strong');
  title.textContent = song.title;
  const artist = document.createElement('small');
  artist.textContent = song.artist;
  copy.append(title, artist);
  const releaseContinuation = state.sheetMode === 'queue'
    && !queued
    && releaseContinuationSongs().some((entry) => entry.id === song.id);
  copy.addEventListener('click', () => selectSong(song.id, {
    keepSheet: true,
    preserveContext: queued || releaseContinuation,
    preserveReleaseContext: queued || releaseContinuation,
    releaseContextAdvance: releaseContinuation,
    consumeQueued: queued,
    preservePlayback: true,
    forceAutoplay: true,
  }));

  const duration = document.createElement('span');
  duration.className = 'song-duration';
  duration.textContent = formatDuration(song.durationSeconds);

  const queuePlayable = Boolean(song.youtubeId);
  const queueAction = document.createElement('button');
  queueAction.type = 'button';
  queueAction.className = 'song-queue-action';
  queueAction.hidden = !queuePlayable || song.id === state.songId;
  queueAction.disabled = !queuePlayable || song.id === state.songId;
  queueAction.setAttribute('aria-label', queued ? `Remove ${song.title} from Up next` : `Play ${song.title} next`);
  queueAction.title = queued ? 'Remove from Up next' : 'Play next';
  queueAction.innerHTML = queued
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"></path></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h8M5 12h8M5 17h5"></path><path d="M17 8v9M13.5 13.5 17 17l3.5-3.5"></path></svg>';
  queueAction.addEventListener('click', () => queued ? removeQueuedSong(song.id) : queueSong(song.id));

  const favourite = document.createElement('button');
  favourite.type = 'button';
  favourite.className = `heart-button song-favourite${state.favourites.has(song.id) ? ' active' : ''}`;
  favourite.setAttribute('aria-label', state.favourites.has(song.id) ? `Remove ${song.title} from My Garba` : `Save ${song.title} to My Garba`);
  favourite.setAttribute('aria-pressed', String(state.favourites.has(song.id)));
  favourite.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.9a5.5 5.5 0 0 0-7.8 0L12 5.9l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.3 1-1a5.5 5.5 0 0 0 0-7.8Z"></path></svg>';
  favourite.addEventListener('click', () => toggleFavourite(song.id));

  row.classList.toggle('manually-queued', queued);
  row.append(idx, copy, duration, queueAction, favourite);
  return row;
}

function renderSheet() {
  els.songSheet.classList.toggle('mode-favourites', state.sheetMode === 'favourites');
  els.songSheet.classList.toggle('mode-queue', state.sheetMode === 'queue');
  els.songSheet.classList.toggle('mode-search', state.sheetMode === 'search');
  els.sheetTitle.textContent = state.sheetMode === 'favourites' ? 'My Garba' : state.sheetMode === 'queue' ? 'Up next' : state.sheetMode === 'search' ? 'Search' : 'Songs';

  syncSheetGenresOnly();

  if (state.sheetSnap === 'closed') {
    els.songList.replaceChildren();
    if (els.sheetSummary) els.sheetSummary.textContent = '';
    return;
  }

  const query = els.searchInput.value.trim();
  const songs = getSheetSongs();
  els.songList.innerHTML = '';

  updateSheetSummary(songs, query);

  if (!songs.length) {
    els.songList.append(renderEmptySheetState(query));
    return;
  }

  const fragment = document.createDocumentFragment();
  const queuedIds = new Set(state.manualQueue);
  let continuationLabelAdded = false;
  if (state.sheetMode === 'queue' && state.manualQueue.length) {
    const toolbar = document.createElement('div');
    toolbar.className = 'queue-toolbar';
    const label = document.createElement('span');
    label.textContent = 'Queued';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'queue-clear';
    clear.textContent = 'Clear';
    clear.addEventListener('click', clearManualQueue);
    toolbar.append(label, clear);
    fragment.append(toolbar);
  }
  songs.forEach((song, index) => {
    const queued = state.sheetMode === 'queue' && queuedIds.has(song.id);
    if (state.sheetMode === 'queue' && state.manualQueue.length && !queued && !continuationLabelAdded) {
      continuationLabelAdded = true;
      const label = document.createElement('div');
      label.className = 'queue-section-label';
      label.textContent = 'Continue playing';
      fragment.append(label);
    }

    const row = createSongRow(song, index, queued);
    fragment.append(row);
  });

  if (state.sheetMode === 'search' && state.sheetMatchCount > songs.length) {
    const hint = document.createElement('div');
    hint.className = 'search-result-hint';
    hint.setAttribute('role', 'status');
    hint.textContent = `Showing the first ${songs.length} of ${state.sheetMatchCount.toLocaleString()} matches. Keep typing to narrow the list.`;
    fragment.append(hint);
  }

  els.songList.append(fragment);
}

function toggleFavourite(songId = state.songId) {
  if (!songId) return;
  const willAdd = !state.favourites.has(songId);
  if (willAdd) state.favourites.add(songId);
  else state.favourites.delete(songId);
  persistFavourites();
  updateFavouriteUI();
  renderSheet();
  showToast(willAdd ? 'Saved to My Garba.' : 'Removed from My Garba.');
}

function cancelPendingSearchFocus() {
  if (state.searchFocusTimer == null) return;
  clearTimeout(state.searchFocusTimer);
  state.searchFocusTimer = null;
}

function placeFavourite() {
  // #mobileFavourite lives permanently inside .controls (after #nextButton).
  // Nothing moves it — it is always visible there on both mobile and desktop.
}


function syncSheetChrome() {
  const snap = state.sheetSnap || 'closed';
  const modal = mobileQuery.matches && (snap === 'medium' || snap === 'full');
  if (els.sheetBackdrop) {
    els.sheetBackdrop.hidden = !modal;
    els.sheetBackdrop.setAttribute('aria-hidden', String(!modal));
  }
  els.songSheet?.setAttribute('aria-modal', String(modal));
  if (els.sheetClose) {
    els.sheetClose.title = 'Close song browser';
    els.sheetClose.setAttribute('aria-label', 'Close song browser');
  }
}

function closeProviderOutside(event) {
  const stage = document.querySelector('#providerStage.open[aria-hidden="false"]');
  if (!stage || !(event.target instanceof Element)) return;
  if (stage.contains(event.target) || els.playButton?.contains(event.target) || $('miniPlay')?.contains(event.target)) return;
  stage.querySelector('#providerDockStop')?.click();
}

function setSheetSnap(snap) {
  const allowed = ['closed', 'collapsed', 'medium', 'full'];
  state.sheetSnap = allowed.includes(snap) ? snap : 'closed';
  els.songSheet.dataset.snap = state.sheetSnap;
  els.app.dataset.sheetSnap = state.sheetSnap;
  const open = state.sheetSnap !== 'closed';
  els.songSheet.setAttribute('aria-hidden', String(!open));
  if (els.browseButton?.hasAttribute('aria-controls')) els.browseButton.setAttribute('aria-expanded', String(open));
  if (!open) {
    cancelPendingSearchFocus();
    els.songSheet.classList.remove('searching');
    els.searchInput.blur();
  }
  syncSheetChrome();
}

function preferredOpenSnap(mode) {
  if (!mobileQuery.matches) return 'full';
  if (mode === 'search') return 'full';
  return 'medium';
}

function openSheet(mode = 'all', options = {}) {
  cancelPendingSearchFocus();
  const wasClosed = state.sheetSnap === 'closed';
  if (wasClosed && options.trigger instanceof HTMLElement) state.sheetTrigger = options.trigger;
  state.sheetMode = mode;
  if (state.sheetMode === 'all') state.sheetFilter = state.genreId;
  if (state.sheetMode !== 'search') els.searchInput.value = '';
  const snap = options.snap || preferredOpenSnap(mode);
  setSheetSnap(snap);
  renderSheet();

  if (wasClosed && options.history !== false) {
    history.pushState({ ...(history.state || {}), garbaSheet: true }, '', location.href);
  }

  if (mode === 'search') {
    els.songSheet.classList.add('searching');
    state.searchFocusTimer = setTimeout(() => {
      state.searchFocusTimer = null;
      if (state.sheetMode !== 'search' || state.sheetSnap === 'closed') return;
      if (els.songSheet.getAttribute('aria-hidden') !== 'false') return;
      if (!els.songSheet.classList.contains('searching')) return;
      els.searchInput.focus({ preventScroll: true });
    }, state.reducedMotion ? 0 : (mobileQuery.matches ? 150 : 450));
  }
}

function closeSheet({ fromHistory = false } = {}) {
  cancelPendingSearchFocus();
  if (!fromHistory && history.state?.garbaSheet) {
    history.back();
    return;
  }
  setSheetSnap('closed');
  const trigger = state.sheetTrigger;
  state.sheetTrigger = null;
  if (trigger?.isConnected) {
    if (state.reducedMotion) trigger.focus({ preventScroll: true });
    else setTimeout(() => trigger.focus({ preventScroll: true }), 0);
  }
}

async function togglePlay() {
  const song = currentSong();
  if (!song) return;

  if (window.GARBA_YOUTUBE_PLAYER?.canPlay?.(song)) {
    if (!state.playing) {
      setPlaying(true);
    }
    window.GARBA_YOUTUBE_PLAYER.toggle(song);
    return;
  }

  if (state.playing) {
    els.audio.pause();
    return;
  }

  if (typeof navigator.onLine === 'boolean' && !navigator.onLine) {
    showToast('Playback needs an internet connection. Reconnect to play.');
    return;
  }

  if (song.audioUrl) {
    try { await els.audio.play(); }
    catch { showToast('Playback could not start. Check the approved audio source.'); }
    return;
  }

  showToast('Add an approved audio source for this track before publishing.');
}

function toggleShuffle() {
  state.shuffleMode = !state.shuffleMode;
  storage.set('garba:shuffle', state.shuffleMode);
  els.shuffleButton?.setAttribute('aria-pressed', String(state.shuffleMode));
  state.morphs?.get('shuffle')?.morphTo(state.shuffleMode ? 'shuffleActive' : 'shuffleInactive');
  showToast(state.shuffleMode ? 'Shuffle turned on.' : 'Shuffle turned off.');
}

async function toggleLiveStation() {
  if (state.liveMode) {
    state.liveMode = false;
    els.app.removeAttribute('data-live-mode');
    els.liveStationButton?.setAttribute('aria-pressed', 'false');
    renderPlayer();
    showToast('Exited 24/7 Live Radio.');
    return;
  }

  const liveState = getLiveBroadcastState(state.songs, Date.now());
  if (!liveState || !liveState.song) {
    showToast('24/7 Live Radio is tuning in...');
    return;
  }

  state.liveMode = true;
  els.app.dataset.liveMode = 'true';
  els.liveStationButton?.setAttribute('aria-pressed', 'true');
  state.morphs?.get('live')?.pulse();
  showToast(`Tuned into 24/7 Live Garba Radio · ${liveState.song.title}`);

  await selectSong(liveState.song.id, {
    restoreElapsed: liveState.seekSeconds,
    preservePlayback: true,
    liveMode: true,
    animate: false,
  });

  if (window.GARBA_YOUTUBE_PLAYER?.open) {
    try {
      await window.GARBA_YOUTUBE_PLAYER.open(liveState.song, {
        autoplay: true,
        resume: liveState.seekSeconds > 0,
        startSeconds: liveState.seekSeconds,
      });
    } catch { /* autoplay handling */ }
  }

}

function changeSong(direction) {
  if (direction < 0 && state.listeningHistory.length) {
    const previousId = state.listeningHistory.pop();
    if (previousId) {
      selectSong(previousId, {
        keepSheet: true,
        preservePlayback: true,
        preserveContext: true, fromHistory: true,
        preserveReleaseContext: true,
        syncReleaseAnchor: true,
      });
      return;
    }
  }

  if (state.liveMode) {
    const nextLive = getNextLiveTrack(state.songs, state.songId);
    if (nextLive) {
      selectSong(nextLive.id, { keepSheet: true, preservePlayback: true, liveMode: true });
      return;
    }
  }

  if (direction > 0) {
    sanitiseManualQueue();
    const queuedId = state.manualQueue.shift();
    if (queuedId) {
      persistManualQueue();
      selectSong(queuedId, {
        keepSheet: true,
        preservePlayback: true,
        preserveContext: true,
        preserveReleaseContext: true,
        consumeQueued: true,
      });
      return;
    }
  }

  if (direction > 0 && state.releaseContextId) {
    const nextReleaseSong = releaseContinuationSongs(1)[0];
    if (nextReleaseSong) {
      selectSong(nextReleaseSong.id, {
        keepSheet: true,
        preservePlayback: true,
        preserveContext: true,
        preserveReleaseContext: true,
        releaseContextAdvance: true,
      });
      return;
    }

    const releaseSongs = orderedReleaseSongs(state.releaseContextId);
    const releaseIds = new Set(releaseSongs.map((song) => song.id));
    const anchorId = state.releaseContextSongId || state.songId;
    const anchorSong = state.songs.find((song) => song.id === anchorId) || null;
    const nextGeneric = automaticGenreContinuation(1, {
      genreId: anchorSong?.genre || state.playContextGenreId || state.genreId,
      anchorId,
      excludeIds: releaseIds,
    })[0];
    clearReleaseContext();
    if (nextGeneric) {
      selectSong(nextGeneric.id, { keepSheet: true, preservePlayback: true });
      return;
    }
    updateQueueBadge();
    renderSheet();
    updateUrl();
    return;
  }

  const genreId = state.playContextGenreId || state.genreId;
  const list = songsForGenre(genreId).filter(canExecuteSong);
  if (!list.length) return;

  if (state.shuffleMode && direction > 0) {
    const recentHistory = [...getRecentPlayedSongs(), ...state.listeningHistory];
    const minBuffer = Math.min(5, Math.max(1, list.length - 1));
    let candidates = [];
    for (const count of [80, 50, 35, 20, 10, 5, 2, 1, 0]) {
      const excludeSet = new Set(recentHistory.slice(-count));
      excludeSet.add(state.songId);
      const filtered = list.filter((song) => !excludeSet.has(song.id));
      if (filtered.length >= minBuffer || (count === 0 && filtered.length > 0)) {
        candidates = filtered;
        break;
      }
    }
    const pool = candidates.length ? candidates : list.filter((song) => song.id !== state.songId);
    if (pool.length) {
      const randomSong = pool[Math.floor(Math.random() * pool.length)];
      selectSong(randomSong.id, { keepSheet: true, preservePlayback: true });
      return;
    }
  }

  const anchorId = state.playContextSongId || state.songId;
  let index = list.findIndex((song) => song.id === anchorId);
  index = index < 0 ? 0 : (index + direction + list.length) % list.length;
  selectSong(list[index].id, { keepSheet: true, preservePlayback: true });
}

function cycleSheetSnap(direction = 1) {
  if (!mobileQuery.matches) return;
  const order = ['collapsed', 'medium', 'full'];
  if (state.sheetSnap === 'closed') {
    setSheetSnap('medium');
    renderSheet();
    return;
  }
  const index = order.indexOf(state.sheetSnap);
  const next = Math.max(0, Math.min(order.length - 1, index + direction));
  setSheetSnap(order[next]);
}

function setupSheetGestures() {
  let startY = null;
  let pointerId = null;
  let suppressClick = false;

  const start = (event) => {
    if (!mobileQuery.matches) return;
    pointerId = event.pointerId;
    startY = event.clientY;
    els.sheetHandle.setPointerCapture?.(pointerId);
  };

  const end = (event) => {
    if (startY == null || event.pointerId !== pointerId) return;
    const delta = event.clientY - startY;
    if (Math.abs(delta) > 48) {
      suppressClick = true;
      if (delta > 0) {
        if (state.sheetSnap === 'full') setSheetSnap('medium');
        else if (state.sheetSnap === 'medium') setSheetSnap('collapsed');
        else closeSheet();
      } else {
        if (state.sheetSnap === 'collapsed') setSheetSnap('medium');
        else setSheetSnap('full');
      }
    }
    startY = null;
    pointerId = null;
  };

  els.sheetHandle.addEventListener('pointerdown', start);
  els.sheetHandle.addEventListener('pointerup', end);
  els.sheetHandle.addEventListener('pointercancel', () => { startY = null; pointerId = null; suppressClick = false; });
  els.sheetHandle.addEventListener('click', () => {
    if (!mobileQuery.matches) return;
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (state.sheetSnap === 'collapsed') setSheetSnap('medium');
    else if (state.sheetSnap === 'medium') setSheetSnap('full');
    else if (state.sheetSnap === 'full') setSheetSnap('medium');
  });
}

function setupMediaSessionActions() {
  if (!('mediaSession' in navigator)) return;
  const pauseActive = () => {
    if (window.GARBA_YOUTUBE_PLAYER?.canPlay?.(currentSong())) {
      window.GARBA_YOUTUBE_PLAYER.toggle(currentSong());
    } else {
      els.audio.pause();
    }
  };
  const seekToPosition = (targetSec) => {
    const song = currentSong();
    if (window.GARBA_YOUTUBE_PLAYER?.canPlay?.(song)) {
      window.GARBA_YOUTUBE_PLAYER.seekTo?.(targetSec);
    } else if (els.audio.src) {
      els.audio.currentTime = targetSec;
    } else {
      state.elapsed = targetSec;
      renderPlayer();
    }
  };

  const actions = {
    play: () => togglePlay(),
    pause: () => pauseActive(),
    stop: () => pauseActive(),
    previoustrack: () => changeSong(-1),
    nexttrack: () => changeSong(1),
    seekbackward: (details) => {
      if (!state.duration) return;
      const next = Math.max(0, state.elapsed - (details.seekOffset || 10));
      seekToPosition(next);
    },
    seekforward: (details) => {
      if (!state.duration) return;
      const next = Math.min(state.duration, state.elapsed + (details.seekOffset || 10));
      seekToPosition(next);
    },
    seekto: (details) => {
      if (typeof details.seekTime === 'number') seekToPosition(details.seekTime);
    },
  };

  Object.entries(actions).forEach(([action, handler]) => {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* action not supported */ }
  });
}

function isStandalone() {
  return standaloneQuery.matches || window.navigator.standalone === true;
}

function installDismissedRecently() {
  const dismissedAt = storage.get('garba:install-dismissed', 0);
  return Date.now() - Number(dismissedAt || 0) < 7 * 24 * 60 * 60 * 1000;
}

function installSurfaceIsBusy() {
  if (state.sheetSnap !== 'closed') return true;
  return Boolean(document.querySelector([
    '#providerStage.open[aria-hidden="false"]',
    '#youtubeStage.open[aria-hidden="false"]',
    'dialog[open]',
    '[role="dialog"][aria-modal="true"]:not([aria-hidden="true"]):not([hidden])',
  ].join(', ')));
}

function showInstallBanner({ ios = false } = {}) {
  if (isStandalone() || installDismissedRecently() || installSurfaceIsBusy()) {
    els.installBanner.hidden = true;
    return false;
  }
  if (ios) {
    els.installTitle.textContent = 'Add GARBA to Home Screen';
    els.installText.textContent = 'In Safari, use Share → Add to Home Screen.';
    els.installButton.textContent = 'Got it';
    els.installButton.dataset.mode = 'ios';
  } else {
    els.installTitle.textContent = 'Install GARBA';
    els.installText.textContent = 'Keep the full-screen player one tap away.';
    els.installButton.textContent = 'Install';
    els.installButton.dataset.mode = 'prompt';
  }
  els.installBanner.hidden = false;
  return true;
}

function setupPwaInstall() {
  const LISTENING_VALUE_MS = 15000;
  const LISTENING_VALUE_KEY = 'garba:install-listening-value';
  const ua = navigator.userAgent;
  const isIpadDesktopUa = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const isIos = (/iPad|iPhone|iPod/.test(ua) || isIpadDesktopUa) && !window.MSStream;
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  const canOfferIosGuidance = isIos && isSafari && !isStandalone();
  let hasListeningValue = storage.get(LISTENING_VALUE_KEY, false) === true;
  let listeningValueTimer = null;

  const currentInstallMode = () => {
    if (canOfferIosGuidance) return 'ios';
    return state.installPrompt ? 'prompt' : null;
  };

  const maybeShowInstallBanner = () => {
    if (!hasListeningValue) {
      els.installBanner.hidden = true;
      return;
    }
    const mode = currentInstallMode();
    if (!mode) {
      els.installBanner.hidden = true;
      return;
    }
    showInstallBanner({ ios: mode === 'ios' });
  };

  const markListeningValue = () => {
    if (hasListeningValue) return;
    hasListeningValue = true;
    storage.set(LISTENING_VALUE_KEY, true);
    maybeShowInstallBanner();
  };

  const reconcileListeningValue = () => {
    if (hasListeningValue) {
      maybeShowInstallBanner();
      return;
    }
    const confirmedPlaying = els.app?.classList.contains('is-playing') === true;
    if (!confirmedPlaying) {
      clearTimeout(listeningValueTimer);
      listeningValueTimer = null;
      return;
    }
    if (listeningValueTimer != null) return;
    listeningValueTimer = setTimeout(() => {
      listeningValueTimer = null;
      if (els.app?.classList.contains('is-playing')) markListeningValue();
    }, LISTENING_VALUE_MS);
  };

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.installPrompt = event;
    maybeShowInstallBanner();
  });

  window.addEventListener('appinstalled', () => {
    state.installPrompt = null;
    els.installBanner.hidden = true;
    showToast('GARBA installed.');
  });

  els.installDismiss.addEventListener('click', () => {
    storage.set('garba:install-dismissed', Date.now());
    els.installBanner.hidden = true;
  });

  els.installButton.addEventListener('click', async () => {
    if (els.installButton.dataset.mode === 'ios') {
      storage.set('garba:install-dismissed', Date.now());
      els.installBanner.hidden = true;
      showToast('Use Safari Share, then Add to Home Screen.');
      return;
    }
    if (!state.installPrompt) return;
    await state.installPrompt.prompt();
    await state.installPrompt.userChoice.catch(() => null);
    state.installPrompt = null;
    els.installBanner.hidden = true;
  });

  if (els.app && 'MutationObserver' in window) {
    const playingObserver = new MutationObserver(reconcileListeningValue);
    playingObserver.observe(els.app, { attributes: true, attributeFilter: ['class'] });
  }

  if ('MutationObserver' in window) {
    const blockerObserver = new MutationObserver(maybeShowInstallBanner);
    const blockers = [
      els.songSheet,
      document.getElementById('providerStage'),
      document.getElementById('youtubeStage'),
      ...document.querySelectorAll('dialog, [role="dialog"]'),
    ].filter((node, index, nodes) => node && nodes.indexOf(node) === index);
    blockers.forEach((node) => blockerObserver.observe(node, {
      attributes: true,
      attributeFilter: ['class', 'aria-hidden', 'hidden', 'open'],
    }));
  }

  document.addEventListener('click', () => setTimeout(maybeShowInstallBanner, 0));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setTimeout(maybeShowInstallBanner, 0);
  });

  reconcileListeningValue();
  maybeShowInstallBanner();
}

let updateApplied = false;

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;

  const isActivelyPlaying = () => state.playing || els.app?.classList.contains('is-playing') === true;

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js');

      const handleWaitingWorker = (worker) => {
        if (!worker || updateApplied) return;

        if (isActivelyPlaying()) {
          showToast('Update available. It will apply when playback is paused.');

          const onPlaybackIdle = () => {
            if (updateApplied) return;
            if (!isActivelyPlaying()) {
              updateApplied = true;
              persistSession();
              worker.postMessage({ type: 'SKIP_WAITING' });
            }
          };

          els.audio?.addEventListener('pause', onPlaybackIdle, { once: true });
          els.audio?.addEventListener('ended', onPlaybackIdle, { once: true });

          if (els.app && 'MutationObserver' in window) {
            const idleObserver = new MutationObserver(() => {
              if (!isActivelyPlaying()) {
                idleObserver.disconnect();
                onPlaybackIdle();
              }
            });
            idleObserver.observe(els.app, { attributes: true, attributeFilter: ['class'] });
          }
        } else {
          updateApplied = true;
          persistSession();
          worker.postMessage({ type: 'SKIP_WAITING' });
        }
      };

      if (registration.waiting && navigator.serviceWorker.controller) {
        handleWaitingWorker(registration.waiting);
      }

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;

        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            handleWaitingWorker(installing);
          }
        });
      });
    } catch (error) {
      console.warn('Service worker registration failed', error);
    }
  });

  const hadControllerOnLoad = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadControllerOnLoad || !updateApplied || refreshing) return;
    if (isActivelyPlaying()) return;
    const lastReload = Number(sessionStorage.getItem('garba:sw-reload-at') || 0);
    if (Date.now() - lastReload < 10000) return;
    sessionStorage.setItem('garba:sw-reload-at', String(Date.now()));
    refreshing = true;
    persistSession();
    window.location.reload();
  });
}


async function handleShareCurrentSong() {
  if (window.GARBA_NONSTOP?.activeSet) {
    if (typeof window.GARBA_NONSTOP.share === 'function') {
      return window.GARBA_NONSTOP.share();
    }
  }
  const song = currentSong();
  if (!song) return null;

  const elapsed = Math.round(state.elapsed || 0);
  const duration = Math.round(state.duration || song.durationSeconds || 0);
  const includeTimestamp = elapsed > 5 && (duration > 0 ? elapsed < duration - 5 : true);
  const timestampSeconds = includeTimestamp ? elapsed : 0;

  const url = buildSongShareUrl?.({
    songId: song.id,
    timestampSeconds,
  }) || `${location.origin}/?song=${encodeURIComponent(song.id)}${timestampSeconds > 0 ? `&t=${timestampSeconds}` : ''}`;

  const title = song.title || 'PlayGarba';
  const text = formatShareText?.({ title: song.title, artist: song.artist, context: 'song' })
    || `Listen to "${title}" on PlayGarba`;

  if (executeShare) {
    const result = await executeShare({ title, text, url });
    if (result?.status === 'copied') showToast('Link copied to clipboard');
    else if (result?.status === 'failed') showToast('Unable to copy link');
    return result;
  }
  return null;
}

function wireEvents() {
  let searchTimer = null;
  els.playButton.addEventListener('click', togglePlay);
  els.miniPlay.addEventListener('click', togglePlay);
  els.prevButton.addEventListener('click', () => changeSong(-1));
  els.nextButton.addEventListener('click', () => changeSong(1));
  els.miniPrev.addEventListener('click', () => changeSong(-1));
  els.miniNext.addEventListener('click', () => changeSong(1));

  els.browseButton?.addEventListener('click', (event) => {
    event?.preventDefault?.();
    if (state.sheetSnap === 'closed' || state.sheetSnap === 'collapsed') openSheet('all', { trigger: els.browseButton });
    else closeSheet();
  });
  els.sheetClose.addEventListener('click', closeSheet);
  els.sheetBackdrop?.addEventListener('click', () => closeSheet());
  els.mobileFavourite.addEventListener('click', () => toggleFavourite());
  els.favouritesButton.addEventListener('click', () => openSheet('favourites', { trigger: els.favouritesButton }));
  els.queueButton.addEventListener('click', () => openSheet('queue', { trigger: els.queueButton }));
  els.searchButton.addEventListener('click', () => openSheet('search', { trigger: els.searchButton }));
  els.shareButton?.addEventListener('click', handleShareCurrentSong);

  els.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderSheet, 70);
  });
  els.searchInput.addEventListener('focus', () => {
    els.songSheet.classList.add('searching');
    if (mobileQuery.matches && state.sheetSnap !== 'full') setSheetSnap('full');
  });

  els.progress.addEventListener('input', () => {
    if (!state.duration) return;
    const next = Number(els.progress.value) / 1000 * state.duration;
    if (els.audio.src) els.audio.currentTime = next;
    else state.elapsed = next;
    renderPlayer();
  });

  els.audio.addEventListener('play', () => { setPlaying(true); renderPlayer(); });
  els.audio.addEventListener('pause', () => { setPlaying(false); renderPlayer(); persistSession(); });
  els.audio.addEventListener('loadedmetadata', () => {
    state.duration = els.audio.duration || currentSong()?.durationSeconds || 0;
    renderPlayer();
  });
  els.audio.addEventListener('timeupdate', () => {
    state.elapsed = els.audio.currentTime;
    state.duration = els.audio.duration || state.duration;
    renderPlayer();
    const rounded = Math.round(state.elapsed);
    if (rounded % 5 === 0 && rounded !== state.lastPersistedElapsed) {
      state.lastPersistedElapsed = rounded;
      persistSession();
    }
  });
  els.audio.addEventListener('ended', () => changeSong(1));

  els.shuffleButton?.addEventListener('click', toggleShuffle);
  els.liveStationButton?.addEventListener('click', toggleLiveStation);

  document.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === '/') {
      event.preventDefault();
      openSheet('search', { trigger: els.searchButton });
      return;
    }
    if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
    if (event.code === 'ArrowRight') changeSong(1);
    if (event.code === 'ArrowLeft') changeSong(-1);
    if (event.key === 's' || event.key === 'S') { event.preventDefault(); toggleShuffle(); }
    if (event.key === 'l' || event.key === 'L') { event.preventDefault(); toggleLiveStation(); }
    if (event.code === 'Escape' || event.key === 'Escape') {
      const stage = document.querySelector('#providerStage.open[aria-hidden="false"]');
      if (stage) {
        event.preventDefault();
        stage.querySelector('#providerDockStop')?.click();
        return;
      }
      if (els.songSheet.classList.contains('searching')) {
        cancelPendingSearchFocus();
        els.songSheet.classList.remove('searching');
        els.searchInput.blur();
      } else closeSheet();
      return;
    }
    if (event.key.toLowerCase() === 'f') toggleFavourite();
  });

  document.addEventListener('click', closeProviderOutside);

  window.addEventListener('offline', () => showToast('You’re offline. Catalogue browsing is available, but music playback requires an internet connection.'));
  window.addEventListener('online', () => {
    showToast('Back online.');
    refreshCatalogue({ quiet: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - state.catalogueLoadedAt > 5 * 60 * 1000) refreshCatalogue({ quiet: true });
  });
  window.addEventListener('popstate', () => {
    if (state.sheetSnap !== 'closed') {
      closeSheet({ fromHistory: true });
    }
  });
  window.addEventListener('pagehide', persistSession);

  mobileQuery.addEventListener?.('change', () => {
    if (!mobileQuery.matches && state.sheetSnap !== 'closed') setSheetSnap('full');
    placeFavourite();
    syncSheetChrome();
    syncGenreStrips({ smooth: false });
  });

  window.addEventListener('pageshow', () => {
    placeFavourite();
    syncSheetChrome();
  });

  window.addEventListener('garba:catalogue-ready', () => {
    refreshCatalogue({ quiet: true });
  });

  setupSheetGestures();
}

async function fetchCatalogue() {
  if (window.GARBA_FAST_BOOT?.hydrate && !window.GARBA_FAST_BOOT.hydrated) {
    try { await window.GARBA_FAST_BOOT.hydrate(); } catch {}
  }
  const [genresResponse, songsResponse] = await Promise.all([
    fetch('data/genres.json', { cache: 'no-store' }),
    fetch('data/songs.json', { cache: 'no-store' }),
  ]);
  if (!genresResponse.ok || !songsResponse.ok) throw new Error('Failed to load catalogue');
  const [genres, allSongs] = await Promise.all([genresResponse.json(), songsResponse.json()]);
  const songs = [];
  const presentationRedirects = new Map();
  for (const song of allSongs) {
    const role = String(song?.presentationRole || 'catalogue');
    if (role === 'catalogue') songs.push(song);
    else if (song?.id) presentationRedirects.set(song.id, song);
  }
  return { genres, songs, presentationRedirects };
}

function makeCatalogueSignature(genres, songs) {
  return JSON.stringify({
    genres: genres.map((genre) => [genre.id, genre.label, genre.background, genre.accent]),
    songs: songs.map((song) => [song.id, song.title, song.artist, song.genre, song.releaseId, song.trackNumber, song.durationSeconds, song.audioUrl, song.youtubeId]),
  });
}

async function refreshCatalogue({ quiet = false } = {}) {
  try {
    const next = await fetchCatalogue();
    const signature = makeCatalogueSignature(next.genres, next.songs);
    const changed = state.catalogueSignature && signature !== state.catalogueSignature;
    state.genres = next.genres;
    state.songs = next.songs;
    state.presentationRedirects = next.presentationRedirects;
    if (state.releaseContextId && !releaseContextMatch(state.releaseContextId, state.releaseContextSongId || state.songId)) {
      clearReleaseContext();
    }
    reconcilePresentationFavourites();
    sanitiseManualQueue();
    state.catalogueSignature = signature;
    state.catalogueLoadedAt = Date.now();

    if (state.pendingSongId) {
      const pendingSong = state.songs.find((entry) => entry.id === state.pendingSongId);
      state.pendingSongId = null;
      if (pendingSong) {
        await selectSong(pendingSong.id, { initial: true, animate: false, keepSheet: true });
        updateUrl();
        if (changed && !quiet) showToast('Song catalogue updated.');
        return;
      }
    }

    let song = currentSong();
    let genre = currentGenre();
    if (!genre) {
      genre = state.genres.find((entry) => entry.id === 'traditional') || state.genres[0];
      state.genreId = genre?.id || state.genreId;
    }
    if (!song) {
      song = state.songs.find((entry) => entry.genre === state.genreId) || state.songs[0];
      if (song) {
        state.songId = song.id;
        state.genreId = song.genre;
        state.sheetFilter = song.genre;
        state.duration = song.durationSeconds || 0;
        state.elapsed = 0;
      }
    }

    const activeGenre = currentGenre();
    if (activeGenre) setAccent(activeGenre.accent);
    renderPlayer();
    syncGenreStrips({ smooth: false });
    renderSheet();
    if (changed && !quiet) showToast('Song catalogue updated.');
  } catch (error) {
    if (!quiet) console.warn('Catalogue refresh failed', error);
  }
}

function resolveInitialState() {
  const params = new URLSearchParams(location.search);
  const requestedSong = params.get('song');
  const requestedGenre = params.get('genre');
  const requestedRelease = params.get('release');
  const hasInitialExplicitSong = Boolean(requestedSong || requestedRelease || params.get('nonstop'));
  const hasInitialExplicitNavigation = Boolean(
    hasInitialExplicitSong
    || requestedGenre
    || params.get('library')
    || params.get('browse')
  );
  const session = storage.get('garba:session', {});
  let targetSongId = requestedSong;
  const redirect = targetSongId ? state.presentationRedirects.get(targetSongId) : null;
  let pendingNonstopSetId = null;
  if (redirect?.presentationRole === 'nonstop-only' && redirect.nonstopSetId) {
    pendingNonstopSetId = redirect.nonstopSetId;
    const url = new URL(location.href);
    url.searchParams.delete('song');
    url.searchParams.set('nonstop', pendingNonstopSetId);
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    targetSongId = redirect.canonicalSongId || null;
  } else if (redirect?.canonicalSongId) {
    targetSongId = redirect.canonicalSongId;
  }
  const pendingSongId = targetSongId && !state.songs.some((entry) => entry.id === targetSongId) ? targetSongId : null;

  let song = targetSongId ? state.songs.find((entry) => entry.id === targetSongId) : null;
  let pickedByShuffle = false;
  let genre = requestedGenre ? state.genres.find((entry) => entry.id === requestedGenre) : null;

  // Shuffle starter on reload or initial direct visit (when no specific song was explicitly requested)
  if (!hasInitialExplicitSong && !song && !pendingSongId) {
    const recentHistory = getRecentPlayedSongs();
    const playableSongs = state.songs.filter(canExecuteSong);

    if (genre) {
      // Case A: User explicitly opened a genre link (e.g. ?genre=dandiya) -> shuffle fresh song within that genre
      const genrePlayable = playableSongs.filter((entry) => entry.genre === genre.id);
      if (genrePlayable.length) {
        const maxExclude = Math.max(0, genrePlayable.length - Math.min(genrePlayable.length, 5));
        const excludeSet = new Set(recentHistory.slice(-maxExclude));
        const freshInGenre = genrePlayable.filter((entry) => !excludeSet.has(entry.id));
        const pool = freshInGenre.length ? freshInGenre : genrePlayable;
        song = pool[Math.floor(Math.random() * pool.length)];
        pickedByShuffle = true;
      }
    } else {
      // Case B: General visit / reload (playgarba.com) -> draw freely from the ENTIRE pool of playable songs across all genres
      // Exclude recently heard songs (up to 100+ songs) so each reload gives a fresh song and never repeats songs heard a few clicks/reloads ago
      const maxExclude = Math.max(0, playableSongs.length - 100);
      const excludeSet = new Set(recentHistory.slice(-maxExclude));
      const freshPool = playableSongs.filter((entry) => !excludeSet.has(entry.id));
      const pool = freshPool.length ? freshPool : playableSongs;
      song = pool[Math.floor(Math.random() * pool.length)];
      if (song) {
        genre = state.genres.find((entry) => entry.id === song.genre) || state.genres[0];
        pickedByShuffle = true;
      }
    }

    if (song) {
      recordRecentPlayedSong(song.id);
    }
  }

  const preserveRequestedIdentity = Boolean(song && targetSongId && song.id === targetSongId);
  const preserveRestoredIdentity = Boolean(song && !targetSongId && session.songId && song.id === session.songId && hasInitialExplicitNavigation);

  if (!genre && song) genre = state.genres.find((entry) => entry.id === song.genre);
  if (!genre && session.genreId && hasInitialExplicitNavigation) genre = state.genres.find((entry) => entry.id === session.genreId);
  if (!genre) genre = state.genres.find((entry) => entry.id === 'traditional') || state.genres[0];

  if (!song || (!pickedByShuffle && !(preserveRequestedIdentity || preserveRestoredIdentity) && song.genre !== genre.id)) {
    song = state.songs.find((entry) => entry.genre === genre.id && canExecuteSong(entry))
      || state.songs.find((entry) => entry.genre === genre.id)
      || state.songs.find(canExecuteSong)
      || state.songs[0];
  }
  const releaseContext = requestedRelease
    && requestedSong
    && song?.id === requestedSong
    && !pendingNonstopSetId
    ? releaseContextMatch(requestedRelease, requestedSong)
    : null;
  const requestedTimestamp = parseShareTimestamp?.(params.get('t'), song?.durationSeconds) ?? null;
  const elapsed = requestedTimestamp != null && requestedTimestamp > 0
    ? requestedTimestamp
    : Number(session.elapsed || 0);
  return {
    genre,
    song,
    pendingSongId,
    releaseContextId: releaseContext?.releaseId || null,
    elapsed,
    browse: params.get('browse') === '1',
    myGarba: params.get('library') === 'my-garba',
    pendingNonstopSetId,
    hasInitialExplicitNavigation,
  };
}

async function init() {
  try {
    const catalogue = await fetchCatalogue();
    state.genres = catalogue.genres;
    state.songs = catalogue.songs;
    state.presentationRedirects = catalogue.presentationRedirects;
    reconcilePresentationFavourites();
    sanitiseManualQueue();
    state.catalogueSignature = makeCatalogueSignature(state.genres, state.songs);
    state.catalogueLoadedAt = Date.now();
    const initial = resolveInitialState();
    state.hasExplicitNavigation = initial.hasInitialExplicitNavigation;

    state.genreId = initial.genre.id;
    state.sheetFilter = initial.genre.id;
    state.songId = initial.song?.id || null;
    state.duration = initial.song?.durationSeconds || 0;
    els.app.dataset.genre = initial.genre.id;
    setAccent(initial.genre.accent);

    if (els.favouritesButton) {
      els.favouritesButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"></path></svg>';
    }

    state.morphs = initMorphicons(els);
    els.shuffleButton?.setAttribute('aria-pressed', String(state.shuffleMode));
    state.morphs?.get('shuffle')?.morphTo(state.shuffleMode ? 'shuffleActive' : 'shuffleInactive', { instant: true });

    if (initial.song) await selectSong(initial.song.id, { initial: true, animate: false, restoreElapsed: initial.elapsed, keepSheet: true });
    else {
      renderPlayer();
      syncGenreStrips({ smooth: false });
      renderSheet();
    }

    if (initial.releaseContextId && initial.song) {
      setReleaseContext(initial.releaseContextId, initial.song.id);
      renderPlayer();
      renderSheet();
    } else clearReleaseContext();

    state.pendingSongId = initial.pendingSongId;
    if (initial.pendingNonstopSetId) {
      setTimeout(() => window.GARBA_NONSTOP?.play?.(initial.pendingNonstopSetId, { quiet: true }), 0);
    }
    if (initial.myGarba) openSheet('favourites', { snap: 'full', history: false });
    else if (initial.browse) openSheet('all', { snap: 'full', history: false });
    updateUrl();
  } catch (error) {
    console.error(error);
    showToast('Catalogue could not load. The app shell is ready, but song data is unavailable.');
  }
}

function applyExploreHandoff() {
  const params = new URLSearchParams(location.search);
  const requestedSong = params.get('song');
  if (!requestedSong) return;

  let handoff = null;
  try { handoff = JSON.parse(sessionStorage.getItem('playgarba:route-handoff') || 'null'); } catch { return; }
  if (!handoff || handoff.v !== 1 || handoff.songId !== requestedSong || Date.now() - Number(handoff.at || 0) > 15000) return;
  try { sessionStorage.removeItem('playgarba:route-handoff'); } catch { /* storage can be unavailable */ }

  const genreMeta = {
    traditional: { label: 'Traditional Garba', background: 'assets/backgrounds/traditional.svg', accent: '#d6b06f' },
    dandiya: { label: 'Dandiya Raas', background: 'assets/backgrounds/dandiya.svg', accent: '#a77ad6' },
    devotional: { label: 'Devotional Garba', background: 'assets/backgrounds/devotional.svg', accent: '#c78372' },
    folk: { label: 'Gujarati Folk', background: 'assets/backgrounds/folk.svg', accent: '#9a9fc7' },
    sanedo: { label: 'Sanedo', background: 'assets/backgrounds/sanedo.svg', accent: '#c99872' },
    fusion: { label: 'Modern Fusion Garba', background: 'assets/backgrounds/fusion.svg', accent: '#a78bc4' },
  };
  const genreId = genreMeta[handoff.genre] ? handoff.genre : 'traditional';
  const genre = genreMeta[genreId];
  const root = document.documentElement;

  root.dataset.songHandoff = 'true';
  root.style.setProperty('--accent', genre.accent);
  if (els.app) els.app.dataset.genre = genreId;
  if (els.worldA) els.worldA.style.backgroundImage = `url("${genre.background}")`;
  if (els.songTitle && handoff.title) els.songTitle.textContent = handoff.title;
  if (els.songArtist && handoff.artist) els.songArtist.textContent = handoff.artist;
  if (els.genreEyebrow) els.genreEyebrow.textContent = genre.label;
  if (els.miniTitle && handoff.title) els.miniTitle.textContent = handoff.title;
  if (els.miniArtist && handoff.artist) els.miniArtist.textContent = handoff.artist;
  document.querySelectorAll('[data-static-genre="true"]').forEach((button) => {
    const active = button.dataset.genre === genreId;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  });

  const clear = () => { delete root.dataset.songHandoff; };
  window.setTimeout(clear, 1100);
  window.addEventListener('pagereveal', (event) => {
    if (event.viewTransition) event.viewTransition.finished.catch(() => {}).finally(clear);
  }, { once: true });
}

let dandiyaAudioCtx = null;

function playDandiyaTap() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!dandiyaAudioCtx || dandiyaAudioCtx.state === 'closed') {
      dandiyaAudioCtx = new AudioCtx();
    }
    if (dandiyaAudioCtx.state === 'suspended') {
      dandiyaAudioCtx.resume();
    }
    const t = dandiyaAudioCtx.currentTime;

    // Body resonance of the Dandiya wooden stick
    const bodyOsc = dandiyaAudioCtx.createOscillator();
    const bodyGain = dandiyaAudioCtx.createGain();
    const bodyFilter = dandiyaAudioCtx.createBiquadFilter();

    bodyFilter.type = 'bandpass';
    bodyFilter.frequency.setValueAtTime(820, t);
    bodyFilter.Q.setValueAtTime(1.8, t);

    bodyOsc.type = 'triangle';
    bodyOsc.frequency.setValueAtTime(880, t);
    bodyOsc.frequency.exponentialRampToValueAtTime(520, t + 0.045);

    bodyGain.gain.setValueAtTime(0.68, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.065);

    bodyOsc.connect(bodyFilter);
    bodyFilter.connect(bodyGain);
    bodyGain.connect(dandiyaAudioCtx.destination);

    // High snap transient of stick contact
    const snapOsc = dandiyaAudioCtx.createOscillator();
    const snapGain = dandiyaAudioCtx.createGain();
    snapOsc.type = 'sine';
    snapOsc.frequency.setValueAtTime(1750, t);
    snapOsc.frequency.exponentialRampToValueAtTime(980, t + 0.025);

    snapGain.gain.setValueAtTime(0.32, t);
    snapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.028);

    snapOsc.connect(snapGain);
    snapGain.connect(dandiyaAudioCtx.destination);

    bodyOsc.start(t);
    bodyOsc.stop(t + 0.07);
    snapOsc.start(t);
    snapOsc.stop(t + 0.035);
  } catch {
    // Non-blocking tactile feedback
  }
}

function setupMicroBeatFeedback() {
  let lastTapTime = 0;
  const triggerTap = (event) => {
    const now = Date.now();
    if (now - lastTapTime < 60) return;
    const target = event.target;
    if (target instanceof Element && target.closest('button, a, input[type="range"], [role="button"], .genre-button, #nonstopButton, .browse-button, .live-station-button')) {
      lastTapTime = now;
      playDandiyaTap();
    }
  };
  if (window.PointerEvent) {
    document.addEventListener('pointerdown', triggerTap, { capture: true, passive: true });
  } else {
    document.addEventListener('click', triggerTap, { capture: true, passive: true });
  }
}

function setupInteractionHardening() {
  document.addEventListener('contextmenu', (event) => {
    if (!event.target.closest('input, textarea')) {
      event.preventDefault();
    }
  }, { capture: true });

  document.addEventListener('dragstart', (event) => {
    if (!event.target.closest('input, textarea')) {
      event.preventDefault();
    }
  }, { capture: true });
}

window.addEventListener('garba:playback-state-change', (event) => {
  const playing = Boolean(event.detail?.playing);
  setPlaying(playing);
});

applyExploreHandoff();
placeFavourite();
syncSheetChrome();
wireEvents();
setupMediaSessionActions();
setupMicroBeatFeedback();
setupInteractionHardening();
setupPwaInstall();
registerServiceWorker();
init();

window.GARBA_APP = Object.freeze({
  getCurrentSong: () => currentSong(),
  getState: () => state,
});

window.GARBA_SHARE = Object.freeze({
  shareCurrent: handleShareCurrentSong,
});