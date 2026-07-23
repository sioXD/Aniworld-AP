# AniWorld AP — Agent Guide

## Project

Firefox WebExtension (Manifest V2) that auto-skips anime openings/endings on aniworld.to using the AniSkip API. Fork of the original AniWorld AP with additional features.

## Key facts

- **Zero toolchain.** Vanilla JS, no package.json, no npm, no bundler, no TypeScript, no tests.
- **Firefox-only.** Uses `browser.*` API. Not compatible with Chrome/Chromium.
- **No dev server.** Load via `about:debugging` → This Firefox → Load Temporary Add-on → `manifest.json`.
- **Packaging:** `powershell -File pack.ps1` (requires `npm install --global web-ext`). Produces `.xpi` via `web-ext build`.
- **Entrypoints:** `src/background.js` (persistent background), `src/aniworld.js` (aniworld.to content script), `src/content.js` (injected into VOE iframe), `src/popup.js` (settings popup).

## Architecture

- `background.js` proxies AniSkip/Jikan API calls, injects `content.js` + `styles.css` into VOE iframes via `webNavigation.onCompleted`.
- `aniworld.js` parses anime/episode/season from breadcrumbs/DOM, handles next-episode navigation and language selection.
- `content.js` runs inside the VOE player iframe, manages skip logic, progress bar markers, volume/position persistence.
- Cross-frame messaging via `postMessage` (`ANISKIP_NEXT_EPISODE`, `ANISKIP_MARK_SEEN`, `ANISKIP_AUTO_PLAY`, etc.).
- Settings stored in `browser.storage.local`; cached anime lookups stored same way.

## Conventions

- i18n: inline translation objects in `content.js` (en/de) and `popup.js` (en/de). `data-i18n` attributes on HTML elements.
- Theming: CSS custom properties with `.theme-classic` / `.theme-aniworld` selectors. Both in `styles.css` (injected) and `popup.html` (inline `<style>`).
- Always use `browser.storage.local.get()` with default values (not bare key access).
- Manual testing only: load in Firefox, navigate to aniworld.to, test with various anime/episodes.

## Gotchas

- `content.js` skips itself if `window.location.hostname` includes `aniworld.to` — it only runs inside the VOE iframe.
- `background.js` ignores top-level frames (`frameId === 0`) — it only injects into subframes whose parent is aniworld.to.
- No source maps, no debug builds. Edit → reload in `about:debugging` → test.
