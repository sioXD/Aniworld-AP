# Vergleich: Firefox-Extension „AniWorld AP [fork]“ vs. Userscript `references/js_script/script.js`

Beide Projekte verfolgen dasselbe Ziel: Auf AniWorld (und verwandten Seiten) sollen Intros, Outros und Recaps automatisch übersprungen werden, gestützt auf die AniSkip-API. Der Weg dorthin ist jedoch grundverschieden: Die Extension ist eine schlanke, modular aufgebaute Firefox-Erweiterung mit Popup, die sich auf **aniworld.to + VOE** konzentriert. Das Userscript ist ein monolithisches All-in-One-Skript („GSv2 Edition“) mit deutlich größerem Funktionsumfang, das **mehrere Seiten, Player und Geräte** abdeckt.

---

## 1. Eckdaten im Überblick

| Merkmal | Extension | Userscript |
|---|---|---|
| Dateien | `manifest.json`, `src/defaults.js`, `aniworld.js`, `background.js`, `content.js`, `popup.html/.js`, `styles.css` | eine Datei: `references/js_script/script.js` |
| Umfang | ca. 6.000 Zeilen / ca. 178 KB gesamt | 8.196 Zeilen / ca. 305 KB |
| Technik | WebExtension, Manifest V2, `browser.*` | Userscript für Violentmonkey (Chrome/Brave MV3, Firefox) |
| Sprache | Deutsch/Englisch, **umschaltbar** im Popup | Deutsch/Englisch, **automatisch** nach `navigator.language` |
| Einstellungen | 16, im Browser-Popup (3 Tabs) | ca. 40, im Player-Panel aufklappbar |
| Themes | 2 (`classic`, `aniworld`) | 4 eingebaut (`classic`, `aniworld`, `yellow`, `gsv2`) + eigene, importierbar |
| Websites | nur `aniworld.to` | `aniworld.to`, `s.to`, `serienstream.to`, Mirror-IP, dazu `*://*/*` in Frames |
| Player | VOE (JWPlayer), Fallback: natives `<video>` | VOE (JWPlayer), Vidoza (Video.js), Vidmoly, teils generisch |
| Abhängigkeiten | keine | `keyboard.js` + `Notiflix` per CDN, `GM_*`-APIs |
| Build/Release | `pack.ps1`/`pack.sh`, GitHub-CI, AMO | kein Build; Verteilung über Userscript-Manager |

---

## 2. Architektur und Ausführung

### Extension

Die Extension trennt strikt zwischen Seiten- und Player-Kontext:

- **`aniworld.js`** läuft im Top-Frame von `aniworld.to`, parst Breadcrumbs/Titel/Meta-Tags, merkt sich die bevorzugte Audio-Sprache, erkennt die nächste Folge bzw. Staffel und vermittelt per `postMessage` zwischen Seite und VOE-Iframe.
- **`background.js`** ist eine persistente Hintergrundseite. Sie injiziert CSS, `defaults.js` und `content.js` per `webNavigation.onCompleted` in passende Subframes, proxyt alle API-Aufrufe (AniSkip, AniList, Kitsu) und verwaltet Toolbar-Icon, Anime-Cache und Einstellungen.
- **`content.js`** läuft ausschließlich im Player-Frame, baut das Overlay (Skip-Button, Panel, Speed-Control, Next-Episode-Button), spricht mit dem JWPlayer und rendert Fortschrittsbalken-Marker.

Der Datenfluss ist klassisch: `runtime.sendMessage` → Background → `fetch`; Einstellungen liegen in `browser.storage.local`. Die Injektion ist auf Subframes beschränkt, deren Parent `aniworld.to` ist, und filtert bekannte Werbe-/Social-Domains aus.

### Userscript

Das Skript läuft mit `@run-at document-start` und `@match *://*/*` praktisch überall und entscheidet zur Laufzeit, ob es sich um einen Top-Scope (Seite) oder einen Player-Iframe handelt. Statt einer Browser-API-Schicht gibt es eigene Abstraktionen:

- `AniSkipModule` (API-Zugriff über `GM_xmlhttpRequest`)
- `DataStore` (Proxy um `GM_getValue`/`GM_setValue`)
- `CommLinkHandler` / `IframeMessenger` / `IframeInterface` / `TopScopeInterface` (eigener Nachrichtenbus über GM-Storage mit Paket-IDs, Retries und Polling)
- `IframeInterface` als Basisklasse, davon abgeleitet `VOEJWPIframeInterface` und `VidozaIframeInterface`

Das ist deutlich mächtiger (funktioniert über Domains hinweg), aber auch komplexer und schwerer zu warten. Ein DOM-Marker (`data-gsv2-ap-active`) verhindert doppelte Ausführung.

**Kernunterschied:** Die Extension nutzt die Infrastruktur des Browsers (Background, Storage, Injection), das Userscript baut sich diese Infrastruktur selbst nach.

---

## 3. Unterstützte Seiten und Player

| Aspekt | Extension | Userscript |
|---|---|---|
| AniWorld | ja | ja |
| s.to / serienstream.to | nein | ja, inkl. neues und altes Layout (`#player-iframe`, `#episode-links`) |
| Mirror `186.2.175.5` | nein | ja |
| VOE / JWPlayer | ja, Hauptziel | ja |
| Vidoza / Video.js | nein (nur zufällig über `<video>`-Fallback) | ja, inkl. Ad-Entfernung und eigener Steuerleiste |
| Vidmoly | nein | ja, inkl. `spoofVidmolyEnv`, Preload und Iframe-Aufbau |
| Provider-Priorität | nein | ja (`providersPriority`, Standard VOE → Vidmoly → Vidoza) |
| Andere Provider vorladen | nein | ja (`preloadOtherProviders`) |
| CORS-Proxy / „loadX“-Warnung erkennen | nein | ja, inkl. automatischem Provider-Wechsel |
| Werbung entfernen | nein | ja (Vidoza: Overlays/Ad-Iframes) |

Die Extension ist damit klar auf den „Normalfall“ VOE auf AniWorld zugeschnitten. Das Userscript deckt das gesamte Ökosystem ab, inklusive der inoffiziellen Serien-Schwester und mehrerer Hoster.

---

## 4. AniSkip- und MAL-Auflösung

Beide nutzen `https://api.aniskip.com/v2` mit allen fünf Skip-Typen (`op`, `ed`, `mixed-op`, `mixed-ed`, `recap`) und übergeben die Episodenlänge. Der Weg zur MAL-ID unterscheidet sich deutlich:

| Aspekt | Extension | Userscript |
|---|---|---|
| Anime-Erkennung | Breadcrumbs + Seitentitel + `og:title` (Top-Frame), zusätzlich VOE-Titel | `h1` + URL-Slug (`/anime/stream/<slug>`, `/staffel-N/episode-N`) |
| MAL-Suche | **AniList GraphQL**, Fallback **Kitsu** | **Jikan v4** (`api.jikan.moe`) |
| Trefferauswahl | nimmt **blind das erste Ergebnis** | Token-Overlap (Jaccard) über `title`, `title_english`, `title_japanese`, Schwelle ≥ 25 |
| Staffelbehandlung | hängt `season N` an die Suche an, Cache-Key `name::sN` | hängt `season N` an, Cache-Key `slug::sN` |
| Ergebnis-Cache | `storage.local`, **ohne TTL** (bleibt bis zum Löschen) | `localStorage`, MAL 30 Tage, Skip-Zeiten 7 Tage |
| Skip-Zeiten-Cache | **keiner** – jede Episode fragt neu ab | 7 Tage |
| Timeout | keiner explizit | 5 s pro Request (`GM_xmlhttpRequest`) |
| API-Key/Proxy | Background-`fetch`, dadurch keine CORS-Probleme | `GM_xmlhttpRequest` + `@connect` |
| Saison-/Episoden-Auswahl | API-Antwort wird ungefiltert verwendet | gruppiert nach Kategorie und wählt den Treffer mit der **nächstliegenden Episodenlänge** |

