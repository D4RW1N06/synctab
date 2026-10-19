(function () {
  const {
    create, setTheme, setProfile, showTrack, setScale, fmtTime, store, connect,
    fillSoundSelect, createClicker, createClock, buildGrid, barInfoAt, beatMs, createMetronome, runCountIn,
  } = SyncView;
  const $ = (id) => document.getElementById(id);
  const AT = alphaTab;
  const tr = (key, params) => i18n.t(key, params);

  let theme = store('master.theme') || 'light';
  let scale = store('master.scale') || 1;
  let profile = store('master.profile') || 'tab';
  $('profile').value = profile;

  const api = create($('score'), $('viewport'), { theme, scale, profile });
  document.documentElement.dataset.theme = theme;
  window.synctab = { api };

  // metronóm + beszámolás hangja
  const clicker = createClicker();
  window.synctab.clicker = clicker;
  const clickCfg = Object.assign({ metro: false, sound: 'click', vol: 0.8, countin: 0 }, store('master.click'));
  const saveClickCfg = () => store('master.click', clickCfg);
  fillSoundSelect($('sound-type'));
  $('sound-type').value = clickCfg.sound;
  $('click-vol').value = Math.round(clickCfg.vol * 100);
  $('metro').checked = clickCfg.metro;
  $('countin').value = String(clickCfg.countin);

  let songs = [];
  let cancelCountIn = null; // a futó beszámolás megszakítója
  let currentId = null;
  let selectedTrack = null;
  let playerReady = false;
  let grid = []; // ütésrács a metronómhoz

  const isPlaying = () => api.playerState === AT.synth.PlayerState.Playing;

  // ---- feliratok, amelyek állapottól függenek (nyelvváltáskor újra kell rajzolni) ----
  let titleText = null; // a betöltött dal címe
  let clockMs = null; // az óraszinkron késése, ha már kész
  let langDir = '';
  const renderTitle = () => ($('title').textContent = titleText || tr('master.noSong'));
  function renderSyncInfo() {
    $('sync-info').textContent = clockMs == null ? tr('sync.connecting') : tr('sync.clockOk', { ms: clockMs });
  }
  const renderLangHint = () => ($('lang-hint').textContent = langDir ? tr('lang.customHint', { path: langDir }) : '');

  // ---- szerver kapcsolat + óra ----
  const clock = createClock((m) => ws.send(m));
  const ws = connect('/ws?role=master', {
    onOpen: () => {
      $('conn').classList.add('ok');
      clock.start();
    },
    onClose: () => {
      $('conn').classList.remove('ok');
      clock.stop();
    },
    onMessage: (m) => {
      if (m.type === 'pong') {
        clock.onPong(m);
        if (clock.ready()) {
          clockMs = clock.rtt().toFixed(1);
          renderSyncInfo();
          if (!tlOut) emit(false, api.timePosition || 0); // első horgony
        }
      } else if (m.type === 'hello' || m.type === 'songs') {
        songs = m.songs;
        renderSongs();
      } else if (m.type === 'roster') renderClients(m.clients);
    },
  });

  // ---- idővonal: a master a hallható pozíciót adja közre szerveridőben ----
  // Az alphaTab pozícióeseményei késve érkezhetnek, de soha nem korán, ezért az utolsó minták közül
  // a nagyobbik értékeket (2. legnagyobb) tekintjük igaznak. Így a feldolgozási jitter kiesik.
  let seq = 0;
  let tlOut = null; // az utoljára közölt horgony (a metronóm is ezt használja)
  let est = []; // minták: pos - szerveridő
  let lastEmit = 0;
  let playCall = null; // az api.play() hívás ideje a rajtkésés méréséhez
  // api.play() -> a zene (kimeneti késés nélküli) indulása. Az első, hideg indítás lassabb, ezért az utolsó mérések mediánját használjuk.
  const startSamples = store('master.startSamples') || [];
  const median = (a) => [...a].sort((x, y) => x - y)[(a.length - 1) >> 1]; // páros számnál az alsó: a hideg indítás kiugró
  let startLatency = startSamples.length ? median(startSamples) : 15;
  let coldStart = true; // az első indítás az oldal betöltése után lassabb (hideg hangmotor), nem használjuk a méréshez
  let audioOffset = store('master.audioOffset') ?? 0; // ms, kézi finomhangolás

  const latencyMs = () => clicker.latency() * 1000 + audioOffset;
  const estimate = () => {
    const sorted = [...est].sort((a, b) => b - a);
    return sorted[Math.min(1, sorted.length - 1)];
  };

  function emit(playing, pos, at = clock.now()) {
    if (!clock.ready()) return;
    tlOut = { type: 'timeline', songId: currentId, playing, pos, at, speed: api.playbackSpeed, seq: ++seq };
    ws.send(tlOut);
    lastEmit = at;
  }

  // Az alphaTab az eseményeket kötegelve küldi (a köteg első tagja késik), ezért az első néhány esemény
  // legkorábbi "indulás" értékét tekintjük igaznak.
  function measureStartLatency(e, at) {
    if (!playCall) return;
    playCall.starts.push(at - (e.currentTime - playCall.pos)); // mikor indult tényleg a zene (szerveridő)
    if (playCall.starts.length < 6) return;
    const L = Math.min(...playCall.starts) - playCall.at;
    playCall = null;
    if (coldStart) {
      coldStart = false;
      return;
    }
    if (L > 0 && L < 600) {
      startSamples.push(L);
      if (startSamples.length > 5) startSamples.shift();
      startLatency = median(startSamples);
      store('master.startSamples', startSamples);
    }
  }

  function callPlay() {
    playCall = { at: clock.now(), pos: api.timePosition || 0, starts: [] };
    api.play();
  }

  // ---- alphaTab események ----
  api.scoreLoaded.on((score) => {
    titleText = [score.artist, score.title].filter(Boolean).join(' – ') || currentId;
    renderTitle();
    $('empty').classList.add('hidden');
    renderTracks(score);
    selectedTrack = score.tracks[0];
    showTrack(api, selectedTrack, profile);
  });
  api.playerReady.on(() => {
    playerReady = true;
    $('play').disabled = false;
    grid = buildGrid(api);
    applyAudio();
    emit(false, 0);
  });
  api.playerStateChanged.on(() => {
    updatePlayButton();
    if (isPlaying()) {
      est = []; // a horgony az első valódi pozícióeseménnyel jön
      lastEmit = 0;
    } else {
      emit(false, api.timePosition || 0);
    }
  });
  api.playerPositionChanged.on((e) => {
    $('time').textContent = fmtTime(e.currentTime) + ' / ' + fmtTime(e.endTime);
    if (!clock.ready()) return;
    if (!isPlaying()) {
      if (e.isSeek) emit(false, e.currentTime); // kattintás a tabra szünetben
      return;
    }
    const at = clock.now();
    const off = e.currentTime - at - latencyMs();
    const jump = est.length > 0 && Math.abs(off - estimate()) > 60; // ugrás (ismétlés, keresés)
    if (e.isSeek || jump) est = [];
    est.push(off);
    if (est.length > 24) est.shift();
    measureStartLatency(e, at);
    if (est.length === 1 || at - lastEmit > 400) emit(true, at + estimate(), at);
  });

  createMetronome({
    clock,
    clicker,
    getTimeline: () => tlOut,
    getGrid: () => grid,
    getCfg: () => clickCfg,
    getShift: () => 0,
  });

  // ---- dalok ----
  function renderSongs() {
    const ul = $('songs');
    ul.innerHTML = '';
    if (!songs.length) ul.innerHTML = '<li class="muted" data-i18n="songs.none"></li>';
    for (const s of songs) {
      const li = document.createElement('li');
      li.className = s.id === currentId ? 'active' : '';
      li.innerHTML = '<span class="name"></span><button class="x" data-i18n-title="songs.delete">✕</button>';
      li.querySelector('.name').textContent = s.name;
      li.onclick = () => loadSong(s.id);
      li.querySelector('.x').onclick = async (e) => {
        e.stopPropagation();
        if (confirm(tr('songs.confirmDelete', { name: s.name }))) await fetch(`/api/songs/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
      };
      ul.appendChild(li);
    }
    i18n.apply(ul);
  }

  async function loadSong(id) {
    abortCountIn();
    api.stop();
    playerReady = false;
    $('play').disabled = true;
    currentId = id;
    emit(false, 0);
    renderSongs();
    const res = await fetch(`/songs/${encodeURIComponent(id)}`);
    api.load(new Uint8Array(await res.arrayBuffer()));
  }

  async function upload(files) {
    let first = null;
    for (const f of files) {
      const res = await fetch(`/api/songs/${encodeURIComponent(f.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: await f.arrayBuffer(),
      });
      if (res.ok && !first) first = (await res.json()).id;
    }
    if (first && !currentId) loadSong(first);
  }
  $('pick').onclick = () => $('file').click();
  $('file').onchange = (e) => {
    upload([...e.target.files]);
    e.target.value = '';
  };
  const drop = $('drop');
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  window.addEventListener('dragleave', () => drop.classList.remove('over'));
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    upload([...e.dataTransfer.files].filter((f) => /\.(gp|gp3|gp4|gp5|gpx)$/i.test(f.name)));
  });

  // ---- sávok (megjelenítés + hang a master gépen) ----
  const mutes = new Set();
  const solos = new Set();

  function renderTracks(score) {
    mutes.clear();
    solos.clear();
    const ul = $('tracks');
    ul.innerHTML = '';
    score.tracks.forEach((t, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="name"></span><button data-a="show" data-i18n-title="tracks.show">👁</button><button data-a="mute" data-i18n-title="tracks.mute">M</button><button data-a="solo" data-i18n-title="tracks.solo">S</button>`;
      li.querySelector('.name').textContent = `${i + 1}. ${t.name}`;
      li.onclick = (e) => {
        const a = e.target.dataset.a;
        if (a === 'show') {
          selectedTrack = t;
          showTrack(api, t, profile);
          markShown();
        } else if (a === 'mute') {
          toggle(mutes, i);
          e.target.classList.toggle('on', mutes.has(i));
          applyAudio();
        } else if (a === 'solo') {
          toggle(solos, i);
          e.target.classList.toggle('on', solos.has(i));
          applyAudio();
        }
      };
      ul.appendChild(li);
    });
    i18n.apply(ul);
    markShown();
  }
  const toggle = (set, v) => (set.has(v) ? set.delete(v) : set.add(v));
  function markShown() {
    if (!api.score) return;
    [...$('tracks').children].forEach((li, i) =>
      li.querySelector('[data-a=show]').classList.toggle('on', api.score.tracks[i] === selectedTrack)
    );
  }

  function applyAudio() {
    if (!api.score) return;
    const all = api.score.tracks;
    const soundOn = $('sound').checked;
    const anySolo = solos.size > 0;
    all.forEach((t, i) => {
      const audible = soundOn && !mutes.has(i) && (!anySolo || solos.has(i));
      api.changeTrackMute([t], !audible);
    });
  }

  // ---- vezérlők ----
  // ---- lejátszás beszámolással ----
  function updatePlayButton() {
    const playing = api.playerState === AT.synth.PlayerState.Playing;
    $('play').textContent = cancelCountIn ? tr('master.countingIn') : playing ? tr('master.pause') : tr('master.play');
  }

  function abortCountIn() {
    if (!cancelCountIn) return false;
    cancelCountIn();
    cancelCountIn = null;
    ws.send({ type: 'countin', cancel: true });
    updatePlayButton();
    return true;
  }

  const COUNTIN_LEAD = 350; // ms: ennyi idő van, hogy a kliensek megkapják a beszámolás üzenetét

  function togglePlay() {
    if (!playerReady) return;
    clicker.ensure(); // a böngésző csak felhasználói kattintás után engedi a hangot
    if (abortCountIn()) return;
    if (isPlaying()) return api.pause();
    const bars = clickCfg.countin;
    if (!bars || !clock.ready()) return callPlay();

    const info = barInfoAt(api, api.tickPosition);
    const beats = info.beats * bars;
    const ms = beatMs(info, api.playbackSpeed);
    const startAt = clock.now() + COUNTIN_LEAD + beats * ms; // a zene hallható kezdete, szerveridőben
    const m = { type: 'countin', beats, perBar: info.beats, beatMs: ms, startAt };
    ws.send(m);
    const cancelVisual = runCountIn($('countin-view'), clock, clicker, m, clickCfg);
    // az api.play() a mért rajtkéséssel korábban hívódik, hogy a zene pont startAt-kor szóljon
    const playIn = startAt - startLatency - latencyMs() - clock.now();
    const timer = setTimeout(() => {
      cancelCountIn = null;
      callPlay();
    }, Math.max(0, playIn));
    cancelCountIn = () => {
      clearTimeout(timer);
      cancelVisual();
    };
    updatePlayButton();
  }

  $('play').onclick = togglePlay;
  $('stop').onclick = () => {
    abortCountIn();
    api.stop();
    emit(false, 0);
  };
  $('speed').oninput = (e) => {
    const v = Number(e.target.value) / 100;
    api.playbackSpeed = v;
    $('speedVal').textContent = `${e.target.value}%`;
    if (!isPlaying()) emit(false, api.timePosition || 0); // szünetben nincs pozíció-esemény, a tempót így közöljük
  };
  $('metro').onchange = (e) => {
    clickCfg.metro = e.target.checked;
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
  $('countin').onchange = (e) => {
    clickCfg.countin = Number(e.target.value);
    saveClickCfg();
  };
  $('audio-offset').value = audioOffset;
  $('audio-offset-val').textContent = audioOffset + ' ms';
  $('audio-offset').oninput = (e) => {
    audioOffset = Number(e.target.value);
    $('audio-offset-val').textContent = audioOffset + ' ms';
    store('master.audioOffset', audioOffset);
  };
  $('loop').onchange = (e) => (api.isLooping = e.target.checked);
  $('sound').onchange = applyAudio;
  $('profile').onchange = (e) => {
    profile = e.target.value;
    store('master.profile', profile);
    setProfile(api, profile, selectedTrack);
  };
  $('zoomIn').onclick = () => zoom(0.1);
  $('zoomOut').onclick = () => zoom(-0.1);
  function zoom(d) {
    scale = Math.min(2.5, Math.max(0.5, Math.round((scale + d) * 10) / 10));
    store('master.scale', scale);
    setScale(api, scale);
  }
  $('theme').onclick = () => {
    theme = theme === 'light' ? 'dark' : 'light';
    store('master.theme', theme);
    setTheme(api, theme);
  };
  // Space: lejátszás/szünet bárhol, kivéve szöveges mezőben és legördülő listában.
  // A gombok, jelölőnégyzetek és csúszkák alapból maguk is reagálnának a Space-re, ezt elnyomjuk.
  const takesSpace = (el) => el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text');
  window.addEventListener('keydown', (e) => {
    if (takesSpace(e.target)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) togglePlay();
    } else if (e.code === 'Home') {
      $('stop').click();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && !takesSpace(e.target)) e.preventDefault(); // a fókuszban lévő gomb ne kattintson még egyszer
  });

  // ---- csatlakozott eszközök + elérhetőség ----
  function renderClients(list) {
    const ul = $('clients');
    ul.innerHTML = '';
    $('clientCount').textContent = list.length ? `(${list.length})` : '';
    if (!list.length) ul.innerHTML = '<li class="muted" data-i18n="devices.none"></li>';
    for (const c of list) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="name"></span><span class="muted"></span>';
      li.children[0].textContent = c.name;
      li.children[1].textContent = [c.track, c.rtt != null ? c.rtt + ' ms' : null].filter(Boolean).join(' · ');
      ul.appendChild(li);
    }
    i18n.apply(ul);
  }

  // Több hálózati cím esetén (virtuális adapterek, WSL stb.) kiválasztható, melyik kerül a QR-kódba.
  fetch('/api/info')
    .then((r) => r.json())
    .then(({ port, addresses, langDir: dir }) => {
      langDir = dir || '';
      renderLangHint();
      const urls = addresses.map((a) => `http://${a}:${port}/`);
      if (!urls.length) {
        $('addrs').setAttribute('data-i18n', 'connect.noAddress');
        i18n.apply($('addrs'));
        $('qr').classList.add('hidden');
        return;
      }
      let chosen = store('master.addr');
      if (!urls.includes(chosen)) chosen = urls[0];

      const render = () => {
        $('qr').src = `/api/qr?text=${encodeURIComponent(chosen)}`;
        $('addrs').innerHTML = '';
        for (const u of urls) {
          const row = document.createElement('label');
          row.className = 'addr-row';
          row.innerHTML = '<input type="radio" name="addr"><span class="addr"></span>';
          row.querySelector('.addr').textContent = u;
          const radio = row.querySelector('input');
          radio.checked = u === chosen;
          radio.style.display = urls.length > 1 ? '' : 'none'; // egy címnél nincs mit választani
          radio.onchange = () => {
            chosen = u;
            store('master.addr', u);
            render();
          };
          $('addrs').appendChild(row);
        }
        if (urls.length > 1) {
          const hint = document.createElement('div');
          hint.className = 'muted';
          hint.style.fontSize = '12px';
          hint.setAttribute('data-i18n', 'connect.multi');
          $('addrs').appendChild(hint);
          i18n.apply(hint);
        }
      };
      render();
    });

  // ---- nyelv ----
  i18n.bindSelect($('lang'));
  i18n.onChange(() => {
    renderTitle();
    renderSyncInfo();
    renderLangHint();
    updatePlayButton();
    fillSoundSelect($('sound-type'));
    $('sound-type').value = clickCfg.sound;
  });
  renderTitle();
  renderSyncInfo();
  updatePlayButton();
})();
