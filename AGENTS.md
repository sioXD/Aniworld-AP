# AniWorld AP — Agent Guide

## Project

Firefox WebExtension (Manifest V2) that auto-skips anime openings/endings on aniworld.to using the AniSkip API. Fork of the original AniWorld AP with additional features.

## Key facts

- **Zero toolchain.** Vanilla JS, no package.json, no npm, no bundler, no TypeScript, no tests.
- **Firefox-only.** Uses `browser.*` API. Not compatible with Chrome/Chromium.
- **No dev server.** Load via `about:debugging` → This Firefox → Load Temporary Add-on → `manifest.json`.
- **Packaging:** `powershell -File pack.ps1` (requires `npm install --global web-ext`). Produces `.zip` via `web-ext build`. Ignore rules for `lint`/`build`/`sign` live in `.web-ext-config.mjs` — never add `--ignore-files` flags back to the scripts.
- **Release:** Change the `version` field in `manifest.json` and push the commit to `main` → GitHub Actions in `.github/workflows/release.yml` detects the version change, creates the matching `v<version>` Git tag and Release with the built artifact. Optionally publishes to AMO if `AMO_ENABLED` variable and `AMO_JWT_ISSUER`/`AMO_JWT_SECRET` secrets are set. The popup footer shows the version from `runtime.getManifest()` and a build date that `pack.*` stamps into `<span id="releaseDate">` — never hardcode those two strings by hand. The docs page carries the version by hand in three places (topnav chip, hero fact, Overview table) — update them in the same commit as the bump.
- **Entrypoints:** `src/background/background.js` (persistent background), `src/aniworld/aniworld.js` (aniworld.to content script), `src/aniworld/autoplay-frame.js` (document_start helper that delegates autoplay to the player iframe), `src/player/*.js` (six classic scripts injected into the VOE iframe), `src/popup/popup.js` (settings popup).
- **Shared modules (`src/shared/`, no build step):** `defaults.js` (`DEFAULT_SETTINGS`), `i18n.js` (`TRANSLATIONS` + `translateMessage()`), `util.js` (`hexToRgba`, `formatTime`, `parseTime`), `protocol.js` (`MSG`, `STORAGE`, `POST_MSG`, `AUTOPLAY_REQUEST_TTL_MS`). They are plain classic scripts that fill globals, loaded before their consumers: `manifest.json` (`background.scripts`, `content_scripts`) and `popup.html` (`<script>` tags) for the static surfaces, and `injectContentScript()` in `background.js` for the player frame (`defaults → i18n → util → protocol → player → persistence → ui → panel → skip → bootstrap`).

## Architecture

- `background.js` proxies AniSkip/Jikan API calls, injects the six player scripts + `styles.css` into VOE iframes via `webNavigation.onCompleted`.
- `aniworld.js` parses anime/episode/season from breadcrumbs/DOM, handles next-episode navigation and language selection. `autoplay-frame.js` sets `allow="autoplay *"` on the VOE iframe at `document_start`, because Firefox evaluates the autoplay permission policy at navigation time.
- The player scripts (`src/player/`) run inside the VOE iframe and share one global scope, because content scripts have no module system:
  - `player.js` — VOE detection, the JWPlayer/video wrapper, seeking, speed, fullscreen and the autoplay attempt.
  - `persistence.js` — remembers the playback speed across episodes/providers.
  - `ui.js` — overlay container, theme, labels, status line, next-episode control-bar button.
  - `panel.js` — AniSkip panel: MAL search, segment list, manual skip-time submission.
  - `skip.js` — progress-bar markers, auto-skip, skip button and save confirmation.
  - `bootstrap.js` — loads last: `state`, anime-info parsing, `init()`, cross-frame listeners, startup guard.
