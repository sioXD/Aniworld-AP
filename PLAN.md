# PLAN: Echtes Autoplay für die AniWorld-AP-Extension

> **Kurzfassung:** Das Userscript (`references/js_script/script.js`) kann echtes Autoplay: Es wechselt die Folge im selben Dokument, spielt sie mit Ton ab und bleibt dabei **durchgehend im Fullscreen**. Die Extension wechselt heute **nur die Folge** – per vollständigem Seiten-Reload, der den Fullscreen beendet, und ohne verifizierten Wiedergabestart. Dieser Plan bringt die Extension auf das Niveau des Userscripts.

## 1. Ziel

Nach dem Wechsel zur nächsten Folge soll die Wiedergabe **tatsächlich automatisch starten** – ohne zusätzlichen Klick des Nutzers. Das gilt für:

- automatischen Folgenwechsel am Video-Ende,
- manuellen Klick auf den Next-Episode-Button im Player.

Autoplay wird **kein neuer Schalter**. Es fällt vollständig unter die bestehende Einstellung **`nextEpisode`**:

| Zustand von `nextEpisode` | Automatischer Folgenwechsel | Autoplay | Manueller Next-Button |
|---|---|---|---|
| `true` (Standard) | ja | ja | navigiert und spielt ab |
| `false` | nein | nein | navigiert und spielt ab (explizite Nutzeraktion) |

Damit bleibt die Semantik einfach: „Next Episode“ bedeutet ab jetzt **navigieren + abspielen**. Der manuelle Button bleibt eine bewusste Ausnahme, weil der Nutzer dort selbst den Wechsel auslöst.

### 1.1 Referenzverhalten: Das Userscript spielt wirklich ab

`references/js_script/script.js` macht heute bereits genau das, was diese Extension noch nicht kann. Beim automatischen Folgenwechsel laufen dort drei Dinge zusammen:

| Teilverhalten | Umsetzung im Userscript | Ergebnis |
|---|---|---|
| Folgenwechsel | `TopScopeInterface.goToNextVideo()` lädt die nächste Episodenseite per `fetch()` und ersetzt die relevanten DOM-Bereiche über `outerHTML`, danach `history.pushState()` | Die Seite wird **nicht neu geladen** |
| Wiedergabe | Der Player-Iframe navigiert sich selbst (`NAVIGATE_TO` → `location.href` im Frame) oder bekommt ein neues `src`; die neue Player-Instanz ruft danach `handleAutoplay()` auf | Folge startet **mit Ton** |
| Fullscreen | Es gibt keinen Dokument-Reload; `document.documentElement` bleibt das Fullscreen-Element, `adaptFakeFullscreen()` hält das Player-Layout bildschirmfüllend | Der Nutzer **bleibt durchgehend im Fullscreen** |

Entscheidend sind zwei Kommentare direkt im Userscript-Code:

- `NAVIGATE_TO`: „Navigate from inside the frame: a self-initiated same-origin navigation carries the user activation over, so the next episode may start unmuted“
- `iframe.setAttribute("allow", "autoplay; fullscreen")`: „Delegate autoplay permission to the player frame; without this the browser refuses unmuted playback there on automatic episode switch“

Der Fullscreen bleibt also deshalb erhalten, weil das **Fullscreen-Element im Top-Dokument** liegt (`document.documentElement.requestFullscreen()`), während nur der Player-Iframe innerhalb dieses Dokuments navigiert. Der Wechsel findet nie auf Dokument-Ebene statt.

Nur im Fehlerfall (`catch` in `goToNextVideo()`) lädt das Userscript die Seite hart neu – und ruft **genau dann** vorher `document.exitFullscreen()` auf. Fullscreen-Verlust ist dort ein expliziter Notausgang, kein Normalzustand.

### 1.2 Ist-Zustand: Die Extension wechselt nur die Folge

| Teilverhalten | Extension heute | Konsequenz |
|---|---|---|
| Folgenwechsel | `window.location.href = nextUrl` in `goToNextEpisode()` | Funktioniert, ist aber ein **vollständiger Seiten-Reload** |
| Wiedergabe | `handleAutoPlay()` klickt einmal ein Play-Overlay bzw. ruft `video.play()` | **Kein echtes Autoplay**: keine Verifikation, kein Retry, kein Mute-Fallback |
| Ton | Es wird nie entstummt; hörbares `play()` kann nach dem Reload blockiert sein | **meist kein Ton** |
| Fullscreen | Fullscreen wird **im VOE-Iframe** angefordert (`enterFullscreenFromPlayer()`), der Reload zerstört dieses Dokument | **Fullscreen geht beim Wechsel verloren** |

Kurz gesagt: Was heute „Autoplay“ heißt, ist ein einzelner Klick-Versuch nach einem Reload. Der Fullscreen geht dabei zwangsläufig verloren. Zusätzlich liegt das Fullscreen-Element heute im falschen Dokument: Selbst ohne Reload würde ein `src`-Wechsel des VOE-Iframes den iframe-lokalen Fullscreen beenden.

Praktisch bedeutet das: Der Folgenwechsel funktioniert, die Wiedergabe startet aber oft gar nicht – der eine Klick trifft ins Leere oder wird vom neu aufgebauten Player ignoriert.

### 1.3 Definition von „echtem Autoplay“

Der Plan ist erst erfüllt, wenn nach dem Folgenwechsel **alle drei** Bedingungen gelten:

1. **Folge gewechselt:** URL und Player zeigen die nächste Episode.
2. **Wiedergabe läuft:** `video.paused === false` bzw. `player.getState()` ist `playing` oder `buffering`.
3. **Fullscreen bleibt:** War `document.fullscreenElement` vor dem Wechsel gesetzt, ist es danach immer noch gesetzt – ohne sichtbaren Ausstieg zwischendurch.

Ton ist das vierte, weichere Ziel: Er soll im Normalfall an sein, genau wie im Userscript. Falls Firefox ihn trotzdem blockiert, greift der Mute-Fallback (stumm starten, bei der ersten Interaktion entstummen). **Pflicht sind Folgenwechsel + laufende Wiedergabe + durchgehender Fullscreen; Ton ist Best-Effort.**

Die Mute-Strategie bleibt trotzdem im Plan, weil sie die einzige Rettung ist, wenn die Activation-Chain (z. B. nach einem Fallback-Reload) doch einmal reißt:

1. Zuerst unmuted abspielen versuchen.
2. Bei `NotAllowedError` stumm schalten und erneut abspielen (stumm ist erlaubt).
3. Nach der ersten Nutzerinteraktion automatisch entstummen.
4. Wenn auch stumm blockiert wird: sauber aufgeben und einen Hinweis anzeigen, statt endlos zu kämpfen.

---

## 2. Ist-Zustand und warum Autoplay aktuell unzuverlässig ist

### Direktvergleich

| Fähigkeit | Userscript (`script.js`) | Extension (heute) |
|---|---|---|
| Nächste Folge automatisch wählen | ja | ja |
| Episodenwechsel ohne Seiten-Reload | ja (`fetch` + DOM-Ersatz + `pushState`) | **nein** (`window.location.href`) |
| Wiedergabe startet automatisch | ja, mit Retry und Verifikation | **nein**, nur ein Klick-Versuch |
| Wiedergabe mit Ton | ja | nein |
| Fullscreen bleibt während des Wechsels | ja, durchgehend | **nein**, Reload beendet Fullscreen |
| Verhalten bei blockiertem `play()` | Mute-Fallback + Unmute bei Interaktion | nichts |

### Beteiligte Stellen

| Datei | Funktion | Aktuelles Verhalten |
|---|---|---|
| `src/aniworld.js` | `goToNextEpisode()` (Z. 178–230) | Setzt `autoPlayNextFlag` + `timestamp` in `storage.local`, dann `window.location.href = nextUrl` |
| `src/aniworld.js` | `checkAutoPlay()` (Z. 301–322) | Liest das Flag, löscht es, setzt `shouldAutoPlay` + `autoPlayTimestamp` |
| `src/aniworld.js` | `waitForPlayerAndPlay()` (Z. 325–354) | Sucht einmalig einen Iframe, wartet 1,5 s, sendet `ANISKIP_AUTO_PLAY` |
| `src/content.js` | `checkShouldAutoPlay()` (Z. 1553–1566) | Liest `shouldAutoPlay`, löscht es, ruft nach 2 s `handleAutoPlay()` |
| `src/content.js` | `handleAutoPlay()` (Z. 1456–1513) | Klickt `.spin`, `img.icon`, JW-Play-Button oder ruft `video.play()` auf – und kehrt danach sofort zurück |
| `src/content.js` | `init()` (Z. 1644–1768) | Ruft `checkShouldAutoPlay()` zweimal auf (Z. 1651 und 1763) |

### Konkrete Schwächen

1. **Keine Verifikation:** Nach einem Klick auf ein Play-Overlay wird nicht geprüft, ob die Wiedergabe wirklich läuft.
2. **Kein Mute-Fallback:** Wenn Firefox `play()` mit `NotAllowedError` ablehnt, passiert nichts.
3. **Kein Retry:** Ein einziger Versuch, danach ist Schluss.
4. **VOE-Eigenheit nicht abgedeckt:** `play()` kann bei VOE hängen und nie auflösen; das Skript löst das mit `Promise.race` und einem Klick auf `div.jw-icon-display`.
5. **Globale Storage-Flags:** `autoPlayNextFlag` und `shouldAutoPlay` gelten tabübergreifend. Ein parallel geöffneter AniWorld-Tab kann das Flag konsumieren.
6. **Kurze TTL:** 30 Sekunden können bei langsamer Verbindung oder großem Staffelwechsel zu knapp sein.
7. **Doppelte Konsumierung:** Parent und Content-Script lesen unabhängig voneinander Flags; das ist race-anfällig.
8. **Kein Unmute:** Selbst wenn stumm gestartet würde, bliebe der Ton dauerhaft aus.
9. **Vollständiger Reload:** `window.location.href` lädt ein neues Dokument. Das beendet Fullscreen und setzt den Player komplett neu auf.
10. **Fullscreen im falschen Dokument:** `enterFullscreenFromPlayer()` fordert Fullscreen im VOE-Iframe an. Ein `src`-Wechsel dieses Iframes beendet ihn – selbst wenn die Seite nicht neu geladen würde.
11. **Activation-Chain reißt:** Nach einem Reload ist die User-Activation des Tabs weg, deshalb kann Firefox hörbares `play()` blockieren. Das Userscript vermeidet genau das durch In-Page-Navigation.

