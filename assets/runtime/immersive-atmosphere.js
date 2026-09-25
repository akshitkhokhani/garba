(() => {
  const STORAGE_KEY = 'garba:atmosphere';
  const SOURCE_MANIFEST = 'data/atmosphere-sources.json';
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const utilityBar = document.querySelector('.utilities');
  const app = document.getElementById('app');
  const directAudio = document.getElementById('audio');
  if (!utilityBar || !app) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

  const MODES = {
    off: { label: 'Off', desc: 'Direct clean playback', master: 0, events: 0, crowd: 0, clapping: 0, spatial: false },
    crowd: { label: 'Live Ground', desc: 'Live ground energy & cheers', master: 0.22, events: 0.35, crowd: 0.85, clapping: 0, spatial: false },
    clapping: { label: 'Beat Clapping', desc: 'Rhythmic ground handclaps', master: 0.24, events: 0.35, crowd: 0, clapping: 0.85, spatial: false },
    immersive: { label: 'Immersive 360°', desc: 'Surround crowd & rhythm', master: 0.28, events: 0.45, crowd: 0.72, clapping: 0.72, spatial: true },
  };

  const ENVIRONMENTS = {
    outdoor: {
      label: 'Ground',
      icon: '🏟️',
      desc: 'Open-air stadium slapback echo',
      delay: 0.165,
      feedback: 0.24,
      cutoff: 2400,
      wet: 0.36,
      dry: 0.88,
    },
    indoor: {
      label: 'Courtyard',
      icon: '🏛️',
      desc: 'Palace walls & mandap reverb',
      delay: 0.042,
      feedback: 0.40,
      cutoff: 3600,
      wet: 0.46,
      dry: 0.82,
    },
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const stored = (() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
  })();

  const initialMode = (() => {
    if (stored?.mode && MODES[stored.mode]) return stored.mode;
    if (stored?.mode === 'ground') return 'crowd';
    return 'off';
  })();

  const initialEnvironment = (() => {
    if (stored?.environment && ENVIRONMENTS[stored.environment]) return stored.environment;
    return 'outdoor';
  })();

  const state = {
    context: null,
    master: null,
    bus: null,
    dryGain: null,
    wetGain: null,
    delayNode: null,
    delayFeedback: null,
    delayFilter: null,
    highpass: null,
    lowpass: null,
    compressor: null,
    mode: initialMode,
    environment: initialEnvironment,
    level: clamp(Number(stored?.level ?? 0.45), 0.05, 1),
    stickBuffers: [],
    clapBuffers: [],
    eventTimer: 0,
    orbitTimer: 0,
    idleTimer: 0,
    previewTimer: 0,
    crowdSource: null,
    crowdGain: null,
    crowdFilter: null,
    crowdPanner: null,
    clappingSource: null,
    clappingGain: null,
    clappingFilter: null,
    clappingPanner: null,
    panelOpen: false,
    previewActive: false,
    playbackActive: false,
    sceneReady: false,
    generation: 0,
    previousFocus: null,
    inertNodes: [],
  };

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        mode: state.mode,
        environment: state.environment,
        level: state.level,
      }));
    } catch { /* storage unavailable */ }
  }

  function constrainedConnection() {
    return Boolean(connection?.saveData) || /(^|-)2g$/.test(String(connection?.effectiveType || ''));
  }

  function playbackIsActive() {
    if (directAudio?.currentSrc && !directAudio.paused && !directAudio.ended) return true;
    return app.classList.contains('is-playing');
  }

  function runtimeProfile() {
    const base = MODES[state.mode];
    if (!base || state.mode === 'off' || !constrainedConnection()) return base;
    return { ...base, events: base.events * 0.5, crowd: Math.min(base.crowd, 0.4), clapping: Math.min(base.clapping, 0.4) };
  }

  function injectStyles() {
    if (document.getElementById('garbaAtmosphereStyles')) return;
    const style = document.createElement('style');
    style.id = 'garbaAtmosphereStyles';
    style.textContent = `
      .atmosphere-button{position:relative}
      .atmosphere-button[aria-pressed="true"]{color:var(--accent);background:color-mix(in srgb,var(--accent) 16%,rgba(8,10,18,.22))}
      .atmosphere-button::after{content:"";position:absolute;right:6px;top:6px;width:6px;height:6px;border-radius:50%;background:var(--accent);opacity:0;transform:scale(.6);transition:opacity 160ms ease,transform 180ms ease;box-shadow:0 0 0 2px rgba(8,10,18,.54)}
      .atmosphere-button[aria-pressed="true"]::after{opacity:1;transform:scale(1)}
      .atmosphere-button svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round}
      .atmosphere-backdrop{position:fixed;z-index:89;inset:0;border:0;padding:0;background:rgba(3,5,10,.26);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}
      .atmosphere-backdrop[hidden],.atmosphere-panel[hidden]{display:none!important}
      .atmosphere-panel{position:fixed;z-index:90;top:max(76px,calc(env(safe-area-inset-top) + 58px));right:max(14px,env(safe-area-inset-right));width:min(360px,calc(100vw - 28px));box-sizing:border-box;padding:16px 18px 18px;color:#f6ecd7;border:1px solid rgba(246,236,215,.14);border-radius:22px;background:rgba(12,14,25,.965);box-shadow:0 28px 90px rgba(0,0,0,.52);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px)}
      .atmosphere-panel-header{display:flex;align-items:center;justify-content:space-between;gap:12px}
      .atmosphere-heading{display:flex;align-items:center;gap:9px;min-width:0}
      .atmosphere-panel h2{margin:0;font:600 17px/1.15 var(--sans,system-ui);letter-spacing:-.01em}
      .atmosphere-test,.atmosphere-close{display:inline-grid;place-items:center;border:1px solid rgba(246,236,215,.12);color:inherit;background:rgba(246,236,215,.05);cursor:pointer}
      .atmosphere-test{width:30px;height:30px;border-radius:999px}
      .atmosphere-test[aria-pressed="true"]{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 52%,rgba(246,236,215,.14));background:color-mix(in srgb,var(--accent) 13%,rgba(246,236,215,.04))}
      .atmosphere-test svg{width:14px;height:14px;fill:currentColor}
      .atmosphere-close{width:32px;height:32px;border-radius:999px;font:300 20px/1 var(--sans,system-ui)}
      .atmosphere-section-label{margin:14px 0 7px;font:600 10.5px/1.2 var(--sans,system-ui);letter-spacing:.06em;text-transform:uppercase;color:rgba(246,236,215,.55)}
      .atmosphere-modes,.atmosphere-environments{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
      .atmosphere-mode,.atmosphere-env{min-height:38px;padding:8px 10px;border:1px solid rgba(246,236,215,.11);border-radius:12px;color:inherit;background:rgba(246,236,215,.045);cursor:pointer;font:600 12px/1.2 var(--sans,system-ui);text-align:center;display:inline-flex;align-items:center;justify-content:center;gap:5px;transition:background 160ms ease,border-color 160ms ease,transform 160ms ease,opacity 160ms ease}
      .atmosphere-mode:hover,.atmosphere-env:hover{background:rgba(246,236,215,.08)}
      .atmosphere-mode:active,.atmosphere-env:active{transform:scale(.985)}
      .atmosphere-mode[aria-pressed="true"],.atmosphere-env[aria-pressed="true"]{border-color:color-mix(in srgb,var(--accent) 62%,rgba(246,236,215,.15));background:color-mix(in srgb,var(--accent) 15%,rgba(246,236,215,.05));color:#fff}
      .atmosphere-env:disabled,.atmosphere-mode:disabled{opacity:.32;cursor:default;pointer-events:none}
      .atmosphere-headphone-icon{display:inline-block;width:13px;height:13px;vertical-align:-1px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      .atmosphere-level{margin-top:16px}
      .atmosphere-level-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
      .atmosphere-level label{font:600 12px/1 var(--sans,system-ui)}
      .atmosphere-level output{opacity:.9;transition:opacity 140ms ease;color:rgba(246,236,215,.68);font:600 11px/1 var(--sans,system-ui)}
      .atmosphere-level input{--fill:${Math.round(state.level * 100)}%;appearance:none;-webkit-appearance:none;width:100%;height:22px;margin:0;background:transparent;cursor:pointer}
      .atmosphere-level input::-webkit-slider-runnable-track{height:6px;border-radius:999px;background:linear-gradient(90deg,var(--accent) 0 var(--fill),rgba(246,236,215,.14) var(--fill) 100%)}
      .atmosphere-level input::-webkit-slider-thumb{-webkit-appearance:none;width:17px;height:17px;margin-top:-5.5px;border:2px solid rgba(12,14,25,.95);border-radius:50%;background:#f6ecd7;box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 35%,transparent),0 3px 10px rgba(0,0,0,.35)}
      .atmosphere-level input::-moz-range-track{height:6px;border-radius:999px;background:rgba(246,236,215,.14)}
      .atmosphere-level input::-moz-range-progress{height:6px;border-radius:999px;background:var(--accent)}
      .atmosphere-level input::-moz-range-thumb{width:16px;height:16px;border:2px solid rgba(12,14,25,.95);border-radius:50%;background:#f6ecd7;box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 35%,transparent),0 3px 10px rgba(0,0,0,.35)}
      .atmosphere-level input:disabled{opacity:.32;cursor:default}
      .atmosphere-status{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
      .atmosphere-panel :focus-visible{outline:2px solid var(--accent);outline-offset:3px}
      @media(max-width:700px){.atmosphere-backdrop{background:rgba(3,5,10,.42)}.atmosphere-panel{top:auto;right:max(10px,env(safe-area-inset-right));bottom:max(10px,calc(env(safe-area-inset-bottom) + 8px));left:max(10px,env(safe-area-inset-left));width:auto;border-radius:24px;padding:16px}}
      @media(max-width:390px){.atmosphere-panel{left:8px;right:8px;bottom:max(8px,env(safe-area-inset-bottom))}.atmosphere-modes,.atmosphere-environments{grid-template-columns:1fr 1fr}}
      @media(prefers-reduced-motion:reduce){.atmosphere-button::after,.atmosphere-mode,.atmosphere-env,.atmosphere-level output{transition:none}}
    `;
    document.head.append(style);
  }

  function focusables() {
    return [...state.panel.querySelectorAll('button:not([disabled]),input:not([disabled]),[href],[tabindex]:not([tabindex="-1"])')].filter((node) => node.getClientRects().length > 0);
  }

  function setBackgroundInert(inert) {
    if (inert) {
      state.inertNodes = [app, document.getElementById('providerStage'), document.getElementById('youtubeStage'), document.getElementById('installBanner')].filter((node) => node && node !== state.panel && !state.panel.contains(node));
      state.inertNodes.forEach((node) => node.setAttribute('inert', ''));
    } else {
      state.inertNodes.forEach((node) => node.removeAttribute('inert'));
      state.inertNodes = [];
    }
  }

  function createUi() {
    injectStyles();
    const button = document.createElement('button');
    button.id = 'atmosphereButton';
    button.className = 'icon-button atmosphere-button';
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="1.7"></circle><path d="M8.4 8.4a5.1 5.1 0 0 0 0 7.2M15.6 8.4a5.1 5.1 0 0 1 0 7.2M5.5 5.5a9.2 9.2 0 0 0 0 13M18.5 5.5a9.2 9.2 0 0 1 0 13"></path></svg>';
    const queue = document.getElementById('queueButton');
    utilityBar.insertBefore(button, queue?.nextSibling || null);

    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'atmosphere-backdrop';
    backdrop.hidden = true;
    backdrop.tabIndex = -1;
    backdrop.setAttribute('aria-label', 'Close Garba Atmosphere');
    document.body.append(backdrop);

    const panel = document.createElement('section');
    panel.id = 'atmospherePanel';
    panel.className = 'atmosphere-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'atmosphereTitle');
    panel.innerHTML = `
      <div class="atmosphere-panel-header">
        <div class="atmosphere-heading">
          <h2 id="atmosphereTitle">Garba Atmosphere</h2>
          <button class="atmosphere-test" type="button" aria-label="Test Garba Atmosphere" aria-pressed="false" title="Test atmosphere">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.4v13.2L18.5 12 8 5.4Z"></path></svg>
          </button>
        </div>
        <button class="atmosphere-close" type="button" aria-label="Close Garba Atmosphere">×</button>
      </div>
      <div class="atmosphere-section-label">Soundscape</div>
      <div class="atmosphere-modes"></div>
      <div class="atmosphere-section-label">Acoustic Space</div>
      <div class="atmosphere-environments"></div>
      <div class="atmosphere-level">
        <div class="atmosphere-level-row"><label for="atmosphereLevel">Intensity</label><output for="atmosphereLevel">${Math.round(state.level * 100)}%</output></div>
        <input id="atmosphereLevel" type="range" min="5" max="100" step="5" value="${Math.round(state.level * 100)}" />
      </div>
      <p class="atmosphere-status" role="status" aria-live="polite"></p>
    `;
    document.body.append(panel);

    const modes = panel.querySelector('.atmosphere-modes');
    for (const [id, profile] of Object.entries(MODES)) {
      const mode = document.createElement('button');
      mode.type = 'button';
      mode.className = 'atmosphere-mode';
      mode.dataset.mode = id;
      const headphone = id === 'immersive' ? '<svg class="atmosphere-headphone-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14v-2a8 8 0 0 1 16 0v2"></path><path d="M4 14h3v6H5.5A1.5 1.5 0 0 1 4 18.5V14ZM20 14h-3v6h1.5a1.5 1.5 0 0 0 1.5-1.5V14Z"></path></svg>' : '';
      mode.innerHTML = `${profile.label}${headphone}`;
      mode.title = profile.desc;
      mode.addEventListener('click', () => setMode(id, { userGesture: true }));
      modes.append(mode);
    }

    const envs = panel.querySelector('.atmosphere-environments');
    for (const [id, env] of Object.entries(ENVIRONMENTS)) {
      const envBtn = document.createElement('button');
      envBtn.type = 'button';
      envBtn.className = 'atmosphere-env';
      envBtn.dataset.env = id;
      envBtn.innerHTML = `<span>${env.icon}</span> ${env.label}`;
      envBtn.title = env.desc;
      envBtn.addEventListener('click', () => applyEnvironment(id));
      envs.append(envBtn);
    }

    const close = panel.querySelector('.atmosphere-close');
    const test = panel.querySelector('.atmosphere-test');
    const slider = panel.querySelector('#atmosphereLevel');
    const output = panel.querySelector('output');
    const levelWrap = panel.querySelector('.atmosphere-level');

    const syncSliderFill = () => slider.style.setProperty('--fill', `${slider.value}%`);
    const endAdjust = () => levelWrap.classList.remove('is-adjusting');

    button.addEventListener('click', () => setPanelOpen(!state.panelOpen));
    backdrop.addEventListener('click', () => setPanelOpen(false));
    close.addEventListener('click', () => setPanelOpen(false));
    test.addEventListener('click', () => togglePreview());
    slider.addEventListener('input', () => {
      state.level = clamp(Number(slider.value) / 100, 0.05, 1);
      output.value = `${Math.round(state.level * 100)}%`;
      levelWrap.classList.add('is-adjusting');
      syncSliderFill();
      persist();
      applyMasterLevel();
      dispatchChange('level');
    });
    slider.addEventListener('pointerup', () => setTimeout(endAdjust, 500));
    slider.addEventListener('change', () => setTimeout(endAdjust, 500));
    slider.addEventListener('blur', endAdjust);

    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setPanelOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    state.button = button;
    state.backdrop = backdrop;
    state.panel = panel;
    state.slider = slider;
    state.output = output;
    state.test = test;
    state.status = panel.querySelector('.atmosphere-status');
    syncSliderFill();
    syncUi();
  }

  function setPanelOpen(open) {
    const next = Boolean(open);
    if (next === state.panelOpen) return;
    state.panelOpen = next;
    if (next) {
      state.previousFocus = document.activeElement;
      state.panel.hidden = false;
      state.backdrop.hidden = false;
      state.button.setAttribute('aria-expanded', 'true');
      setBackgroundInert(true);
      requestAnimationFrame(() => state.panel.querySelector('.atmosphere-mode[aria-pressed="true"]')?.focus({ preventScroll: true }));
    } else {
      state.panel.hidden = true;
      state.backdrop.hidden = true;
      state.button.setAttribute('aria-expanded', 'false');
      setBackgroundInert(false);
      const target = state.previousFocus?.isConnected ? state.previousFocus : state.button;
      state.previousFocus = null;
      target?.focus?.({ preventScroll: true });
    }
  }

  function syncUi() {
    const profile = MODES[state.mode] || MODES.off;
    if (!state.button) return;
    state.button.setAttribute('aria-pressed', String(state.mode !== 'off'));
    state.button.setAttribute('aria-label', `Garba Atmosphere: ${profile.label}`);
    state.button.title = `Garba Atmosphere: ${profile.label}`;
    state.panel?.querySelectorAll('.atmosphere-mode').forEach((control) => {
      control.setAttribute('aria-pressed', String(control.dataset.mode === state.mode));
    });
    state.panel?.querySelectorAll('.atmosphere-env').forEach((control) => {
      control.setAttribute('aria-pressed', String(control.dataset.env === state.environment));
      control.disabled = state.mode === 'off';
    });
    if (state.slider) state.slider.disabled = state.mode === 'off';
    if (state.test) {
      state.test.disabled = state.mode === 'off';
      state.test.setAttribute('aria-pressed', String(state.previewActive));
      state.test.setAttribute('aria-label', state.previewActive ? 'Stop atmosphere test' : 'Test Garba Atmosphere');
      state.test.title = state.previewActive ? 'Stop test' : 'Test atmosphere';
      const path = state.test.querySelector('path');
      if (path) path.setAttribute('d', state.previewActive ? 'M7 6h4v12H7V6Zm6 0h4v12h-4V6Z' : 'M8 5.4v13.2L18.5 12 8 5.4Z');
    }
  }

  function setStatus(message = '') {
    if (state.status) state.status.textContent = message;
  }

  function dispatchChange(reason) {
    window.dispatchEvent(new CustomEvent('garba:atmosphere-change', {
      detail: {
        reason,
        mode: state.mode,
        environment: state.environment,
        level: state.level,
        audible: state.playbackActive || state.previewActive,
        constrained: constrainedConnection(),
      },
    }));
  }

  function createStickBuffer(variation = 0) {
    const duration = 0.07;
    const rate = state.context.sampleRate;
    const buffer = state.context.createBuffer(1, Math.ceil(rate * duration), rate);
    const data = buffer.getChannelData(0);
    const base = 960 + variation * 90;
    for (let i = 0; i < data.length; i += 1) {
      const t = i / rate;
      const env = Math.exp(-t * 58);
      const wood = Math.sin(Math.PI * 2 * base * t) * 0.52 + Math.sin(Math.PI * 2 * (base * 1.72) * t) * 0.24;
      data[i] = (wood + (Math.random() * 2 - 1) * 0.11) * env;
    }
    return buffer;
  }

  function createClapBuffer(variation = 0) {
    const duration = 0.14;
    const rate = state.context.sampleRate;
    const buffer = state.context.createBuffer(1, Math.ceil(rate * duration), rate);
    const data = buffer.getChannelData(0);
    const bursts = [0, 0.015 + variation * 0.001, 0.031 + variation * 0.0015];
    for (let i = 0; i < data.length; i += 1) {
      const t = i / rate;
      let env = 0;
      for (const start of bursts) if (t >= start) env += Math.exp(-(t - start) * 52);
      data[i] = (Math.random() * 2 - 1) * Math.min(1, env) * 0.62;
    }
    return buffer;
  }

  function applyEnvironment(envKey, { immediate = false } = {}) {
    const env = ENVIRONMENTS[envKey] || ENVIRONMENTS.outdoor;
    state.environment = envKey in ENVIRONMENTS ? envKey : 'outdoor';
    persist();
    if (!state.context || !state.delayNode) {
      syncUi();
      return;
    }
    const now = state.context.currentTime;
    if (immediate) {
      state.delayNode.delayTime.value = env.delay;
      state.delayFeedback.gain.value = env.feedback;
      state.delayFilter.frequency.value = env.cutoff;
      state.wetGain.gain.value = env.wet;
      state.dryGain.gain.value = env.dry;
    } else {
      state.delayNode.delayTime.setTargetAtTime(env.delay, now, 0.08);
      state.delayFeedback.gain.setTargetAtTime(env.feedback, now, 0.08);
      state.delayFilter.frequency.setTargetAtTime(env.cutoff, now, 0.08);
      state.wetGain.gain.setTargetAtTime(env.wet, now, 0.08);
      state.dryGain.gain.setTargetAtTime(env.dry, now, 0.08);
    }
    syncUi();
    dispatchChange('environment');
  }

  async function ensureContext() {
    if (!AudioContextCtor) { setStatus('Atmosphere audio is not supported on this browser.'); return false; }
    if (!state.context) {
      try { state.context = new AudioContextCtor({ latencyHint: 'playback' }); } catch {
        try { state.context = new AudioContextCtor(); } catch { setStatus('Garba Atmosphere could not start on this device.'); return false; }
      }
      state.master = state.context.createGain();
      state.master.gain.value = 0;

      // Acoustic bus & reflections network
      state.bus = state.context.createGain();
      state.dryGain = state.context.createGain();
      state.wetGain = state.context.createGain();
      state.delayNode = state.context.createDelay(1.0);
      state.delayFeedback = state.context.createGain();
      state.delayFilter = state.context.createBiquadFilter();
      state.delayFilter.type = 'lowpass';

      // Dry path: bus -> dryGain -> master
      state.bus.connect(state.dryGain).connect(state.master);

      // Wet reflections path: bus -> delayNode -> delayFilter -> wetGain -> master
      // Loopback: delayFilter -> delayFeedback -> delayNode
      state.bus.connect(state.delayNode);
      state.delayNode.connect(state.delayFilter);
      state.delayFilter.connect(state.delayFeedback).connect(state.delayNode);
      state.delayFilter.connect(state.wetGain).connect(state.master);

      applyEnvironment(state.environment, { immediate: true });

      state.highpass = state.context.createBiquadFilter();
      state.highpass.type = 'highpass';
      state.highpass.frequency.value = 95;
      state.highpass.Q.value = 0.28;
      state.lowpass = state.context.createBiquadFilter();
      state.lowpass.type = 'lowpass';
      state.lowpass.frequency.value = 8200;
      state.lowpass.Q.value = 0.22;
      state.compressor = state.context.createDynamicsCompressor();
      state.compressor.threshold.value = -20;
      state.compressor.knee.value = 18;
      state.compressor.ratio.value = 2.6;
      state.compressor.attack.value = 0.008;
      state.compressor.release.value = 0.22;
      state.master.connect(state.highpass).connect(state.lowpass).connect(state.compressor).connect(state.context.destination);
      state.stickBuffers = [0, 1, 2].map(createStickBuffer);
      state.clapBuffers = [0, 1, 2].map(createClapBuffer);
    }
    if (state.context.state !== 'running') {
      try { await state.context.resume(); } catch { return false; }
    }
    return state.context.state === 'running';
  }

  function createPanner(angle, distance = 1.8, hrtf = true) {
    const panner = state.context.createPanner();
    panner.panningModel = hrtf ? 'HRTF' : 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.maxDistance = 9;
    panner.rolloffFactor = 0.46;
    panner.positionX.value = Math.sin(angle) * distance;
    panner.positionY.value = 0;
    panner.positionZ.value = -Math.cos(angle) * distance;
    return panner;
  }

  const audioCache = new Map();

  async function fetchAndDecode(url) {
    if (audioCache.has(url)) return audioCache.get(url);
    try {
      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok) return null;
      const arrayBuffer = await response.arrayBuffer();
      const decoded = await state.context.decodeAudioData(arrayBuffer);
      audioCache.set(url, decoded);
      return decoded;
    } catch {
      return null;
    }
  }

  async function loadAtmosphereBuffer(role) {
    let localUrl = null;
    let remoteUrl = null;
    if (role === 'ground-crowd') {
      localUrl = 'assets/audio/festival-crowd.ogg';
      remoteUrl = 'https://upload.wikimedia.org/wikipedia/commons/1/15/Festival_concert_people_crowd.ogg';
    } else if (role === 'ground-clapping') {
      localUrl = 'assets/audio/rhythmic-clapping.ogg';
      remoteUrl = 'https://upload.wikimedia.org/wikipedia/commons/a/aa/Palmas_sevillanas_%28flamenco_clapping%29%2C_160_BPM.ogg';
    } else if (role === 'accent-applause') {
      localUrl = 'assets/audio/ground-applause.ogg';
      remoteUrl = 'https://upload.wikimedia.org/wikipedia/commons/8/8e/Applause.ogg';
    }

    let buffer = await fetchAndDecode(localUrl);
    if (!buffer && remoteUrl && navigator.onLine) {
      buffer = await fetchAndDecode(remoteUrl);
    }
    return buffer;
  }

  function stopBeds() {
    try { state.crowdSource?.stop(); } catch { /* already stopped */ }
    for (const node of [state.crowdSource, state.crowdFilter, state.crowdGain, state.crowdPanner]) try { node?.disconnect(); } catch { /* no-op */ }
    state.crowdSource = null;
    state.crowdGain = null;
    state.crowdFilter = null;
    state.crowdPanner = null;

    try { state.clappingSource?.stop(); } catch { /* already stopped */ }
    for (const node of [state.clappingSource, state.clappingFilter, state.clappingGain, state.clappingPanner]) try { node?.disconnect(); } catch { /* no-op */ }
    state.clappingSource = null;
    state.clappingGain = null;
    state.clappingFilter = null;
    state.clappingPanner = null;
  }

  async function startAtmosphereBeds(profile, generation) {
    stopBeds();
    if (!profile?.crowd || constrainedConnection()) return;
    if (!profile || state.mode === 'off' || constrainedConnection()) return;

    // 1. Festival Crowd Bed
    if (profile.crowd > 0) {
      const buffer = await loadAtmosphereBuffer('ground-crowd');
      if (buffer && generation === state.generation && state.mode !== 'off' && (state.playbackActive || state.previewActive)) {
        const source = state.context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        const filter = state.context.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = 2600;
        filter.Q.value = 0.55;
        const gain = state.context.createGain();
        gain.gain.value = profile.crowd * 0.44;

        if (profile.spatial) {
          const panner = createPanner(0.3, 2.0, true);
          source.connect(filter).connect(gain).connect(panner).connect(state.bus);
          state.crowdPanner = panner;
        } else {
          source.connect(filter).connect(gain).connect(state.bus);
        }

        source.start(0, Math.random() * Math.max(0.1, buffer.duration - 1));
        state.crowdSource = source;
        state.crowdFilter = filter;
        state.crowdGain = gain;
      }
    }

    // 2. Rhythmic Beat Clapping Bed
    if (profile.clapping > 0) {
      const clapBuffer = await loadAtmosphereBuffer('ground-clapping');
      if (clapBuffer && generation === state.generation && state.mode !== 'off' && (state.playbackActive || state.previewActive)) {
        const source = state.context.createBufferSource();
        source.buffer = clapBuffer;
        source.loop = true;
        const filter = state.context.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = 1900;
        filter.Q.value = 0.65;
        const gain = state.context.createGain();
        gain.gain.value = profile.clapping * 0.46;

        if (profile.spatial) {
          const panner = createPanner(0.3 + Math.PI, 1.6, true);
          source.connect(filter).connect(gain).connect(panner).connect(state.bus);
          state.clappingPanner = panner;
        } else {
          source.connect(filter).connect(gain).connect(state.bus);
        }

        source.start(0, Math.random() * Math.max(0.1, clapBuffer.duration - 1));
        state.clappingSource = source;
        state.clappingFilter = filter;
        state.clappingGain = gain;
      }
    }
  }

  function clearScene() {
    clearTimeout(state.eventTimer);
    clearInterval(state.orbitTimer);
    state.eventTimer = 0;
    state.orbitTimer = 0;
    stopBeds();
    state.sceneReady = false;
  }

  function eventPanner() {
    return createPanner(Math.random() * Math.PI * 2, 1.35 + Math.random() * 1.8, true);
  }

  async function playTransient(kind) {
    if (!state.context || state.mode === 'off' || (!state.playbackActive && !state.previewActive)) return;
    if (kind === 'applause') {
      const buffer = await loadAtmosphereBuffer('accent-applause');
      if (!buffer || (!state.playbackActive && !state.previewActive)) return;
      const source = state.context.createBufferSource();
      source.buffer = buffer;
      const gain = state.context.createGain();
      gain.gain.value = 0.28 + Math.random() * 0.08;
      const panner = eventPanner();
      source.connect(gain).connect(panner).connect(state.bus);
      const startOffset = Math.random() * Math.max(0, buffer.duration - 4);
      source.start(0, startOffset, 3.5);
      source.addEventListener('ended', () => {
        try { source.disconnect(); gain.disconnect(); panner.disconnect(); } catch {}
      }, { once: true });
      return;
    }

    // Dandiya stick strike transient
    const source = state.context.createBufferSource();
    source.buffer = kind === 'stick'
      ? state.stickBuffers[Math.floor(Math.random() * state.stickBuffers.length)]
      : state.clapBuffers[Math.floor(Math.random() * state.clapBuffers.length)];
    const filter = state.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3900 + Math.random() * 700;
    const gain = state.context.createGain();
    gain.gain.value = 0.28 + Math.random() * 0.08;
    const panner = eventPanner();
    source.connect(filter).connect(gain).connect(panner).connect(state.bus);
    source.start();
    source.addEventListener('ended', () => {
      for (const node of [source, filter, gain, panner]) try { node.disconnect(); } catch { /* no-op */ }
    }, { once: true });
  }

  function scheduleEvent(profile, generation) {
    clearTimeout(state.eventTimer);
    if (!profile?.events || generation !== state.generation || state.mode === 'off' || (!state.playbackActive && !state.previewActive)) return;
    const base = state.mode === 'immersive' ? 3800 : 5000;
    const spread = state.mode === 'immersive' ? 4800 : 6500;
    const delay = base + Math.random() * spread / Math.max(0.18, profile.events);
    state.eventTimer = setTimeout(() => {
      if (generation !== state.generation || (!state.playbackActive && !state.previewActive)) return;
      // In crowd or immersive mode, occasional celebratory cheer burst (35% chance) or dandiya stick tap
      const kind = (state.mode === 'crowd' || state.mode === 'immersive') && Math.random() < 0.35 ? 'applause' : 'stick';
      playTransient(kind);
      scheduleEvent(profile, generation);
    }, delay);
  }

  function startOrbit(generation) {
    clearInterval(state.orbitTimer);
    if (state.mode !== 'immersive' || reducedMotion.matches) return;
    state.orbitTimer = setInterval(() => {
      if (generation !== state.generation || state.mode !== 'immersive' || !state.context || !state.sceneReady) return;
      const now = state.context.currentTime;
      const angle = (Date.now() / 8000) % (Math.PI * 2);
      if (state.crowdPanner) {
        state.crowdPanner.positionX.setTargetAtTime(Math.sin(angle) * 2.0, now, 0.3);
        state.crowdPanner.positionZ.setTargetAtTime(-Math.cos(angle) * 2.0, now, 0.3);
      }
      if (state.clappingPanner) {
        const clapAngle = angle + Math.PI;
        state.clappingPanner.positionX.setTargetAtTime(Math.sin(clapAngle) * 1.5, now, 0.3);
        state.clappingPanner.positionZ.setTargetAtTime(-Math.cos(clapAngle) * 1.5, now, 0.3);
      }
    }, 280);
  }

  function targetMasterGain() {
    if (!state.context || !state.master || state.mode === 'off' || (!state.playbackActive && !state.previewActive)) return 0;
    return runtimeProfile().master * state.level;
  }

  function applyMasterLevel({ quick = false } = {}) {
    if (!state.context || !state.master) return;
    const target = targetMasterGain();
    const now = state.context.currentTime;
    state.master.gain.cancelScheduledValues(now);
    state.master.gain.setTargetAtTime(target, now, target > 0 ? (quick ? 0.06 : 0.18) : 0.055);
  }

  async function buildScene({ smooth = true } = {}) {
    const generation = ++state.generation;
    clearTimeout(state.idleTimer);
    if (state.mode === 'off') { applyMasterLevel({ quick: true }); clearScene(); return; }
    if (!await ensureContext()) return;
    if (smooth && state.sceneReady) {
      state.master.gain.setTargetAtTime(0, state.context.currentTime, 0.05);
      await sleep(110);
      if (generation !== state.generation) return;
    }
    clearScene();
    const profile = runtimeProfile();
    state.sceneReady = true;
    scheduleEvent(profile, generation);
    startOrbit(generation);
    applyMasterLevel();
    void startAtmosphereBeds(profile, generation);
  }

  function scheduleIdleSuspend() {
    clearTimeout(state.idleTimer);
    if (state.previewActive || state.playbackActive || state.mode === 'off') return;
    state.idleTimer = setTimeout(() => {
      if (state.previewActive || state.playbackActive) return;
      clearScene();
      if (state.context?.state === 'running') state.context.suspend().catch(() => {});
    }, 2400);
  }

  function stopPreview({ announce = true } = {}) {
    clearTimeout(state.previewTimer);
    state.previewTimer = 0;
    if (!state.previewActive) return;
    state.previewActive = false;
    syncUi();
    applyMasterLevel({ quick: true });
    if (announce) setStatus('Atmosphere test stopped.');
    scheduleIdleSuspend();
    dispatchChange('preview-ended');
  }

  async function previewCurrentMode() {
    if (state.mode === 'off') return;
    if (state.previewActive) { stopPreview(); return; }
    clearTimeout(state.previewTimer);
    if (!await ensureContext()) return;
    state.previewActive = true;
    syncUi();
    await buildScene({ smooth: true });
    setStatus(`Testing ${MODES[state.mode].label} in ${ENVIRONMENTS[state.environment].label}.`);
    state.previewTimer = setTimeout(() => stopPreview({ announce: false }), 6000);
    dispatchChange('preview-started');
  }

  function togglePreview() { return previewCurrentMode(); }

  async function setMode(mode, { userGesture = false } = {}) {
    if (!MODES[mode]) return;
    stopPreview({ announce: false });
    state.mode = mode;
    persist();
    syncUi();
    dispatchChange('mode');
    if (mode === 'off') {
      applyMasterLevel({ quick: true });
      await sleep(100);
      clearScene();
      scheduleIdleSuspend();
      return;
    }
    if (userGesture && !await ensureContext()) return;
    state.playbackActive = playbackIsActive();
    if (state.playbackActive) await buildScene({ smooth: true });
    else scheduleIdleSuspend();
  }

  function syncPlaybackState() {
    const active = playbackIsActive();
    if (active === state.playbackActive && !(active && state.mode !== 'off' && !state.sceneReady)) return;
    state.playbackActive = active;
    if (active) stopPreview({ announce: false });
    dispatchChange(active ? 'play' : 'pause');
    if (state.mode === 'off') return;
    if (active) {
      clearTimeout(state.idleTimer);
      ensureContext().then((ready) => {
        if (!ready || !state.playbackActive) return;
        if (!state.sceneReady) void buildScene({ smooth: false });
        else {
          applyMasterLevel();
          scheduleEvent(runtimeProfile(), state.generation);
          startOrbit(state.generation);
          if (runtimeProfile().crowd && !state.crowdSource) void startAtmosphereBeds(runtimeProfile(), state.generation);
        }
      });
    } else if (!state.previewActive) {
      applyMasterLevel({ quick: true });
      scheduleIdleSuspend();
    }
  }

  function trustedPlaybackUnlock(event) {
    if (!event.isTrusted || state.mode === 'off') return;
    const target = event.target instanceof Element ? event.target : null;
    if (target && !target.closest('#playButton,#miniPlay,.song-copy,#prevButton,#nextButton,#miniPrev,#miniNext,#atmosphereButton,.atmosphere-mode,.atmosphere-env,#atmosphereLevel,.atmosphere-test')) return;
    ensureContext().then((ready) => { if (ready) requestAnimationFrame(syncPlaybackState); });
  }

  function handleConnectionChange() {
    if (state.mode !== 'off' && state.playbackActive) void buildScene({ smooth: true });
  }

  createUi();
  state.playbackActive = playbackIsActive();

  directAudio?.addEventListener('play', syncPlaybackState);
  directAudio?.addEventListener('pause', syncPlaybackState);
  directAudio?.addEventListener('ended', syncPlaybackState);
  directAudio?.addEventListener('emptied', syncPlaybackState);
  document.addEventListener('pointerdown', trustedPlaybackUnlock, { capture: true });
  document.addEventListener('keydown', (event) => {
    if (!event.isTrusted || event.code !== 'Space' || state.mode === 'off') return;
    ensureContext().then((ready) => { if (ready) requestAnimationFrame(syncPlaybackState); });
  }, { capture: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPreview({ announce: false });
      if (!playbackIsActive()) {
        state.playbackActive = false;
        applyMasterLevel({ quick: true });
        scheduleIdleSuspend();
      }
    } else {
      requestAnimationFrame(syncPlaybackState);
    }
  });
  new MutationObserver(syncPlaybackState).observe(app, { attributes: true, attributeFilter: ['class'] });
  connection?.addEventListener?.('change', handleConnectionChange);
  reducedMotion.addEventListener?.('change', () => { if (state.mode === 'immersive' && (state.playbackActive || state.previewActive)) void buildScene({ smooth: true }); });

  const songSheet = document.getElementById('songSheet');
  if (songSheet) new MutationObserver(() => { if (state.panelOpen && songSheet.getAttribute('aria-hidden') === 'false') setPanelOpen(false); }).observe(songSheet, { attributes: true, attributeFilter: ['aria-hidden'] });

  window.addEventListener('pagehide', () => {
    stopPreview({ announce: false });
    state.playbackActive = false;
    applyMasterLevel({ quick: true });
    if (state.context?.state === 'running') state.context.suspend().catch(() => {});
  });
  window.addEventListener('pageshow', () => requestAnimationFrame(syncPlaybackState));

  window.GARBA_ATMOSPHERE = {
    get mode() { return state.mode; },
    set mode(value) { void setMode(value); },
    get environment() { return state.environment; },
    set environment(value) { applyEnvironment(value); },
    get level() { return state.level; },
    set level(value) {
      state.level = clamp(Number(value) || 0.45, 0.05, 1);
      if (state.slider) {
        state.slider.value = String(Math.round(state.level * 100));
        state.slider.style.setProperty('--fill', `${Math.round(state.level * 100)}%`);
      }
      if (state.output) state.output.value = `${Math.round(state.level * 100)}%`;
      persist();
      applyMasterLevel();
      dispatchChange('level');
    },
    get active() { return state.mode !== 'off' && (state.playbackActive || state.previewActive) && Boolean(state.context) && state.sceneReady; },
    get playbackSynced() { return state.playbackActive; },
    get constrained() { return constrainedConnection(); },
    get spatialModel() { return state.mode === 'immersive' ? 'HRTF' : 'stereo-plus-spatial-events'; },
    setMode,
    setEnvironment: applyEnvironment,
    preview() { return previewCurrentMode(); },
    stopPreview,
    stop() { return setMode('off'); },
  };
})();