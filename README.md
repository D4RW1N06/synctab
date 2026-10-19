# SyncTab

*Magyar nyelvű leírás: [README.hu.md](README.hu.md)*

A synchronized tab viewer for bands. A Windows "master" app runs as the server on your local network; every other
device (phone, tablet, laptop) just opens a web page, or the Android app. No installation on those devices and no
internet connection needed.

- The master loads the song (Guitar Pro: `.gp`, `.gp3`, `.gp4`, `.gp5`, `.gpx`) and controls playback.
- Every device shows the tab of *its own* instrument, with a cursor line that follows the music.
- Devices are silent by default and only show the tab. In the ⚙ panel you can enable sound: tick any tracks you want
  to hear, solo a track, and change the volume (tempo changes work as well).
- Metronome: switch it on per device, choose one of 5 sounds (click, wood block, cowbell, hi-hat, beep), set the volume.
- Count-in: set on the master (off / 1 / 2 bars). Every device shows the count; its sound can be switched per device.
  Playback starts at the end of the count-in; pressing play again cancels it.
- The interface is available in 16 languages and you can [add your own](docs/LANGUAGES.md) by writing a small JSON file.

## Running it for development

```
npm install
npm start
```

The master window opens by itself. The QR code and addresses in the left panel show what to open on the other devices.
If the computer has several network addresses, pick the one on the shared Wi-Fi: the QR code follows your choice.

## Building the installer

```
npm run dist
```

The single installer (NSIS) appears in the `dist/` folder.

## Android app

The `android/` folder contains a small Android app (a WebView shell). It finds the master on the Wi-Fi automatically
(UDP announcement on port 41234) or connects to an address you type, and shows the viewer full screen with the screen
kept awake.

```
cd android
gradlew.bat assembleDebug
```

The APK is `android/app/build/outputs/apk/debug/app-debug.apk` (Android 8.0+). Install it with `adb install -r app-debug.apk`,
or copy it to the phone and open it (allow installing from unknown sources). If the Wi-Fi blocks broadcasts
(guest networks, "client isolation"), type the address shown in the master window.

## Languages

English is the default; the browser/phone language is picked automatically when a translation exists, and it can
be changed from the language menu on the master and on each device. Writing a new language file is described in
[docs/LANGUAGES.md](docs/LANGUAGES.md). Check a file with `npm run check-lang`.

## How it works

- `src/main.js` – Electron: starts the server and opens the master window.
- `src/server.js` – Express + WebSocket. Song library (`%APPDATA%/SyncTab/songs`), distribution of the master's
  timeline and count-in, clock-sync replies (ping/pong), language files, and the UDP discovery announcement.
- `public/` – master and viewer UI (alphaTab).
- Only the computer itself (localhost) can act as master, upload or delete songs.

### Synchronization

- **Shared clock.** Every device measures its clock offset to the server NTP-style (many pings, using the ones with
  the lowest delay), so everyone shares one "server time".
- **Timeline.** The master publishes the audible playback position as an anchor ("the song is at X ms at server time Y").
  Each device computes the position from it on every frame. No "jump here" commands: no stutter, and network delay
  does not matter.
- **No synthesizer needed for the display.** alphaTab runs in external-media mode on the viewers and the cursor is
  moved by the computed time.
- **Metronome and count-in.** Every device derives the beat grid from the song and schedules the clicks ahead of time
  on the sound card's clock using server time, so they sound at the same moment everywhere.
- **Count-in end = music start.** The master measures the delay between `api.play()` and the audible start and starts
  the music that much earlier.
- **Audio output latency.** The latency reported by the browser (large with Bluetooth) is compensated for clicks and for
  the master's position. What remains can be tuned by hand: *Audio delay correction* in the master's sidebar and
  *Timing correction* in the viewer's ⚙ panel.
- **Optional sound on viewers.** A hidden live synthesizer plays the chosen tracks and is aligned to the same timeline;
  it repositions itself when it drifts more than 25 ms.
