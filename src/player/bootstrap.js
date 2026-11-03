// VOE AniSkip - Startup: guard, shared state, anime-info parsing, init and the cross-frame listeners.
//
// Loaded last in the player frame, after shared/ and the other player
// modules. Defines the shared state and starts the overlay.
"use strict";

var state = {
	player: null,
	skipTimes: [],
	currentMalId: null,
	currentEpisode: null,
	currentSeason: null,
	currentVideoId: null,
	animeInfo: null,
	settings: { ...DEFAULT_SETTINGS },
	ui: { container: null, skipButton: null, panel: null, nextEpisodeButton: null, syncWithPlayerControls: null },
	nextEpisodeAvailable: false,
	skippedSegments: new Set(),
	pendingSkipConfirm: null,
	skipConfirmTimeout: null,
	initialized: false,
};

// Track if we've already marked as seen to prevent duplicates
var markedAsSeen = false;

function isInIframe() {
	try {
		return window.self !== window.top;
	} catch (e) {
		return true;
	}
}

async function getAniWorldInfo() {
	try {
		const result = await browser.storage.local.get(STORAGE.aniWorldInfo);
		if (result.aniWorldInfo && Date.now() - result.aniWorldInfo.timestamp < 5 * 60 * 1000) {
			return result.aniWorldInfo;
		}
	} catch (e) {
		console.log("VOE AniSkip: Could not get AniWorld info", e);
	}
	return null;
}

function parseAnimeInfo() {
	const title = document.title || "";
	const ogTitle = document.querySelector('meta[name="og:title"]')?.content || "";
	let sourceTitle = (ogTitle || title)
		.replace(/^Watch\s+/i, "")
		.replace(/\s*-\s*VOE.*$/i, "")
		.trim();

	const sXeXPattern = /^(.+?)[\._\s]+S(\d+)E(\d+)/i;
	let match = sourceTitle.match(sXeXPattern);

	if (match) {
		let animeName = match[1].replace(/\./g, " ").replace(/_/g, " ").replace(/\s+/g, " ").trim();
		return { animeName, season: parseInt(match[2], 10), episode: parseInt(match[3], 10) };
	}

	const patterns = [
		/^(.+?)[\s\-_]+(?:Episode|Ep\.?|E)?[\s\-_]*(\d{1,3})(?:[\s\-_]|$)/i,
		/^(.+?)\s+(\d{1,3})(?:\s|$)/i,
	];

	for (const pattern of patterns) {
		match = sourceTitle.match(pattern);
		if (match) {
			let animeName = match[1]
				.replace(/\./g, " ")
				.replace(/_/g, " ")
				.replace(/\s+/g, " ")
				.replace(
					/\s*(German|English|Japanese|Subbed|Dubbed|Sub|Dub|1080p|720p|480p|AAC|WebRip|x264|x265|HEVC|BluRay|BDRip|WEB-DL|WEBRip|HDRip|\.mp4|\.mkv).*$/gi,
					"",
				)
				.trim();
			const episode = parseInt(match[2], 10);
			if (animeName && episode) return { animeName, season: 1, episode };
		}
	}
	return null;
}

function generateVideoId(animeInfo) {
	if (!animeInfo) return null;
	return `${animeInfo.animeName.toLowerCase().replace(/\s+/g, "_")}_s${animeInfo.season || 1}_e${animeInfo.episode}`;
}

// MAL lookups are cached per season: many series have a separate MAL entry
// per season, so a name-only key would let season 2 overwrite season 1.
function getMalCacheKey(animeInfo) {
	const name = (animeInfo?.animeName || "").trim().toLowerCase();
	return `${name}::s${animeInfo?.season || 1}`;
}

// --- MAL match selection ---------------------------------------------------
// The search APIs return their best guess first, but that guess is often a
// movie, an OVA or a different season. These helpers score the candidates
// against the name/season/episode parsed from the page and keep the strongest
// one, while preserving the API order for ties.