Die Extension-Lösung ist wegen AniList/Kitsu robuster gegen Jikan-Rate-Limits und liefert zuverlässig MAL-IDs. Dafür ist die Trefferauswahl gröber: Bei Namensvettern oder Staffel-Mehrdeutigkeiten kann das erste Suchergebnis falsch sein. Das Userscript investiert mehr Logik in die Ähnlichkeitsprüfung, hat dafür aber eine zusätzliche Abhängigkeit (Jikan) und mehr Request-Last.

---

## 5. Speicherung

| Daten | Extension | Userscript |
|---|---|---|
| Einstellungen | ein flaches Objekt in `storage.local` | vier `DataStore`-Objekte (core/main/advanced/hotkeys) in GM-Storage |
| Anime-/MAL-Cache | `animeCache` in `storage.local` | `localStorage`-Keys `aw_mal_id::…` |
| Skip-Zeiten | nicht gecacht | `localStorage`-Keys `aw_aniskip::…` |
| Autoplay-Übergabe | `autoPlayNextFlag` + `timestamp` (30 s gültig) | `isAutoplayEnabled` als globale Einstellung |
| Speed | `preferredSpeed` | nicht vorhanden |
| Audio-Sprache | `preferredLanguage` | `videoLanguagePreferredID` (Teil der Core-Settings) |
| Nutzer-ID | `userId` via `crypto.randomUUID()` | pro Einsendung neu generierte UUID |
| Fortschritt/Statistik | nichts | `bingeStats` (Folgen, Sehzeit, Meilensteine) |
| Wiedergabeposition | nichts | pro Video in GM-Storage, mit Ablaufzeit |

Default-Werte sind in der Extension zentral in `src/defaults.js` definiert. Im Userscript gibt es mehrere Default-Objekte (`CORE_…`, `MAIN_…`, `ADVANCED_…`, `HOTKEYS_…`), die beim ersten Start angewendet werden.

---

## 6. Skip-Logik

| Aspekt | Extension | Userscript |
|---|---|---|
| Auto-Skip OP | `autoSkipOp` (Standard: aus) | `autoSkipIntro` (Standard: an) |
| Auto-Skip ED | eigene Einstellung `autoSkipEd`, nutzt ED-Segmente | **kein** ED-Segment-Skip; stattdessen Outro-Schwelle + Autoplay |
| Auto-Skip Recap | eigene Einstellung `autoSkipRecap` | Recap wird geparst, aber **nicht** automatisch übersprungen |
| Fallback ohne AniSkip-Daten | manueller 90-s-Button („Always Show“), kein blinder Sprung | manuelle Intro-Größe (87 s) per Hotkey, Auto-Skip nur mit Daten |
| Skip-Ziel | Segmentende + `skipOffset` (Standard **−5 s**) | exakt Segmentende, kein Offset |
| Sekunden am Anfang überspringen | nein | `autoSkipSecondsOnStart` |
| Doppelte Skips verhindern | `Set` bereits gesprungener Segment-IDs | Flag `introHasBeenSkipped` |
| Skip-Button | eigenes Overlay, optional immer sichtbar | `.SkipIntroBtn` im Player, mit Timeout (Standard 240 s) |
| Hotkey für Skip | nein | ja (Standard `V`), inkl. Cooldown |
| Fortschrittsbalken-Marker | **alle** Typen, eigene Farben pro Typ + Deckkraft | nur Intro, Standard-Akzentfarbe |
| Einsenden an AniSkip | Panel + Schnellbestätigung nach 90-s-Skip; OP/ED/Recap | Modal, nur OP; Werte werden in der Session gemerkt |
| Voting | 👍/👎 pro Segment | nein |
| AniSkip deaktivierbar | nein, immer aktiv | ja (`useAniSkip`) |
| Benachrichtigungen | Statuszeile im Panel | Notiflix-Toasts (optional) |
| Video-Ende | markiert Folge als gesehen, ggf. nächste Folge | Outro-Schwelle löst Autoplay/Countdown aus |
| Gesehene Folgen | setzt die native `seen`-Klasse | eigene Hervorhebung mit konfigurierbarer Farbe |

