# Adding or editing a language

SyncTab's interface is translated through plain JSON files. English is the base language: anything missing from a
translation falls back to English, so a partial translation works too.

Built-in languages: English, Magyar, Deutsch, Español, Français, Italiano, Nederlands, Polski, Português, Türkçe,
Русский, 简体中文, 日本語, 한국어, हिन्दी, العربية.

## Writing a language file (no rebuild needed)

1. Copy `public/lang/en.json` and name the copy after the language code, e.g. `sv.json` for Swedish.
   Use the short ISO 639-1 code (`sv`, `cs`, `uk`, …). It is also what is matched against the browser or phone language,
   so a browser set to Swedish picks `sv` automatically. Region codes (`pt-BR`) work too and are tried first.
2. Put the file in the **custom language folder**. It is shown in the master window under *Language*; by default:
   - Windows: `%APPDATA%\SyncTab\lang\`
3. Edit the file:
   - `_meta.name` – the language's name **in that language** (shown in the language menus).
   - `_meta.dir` – `"ltr"` (left to right) or `"rtl"` (right to left, e.g. Arabic, Hebrew).
   - Translate the **values** only. Never change the keys (the text on the left).
   - Keep the `{placeholders}` (e.g. `{ms}`, `{name}`, `{path}`) exactly as they are; they are replaced by the program.
4. Reload the page and pick your language in the menu. Files in the custom folder are read on every request, so no
   restart is needed. A custom file with the same code as a built-in language **replaces** it.

Check your file with:

```
node tools/check-lang.js path\to\sv.json
```

It reports invalid JSON, missing or unknown keys, and mismatching `{placeholders}`.

## Adding a language to the program itself

Put the file into `public/lang/` instead, run `node tools/check-lang.js` and build the installer (`npm run dist`).

## Android app

The Android app has a handful of its own texts (the connect screen). They live in Android string resources:
`android/app/src/main/res/values/strings.xml` is English, and `values-<code>/strings.xml` holds a translation
(for example `values-sv/strings.xml`). The app follows the phone's language. The page it shows (the viewer) uses the
language files above and also follows the phone's language.