---

## 3. Soll-Architektur

### Grundprinzip

Der Folgenwechsel passiert **im selben Dokument**. Der Autoplay-Wunsch wird pro Tab erzeugt, vom Top-Frame an den Player-Iframe zugestellt und dort von einem zustandsbehafteten Controller mit Verifikation, Retry und Mute-Fallback ausgeführt.

```
┌──────────────────────────── AniWorld-Seite (aniworld.js) ────────────────────────────┐
│                                                                                      │
│  Video endet / Next-Button                                                           │
│        │                                                                             │
│        ▼                                                                             │
│  goToNextEpisode(force)                                                              │
│        │  prüft nextEpisode (außer force)                                            │
│        │  erzeugt Intent { id, targetUrl, force } im Speicher                        │
│        ▼                                                                             │
│  navigateToEpisodeInPage(nextUrl)      ← KEIN Reload, Fullscreen bleibt              │
│        │  1. fetch(nextUrl) + DOMParser                                              │
│        │  2. Episoden-DOM ersetzen (Titel, Episoden-/Staffel-Nav, Provider)          │
│        │  3. history.pushState()                                                     │
│        │  4. Player-Iframe navigiert sich selbst bzw. bekommt neues src              │
│        ▼                                                                             │
│  armAutoplayAfterReady(intent)   ← wartet auf READY des NEUEN Dokuments              │
│        │  verhindert ACK vom alten, noch lebenden Dokument                           │
│        ▼                                                                             │
│  startAutoplayDelivery(intent)                                                       │
│        │  Player-Iframe finden                                                       │
│        │  alle 500 ms ANISKIP_AUTO_PLAY {id, force} senden                           │
│        │  auf ANISKIP_AUTOPLAY_ACK {id, started, muted} warten                       │
│        ▼                                                                             │
│  ACK empfangen → Zustellung beenden                                                  │
│                                                                                      │
│  Fallback nur bei Fehler: Intent nach sessionStorage + Reload (+ exitFullscreen)     │
└──────────────────────────────────────────────────────────────────────────────────────┘
                                      │ postMessage
                                      ▼
┌──────────────────────────── VOE-Iframe (content.js) ─────────────────────────────────┐
│  ANISKIP_AUTO_PLAY {id, force}                                                       │
│        │                                                                             │
│        ▼                                                                             │
│  AutoplayController.attempt(id, force)                                               │
│        │  settings.nextEpisode prüfen (außer force)                                  │
│        │  auf state.player warten                                                    │
│        │                                                                             │
│        ▼                                                                             │
│  Schleife (max. 10 s, alle 200 ms):                                                  │
│    playOrFix()                                                                       │
│      ├─ play() mit 150-ms-Timeout                                                    │
│      ├─ Timeout → einmal div.jw-icon-display klicken                                 │
│      ├─ NotAllowedError → stumm schalten, Hinweis zeigen, erneut versuchen           │
│      └─ danach prüfen: läuft die Wiedergabe wirklich?                                │
│        │                                                                             │
│        ▼                                                                             │
│  Erfolg → ACK {started:true, muted}                                                  │
│         → bei stumm: auf erste Interaktion warten, dann entstummen                  │
│  Fehler → ACK {started:false} + Hinweis „Play drücken“                               │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### Warum In-Page-Navigation statt `window.location.href`?

- **Fullscreen bleibt erhalten**, weil das Fullscreen-Dokument (Top-Frame) nie verlassen wird.
- **Ton bleibt möglich**, weil der Tab seine User-Activation behält.
- **Kein Neuladen-Flackern**: Player, Layout und Position bleiben im selben Dokument.
- **Schneller**: nur ein `fetch` der nächsten Episodenseite statt eines kompletten Seitenaufbaus.

### Warum `sessionStorage` als Fallback statt `storage.local`?

Im Normalfall lebt der Intent als einfache Variable im Top-Frame. `sessionStorage` wird nur gebraucht, wenn die In-Page-Navigation scheitert und doch hart neu geladen werden muss:

- `sessionStorage` ist **pro Tab** und überlebt Same-Origin-Navigationen.
- Kein tabübergreifender Wettlauf mehr.
- Kein Aufräumen alter Flags nötig.
- Die Ziel-URL wird mitgespeichert und beim Lesen validiert, sodass ein abgebrochener oder umgeleiteter Navigationsversuch keinen falschen Autoplay auslöst.

Fallback: Falls `sessionStorage` einmal nicht verfügbar ist (z. B. restriktiver Modus), bleibt der Intent nur im Speicher. Dann gibt es keinen Autoplay über einen Reload hinweg – aber auch keine falschen Starts. Das wird geloggt.

### Fullscreen-Erhalt (Pflicht, nicht optional)

Damit der Wechsel wirklich unsichtbar bleibt, müssen **zwei** Dinge stimmen:

1. **Kein Dokument-Reload.** `window.location.href` ist im Normalpfad verboten.
2. **Das Fullscreen-Element liegt im Top-Dokument.** Solange die Extension `player.setFullscreen(true)` im VOE-Iframe aufruft, beendet schon ein `iframe.src`-Wechsel den Fullscreen.

Deshalb wird der Fullscreen-Einstieg umgedreht (wie im Userscript):

| Heute | Neu |
|---|---|
| Iframe → `ANISKIP_REQUEST_FULLSCREEN` → Top → `ANISKIP_ENTER_FULLSCREEN` → Iframe | Iframe → `ANISKIP_REQUEST_FULLSCREEN` → Top → `document.documentElement.requestFullscreen()` |
| Layout: Browser-Fullscreen des Iframes | Layout: Top-Dokument fullscreen + Player-Container per CSS auf `100vw/100vh` gespannt (Port von `adaptFakeFullscreen()`) |

Wichtig: Der Fullscreen-Button im Player bleibt derselbe. `content.js` sendet beim Klick weiterhin `ANISKIP_REQUEST_FULLSCREEN` an den Parent; nur der Parent führt ihn jetzt selbst aus, statt ihn an den Iframe zurückzureichen.

Zusätzlich setzt `aniworld.js` beim Player-Iframe:

```js
iframe.setAttribute("allow", "autoplay; fullscreen");
```

Das ist die zweite Zutat aus dem Userscript: Ohne dieses Attribut verweigert Firefox dem Frame hörbares Autoplay beim automatischen Wechsel.

### Neue/entfallende Nachrichten

| Nachricht | Richtung | Zweck |
|---|---|---|
| `ANISKIP_AUTO_PLAY` | Top → Player | Autoplay-Versuch anfordern, `{ id, force }` |
| `ANISKIP_AUTOPLAY_ACK` | Player → Top | Ergebnis melden, `{ id, started, muted }` |
| `ANISKIP_PLAYER_READY` | Player → Top | Player ist bereit; Parent kann Intent erneut zustellen |
| `ANISKIP_NEXT_EPISODE` | Player → Top | bleibt unverändert |
| `ANISKIP_MARK_SEEN` | Player → Top | bleibt unverändert |
| `ANISKIP_REQUEST_NEXT_EPISODE_STATUS` / `ANISKIP_NEXT_EPISODE_AVAILABLE` | beide | bleibt unverändert |
| `ANISKIP_REQUEST_FULLSCREEN` | Player → Top | Fullscreen im Top-Dokument anfordern (Ausführung ändert sich, Nachricht bleibt) |
| `ANISKIP_ENTER_FULLSCREEN` | Top → Player | **entfällt** – Fullscreen wird nicht mehr im Iframe angefordert |
| `ANISKIP_NAVIGATE_TO` | Top → Player | **neu** – Player-Frame navigiert sich selbst zur nächsten Folge |
| `resolveRedirectUrl` | Top → Background | **neu** – `/r?t=…` zur finalen VOE-URL auflösen (`runtime.sendMessage`), damit der Frame same-origin navigiert |

Die alten Nachrichten `ANISKIP_AUTO_PLAY` ohne ID werden ersetzt. Da beide Dateien gemeinsam ausgeliefert werden, ist keine Abwärtskompatibilität nötig.

---

## 4. Übernommene Logik aus `references/js_script/script.js`

| Userscript-Stelle | Idee | Übernahme in die Extension |
|---|---|---|
| `IframeInterface.handleAutoplay()` (Z. 5781–5843) | Retry-Schleife bis 10 s, 200 ms Pause | `AutoplayController` in `content.js` |
| `VOEJWPIframeInterface.handleAutoplay()` (Z. 6523–6592) | VOE-spezifisch: `play()` hängt, nach 150 ms `div.jw-icon-display` klicken | `playOrFix()` mit Timeout + einmaligem Klick |
| `playOrFix()` | `Promise.race` gegen „play() was taking too long“ | `delay()` + `Promise.race` |
| `NotAllowedError`-Zweig | stumm schalten, erneut versuchen | `setPlayerMuted(true)` + Retry |
| `waitForUserInteraction()` (Z. 2068–2084) | auf `pointerup`/`keydown` warten | `armUnmute()` mit Capture-Listenern |
| Verzögertes Unmute | 100 ms warten, damit der Nutzer nicht überstimmt wird | `setTimeout(..., 100)` nach Interaktion |
| `setupPersistentVolume()` (Z. 6101–6133) | nicht stumm hängen bleiben | nur der Unmute-Teil, **keine** Volume-Persistenz |
| `TopScopeInterface.goToNextVideo()` (Z. 7377–7649) | In-Page-Wechsel: `fetch` + DOM-Ersatz + `pushState` | `navigateToEpisodeInPage()` in `aniworld.js` |
| `NAVIGATE_TO` (Z. 2485–2491) | Frame navigiert sich selbst → Activation-Chain bleibt | `ANISKIP_NAVIGATE_TO` + `location.href` im Frame |
| `adaptFakeFullscreen()` (Z. 7284–7375) | Player-Container füllt den Bildschirm, Navbar aus | Top-Frame-Fullscreen-Layout in `aniworld.js` + `styles.css` |
| `iframe.setAttribute("allow", "autoplay; fullscreen")` (Z. 8034) | Autoplay-Permission an den Frame delegieren | gleiches Attribut in `aniworld.js` |
| Fehlerpfad in `goToNextVideo()` (Z. 7620–7649) | `exitFullscreen()` + Reload nur im Notfall | gleicher Fallback in `hardReloadToEpisode()` |

**Nicht übernommen** (bewusst außerhalb des Scope):

- globaler Autoplay-Toggle im Player,
- persistentes Volume/Mute,
- Sleeptimer,
- CommLink-Messagebus (die Extension hat `postMessage` + Background),
- neue S.to-Layout-Varianten (die Extension unterstützt nur aniworld.to).

---

## 5. Umsetzungsschritte

### Schritt 1: In-Page-Folgenwechsel in `src/aniworld.js`

**Datei:** `src/aniworld.js`

Ziel: Die nächste Folge wird im selben Dokument aufgebaut. `window.location.href` ist im Normalpfad verboten, sonst gehen Fullscreen und User-Activation verloren.

#### 1.1 Intent erzeugen (Speicher + `sessionStorage`-Fallback)

```js
const AUTOPLAY_INTENT_KEY = "aniskipAutoplayIntent";
const AUTOPLAY_INTENT_TTL_MS = 90 * 1000;