Die Extension interpretiert AniSkip-Daten vollständiger (alle Typen inklusive ED/Recap), das Userscript setzt den Schwerpunkt auf Autoplay und eine heuristische Outro-Erkennung. Für reine „Intro überspringen“-Nutzer ist das Userscript großzügiger (Standard an), die Extension konservativer (Standard aus).

---

## 7. Player-UI und Bedienung

### Extension

- Overlay-Container `#aniskip-container` mit Theme-Klasse, im JWPlayer-Container (fullscreen-fähig) oder `<body>`.
- Skip-Button mit Typ-Badge, Inline-Bestätigung zum Einsenden („Als Opening speichern?“) inkl. Countdown-Balken.
- Info-Panel: Anime, Staffel, Episode, MAL-ID, Segmentliste mit Votes, manuelle Suche/„Change“, Einsendeformular, Refresh.
- Speed-Control (−/+/Klick = 1×) und **persistente Geschwindigkeit** über Episoden.
- Next-Episode-Button als **nativer JWPlayer-Control** links neben dem Zahnrad.
- Steuerung blendet sich mit den Player-Controls aus (`syncWithPlayerControls`, 200-ms-Polling).
- Tastatureingaben in den eigenen Inputs werden abgefangen, damit der Player nicht Space/Ziffern missbraucht.

### Userscript

- Autoplay-Toggle, Zahnrad (Einstellungen) und Sleeptimer-Button **direkt in der Player-Steuerleiste**.
- Aufklappbares Einstellungs-Panel im Player (Preferences/Advanced) mit denselben Bedienelementen wie ein Popup, inkl. Theme-Import/-Export, Hotkey-Guide und Binge-Statistik.
- Skip-Intro-Button, Submit-Dialog, Countdown-Karte für die nächste Folge, Meilenstein-Karte, Sleeptimer-Pane.
- Hotkeys (`←`/`→`/`F`/`V`), Touch-Doppeltipp (links/rechts spulen, Mitte großer Skip), Vollbild-Handling.
- Visited-Episode-Highlighting, Poster/Info-Overlay, Scroll-Verhalten im Vollbild.

Die Extension hat die aufgeräumtere, kleinere Overlay-UI und ein klassisches Browser-Popup. Das Userscript bringt die komplette Bedienung in den Player und wirkt dadurch „eingebauter“, ist aber auch visuell und funktional deutlich umfangreicher.

---

## 8. Nächste Folge und Autoplay

| Aspekt | Extension | Userscript |
|---|---|---|
| Auslöser | Video-Ende, < 1 s Restzeit, Skip eines ED-Segments, Button | Restzeit ≤ Outro-Schwelle (Standard 90 s) |
| Countdown | nein | ja, konfigurierbar (Standard 10 s), mit „Jetzt abspielen“/„Abbrechen“ |
| Navigation | vollständiger Seitenwechsel (`window.location.href`) → **Fullscreen geht verloren** | ohne Reload: nächste Folge per `fetch`, DOM-Austausch, CommLink-Navigation im Player → **Fullscreen bleibt** |
| Staffelwechsel | lädt Staffelseite und sucht erste Episode | sucht nächste Staffel und erste Episode, ebenfalls per Fetch |
| Autoplay | Flag in `storage.local` + einmaliger Klick auf Play-Overlays; **kein echtes Autoplay** | echtes Autoplay: `playOrFix`, Mute-Fallback, Unmute-Enforcer; startet **mit Ton** |
| Fullscreen | wird **im VOE-Iframe** angefordert, der Reload beendet ihn | Fullscreen-Element im **Top-Dokument**, `adaptFakeFullscreen()` hält das Layout; der Wechsel verlässt ihn nie |
| Provider-/Sprachwahl | nur Audio-Sprache wird gemerkt und geklickt | Provider-Priorität, Sprachfilter, Provider-Vorladen, Wechsel im Vollbild |
| Manueller Button | ja, in der Control-Bar | ja, plus Autoplay-Toggle im Player |

