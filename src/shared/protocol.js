// The extension's cross-context protocol in one place.
//
// Three different channels used to be spelled as bare string literals spread
// over four files. A typo in any of them fails silently - the listener simply
// never matches - which is exactly the class of bug that is expensive to find.
//
// `var` instead of `const`: the player scripts can be injected into the same
// frame twice, and a repeated `const` would throw (same reason as
// DEFAULT_SETTINGS).

// browser.runtime.sendMessage({ action }) — player/popup -> background.
var MSG = {
	saveSettings: "saveSettings",
	openAutoplayHelp: "openAutoplayHelp",
	searchAnime: "searchAnime",
	getSkipTimes: "getSkipTimes",
	createSkipTime: "createSkipTime",
	voteSkipTime: "voteSkipTime",
	getAnimeCache: "getAnimeCache",
	setAnimeCache: "setAnimeCache",
};

// Keys in browser.storage.local that are not part of DEFAULT_SETTINGS.
// Settings themselves are read through DEFAULT_SETTINGS and are not listed here.
var STORAGE = {
	preferredLanguage: "preferredLanguage",
	preferredSpeed: "preferredSpeed",
	// Parsed once in the top frame, reused by the player for 5 minutes.
	aniWorldInfo: "aniWorldInfo",
	// malId -> title lookups, so repeat visits do not hit AniList again.
	animeCache: "animeCache",
	// Stable anonymous id, used for AniSkip votes.
	userId: "userId",
	// Autoplay handshake across episode changes: the top frame writes
	// shouldAutoPlay/autoPlayRequestedAt, the player frame consumes them within
	// AUTOPLAY_REQUEST_TTL_MS and clears them again.
	shouldAutoPlay: "shouldAutoPlay",
	autoPlayRequestedAt: "autoPlayTimestamp",
	// Episode the request is for. A frame that shows a different episode (the
	// outgoing player during an in-place switch) must leave it alone.
	autoPlayTarget: "autoPlayTarget",
	// Same handshake for a full-page navigation: the top frame flags the reload
	// before it happens, the next page picks it up and starts playback.
	autoPlayNextFlag: "autoPlayNextFlag",
	flaggedAt: "timestamp",
};

// postMessage types between the top frame (aniworld.js) and the player frame
// (the scripts in src/player). The player frame never trusts these beyond their
// type tag.
var POST_MSG = {
	nextEpisodeAvailable: "ANISKIP_NEXT_EPISODE_AVAILABLE",
	nextEpisode: "ANISKIP_NEXT_EPISODE",
	requestNextEpisodeStatus: "ANISKIP_REQUEST_NEXT_EPISODE_STATUS",
	requestFullscreen: "ANISKIP_REQUEST_FULLSCREEN",
	enterFullscreen: "ANISKIP_ENTER_FULLSCREEN",
	markSeen: "ANISKIP_MARK_SEEN",
	animeInfo: "ANISKIP_ANIME_INFO",
};

// How long a stashed autoplay request stays valid. Older than this and the
// player assumes the navigation it belonged to never happened.
var AUTOPLAY_REQUEST_TTL_MS = 30000;