function normalizeTitle(value) {
	return (value || "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

function seasonFromTitle(title) {
	const normalized = normalizeTitle(title);
	let match = normalized.match(/\bseason\s*(\d+)\b/);
	if (match) return parseInt(match[1], 10);
	match = normalized.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/);
	if (match) return parseInt(match[1], 10);
	match = normalized.match(/\bs(\d+)\b/);
	if (match) return parseInt(match[1], 10);
	return null;
}

function scoreAnimeMatch(result, animeInfo) {
	const title = normalizeTitle(result?.title);
	const wanted = normalizeTitle(animeInfo?.animeName);
	if (!title || !wanted) return -Infinity;

	let score = 0;
	if (title === wanted) {
		score += 100;
	} else if (title.startsWith(wanted)) {
		score += 60;
	} else if (title.includes(wanted)) {
		score += 30;
	} else {
		// Partial credit for shared words, so "Frieren Beyond Journeys End"
		// still beats an unrelated hit after punctuation normalisation.
		const wantedWords = wanted.split(" ");
		const titleWords = new Set(title.split(" "));
		const shared = wantedWords.filter((word) => titleWords.has(word)).length;
		score += (shared / wantedWords.length) * 25;
	}

	// A season marker decides between otherwise identical entries. A candidate
	// without one is the more likely season 1 entry.
	const wantedSeason = animeInfo?.season || 1;
	const resultSeason = seasonFromTitle(result?.title);
	if (resultSeason !== null) {
		score += resultSeason === wantedSeason ? 25 : -40;
	} else if (wantedSeason > 1) {
		score -= 10;
	}

	// A movie cannot be the right entry for a numbered episode.
	const format = (result?.type || "").toUpperCase();
	if (format === "TV" || format === "TV_SHORT") {
		score += 10;
	} else if (format === "MOVIE" && (animeInfo?.episode || 1) > 1) {
		score -= 30;
	}

	// Discourage entries whose episode count cannot contain this episode, but
	// only as a penalty: absolute numbering across split cours is common.
	if (result?.episodes && animeInfo?.episode) {
		score += animeInfo.episode <= result.episodes ? 5 : -20;
	}

	return score;
}

function pickBestMatch(results, animeInfo) {
	if (!Array.isArray(results) || results.length === 0) return null;
	let best = results[0];
	let bestScore = scoreAnimeMatch(best, animeInfo);
	for (let i = 1; i < results.length; i++) {
		const score = scoreAnimeMatch(results[i], animeInfo);
		if (score > bestScore) {
			best = results[i];
			bestScore = score;
		}
	}
	return best;
}

// Initialize
async function init() {
	if (state.initialized) return;
	state.initialized = true;

	console.log("VOE AniSkip: Initializing...");

	// Check for auto-play flag early
	checkShouldAutoPlay();

	try {
		state.settings = await browser.runtime.sendMessage({ action: MSG.getSettings });
		console.log("VOE AniSkip: Settings loaded", state.settings);
	} catch (error) {
		console.error("VOE AniSkip: Failed to load settings:", error);
	}

	createUI();
	requestNextEpisodeStatus();
	setTimeout(requestNextEpisodeStatus, 1000);
	updateStatus(getMessage("statusWaitingForPlayer"));

	try {
		state.player = await waitForPlayer();
		console.log("VOE AniSkip: Player ready");
		updateStatus(getMessage("statusPlayerFound"));

		let animeInfo = null;
		if (isInIframe()) animeInfo = await getAniWorldInfo();
		if (!animeInfo) animeInfo = parseAnimeInfo();

		if (animeInfo) {
			console.log("VOE AniSkip: Parsed anime info:", animeInfo);
			state.animeInfo = animeInfo;
			state.currentEpisode = animeInfo.episode;
			state.currentSeason = animeInfo.season || 1;
			state.currentVideoId = generateVideoId(animeInfo);

			document.querySelector("#aniskip-episode-num").textContent = animeInfo.episode;
			document.querySelector("#aniskip-season-num").textContent = animeInfo.season || 1;
			document.querySelector("#aniskip-anime-info").classList.remove("aniskip-hidden");

			const cache = await browser.runtime.sendMessage({ action: MSG.getAnimeCache });
			// Legacy entries (name only) are only trusted for season 1 — for
			// later seasons they may belong to a different MAL entry.
			const cached =
				cache[getMalCacheKey(animeInfo)] ||
				(state.currentSeason === 1 ? cache[animeInfo.animeName.toLowerCase()] : null);

			if (cached) {
				console.log(
					"VOE AniSkip: Cache hit for",
					getMalCacheKey(animeInfo),
					"->",
					cached.malId,
				);
				state.currentMalId = cached.malId;
				document.querySelector("#aniskip-anime-name").textContent = cached.title;
				document.querySelector("#aniskip-mal-id").textContent = cached.malId;
				updateStatus(getMessage("statusUsingCached"));
				await fetchSkipTimes();
			} else {
				console.log("VOE AniSkip: Cache miss for", getMalCacheKey(animeInfo));
				document.querySelector("#aniskip-anime-name").textContent = animeInfo.animeName;
				document.querySelector("#aniskip-search-input").value = animeInfo.animeName;
				updateStatus(getMessage("statusSearching").replace("$1", animeInfo.animeName));

				let searchQuery = animeInfo.animeName;
				if (animeInfo.season && animeInfo.season > 1) searchQuery += " season " + animeInfo.season;

				console.log("VOE AniSkip: MAL search query:", searchQuery);
				const results = await browser.runtime.sendMessage({ action: MSG.searchAnime, query: searchQuery });
				console.log("VOE AniSkip: MAL search results:", results && results.length, "hits");
				const bestMatch = pickBestMatch(results, animeInfo);
				if (bestMatch) {
					console.log("VOE AniSkip: Best match:", bestMatch.mal_id, "-", bestMatch.title);
					await selectAnime(bestMatch.mal_id, bestMatch.title);
				} else {
					console.log("VOE AniSkip: No MAL search results, falling back to manual search");
					updateStatus(getMessage("statusNotFound"));
					document.querySelector("#aniskip-search-panel").classList.remove("aniskip-hidden");
				}
			}
		} else {
			updateStatus(getMessage("statusCouldNotParse"));
			document.querySelector("#aniskip-search-panel").classList.remove("aniskip-hidden");
		}

		state.player.on("time", checkSkipSegments);

		// Check if we're near the end of the video to trigger next episode early
		state.player.on("time", () => {
			const duration = state.player.getDuration();
			const position = state.player.getPosition();
			const timeRemaining = duration - position;

			// If less than 1 second remaining and we haven't already triggered, go to next episode
			if (duration > 0 && timeRemaining > 0 && timeRemaining < 1 && !markedAsSeen) {
				console.log("VOE AniSkip: Near end of video, skipping to next episode");
				markCurrentEpisodeAsSeen();
			}
		});

		state.player.on("complete", () => {
			console.log("VOE AniSkip: Video ended");
			markCurrentEpisodeAsSeen();
		});

		const video = document.querySelector("video");
		if (video) {
			video.addEventListener("ended", () => {
				console.log("VOE AniSkip: Video ended (native)");
				markCurrentEpisodeAsSeen();
			});
		}

		state.player.on("meta", () => setTimeout(addProgressBarMarkers, 500));
		setTimeout(addProgressBarMarkers, 2000);

		// Restore persisted speed and play state
		loadPersistentSpeed();
		checkShouldAutoPlay();
	} catch (error) {
		console.error("VOE AniSkip: Failed to initialize:", error);
		updateStatus(getMessage("statusFailedToFind").replace("$1", error.message), true);
	}
}

// Only the VOE iframe (or a page served from a voe domain) runs the overlay.
// The guard used to return from an IIFE; now it skips the startup call, so
// the declarations above stay inert on every other page.
function isPlayerFrame() {
	if (window.location.hostname.includes("aniworld.to")) return false;
	if (window.self === window.top && !window.location.hostname.includes("voe")) return false;
	return true;
}

function startExtension() {
	console.log("VOE AniSkip: Content script running on", window.location.href);

	window.addEventListener("message", (event) => {
		if (event.data?.type === POST_MSG.autoPlay) handleAutoPlay();
		if (event.data?.type === POST_MSG.enterFullscreen) enterFullscreenFromPlayer();
		if (event.data?.type === POST_MSG.nextEpisodeAvailable) {
			setNextEpisodeAvailability(event.data.available);
		}
	});

	// The popup writes the settings through the background, so storage is the
	// single source of truth. Reacting to onChanged fans the update out to every
	// open player frame without targeting a tab or a frame.
	browser.storage.onChanged.addListener((changes, areaName) => {
		if (areaName !== "local") return;

		let settingsChanged = false;
		for (const [key, change] of Object.entries(changes)) {
			if (!(key in DEFAULT_SETTINGS)) continue;
			// A removed key falls back to its default instead of becoming
			// undefined in the running overlay.
			state.settings[key] = change.newValue === undefined ? DEFAULT_SETTINGS[key] : change.newValue;
			settingsChanged = true;
		}
		if (!settingsChanged) return;

		console.log("VOE AniSkip: Settings updated", state.settings);
		updateNextEpisodeButtonLabel();
		if (state.ui.syncWithPlayerControls) state.ui.syncWithPlayerControls();

		// Update theme class and labels on container
		const container = document.getElementById("aniskip-container");
		if (container) {
			if (state.settings.uiTheme) container.className = `theme-${state.settings.uiTheme}`;
			applyPanelTranslations(container);
		}

		// Update speed control visibility
		const speedControl = document.getElementById("aniskip-speed-control");
		if (speedControl) {
			if (state.settings.showSpeedControl) {
				speedControl.classList.remove("aniskip-hidden");
			} else {
				speedControl.classList.add("aniskip-hidden");
			}
		}

		// Update skip button visibility
		const skipButton = document.getElementById("aniskip-skip-button");
		if (skipButton) {
			if (!state.settings.showButtons) {
				skipButton.classList.add("aniskip-hidden");
			} else if (!state.settings.alwaysShowButton && skipButton.dataset.skipType === "manual-90") {
				skipButton.classList.add("aniskip-hidden");
			} else {
				checkSkipSegments();
			}
		}
	});

	window.addEventListener("message", (event) => {
		if (event.data?.type === POST_MSG.animeInfo) {
			browser.storage.local.set({ [STORAGE.aniWorldInfo]: { ...event.data.data, timestamp: Date.now() } });
		}
	});

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", () => setTimeout(init, 300));
	} else {
		setTimeout(init, 500);
	}
}

if (isPlayerFrame()) {
	waitForVOE(startExtension);
}