Der entscheidende Unterschied: Das Userscript macht **echtes Autoplay**. Es wechselt die Folge im selben Dokument, navigiert den Player-Iframe von innen (`NAVIGATE_TO`) und setzt `allow="autoplay; fullscreen"` am Frame. Dadurch bleibt die Activation-Chain des Tabs erhalten, die Folge startet **mit Ton**, und der Fullscreen wird **nie verlassen** – der Nutzer bleibt durchgehend im Vollbild. Nur wenn der In-Page-Weg scheitert, lädt das Userscript die Seite hart neu und ruft vorher `exitFullscreen()` auf.

Die Extension macht heute **nur den Episodenwechsel**: `goToNextEpisode()` setzt ein Storage-Flag und lädt die Seite komplett neu. Der Fullscreen geht dabei verloren, und der anschließende „Autoplay“-Versuch ist ein einzelner Klick auf ein Play-Overlay ohne Verifikation, Retry oder Mute-Fallback. Von den drei Teilen des Userscript-Verhaltens (Wechsel + Ton + Fullscreen) funktioniert also nur der Wechsel.

---

## 9. Einstellungen

### Extension (`src/defaults.js`, 16 Schlüssel)

| Tab | Einstellungen |
|---|---|
| General | `language`, `uiTheme`, `autoSkipOp`, `autoSkipEd`, `autoSkipRecap`, `showButtons`, `alwaysShowButton`, `showSpeedControl`, `persistentSpeed`, `nextEpisode`, `showNextEpisodeButton` |
| Styles | `markerColorOp`, `markerColorEd`, `markerColorRecap`, `markerOpacity` |
| Advanced | `skipOffset`, Reset-Button |

Das Popup liest die Steuerelemente aus dem DOM (`.setting-row input/select`), leitet Laden/Speichern vom Elementtyp ab und zeigt Abhängigkeiten über `data-depends-on`. Neue Einstellung = ein Eintrag in `defaults.js` + eine Zeile in `popup.html` + zwei i18n-Einträge.

### Userscript (ca. 40 Schlüssel in vier Gruppen)

- **Core:** Autoplay, Mute, Volume, Provider-Priorität, Audio-Sprache, Intro-Größe, Outro-Schwelle, Auto-Skip, Sleeptimer, Farbe gesehener Folgen.
- **Main:** Visited-Highlighting, Doppeltipp-Verhalten, Positionsspeicher, stummgeschaltetes Autoplay.
- **Advanced:** AniSkip an/aus, Benachrichtigungen, Countdown, Meilensteine, Skip-Button-Dauer, Mark-Watched-Schwelle, Fast-Forward-Größe, Cooldown, Doubletap-Schwellen, Positions-Ablauf, CORS-Proxy, Commlink-Polling, Provider-Vorladen, gerätespezifische Einstellungen.
- **Hotkeys:** Rücklauf, Vorlauf, Vollbild, großer Skip.

Zusätzlich: Theme-Auswahl, eigene Themes (Import/Export/Löschen), Hotkey-Guide, Reset.

Die Extension deckt die wesentlichen Komfortfunktionen ab, das Userscript ist eher ein „Player-Ersatz“ mit Playback-, Statistik- und Netzwerk-Optionen.

---

## 10. Themes und Internationalisierung

| Aspekt | Extension | Userscript |
|---|---|---|
| Theme-Umschaltung | Popup, `body[data-theme]` + `#aniskip-container.theme-*` | Player-Panel, `GM_addStyle` + generierte CSS-Variablen |
| Eingebaute Themes | 2 | 4 |
| Eigene Themes | nein | ja, JSON-Import/-Export |
| Live-Update | `settingsUpdated`-Message an Content-Script | GM-Value-Change-Listener + Message-Bus |
| UI-Sprache | manuell (en/de), `data-i18n`-Attribute | automatisch nach Browser-Sprache |
| Übersetzungsablage | inline in `popup.js` und `content.js` | ein großes `localizations`-Objekt |
| Schriften | Systemschriften | Google Fonts (Space Grotesk, JetBrains Mono) + Font Awesome per CDN |

Die Extension bleibt bei Systemschriften und zwei klaren Themes. Das Userscript lädt externe Fonts/Icons und erlaubt beliebige Themes, was optisch flexibler, aber auch netzwerk- und datenschutzrelevanter ist.

---

## 11. Kommunikation zwischen Seite und Player