- MAL lookup: `init()` never trusts the first search hit. `pickBestMatch()` in `bootstrap.js` scores every candidate by title similarity, season marker and format/episode count against the parsed page info, and keeps the API order only for ties. It relies on the background returning `mal_id`, `title`, `type` and `episodes` from both AniList and Kitsu — dropping one of those fields silently weakens the scoring.
- Autoplay across episodes works **without a page reload**. A full navigation replaces the top-level document, and Firefox only permits audible playback while that document still has its sticky user activation — that is why the next episode must not be loaded by reloading the page. `goToNextEpisode()` therefore calls `switchEpisodeInPlace()`: it fetches the next episode page, mirrors the site's language/hoster choice (`pickStreamTarget()`), patches URL (`history.pushState`), breadcrumbs, `.hosterSiteDirectNav` and `.hosterSiteTitle` from the fetched document, and then points the existing `.inSiteWebStream iframe` at the new `/redirect/…` target. The keys `shouldAutoPlay`/`autoPlayRequestedAt`/`autoPlayTarget` (the target is `generateVideoId()` from `src/shared/util.js`) are written *before* the iframe navigates; the request is scoped to that episode so the outgoing player ignores it. `handleAutoPlay()` calls `video.play()` and, if Firefox still rejects with `NotAllowedError`, shows the autoplay notice with the Firefox help link. The full-reload path (`autoPlayNextFlag`/`flaggedAt` → `checkAutoPlay()` on the next page) remains only as a fallback when the fetched page has no inline player. Never replace that with a silent muted start — a muted autoplay was explicitly rejected.
- `background.js` keys its injection cache by `details.documentId`, not only by tab/frame: an in-place switch navigates the same iframe to a new document, which must get the player scripts again.
- Cross-frame messaging via `postMessage` (`ANISKIP_NEXT_EPISODE`, `ANISKIP_MARK_SEEN`, `ANISKIP_REQUEST_NEXT_EPISODE_STATUS`, fullscreen, anime info).
- Settings stored in `browser.storage.local`; cached anime lookups stored same way.

## Conventions

- i18n: one translation object in `src/shared/i18n.js` (`TRANSLATIONS`, en/de) serves both the popup and the injected overlay; consumers call `translateMessage(language, key, fallback)`. `data-i18n` attributes on HTML elements. There is no `_locales/` and no `browser.i18n.getMessage()` — the add-on name and description are hardcoded in `manifest.json`, because the UI language follows the popup setting and `browser.i18n` cannot be switched at runtime.
- Theming: CSS custom properties. The injected overlay (`styles.css`) selects on `.theme-classic` / `.theme-aniworld`, which `applyContainerTheme()` in `ui.js` sets as a class on `#aniskip-container` — it swaps only the theme classes, never `className` wholesale, so other classes on the container survive live theme switches; the popup (`popup.html` inline `<style>`) selects on `body[data-theme="classic"]` / `body[data-theme="aniworld"]`, set by `applyTheme()` in `popup.js`.
- Always use `browser.storage.local.get()` with default values (not bare key access). The defaults live in `src/shared/defaults.js` as `DEFAULT_SETTINGS` - never inline a literal that exists there.
- Adding a setting = one entry in `DEFAULT_SETTINGS`, one `.setting-row` in the matching tab panel of `popup.html` (id must match the key, no `checked`/`value` attributes), and one entry per language in `TRANSLATIONS` in `src/shared/i18n.js`. `popup.js` collects controls from the DOM and derives load/save from the element type, so no list needs updating.
- Message actions, storage keys and `postMessage` types are constants in `src/shared/protocol.js` (`MSG.*`, `STORAGE.*`, `POST_MSG.*`) — never write the raw strings again. A typo in a literal fails silently because the listener simply never matches.
- Settings changes need no message: the popup saves through `MSG.saveSettings`, the background writes `storage.local`, and every player frame reacts to `browser.storage.onChanged`. Do not reintroduce a popup→tab `settingsUpdated` message.
- The popup has three tabs (General / Styles / Advanced) built from `.tab` buttons + `.tab-panel` divs. The active tab is a folder tab that merges into the `.content` panel: it takes `--bg-secondary` and gets concave fillets from `.tab.active::before/::after` (a radial gradient carves the quarter circle — do not go back to `border-radius`, that produces convex bumps). `initTabs()` sets `body[data-active-tab]`, which rounds the panel's top corners except the side the active tab sits on. `.content` keeps a 10px `border-top` of `--bg-secondary` so scrolled rows are clipped below the fillets. Inside a panel, rows are grouped in `.section` blocks with `.section-header` / `.section-title`. A row with `data-depends-on` must sit in the same panel as its parent control, otherwise the disabled state points at a switch the user cannot see.
- Popup height is capped at 600px by Firefox/Chrome: `.content` uses `max-height: 360px`, keep header + tabs + content + footer under that.
- Manual testing only: load in Firefox, navigate to aniworld.to, test with various anime/episodes. The checklist lives in **Manual smoke test** below.

