// Default settings for AniWorld AP — single source of truth.
//
// Loaded before the other extension scripts:
//   - manifest.json  → background.scripts / content_scripts (aniworld.js)
//   - popup.html     → <script src="defaults.js"> before popup.js
//   - background.js  → injected into the VOE iframe before content.js
//
// Add or change a default here only. Everything else reads from this object.
//
// `var` instead of `const` on purpose: the content script can be injected into
// the same frame twice (race between webNavigation and the onMessage path), and
// a repeated `const` declaration would throw a SyntaxError and stop injection.
var DEFAULT_SETTINGS = {
	language: "en",
	autoSkipOp: false,
	autoSkipEd: false,
	autoSkipRecap: false,
	showButtons: true,
	alwaysShowButton: true,
	showSpeedControl: true,
	persistentSpeed: true,
	skipOffset: -5,
	nextEpisode: true,
	showNextEpisodeButton: true,
	markerColorOp: "#FF00FB",
	markerColorEd: "#22C55E",
	markerColorRecap: "#FFDD00",
	markerOpacity: 0.5,
	uiTheme: "aniworld",
};