**Extension:** `postMessage` mit festen Nachrichtentypen:

- `ANISKIP_ANIME_INFO` (Seite → Iframe)
- `ANISKIP_NEXT_EPISODE`, `ANISKIP_MARK_SEEN`, `ANISKIP_REQUEST_NEXT_EPISODE_STATUS`, `ANISKIP_NEXT_EPISODE_AVAILABLE`
- `ANISKIP_REQUEST_FULLSCREEN`, `ANISKIP_ENTER_FULLSCREEN`
- `ANISKIP_AUTO_PLAY`

Zusätzlich `runtime.sendMessage` für API/Settings und `storage.local` für Flags.

**Userscript:** eigener `CommLinkHandler` über GM-Storage: Pakete mit ID, Zeitstempel, Retries, Polling-Intervall (Standard 40 ms), Antwort-Warteschlange, Value-Change-Listener. Dadurch können beliebige Cross-Domain-Frames miteinander sprechen, auch wenn `postMessage` nicht ausreicht. Das ist die Voraussetzung für s.to/Vidoza/Vidmoly und das Navigieren ohne Reload.

---

## 12. Fehlerbehandlung und Benachrichtigungen

- **Extension:** Statuszeile im Panel, `console.log`/`console.error`, Inline-Feedback im Skip-Button („Gespeichert!“/„Fehlgeschlagen“). Keine globalen Toasts, keine Report-Dialoge.
- **Userscript:** Notiflix für Notify/Report, First-Run-Info, Fehlermeldungen mit Bug-Report-Aufforderung, diverse Fallback-Meldungen (Vidmoly nicht bereit, Autoplay-Fehler, Fallback-Zeiten). Deutlich lauter und benutzerfreundlicher, aber auch aufdringlicher.

---

## 13. Berechtigungen, Datenschutz, Kompatibilität

| Aspekt | Extension | Userscript |
|---|---|---|
| Host-Zugriff | `<all_urls>` + `api.aniskip.com`, Injection nur auf AniWorld-Frames | `*://*/*`, `@connect api.jikan.moe`, `api.aniskip.com` |
| Browser | Firefox 142+, Desktop und Android | Chrome/Brave + Firefox über Violentmonkey |
| Manifest | MV2, persistenter Background | Userscript-Metadaten, `@run-at document-start` |
| Datenschutz-Deklaration | `data_collection_permissions` im Manifest | keine (Verantwortung liegt beim Userscript-Manager) |
| Einsendung | `submitterId` = persistente Installation-ID, `providerName: "voe"` | zufällige UUID pro Einsendung, `providerName: "Aniworld"` |
| Externe Ressourcen | keine | zwei CDN-Bibliotheken + Google Fonts/Font Awesome |

Die Extension ist strenger eingegrenzt und deklariert ihre Datenerhebung. Das Userscript ist breiter berechtigt und lädt Fremdressourcen nach.

---

## 14. Wartbarkeit, Build und Release

**Extension**

- Klare Trennung in Seite, Background und Player; zentrale Defaults; DOM-abgeleitete Einstellungen; zwei Sprachen an einer Stelle pro Kontext.
- `pack.ps1`/`pack.sh` stempeln Version und Datum, `web-ext` baut das ZIP; GitHub Actions erzeugt bei Versionsänderung Tag und Release, optional AMO-Upload.
- Dokumentationsseite unter `docs/`.
- Nachteil: Firefox-only, MV2, keine Tests, manuelles Testen.

**Userscript**

- Alles in einer Datei, viele inline erzeugte Styles und duplizierte Logik (z. B. Player-Setup für VOE und Vidoza).
- Feste externe Abhängigkeiten und ein hartkodierter CORS-Proxy (`aniworld-to-cors-proxy.fly.dev`).
- Kein Build, keine Versionierung im Repo, Updates über den Userscript-Manager.
- Vorteil: sehr schnell verteilbar, plattformübergreifend, keine Store-Prozesse.

---

## 15. Was nur die Extension macht

