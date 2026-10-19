# SyncTab

*English description: [README.md](README.md)*

Szinkronizált tab megjelenítő zenekaroknak. Egy Windows-os master alkalmazás szerverként fut a helyi hálózaton,
a többi eszköz (telefon, tablet, laptop) böngészőből vagy az Android-alkalmazásból csatlakozik – telepítés nélkül,
internet nélkül.

- A master tölti be a dalt (Guitar Pro: `.gp`, `.gp3`, `.gp4`, `.gp5`, `.gpx`) és vezérli a lejátszást.
- Minden eszköz a saját hangszerének sávját látja, a lejátszási pozíciót követő vonallal.
- Az eszközök alapból némák. A ⚙ panelen bekapcsolható a hang: bármennyi sáv bepipálható, egy sáv szólózható,
  a hangerő állítható (a tempóváltással együtt is működik).
- Metronóm: eszközönként kapcsolható, 5 hang közül választható (kattintás, fahang, kolomp, hi-hat, csipogás), állítható hangerővel.
- Beszámolás: a masteren állítható (ki / 1 / 2 ütem). Minden eszközön megjelenik a számolás, a hangja eszközönként kapcsolható.
  A lejátszás a beszámolás végén indul, a lejátszás gomb újabb megnyomása megszakítja.
- A felület 16 nyelven érhető el, és egy kis JSON fájllal [saját nyelv](docs/LANGUAGES.md) is hozzáadható.

## Futtatás fejlesztéshez

```
npm install
npm start
```

A master ablak megnyitja magát. A bal oldali panelen a QR-kód és a címek mutatják, mit kell megnyitni a többi eszközön.
Ha a gépnek több hálózati címe van, a közös Wi-Fi-n lévőt kell kiválasztani: a QR-kód a választást követi.

## Telepítő készítése

```
npm run dist
```

A `dist/` mappában jön létre az egyetlen telepítő (NSIS).

## Android alkalmazás

Az `android/` mappa egy kis Android-alkalmazás (WebView héj): magától megtalálja a mastert a Wi-Fi-n (UDP hirdetés,
41234-es port), vagy a kézzel megadott címen csatlakozik, és a megjelenítőt teljes képernyőn mutatja, a képernyő ébren marad.

```
cd android
gradlew.bat assembleDebug
```

Az APK: `android/app/build/outputs/apk/debug/app-debug.apk` (Android 8.0+). Telepítés: `adb install -r app-debug.apk`,
vagy a fájl átmásolása a telefonra és megnyitása (engedélyezni kell az ismeretlen forrásból való telepítést).
Ha a Wi-Fi tiltja a szórást (vendég-hálózat, „kliens-izoláció"), a master ablakban látható címet kell begépelni.

## Nyelvek

Az angol az alapértelmezett; a böngésző vagy a telefon nyelvét automatikusan átveszi, ha van hozzá fordítás, és a
masteren, illetve minden eszközön a nyelvmenüből váltható. Új nyelvi fájl írását a [docs/LANGUAGES.md](docs/LANGUAGES.md)
írja le (angolul). Fájl ellenőrzése: `npm run check-lang`.

## Működés röviden

- `src/main.js` – Electron, elindítja a szervert és megnyitja a master ablakot.
- `src/server.js` – Express + WebSocket. Dalkönyvtár (`%APPDATA%/SyncTab/songs`), a master idővonalának és
  beszámolásának szétküldése, óraszinkron-válasz (ping/pong), nyelvi fájlok, UDP hirdetés.
- `public/` – master és kliens felület (alphaTab).
- Csak a gépről (localhost) érhető el a master szerepkör, a feltöltés és a törlés.

### Szinkron

- **Közös óra.** Minden eszköz NTP-szerűen méri az óraeltérését a szerverhez (sok ping, a legkisebb késésűeket használja),
  így mindenki ugyanazt a "szerveridőt" látja.
- **Idővonal.** A master a lejátszó hallható pozícióját közli horgonyként, a kliensek ebből minden képkockán kiszámolják a
  pozíciót. Nincs "ugorj ide" parancs, nincs ugrálás, és a hálózati késés nem számít.
- **Megjelenítés szintetizátor nélkül.** Az alphaTab külső időforrás módban fut a klienseken, a kurzort a kiszámolt idő mozgatja.
- **Metronóm és beszámolás.** Az ütésrácsot minden eszköz a dalból számolja, az ütéseket a szerveridő alapján előre, a
  hangkártya órájára ütemezi, így mindenhol ugyanabban a pillanatban szólnak.
- **Beszámolás vége = zene kezdete.** A master megméri az `api.play()` és a hallható indulás közti időt, és ennyivel korábban indítja a zenét.
- **Kimeneti késés.** A böngésző által jelentett hangkimeneti késést (Bluetooth esetén sokat) a kattintások és a master
  pozíciója is figyelembe veszi. Ami marad, kézzel hangolható: a master oldalsávjában (Hangkésés korrekció) és a kliens
  ⚙ paneljén (Időzítés korrekció).
- **Opcionális hang a klienseken.** Egy láthatatlan, élő szintetizátor szólaltatja meg a kiválasztott sávokat, ugyanahhoz az
  idővonalhoz igazítva; 25 ms-nál nagyobb elcsúszásnál magától újrapozicionál.
