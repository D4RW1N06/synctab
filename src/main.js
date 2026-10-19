const { app, BrowserWindow } = require('electron');
const path = require('path');
const { start } = require('./server');

const BASE_PORT = 8080;

async function startServer() {
  const common = {
    dataDir: app.getPath('userData'),
    publicDir: path.join(__dirname, '..', 'public'),
    alphaTabDir: path.join(__dirname, '..', 'node_modules', '@coderline', 'alphatab', 'dist'),
  };
  for (let port = BASE_PORT; port < BASE_PORT + 20; port++) {
    try {
      return await start({ ...common, port });
    } catch (e) {
      if (e.code !== 'EADDRINUSE') throw e;
    }
  }
  throw new Error('Nem található szabad port.');
}

async function createWindow() {
  const server = await startServer();
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'SyncTab',
    autoHideMenuBar: true,
    backgroundColor: '#14161a',
    // a háttérben (kis méretben) sem lassulhatnak le az időzítők: a master adja az időt a többi eszköznek
    webPreferences: { backgroundThrottling: false },
  });
  win.loadURL(`http://localhost:${server.port}/master.html`);
  app.on('before-quit', () => server.close());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