- Geschwindigkeitsregelung (0,25×–5×) und **persistente Wiedergabegeschwindigkeit**.
- Skip-Offset (`skipOffset`, Standard −5 s nach dem Segment).
- Fortschrittsbalken-Marker für **alle** Skip-Typen mit frei wählbaren Farben und Deckkraft.
- Nächste-Folge-Button als echter JWPlayer-Control-Button.
- AniSkip-Panel mit Segmentliste, **Up-/Downvotes**, MAL-Suche/„Change“, Refresh und Einsendeformular.
- MAL-Auflösung über **AniList + Kitsu** statt Jikan.
- Getrennte Auto-Skip-Schalter für OP, ED und Recap.
- Browser-Popup mit drei Tabs, Farbwähler mit Presets, Zwei-Klick-Reset, Versions- und Build-Datum-Anzeige.
- Toolbar-Icon passend zum Theme, persistente Audio-Sprachwahl, saubere Firefox-Paketierung inkl. AMO/CI.

## 16. Was nur das Userscript macht

- Unterstützung von **s.to, serienstream.to, Mirror-IP** und mehreren Hostern (VOE, Vidoza, Vidmoly).
- Provider-Priorität, Provider-Vorladen, automatischer Provider-Wechsel bei „loadX“-Warnung, CORS-Proxy.
- Werbe-/Overlay-Entfernung (Vidoza) und Vidmoly-Spoofing.
- Hotkeys (Vor-/Rücklauf, Vollbild, großer Skip) inkl. Hotkey-Guide.
- Touch-Doppeltipp-Gesten und konfigurierbare Schwellen.
- Sleeptimer mit Presets und Autoplay-Abschaltung.
- Binge-Statistik und Meilenstein-Karten (10/50/100/500/1000 Folgen).
- Wiedergabepositions-speicher mit Ablaufzeit und Resume.
- „Als gesehen markieren“ nach X Sekunden, eigene Hervorhebung besuchter Folgen.
- Persistente Lautstärke/Stummschaltung, stummgeschaltetes Autoplay, Unmute-Enforcer.
- Nächste-Folge-Countdown-Karte mit Abbrechen.
- Komplettes Einstellungs-Panel im Player, eigene Themes mit Import/Export, First-Run-Info.
- In-Page-Navigation zur nächsten Folge ohne vollständigen Reload.
- AniSkip global abschaltbar, Benachrichtigungen abschaltbar, manueller Intro-Fallback.

---

## 17. Fazit

| | Extension | Userscript |
|---|---|---|
| Fokus | sauber, schlank, VOE/AniWorld | maximaler Funktionsumfang, viele Seiten/Player |
| Stärken | Wartbarkeit, Packaging, Speed-Control, Votes, Marker, Popup, AniList/Kitsu | Autoplay, Hotkeys, Sleeptimer, Statistik, Positionsspeicher, Provider-Logik, In-Page-Navigation |
| Schwächen | kein ED-/Outro-Autoplay ohne AniSkip-Daten, keine Hotkeys, nur VOE, grobe MAL-Trefferauswahl, kein Skip-Cache | monolithisch, CDN-/Proxy-Abhängigkeiten, breite Berechtigungen, höhere Bruchanfälligkeit, kein Build/Release-Prozess |
| Geeignet für | Nutzer, die auf AniWorld mit VOE schauen und eine aufgeräumte, zuverlässige Erweiterung wollen | Power-User, die mehrere Seiten/Hoster nutzen und Autoplay, Statistik und Hotkeys wollen |

Kurz gesagt: Die Extension ist die **fokussierte, wartbare Neuinterpretation** derselben Idee mit besserer Integration in den Browser und einem genaueren Umgang mit AniSkip-Segmenten. Das Userscript ist die **funktional überlegene, aber schwergewichtige Allzweck-Lösung**, die bewusst mehr Risiko und Komplexität in Kauf nimmt, um mehr Seiten, Player und Komfortfunktionen abzudecken.

---

### Anhang: Referenzierte Dateien

- Extension: `manifest.json`, `src/defaults.js`, `src/background.js`, `src/aniworld.js`, `src/content.js`, `src/popup.html`, `src/popup.js`, `src/styles.css`
- Userscript: `references/js_script/script.js`
