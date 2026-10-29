# AniWorld AP — Agent Guide

## Project

Firefox WebExtension (Manifest V2) that auto-skips anime openings/endings on aniworld.to using the AniSkip API. Fork of the original AniWorld AP with additional features.

## Key facts

- **Zero toolchain.** Vanilla JS, no package.json, no npm, no bundler, no TypeScript, no tests.
- **Firefox-only.** Uses `browser.*` API. Not compatible with Chrome/Chromium.
- **No dev server.** Load via `about:debugging` → This Firefox → Load Temporary Add-on → `manifest.json`.
- **Packaging:** `powershell -File pack.ps1` (requires `npm install --global web-ext`). Produces `.zip` via `web-ext build`.
- **Release:** Change the `version` field in `manifest.json` and push the commit to `main` → GitHub Actions in `.github/workflows/release.yml` detects the version change, creates the matching `v<version>` Git tag and Release with the built artifact. Optionally publishes to AMO if `AMO_ENABLED` variable and `AMO_JWT_ISSUER`/`AMO_JWT_SECRET` secrets are set. The popup footer shows the version from `runtime.getManifest()` and a build date that `pack.*` stamps into `<span id="releaseDate">` — never hardcode those two strings by hand.
- **Entrypoints:** `src/defaults.js` (shared `DEFAULT_SETTINGS`), `src/background.js` (persistent background), `src/aniworld.js` (aniworld.to content script), `src/content.js` (injected into VOE iframe), `src/popup.js` (settings popup).

## Architecture

- `background.js` proxies AniSkip/Jikan API calls, injects `content.js` + `styles.css` into VOE iframes via `webNavigation.onCompleted`.
- `aniworld.js` parses anime/episode/season from breadcrumbs/DOM, handles next-episode navigation and language selection.
- `content.js` runs inside the VOE player iframe, manages skip logic, progress bar markers and speed control.
- Cross-frame messaging via `postMessage` (`ANISKIP_NEXT_EPISODE`, `ANISKIP_MARK_SEEN`, `ANISKIP_AUTO_PLAY`, etc.).
- Settings stored in `browser.storage.local`; cached anime lookups stored same way.

## Conventions

- i18n: inline translation objects in `content.js` (en/de) and `popup.js` (en/de). `data-i18n` attributes on HTML elements. There is no `_locales/` and no `browser.i18n.getMessage()` — the add-on name and description are hardcoded in `manifest.json`, because the UI language follows the popup setting and `browser.i18n` cannot be switched at runtime.
- Theming: CSS custom properties. The injected overlay (`styles.css`) selects on `.theme-classic` / `.theme-aniworld`, which `content.js` sets as a class on `#aniskip-container`; the popup (`popup.html` inline `<style>`) selects on `body[data-theme="classic"]` / `body[data-theme="aniworld"]`, set by `applyTheme()` in `popup.js`.
- Always use `browser.storage.local.get()` with default values (not bare key access). The defaults live in `src/defaults.js` as `DEFAULT_SETTINGS` — never inline a literal that exists there.
- Adding a setting = one entry in `DEFAULT_SETTINGS`, one `.setting-row` in the matching tab panel of `popup.html` (id must match the key, no `checked`/`value` attributes), and two i18n entries in `popup.js`. `popup.js` collects controls from the DOM and derives load/save from the element type, so no list needs updating.
- The popup has three tabs (General / Styles / Advanced) built from `.tab` buttons + `.tab-panel` divs, with a sliding `.tab-indicator`. Inside a panel, rows are grouped in `.section` blocks with `.section-header` / `.section-title`. A row with `data-depends-on` must sit in the same panel as its parent control, otherwise the disabled state points at a switch the user cannot see.
- Popup height is capped at 600px by Firefox/Chrome: `.content` uses `max-height: 360px`, keep header + tabs + content + footer under that.
- Manual testing only: load in Firefox, navigate to aniworld.to, test with various anime/episodes.

## Gotchas

- `content.js` skips itself if `window.location.hostname` includes `aniworld.to` — it only runs inside the VOE iframe.
- `background.js` ignores top-level frames (`frameId === 0`) — it only injects into subframes whose parent is aniworld.to.
- No source maps, no debug builds. Edit → reload in `about:debugging` → test.