function makeAutoplayId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function normalizePageUrl(url) {
  try {
    const parsed = new URL(url, window.location.origin);
    // Trailing Slash ignorieren, damit Redirects den Intent nicht verwerfen
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.origin}${path}${parsed.search}`;
  } catch {
    return null;
  }
}

function createAutoplayIntent(targetUrl, force) {
  return {
    id: makeAutoplayId(),
    createdAt: Date.now(),
    targetUrl: normalizePageUrl(targetUrl),
    force: force === true,
  };
}

// Nur für den Reload-Fallback (1.7)
function saveAutoplayIntent(targetUrl, intent) {
  const stored = { ...intent, targetUrl: normalizePageUrl(targetUrl) };
  try {
    sessionStorage.setItem(AUTOPLAY_INTENT_KEY, JSON.stringify(stored));
  } catch (error) {
    console.warn("VOE AniSkip: Could not store autoplay intent", error);
  }
}

// Beim Seitenstart lesen, um einen Fallback-Reload zu erkennen
function takeAutoplayIntent() {
  try {
    const raw = sessionStorage.getItem(AUTOPLAY_INTENT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(AUTOPLAY_INTENT_KEY);

    const intent = JSON.parse(raw);
    if (!intent?.id || !intent?.targetUrl) return null;
    if (Date.now() - intent.createdAt > AUTOPLAY_INTENT_TTL_MS) return null;
    if (intent.targetUrl !== normalizePageUrl(window.location.href)) return null;

    return intent;
  } catch (error) {
    console.warn("VOE AniSkip: Could not read autoplay intent", error);
    return null;
  }
}
```

#### 1.2 DOM-Bereiche bestimmen, die ersetzt werden müssen

Die Extension liest ihre Daten aus diesen Stellen – sie müssen nach dem Wechsel aktuell sein:

| Zweck | Selektor |
|---|---|
| Anime/Staffel/Folge parsen | `.breadCrumbMenu li` |
| Nächste Folge finden | `a.active[data-episode-id]` |
| Staffeln finden | `.hosterSiteDirectNav ul` |
| Episoden-Navigation | `div#stream.hosterSiteDirectNav` |
| Sprachliste / Sprachwechsel | `.changeLanguageBox` |
| Serienkopf | `div.hostSeriesTitle` |
| Folgentitel | `div.hosterSiteTitle` |
| Provider-Liste | `div.hosterSiteVideo > ul` |
| Provider-Buttons | `div.generateInlinePlayer` |
| Player-Iframe | `div.inSiteWebStream iframe` |

Die Selektoren stammen aus dem Old-Layout-Zweig von `TopScopeInterface.queries` im Userscript und wurden gegen die bestehende `aniworld.js` abgeglichen.

#### 1.3 `navigateToEpisodeInPage(url)`

```js
const EPISODE_DOM_SELECTORS = [
  ".breadCrumbMenu",
  "div#stream.hosterSiteDirectNav",
  ".changeLanguageBox",
  "div.hostSeriesTitle",
  "div.hosterSiteTitle",
  "div.hosterSiteVideo > ul", // Provider-Liste, NICHT der Player-Container
];

let observersInitialized = false;

async function navigateToEpisodeInPage(targetUrl) {
  const response = await fetch(targetUrl, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const html = await response.text();
  const nextDom = new DOMParser().parseFromString(html, "text/html");

  // 1. Seitenbereiche ersetzen, die die Extension auswertet
  for (const selector of EPISODE_DOM_SELECTORS) {
    const current = document.querySelector(selector);
    const next = nextDom.querySelector(selector);
    if (current && next) current.outerHTML = next.outerHTML;
  }

  // 2. Titel und URL aktualisieren (kein Reload!)
  document.title = nextDom.title;
  history.pushState({}, "", targetUrl);

  // 3. Interne Zustände der Extension neu aufbauen
  await storeAnimeInfo();
  applyPreferredLanguage();
  if (!observersInitialized) {
    observersInitialized = true;
    watchForIframes();
  }
  adaptPlayerLayout(); // Schritt 3

  // 4. Ziel-DOM zurückgeben, damit der Aufrufer die Player-URL ermitteln kann
  return nextDom;
}
```

Hinweise:

- `watchForIframes()` darf nicht bei jedem Wechsel einen zweiten `MutationObserver` anlegen; deshalb das `observersInitialized`-Flag.
- Die Selektoren müssen gegen die echte AniWorld-Seite verifiziert werden. Weicht das Layout ab, ist der Fallback (1.7) die sichere Rückfallebene.
- `fetch` mit `credentials: "same-origin"` verwenden, damit Sprache/Staffel-Markierungen korrekt geliefert werden.
- Die ersetzten Container enthalten klickbare Elemente (Episoden-Links, Provider-Buttons, Sprachwahl), an denen die Seite eigene Handler hat. Beim Ersetzen gehen diese Handler verloren. Details in 1.4.
- `popstate` (Zurück/Vor) wird nicht in-page nachgebaut. Einfachster korrekter Weg:

```js
window.addEventListener("popstate", () => window.location.reload());
```

Ohne das würde `storeAnimeInfo()` die alte URL mit dem neuen DOM kombinieren.

#### 1.4 Provider-/Sprachliste und Event-Handler

`div#stream.hosterSiteDirectNav`, `.changeLanguageBox` und `div.hosterSiteVideo > ul` enthalten klickbare Elemente, an denen die Seite eigene Handler hängen hat (`data-link-target`, `data-external-embed`, Provider-Buttons). Nach `outerHTML`-Ersetzung sind diese Handler weg.

Zwei Wege:

| Weg | Vorteil | Nachteil |
|---|---|---|
| Container ersetzen und Handler neu binden | UI zeigt die neue Folge, Provider-Wechsel funktioniert | Port von `repairWebsiteFeatures()` nötig |
| Container ersetzen, Player direkt navigieren (1.6) | Kein Handler-Port nötig | Provider-Klick lädt ggf. die Seite normal nach |

Empfehlung: **Player direkt navigieren** (1.6) und die Container trotzdem ersetzen, damit die UI stimmt. Für den laufenden VOE-Player ist kein Handler nötig, weil er bereits über die aufgelöste URL läuft. Wer den Provider wechseln will, löst dann einen normalen Seitenaufbau aus – das ist akzeptabel und robust.

Wichtig: `div.hosterSiteVideo` selbst **nicht** ersetzen, sonst wird der Player-Iframe mit ausgetauscht und die Referenz in `navigatePlayerFrame()` zeigt ins Leere.

#### 1.5 Player-URL ermitteln

Um den Player direkt zu navigieren, muss die VOE-URL aus der **Zielseite** kommen. Das macht die Extension unabhängig davon, ob die Seite ihre eigenen Provider-Handler nach dem DOM-Ersatz noch ausführt.

```js
function resolvePlayerUrl(nextDom, preferredLanguage) {
  const providers = [...nextDom.querySelectorAll("div.hosterSiteVideo > ul li[data-lang-key]")];
  const languageFiltered = preferredLanguage
    ? providers.filter((li) => li.dataset.langKey === preferredLanguage)
    : [];
  const candidates = languageFiltered.length ? languageFiltered : providers;

  for (const li of candidates) {
    for (const btn of li.querySelectorAll("div.generateInlinePlayer")) {
      const link = btn.querySelector("a[href]");
      const name = link?.querySelector("h4")?.textContent?.trim() || "";
      if (/voe/i.test(name) || /voe/i.test(link?.href || "")) {
        return link.href;
      }
    }
  }

  return null;
}
```

Hinweise:

- Die Selektoren entsprechen den `TopScopeInterface.queries` des Userscripts (`providerChangeBtn: div.generateInlinePlayer`, `providerName: div.hosterSiteVideo > ul a > h4`).
- Liefert `resolvePlayerUrl()` `null`, gibt es zwei Möglichkeiten: hart neu laden (Fullscreen-Verlust) oder in-page bleiben und den Nutzer den Provider selbst wählen lassen (kein Autoplay). Empfehlung: **hart neu laden**, damit das Verhalten deterministisch bleibt – aber geloggt, damit man die Selektoren nachziehen kann.
- Der `/r?t=…`-Redirect **muss** aufgelöst werden, damit der Frame **same-origin** (VOE → VOE) navigiert und unmuted starten darf. Das Userscript nutzt dafür `GM_xmlhttpRequest`; in der Extension übernimmt das `background.js` (dort gilt keine CORS-Beschränkung, weil `<all_urls>` freigegeben ist):

```js
// background.js – neuer Fall im runtime.onMessage-Handler
case "resolveRedirectUrl": {
  try {
    const response = await fetch(message.url, { redirect: "follow" });
    return { url: response.url };
  } catch (error) {
    return { error: error.message };
  }
}
```

```js
// aniworld.js
async function resolveRedirectUrl(url) {
  if (!/\/r\?/.test(url)) return url;

  try {
    const { url: resolved } = await browser.runtime.sendMessage({
      action: "resolveRedirectUrl",
      url,
    });
    return resolved || url;
  } catch (error) {
    console.warn("VOE AniSkip: Could not resolve provider redirect", error);
    return url;
  }
}
```

#### 1.6 Player-Iframe navigieren

Nach dem DOM-Ersatz muss der Player die neue Folge laden. Reihenfolge nach Erfolgswahrscheinlichkeit:

1. **Frame navigiert sich selbst** (wie `NAVIGATE_TO` im Userscript). Das erhält die Activation-Chain am besten.
2. Fallback: `iframe.src = url` vom Top-Frame aus.
3. Fallback: kompletter Reload (1.7).

```js
function findPlayerIframe() {
  return (
    document.querySelector('iframe[src*="voe"]') ||
    document.querySelector(".inSiteWebStream iframe") ||
    document.querySelector("#player-iframe") ||
    document.querySelector("iframe")
  );
}

function navigatePlayerFrame(url) {
  const iframe = findPlayerIframe();
  if (!iframe) return false;

  // Autoplay-Permission an den Frame delegieren
  iframe.setAttribute("allow", "autoplay; fullscreen");

  try {
    iframe.contentWindow.postMessage({ type: "ANISKIP_NAVIGATE_TO", url }, "*");
    return true;
  } catch (error) {
    console.warn("VOE AniSkip: Frame navigation failed, swapping src", error);
  }

  try {
    iframe.src = url;
    return true;
  } catch (error) {
    return false;
  }
}
```

`content.js` bekommt dafür einen kleinen Handler:

```js
if (event.data?.type === "ANISKIP_NAVIGATE_TO" && typeof event.data.url === "string") {
  window.location.href = event.data.url;
}
```

Achtung: Diesen Handler **vor** dem `state.player`-Check registrieren, damit er auch in einem noch nicht initialisierten Frame greift.

#### 1.7 Fallback: harter Reload mit `exitFullscreen()`

Wenn `fetch` oder die DOM-Ersetzung scheitert, bleibt der bisherige Weg – inklusive Fullscreen-Verlust. Der Intent muss dann in `sessionStorage` liegen, damit die neue Seite ihn findet.

```js
async function hardReloadToEpisode(targetUrl, intent) {
  saveAutoplayIntent(targetUrl, intent);

  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch (error) {
      console.warn("VOE AniSkip: exitFullscreen failed", error);
    }
  }

  window.location.href = targetUrl;
}
```

Wichtig: Dieser Pfad ist ein **Notausgang**. Er darf nie der Normalfall sein, sonst ist das Fullscreen-Ziel nicht erreichbar.

#### 1.8 `goToNextEpisode(force)` umbauen

```js
async function goToNextEpisode(force = false) {
  const { nextEpisode } = await browser.storage.local.get({
    nextEpisode: DEFAULT_SETTINGS.nextEpisode,
  });
  if (!force && nextEpisode === false) return;

  const nextInfo = getNextEpisodeUrl();
  if (!nextInfo) return;

  const targetUrl = await resolveNextEpisodeUrl(nextInfo);
  if (!targetUrl) return;

  const intent = createAutoplayIntent(targetUrl, force);
  const preferredLanguage = await loadPreferredLanguage();

  let nextDom;
  try {
    nextDom = await navigateToEpisodeInPage(targetUrl);
  } catch (error) {
    console.error("VOE AniSkip: In-page navigation failed, reloading", error);
    await hardReloadToEpisode(targetUrl, intent);
    return;
  }

  const playerUrl = await resolveRedirectUrl(resolvePlayerUrl(nextDom, preferredLanguage));
  if (!playerUrl || !navigatePlayerFrame(playerUrl)) {
    console.warn("VOE AniSkip: Could not resolve player URL, falling back to reload");
    await hardReloadToEpisode(targetUrl, intent);
    return;
  }

  armAutoplayAfterReady(intent); // Schritt 2: erst auf das neue Dokument warten
}
```

`resolveNextEpisodeUrl()` ist die bestehende Logik aus `goToNextEpisode()` (nächste Staffel → erste Folge per `fetch` ermitteln) und wird nur ausgelagert.#### 1.9 Seitenstart: Fallback-Intent aufnehmen

```js
function checkAutoPlay() {
  const intent = takeAutoplayIntent(); // nur nach einem Reload vorhanden
  if (!intent) return;
  startAutoplayDelivery(intent);
}
```

`checkAutoPlay()` bleibt an beiden bestehenden Aufrufstellen in `aniworld.js` (`DOMContentLoaded` und `readyState !== "loading"`).

**Akzeptanz für Schritt 1:**

- Beim Folgenwechsel wird **kein neues Dokument** geladen (kein erneutes `DOMContentLoaded`).
- `document.fullscreenElement` bleibt vor und nach dem Wechsel gesetzt.
- `document.title`, URL (`history.state`) und Episoden-Navigation zeigen die neue Folge.
- Schlägt der In-Page-Weg fehl, greift sichtbar der Reload-Fallback.

---

### Schritt 2: Zustellung und Handshake in `src/aniworld.js`

**Datei:** `src/aniworld.js`

1. Konstanten ergänzen:

```js
const AUTOPLAY_DELIVERY_TIMEOUT_MS = 20 * 1000;
const AUTOPLAY_DELIVERY_INTERVAL_MS = 500;
```

2. Player-Iframes robust finden (baut auf `findPlayerIframe()` aus Schritt 1 auf):

```js
function findPlayerIframes() {
  const candidates = new Set();
  const selectors = [
    'iframe[src*="voe"]',
    ".inSiteWebStream iframe",
    "#player-iframe",
    ".hosterSiteDirectNav iframe",
  ];
  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((iframe) => candidates.add(iframe));
  });
  if (candidates.size === 0) {
    const first = findPlayerIframe();
    if (first) candidates.add(first);
  }
  return [...candidates];
}
```

3. Zustellfunktion implementieren:

```js
function startAutoplayDelivery(intent) {
  let finished = false;
  let intervalId = null;
  let timeoutId = null;
  let observer = null;
  // Die Zustellfrist beginnt erst jetzt, nicht beim Speichern des Intents.
  // Sonst würde ein langsam ladendes Staffel-/Folgenende die Frist bereits verbrauchen.
  const deliveryDeadline = Date.now() + AUTOPLAY_DELIVERY_TIMEOUT_MS;

  const cleanup = () => {
    if (finished) return;
    finished = true;
    clearInterval(intervalId);
    clearTimeout(timeoutId);
    observer?.disconnect();
    window.removeEventListener("message", onMessage);
  };

  const deliver = () => {
    if (finished || Date.now() > deliveryDeadline) {
      cleanup();
      return;
    }

    findPlayerIframes().forEach((iframe) => {
      try {
        iframe.contentWindow?.postMessage(
          { type: "ANISKIP_AUTO_PLAY", id: intent.id, force: intent.force },
          "*",
        );
      } catch (error) {
        // Iframe kann gerade neu laden
      }
    });
  };

  const onMessage = (event) => {
    const data = event.data;

    // READY kommt ohne ID und bedeutet nur: Player ist bereit, Intent erneut zustellen
    if (data?.type === "ANISKIP_PLAYER_READY") {
      deliver();
      return;
    }

    if (!data || data.id !== intent.id) return;

    if (data.type === "ANISKIP_AUTOPLAY_ACK") {
      console.log("VOE AniSkip: Autoplay ACK", data.started, data.muted);
      cleanup();
    }
  };

  window.addEventListener("message", onMessage);

  // Neue Iframes (VOE lädt dynamisch) sofort bedienen, aber gedrosselt
  let observerTimer = null;
  observer = new MutationObserver(() => {
    clearTimeout(observerTimer);
    observerTimer = setTimeout(deliver, 100);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  deliver();
  intervalId = setInterval(deliver, AUTOPLAY_DELIVERY_INTERVAL_MS);
  timeoutId = setTimeout(cleanup, AUTOPLAY_DELIVERY_TIMEOUT_MS);
}
```

4. Auf das neue Dokument warten (Race vermeiden):

Nach `ANISKIP_NAVIGATE_TO` lebt das **alte** Player-Dokument noch kurz. Würde man sofort `ANISKIP_AUTO_PLAY` senden, könnte es mit `started:true` antworten und die Zustellung beenden, bevor das neue Dokument überhaupt existiert. Deshalb wird erst auf `ANISKIP_PLAYER_READY` des neuen Dokuments gewartet.

```js
let pendingAutoplay = null;

function armAutoplayAfterReady(intent) {
  pendingAutoplay = { intent, started: false };

  // Sicherheitsnetz: kein READY innerhalb von 6 s → Fallback-Reload
  setTimeout(() => {
    if (pendingAutoplay?.intent.id !== intent.id || pendingAutoplay.started) return;
    pendingAutoplay = null;
    console.warn("VOE AniSkip: Player never became ready, reloading");
    hardReloadToEpisode(intent.targetUrl, intent);
  }, 6000);
}

function handlePlayerReady() {
  if (!pendingAutoplay || pendingAutoplay.started) return;

  const { intent } = pendingAutoplay;
  pendingAutoplay.started = true;
  pendingAutoplay = null;
  startAutoplayDelivery(intent);
}
```

5. Im bestehenden `message`-Listener ergänzen:

```js
if (event.data?.type === "ANISKIP_PLAYER_READY") handlePlayerReady();
if (event.data?.type === "ANISKIP_AUTOPLAY_ACK") {
  console.log("VOE AniSkip: Autoplay ACK", event.data.started, event.data.muted);
}
```

- `ANISKIP_PLAYER_READY` startet die Zustellung für den ausstehenden Intent.
- `ANISKIP_AUTOPLAY_ACK` wird zusätzlich geloggt; das Aufräumen übernimmt `startAutoplayDelivery`.

6. Aufrufstellen prüfen:

- `checkAutoPlay()` bleibt im `DOMContentLoaded`-Block und im `readyState !== "loading"`-Zweig (Schritt 1.9).
- Nach einem Fallback-Reload darf `checkAutoPlay()` direkt `startAutoplayDelivery(intent)` aufrufen – dort gibt es kein altes Dokument, und `startAutoplayDelivery` wiederholt die Zustellung bei jedem READY.
- Der URL-Poll für SPA-Navigation bleibt unverändert.
- `history.pushState()` aus Schritt 1 löst den Poll nicht aus – das ist gewollt, weil `storeAnimeInfo()` bereits direkt aufgerufen wird.

7. `src/background.js`: Injektion bei Frame-Navigation erneuern (**kritisch**):

Beim In-Page-Wechsel bekommt der VOE-Frame ein **neues Dokument in derselben `frameId`**. `injectedFrames` wird aber nur bei einem Tab-Reload (`tabs.onUpdated`, `status === "loading"`) geleert. Ohne diese Ergänzung würde das neue Player-Dokument **kein `content.js`** erhalten – kein Overlay, kein Autoplay, kein ACK.

```js
browser.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId === 0) return;

  try {
    const tab = await browser.tabs.get(details.tabId);
    if (!tab.url || !tab.url.includes("aniworld.to")) return;
  } catch (error) {
    return;
  }

  // Neues Dokument im selben Frame → erneute Injektion erlauben
  injectedFrames.delete(`${details.tabId}-${details.frameId}`);
});
```

Alternative: `details.documentId` in den Key von `injectedFrames` aufnehmen, sofern von der Firefox-Version unterstützt.

**Akzeptanz für Schritt 2:**

- Bei jedem Folgenwechsel werden maximal 20 s lang Nachrichten gesendet.
- Ein ACK beendet die Zustellung sofort.
- Ein parallel geöffneter Tab erhält keinen Intent.
- Die Zustellung startet **ohne Reload** direkt nach `navigatePlayerFrame()`.
- Ein ACK des alten Player-Dokuments kann die Zustellung nicht vorzeitig beenden, weil auf `ANISKIP_PLAYER_READY` des neuen Dokuments gewartet wird.

---

### Schritt 3: Fullscreen im Top-Dokument verankern

**Dateien:** `src/aniworld.js`, `src/content.js`, `src/styles.css`

Ohne diesen Schritt bleibt der Fullscreen beim `src`-Wechsel des VOE-Iframes nicht erhalten – selbst dann, wenn die Seite nicht neu geladen wird.

#### 3.1 `aniworld.js`: Fullscreen selbst ausführen

`enterFullscreen()` wird ersetzt:

```js
function enterFullscreen() {
  const doc = document.documentElement;

  if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
    return;
  }

  const request = doc.requestFullscreen || doc.webkitRequestFullscreen;
  request?.call(doc).catch((error) => {
    console.warn("VOE AniSkip: Top-frame fullscreen failed", error);
  });
}
```

Der bestehende `message`-Listener ruft bereits `enterFullscreen()` bei `ANISKIP_REQUEST_FULLSCREEN` auf – dort bleibt es. Der Aufruf `ANISKIP_ENTER_FULLSCREEN` an den Iframe entfällt.

#### 3.2 `aniworld.js`: Player-Layout im Fullscreen

Nach `fullscreenchange` (Port aus `adaptFakeFullscreen()`):

```js
function adaptPlayerLayout() {
  const container =
    document.querySelector(".inSiteWebStream") ||
    document.querySelector("#player-iframe")?.parentElement;
  const iframe = findPlayerIframe();

  if (document.fullscreenElement) {
    document.body.style.overflow = "hidden";
    if (container) {
      container.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;width:100vw;height:100vh;" +
        "padding:0;margin:0;overflow:hidden;background:#000;";
    }
    if (iframe) {
      iframe.style.cssText =
        "display:block;position:absolute;inset:0;width:100vw;height:100vh;border:0;";
    }
  } else {
    document.body.style.overflow = "";
    if (container) container.style.cssText = "";
    if (iframe) iframe.style.cssText = "";
  }
}

document.addEventListener("fullscreenchange", adaptPlayerLayout);
```

Wichtig: Beim In-Page-Wechsel (Schritt 1.3) `adaptPlayerLayout()` erneut aufrufen, weil die DOM-Bereiche ersetzt wurden.

#### 3.3 `content.js`: Fullscreen-Button umleiten

`enterFullscreenFromPlayer()` wird entfernt. Der Player-Button (`.jw-icon-fullscreen`) leitet stattdessen an den Parent um:

```js
async function requestTopFullscreen() {
  // Alt-Zustand: Iframe ist noch selbst im Fullscreen → erst verlassen
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch (error) {
      // ignorieren
    }
  }
  requestFullscreen(); // sendet ANISKIP_REQUEST_FULLSCREEN an window.parent
}

const jwFullscreenBtn = document.querySelector(".jw-icon-fullscreen");
jwFullscreenBtn?.addEventListener(
  "click",
  (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    requestTopFullscreen();
  },
  true,
);
```

`requestFullscreen()` existiert bereits und sendet `ANISKIP_REQUEST_FULLSCREEN` an `window.parent`.

Falls der Button nicht ersetzt werden kann (DOM geändert), bleibt `player.setFullscreen(true)` als letzter Fallback – dann aber mit dem bekannten Nachteil, dass ein `src`-Wechsel den Fullscreen beendet. Das wird geloggt.

#### 3.4 `styles.css`: UI im Top-Frame-Fullscreen

Die bestehenden `:fullscreen`-Regeln greifen weiterhin, weil die UI im VOE-Iframe liegt und der Iframe den Bildschirm füllt. Zusätzlich muss die UI einen Sicherheitsabstand zur Browser-Fullscreen-Leiste halten:

```css
:fullscreen #aniskip-speed-control,
:fullscreen #aniskip-panel {
	bottom: 24px;
}
```

Prüfen: `.aniskip-autoplay-hint` und `#aniskip-speed-control` dürfen im Top-Frame-Fullscreen nicht hinter der Browser-Leiste verschwinden.

**Akzeptanz für Schritt 3:**

- Ein Klick auf den Fullscreen-Button im Player setzt `document.fullscreenElement` im **Top-Dokument**.
- Ein `src`-Wechsel des VOE-Iframes beendet den Fullscreen nicht.
- Der Player füllt den Bildschirm weiterhin vollständig, Navbar ist ausgeblendet.
- Der Fullscreen-Status bleibt beim In-Page-Wechsel unverändert.

---

### Schritt 4: `AutoplayController` in `src/content.js`

**Datei:** `src/content.js`

Der Controller lebt innerhalb von `runExtension()` und nutzt `state.player`, `getMessage()` und `state.settings`.

#### 4.1 Zustand und Helfer

```js
const autoplay = {
  activeId: null,
  running: false,
  started: false,
  mutedByAutoplay: false,
  mutedBlocked: false,
  playButtonClicked: false,
  hintEl: null,
  unmuteArmed: false,
};

const AUTOPLAY_BUDGET_MS = 10 * 1000;
const AUTOPLAY_RETRY_MS = 200;
const AUTOPLAY_PLAY_TIMEOUT_MS = 150;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getVideoEl() {
  return state.player?._video || document.querySelector("video") || null;
}

function isPlaybackActive() {
  try {
    const playerState = state.player?.getState?.();
    if (playerState === "playing" || playerState === "buffering") return true;
  } catch (e) {}

  const video = getVideoEl();
  return !!video && !video.paused && !video.ended;
}

function isMuted() {
  const video = getVideoEl();
  if (video) return video.muted;
  try {
    return state.player?.getMute?.() === true;
  } catch {
    return false;
  }
}

function setPlayerMuted(muted) {
  const video = getVideoEl();
  try {
    if (state.player?.setMute) state.player.setMute(muted);
  } catch (e) {}
  if (video) video.muted = muted;
}
```

#### 4.2 Play-Button-Fallback

Die vorhandenen Selektoren aus `handleAutoPlay()` werden zentralisiert:

```js
function clickPlayButtonOnce() {
  if (autoplay.playButtonClicked) return false;
  autoplay.playButtonClicked = true;

  const selectors = [
    "div.jw-icon-display",
    ".jw-display-icon-display .jw-icon-display",
    ".jw-icon-playback",
    "div.spin",
    'img.icon[src*="voe"]',
    "img.icon",
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      element.click();
      return true;
    }
  }
  return false;
}
```

#### 4.3 `playOrFix()`

Portierung aus `script.js`, angepasst an die Player-Abstraktion der Extension:

```js
async function playOrFix() {
  if (!state.player) throw new Error("player-not-ready");

  let playPromise;
  try {
    playPromise = state.player.play();
  } catch (error) {
    playPromise = Promise.reject(error);
  }

  let timedOut = false;
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      timedOut = true;
      reject(new Error("play-timeout"));
    }, AUTOPLAY_PLAY_TIMEOUT_MS);
  });

  try {
    await Promise.race([Promise.resolve(playPromise), timeoutPromise]);
  } catch (error) {
    if (timedOut) {
      // VOE: play() hängt, bis der Play-Button geklickt wurde
      clickPlayButtonOnce();
      throw error;
    }

    if (error?.name === "NotAllowedError") {
      if (autoplay.mutedByAutoplay) {
        // Auch stumm blockiert → aufgeben
        autoplay.mutedBlocked = true;
        throw error;
      }

      // Stumm schalten und im nächsten Durchlauf erneut versuchen
      setPlayerMuted(true);
      autoplay.mutedByAutoplay = true;
      showAutoplayHint("muted");
      throw error;
    }

    throw error;
  }

  // Manche Player lösen play() auf, starten aber nicht wirklich
  await delay(300);
  if (!isPlaybackActive()) {
    clickPlayButtonOnce();
    throw new Error("playback-did-not-start");
  }
}
```

Hinweis: `clickPlayButtonOnce()` wird pro Autoplay-Versuch nur einmal ausgeführt, wie im Userscript (`playBtnWasClicked`). Weitere Versuche setzen auf den stummen `play()`-Aufruf.

#### 4.4 Controller-Schleife

```js
async function runAutoplay(id, force) {
  if (autoplay.running || autoplay.started) return;
  if (autoplay.activeId !== id) resetAutoplayState(id);
  if (!force && state.settings?.nextEpisode === false) {
    sendAutoplayAck(id, false, false);
    return;
  }

  autoplay.running = true;
  autoplay.activeId = id;
  const deadline = Date.now() + AUTOPLAY_BUDGET_MS;

  try {
    while (!state.player && Date.now() < deadline) {
      await delay(200);
    }

    while (Date.now() < deadline && !autoplay.started) {
      if (isPlaybackActive()) {
        onAutoplayStarted(id);
        return;
      }

      if (autoplay.mutedBlocked) break;

      try {
        await playOrFix();
      } catch (error) {
        // bewusst geschluckt, die Schleife entscheidet über den nächsten Versuch
      }

      await delay(AUTOPLAY_RETRY_MS);
    }

    if (isPlaybackActive()) {
      onAutoplayStarted(id);
      return;
    }

    sendAutoplayAck(id, false, autoplay.mutedByAutoplay);
    showAutoplayHint("blocked");
  } finally {
    autoplay.running = false;
  }
}
```

#### 4.5 Erfolg, ACK und Unmute

```js
function onAutoplayStarted(id) {
  if (autoplay.started) return;
  autoplay.started = true;

  sendAutoplayAck(id, true, autoplay.mutedByAutoplay);

  if (autoplay.mutedByAutoplay) {
    showAutoplayHint("muted");
    armUnmute();
  }
}

function sendAutoplayAck(id, started, muted) {
  try {
    window.top.postMessage(
      { type: "ANISKIP_AUTOPLAY_ACK", id, started, muted },
      "*",
    );
  } catch (e) {}
}

function armUnmute() {
  if (autoplay.unmuteArmed) return;
  autoplay.unmuteArmed = true;

  const unmute = async () => {
    document.removeEventListener("pointerup", unmute, true);
    document.removeEventListener("keydown", unmute, true);

    // Nicht mit einem Unmute-Klick des Nutzers kollidieren
    await delay(100);

    if (autoplay.mutedByAutoplay && isMuted()) {
      setPlayerMuted(false);
      autoplay.mutedByAutoplay = false;
      hideAutoplayHint();
    }
    autoplay.unmuteArmed = false;
  };

  document.addEventListener("pointerup", unmute, true);
  document.addEventListener("keydown", unmute, true);
  autoplay.hintEl?.addEventListener("click", unmute, { once: true });
}
```

#### 4.6 Hinweis-UI

1. In `createUI()` HTML ergänzen:

```html
<div id="aniskip-autoplay-hint" class="aniskip-autoplay-hint aniskip-hidden" role="status"></div>
```

2. Funktionen:

```js
function showAutoplayHint(kind) {
  const hint = document.getElementById("aniskip-autoplay-hint");
  if (!hint) return;
  autoplay.hintEl = hint;

  hint.textContent =
    kind === "muted"
      ? getMessage("autoplayMutedHint")
      : getMessage("autoplayBlockedHint");
  hint.classList.toggle("aniskip-autoplay-hint--error", kind === "blocked");
  hint.classList.remove("aniskip-hidden");

  if (kind === "blocked") {
    // Kein Dauerbanner: nach 10 s oder beim nächsten Play ausblenden
    setTimeout(hideAutoplayHint, 10000);
  }
}

function hideAutoplayHint() {
  autoplay.hintEl?.classList.add("aniskip-hidden");
}
```

3. Übersetzungen in `content.js` ergänzen:

```js
// en
autoplayMutedHint: "Autoplay started muted — click or press any key for sound",
autoplayBlockedHint: "Autoplay was blocked — press play to start",

// de
autoplayMutedHint: "Autoplay stumm gestartet — klicken oder Taste drücken für Ton",
autoplayBlockedHint: "Autoplay wurde blockiert — Play drücken zum Starten",
```

4. Styles in `src/styles.css`:

```css
.aniskip-autoplay-hint {
	position: fixed;
	bottom: 170px;
	left: 50%;
	transform: translateX(-50%);
	z-index: 120;
	max-width: min(420px, 80vw);
	padding: 8px 14px;
	border: 1px solid var(--aniskip-border-subtle);
	border-radius: 999px;
	background: var(--aniskip-bg-glass);
	color: var(--aniskip-text-primary);
	font-size: 12px;
	text-align: center;
	cursor: pointer;
	pointer-events: auto;
	backdrop-filter: blur(8px);
}

.aniskip-autoplay-hint--error {
	border-color: var(--aniskip-error);
	color: var(--aniskip-error);
}
```

Position ggf. an die bestehende Speed-Control anpassen, damit sich nichts überlappt.

#### 4.7 Integration in `init()` und Message-Listener

1. In `init()` nach `state.player = await waitForPlayer();` bzw. nach erfolgreicher Initialisierung:

```js
window.top.postMessage({ type: "ANISKIP_PLAYER_READY" }, "*");

// „Play drücken“-Hinweis ausblenden, sobald der Nutzer selbst startet
state.player.on("play", hideAutoplayHint);
getVideoEl()?.addEventListener("play", hideAutoplayHint);
```

2. Im bestehenden `window.addEventListener("message", ...)` (Z. 1515–1521) ergänzen:

```js
if (event.data?.type === "ANISKIP_AUTO_PLAY") {
  runAutoplay(String(event.data.id || ""), event.data.force === true);
}

// Self-navigation: der Frame wechselt selbst zur nächsten Folge
if (event.data?.type === "ANISKIP_NAVIGATE_TO" && typeof event.data.url === "string") {
  window.location.href = event.data.url;
}
```

Der `ANISKIP_NAVIGATE_TO`-Handler muss **vor** dem `state.player`-Check registriert sein, damit er auch in einem noch nicht initialisierten Frame greift.

3. `checkShouldAutoPlay()` und `handleAutoPlay()` entfernen. Die beiden Aufrufe in `init()` (Z. 1651 und 1763) entfallen. Ebenso `enterFullscreenFromPlayer()` und der `ANISKIP_ENTER_FULLSCREEN`-Zweig (Schritt 3.3).

4. `autoplay`-Zustand bei einem neuen `ANISKIP_AUTO_PLAY` mit anderer ID zurücksetzen:

```js
function resetAutoplayState(id) {
  if (autoplay.activeId === id) return;
  autoplay.activeId = id;
  autoplay.started = false;
  autoplay.mutedByAutoplay = false;
  autoplay.mutedBlocked = false;
  autoplay.playButtonClicked = false;
}
```

**Akzeptanz für Schritt 4:**

- `video.paused` ist nach erfolgreichem Autoplay `false`.
- Bei blockiertem Ton startet das Video stumm und zeigt den Hinweis.
- Die erste Interaktion entstummt innerhalb von ca. 100 ms.
- Bei komplett blockiertem Autoplay gibt es keinen Endlos-Retry; nach 10 s erscheint der „Play drücken“-Hinweis.

---

### Schritt 5: Einstellung „Next Episode“ anpassen

**Dateien:** `src/popup.js`, `src/popup.html`, `README.md`, `docs/index.html`

Der Schlüssel `nextEpisode` bleibt unverändert, nur die Beschreibung wird ehrlich:

| Ort | Alt | Neu |
|---|---|---|
| `popup.js` en | `labelNextEpisode: "Next Episode"` | `"Next Episode & Autoplay"` |
| `popup.js` en | `descNextEpisode: "Auto navigate to the next episode"` | `"Go to the next episode and start playback without leaving fullscreen"` |
| `popup.js` de | `labelNextEpisode: "Nächste Folge"` | `"Nächste Folge & Autoplay"` |
| `popup.js` de | `descNextEpisode: "Automatisch zur nächsten Folge navigieren"` | `"Automatisch zur nächsten Folge wechseln und abspielen – ohne Fullscreen zu verlassen"` |
| `popup.html` Fallback | `Next Episode` / `Auto navigate to the next episode` | gleicher neuer Text |
| `README.md` | „Navigate automatically at the end …“ | „Switches to the next episode in place, starts playback automatically and stays in fullscreen (muted fallback until the first interaction)“ |
| `docs/index.html` (Z. 1414–1417) | „Navigates to the next episode at the end of the current one.“ | zusätzlich In-Page-Wechsel, Autoplay, Fullscreen-Erhalt und Mute-Fallback erwähnen |

Wichtig: **Kein neuer Eintrag in `DEFAULT_SETTINGS`**, keine neue Zeile in `popup.html` und keine zusätzliche Abhängigkeit. `nextEpisode` bleibt der einzige Schalter.

Optional, aber empfohlen: Im Popup einen kurzen Hinweis in der Beschreibung, dass Ton ggf. erst nach der ersten Interaktion aktiviert wird. Das verhindert Support-Fragen.

---

### Schritt 6: Aufräumen und Migration

**Dateien:** `src/aniworld.js`, `src/content.js`, `src/background.js` (Migration)

1. Alle alten Autoplay-Schlüssel entfernen:

```js
autoPlayNextFlag;   // und der dazugehörige Top-Level-Key "timestamp"
shouldAutoPlay;
autoPlayTimestamp;
```

Wichtig: Nur den Autoplay-`timestamp` entfernen. `timestamp` innerhalb von `aniWorldInfo` (Anime-Info-Cache) bleibt unverändert.

2. Beim Start einmalig alte Werte löschen, damit bestehende Installationen sauber sind:

```js
browser.storage.local.remove([
  "autoPlayNextFlag",
  "shouldAutoPlay",
  "autoPlayTimestamp",
]);
```

Das kann in `aniworld.js` beim ersten `DOMContentLoaded` oder in `background.js` beim Start erfolgen. Empfehlung: `background.js` beim Start, weil dort ohnehin Initialisierung stattfindet.

3. Sicherstellen, dass keine doppelten Autoplay-Pfade mehr existieren:

- `checkShouldAutoPlay` darf nicht mehr aufgerufen werden.
- `handleAutoPlay` darf nicht mehr existieren.
- `waitForPlayerAndPlay` darf nicht mehr existieren.
- `ANISKIP_AUTO_PLAY` wird nur noch von `startAutoplayDelivery` gesendet.
- `ANISKIP_ENTER_FULLSCREEN` wird nirgends mehr gesendet oder verarbeitet.
- `enterFullscreenFromPlayer` darf nicht mehr existieren.
- `window.location.href` kommt in `goToNextEpisode()` nicht mehr vor (nur noch in `hardReloadToEpisode()`).

**Akzeptanz für Schritt 6:**

```bash
grep -rn "autoPlayNextFlag\|shouldAutoPlay\|autoPlayTimestamp\|checkShouldAutoPlay\|handleAutoPlay\|waitForPlayerAndPlay" src/
grep -rn "ANISKIP_ENTER_FULLSCREEN\|enterFullscreenFromPlayer" src/
```

liefert nur noch den einmaligen Migrationsblock in `background.js` (Löschen der Altlasten), keine aktiven Autoplay- oder Fullscreen-Pfade mehr.

---

### Schritt 7: Testplan

#### Manuelle Tests (Desktop-Firefox 142+)

| ID | Szenario | Erwartung |
|---|---|---|
| A1 | `nextEpisode` an, Folge **im Fullscreen** bis zum Ende schauen | Nächste Folge lädt ohne Reload, Wiedergabe startet innerhalb von 10 s, **Fullscreen bleibt durchgehend aktiv** (kein Ausstieg, kein Flackern) |
| A2 | `nextEpisode` an, nahe dem Ende im Fullscreen den Next-Button drücken | In-Page-Wechsel + Autoplay, **Fullscreen bleibt** |
| A3 | `nextEpisode` aus, Folge bis zum Ende schauen | Kein Folgenwechsel, kein Autoplay; Folge wird als gesehen markiert |
| A4 | `nextEpisode` aus, manueller Next-Button | In-Page-Wechsel + Autoplay (force), Fullscreen bleibt |
| A5 | Browser blockiert Ton (`media.autoplay.blocking_policy = 2` o. Ä.) | Video startet stumm, Hinweis erscheint, erster Klick/Tastendruck entstummt |
| A6 | Nutzer klickt während des Autoplay-Versuchs auf Play | Wiedergabe startet, Controller beendet sich, kein Doppel-Play |
| A7 | Nutzer pausiert direkt nach dem Start | Pause bleibt bestehen, Controller startet nicht erneut |
| A8 | Langsame Verbindung (Throttling) | Intent bleibt gültig, Autoplay startet nach Player-Bereitschaft |
| A9 | Tab im Hintergrund | Stummes Autoplay startet; beim Zurückkehren ggf. Hinweis sichtbar |
| A10 | Zwei AniWorld-Tabs parallel | Nur der Tab mit dem Intent startet automatisch |
| A11 | VOE-Play-Button hängt (`play()` löst nicht auf) | Nach Timeout wird `div.jw-icon-display` geklickt, Wiedergabe startet |
| A12 | Nativer `<video>`-Fallback (kein JWPlayer) | Autoplay und Mute-Fallback funktionieren über `video.play()` |
| A13 | Provider-Wechsel innerhalb der Folge | Kein unerwünschtes Autoplay (kein Intent) |
| A14 | Seite neu laden ohne Folgenwechsel | Kein Autoplay, kein hängender Intent |
| A15 | `sessionStorage` blockiert (Testweise überschreiben) | Kein Autoplay, aber sauberer Log und keine Exception |
| A16 | Fullscreen **vor** dem Wechsel betreten, Wechsel abwarten | `document.fullscreenElement` ist vor und nach dem Wechsel gesetzt, ohne Zwischenzustand |
| A17 | Fullscreen **nicht** aktiv, Wechsel abwarten | Kein Fullscreen wird erzwungen; Seite bleibt im normalen Layout |
| A18 | Während des Wechsels Fullscreen-Button drücken | Fullscreen toggelt sauber, Autoplay läuft weiter |
| A19 | `history.back()` nach In-Page-Wechsel | Vorherige Folge wird geladen (oder sauberer Reload), kein doppelter Autoplay |
| A20 | In-Page-Wechsel schlägt fehl (fetch blockiert) | Reload-Fallback greift, Intent aus `sessionStorage` startet Autoplay |
| A21 | ESC im Fullscreen während des Wechsels | Fullscreen endet auf Nutzerwunsch, Autoplay läuft weiter, Layout wird zurückgesetzt |
| A22 | Provider-Link ist ein `/r?t=…`-Redirect | Redirect wird aufgelöst, der Frame navigiert same-origin (VOE → VOE), Wiedergabe startet **mit Ton** |

#### Tests auf Firefox für Android

| ID | Szenario | Erwartung |
|---|---|---|
| M1 | `nextEpisode` an, Folge endet | Autoplay startet stumm, Hinweis sichtbar |
| M2 | Erster Tap nach stummem Start | Ton an, Hinweis verschwindet |
| M3 | Manueller Next-Button | Navigation + Autoplay |
| M4 | Bildschirm gesperrt/App im Hintergrund | Kein Crash; nach Rückkehr konsistenter Zustand |
| M5 | Folge im Querformat-Fullscreen bis zum Ende | Wechsel ohne Reload, Autoplay, Fullscreen bleibt (bzw. Querformat-Layout bleibt bildschirmfüllend) |
| M6 | Gerät drehen während des Wechsels | Layout bleibt konsistent, kein schwarzer Bildschirm |

#### Regressionstests

- Skip-Button, Speed-Control, Next-Episode-Button und Info-Panel funktionieren unverändert.
- `settingsUpdated` aktualisiert weiterhin Theme, Sprache und Sichtbarkeiten.
- Fortschrittsbalken-Marker erscheinen weiterhin.
- `ANISKIP_MARK_SEEN` markiert die Folge und navigiert nur bei `nextEpisode = true`.
- `ANISKIP_REQUEST_FULLSCREEN` setzt jetzt Fullscreen im Top-Dokument.
- Der Player füllt im Fullscreen weiterhin den gesamten Bildschirm.
- Keine Konsolenfehler beim Laden der Extension.

#### Technische Checks

```bash
# Syntaxprüfung ohne Build-Toolchain
node --check src/aniworld.js
node --check src/content.js
node --check src/background.js

# Packaging
./pack.sh

# Optional: Lint
web-ext lint
```

---

### Schritt 8: Release

1. `version` in `manifest.json` erhöhen (z. B. `1.7.2` → `1.8.0`, da neues Verhalten).
2. `README.md` und `docs/index.html` aktualisieren:
   - Feature-Beschreibung „Next Episode“,
   - ggf. Screenshot/Hinweis zum stummen Autoplay.
3. `./pack.sh` bzw. `pack.ps1` ausführen.
4. In Firefox testen:
   - `about:debugging` → Add-on neu laden,
   - Testmatrix A1–A15 und M1–M4 durchgehen.
5. Commit + Push auf `main`; die GitHub Action erzeugt bei Versionsänderung Tag und Release.
6. Falls AMO aktiv: Freigabe abwarten und Update prüfen.

---

## 6. Grenzfälle und Verhalten

| Situation | Verhalten |
|---|---|
| Nutzer hat `nextEpisode` aus | Kein Intent, kein Autoplay; manueller Button nutzt `force` |
| Nutzer klickt während des Versuchs | Kein Abbruch der Wiedergabe; Unmute erfolgt nach 100 ms, falls nötig |
| Nutzer pausiert nach dem Start | Controller ist bereits beendet und überschreibt die Pause nicht |
| `play()` wirft `NotAllowedError` | Einmal stumm schalten, erneut versuchen |
| Stumm ebenfalls blockiert | Nach 10 s aufgeben, Hinweis „Play drücken“ |
| `play()` hängt (VOE) | Nach 150 ms einmalig `div.jw-icon-display` klicken |
| Mehrere Iframes | Nur Kandidaten-Iframes werden angesprochen; ACK per ID beendet die Zustellung |
| Iframe lädt später | `MutationObserver` + 500-ms-Intervall + `ANISKIP_PLAYER_READY` |
| In-Page-Wechsel schlägt fehl | `hardReloadToEpisode()`: `exitFullscreen()` + Reload, Intent aus `sessionStorage` |
| Navigation schlägt fehl | Intent bleibt max. 90 s; Ziel-URL-Prüfung verhindert falschen Autoplay |
| Zwei Tabs | `sessionStorage` isoliert pro Tab |
| Kein `sessionStorage` | Kein Autoplay über einen Reload hinweg, aber sauberer Fallback |
| Popup ändert `nextEpisode` während der Navigation | Content prüft `state.settings.nextEpisode` erneut (außer `force`) |
| bfcache/ Zurück-Navigation | Kein Autoplay, da Intent bereits konsumiert wurde |
| Fullscreen war aktiv | In-Page-Wechsel lässt `document.fullscreenElement` unangetastet |
| Fullscreen war nicht aktiv | Es wird kein Fullscreen erzwungen |
| Nutzer drückt ESC im Fullscreen | Fullscreen endet auf Wunsch; `adaptPlayerLayout()` setzt das Layout zurück |
| Fullscreen-Element liegt noch im Iframe (Alt-Zustand) | Einmaliger Wechsel auf Top-Frame-Fullscreen beim nächsten Klick; danach bleibt er erhalten |

---

## 7. Akzeptanzkriterien

- [ ] Bei `nextEpisode = true` startet die nächste Folge nach dem automatischen Wechsel ohne Klick.
- [ ] Der Wechsel passiert **ohne vollständigen Seiten-Reload** (kein erneutes `DOMContentLoaded`).
- [ ] War der Fullscreen vor dem Wechsel aktiv, ist er danach **durchgehend** aktiv – ohne sichtbaren Ausstieg.
- [ ] Bei `nextEpisode = false` findet kein automatischer Wechsel und kein Autoplay statt.
- [ ] Der manuelle Next-Episode-Button wechselt und startet die Wiedergabe immer.
- [ ] Die Wiedergabe startet im Normalfall **mit Ton** (wie im Userscript); andernfalls greift der Mute-Fallback.
- [ ] Wenn der Browser Ton blockiert, startet die Wiedergabe stumm und entstummt bei der ersten Interaktion.
- [ ] Wenn Autoplay vollständig blockiert ist, erscheint nach spätestens 10 s ein klarer Hinweis; es gibt keine Endlosschleife.
- [ ] Ein bereits laufendes Video wird nicht erneut gestartet oder pausiert.
- [ ] Zwei parallele Tabs beeinflussen sich nicht.
- [ ] Es gibt keine alten Storage-Flags und keine doppelten Autoplay-Pfade.
- [ ] `node --check` und `./pack.sh` laufen fehlerfrei.
- [ ] Desktop- und Android-Testmatrix sind erfolgreich.

---

## 8. Risiken und Gegenmaßnahmen

| Risiko | Auswirkung | Gegenmaßnahme |
|---|---|---|
| In-Page-DOM-Ersatz trifft falsche Selektoren | Seite wirkt nach dem Wechsel kaputt | Selektoren zentral in `EPISODE_DOM_SELECTORS`; Fallback-Reload bei jedem Fehler |
| AniWorld ändert das Seitenlayout | In-Page-Wechsel scheitert | Fallback `hardReloadToEpisode()`; Selektoren leicht erweiterbar |
| Fullscreen bleibt im Iframe verankert | Fullscreen geht beim `src`-Wechsel verloren | Schritt 3: Fullscreen zwingend im Top-Dokument anfordern |
| Top-Frame-`requestFullscreen` wird abgelehnt | Kein Fullscreen möglich | Fallback auf `player.setFullscreen(true)` mit Log-Hinweis |
| Stummer Start irritiert Nutzer | Schlechtere UX | Sichtbarer Hinweis + automatisches Entstummen bei erster Interaktion |
| Firefox blockiert auch stumm | Kein Autoplay möglich | Klarer „Play drücken“-Hinweis, kein Endlos-Retry |
| VOE ändert Play-Button-DOM | Fallback greift nicht | Selektoren zentral in `clickPlayButtonOnce()`; leicht erweiterbar |
| `play()`-Promise hängt | Schleife blockiert | `Promise.race` mit 150-ms-Timeout (aus dem Userscript übernommen) |
| Iframe-Timing | Autoplay kommt zu spät | 20-s-Zustellung, MutationObserver, Player-Ready-Handshake |
| `sessionStorage` nicht verfügbar | Kein Autoplay nach Reload | Loggen, sauber ohne Autoplay weiterlaufen |
| Zu viele gleichzeitige Play-Versuche | Player-Flackern | Ein Controller pro Frame, `running`/`started`-Guard, ein Play-Button-Klick |
| Einstellung `nextEpisode` wird umgangen | Unerwartetes Autoplay | Intent nur bei `nextEpisode` oder `force`; Content prüft erneut |

---

## 9. Bewusst nicht im Scope

- Erzwungenes Unmuted-Autoplay, wenn Firefox die Activation-Chain komplett verweigert (dann greift der Mute-Fallback).
- Autoplay beim direkten Öffnen einer Episoden-URL (nur nach Next-Episode-Navigation).
- Persistente Lautstärke-/Mute-Einstellung (wie im Userscript).
- Autoplay-Toggle im Player.
- Sleeptimer, Binge-Statistik, Positionsspeicher.
- Wiederherstellung des Fullscreens nach einem **Fallback-Reload** (dort ist der Verlust akzeptiert).
- Neue S.to-Layout-Varianten oder andere Domains.
- Provider-Wechsel oder Vidoza/Vidmoly-Unterstützung.
- Änderungen an der Skip-Logik oder am AniSkip-Caching.

---

## 10. Reihenfolge und Aufwand

| Schritt | Inhalt | Aufwand |
|---|---|---|
| 1 | In-Page-Folgenwechsel + Intent in `aniworld.js` | ca. 1 Tag |
| 2 | Zustellung, MutationObserver, ACK/Ready-Handshake, Re-Injektion in `background.js` | ca. 0,75 Tag |
| 3 | Fullscreen im Top-Dokument verankern | ca. 0,5 Tag |
| 4 | `AutoplayController` + Hinweis-UI in `content.js`/`styles.css` | ca. 1 Tag |
| 5 | Texte, README, Docs | ca. 0,25 Tag |
| 6 | Aufräumen/Migration | ca. 0,25 Tag |
| 7 | Manuelle Testmatrix Desktop/Android | ca. 0,5–1 Tag |
| 8 | Release/Versionsbump | ca. 0,25 Tag |
| **Gesamt** | | **ca. 4–5 Tage** |

Die Schritte 1–3 bauen aufeinander auf und sollten in dieser Reihenfolge umgesetzt werden. Schritt 4 ist der Kern des Autoplay-Verhaltens; er setzt voraus, dass Folgenwechsel und Fullscreen-Verankerung zuverlässig funktionieren. Die Texte (Schritt 5) können parallel zu Schritt 4 erledigt werden.

---

## 11. Zusammenfassung der Dateiänderungen

| Datei | Änderung |
|---|---|
| `src/aniworld.js` | In-Page-Folgenwechsel (`fetch` + DOM-Ersatz + `pushState`), Intent im Speicher + `sessionStorage`-Fallback, Zustellschleife, ACK/Ready-Handshake, Top-Frame-Fullscreen, `allow="autoplay; fullscreen"`, alte Flags entfernen |
| `src/content.js` | `AutoplayController`, `playOrFix()`, Mute-Fallback, Unmute, Hinweis-UI, `ANISKIP_NAVIGATE_TO`-Handler, Fullscreen-Button an Parent umleiten, alte Autoplay-/Fullscreen-Funktionen entfernen |
| `src/styles.css` | Styles für `.aniskip-autoplay-hint`, Abstand der UI im Top-Frame-Fullscreen |
| `src/defaults.js` | **keine Änderung** (Autoplay nutzt `nextEpisode`) |
| `src/popup.js` | Labels/Beschreibungen für `nextEpisode` (en/de) |
| `src/popup.html` | Fallback-Texte derselben Zeile |
| `src/background.js` | Injektion bei Frame-Navigation erneuern (`webNavigation.onCommitted`), `resolveRedirectUrl`-Action, einmaliges Löschen alter Storage-Schlüssel |
| `README.md` | Feature-Beschreibung „Next Episode“ |
| `docs/index.html` | Einstellungsreferenz „Next episode“ |
| `manifest.json` | Versionsbump für das Release |
