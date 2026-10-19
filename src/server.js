const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const dgram = require('dgram');
const QRCode = require('qrcode');

const MAX_UPLOAD = 50 * 1024 * 1024;
const DISCOVERY_PORT = 41234; // az Android app erre a UDP portra figyel
const SONG_EXT = /\.(gp|gp3|gp4|gp5|gpx)$/i;

function isLoopback(req) {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function localAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}

// Szórásos hirdetés a helyi hálózaton, hogy az Android app automatikusan megtalálja a mastert.
function startBeacon(port) {
  const sock = dgram.createSocket('udp4');
  const targets = () => {
    const out = new Set(['255.255.255.255']);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const i of list || []) {
        if (i.family !== 'IPv4' || i.internal) continue;
        const ip = i.address.split('.').map(Number);
        const mask = i.netmask.split('.').map(Number);
        out.add(ip.map((b, k) => (b | (~mask[k] & 255)) & 255).join('.'));
      }
    }
    return [...out];
  };
  const announce = () => {
    const msg = Buffer.from(JSON.stringify({ app: 'synctab', v: 1, name: os.hostname(), port }));
    for (const addr of targets()) sock.send(msg, DISCOVERY_PORT, addr, () => {});
  };
  sock.on('error', () => {}); // a hirdetés nem létfontosságú
  sock.bind(0, () => {
    try {
      sock.setBroadcast(true);
    } catch {}
    announce();
  });
  const timer = setInterval(announce, 1500);
  return () => {
    clearInterval(timer);
    try {
      sock.close();
    } catch {}
  };
}

