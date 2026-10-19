# Third-party notices

SyncTab itself is released under the [MIT License](LICENSE). It builds on the following open-source software.
Each component remains under its own license; the list below is not a substitute for those licenses.

## Bundled in the installer / served to the viewers

| Component | License | Notes |
|---|---|---|
| [alphaTab](https://www.alphatab.net/) 1.8 | MPL-2.0 | Renders the tab and plays the synthesized audio. Used unmodified (from npm); its source is available at https://github.com/CoderLine/alphaTab |
| Bravura music font (inside alphaTab) | SIL Open Font License 1.1 | © Steinberg Media Technologies GmbH. Full text: `node_modules/@coderline/alphatab/dist/font/Bravura-OFL.txt` |
| Sonivox SoundFont `sonivox.sf2` (inside alphaTab) | Apache-2.0 | © 2004–2006 Sonic Network Inc. Full text: `node_modules/@coderline/alphatab/dist/soundfont/LICENSE` |
| [Electron](https://www.electronjs.org/) | MIT | Also includes Chromium and its third-party components; the installer ships `LICENSE.electron.txt` and `LICENSES.chromium.html` |
| [Express](https://expressjs.com/) | MIT | Local web server |
| [ws](https://github.com/websockets/ws) | MIT | WebSocket server |
| [qrcode](https://github.com/soldair/node-qrcode) | MIT | Connection QR code |

In total, the production dependency tree contains 86 npm packages (76 MIT, 8 ISC, 1 BSD-3-Clause, 1 MPL-2.0).
List them with `npm ls --omit=dev --all`.

## Android app

| Component | License |
|---|---|
| [AndroidX Core KTX](https://developer.android.com/jetpack/androidx/releases/core) | Apache-2.0 |
| [Kotlin standard library](https://kotlinlang.org/) | Apache-2.0 |

## Build tooling (not shipped)

electron-builder (MIT), Gradle (Apache-2.0), Android Gradle Plugin (Apache-2.0).

## Demo song

`examples/synctab-demo.gp` is an original four-chord progression written for this project and is covered by the MIT License.
