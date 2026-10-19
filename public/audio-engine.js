// Opcionális hang a kliensen: egy láthatatlan, élő szintetizátor (alphaTab) a kiválasztott sávot szólaltatja meg,
// és a közös idővonalhoz van igazítva. A látható tab ettől függetlenül, külső időforrással mozog (pontosabb).
//
// Hallható pozíció = az alphaTab által jelentett (a hangkártya által már felhasznált) pozíció - kimeneti késés.
// Indításkor a pozíciót előre kell állítani a rajtkéséssel + kimeneti késéssel, eltérésnél (drift) újra kell pozicionálni.
(function () {
  const AT = alphaTab;
  const CHECK_MS = 100;
  const TOLERANCE = 25; // ms: ennél nagyobb eltérésnél újrapozicionálunk
  const SETTLE_MS = 700; // indítás után ennyit várunk az első ellenőrzésig
  const MIN_RESEEK_MS = 1500;

  function createAudioEngine({ clock, clicker, getTimeline, getShift, onStatus }) {
    let api = null;
    let ready = false;
    let enabled = false;
    let volume = 0.8;
    let audible = new Set([0]); // hallható sávok (indexek)
    let solos = new Set(); // szólózott sávok: ha van, csak ezek szólnak
    let bytes = null;
    let endTime = Infinity;

    let lastEv = null; // {w: helyi idő, t: jelentett pozíció}
    let call = null; // {at, pos, starts[]} az indítás mérése
    let startedAt = 0;
    let lastSeek = 0;
    let bad = 0;
    let coldStart = true;
    const startSamples = (SyncView.store('client.audioStartSamples') || []).slice(-5);
    const median = (a) => [...a].sort((x, y) => x - y)[(a.length - 1) >> 1];
    let startLatency = startSamples.length ? median(startSamples) : 25;
    let lastErr = null;

    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px;height:1px;overflow:hidden;pointer-events:none';
    document.body.appendChild(host);

    const status = (s) => onStatus && onStatus(s);
    const latencyMs = () => clicker.latency() * 1000;

    function ensureApi() {
      if (api) return;
      status('sound.loading');
      api = new AT.AlphaTabApi(host, {
        core: { fontDirectory: '/lib/alphatab/font/' },
        display: { layoutMode: AT.LayoutMode.Page },
        player: {
          enablePlayer: true,
          soundFont: '/lib/alphatab/soundfont/sonivox.sf2',
          enableCursor: false,
          enableAnimatedBeatCursor: false,
          enableElementHighlighting: false,
          scrollMode: AT.ScrollMode.Off,
        },
      });
      api.playerReady.on(() => {
        ready = true;
        applyMix();
        status('');
      });
      api.playerPositionChanged.on((e) => {
        endTime = e.endTime;
        const w = performance.now();
        lastEv = { w, t: e.currentTime };
        if (call && !e.isSeek) {
          call.starts.push(w - (e.currentTime - call.pos)); // mikor indult a hang (helyi idő)
          if (call.starts.length >= 6) finishStartMeasure();
        }
      });
      if (bytes) api.load(bytes.slice());
    }

    function finishStartMeasure() {
      const L = Math.min(...call.starts) - call.at;
      call = null;
      if (coldStart) {
        coldStart = false; // az első indítás lassabb (hideg hangmotor)
        return;
      }
      if (L > 0 && L < 600) {
        startSamples.push(L);
        if (startSamples.length > 5) startSamples.shift();
        startLatency = median(startSamples);
        SyncView.store('client.audioStartSamples', startSamples);
      }
    }

    function applyMix() {
      if (!api || !api.score) return;
      const anySolo = solos.size > 0;
      api.score.tracks.forEach((t, i) => {
        const on = anySolo ? solos.has(i) : audible.has(i);
        api.changeTrackMute([t], !on);
      });
      api.masterVolume = volume;
    }

    // a hallgatandó pozíció a helyi `w` pillanatban (idővonal + kézi korrekció)
    function desired(tl, w) {
      return tl.pos + (clock.now() + (w - performance.now()) - tl.at) + getShift();
    }

    function control() {
      if (!api || !ready) return;
      const tl = getTimeline();
      const playing = api.playerState === AT.synth.PlayerState.Playing;
      const want = enabled && tl && tl.playing;
      if (!want) {
        if (playing) api.pause();
        call = null;
        startedAt = 0;
        bad = 0;
        return;
      }
      const speed = tl.speed || 1;
      if (api.playbackSpeed !== speed) api.playbackSpeed = speed;
      const now = performance.now();
      const lat = latencyMs();

      if (!playing) {
        if (desired(tl, now) >= endTime - 50) return; // a dal vége
        if (startedAt && now - startedAt < 1200) return; // épp indul
        // a hangnak a (rajtkésés + kimeneti késés) múlva kell a helyes pozíciónál szólnia
        const pos = Math.max(0, desired(tl, now) + startLatency + lat);
        api.timePosition = pos;
        call = { at: now, pos, starts: [] };
        startedAt = now;
        lastSeek = now;
        bad = 0;
        api.play();
        return;
      }

      if (!lastEv || now - startedAt < SETTLE_MS) return;
      const audible = lastEv.t + (now - lastEv.w) - lat;
      const err = audible - desired(tl, now);
      lastErr = err;
      bad = Math.abs(err) > TOLERANCE ? bad + 1 : 0;
      if (bad >= 2 && now - lastSeek > MIN_RESEEK_MS) {
        // a jelentett pozíciónak a hallható + kimeneti késés kell legyen
        api.timePosition = Math.max(0, desired(tl, now) + lat);
        lastSeek = now;
        bad = 0;
      }
    }
    setInterval(control, CHECK_MS);

    return {
      setEnabled(on) {
        enabled = !!on;
        if (enabled) ensureApi();
        else if (api && api.playerState === AT.synth.PlayerState.Playing) api.pause();
      },
      setVolume(v) {
        volume = v;
        if (api && ready) api.masterVolume = v;
      },
      // a sávok keverése: hallható sávok + szólók (indexek halmaza)
      setMix(audibleSet, soloSet) {
        audible = new Set(audibleSet);
        solos = new Set(soloSet);
        applyMix();
      },
      load(data) {
        bytes = data;
        ready = false;
        lastEv = null;
        startedAt = 0;
        call = null;
        if (api) {
          api.stop();
          api.load(bytes.slice());
        }
      },
      isReady: () => ready,
      api: () => api, // csak diagnosztikához
      debug: () => ({ ready, state: api && api.playerState, err: lastErr, startLatency, lat: latencyMs() }),
    };
  }

  window.SyncView.createAudioEngine = createAudioEngine;
})();