function start({ port = 8080, dataDir, publicDir, alphaTabDir, userLangDir }) {
  const songsDir = path.join(dataDir, 'songs');
  fs.mkdirSync(songsDir, { recursive: true });
  // Saját nyelvi fájlok helye: ide tett <kód>.json fájlok a beépítettek elé kerülnek.
  const langDir = userLangDir || path.join(dataDir, 'lang');
  fs.mkdirSync(langDir, { recursive: true });
  const builtinLangDir = path.join(publicDir, 'lang');

  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  // ---- songs library ----
  const listSongs = () =>
    fs
      .readdirSync(songsDir)
      .filter((f) => SONG_EXT.test(f))
      .map((f) => ({ id: f, name: f.replace(SONG_EXT, ''), mtime: fs.statSync(path.join(songsDir, f)).mtimeMs }))
      .sort((a, b) => a.name.localeCompare(b.name, 'hu'));

  const safeName = (n) => path.basename(String(n)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');

  // ---- shared state ----
  // A szerver órája (ms, monoton). Minden eszköz ehhez méri az órája eltérését, az idővonal horgonyai is ebben vannak.
  const now = () => performance.now();
  // Idővonal: a dal pos pozíciója (ms) a szerveridő at pillanatában; lejátszás közben pos + (most - at).
  const timeline = { type: 'timeline', songId: null, playing: false, pos: 0, at: now(), speed: 1 };
  const clients = new Map(); // ws -> {id, name, track, role}
  let nextId = 1;

  const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
  const broadcast = (msg, except) => {
    const data = JSON.stringify(msg);
    for (const ws of clients.keys()) if (ws !== except && ws.readyState === 1) ws.send(data);
  };
  // A master elvesztésekor az idővonalat megállítjuk, különben a kliensek örökké futnának.
  const freezeTimeline = () => {
    if (timeline.playing) timeline.pos += now() - timeline.at;
    timeline.playing = false;
    timeline.at = now();
  };
  const rosterFor = () =>
    [...clients.values()].filter((c) => c.role === 'client').map(({ id, name, track, rtt }) => ({ id, name, track, rtt }));
  const sendRoster = () => {
    const msg = { type: 'roster', clients: rosterFor() };
    for (const [ws, c] of clients) if (c.role === 'master') send(ws, msg);
  };
  const broadcastSongs = () => broadcast({ type: 'songs', songs: listSongs() });

  // ---- http ----
  app.use('/lib/alphatab', express.static(alphaTabDir));

  // ---- nyelvek: a felhasználó mappája elsőbbséget élvez a beépítettekkel szemben ----
  const LANG_CODE = /^[A-Za-z0-9_-]{1,16}$/;
  const readLang = (code) => {
    if (!LANG_CODE.test(code)) return null;
    for (const dir of [langDir, builtinLangDir]) {
      const file = path.join(dir, code + '.json');
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        return { data, custom: dir === langDir };
      } catch {
        /* nincs ilyen fájl vagy hibás: megyünk tovább */
      }
    }
    return null;
  };
  const listLangs = () => {
    const codes = new Set();
    for (const dir of [builtinLangDir, langDir]) {
      try {
        for (const f of fs.readdirSync(dir)) if (/^[A-Za-z0-9_-]{1,16}.json$/.test(f)) codes.add(f.slice(0, -5));
      } catch {
        /* hiányzó mappa */
      }
    }
    const out = [];
    for (const code of codes) {
      const l = readLang(code);
      if (!l) continue; // hibás JSON
      const meta = l.data._meta || {};
      out.push({ code, name: meta.name || code, dir: meta.dir === 'rtl' ? 'rtl' : 'ltr', custom: l.custom });
    }
    out.sort((a, b) => (a.code === 'en' ? -1 : b.code === 'en' ? 1 : a.name.localeCompare(b.name)));
    return out;
  };
  app.get('/lang/:file', (req, res) => {
    const m = /^([A-Za-z0-9_-]{1,16}).json$/.exec(req.params.file);
    const l = m && readLang(m[1]);
    if (!l) return res.sendStatus(404);
    res.set('Cache-Control', 'no-cache').json(l.data);
  });
  app.get('/api/langs', (req, res) => res.set('Cache-Control', 'no-cache').json(listLangs()));

  app.use(express.static(publicDir));
  app.get('/api/songs', (req, res) => res.json(listSongs()));
  app.get('/songs/:id', (req, res) => {
    const file = path.join(songsDir, safeName(req.params.id));
    if (!fs.existsSync(file)) return res.sendStatus(404);
    res.sendFile(file);
  });
  app.get('/api/info', (req, res) => res.json({ port, addresses: localAddresses(), langDir }));
  app.get('/api/qr', async (req, res) => {
    const text = String(req.query.text || '').slice(0, 200);
    res.type('image/svg+xml').send(await QRCode.toString(text, { type: 'svg', margin: 1 }));
  });

  const masterOnly = (req, res, next) => (isLoopback(req) ? next() : res.sendStatus(403));
  app.post(
    '/api/songs/:name',
    masterOnly,
    express.raw({ type: '*/*', limit: MAX_UPLOAD }),
    (req, res) => {
      const name = safeName(req.params.name);
      if (!SONG_EXT.test(name) || !Buffer.isBuffer(req.body) || !req.body.length) return res.sendStatus(400);
      fs.writeFileSync(path.join(songsDir, name), req.body);
      broadcastSongs();
      res.json({ id: name });
    }
  );
  app.delete('/api/songs/:name', masterOnly, (req, res) => {
    const file = path.join(songsDir, safeName(req.params.name));
    if (fs.existsSync(file)) fs.unlinkSync(file);
    if (timeline.songId === path.basename(file)) {
      Object.assign(timeline, { songId: null, playing: false, pos: 0, at: now() });
      broadcast(timeline);
    }
    broadcastSongs();
    res.sendStatus(204);
  });

  // ---- websocket ----
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/ws') return socket.destroy();
    const wantsMaster = url.searchParams.get('role') === 'master';
    if (wantsMaster && !isLoopback(req)) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.meta = { role: wantsMaster ? 'master' : 'client' };
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    const info = { id: nextId++, name: 'Eszköz', track: null, role: ws.meta.role };
    clients.set(ws, info);
    send(ws, { type: 'hello', id: info.id, songs: listSongs(), timeline });
    sendRoster();

    ws.on('message', (raw) => {
      let m;
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      if (m.type === 'ping') {
        // órasinkron: azonnali válasz a szerver idejével
        send(ws, { type: 'pong', t0: m.t0, ts: now() });
      } else if (info.role === 'master' && m.type === 'timeline') {
        Object.assign(timeline, {
          songId: m.songId ?? null,
          playing: !!m.playing,
          pos: Number(m.pos) || 0,
          at: Number(m.at) || now(),
          speed: Number(m.speed) || 1,
          seq: Number(m.seq) || 0,
        });
        broadcast(timeline, ws);
      } else if (info.role === 'master' && m.type === 'countin') {
        // beszámolás: startAt = a zenei kezdés ideje szerveridőben, a kliensek ebből ütemezik az ütéseket
        broadcast(
          {
            type: 'countin',
            cancel: !!m.cancel,
            beats: Number(m.beats) || 0,
            perBar: Number(m.perBar) || 4,
            beatMs: Number(m.beatMs) || 0,
            startAt: Number(m.startAt) || 0,
          },
          ws
        );
      } else if (info.role === 'client' && m.type === 'profile') {
        info.name = String(m.name || 'Eszköz').slice(0, 40);
        info.track = m.track == null ? null : String(m.track).slice(0, 60);
        info.rtt = Number.isFinite(m.rtt) ? Math.round(m.rtt * 10) / 10 : null;
        sendRoster();
      }
    });
    ws.on('close', () => {
      clients.delete(ws);
      if (info.role === 'master') {
        freezeTimeline();
        broadcast(timeline);
      }
      sendRoster();
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      const stopBeacon = startBeacon(port);
      resolve({
        port,
        addresses: localAddresses(),
        close: () => {
          stopBeacon();
          server.close();
        },
      });
    });
  });
}

module.exports = { start };
