# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] – 2026-10-19

First public release.

### Added
- **Master app** (Windows, Electron) with a local web server: loads Guitar Pro songs (`.gp`, `.gp3`, `.gp4`, `.gp5`, `.gpx`)
  and controls playback (play/pause, stop, tempo 25–150 %, loop, jump by clicking the tab, per-track mute/solo, zoom, themes).
- **Viewers** for any modern browser: every device shows its own instrument's track as tab, score or both (drum tracks use
  drum notation), with a cursor that follows the music. Connect by QR code or address.
- **Synchronization** based on a shared NTP-style clock and a published timeline, so the cursor stays in step on all devices.
- **Optional sound on viewers:** tick any tracks, solo a track, set the volume; works with tempo changes.
- **Metronome** (five sounds) and **count-in** (off / 1 / 2 bars) scheduled from the shared clock, with the music starting
  exactly at the end of the count-in.
- Manual **timing correction** on the master and on every viewer, plus automatic audio output latency compensation.
- **Android app** (WebView shell) with automatic master discovery over UDP, full-screen mode and a screen that stays on.
- **16 interface languages** (English, Magyar, Deutsch, Español, Français, Italiano, Nederlands, Polski, Português, Türkçe,
  Русский, 简体中文, 日本語, 한국어, हिन्दी, العربية) and support for custom language files without rebuilding.
- Selectable address for the QR code when the computer has several network addresses.
- Demo song `examples/synctab-demo.gp` and `npm run check-lang` for translators.

### Notes
- Built with the help of an AI assistant (Claude). See the README for details and known limitations.
- The Windows installer and the Android APK are not signed with a publisher certificate (the APK uses a debug key).
