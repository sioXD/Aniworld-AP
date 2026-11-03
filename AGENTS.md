# AniWorld AP — Agent Guide

## Project

Firefox WebExtension (Manifest V2) that auto-skips anime openings/endings on aniworld.to using the AniSkip API. Fork of the original AniWorld AP with additional features.

## Key facts

- **Zero toolchain.** Vanilla JS, no package.json, no npm, no bundler, no TypeScript, no tests.
- **Firefox-only.** Uses `browser.*` API. Not compatible with Chrome/Chromium.
- **No dev server.** Load via `about:debugging` → This Firefox → Load Temporary Add-on → `manifest.json`.
- **Packaging:** `powershell -File pack.ps1` (requires `npm install --global web-ext`). Produces `.zip` via `web-ext build`. Ignore rules for `lint`/`build`/`sign` live in `.web-ext-config.mjs` — never add `--ignore-files` flags back to the scripts.
- **Release:** Change the `version` field in `manifest.json` and push the commit to `main` → GitHub Actions in `.github/workflows/release.yml` detects the version change, creates the matching `v<version>` Git tag and Release with the built artifact. Optionally publishes to AMO if `AMO_ENABLED` variable and `AMO_JWT_ISSUER`/`AMO_JWT_SECRET` secrets are set. The popup footer shows the version from `runtime.getManifest()` and a build date that `pack.*` stamps into `<span id="releaseDate">` — never hardcode those two strings by hand. The docs page carries the version by hand in three places (topnav chip, hero fact, Overview table) — update them in the same commit as the bump.
- **Entrypoints:** `src/background/background.js` (persistent background), `src/aniworld/aniworld.js` (aniworld.to content script), `src/player/content.js` (injected into VOE iframe), `src/popup/popup.js` (settings popup).
- **Shared modules (`src/shared/`, no build step):** `defaults.js` (`DEFAULT_SETTINGS`), `i18n.js` (`TRANSLATIONS` + `translateMessage()`), `util.js` (`hexToRgba`, `formatTime`, `parseTime`), `protocol.js` (`MSG`, `STORAGE`, `POST_MSG`, `AUTOPLAY_REQUEST_TTL_MS`). They are plain classic scripts that fill globals, loaded before their consumers: `manifest.json` (`background.scripts`, `content_scripts`) and `popup.html` (`<script>` tags) for the static surfaces, and `injectContentScript()` in `background.js` for the player frame (`defaults → i18n → util → protocol → content`).

## Architecture

- `background.js` proxies AniSkip/Jikan API calls, injects `content.js` + `styles.css` into VOE iframes via `webNavigation.onCompleted`.
- `aniworld.js` parses anime/episode/season from breadcrumbs/DOM, handles next-episode navigation and language selection.
- `content.js` runs inside the VOE player iframe, manages skip logic, progress bar markers and speed control.
- Cross-frame messaging via `postMessage` (`ANISKIP_NEXT_EPISODE`, `ANISKIP_MARK_SEEN`, `ANISKIP_AUTO_PLAY`, etc.).
- Settings stored in `browser.storage.local`; cached anime lookups stored same way.

## Conventions

- i18n: one translation object in `src/shared/i18n.js` (`TRANSLATIONS`, en/de) serves both the popup and the injected overlay; consumers call `translateMessage(language, key, fallback)`. `data-i18n` attributes on HTML elements. There is no `_locales/` and no `browser.i18n.getMessage()` — the add-on name and description are hardcoded in `manifest.json`, because the UI language follows the popup setting and `browser.i18n` cannot be switched at runtime.
- Theming: CSS custom properties. The injected overlay (`styles.css`) selects on `.theme-classic` / `.theme-aniworld`, which `content.js` sets as a class on `#aniskip-container`; the popup (`popup.html` inline `<style>`) selects on `body[data-theme="classic"]` / `body[data-theme="aniworld"]`, set by `applyTheme()` in `popup.js`.
- Always use `browser.storage.local.get()` with default values (not bare key access). The defaults live in `src/shared/defaults.js` as `DEFAULT_SETTINGS` - never inline a literal that exists there.
- Adding a setting = one entry in `DEFAULT_SETTINGS`, one `.setting-row` in the matching tab panel of `popup.html` (id must match the key, no `checked`/`value` attributes), and one entry per language in `TRANSLATIONS` in `src/shared/i18n.js`. `popup.js` collects controls from the DOM and derives load/save from the element type, so no list needs updating.
- Message actions, storage keys and `postMessage` types are constants in `src/shared/protocol.js` (`MSG.*`, `STORAGE.*`, `POST_MSG.*`) — never write the raw strings again. A typo in a literal fails silently because the listener simply never matches.
- The popup has three tabs (General / Styles / Advanced) built from `.tab` buttons + `.tab-panel` divs. The active tab is a folder tab that merges into the `.content` panel: it takes `--bg-secondary` and gets concave fillets from `.tab.active::before/::after` (a radial gradient carves the quarter circle — do not go back to `border-radius`, that produces convex bumps). `initTabs()` sets `body[data-active-tab]`, which rounds the panel's top corners except the side the active tab sits on. `.content` keeps a 10px `border-top` of `--bg-secondary` so scrolled rows are clipped below the fillets. Inside a panel, rows are grouped in `.section` blocks with `.section-header` / `.section-title`. A row with `data-depends-on` must sit in the same panel as its parent control, otherwise the disabled state points at a switch the user cannot see.
- Popup height is capped at 600px by Firefox/Chrome: `.content` uses `max-height: 360px`, keep header + tabs + content + footer under that.
- Manual testing only: load in Firefox, navigate to aniworld.to, test with various anime/episodes.

## Gotchas

- `content.js` skips itself if `window.location.hostname` includes `aniworld.to` — it only runs inside the VOE iframe.
- `background.js` ignores top-level frames (`frameId === 0`) — it only injects into subframes whose parent is aniworld.to.
- No source maps, no debug builds. Edit → reload in `about:debugging` → test.