## Manual smoke test

Run before a release, and after changes to the player scripts or the storage/protocol layer. Reload the add-on in `about:debugging` first, then open a real episode (VOE host). Check the browser console for errors — everything is logged under the `VOE AniSkip:` prefix.

- **Startup:** overlay appears on the player, toggle button opens/closes the panel, status line resolves, no console errors. The panel is skipped when the frame is not a VOE player.
- **Anime info:** title, season and episode match the aniworld.to page; MAL ID is filled.
- **MAL match:** use a series with several seasons — the MAL ID must belong to the same season, not the first search hit (`pickBestMatch()`). Change the MAL ID manually via *Change* and verify the segments reload.
- **Markers:** OP/ED/recap markers appear on the progress bar with the configured colors and opacity.
- **Auto-skip:** enable `autoSkipOp`, `autoSkipEd`, `autoSkipRecap` one at a time; the player seeks past the segment, `skipOffset` is applied, and the skip button does not reappear for the same segment.
- **Skip button:** click it, then the ✓ save confirmation — the segment is submitted and survives a panel refresh. ✗ dismisses without saving.
- **Panel:** search for an anime, submit manual skip times (type + *Set* for start/end), refresh the segment list, up/down vote on a segment.
- **Speed:** the speed control shows/hides with `showSpeedControl`, −/display/+ work, and `persistentSpeed` keeps the value across an episode change and a provider switch.
- **Next episode:** the control-bar button appears, its label is correct, clicking it advances, `nextEpisode` and mark-seen still work. The page must **not** reload: the address bar, the breadcrumb and the episode list switch to the next episode while the rest of the page stays alive. Going back with the browser button reloads the previous episode.
- **Autoplay:** finish an episode (or click the next-episode button) with the default Firefox settings — no autoplay permission, no muted start. The next episode must start **with sound** in the same page, and the overlay/MAL match must show the new episode number. Verify the same across a season boundary.
- **Autoplay fallback:** only when an episode has no inline hoster (external embed), the page reloads and the *Autoplay blocked* notice may appear. *Retry* attempts playback again from the click handler (a real user gesture); *Autoplay help* opens the official Firefox support article in a new tab (extensions cannot open `about:preferences`).
- **Live settings:** with an episode playing, change language, theme, marker colors/opacity and a skip toggle in the popup — the overlay updates without a reload, and the theme switch keeps any other container classes.
- **Fullscreen:** enter and leave fullscreen; overlay, panel and markers stay usable.
- **Missing data:** an episode without AniSkip segments shows an empty/error state instead of breaking the panel.

## Gotchas

- `bootstrap.js` skips startup if `window.location.hostname` includes `aniworld.to` — the player only runs inside the VOE iframe. Its `isPlayerFrame()` also skips a top-level window unless the host includes `voe`.
- `background.js` ignores top-level frames (`frameId === 0`) — it only injects into subframes whose parent is aniworld.to.
- No source maps, no debug builds. Edit → reload in `about:debugging` → test.
