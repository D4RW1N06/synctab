(function () {
  const {
    create, setTheme, setProfile, showTrack, setScale, pickTrack, trackPref, store, connect,
    fillSoundSelect, createClicker, createClock, buildGrid, createMetronome, runCountIn,
  } = SyncView;
  const $ = (id) => document.getElementById(id);
  const AT = alphaTab;
  const tr = (key, params) => i18n.t(key, params);

  let theme = store('client.theme') || 'light';
  let scale = store('client.scale') || 1;
  let profile = store('client.profile') || 'tab';
  let pref = store('client.trackPref'); // utoljára választott hangszer
  let shift = store('client.shift') ?? 0; // ms, kézi finomhangolás (+ = előbbre hozza a kurzort és a kattintást)
  const clickCfg = Object.assign({ metro: false, sound: 'click', vol: 0.8, countAudio: false }, store('client.click'));
  const saveClickCfg = () => store('client.click', clickCfg);
  $('profile').value = profile;
  document.documentElement.dataset.theme = theme;

  // A kliens nem szintetizál hangot: az alphaTab "külső időforrás" módban van, a kurzort az idővonalból számolt idő mozgatja.
  const api = create($('score'), $('viewport'), { theme, scale, profile, external: true });
  window.synctab = { api };
  let endTime = Infinity;
  const handler = {
    get backingTrackDuration() {
      return Number.isFinite(endTime) ? endTime : 0;
    },
    playbackRate: 1,
    masterVolume: 1,
    seekTo() {},
    play() {},
    pause() {},
  };

  const clicker = createClicker();
  window.synctab.clicker = clicker;
  let soundOn = !!store('client.sound');
  let soundVol = store('client.soundVol') ?? 0.8;

  let currentSongId = null;
  let selectedTrack = null;
  // hangkeverés: a hallható sávok és a szólók (sávindexek). Amíg a felhasználó nem nyúl hozzá, a saját sáv szól.
  let audible = new Set();
  let solos = new Set();
  let mixCustom = false;
  let playerReady = false;
  let loading = false;
  let grid = [];
  let tl = null; // az idővonal aktuális horgonya: {songId, playing, pos, at (szerveridő), speed}
  let rev = 0;
  let seekedRev = -1;
  let ws = null;
  let deviceName = '';
  let cancelCountIn = null;

  const clock = createClock((m) => ws && ws.send(m));

  // ---- feliratok, amelyek állapottól függenek (nyelvváltáskor újra kell rajzolni) ----
  let titleText = null; // a betöltött dal címe
  let soundStatusKey = '';
  const renderTitle = () => ($('title').textContent = titleText || tr('client.waiting'));
  const renderSoundStatus = () => ($('sound-status').textContent = soundStatusKey ? tr(soundStatusKey) : '');
  const timelineIfReady = () => (tl && clock.ready() && tl.songId === currentSongId ? tl : null);
  const engine = SyncView.createAudioEngine({
    clock,
    clicker,
    getTimeline: timelineIfReady,
    getShift: () => shift,
    onStatus: (key) => {
      soundStatusKey = key;
      renderSoundStatus();
    },
  });
  window.synctab.engine = engine;
  engine.setVolume(soundVol);
  engine.setEnabled(soundOn);

  $('name').value = store('client.name') || '';
  $('go').onclick = () => {
    deviceName = $('name').value.trim() || tr('common.device');
    store('client.name', deviceName); // csak az előtöltéshez; a küldött név a változóból jön (több lap ugyanabban a böngészőben)
    $('join').classList.add('hidden');
    clicker.ensure(); // a koppintás engedélyezi a böngészőben a hangot
    ws = connect('/ws', {
      onOpen: () => {
        $('conn').classList.add('ok');
        clock.start();
        sendProfile();
      },
      onClose: () => {
        $('conn').classList.remove('ok');
        clock.stop();
      },
      onMessage: (m) => {
        if (m.type === 'pong') clock.onPong(m);
        else if (m.type === 'hello') onTimeline(m.timeline);
        else if (m.type === 'timeline') onTimeline(m);
        else if (m.type === 'countin') countIn(m);
      },
    });
    setInterval(sendProfile, 5000);
    setInterval(showSyncStatus, 1000);
  };
  $('name').addEventListener('keydown', (e) => e.key === 'Enter' && $('go').click());

  function sendProfile() {
    ws && ws.send({ type: 'profile', name: deviceName, track: selectedTrack ? selectedTrack.name : null, rtt: clock.rtt() });
  }
  function showSyncStatus() {
    $('sync-status').textContent = clock.ready() ? tr('sync.ok', { ms: clock.rtt().toFixed(1) }) : tr('sync.tuning');
  }

  // ---- beszámolás ----
  function countIn(m) {
    if (cancelCountIn) cancelCountIn();
    cancelCountIn = null;
    if (m.cancel || !m.beats || !clock.ready()) return;
    cancelCountIn = runCountIn($('countin-view'), clock, clicker, m, clickCfg.countAudio ? clickCfg : null);
  }

  // ---- idővonal ----
  const songPos = () => (tl.playing ? tl.pos + (clock.now() - tl.at) : tl.pos) + shift;

  function onTimeline(m) {
    if (!m) return;
    const next = { ...m, rev: ++rev };
    // Kis eltérést (zaj) simítunk, nagyot (ugrás, keresés) azonnal átveszünk.
    if (tl && tl.songId === m.songId && tl.playing && m.playing && tl.speed === m.speed && clock.ready()) {
      const nowS = clock.now();
      const oldPos = tl.pos + (nowS - tl.at);
      const d = m.pos + (nowS - m.at) - oldPos;
      if (Math.abs(d) < 30) {
        next.at = nowS;
        next.pos = oldPos + d * 0.3;
        next.rev = tl.rev;
      }
    }
    tl = next;
    ensureSong();
  }

  async function ensureSong() {
    if (!tl || tl.songId === currentSongId || loading) return;
    loading = true;
    playerReady = false;
    api.stop();
    currentSongId = tl.songId;
    if (currentSongId == null) {
      $('empty').classList.remove('hidden');
      titleText = null;
      renderTitle();
      loading = false;
      return;
    }
    const res = await fetch(`/songs/${encodeURIComponent(currentSongId)}`);
    const data = new Uint8Array(await res.arrayBuffer());
    api.load(data.slice());
    engine.load(data);
    loading = false;
    ensureSong(); // közben másik dalt választhattak
  }

  // ---- megjelenítés: minden képkockán a szinkronizált időből ----
  function frame() {
    requestAnimationFrame(frame);
    if (!playerReady || !tl || tl.songId !== currentSongId) return;
    const speed = tl.speed || 1;
    if (api.playbackSpeed !== speed) api.playbackSpeed = speed;

    if (tl.playing) {
      if (!clock.ready()) return; // a szerveridő még nem pontos
      const t = songPos();
      if (t >= endTime) return; // a dal vége: a mastertől jön a leállítás
      if (api.playerState !== AT.synth.PlayerState.Playing) api.play();
      api.player.output.updatePosition(Math.max(0, t));
    } else {
      if (api.playerState === AT.synth.PlayerState.Playing) api.pause();
      if (seekedRev !== tl.rev) {
        seekedRev = tl.rev;
        api.timePosition = Math.max(0, tl.pos);
      }
    }
  }
  requestAnimationFrame(frame);

  // ---- alphaTab események ----
  api.scoreLoaded.on((score) => {
    $('empty').classList.add('hidden');
    titleText = [score.artist, score.title].filter(Boolean).join(' – ');
    renderTitle();
    const sel = $('track');
    sel.innerHTML = '';
    score.tracks.forEach((t, i) => {
      const o = document.createElement('option');
      o.value = i;
      o.textContent = `${i + 1}. ${t.name}`;
      sel.appendChild(o);
    });
    sel.disabled = false;
    selectedTrack = pickTrack(score, pref);
    sel.value = score.tracks.indexOf(selectedTrack);
    showTrack(api, selectedTrack, profile);
    initMix(score);
    sendProfile();
  });
  api.playerReady.on(() => {
    api.player.handler = handler;
    grid = buildGrid(api);
    seekedRev = -1;
    playerReady = true;
  });
  api.playerPositionChanged.on((e) => {
    endTime = e.endTime;
  });

  createMetronome({
    clock,
    clicker,
    getTimeline: timelineIfReady,
    getGrid: () => grid,
    getCfg: () => clickCfg,
    getShift: () => shift,
  });

  // ---- vezérlők ----
  $('track').onchange = (e) => {
    selectedTrack = api.score.tracks[Number(e.target.value)];
    pref = trackPref(selectedTrack);
    store('client.trackPref', pref);
    showTrack(api, selectedTrack, profile);
    if (!mixCustom) {
      audible = new Set([Number(e.target.value)]);
      renderMix();
    }
    seekedRev = -1; // az új nézetben is a pontos helyre álljon a kurzor
    sendProfile();
  };
  $('profile').onchange = (e) => {
    profile = e.target.value;
    store('client.profile', profile);
    setProfile(api, profile, selectedTrack);
    seekedRev = -1;
  };
  $('zoomIn').onclick = () => zoom(0.1);
  $('zoomOut').onclick = () => zoom(-0.1);
  function zoom(d) {
    scale = Math.min(2.5, Math.max(0.5, Math.round((scale + d) * 10) / 10));
    store('client.scale', scale);
    setScale(api, scale);
    seekedRev = -1;
  }
  $('theme').onclick = () => {
    theme = theme === 'light' ? 'dark' : 'light';
    store('client.theme', theme);
    setTheme(api, theme);
    seekedRev = -1;
  };

  // Android appban (WebView) elérhető a natív híd: vissza a master-választóhoz
  if (window.SyncTabApp) {
    $('switch-server').classList.remove('hidden');
    $('switch-server').onclick = () => window.SyncTabApp.disconnect();
  }

  // ---- hangkeverés (sávonként hallható + szóló) ----
  function initMix(score) {
    const saved = store('client.mix'); // {audible: [sávnevek], solos: [sávnevek]} ha egyéni
    const names = score.tracks.map((t) => t.name);
    const idx = (list) => new Set((list || []).map((n) => names.indexOf(n)).filter((i) => i >= 0));
    if (saved && idx(saved.audible).size + idx(saved.solos).size > 0) {
      mixCustom = true;
      audible = idx(saved.audible);
      solos = idx(saved.solos);
    } else {
      mixCustom = false;
      audible = new Set([score.tracks.indexOf(selectedTrack)]);
      solos = new Set();
    }
    renderMix();
  }

  function renderMix() {
    const ul = $('mix');
    ul.innerHTML = '';
    const tracks = api.score ? api.score.tracks : [];
    tracks.forEach((t, i) => {
      const li = document.createElement('li');
      li.innerHTML = '<label class="name"><input type="checkbox"> <span></span></label><button data-a="solo" data-i18n-title="mix.solo">S</button>';
      li.querySelector('span').textContent = (i + 1) + '. ' + t.name;
      const box = li.querySelector('input');
      box.checked = audible.has(i);
      box.onchange = () => {
        box.checked ? audible.add(i) : audible.delete(i);
        mixChanged();
      };
      const solo = li.querySelector('button');
      solo.classList.toggle('on', solos.has(i));
      solo.onclick = () => {
        solos.has(i) ? solos.delete(i) : solos.add(i);
        solo.classList.toggle('on', solos.has(i));
        mixChanged();
      };
      ul.appendChild(li);
    });
    i18n.apply(ul);
    applyMix();
  }

  function mixChanged() {
    mixCustom = true;
    const names = (set) => [...set].map((i) => api.score.tracks[i].name);
    store('client.mix', { audible: names(audible), solos: names(solos) });
    applyMix();
  }

  function applyMix() {
    engine.setMix(audible, solos);
    // szóló mellett a pipák nem számítanak: jelezzük
    $('mix').classList.toggle('soloing', solos.size > 0);
  }

  // ---- nyelv ----
  i18n.bindSelect($('lang'));
  i18n.bindSelect($('lang-join'));
  i18n.onChange(() => {
    renderTitle();
    renderSoundStatus();
    showSyncStatus();
    fillSoundSelect($('sound-type'));
    $('sound-type').value = clickCfg.sound;
  });
  renderTitle();
  showSyncStatus();

  // ---- beállítások panel ----
  $('settings').onclick = (e) => {
    e.stopPropagation();
    $('panel').classList.toggle('hidden');
  };
  document.addEventListener('click', (e) => {
    if (!$('panel').contains(e.target)) $('panel').classList.add('hidden');
  });
  fillSoundSelect($('sound-type'));
  $('sound-type').value = clickCfg.sound;
  $('click-vol').value = Math.round(clickCfg.vol * 100);
  $('metro').checked = clickCfg.metro;
  $('countin-audio').checked = clickCfg.countAudio;
  $('shift').value = shift;
  $('shift-val').textContent = `${shift} ms`;
  $('sound').checked = soundOn;
  $('sound-vol').value = Math.round(soundVol * 100);
  $('sound').onchange = (e) => {
    soundOn = e.target.checked;
    store('client.sound', soundOn);
    clicker.ensure(); // a böngésző csak felhasználói kattintás után enged hangot
    engine.setEnabled(soundOn);
  };
  $('sound-vol').oninput = (e) => {
    soundVol = Number(e.target.value) / 100;
    store('client.soundVol', soundVol);
    engine.setVolume(soundVol);
  };
  $('metro').onchange = (e) => {
    clickCfg.metro = e.target.checked;
    saveClickCfg();
    clicker.ensure();
  };
  $('countin-audio').onchange = (e) => {
    clickCfg.countAudio = e.target.checked;
    saveClickCfg();
    clicker.ensure();
  };
  $('sound-type').onchange = (e) => {
    clickCfg.sound = e.target.value;
    saveClickCfg();
    clicker.play(clickCfg.sound, true, clickCfg.vol); // próba
  };
  $('click-vol').oninput = (e) => {
    clickCfg.vol = Number(e.target.value) / 100;
    saveClickCfg();
  };
  $('click-vol').onchange = () => clicker.play(clickCfg.sound, false, clickCfg.vol);
  $('shift').oninput = (e) => {
    shift = Number(e.target.value);
    $('shift-val').textContent = `${shift} ms`;
    store('client.shift', shift);
  };
})();
