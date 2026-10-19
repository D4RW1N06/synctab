// Közös segédfüggvények a master és a kliens oldalhoz (alphaTab beállítás, téma, WebSocket, sáv-választás)
(function () {
  const AT = alphaTab;

  const THEMES = {
    light: {
      staff: '#9aa0a8',
      glyph: '#16181d',
      secondary: '#5f6670',
      info: '#16181d',
      barNumber: '#c0392b',
    },
    dark: {
      staff: '#5d636d',
      glyph: '#e8eaee',
      secondary: '#a4abb6',
      info: '#e8eaee',
      barNumber: '#ff7a66',
    },
  };

  const PROFILES = {
    tab: AT.StaveProfile.Tab,
    scoretab: AT.StaveProfile.ScoreTab,
    score: AT.StaveProfile.Score,
  };

  function themeResources(theme) {
    const t = THEMES[theme] || THEMES.light;
    return {
      staffLineColor: t.staff,
      barSeparatorColor: t.staff,
      mainGlyphColor: t.glyph,
      secondaryGlyphColor: t.secondary,
      scoreInfoColor: t.info,
      barNumberColor: t.barNumber,
    };
  }

  // external: a kliens nem szintetizál hangot, a kurzort kívülről kapott idő mozgatja (lásd client.js)
  function create(container, viewport, { theme = 'light', scale = 1, profile = 'tab', external = false } = {}) {
    const playerSettings = external
      ? { playerMode: AT.PlayerMode.EnabledExternalMedia }
      : { enablePlayer: true, soundFont: '/lib/alphatab/soundfont/sonivox.sf2' };
    const api = new AT.AlphaTabApi(container, {
      core: { fontDirectory: '/lib/alphatab/font/' },
      display: {
        layoutMode: AT.LayoutMode.Page,
        staveProfile: PROFILES[profile] ?? PROFILES.tab,
        scale,
        resources: themeResources(theme),
      },
      player: {
        ...playerSettings,
        scrollElement: viewport,
        scrollMode: AT.ScrollMode.Continuous,
        scrollOffsetY: -40,
        enableCursor: true,
        enableAnimatedBeatCursor: true,
        enableElementHighlighting: true,
      },
    });
    return api;
  }

  function setTheme(api, theme) {
    // fillFromJson alakítja a szöveges színeket Color objektummá (közvetlen értékadás eltörné a megjelenítést)
    api.settings.fillFromJson({ display: { resources: themeResources(theme) } });
    api.updateSettings();
    api.render();
    document.documentElement.dataset.theme = theme;
  }

  // A dobsávnak nincs tabulatúrája: "Tab" nézetben üres maradna, ezért ott kottát mutatunk.
  function effectiveProfile(profile, track) {
    return track && track.isPercussion && profile === 'tab' ? 'score' : profile;
  }

  function applyProfile(api, profile, track) {
    api.settings.display.staveProfile = PROFILES[effectiveProfile(profile, track)] ?? PROFILES.tab;
    api.updateSettings();
  }

  function showTrack(api, track, profile) {
    applyProfile(api, profile, track);
    api.renderTracks([track]);
  }

  function setProfile(api, profile, track) {
    applyProfile(api, profile, track);
    api.render();
  }

  function setScale(api, scale) {
    api.settings.display.scale = scale;
    api.updateSettings();
    api.render();
  }

  // Kiválasztja a legjobban illő sávot egy korábban választott hangszer alapján.
  function pickTrack(score, pref) {
    const tracks = score.tracks;
    if (!pref) return tracks[0];
    const byName = tracks.find((t) => t.name === pref.name);
    if (byName) return byName;
    const byProgram = tracks.find(
      (t) => t.playbackInfo.program === pref.program && t.isPercussion === pref.isPercussion
    );
    return byProgram || tracks[0];
  }

  function trackPref(track) {
    return { name: track.name, program: track.playbackInfo.program, isPercussion: !!track.isPercussion };
  }

  function fmtTime(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function store(key, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      return null;
    }
  }

  // Újracsatlakozó WebSocket
  function connect(path, { onOpen, onClose, onMessage }) {
    let ws;
    let closed = false;
    const open = () => {
      ws = new WebSocket(`ws://${location.host}${path}`);
      ws.onopen = () => onOpen && onOpen();
      ws.onmessage = (e) => onMessage(JSON.parse(e.data));
      ws.onclose = () => {
        onClose && onClose();
        if (!closed) setTimeout(open, 1000);
      };
    };
    open();
    return {
      send: (msg) => ws && ws.readyState === 1 && ws.send(JSON.stringify(msg)),
      isOpen: () => !!ws && ws.readyState === 1,
      close: () => {
        closed = true;
        ws.close();
      },
    };
  }

  // ---- metronóm / beszámolás hangok (WebAudio) ----
  // a hangok azonosítói; a megjelenített nevük a nyelvi fájlból jön (click.<azonosító>)
  const SOUNDS = ['click', 'wood', 'cowbell', 'hat', 'beep'];

  function fillSoundSelect(el) {
    const current = el.value;
    el.innerHTML = '';
    for (const id of SOUNDS) el.add(new Option(i18n.t('click.' + id), id));
    if (current) el.value = current;
  }

  function createClicker() {
    let ctx = null;
    let noise = null;

    function ensure() {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state !== 'running') ctx.resume();
      return ctx;
    }

    function noiseBuffer(c) {
      if (!noise) {
        noise = c.createBuffer(1, Math.floor(c.sampleRate * 0.2), c.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      return noise;
    }

    // delaySec: pontos időzítés a WebAudio órán (a beszámolás ütései így nem csúsznak)
    function play(sound, accent, volume = 0.8, delaySec = 0) {
      const c = ensure();
      const t = c.currentTime + delaySec + 0.005;
      const peak = Math.max(0.0002, volume * (accent ? 1 : 0.6));
      const out = c.createGain();
      out.connect(c.destination);
      const envelope = (dur, level = peak) => {
        out.gain.setValueAtTime(0.0001, t);
        out.gain.exponentialRampToValueAtTime(level, t + 0.002);
        out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      };
      const osc = (type, freq, dur, dest = out) => {
        const o = c.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        o.connect(dest);
        o.start(t);
        o.stop(t + dur + 0.02);
        return o;
      };
      switch (sound) {
        case 'wood': {
          envelope(0.08);
          const o = osc('sine', accent ? 1250 : 900, 0.08);
          o.frequency.exponentialRampToValueAtTime(accent ? 800 : 600, t + 0.06);
          break;
        }
        case 'cowbell': {
          envelope(0.28, peak * 0.5);
          const bp = c.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.value = 800;
          bp.Q.value = 1;
          bp.connect(out);
          osc('square', accent ? 640 : 540, 0.28, bp);
          osc('square', accent ? 950 : 800, 0.28, bp);
          break;
        }
        case 'hat': {
          const dur = accent ? 0.09 : 0.045;
          envelope(dur);
          const src = c.createBufferSource();
          src.buffer = noiseBuffer(c);
          const hp = c.createBiquadFilter();
          hp.type = 'highpass';
          hp.frequency.value = 7000;
          src.connect(hp);
          hp.connect(out);
          src.start(t);
          src.stop(t + dur + 0.02);
          break;
        }
        case 'beep':
          envelope(0.09);
          osc('sine', accent ? 1320 : 880, 0.09);
          break;
        default: // click
          envelope(0.04);
          osc('triangle', accent ? 2000 : 1400, 0.04);
      }
    }

    // A hardver kimeneti késleltetése (mp). A kattintást ennyivel korábban ütemezzük, hogy a hallható pillanat egyezzen.
    const latency = () => (ctx ? ctx.outputLatency || ctx.baseLatency || 0 : 0);

    return { ensure, play, latency };
  }

  // ---- idő: óraszinkron, ütésrács, metronóm, beszámolás ----

  // Óraszinkron a szerverrel (NTP-szerű). now() = a szerver órája, ms-ban.
  // Sok mintából a legkisebb körbefordulási idejűeket használja: ezeket zavarta meg legkevésbé a hálózat.
  function createClock(send) {
    const samples = [];
    let offset = 0; // szerveridő - helyi idő
    let minRtt = null;
    let timers = [];

    const now = () => performance.now() + offset;
    const ping = () => send({ type: 'ping', t0: performance.now() });

    function onPong(m) {
      const t1 = performance.now();
      const rtt = t1 - m.t0;
      if (rtt < 0) return;
      samples.push({ rtt, off: m.ts - (m.t0 + rtt / 2), t1 });
      while (samples.length && t1 - samples[0].t1 > 20000) samples.shift();
      if (samples.length > 60) samples.shift();
      const best = [...samples].sort((a, b) => a.rtt - b.rtt).slice(0, 5);
      offset = best.reduce((sum, x) => sum + x.off, 0) / best.length;
      minRtt = best[0].rtt;
    }

    function start() {
      stop();
      let n = 0;
      const burst = setInterval(() => {
        ping();
        if (++n >= 14) clearInterval(burst);
      }, 40);
      timers = [burst, setInterval(ping, 1500)];
    }
    function stop() {
      timers.forEach(clearInterval);
      timers = [];
    }
    return { now, onPong, start, stop, ready: () => samples.length >= 4, rtt: () => minRtt };
  }

  // Ütésrács: minden lejátszott ütés ideje ms-ban 100%-os tempónál (ismétlések kibontva), a lejátszás sorrendjében.
  function buildGrid(api) {
    const lookup = api.tickCache;
    const grid = [];
    if (!lookup) return grid;
    let time = 0;
    for (const mb of lookup.masterBars) {
      const bar = mb.masterBar;
      const beatTicks = 3840 / bar.timeSignatureDenominator;
      const changes = mb.tempoChanges.length ? mb.tempoChanges : [{ tick: mb.start, tempo: 120 }];
      const msIn = (tick) => {
        let t = 0;
        let last = mb.start;
        let bpm = changes[0].tempo;
        for (const c of changes) {
          if (c.tick > tick) break;
          if (c.tick > last) {
            t += ((c.tick - last) * 60000) / (bpm * 960);
            last = c.tick;
          }
          bpm = c.tempo;
        }
        return t + ((tick - last) * 60000) / (bpm * 960);
      };
      for (let i = 0; i < bar.timeSignatureNumerator; i++) {
        const tick = mb.start + i * beatTicks;
        if (tick >= mb.end) break;
        grid.push({ t: time + msIn(tick), accent: i === 0 });
      }
      time += msIn(mb.end);
    }
    return grid;
  }

  // Az adott tickhez tartozó ütem üteme és tempója (a beszámoláshoz).
  function barInfoAt(api, tick) {
    const mbs = api.tickCache.masterBars;
    const mb = mbs.find((m) => tick >= m.start && tick < m.end) || mbs[0];
    let bpm = mb.tempoChanges.length ? mb.tempoChanges[0].tempo : 120;
    for (const c of mb.tempoChanges) if (c.tick <= tick) bpm = c.tempo;
    const bar = mb.masterBar;
    return { beats: bar.timeSignatureNumerator, denominator: bar.timeSignatureDenominator, bpm };
  }

  // Ütés hossza ezredmásodpercben (az ütem nevezője szerinti egység, a tempó szorzóval)
  function beatMs(info, speed) {
    return ((60000 / info.bpm) * (4 / info.denominator)) / (speed || 1);
  }

  // Metronóm: az idővonal alapján előre (WebAudio órán) ütemezi az ütéseket, ezért minden eszközön ugyanabban a pillanatban szól.
  // opts: clock, clicker, getTimeline() -> {playing,pos,at,speed}, getGrid(), getCfg() -> {metro,sound,vol}, getShift() -> ms
  function createMetronome(opts) {
    const HORIZON = 140; // ms-nyi előreütemezés
    let scheduledUpTo = -Infinity; // dal-idő (ms), eddig ütemeztünk
    let wasPlaying = false;

    function tick() {
      const tl = opts.getTimeline();
      const cfg = opts.getCfg();
      const grid = opts.getGrid();
      if (!tl || !tl.playing || !cfg.metro || !grid.length) {
        wasPlaying = false;
        return;
      }
      const speed = tl.speed || 1;
      const pos = tl.pos + (opts.clock.now() - tl.at) + opts.getShift();
      if (!wasPlaying || pos < scheduledUpTo - 500 || pos > scheduledUpTo + 1000) scheduledUpTo = pos - 1;
      wasPlaying = true;

      // az első ütés, ami már nem lett ütemezve (bináris keresés)
      let lo = 0;
      let hi = grid.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (grid[mid].t / speed > scheduledUpTo) hi = mid;
        else lo = mid + 1;
      }
      const lat = opts.clicker.latency() * 1000;
      for (let i = lo; i < grid.length; i++) {
        const beatPos = grid[i].t / speed;
        if (beatPos > pos + HORIZON) break;
        const delay = beatPos - pos - lat;
        scheduledUpTo = beatPos;
        if (delay < -25) continue; // már elkésett
        opts.clicker.play(cfg.sound, grid[i].accent, cfg.vol, Math.max(0, delay) / 1000);
      }
    }
    const timer = setInterval(tick, 25);
    return { stop: () => clearInterval(timer) };
  }

  // Beszámolás: startAt = a zenei kezdés ideje szerveridőben. Az ütések ebből, abszolút időben ütemeződnek.
  function runCountIn(el, clock, clicker, m, audio) {
    const timers = [];
    const lat = clicker.latency() * 1000;
    for (let i = 0; i < m.beats; i++) {
      const delay = m.startAt - (m.beats - i) * m.beatMs - clock.now();
      if (delay < -m.beatMs / 2) continue; // már elmúlt
      timers.push(
        setTimeout(() => {
          el.textContent = String(i + 1);
          el.className = 'countin show' + (i % m.perBar === 0 ? ' first' : '');
        }, Math.max(0, delay))
      );
      if (audio) clicker.play(audio.sound, i % m.perBar === 0, audio.vol, Math.max(0, delay - lat) / 1000);
    }
    timers.push(setTimeout(() => (el.className = 'countin'), Math.max(0, m.startAt - clock.now())));
    return () => {
      timers.forEach(clearTimeout);
      el.className = 'countin';
    };
  }

  window.SyncView = {
    create, setTheme, setProfile, showTrack, setScale, pickTrack, trackPref, fmtTime, store, connect,
    fillSoundSelect, createClicker, createClock, buildGrid, barInfoAt, beatMs, createMetronome, runCountIn,
  };
})();
