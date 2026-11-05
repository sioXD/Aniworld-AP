// ==UserScript==
// @match            https://aniworld.to/*
// @match            https://s.to/*
// @match            https://serienstream.to/*
// @match            http://186.2.175.5/*
// @match            *://*/*
// @namespace        https://gsv2.com
// @icon             https://i.imgur.com/CEZGcX6.png
// @compatible       Chrome Chrome/Brave + Violentmonkey (MV3)
// @compatible       Firefox Firefox + Violentmonkey
// @require          https://cdnjs.cloudflare.com/ajax/libs/keyboardjs/2.7.0/keyboard.min.js
// @require          https://cdn.jsdelivr.net/npm/notiflix@3.2.8/dist/notiflix-aio-3.2.8.min.js
// @grant            GM_addStyle
// @grant            GM_addValueChangeListener
// @grant            GM_deleteValue
// @grant            GM_getValue
// @grant            GM_listValues
// @grant            GM_removeValueChangeListener
// @grant            GM_setValue
// @grant            GM.getValue
// @grant            unsafeWindow
// @grant            GM_xmlhttpRequest
// @connect          api.jikan.moe
// @connect          api.aniskip.com
// @run-at           document-start
// ==/UserScript==

/* jshint esversion: 11 */
/* global Notiflix, keyboardJS */

(async function () {
	"use strict";

	// Guard against double execution (e.g. two userscript managers running
	// this script side by side) — the marker lives in the DOM, so it is
	// visible across script worlds
	if (document.documentElement) {
		if (document.documentElement.dataset.gsv2ApActive) {
			console.warn("[GSv2 AP] Second instance detected — this one stays inactive.");
			return;
		}
		document.documentElement.dataset.gsv2ApActive = "1";
	}

	// ============================================================
	// AniSkip Integration Module
	// ============================================================
	const AniSkipModule = {
		gmFetchJson(url) {
			return new Promise((resolve, reject) => {
				GM_xmlhttpRequest({
					method: "GET",
					url,
					headers: { Accept: "application/json" },
					timeout: 5000,
					onload: (res) => {
						try {
							resolve(JSON.parse(res.responseText));
						} catch (e) {
							reject(e);
						}
					},
					onerror: reject,
					ontimeout: reject,
				});
			});
		},

		getTitleFromPage() {
			const h1 = document.querySelector("h1");
			return h1 ? h1.textContent.trim() : null;
		},

		getSlugFromUrl() {
			const m = location.pathname.match(/^\/anime\/stream\/([^/]+)/);
			return m ? m[1] : null;
		},

		getEpisodeFromUrl() {
			const m = location.pathname.match(/\/episode-(\d+)\b/i);
			return m ? parseInt(m[1], 10) : null;
		},

		getSeasonFromUrl() {
			const m = location.pathname.match(/\/staffel-(\d+)\b/i);
			return m ? parseInt(m[1], 10) : null;
		},

		normalizeTitle(s) {
			return (s || "")
				.toLowerCase()
				.replace(/&/g, " and ")
				.replace(/['".:!?()[\]{}]/g, " ")
				.replace(/\s+/g, " ")
				.trim()
				.replace(/\b(staffel|season|cour|part|folge|episode|ova|movie|film|specials?)\b/g, "")
				.replace(/\s+/g, " ")
				.trim();
		},

		tokenSet(s) {
			return new Set(this.normalizeTitle(s).split(" ").filter(Boolean));
		},

		overlapScore(a, b) {
			const A = this.tokenSet(a),
				B = this.tokenSet(b);
			if (!A.size || !B.size) return 0;
			let inter = 0;
			for (const t of A) if (B.has(t)) inter++;
			const union = A.size + B.size - inter;
			return (inter / union) * 100;
		},

		pickBestMatch(results, targetTitle) {
			let best = null,
				bestScore = -Infinity;
			for (const r of results) {
				const candTitles = [r.title, r.title_english, r.title_japanese].filter(Boolean);
				let score = 0;
				for (const t of candTitles) score = Math.max(score, this.overlapScore(targetTitle, t));
				if (score > bestScore) {
					bestScore = score;
					best = r;
				}
			}
			return { best, bestScore };
		},

		async getMalId(title, slug, season = null) {
			if (!title || !slug) return null;

			// Include season in cache key to avoid conflicts between seasons
			const malCacheKey = season && season > 1 ? `aw_mal_id::${slug}::s${season}` : `aw_mal_id::${slug}`;
			const cachedRaw = localStorage.getItem(malCacheKey);
			if (cachedRaw) {
				try {
					const cacheData = JSON.parse(cachedRaw);
					if (cacheData && cacheData._cachedAt && cacheData.malId) {
						const cacheAge = Date.now() - cacheData._cachedAt;
						const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
						if (cacheAge < CACHE_TTL) {
							return cacheData.malId;
						} else {
							localStorage.removeItem(malCacheKey);
						}
					} else {
						// Old format (plain string) - clear it so it gets re-fetched with proper matching
						localStorage.removeItem(malCacheKey);
					}
				} catch (e) {
					// Old format was a plain string, not JSON - clear it
					localStorage.removeItem(malCacheKey);
				}
			}

			try {
				// Append season to search query if season > 1
				let searchTitle = title;
				if (season && season > 1) {
					searchTitle = `${title} season ${season}`;
				}

				const q = encodeURIComponent(searchTitle);
				const url = `https://api.jikan.moe/v4/anime?q=${q}&limit=10`;
				const json = await this.gmFetchJson(url);
				const results = json?.data ?? [];
				const { best, bestScore } = this.pickBestMatch(results, searchTitle);

				if (best?.mal_id && bestScore >= 25) {
					const malId = String(best.mal_id);
					localStorage.setItem(malCacheKey, JSON.stringify({ malId, _cachedAt: Date.now() }));
					return malId;
				}
			} catch (e) {
				console.error("[AniSkip] Failed to fetch MAL ID:", e);
			}
			return null;
		},

		async getSkipTimes(malId, episode, episodeLength = 0) {
			if (!malId || !episode) return null;
			const skipCacheKey = `aw_aniskip::${malId}::${episode}`;
			const cached = localStorage.getItem(skipCacheKey);

			if (cached) {
				try {
					const cacheData = JSON.parse(cached);
					// Support both old format (raw array) and new format (with timestamp)
					if (cacheData && cacheData._cachedAt) {
						const cacheAge = Date.now() - cacheData._cachedAt;
						const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
						if (cacheAge < CACHE_TTL) {
							return cacheData.results;
						} else {
							localStorage.removeItem(skipCacheKey);
						}
					} else if (Array.isArray(cacheData)) {
						// Old format without timestamp - use it but re-cache with timestamp on next fetch
						localStorage.removeItem(skipCacheKey);
					}
				} catch (e) {
					console.error("[AniSkip] Failed to parse cached skip times:", e);
				}
			}

			try {
				const epLen = Number.isFinite(episodeLength) && episodeLength > 0 ? episodeLength : 0;
				const url = `https://api.aniskip.com/v2/skip-times/${encodeURIComponent(malId)}/${encodeURIComponent(episode)}?types=op&types=ed&types=mixed-op&types=mixed-ed&types=recap&episodeLength=${epLen}`;
				console.log("[AniSkip] API URL:", url);
				const json = await this.gmFetchJson(url);
				console.log("[AniSkip] API Response:", json);

				if (json?.found && json.results && json.results.length > 0) {
					const results = json.results;
					localStorage.setItem(skipCacheKey, JSON.stringify({ results, _cachedAt: Date.now() }));
					return results;
				}

				// Log why we didn't get results
				if (json?.found === false) {
					console.log("[AniSkip] API returned found: false");
				} else if (json?.results?.length === 0) {
					console.log("[AniSkip] API returned empty results array");
				}
			} catch (e) {
				console.error("[AniSkip] Failed to fetch skip times:", e);
			}
			return null;
		},

		parseSkipTimes(results, actualEpisodeLength = 0) {
			if (!results || !results.length) return null;

			const parsed = { intro: null, recap: null };

			// Group results by type, picking the one with the closest episodeLength
			const bestByType = {};

			for (const r of results) {
				const typ = r.skip_type ?? r.skipType;
				const interval = r.interval ?? {};
				const startTime = interval.start_time ?? interval.startTime ?? r.start_time ?? r.startTime;
				const endTime = interval.end_time ?? interval.endTime ?? r.end_time ?? r.endTime;

				const start = Number.parseFloat(startTime);
				const end = Number.parseFloat(endTime);

				if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

				// Only care about op/mixed-op and recap
				const category = typ === "op" || typ === "mixed-op" ? "intro" : typ === "recap" ? "recap" : null;
				if (!category) continue;

				const resultEpLen = r.episode_length ?? r.episodeLength ?? 0;
				const distance = actualEpisodeLength > 0 ? Math.abs(resultEpLen - actualEpisodeLength) : 0;

				if (!bestByType[category] || distance < bestByType[category].distance) {
					bestByType[category] = { start, end, type: typ, distance };
				}
			}

			if (bestByType.intro) {
				parsed.intro = { start: bestByType.intro.start, end: bestByType.intro.end, type: bestByType.intro.type };
			}
			if (bestByType.recap) {
				parsed.recap = { start: bestByType.recap.start, end: bestByType.recap.end, type: bestByType.recap.type };
			}

			return parsed;
		},

		async submitSkipTimes(malId, episode, episodeLength, introStart, introEnd) {
			if (!malId || !episode) return { success: false, error: "Missing MAL ID or episode" };

			if (!Number.isFinite(introStart) || !Number.isFinite(introEnd)) {
				return { success: false, error: "Invalid times" };
			}

			if (introEnd <= introStart) {
				return { success: false, error: "End must be greater than start" };
			}

			try {
				// AniSkip API requires POST to /v2/skip-times/{malId}/{episodeNumber}
				const url = `https://api.aniskip.com/v2/skip-times/${encodeURIComponent(malId)}/${encodeURIComponent(episode)}`;

				// Generate a UUID for submitterId (v4 UUID format)
				const generateUUID = () => {
					return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
						const r = (Math.random() * 16) | 0;
						const v = c === "x" ? r : (r & 0x3) | 0x8;
						return v.toString(16);
					});
				};

				const payload = {
					skipType: "op",
					startTime: introStart,
					endTime: introEnd,
					episodeLength: episodeLength,
					providerName: "Aniworld",
					submitterId: generateUUID(),
				};

				console.log("[AniSkip] Submitting:", payload, "to URL:", url);

				const response = await new Promise((resolve, reject) => {
					GM_xmlhttpRequest({
						method: "POST",
						url: url,
						headers: {
							"Content-Type": "application/json",
						},
						data: JSON.stringify(payload),
						onload: (response) => {
							console.log("[AniSkip] Submit response:", response);
							resolve(response);
						},
						onerror: (error) => {
							console.error("[AniSkip] Submit error:", error);
							reject(error);
						},
					});
				});

				if (response.status >= 200 && response.status < 300) {
					return { success: true };
				} else {
					const errorMsg = response.responseText || `Server returned ${response.status}`;
					return { success: false, error: errorMsg };
				}
			} catch (e) {
				console.error("[AniSkip] Submit failed:", e);
				return { success: false, error: e.message };
			}
		},
	};

	// Localization setup
	const userLang = navigator.language.startsWith("de") ? "de" : "en";

	// Global storage for AniSkip data (accessible by all functions)
	let globalAniSkipData = null;

	// Session storage for submit dialog values (resets on page reload)
	let submitDialogValues = { start: null, end: null };

	const localizations = {
		en: {
			firstRunInfoTitle: `${GM_info.script.name} info`,
			firstRunInfoText: (isMobile, largeSkipKey) =>
				`The toggle enables autoplay, the gear button next to it opens the settings. ${isMobile ? "" : `Press "${largeSkipKey}" when an intro starts to skip it. `}Fullscreen is scrollable, allowing to switch providers on the go<br><br><b>GSv2 Edition</b> — a project by <a href="https://gsv2.com" target="_blank" style="color:#26c0d3;font-weight:600">gsv2.com</a>`,
			ok: "Okay",
			loading: "Loading",
			vidmolyNotReady: "Vidmoly not ready yet.",
			couldNotLoad: "Could not load",
			hotkeysGuide: "Hotkeys Guide",
			close: "Close",
			errorSaving: "There was an error when trying to save the",
			reportBug:
				". The value would reset upon player reload. Please, report the bug, with a mention of a URL of the page you're currently on",
			autoplayError:
				"The script got an error trying autoplay. Try again, and if the problem persists, report the bug, or you can try switching video player providers if possible",
			lastAutoplayError:
				"Last autoplay end up with an error, but you should be at the next episode page now. Try again, and if the problem persists, report the bug, or you can try switching video player providers if possible",
			preferences: "Preferences",
			advanced: "Advanced",
			apply: "Apply",
			providersPriority: "Providers priority",
			miscellaneous: "Miscellaneous",
			persistentMutedAutoplay: "Persistent muted autoplay",
			persistentMutedAutoplayTooltip:
				"Seamless autoplay is not always available due to browser restrictions. This setting makes autoplay muted which in turn makes autoplay to be always available (autoplay should be enabled for this to work), but instead it requires user input (click or keypress) to unmute. Keypress works only if a video player is in focus",
			autoSkipAtStart: "Auto-skip at start",
			autoSkipAtStartTooltip:
				"Automatically skips the beginning of a video when it starts. Enable this to activate the skip feature.",
			playbackPositionMemory: "Playback position memory",
			playbackPositionMemoryTooltip:
				"Saves the last playback position and restores it whenever the video player is reloaded",
			skipSecondsOnStart: "Skip seconds on start",
			skipSecondsOnStartTooltip: "Number of seconds to skip from the beginning when auto-skip is enabled.",
			overrideDoubletapBehavior: "Override double-tap behavior*",
			overrideDoubletapBehaviorTooltip:
				"If enabled, default double-tap behavior (if any) is being overrided: double-tap right/left side of a video player to fast forward/rewind. Double-tap in a middle applies an intro skip. Page reload is required for this setting to take effect!",
			introSkipSize: "Intro skip size, sec",
			introSkipSizeTooltip: "Intro skip size. This is linked to the title and should stay the same across episodes",
			outroSkipThreshold: "Outro skip threshold, sec",
			outroSkipThresholdTooltip:
				"Autoplay triggers when the video player has fewer than THIS number of seconds left to play. It is linked to the title and should stay the same across episodes",
			resetToDefaults: "Reset to defaults",
			hotkeys: "Hotkeys",
			fastBackward: "Fast backward*",
			fastBackwardTooltip: "Hotkey for a fast backward. Page reload is required for this setting to take effect!",
			fastForward: "Fast forward*",
			fastForwardTooltip: "Hotkey for a fast forward. Page reload is required for this setting to take effect!",
			fullscreen: "Fullscreen*",
			fullscreenTooltip:
				"Hotkey for a fullscreen mode toggle. Page reload is required for this setting to take effect!",
			largeSkip: "Intro skip*",
			largeSkipTooltip: "Hotkey for an intro skip. Page reload is required for this setting to take effect!",
			defaultIntroSkipSize: "Default intro skip size, sec",
			defaultIntroSkipSizeTooltip: "Default intro skip size",
			defaultOutroSkipThreshold: "Default outro skip threshold, sec",
			defaultOutroSkipThresholdTooltip: "Default outro skip threshold",
			markWatchedAfter: "Mark watched after, sec",
			markWatchedAfterTooltip:
				"Number of seconds of approximate playback time after which a video is being marked as watched. Set to 0 to disable and mark only by a triggered autoplay",
			fastForwardSize: "Fast forward size, sec",
			fastForwardSizeTooltip:
				"Number of seconds to skip or rewind using double-taps or pressing a corresponding hotkeys",
			showSkipIntroButton: "Show Skip Intro Button",
			showSkipIntroButtonTooltip: "Toggle visibility of the Skip Intro button on supported players",
			showSkipIntroButtonSeconds: "Show Skip Intro Button, sec",
			showSkipIntroButtonSecondsTooltip: "How long (in seconds) the Skip Intro button stays visible after loading",
			highlightVisitedEpisodes: "Highlight visited episodes",
			highlightVisitedEpisodesTooltip:
				"Highlights previously visited episode links in yellow so you can easily see which episodes you have already opened",
			preloadOtherProviders: "Preload other providers*",
			preloadOtherProvidersTooltip:
				"Whether the script should try and built in a providers that are not built in by a default. Might impact network usage. Page reload is required for this setting to take effect!",
			playOnIntroSkip: "Play on intro skip",
			playOnIntroSkipTooltip: "Intro skip also starts playback",
			showDeviceSpecificSettings: "Show device specific settings*",
			showDeviceSpecificSettingsTooltip:
				"Show settings that usually have no use on your device. For example, if you're on mobile, hotkeys settings are hidden by default because there is no PC keyboard on mobile. Page reload is required for this setting to take effect!",
			doubleTapTimingThreshold: "Double-tap timing threshold, ms*",
			doubleTapTimingThresholdTooltip:
				"Adjusts the maximum time (in milliseconds) allowed between two taps for them to be recognized as a double-tap. A lower value requires faster taps, while a higher value allows more delay. Page reload is required for this setting to take effect!",
			doubleTapDistanceThreshold: "Double-tap distance threshold, px*",
			doubleTapDistanceThresholdTooltip:
				"Defines the maximum distance (in pixels) between two taps for them to be considered a double-tap. A smaller value requires taps to be closer together, while a larger value allows more separation. Page reload is required for this setting to take effect!",
			introSkipCooldown: "Intro skip cooldown, ms*",
			introSkipCooldownTooltip:
				"Cooldown for an intro skip hotkey, to prevent an accidental double skip. Page reload is required for this setting to take effect!",
			useAniSkip: "Use AniSkip API",
			useAniSkipTooltip:
				"Automatically fetch intro times from AniSkip API for accurate intro skipping. Falls back to manual intro skip size if no data is found.",
			showAniSkipNotifications: "Show AniSkip notifications",
			showAniSkipNotificationsTooltip:
				"Show notifications when AniSkip data is found or when skipping intro/outro using AniSkip times.",
			autoSkipIntro: "Auto-skip intro",
			autoSkipIntroTooltip:
				"Automatically skip the intro when it starts (uses AniSkip timing when available, otherwise uses manual intro skip size).",
			aniSkipNoIntroFound: "AniSkip: No intro timestamp found",
			submitToAniSkip: "Submit to AniSkip",
			submitIntroTimes: "Submit Intro Times",
			submitIntroTimesDesc: "Help the community by submitting intro timestamps for this episode!",
			introStartTime: "Intro start (seconds)",
			introEndTime: "Intro end (seconds)",
			submitButton: "Submit",
			cancelButton: "Cancel",
			submittingToAniSkip: "Submitting to AniSkip...",
			submitSuccess: "Successfully submitted! Thank you for contributing!",
			submitError: "Failed to submit. Please try again.",
			invalidTimes: "Invalid times. End must be greater than start.",
			aniSkipFetchSuccess: "AniSkip: Using detected times",
			aniSkipFetchFailed: "AniSkip: No data found, using fallback",
			aniSkipIntroDetected: "Intro detected via AniSkip",
			aniSkipOutroDetected: "Outro detected via AniSkip",
			usingFallbackTimes: "Using manual skip times",
			playbackPositionExpiration: "Playback position expiration",
			playbackPositionExpirationTooltip:
				"How many DAYS need to pass before a playback position is removed from the memory",
			corsProxy: "CORS proxy",
			corsProxyTooltip:
				"To keep possible VOE-to-VOE unmuted autoplay working, the script needs to route a very small number of web requests through its own proxy server. Leave the input empty to disable this or set your own proxy",
			commlinkPollingInterval: "Commlink polling interval, ms*",
			commlinkPollingIntervalTooltip:
				"Reflects messaging responsiveness between a player and a top scope. Might impact CPU usage if set too low. 40 should be enough. Page reload is required for this setting to take effect!",
			skipIntro: "Skip Intro",
			autoplayEnabled: "Autoplay is enabled",
			autoplayDisabled: "Autoplay is disabled",
			visitedEpisodesColor: "Visited episodes color",
			visitedEpisodesColorTooltip: "Highlight color for episode links you have already opened",
			sleepTimer: "Sleep timer",
			sleepTimerHours: "Hours",
			sleepTimerMinutes: "Minutes",
			sleepTimerSeconds: "Seconds",
			sleepTimerStart: "Start",
			sleepTimerStop: "Stop",
			sleepTimerHint: "When the timer ends, autoplay switches off — the running episode still finishes",
			sleepTimerStarted: "Sleep timer set: autoplay turns off in",
			sleepTimerStopped: "Sleep timer stopped",
			sleepTimerExpired: "Sleep timer ended — autoplay is now off",
			sleepTimerRemaining: "remaining",
			nextEpisodeIn: "Next episode in",
			nextEpisodeNow: "Play now",
			nextEpisodeCountdown: "Next-episode countdown",
			nextEpisodeCountdownTooltip:
				"Show a countdown card before autoplay switches to the next episode, with play-now and cancel buttons",
			nextEpisodeCountdownS: "Countdown length, sec",
			nextEpisodeCountdownSTooltip: "How many seconds the next-episode countdown runs before switching",
			bingeStats: "Binge stats",
			bingeStatsWatched: "Auto-switched episodes / watch time",
			bingeStatsTooltip: "Counted locally on this device only — nothing is sent anywhere",
			showBingeMilestones: "Celebrate binge milestones",
			showBingeMilestonesTooltip:
				"Show a one-time celebration card at 10 / 50 / 100 / 500 auto-switched episodes. Turn off if you just want to watch in peace.",
			milestoneReached: (n) => `${n} episodes binged!`,
			milestoneSub: "powered by gsv2.com",
		},
		de: {
			firstRunInfoTitle: `${GM_info.script.name} Info`,
			firstRunInfoText: (isMobile, largeSkipKey) =>
				`Der Schalter aktiviert Autoplay, das Zahnrad daneben öffnet die Einstellungen. ${isMobile ? "" : `Drücken Sie "${largeSkipKey}", wenn ein Intro beginnt, um es zu überspringen. `}Der Vollbildmodus ist scrollbar, sodass Sie die Anbieter unterwegs wechseln können<br><br><b>GSv2 Edition</b> — ein Projekt von <a href="https://gsv2.com" target="_blank" style="color:#26c0d3;font-weight:600">gsv2.com</a>`,
			ok: "Okay",
			loading: "Wird geladen",
			vidmolyNotReady: "Vidmoly ist noch nicht bereit.",
			couldNotLoad: "Konnte nicht geladen werden",
			hotkeysGuide: "Hotkeys-Anleitung",
			close: "Schließen",
			errorSaving: "Beim Speichern von ist ein Fehler aufgetreten",
			reportBug:
				". Der Wert wird beim Neuladen des Players zurückgesetzt. Bitte melden Sie den Fehler unter Angabe der URL der aktuellen Seite",
			autoplayError:
				"Das Skript hat beim Versuch des Autoplays einen Fehler erhalten. Versuchen Sie es erneut. Wenn das Problem weiterhin besteht, melden Sie den Fehler oder versuchen Sie, den Video-Player-Anbieter zu wechseln, falls möglich",
			lastAutoplayError:
				"Das letzte Autoplay ist mit einem Fehler beendet, aber Sie sollten jetzt auf der Seite der nächsten Episode sein. Versuchen Sie es erneut. Wenn das Problem weiterhin besteht, melden Sie den Fehler oder versuchen Sie, den Video-Player-Anbieter zu wechseln, falls möglich",
			preferences: "Einstellungen",
			advanced: "Erweitert",
			apply: "Anwenden",
			providersPriority: "Anbieterpriorität",
			miscellaneous: "Sonstiges",
			persistentMutedAutoplay: "Dauerhaft stummgeschaltetes Autoplay",
			persistentMutedAutoplayTooltip:
				"Nahtloses Autoplay ist aufgrund von Browsereinschränkungen nicht immer verfügbar. Diese Einstellung schaltet das Autoplay stumm, wodurch das Autoplay immer verfügbar ist (Autoplay muss dafür aktiviert sein), erfordert jedoch eine Benutzereingabe (Klick oder Tastendruck) zum Aufheben der Stummschaltung. Ein Tastendruck funktioniert nur, wenn ein Videoplayer im Fokus ist",
			autoSkipAtStart: "Automatisches Überspringen am Anfang",
			autoSkipAtStartTooltip:
				"Überspringt automatisch den Anfang eines Videos, wenn es startet. Aktivieren Sie dies, um die Überspringfunktion zu aktivieren.",
			playbackPositionMemory: "Wiedergabepositionsspeicher",
			playbackPositionMemoryTooltip:
				"Speichert die letzte Wiedergabeposition und stellt sie wieder her, wenn der Videoplayer neu geladen wird",
			skipSecondsOnStart: "Sekunden am Anfang überspringen",
			skipSecondsOnStartTooltip:
				"Anzahl der Sekunden, die vom Anfang an übersprungen werden sollen, wenn das automatische Überspringen aktiviert ist.",
			overrideDoubletapBehavior: "Doppeltipp-Verhalten überschreiben*",
			overrideDoubletapBehaviorTooltip:
				"Wenn aktiviert, wird das standardmäßige Doppeltipp-Verhalten (falls vorhanden) überschrieben: Doppeltippen Sie auf die rechte/linke Seite eines Videoplayers, um schnell vor- oder zurückzuspulen. Ein Doppeltipp in der Mitte wendet einen Intro-Skip an. Ein Neuladen der Seite ist für diese Einstellung erforderlich!",
			introSkipSize: "Intro-Skipgröße, Sek",
			introSkipSizeTooltip:
				"Intro-Skipgröße. Dies ist mit dem Titel verknüpft und sollte über alle Episoden hinweg gleich bleiben",
			outroSkipThreshold: "Outro-Skipschwelle, Sek",
			outroSkipThresholdTooltip:
				"Autoplay wird ausgelöst, wenn der Videoplayer weniger als DIESE Anzahl von Sekunden zum Abspielen übrig hat. Es ist mit dem Titel verknüpft und sollte über alle Episoden hinweg gleich bleiben",
			resetToDefaults: "Auf Standard zurücksetzen",
			hotkeys: "Hotkeys",
			fastBackward: "Schneller Rücklauf*",
			fastBackwardTooltip:
				"Hotkey für einen schnellen Rücklauf. Ein Neuladen der Seite ist für diese Einstellung erforderlich!",
			fastForward: "Schneller Vorlauf*",
			fastForwardTooltip:
				"Hotkey für einen schnellen Vorlauf. Ein Neuladen der Seite ist für diese Einstellung erforderlich!",
			fullscreen: "Vollbild*",
			fullscreenTooltip:
				"Hotkey zum Umschalten des Vollbildmodus. Ein Neuladen der Seite ist für diese Einstellung erforderlich!",
			largeSkip: "Intro überspringen*",
			largeSkipTooltip: "Hotkey für einen Intro-Skip. Ein Neuladen der Seite ist für diese Einstellung erforderlich!",
			defaultIntroSkipSize: "Standard-Intro-Skipgröße, Sek",
			defaultIntroSkipSizeTooltip: "Standard-Intro-Skipgröße",
			defaultOutroSkipThreshold: "Standard-Outro-Skipschwelle, Sek",
			defaultOutroSkipThresholdTooltip: "Standard-Outro-Skipschwelle",
			markWatchedAfter: "Als angesehen markieren nach, Sek",
			markWatchedAfterTooltip:
				"Anzahl der Sekunden ungefährer Wiedergabezeit, nach der ein Video als angesehen markiert wird. Auf 0 setzen, um zu deaktivieren und nur durch ein ausgelöstes Autoplay zu markieren",
			fastForwardSize: "Schnellvorlaufgröße, Sek",
			fastForwardSizeTooltip:
				"Anzahl der Sekunden, die mit Doppeltipps oder durch Drücken einer entsprechenden Hotkey übersprungen oder zurückgespult werden sollen",
			showSkipIntroButton: "Intro überspringen-Button anzeigen",
			showSkipIntroButtonTooltip: "Sichtbarkeit des Intro überspringen-Buttons auf unterstützten Playern umschalten",
			showSkipIntroButtonSeconds: "Intro überspringen-Button anzeigen, Sek",
			showSkipIntroButtonSecondsTooltip:
				"Wie lange (in Sekunden) der Intro überspringen-Button nach dem Laden sichtbar bleibt",
			highlightVisitedEpisodes: "Besuchte Episoden hervorheben",
			highlightVisitedEpisodesTooltip:
				"Hebt zuvor besuchte Episodenlinks gelb hervor, damit Sie leicht erkennen können, welche Episoden Sie bereits geöffnet haben",
			preloadOtherProviders: "Andere Anbieter vorladen*",
			preloadOtherProvidersTooltip:
				"Ob das Skript versuchen soll, Anbieter zu integrieren, die nicht standardmäßig integriert sind. Kann die Netzwerknutzung beeinträchtigen. Ein Neuladen der Seite ist für diese Einstellung erforderlich!",
			playOnIntroSkip: "Bei Intro-Skip abspielen",
			playOnIntroSkipTooltip: "Intro-Skip startet auch die Wiedergabe",
			showDeviceSpecificSettings: "Gerätespezifische Einstellungen anzeigen*",
			showDeviceSpecificSettingsTooltip:
				"Einstellungen anzeigen, die auf Ihrem Gerät normalerweise keine Verwendung haben. Wenn Sie beispielsweise auf einem Mobilgerät sind, sind die Hotkey-Einstellungen standardmäßig ausgeblendet, da auf Mobilgeräten keine PC-Tastatur vorhanden ist. Ein Neuladen der Seite ist für diese Einstellung erforderlich!",
			doubleTapTimingThreshold: "Doppeltipp-Timing-Schwelle, ms*",
			doubleTapTimingThresholdTooltip:
				"Passt die maximale Zeit (in Millisekunden) an, die zwischen zwei Tipps erlaubt ist, damit sie als Doppeltipp erkannt werden. Ein niedrigerer Wert erfordert schnellere Tipps, während ein höherer Wert mehr Verzögerung zulässt. Ein Neuladen der Seite ist für diese Einstellung erforderlich!",
			doubleTapDistanceThreshold: "Doppeltipp-Distanzschwelle, px*",
			doubleTapDistanceThresholdTooltip:
				"Definiert die maximale Entfernung (in Pixeln) zwischen zwei Tipps, damit sie als Doppeltipp betrachtet werden. Ein kleinerer Wert erfordert, dass die Tipps näher beieinander liegen, während ein größerer Wert mehr Abstand zulässt. Ein Neuladen der Seite ist für diese Einstellung erforderlich!",
			introSkipCooldown: "Intro-Skip-Abklingzeit, ms*",
			introSkipCooldownTooltip:
				"Abklingzeit für einen Intro-Skip-Hotkey, um einen versehentlichen Doppelskip zu verhindern. Ein Neuladen der Seite ist für diese Einstellung erforderlich!",
			useAniSkip: "AniSkip-API verwenden",
			useAniSkipTooltip:
				"Intro-Zeiten automatisch von der AniSkip-API abrufen für genaues Intro-Überspringen. Fällt auf manuelle Intro-Skip-Größe zurück, wenn keine Daten gefunden werden.",
			showAniSkipNotifications: "AniSkip-Benachrichtigungen anzeigen",
			showAniSkipNotificationsTooltip:
				"Benachrichtigungen anzeigen, wenn AniSkip-Daten gefunden werden oder beim Überspringen von Intro/Outro mit AniSkip-Zeiten.",
			autoSkipIntro: "Intro automatisch überspringen",
			autoSkipIntroTooltip:
				"Intro automatisch überspringen, wenn es startet (verwendet AniSkip-Timing wenn verfügbar, sonst manuelle Intro-Skip-Größe).",
			aniSkipNoIntroFound: "AniSkip: Kein Intro-Zeitstempel gefunden",
			submitToAniSkip: "An AniSkip senden",
			submitIntroTimes: "Intro-Zeiten einreichen",
			submitIntroTimesDesc: "Hilf der Community, indem du Intro-Zeitstempel für diese Episode einreichst!",
			introStartTime: "Intro-Start (Sekunden)",
			introEndTime: "Intro-Ende (Sekunden)",
			submitButton: "Absenden",
			cancelButton: "Abbrechen",
			submittingToAniSkip: "Wird an AniSkip gesendet...",
			submitSuccess: "Erfolgreich eingereicht! Danke für deinen Beitrag!",
			submitError: "Fehler beim Senden. Bitte versuche es erneut.",
			invalidTimes: "Ungültige Zeiten. Ende muss größer als Start sein.",
			aniSkipFetchSuccess: "AniSkip: Erkannte Zeiten werden verwendet",
			aniSkipFetchFailed: "AniSkip: Keine Daten gefunden, Fallback wird verwendet",
			aniSkipIntroDetected: "Intro via AniSkip erkannt",
			aniSkipOutroDetected: "Outro via AniSkip erkannt",
			usingFallbackTimes: "Manuelle Skip-Zeiten werden verwendet",
			playbackPositionExpiration: "Ablauf der Wiedergabeposition",
			playbackPositionExpirationTooltip:
				"Wie viele TAGE müssen vergehen, bevor eine Wiedergabeposition aus dem Speicher entfernt wird",
			corsProxy: "CORS-Proxy",
			corsProxyTooltip:
				"Um ein mögliches VOE-zu-VOE ungestummtes Autoplay zu ermöglichen, muss das Skript eine sehr kleine Anzahl von Webanfragen über einen eigenen Proxyserver leiten. Lassen Sie das Eingabefeld leer, um dies zu deaktivieren oder Ihren eigenen Proxy festzulegen",
			commlinkPollingInterval: "Commlink-Abfrageintervall, ms*",
			commlinkPollingIntervalTooltip:
				"Spiegelt die Reaktionsfähigkeit der Nachrichtenübertragung zwischen einem Player und einem Top-Scope wider. Kann die CPU-Auslastung beeinträchtigen, wenn sie zu niedrig eingestellt ist. 40 sollten ausreichen. Ein Neuladen der Seite ist für diese Einstellung erforderlich!",
			skipIntro: "Intro überspringen",
			autoplayEnabled: "Autoplay ist aktiviert",
			autoplayDisabled: "Autoplay ist deaktiviert",
			visitedEpisodesColor: "Farbe für gesehene Folgen",
			visitedEpisodesColorTooltip: "Markierungsfarbe für bereits geöffnete Episoden-Links",
			sleepTimer: "Sleeptimer",
			sleepTimerHours: "Stunden",
			sleepTimerMinutes: "Minuten",
			sleepTimerSeconds: "Sekunden",
			sleepTimerStart: "Starten",
			sleepTimerStop: "Stoppen",
			sleepTimerHint: "Nach Ablauf wird Autoplay deaktiviert — die laufende Folge spielt noch zu Ende",
			sleepTimerStarted: "Sleeptimer gesetzt: Autoplay endet in",
			sleepTimerStopped: "Sleeptimer gestoppt",
			sleepTimerExpired: "Sleeptimer abgelaufen — Autoplay ist jetzt aus",
			sleepTimerRemaining: "verbleibend",
			nextEpisodeIn: "Nächste Folge in",
			nextEpisodeNow: "Jetzt abspielen",
			nextEpisodeCountdown: "Nächste-Folge-Countdown",
			nextEpisodeCountdownTooltip:
				'Zeigt vor dem automatischen Folgenwechsel eine Countdown-Karte mit „Jetzt abspielen" und „Abbrechen"',
			nextEpisodeCountdownS: "Countdown-Dauer, Sek",
			nextEpisodeCountdownSTooltip: "Wie viele Sekunden der Countdown läuft, bevor gewechselt wird",
			bingeStats: "Binge-Statistik",
			bingeStatsWatched: "Automatisch gewechselte Folgen / Sehzeit",
			bingeStatsTooltip: "Wird nur lokal auf diesem Gerät gezählt — nichts wird irgendwohin gesendet",
			showBingeMilestones: "Binge-Meilensteine feiern",
			showBingeMilestonesTooltip:
				"Zeigt einmalig eine Feier-Karte bei 10 / 50 / 100 / 500 automatisch gewechselten Folgen. Abschalten, wenn du einfach nur in Ruhe schauen willst.",
			milestoneReached: (n) => `${n} Folgen gebinged!`,
			milestoneSub: "powered by gsv2.com",
		},
	};

	const i18n = localizations[userLang];

	// ============================================
	// SHARED THEME SYSTEM
	// ============================================
	// Default settings layout
	const DEFAULT_SETTINGS_LAYOUT = {
		prefs: ["autoSkip", "skip", "defaults", "display", "aniskip", "stats"],
		adv: ["timing", "behavior", "playback", "appearance", "network", "hotkeys"],
	};

	const BUILT_IN_THEMES = {
		classic: {
			name: "Classic",
			builtIn: true,
			vars: {
				bgPrimary: "rgba(10,10,15,1)",
				bgSecondary: "rgba(18,18,26,1)",
				bgTertiary: "rgba(26,26,37,1)",
				bgHover: "rgba(255,255,255,0.02)",
				accentPrimary: "rgba(255,51,102,1)",
				accentSecondary: "rgba(124,58,237,1)",
				accentGlow: "rgba(255,51,102,0.4)",
				accentGreen: "rgba(34,197,94,1)",
				textPrimary: "rgba(240,240,245,1)",
				textSecondary: "rgba(160,160,184,1)",
				textMuted: "rgba(144,144,168,1)",
				borderColor: "rgba(255,255,255,0.06)",
				borderLight: "rgba(255,255,255,0.1)",
				borderRadius: "16px",
				fontFamily: "'Space Grotesk', -apple-system, sans-serif",
				// Header colors
				headerBg: "rgba(18,18,26,1)",
				headerText: "rgba(240,240,245,1)",
				headerAccent1: "rgba(255,51,102,1)",
				headerAccent2: "rgba(68,173,243,1)",
				headerTag: "rgba(144,144,168,1)",
				logoBg: "rgba(255,51,102,1)",
				logoText: "rgba(255,255,255,1)",
				// Submit button colors
				submitBtnBg1: "rgba(255,51,102,1)",
				submitBtnBg2: "rgba(124,58,237,1)",
				submitBtnText: "rgba(255,255,255,1)",
			},
			settingsLayout: DEFAULT_SETTINGS_LAYOUT,
		},
		aniworld: {
			name: "AniWorld",
			builtIn: true,
			vars: {
				bgPrimary: "rgba(18,28,34,1)",
				bgSecondary: "rgba(26,42,51,1)",
				bgTertiary: "rgba(36,55,67,1)",
				bgHover: "rgba(45,68,79,1)",
				accentPrimary: "rgba(99,124,249,1)",
				accentSecondary: "rgba(99,124,249,1)",
				accentGlow: "rgba(99,124,249,0.3)",
				accentGreen: "rgba(99,208,43,1)",
				textPrimary: "rgba(232,232,232,1)",
				textSecondary: "rgba(192,212,222,1)",
				textMuted: "rgba(168,192,204,1)",
				borderColor: "rgba(45,68,79,1)",
				borderLight: "rgba(58,85,101,1)",
				borderRadius: "12px",
				fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif",
				// Header colors
				headerBg: "rgba(26,42,51,1)",
				headerText: "rgba(232,232,232,1)",
				headerAccent1: "rgba(99,124,249,1)",
				headerAccent2: "rgba(68,173,243,1)",
				headerTag: "rgba(168,192,204,1)",
				logoBg: "rgba(99,124,249,1)",
				logoText: "rgba(255,255,255,1)",
				// Submit button colors
				submitBtnBg1: "rgba(99,124,249,1)",
				submitBtnBg2: "rgba(139,92,246,1)",
				submitBtnText: "rgba(255,255,255,1)",
			},
			settingsLayout: DEFAULT_SETTINGS_LAYOUT,
		},
		yellow: {
			name: "Yellow",
			builtIn: true,
			vars: {
				bgPrimary: "rgba(45,42,46,1)",
				bgSecondary: "rgba(34,31,34,1)",
				bgTertiary: "rgba(64,62,65,1)",
				bgHover: "rgba(91,89,92,1)",
				accentPrimary: "rgba(255,216,102,1)",
				accentSecondary: "rgba(252,152,103,1)",
				accentGlow: "rgba(255,216,102,0.3)",
				accentGreen: "rgba(169,220,118,1)",
				textPrimary: "rgba(252,252,250,1)",
				textSecondary: "rgba(193,192,192,1)",
				textMuted: "rgba(147,146,147,1)",
				borderColor: "rgba(64,62,65,1)",
				borderLight: "rgba(91,89,92,1)",
				borderRadius: "8px",
				fontFamily: "'JetBrains Mono', monospace, sans-serif",
				// Header colors
				headerBg: "rgba(34,31,34,1)",
				headerText: "rgba(252,252,250,1)",
				headerAccent1: "rgba(255,216,102,1)",
				headerAccent2: "rgba(252,152,103,1)",
				headerTag: "rgba(147,146,147,1)",
				logoBg: "rgba(255,216,102,1)",
				logoText: "rgba(45,42,46,1)",
				// Submit button colors
				submitBtnBg1: "rgba(255,216,102,1)",
				submitBtnBg2: "rgba(252,152,103,1)",
				submitBtnText: "rgba(45,42,46,1)",
			},
			settingsLayout: DEFAULT_SETTINGS_LAYOUT,
		},
		gsv2: {
			name: "GSv2",
			builtIn: true,
			vars: {
				bgPrimary: "rgba(0,0,0,1)",
				bgSecondary: "rgba(10,10,12,1)",
				bgTertiary: "rgba(22,22,26,1)",
				bgHover: "rgba(255,255,255,0.04)",
				accentPrimary: "rgba(200,204,214,1)",
				accentSecondary: "rgba(148,152,164,1)",
				accentGlow: "rgba(200,204,214,0.35)",
				accentGreen: "rgba(34,197,94,1)",
				textPrimary: "rgba(240,240,245,1)",
				textSecondary: "rgba(170,174,184,1)",
				textMuted: "rgba(120,124,134,1)",
				borderColor: "rgba(255,255,255,0.08)",
				borderLight: "rgba(255,255,255,0.14)",
				borderRadius: "14px",
				fontFamily: "'Space Grotesk', -apple-system, sans-serif",
				// Header colors
				headerBg: "rgba(10,10,12,1)",
				headerText: "rgba(240,240,245,1)",
				headerAccent1: "rgba(200,204,214,1)",
				headerAccent2: "rgba(148,152,164,1)",
				headerTag: "rgba(120,124,134,1)",
				logoBg: "rgba(200,204,214,1)",
				logoText: "rgba(0,0,0,1)",
				// Submit button colors
				submitBtnBg1: "rgba(200,204,214,1)",
				submitBtnBg2: "rgba(148,152,164,1)",
				submitBtnText: "rgba(0,0,0,1)",
			},
			settingsLayout: DEFAULT_SETTINGS_LAYOUT,
		},
	};

	// Get custom themes from storage
	const getCustomThemes = () => {
		try {
			return JSON.parse(GM_getValue("customThemes") || "{}");
		} catch {
			return {};
		}
	};

	// Save custom themes to storage
	const saveCustomThemes = (themes) => {
		GM_setValue("customThemes", JSON.stringify(themes));
	};

	// Get all themes (built-in + custom)
	const getAllThemes = () => {
		return { ...BUILT_IN_THEMES, ...getCustomThemes() };
	};

	// Get current theme variables (with fallback to classic)
	const getCurrentThemeVars = () => {
		const savedTheme = GM_getValue("uiTheme") || "gsv2";
		const allThemes = getAllThemes();
		const theme = allThemes[savedTheme];
		// Fallback to classic if theme not found
		return theme?.vars || BUILT_IN_THEMES.classic.vars;
	};

	// Domains list the script should work for
	const TOP_SCOPE_DOMAINS = ["aniworld.to", "s.to", "serienstream.to", "186.2.175.5"];

	// S.to related domains (all use the new layout)
	const STO_DOMAINS = ["s.to", "serienstream.to", "186.2.175.5"];

	// Helper to detect if we're on the new S.to layout
	const isNewStoLayout = () => {
		return STO_DOMAINS.includes(location.hostname) && !!document.querySelector("#player-iframe");
	};

	// Needed for proper tracking of position memory
	const TOP_SCOPE_DOMAINS_IDS = {
		"aniworld.to": "aniworld",
		"s.to": "sto",
		"serienstream.to": "sto",
		"186.2.175.5": "sto",
	};

	// Names should be the exact same as in the providers list of the website
	const VIDEO_PROVIDERS_MAP = {
		Vidmoly: "Vidmoly",
		Vidoza: "Vidoza",
		VOE: "VOE",
	};
	const VIDEO_PROVIDERS_IDS = {
		1: VIDEO_PROVIDERS_MAP.VOE,
		3: VIDEO_PROVIDERS_MAP.Vidoza,
		5: VIDEO_PROVIDERS_MAP.Vidmoly,
	};
	// Providers supported by the script, ordered by a default priority
	const VIDEO_PROVIDERS_DEFAULT_ORDER = [
		VIDEO_PROVIDERS_MAP.VOE,
		VIDEO_PROVIDERS_MAP.Vidmoly,
		VIDEO_PROVIDERS_MAP.Vidoza,
	];
	const CORE_SETTINGS_MAP = {
		currentLargeSkipSizeS: "currentLargeSkipSizeS",
		currentOutroSkipThresholdS: "currentOutroSkipThresholdS",
		isAutoplayEnabled: "isAutoplayEnabled",
		isMuted: "isMuted",
		shouldAutoSkipOnStart: "shouldAutoSkipOnStart",
		autoSkipSecondsOnStart: "autoSkipSecondsOnStart",
		persistentVolumeLvl: "persistentVolumeLvl",
		providersPriority: "providersPriority",
		videoLanguagePreferredID: "videoLanguagePreferredID",
		autoSkipIntro: "autoSkipIntro",
		visitedEpisodesColor: "visitedEpisodesColor",
		sleepTimerEndsAt: "sleepTimerEndsAt",
	};
	// Note that defaults are applied only on a very first run of the script
	const CORE_SETTINGS_DEFAULTS = {
		// Default value doesn't matter because it fallbacks to
		// ADVANCED_SETTINGS_DEFAULTS.defaultLargeSkipSizeS anyway
		[CORE_SETTINGS_MAP.currentLargeSkipSizeS]: 87,
		[CORE_SETTINGS_MAP.currentOutroSkipThresholdS]: 90, // same logic
		[CORE_SETTINGS_MAP.shouldAutoSkipOnStart]: true,
		[CORE_SETTINGS_MAP.autoSkipSecondsOnStart]: 0,
		[CORE_SETTINGS_MAP.isAutoplayEnabled]: false,
		[CORE_SETTINGS_MAP.isMuted]: false,
		[CORE_SETTINGS_MAP.persistentVolumeLvl]: 0.5,
		[CORE_SETTINGS_MAP.providersPriority]: VIDEO_PROVIDERS_DEFAULT_ORDER.map((name) =>
			Object.keys(VIDEO_PROVIDERS_IDS).find((key) => VIDEO_PROVIDERS_IDS[key] === name),
		),
		[CORE_SETTINGS_MAP.videoLanguagePreferredID]: "1",
		[CORE_SETTINGS_MAP.autoSkipIntro]: true,
		[CORE_SETTINGS_MAP.visitedEpisodesColor]: "#ffdd00",
		[CORE_SETTINGS_MAP.sleepTimerEndsAt]: 0,
	};
	const HOTKEYS_SETTINGS_MAP = {
		fastBackward: "fastBackward",
		fastForward: "fastForward",
		fullscreen: "fullscreen",
		largeSkip: "largeSkip",
	};
	// Note that defaults are applied only on a very first run of the script
	const HOTKEYS_SETTINGS_DEFAULTS = {
		[HOTKEYS_SETTINGS_MAP.fastBackward]: "left",
		[HOTKEYS_SETTINGS_MAP.fastForward]: "right",
		[HOTKEYS_SETTINGS_MAP.fullscreen]: "f",
		[HOTKEYS_SETTINGS_MAP.largeSkip]: "v",
	};
	const MAIN_SETTINGS_MAP = {
		highlightVisitedEpisodes: "highlightVisitedEpisodes",
		overrideDoubletapBehavior: "overrideDoubletapBehavior",
		playbackPositionMemory: "playbackPositionMemory",
		shouldAutoplayMuted: "shouldAutoplayMuted",
	};
	// Note that defaults are applied only on a very first run of the script
	const MAIN_SETTINGS_DEFAULTS = {
		[MAIN_SETTINGS_MAP.highlightVisitedEpisodes]: true,
		[MAIN_SETTINGS_MAP.overrideDoubletapBehavior]: true,
		[MAIN_SETTINGS_MAP.playbackPositionMemory]: true,
		[MAIN_SETTINGS_MAP.shouldAutoplayMuted]: true,
	};
	const ADVANCED_SETTINGS_MAP = {
		commlinkPollingIntervalMs: "commlinkPollingIntervalMs",
		corsProxy: "corsProxy",
		defaultLargeSkipSizeS: "defaultLargeSkipSizeS",
		defaultOutroSkipThresholdS: "defaultOutroSkipThresholdS",
		doubletapDistanceThresholdPx: "doubletapDistanceThresholdPx",
		doubletapTimingThresholdMs: "doubletapTimingThresholdMs",
		fastForwardSizeS: "fastForwardSizeS",
		largeSkipCooldownMs: "largeSkipCooldownMs",
		markWatchedAfterS: "markWatchedAfterS",
		playOnLargeSkip: "playOnLargeSkip",
		playbackPositionExpirationDays: "playbackPositionExpirationDays",
		preloadOtherProviders: "preloadOtherProviders",
		showSkipIntroButton: "showSkipIntroButton",
		showSkipIntroButtonSeconds: "showSkipIntroButtonSeconds",
		showDeviceSpecificSettings: "showDeviceSpecificSettings",
		useAniSkip: "useAniSkip",
		showAniSkipNotifications: "showAniSkipNotifications",
		showNextEpisodeCountdown: "showNextEpisodeCountdown",
		nextEpisodeCountdownS: "nextEpisodeCountdownS",
		showBingeMilestones: "showBingeMilestones",
	};
	// Note that defaults are applied only on a very first run of the script
	const ADVANCED_SETTINGS_DEFAULTS = {
		[ADVANCED_SETTINGS_MAP.commlinkPollingIntervalMs]: 40,
		[ADVANCED_SETTINGS_MAP.corsProxy]: "https://aniworld-to-cors-proxy.fly.dev/",
		[ADVANCED_SETTINGS_MAP.defaultLargeSkipSizeS]: 87,
		[ADVANCED_SETTINGS_MAP.defaultOutroSkipThresholdS]: 90,
		[ADVANCED_SETTINGS_MAP.doubletapDistanceThresholdPx]: 50,
		[ADVANCED_SETTINGS_MAP.doubletapTimingThresholdMs]: 300,
		[ADVANCED_SETTINGS_MAP.fastForwardSizeS]: 10,
		[ADVANCED_SETTINGS_MAP.largeSkipCooldownMs]: 300,
		[ADVANCED_SETTINGS_MAP.markWatchedAfterS]: 0,
		[ADVANCED_SETTINGS_MAP.playOnLargeSkip]: true,
		[ADVANCED_SETTINGS_MAP.playbackPositionExpirationDays]: 30,
		[ADVANCED_SETTINGS_MAP.preloadOtherProviders]: true,
		[ADVANCED_SETTINGS_MAP.showSkipIntroButton]: true,
		[ADVANCED_SETTINGS_MAP.showSkipIntroButtonSeconds]: 240,
		[ADVANCED_SETTINGS_MAP.showDeviceSpecificSettings]: false,
		[ADVANCED_SETTINGS_MAP.useAniSkip]: true,
		[ADVANCED_SETTINGS_MAP.showAniSkipNotifications]: true,
		[ADVANCED_SETTINGS_MAP.showNextEpisodeCountdown]: true,
		[ADVANCED_SETTINGS_MAP.nextEpisodeCountdownS]: 10,
		[ADVANCED_SETTINGS_MAP.showBingeMilestones]: true,
	};
	const IS_MOBILE = /Mobi|Android|iP(hone|[oa]d)/i.test(navigator.userAgent);
	const IS_SAFARI = navigator.userAgent.indexOf("Safari") > -1 && !/Chrome|CriOS/.test(navigator.userAgent);
	// Can not handle nested objects
	class DataStore {
		constructor(uuid, defaultStorage = {}) {
			if (typeof uuid !== "string" && typeof uuid !== "number") {
				throw new Error("Expected uuid when creating DataStore");
			}

			this.__uuid = uuid;
			this.__storage = defaultStorage;
			try {
				this.__storage = JSON.parse(GM_getValue(uuid));
			} catch {
				GM_setValue(uuid, JSON.stringify(defaultStorage));
			}

			return new Proxy(this, {
				get: (obj, prop) => {
					if (prop === "destroy") return () => obj.__destroy();
					if (prop === "update") return (updates) => obj.__update(updates);

					return obj.__storage[prop];
				},

				set: (obj, prop, value) => {
					obj.__storage[prop] = value;
					GM_setValue(obj.__uuid, JSON.stringify(obj.__storage));

					return true;
				},
			});
		}

		__update(updates) {
			if (updates) {
				Object.assign(this.__storage, updates);
				GM_setValue(this.__uuid, JSON.stringify(this.__storage));
			} else {
				try {
					this.__storage = JSON.parse(GM_getValue(this.__uuid)) || {};
				} catch {
					this.__storage = {};
				}
			}
		}

		__destroy() {
			GM_deleteValue(this.__uuid);
			this.__storage = {};
		}
	}

	const advancedSettings = new DataStore("advancedSettings", ADVANCED_SETTINGS_DEFAULTS);
	const coreSettings = new DataStore("coreSettings", CORE_SETTINGS_DEFAULTS);
	const hotkeysSettings = new DataStore("hotkeysSettings", HOTKEYS_SETTINGS_DEFAULTS);
	const mainSettings = new DataStore("mainSettings", MAIN_SETTINGS_DEFAULTS);
	const bingeStats = new DataStore("bingeStats", {
		episodesFinished: 0,
		watchSecondsTotal: 0,
		milestonesShown: [],
	});
	bingeStats.episodesFinished ??= 0;
	bingeStats.watchSecondsTotal ??= 0;
	bingeStats.milestonesShown ??= [];
	[
		[advancedSettings, ADVANCED_SETTINGS_DEFAULTS],
		[coreSettings, CORE_SETTINGS_DEFAULTS],
		[hotkeysSettings, HOTKEYS_SETTINGS_DEFAULTS],
		[mainSettings, MAIN_SETTINGS_DEFAULTS],
	].forEach(([settings, defaults]) => {
		Object.entries(defaults).forEach(([key, value]) => (settings[key] ??= value));
	});
	if (
		Object.keys(VIDEO_PROVIDERS_IDS).sort().toString() !==
		[...coreSettings[CORE_SETTINGS_MAP.providersPriority]].sort().toString()
	) {
		coreSettings[CORE_SETTINGS_MAP.providersPriority] = [
			...CORE_SETTINGS_DEFAULTS[CORE_SETTINGS_MAP.providersPriority],
		];
	}

	// -------------------------------------- /utils ---------------------------------------------

	const Notiflixx = (() => {
		GM_addStyle(`
  [id^=NotiflixBlockWrap], [id^=NotiflixConfirmWrap],
  [id^=NotiflixLoadingWrap], [id^=NotiflixNotifyWrap],
  [id^=NotiflixReportWrap] {
    -webkit-tap-highlight-color: #24242412;
  }

  div.notiflix-report-icon {
    width: 60px !important;
    height: 60px !important;
  }

  div.notiflix-report-content {
    max-width: 1010px !important;
    width: unset !important;
  }


  .notiflix-hotkeys-guide-modal {
    max-height: 70vh;
    overflow-y: auto;
    padding: 0 15px;
  }

  .notiflix-hotkeys-guide-modal h5 {
    font-size: 19px;
    margin: 25px 0 10px 0;
  }

  .notiflix-hotkeys-guide-modal h5:first-child {
    margin: 0 0 10px 0;
  }

  .notiflix-hotkeys-guide-modal div {
    color: black;
    margin-bottom: 5px;
  }

  .notiflix-hotkeys-guide-modal pre {
    background: #243743;
    border: none;
    display: inline-block;
    margin: 1px 0 1px 0;
    padding: 4px 8px;
    vertical-align: middle;
  }
  `);
		const notifyDefaultOptions = {
			closeButton: true,
			messageMaxLength: 500,
			plainText: false,
			position: "left-top",
			zindex: 3222222,
		};
		const reportDefaultOptions = {
			titleMaxLength: 100,
			zindex: 3222223,
		};
		const disableBodyScroll = () => {
			// Order is important here
			document.body.style.paddingRight = `${window.innerWidth - document.documentElement.clientWidth}px`;
			document.body.style.overflow = "hidden";
		};

		const restoreBodyScroll = () => {
			document.body.style.overflow = "";
			document.body.style.paddingRight = "";
		};

		const createNotifyHandler = (notifyType) => {
			return (message, customOptions = {}) => {
				Notiflix.Notify[notifyType](message, {
					...notifyDefaultOptions,
					...customOptions,
				});
			};
		};

		const createReportHandler = (reportType) => {
			return (titleText, messageText, btnText, customOptions = {}) => {
				disableBodyScroll();
				Notiflix.Report[reportType](
					titleText,
					messageText,
					btnText,
					() => {
						restoreBodyScroll();
					},
					{
						...reportDefaultOptions,
						...customOptions,
					},
				);
				if (customOptions.backOverlayClickToClose) {
					const backOverlay = document.querySelector('[id^=NotiflixReportWrap] > div[class*="-overlay"]');
					backOverlay?.addEventListener("click", () => restoreBodyScroll());
				}

				if (customOptions.delayedButton) {
					const closeBtn = document.querySelector("a#NXReportButton");
					closeBtn.style.background = "#b2b2b2";
					closeBtn.style.pointerEvents = "none";

					setTimeout(() => {
						closeBtn.style.background = "#26c0d3";
						closeBtn.style.pointerEvents = "";
					}, 2000);
				}
			};
		};
		return {
			notify: {
				failure: createNotifyHandler("failure"),
				warning: createNotifyHandler("warning"),
			},

			report: {
				info: createReportHandler("info"),
				warning: createReportHandler("warning"),
			},
		};
	})();

	waitForElement(
		".inSiteWebStream",
		{
			existing: true,
		},
		function (container) {
			(function () {
				"use strict";

				const heightMap = {
					Vidmoly: "600px",
					Luluvdo: "480px",
					Filemoon: "480px",
				};
				let vidmolyIframe = null;
				let vidmolyUrl = null;
				let vidmolyReady = false;

				function log(...args) {
					console.log("%c[🔥 SmartLoader]", "color: lime;", ...args);
				}

				function spoofVidmolyEnv() {
					window.adsbygoogle = window.adsbygoogle || [];
					window.vsd1 = {
						skip: true,
						adblock: true,
					};
					document.cookie = "molyast21=1; path=/; domain=.vidmoly.to";

					const patch = document.createElement("script");
					patch.innerHTML = `
            (() => {
                const og = window.jwplayer;
                Object.defineProperty(window, 'jwplayer', {
                    configurable: true,
                    get: () => function(id) {
                        const p = og(id);
                        const s = p.setup;
                        p.setup = function(cfg) {
                            if (cfg.advertising) cfg.advertising = {};
                            return s.call(this, cfg);
                        };
                        return p;
                    }
                });
            })();
        `;
					document.body.appendChild(patch);
				}

				function showLoader(type) {
					const old = document.querySelector("#loadingMessage");
					if (old) old.remove();
					const msg = document.createElement("div");
					msg.id = "loadingMessage";
					msg.innerText = `⏳ ${i18n.loading} ${type}...`;
					Object.assign(msg.style, {
						background: "#111",
						color: "#fff",
						fontFamily: "sans-serif",
						padding: "20px",
						textAlign: "center",
					});
					container.innerHTML = "";
					container.appendChild(msg);
				}

				function clearLoader() {
					const l = document.querySelector("#loadingMessage");
					if (l) l.remove();
				}

				function buildIframe(src, type) {
					const iframe = document.createElement("iframe");
					iframe.src = src;
					iframe.allowFullscreen = true;
					iframe.frameBorder = "0";
					iframe.width = "100%";
					iframe.height = heightMap[type] || "500px";
					Object.assign(iframe.style, {
						display: "block",
						border: "none",
						position: "relative",
						margin: "0 auto",
					});
					return iframe;
				}

				function injectJWplayer(iframe) {
					try {
						const win = iframe.contentWindow;
						const tryInject = setInterval(() => {
							try {
								const player = win?.jwplayer?.();
								if (player && typeof player.play === "function") {
									player.play();
									clearInterval(tryInject);
									log("▶️ JWPlayer play() called inside iframe");
								}
							} catch {}
						}, 500);
					} catch (err) {
						log("❌ JW inject failed:", err);
					}
				}

				function embedVidmoly() {
					if (!vidmolyReady || !vidmolyIframe || !vidmolyUrl) {
						alert(i18n.vidmolyNotReady);
						return;
					}
					container.innerHTML = "";
					const realIframe = buildIframe(vidmolyUrl, "Vidmoly");
					container.appendChild(realIframe);
					injectJWplayer(realIframe);
				}

				function embedGeneric(url, type, attempt = 1) {
					showLoader(type);
					const iframe = buildIframe(url, type);
					container.innerHTML = "";
					container.appendChild(iframe);

					const timeout = setTimeout(() => {
						if (!iframe.dataset.loaded && attempt < 2) {
							log(`🔁 Retrying ${type}...`);
							return setTimeout(() => embedGeneric(url, type, attempt + 1), 1000);
						} else if (!iframe.dataset.loaded) {
							clearLoader();
							window.open(url, "_blank");
						}
					}, 8000);

					iframe.onload = () => {
						clearTimeout(timeout);
						iframe.dataset.loaded = "true";
						clearLoader();
						log(`✅ ${type} loaded`);
					};
				}

				async function preloadVidmoly(url) {
					spoofVidmolyEnv();
					vidmolyIframe = document.createElement("iframe");
					vidmolyIframe.src = url;
					vidmolyIframe.allowFullscreen = true;
					vidmolyIframe.frameBorder = "0";
					vidmolyIframe.width = "100%";
					vidmolyIframe.height = heightMap.Vidmoly;
					vidmolyIframe.style.cssText = "position:absolute;width:1px;height:1px;left:-9999px;top:-9999px;";
					vidmolyIframe.onload = () => {
						vidmolyReady = true;
						log("✅ Vidmoly iframe preloaded.");
					};
					document.body.appendChild(vidmolyIframe);
				}

				async function detectVidmoly() {
					spoofVidmolyEnv();
					const anchor = [...document.querySelectorAll("a.watchEpisode")].find((a) => {
						return a.querySelector("i.icon.Vidmoly");
					});
					const href = anchor?.getAttribute("href");
					if (!href) return;

					const url = new URL(href, location.origin);
					vidmolyUrl = url.href;
					await preloadVidmoly(vidmolyUrl);
				}

				advancedSettings[ADVANCED_SETTINGS_MAP.preloadOtherProviders] &&
					document.addEventListener("click", async function (e) {
						const anchor = e.target.closest("a.watchEpisode");
						if (!anchor) return;
						const text = anchor.innerText.toLowerCase();
						const isVid = text.includes("vidmoly");
						const isLulu = text.includes("luluvdo");
						const isMoon = text.includes("filemoon");
						if (!isVid && !isLulu && !isMoon) return;

						e.preventDefault();
						const href = anchor.getAttribute("href");
						const type = isVid ? "Vidmoly" : isLulu ? "Luluvdo" : "Filemoon";

						const fullUrl = new URL(href, location.origin).href;
						try {
							if (type === "Filemoon" && fullUrl.includes("/d/")) {
								return embedGeneric(fullUrl.replace("/d/", "/e/"), type);
							}
							if (type === "Vidmoly") {
								vidmolyUrl = fullUrl;
								return embedVidmoly();
							}
							return embedGeneric(fullUrl, type);
						} catch (err) {
							console.warn("❌ Failed to load:", err);
							alert(`${i18n.couldNotLoad} ${type}`);
						}
					});

				function waitForElement(selector, opts = {}, cb) {
					const { interval = 50, timeout = 10000 } = opts;
					const start = Date.now();
					const timer = setInterval(() => {
						const el = document.querySelector(selector);
						if (el) {
							clearInterval(timer);
							cb(el);
						} else if (Date.now() - start > timeout) {
							clearInterval(timer);
							console.warn(`[SmartLoader] ❌ Timed out waiting for ${selector}`);
						}
					}, interval);
				}

				// wait until .watchEpisode buttons are loaded
				advancedSettings[ADVANCED_SETTINGS_MAP.preloadOtherProviders] &&
					waitForElement(
						"a.watchEpisode i.icon.Vidmoly",
						{
							timeout: 10000,
						},
						() => {
							log("🧠 Vidmoly <a> tag detected, calling detectVidmoly()");
							detectVidmoly();
						},
					);
				//  this will now run after .inSiteWebStream is ready!
				async function checkIframeForLoadXWarning() {
					const iframe = document.querySelector(".inSiteWebStream iframe");
					if (!iframe || !iframe.src) {
						setTimeout(checkIframeForLoadXWarning, 1000);
						return;
					}

					const proxyUrl = `https://aniworld-to-cors-proxy.fly.dev/${iframe.src.replace(/^\/+/, "")}`;
					try {
						const response = await fetch(proxyUrl);
						const html = await response.text();

						const hasWarning = html.includes("<h1>Warning</h1>") && html.includes("The video is not ready yet.");
						const has404 = html.includes("<h1>404</h1>") || html.toLowerCase().includes("no video found");

						if (!(hasWarning || has404)) return;
						let providerOrder = ["0", "1", "2", "3", "4"];
						try {
							const raw = await GM.getValue("coreSettings");
							if (raw) {
								const parsed = JSON.parse(raw);
								const dynamicOrder = parsed?.providersPriority;
								if (Array.isArray(dynamicOrder) && dynamicOrder.length > 0) {
									providerOrder = dynamicOrder;
								}
							}
						} catch {}

						const loadXIndex = providerOrder.indexOf("0");
						if (loadXIndex === -1) return;

						for (let i = loadXIndex + 1; i < providerOrder.length; i++) {
							const providerId = providerOrder[i];
							const providerName = getHosterName(providerId);

							const button = [...document.querySelectorAll("a.watchEpisode")]
								.find((a) => a.href.includes("/redirect/") && a.innerText.includes(providerName))
								?.querySelector(".hosterSiteVideoButton");
							if (button) {
								button.click();
								await new Promise((resolve) => setTimeout(resolve, 3000));

								const iframe = document.querySelector(".inSiteWebStream iframe");
								if (!iframe || !iframe.src) continue;
								const proxyUrl = `https://aniworld-to-cors-proxy.fly.dev/${iframe.src.replace(/^\/+/, "")}`;
								const response = await fetch(proxyUrl);
								const html = await response.text();
								const hasWarning = html.includes("<h1>Warning</h1>") && html.includes("The video is not ready yet.");
								const has404 = html.includes("<h1>404</h1>") || html.toLowerCase().includes("no video found");
								if (!hasWarning && !has404) {
									return;
								}
							}
						}
					} catch {}
				}

				function getHosterName(id) {
					const map = {
						0: "LoadX",
						1: "VOE",
						2: "SpeedFiles",
						3: "Vidoza",
						4: "Doodstream",
					};
					return map[id] || "Unknown";
				}

				setTimeout(checkIframeForLoadXWarning, 150);
			})();
		},
	);
	// Prevent volume scroll on player, allow page scroll, but still allow volume control
	window.addEventListener(
		"wheel",
		function (e) {
			const volumeBar = e.target.closest(".vjs-volume-bar");
			const volumeIcon = e.target.closest(".vjs-mute-control");
			const playerWrapper = e.target.closest(".video-js");

			if (volumeBar || volumeIcon) return;

			if (playerWrapper) {
				e.stopImmediatePropagation();
			}
		},
		{
			passive: false,
			capture: true,
		},
	);

	// Set by the top scope so settings changes restyle visited episodes live
	let refreshVisitedStyle = null;

	function detectDoubletap(
		element,
		callback,
		{ maxIntervalMs = 300, tapsDistanceThresholdPx = 50, validPointerTypes = ["pen", "touch"] } = {
			maxIntervalMs: 300,
			tapsDistanceThresholdPx: 50,
			validPointerTypes: ["pen", "touch"],
		},
	) {
		let lastTapTime = 0;
		let lastTapX = 0;
		let lastTapY = 0;
		let tapped = false;
		element.addEventListener("pointerdown", (ev) => {
			if (!validPointerTypes.includes(ev.pointerType)) return;

			const currentTime = Date.now();
			const tapInterval = currentTime - lastTapTime;

			const distance = Math.sqrt(Math.pow(ev.clientX - lastTapX, 2) + Math.pow(ev.clientY - lastTapY, 2));

			if (tapped && tapInterval < maxIntervalMs && distance <= tapsDistanceThresholdPx) {
				callback(ev);
				tapped = false;
				lastTapTime = 0;
				lastTapX = 0;
				lastTapY = 0;
			} else {
				tapped = true;
				lastTapTime = currentTime;
				lastTapX = ev.clientX;
				lastTapY = ev.clientY;
			}
		});
	}

	function detectHold(
		element,
		callback,
		{ holdTimeMs = 700, validPointerTypes = ["mouse", "pen", "touch"] } = {
			holdTimeMs: 700,
			validPointerTypes: ["mouse", "pen", "touch"],
		},
	) {
		let timer;
		const clearHold = () => clearTimeout(timer);
		const startHold = (ev) => {
			if (validPointerTypes.includes(ev.pointerType)) {
				timer = setTimeout(() => callback(), holdTimeMs);
			}
		};

		element.addEventListener("pointerdown", startHold);
		element.addEventListener("pointerup", clearHold);
		element.addEventListener("pointercancel", clearHold);
		element.addEventListener("pointerout", clearHold);
		element.addEventListener("pointerleave", clearHold);
	}

	function isEmbedded() {
		try {
			return window.top !== window.self;
		} catch {
			return true;
		}
	}

	function isNumeric(n) {
		return !isNaN(parseFloat(n)) && isFinite(n);
	}

	function makeId(length = 16) {
		const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
		let text = "";

		for (let i = 0; i < length; i++) {
			text += chars.charAt(Math.floor(Math.random() * chars.length));
		}

		return text;
	}

	function formatHMS(ms) {
		const total = Math.max(0, Math.round(ms / 1000));
		const h = Math.floor(total / 3600);
		const m = Math.floor((total % 3600) / 60);
		const s = total % 60;
		return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
	}

	async function sleep(ms = 0) {
		return new Promise((r) => setTimeout(r, ms));
	}

	// Create "Skip intro" button
	function setupSkipIntroButton(player) {
		const SKIP_BTN_STYLE = `
    .SkipIntroBtn {
      position: fixed;
      bottom: 75px;
      right: 5px;
      padding: 10px;
      font-size: 16px;
      font-weight: bold;
      font-family: sans-serif;
      color: white;
      background-color: rgba(0, 0, 0, 0.55);
      border: 2px solid gray;
      text-transform: uppercase;
      cursor: pointer;
      opacity: 1;
      transition: background-color 130ms, opacity 200ms;
      z-index: 9999;
    }
    .SkipIntroBtn:hover {
      background-color: rgba(0, 0, 0, 1);
    }
    .SkipIntroBtn.invisible {
      opacity: 0;
      pointer-events: none;
    }
    .SubmitToAniSkipBtn {
        position: absolute;
        bottom: 57px;
        right: 80px;
        padding: 8px 16px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        z-index: 9999;
        transition: all 0.3s ease;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .SubmitToAniSkipBtn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
    }
    .SubmitToAniSkipBtn.invisible {
        opacity: 0;
        pointer-events: none;
    }
  `;
		const button = document.createElement("button");
		button.className = "SkipIntroBtn";
		button.textContent = i18n.skipIntro;
		button.addEventListener("click", () => {
			console.log("[Skip Button] Clicked. globalAniSkipData:", globalAniSkipData);

			// Check if we have AniSkip data for intro
			if (globalAniSkipData && globalAniSkipData.intro) {
				// Use AniSkip intro end time
				console.log("[Skip Button] Using AniSkip time:", globalAniSkipData.intro.end);
				player.currentTime = globalAniSkipData.intro.end;
			} else {
				// Fallback to manual skip size
				console.log("[Skip Button] Using fallback skip size:", coreSettings[CORE_SETTINGS_MAP.currentLargeSkipSizeS]);
				player.currentTime += coreSettings[CORE_SETTINGS_MAP.currentLargeSkipSizeS];
			}

			if (advancedSettings[ADVANCED_SETTINGS_MAP.playOnLargeSkip]) {
				player.play();
			}
			button.remove();
		});
		GM_addStyle(SKIP_BTN_STYLE);

		const insertButton = () => {
			const loadX = document.querySelector(".jw-controlbar");
			const speedFiles = document.querySelector("#my-video");
			const voe = document.querySelector(".jw-controls");

			if (loadX) {
				loadX.appendChild(button);
			} else if (speedFiles || voe) {
				document.body.appendChild(button);
			}
		};

		const observeActivity = (container) => {
			new MutationObserver(() => {
				const isActive =
					container.classList.contains("jw-state-paused") ||
					!container.classList.contains("jw-flag-user-inactive") ||
					container.classList.contains("vjs-paused") ||
					!container.classList.contains("vjs-user-inactive");
				if (document.contains(button)) {
					button.classList.toggle(
						"invisible",
						!isActive || !advancedSettings[ADVANCED_SETTINGS_MAP.showSkipIntroButton],
					);
				}
			}).observe(container, {
				attributes: true,
				attributeFilter: ["class"],
			});
		};

		waitForElement(
			".jw-controlbar, #my-video, .jw-controls",
			{
				existing: true,
				onceOnly: true,
			},
			insertButton,
		);
		document.addEventListener("fullscreenchange", () => {
			const isFullscreen = !!document.fullscreenElement;
			if (isFullscreen) {
				button.style.bottom = "80px";
			} else {
				button.style.bottom = "57px";
			}
		});

		const activityContainer =
			document.querySelector("#player") || document.querySelector("#my-video") || document.querySelector("#a");
		if (activityContainer) observeActivity(activityContainer);

		const hideAt = advancedSettings[ADVANCED_SETTINGS_MAP.showSkipIntroButtonSeconds];

		const timeCheckInterval = () => {
			// If we have AniSkip data, show button from start until intro ends
			if (globalAniSkipData && globalAniSkipData.intro) {
				const currentTime = player.currentTime;
				const introEnd = globalAniSkipData.intro.end;

				// Hide button only after intro ends
				if (currentTime >= introEnd) {
					button.remove();
					player.removeEventListener("timeupdate", timeCheckInterval);
				}
			} else {
				// Fallback to original time-based logic
				if (player.currentTime >= hideAt) {
					button.remove();
					player.removeEventListener("timeupdate", timeCheckInterval);
				}
			}
		};

		player.addEventListener("timeupdate", timeCheckInterval);
	}

	// Add visual markers on timeline for intro/outro
	function createSubmitToAniSkipButton(player, iframeInterface) {
		console.log("[Submit Button] Creating submit button");
		const button = document.createElement("button");
		button.className = "SubmitIntroBtn";
		button.textContent = i18n.submitToAniSkip;

		// Helper to convert MM:SS or SS to seconds
		function timeToSeconds(timeStr) {
			timeStr = String(timeStr).trim();

			// If it contains a colon, it's MM:SS format
			if (timeStr.includes(":")) {
				const parts = timeStr.split(":");
				if (parts.length === 2) {
					const minutes = parseInt(parts[0]) || 0;
					const seconds = parseInt(parts[1]) || 0;
					return minutes * 60 + seconds;
				}
			}

			// Otherwise treat as seconds
			return parseFloat(timeStr) || 0;
		}

		// Helper to format seconds as MM:SS
		function secondsToTime(seconds) {
			const mins = Math.floor(seconds / 60);
			const secs = Math.floor(seconds % 60);
			return `${mins}:${secs.toString().padStart(2, "0")}`;
		}

		button.addEventListener("click", async () => {
			console.log("[Submit Button] Clicked");

			// Get current time as suggestion
			const currentTime = Math.floor(player.currentTime);
			const suggestedStart = secondsToTime(currentTime);
			const suggestedEnd = secondsToTime(currentTime + 90);

			// Step 1: Get intro start time
			const startInput = await new Promise((resolve) => {
				Notiflix.Report.prompt(
					i18n.submitIntroTimes,
					`${i18n.submitIntroTimesDesc}<br><br>${i18n.introStartTime} (MM:SS or seconds):`,
					suggestedStart,
					i18n.submitButton,
					i18n.cancelButton,
					(clientAnswer) => resolve(clientAnswer),
					() => resolve(null),
				);
			});

			if (startInput === null) return;

			const introStart = timeToSeconds(startInput);
			console.log("[Submit Button] Intro start:", startInput, "→", introStart, "seconds");

			// Step 2: Get intro end time
			const endInput = await new Promise((resolve) => {
				Notiflix.Report.prompt(
					i18n.submitIntroTimes,
					`${i18n.introEndTime} (MM:SS or seconds):`,
					suggestedEnd,
					i18n.submitButton,
					i18n.cancelButton,
					(clientAnswer) => resolve(clientAnswer),
					() => resolve(null),
				);
			});

			if (endInput === null) return;

			const introEnd = timeToSeconds(endInput);
			console.log("[Submit Button] Intro end:", endInput, "→", introEnd, "seconds");

			// Validate
			if (!Number.isFinite(introStart) || !Number.isFinite(introEnd) || introEnd <= introStart) {
				Notiflix.Notify.failure(i18n.invalidTimes, {
					timeout: 3000,
					position: "right-bottom",
				});
				return;
			}

			// Get MAL ID
			const malId = await AniSkipModule.getMalId(iframeInterface.animeTitle, iframeInterface.animeSlug);
			if (!malId) {
				Notiflix.Notify.failure("Could not find MAL ID", {
					timeout: 3000,
					position: "right-bottom",
				});
				return;
			}

			const episodeLength = player.duration ? Math.floor(player.duration) : 0;

			console.log("[Submit Button] Submitting:", {
				malId,
				episode: iframeInterface.episodeNumber,
				episodeLength,
				introStart,
				introEnd,
			});

			// Submit
			Notiflix.Notify.info(i18n.submittingToAniSkip, {
				timeout: 3000,
				position: "right-bottom",
			});

			const result = await AniSkipModule.submitSkipTimes(
				malId,
				iframeInterface.episodeNumber,
				episodeLength,
				introStart,
				introEnd,
			);

			if (result.success) {
				Notiflix.Notify.success(i18n.submitSuccess, {
					timeout: 5000,
					position: "right-bottom",
				});
				button.remove();
			} else {
				Notiflix.Notify.failure(i18n.submitError + (result.error ? `: ${result.error}` : ""), {
					timeout: 5000,
					position: "right-bottom",
				});
			}
		});

		const insertButton = () => {
			const loadX = document.querySelector(".jw-controlbar");
			const speedFiles = document.querySelector("#my-video");
			const voe = document.querySelector(".jw-controls");

			if (loadX) {
				loadX.appendChild(button);
			} else if (speedFiles || voe) {
				document.body.appendChild(button);
			}
		};

		waitForElement(
			".jw-controlbar, #my-video, .jw-controls",
			{
				existing: true,
				onceOnly: true,
			},
			insertButton,
		);

		document.addEventListener("fullscreenchange", () => {
			const isFullscreen = !!document.fullscreenElement;
			if (isFullscreen) {
				button.style.bottom = "153px"; // 80px + 73px for skip button
			} else {
				button.style.bottom = "105px"; // 57px + 48px for skip button
			}
		});
	}

	// Add visual markers on timeline for intro/outro
	function addTimelineMarkers(player) {
		if (!globalAniSkipData) {
			return;
		}

		if (!player.duration || !isFinite(player.duration)) {
			player.addEventListener("durationchange", () => addTimelineMarkers(player), { once: true });
			return;
		}

		// Remove any existing markers
		document.querySelectorAll(".aniskip-marker").forEach((el) => el.remove());

		// Find the slider
		const slider = document.querySelector(".jw-slider-time") || document.querySelector(".jw-slider-container");

		if (!slider) {
			setTimeout(() => addTimelineMarkers(player), 1000);
			return;
		}

		// Ensure relative positioning
		const computedStyle = window.getComputedStyle(slider);
		if (computedStyle.position === "static") {
			slider.style.position = "relative";
		}

		// Add intro marker only (not outro)
		if (globalAniSkipData.intro) {
			const startPct = (globalAniSkipData.intro.start / player.duration) * 100 + 0.5;
			const widthPct = ((globalAniSkipData.intro.end - globalAniSkipData.intro.start) / player.duration) * 100;

			const marker = document.createElement("div");
			marker.className = "aniskip-marker";
			marker.style.cssText = `
                position: absolute;
                left: ${startPct}%;
                width: ${widthPct}%;
                top: 30%;
                height: 60%;
                background-color: rgba(255, 0, 251, 0.5);
                pointer-events: none;
                z-index: 100;
                border-radius: 2px;
            `;
			slider.appendChild(marker);
		}
	}

	function waitForElement(
		query,
		{
			callbackOnTimeout = false,
			existing = false,
			onceOnly = false,
			rootElement = document.documentElement,
			timeout,

			// "attributes" prop is not supported
			observerOptions = {
				childList: true,
				subtree: true,
			},
		},
		callback,
	) {
		if (!query) throw new Error("Query is needed");
		if (!callback) throw new Error("Callback is needed");

		const handledElements = new WeakSet();
		const existingElements = rootElement.querySelectorAll(query);
		let timeoutId = null;
		if (existingElements.length) {
			// Mark all as handled for a proper work when `existing` is false
			// to ignore them later on
			for (const node of existingElements) {
				handledElements.add(node);
			}

			if (existing) {
				if (onceOnly) {
					try {
						callback(existingElements[0]);
					} catch (e) {
						console.error(e);
					}

					return;
				} else {
					for (const node of existingElements) {
						try {
							callback(node);
						} catch (e) {
							console.error(e);
						}
					}
				}
			}
		}

		const observer = new MutationObserver((mutations, observer) => {
			for (const node of rootElement.querySelectorAll(query)) {
				if (handledElements.has(node)) continue;

				handledElements.add(node);

				try {
					callback(node);
				} catch (e) {
					console.error(e);
				}

				if (onceOnly) {
					observer.disconnect();

					if (timeoutId) clearTimeout(timeoutId);

					return;
				}
			}
		});
		observer.observe(rootElement, {
			attributes: false,
			childList: observerOptions.childList || false,
			subtree: observerOptions.subtree || false,
		});
		if (timeout !== undefined) {
			timeoutId = setTimeout(() => {
				observer.disconnect();

				if (callbackOnTimeout) {
					try {
						callback(null);
					} catch (e) {
						console.error(e);
					}
				}
			}, timeout);
		}

		return observer;
	}

	async function waitForUserInteraction() {
		return new Promise((resolve) => {
			const handler = () => {
				document.removeEventListener("pointerup", handler);
				document.removeEventListener("keydown", handler);

				resolve();
			};

			document.addEventListener("pointerup", handler, {
				once: true,
			});
			document.addEventListener("keydown", handler, {
				once: true,
			});
		});
	}

	// -------------------------------------- utils\ ---------------------------------------------

	/* CommLink.js
    - Version: 1.0.1
    - Author: Haka
    - Description: A userscript library for cross-window communication via the userscript storage
    - GitHub: https://github.com/AugmentedWeb/CommLink
    */
	class CommLinkHandler {
		constructor(commlinkID, configObj) {
			this.commlinkID = commlinkID;
			this.singlePacketResponseWaitTime = configObj?.singlePacketResponseWaitTime || 1500;
			this.maxSendAttempts = configObj?.maxSendAttempts || 3;
			this.statusCheckInterval = configObj?.statusCheckInterval || 1;
			this.silentMode = configObj?.silentMode || false;
			this.commlinkValueIndicator = "commlink-packet-";
			this.commands = {};
			this.listeners = [];

			const missingGrants = ["GM_getValue", "GM_setValue", "GM_deleteValue", "GM_listValues"].filter(
				(grant) => !(GM_info.script.grant || []).includes(grant),
			);
			if (missingGrants.length > 0 && !this.silentMode) {
				alert(
					`[CommLink] The following userscript grants are missing: ${missingGrants.join(", ")}. CommLink will not work.`,
				);
			}

			this.getStoredPackets()
				.filter((packet) => Date.now() - packet.date > 2e4)
				.forEach((packet) => this.removePacketByID(packet.id));
		}

		setIntervalAsync(callback, interval = this.statusCheckInterval) {
			let running = true;
			async function loop() {
				while (running) {
					try {
						await callback();
						await new Promise((resolve) => setTimeout(resolve, interval));
					} catch {
						continue;
					}
				}
			}
			loop();

			return {
				stop: () => {
					running = false;
					return false;
				},
			};
		}

		getUniqueID() {
			return ([1e7] + -1e3 + 4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
				(c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16),
			);
		}

		getCommKey(packetID) {
			return this.commlinkValueIndicator + packetID;
		}

		getStoredPackets() {
			return GM_listValues()
				.filter((key) => key.includes(this.commlinkValueIndicator))
				.map((key) => GM_getValue(key));
		}

		addPacket(packet) {
			GM_setValue(this.getCommKey(packet.id), packet);
		}

		removePacketByID(packetID) {
			GM_deleteValue(this.getCommKey(packetID));
		}

		findPacketByID(packetID) {
			return GM_getValue(this.getCommKey(packetID));
		}

		editPacket(newPacket) {
			GM_setValue(this.getCommKey(newPacket.id), newPacket);
		}

		send(platform, cmd, d) {
			return new Promise(async (resolve) => {
				const packetWaitTimeMs = this.singlePacketResponseWaitTime;
				const maxAttempts = this.maxSendAttempts;

				let attempts = 0;

				for (;;) {
					attempts++;

					const packetID = this.getUniqueID();
					const attemptStartDate = Date.now();

					const packet = {
						command: cmd,
						data: d,
						date: attemptStartDate,
						id: packetID,
						sender: platform,
					};

					if (!this.silentMode) {
						console.log(`[CommLink Sender] Sending packet! (#${attempts} attempt):`, packet);
					}

					this.addPacket(packet);

					for (;;) {
						const poolPacket = this.findPacketByID(packetID);
						const packetResult = poolPacket?.result;

						if (poolPacket && packetResult) {
							if (!this.silentMode) {
								console.log(`[CommLink Sender] Got result for a packet (${packetID}):`, packetResult);
							}

							resolve(poolPacket.result);
							attempts = maxAttempts; // stop main loop

							break;
						}

						if (!poolPacket || Date.now() - attemptStartDate > packetWaitTimeMs) {
							break;
						}

						await new Promise((res) => setTimeout(res, this.statusCheckInterval));
					}

					this.removePacketByID(packetID);
					if (attempts === maxAttempts) break;
				}

				return resolve(null);
			});
		}

		registerSendCommand(name, obj) {
			this.commands[name] = async (data) => {
				return await this.send(obj?.commlinkID || this.commlinkID, name, obj?.data || data);
			};
		}

		registerListener(sender, commandHandler) {
			const listener = {
				sender,
				commandHandler,
				intervalObj: this.setIntervalAsync(this.receivePackets.bind(this), this.statusCheckInterval),
			};
			this.listeners.push(listener);
		}

		receivePackets() {
			this.getStoredPackets().forEach((packet) => {
				this.listeners.forEach((listener) => {
					if (packet.sender === listener.sender && !packet.hasOwnProperty("result")) {
						const result = listener.commandHandler(packet);

						packet.result = result;

						this.editPacket(packet);

						if (!this.silentMode) {
							if (packet.result === null) {
								console.log("[CommLink Receiver] Possibly failed to handle packet:", packet);
							} else {
								console.log("[CommLink Receiver] Successfully handled a packet:", packet);
							}
						}
					}
				});
			});
		}

		kill() {
			this.listeners.forEach((listener) => listener.intervalObj.stop());
		}
	}

	class IframeMessenger {
		constructor() {
			this.commLink = null;
			this.topScopeId = null;
		}

		static get messages() {
			return {
				AUTOPLAY_NEXT: "AUTOPLAY_NEXT",
				REQUEST_CURRENT_FRANCHISE_DATA: "REQUEST_CURRENT_FRANCHISE_DATA",
				REQUEST_FULLSCREEN_STATE: "REQUEST_FULLSCREEN_STATE",
				MARK_CURRENT_VIDEO_WATCHED: "MARK_CURRENT_VIDEO_WATCHED",
				OPEN_HOTKEYS_GUIDE: "OPEN_HOTKEYS_GUIDE",
				TOGGLE_FULLSCREEN: "TOGGLE_FULLSCREEN",
				TOP_NOTIFLIX_REPORT_INFO: "TOP_NOTIFLIX_REPORT_INFO",
				UPDATE_CORE_SETTINGS: "UPDATE_CORE_SETTINGS",
			};
		}

		async initCrossFrameConnection() {
			const iframeId = makeId();
			let answerTaken = false;
			const topScopeIdPromise = new Promise((resolve) => {
				const takeAnswer = (value) => {
					if (answerTaken || !value) return;
					answerTaken = true;
					GM_deleteValue(iframeId);
					resolve(value);
				};
				// Top scope using GM_setValue will write its own id using iframeId as a key
				const valueChangeListenerId = GM_addValueChangeListener(iframeId, (_key, _oldValue, newValue) => {
					GM_removeValueChangeListener(valueChangeListenerId);
					takeAnswer(newValue);
				});
				// Poll as well: TM MV3 change events can get lost between frames
				(async () => {
					for (let i = 0; i < 120 && !answerTaken; i++) {
						await sleep(500);
						takeAnswer(GM_getValue(iframeId));
					}
				})();
			});
			// This should be almost immediately picked up by a top scope
			GM_setValue("unboundIframeId", iframeId);
			// Re-announce until the top scope answers: with Tampermonkey (MV3) the
			// first write can land before the top scope listener is registered
			(async () => {
				for (let i = 0; i < 25 && !answerTaken; i++) {
					await sleep(800);
					if (answerTaken) break;
					GM_deleteValue("unboundIframeId");
					GM_setValue("unboundIframeId", iframeId);
				}
				if (answerTaken && GM_getValue("unboundIframeId") === iframeId) {
					GM_deleteValue("unboundIframeId");
				}
			})();
			const topScopeId = await topScopeIdPromise;

			if (!iframeId || !topScopeId) throw new Error("Something went wrong");

			this.topScopeId = topScopeId;
			this.commLink = new CommLinkHandler(iframeId, {
				silentMode: true,
				statusCheckInterval: advancedSettings[ADVANCED_SETTINGS_MAP.commlinkPollingIntervalMs],
			});
			this.commLink.registerSendCommand(IframeMessenger.messages.AUTOPLAY_NEXT);
			this.commLink.registerSendCommand(IframeMessenger.messages.REQUEST_CURRENT_FRANCHISE_DATA);
			this.commLink.registerSendCommand(IframeMessenger.messages.REQUEST_FULLSCREEN_STATE);
			this.commLink.registerSendCommand(IframeMessenger.messages.MARK_CURRENT_VIDEO_WATCHED);
			this.commLink.registerSendCommand(IframeMessenger.messages.OPEN_HOTKEYS_GUIDE);
			this.commLink.registerSendCommand(IframeMessenger.messages.TOGGLE_FULLSCREEN);
			this.commLink.registerSendCommand(IframeMessenger.messages.TOP_NOTIFLIX_REPORT_INFO);
			this.commLink.registerSendCommand(IframeMessenger.messages.UPDATE_CORE_SETTINGS);
		}

		registerConnectionListener(callback) {
			return this.commLink.registerListener(this.topScopeId, callback);
		}

		sendMessage(message, msgData) {
			this.commLink.commands[message](msgData);
			return;
		}
	}

	class IframeInterface {
		constructor(messenger) {
			this.commLink = null;
			this.currentFranchiseId = null;
			this.currentVideoId = null;
			this.ignoreMissingFranchiseOnce = true;
			this.isInFullscreen = null;
			this.messenger = messenger;
			this.topScopeDomainId = "";
			this.aniSkipData = null; // Store fetched AniSkip times
			// Store anime info for AniSkip
			this.animeTitle = null;
			this.animeSlug = null;
			this.episodeNumber = null;
			this.seasonNumber = null;
			coreSettings[CORE_SETTINGS_MAP.currentLargeSkipSizeS] =
				advancedSettings[ADVANCED_SETTINGS_MAP.defaultLargeSkipSizeS];
			coreSettings[CORE_SETTINGS_MAP.currentOutroSkipThresholdS] =
				advancedSettings[ADVANCED_SETTINGS_MAP.defaultOutroSkipThresholdS];
		}

		static get franchiseSpecificDataGMPrefix() {
			return "franchiseSpecificData_";
		}

		static makePlaybackPositionGMKey(topScopeDomainId, episodeId) {
			if (!topScopeDomainId || !episodeId) throw new Error("Something is missing");
			return `playbackTimestamp_${topScopeDomainId}_${episodeId}`;
		}

		// It is better not to be async
		handleTopScopeMessages(packet) {
			(async function () {
				try {
					switch (packet.command) {
						case TopScopeInterface.messages.CURRENT_FRANCHISE_DATA: {
							// At least one value is going to be present
							this.currentVideoId = packet.data.currentVideoId || null;
							this.topScopeDomainId = packet.data.topScopeDomainId || "";

							// Store anime info for AniSkip
							this.animeTitle = packet.data.animeTitle || null;
							this.animeSlug = packet.data.animeSlug || null;
							this.episodeNumber = packet.data.episodeNumber || null;
							this.seasonNumber = packet.data.seasonNumber || null;

							// Fetch AniSkip data when we receive episode info
							// Only on aniworld.to - AniSkip is for anime, not series
							if (this.animeTitle && this.animeSlug && this.episodeNumber && this.topScopeDomainId !== "sto") {
								// Wait for video duration to be available so we can pass episodeLength to AniSkip API
								const waitForDurationThenFetch = async () => {
									const player = document.querySelector("video");
									if (player && player.duration && isFinite(player.duration) && player.duration > 0) {
										return this.fetchAniSkipData();
									}
									// Wait for loadedmetadata, with a timeout fallback
									return new Promise((resolve) => {
										let resolved = false;
										const onReady = () => {
											if (resolved) return;
											resolved = true;
											this.fetchAniSkipData()
												.then(resolve)
												.catch(() => resolve(null));
										};
										if (player) {
											player.addEventListener("loadedmetadata", onReady, { once: true });
										}
										// Fallback: fetch anyway after 5s even without duration
										setTimeout(onReady, 5000);
									});
								};

								waitForDurationThenFetch()
									.then((data) => {
										this.aniSkipData = data;
										globalAniSkipData = data;
										// Now that we have the data, add timeline markers
										const player = document.querySelector("video");
										if (player) {
											addTimelineMarkers(player);
										}
									})
									.catch((err) => {
										console.error("[AniSkip] Error during fetch:", err);
									});
							}

							if (packet.data.currentFranchiseId) {
								this.currentFranchiseId = packet.data.currentFranchiseId;

								const { largeSkipSizeS, outroSkipThresholdS } =
									GM_getValue(`${IframeInterface.franchiseSpecificDataGMPrefix}${this.currentFranchiseId}`) || {};

								if (isNumeric(largeSkipSizeS)) {
									coreSettings[CORE_SETTINGS_MAP.currentLargeSkipSizeS] = largeSkipSizeS;
								} else {
									coreSettings[CORE_SETTINGS_MAP.currentLargeSkipSizeS] =
										advancedSettings[ADVANCED_SETTINGS_MAP.defaultLargeSkipSizeS];
								}

								if (isNumeric(outroSkipThresholdS)) {
									coreSettings[CORE_SETTINGS_MAP.currentOutroSkipThresholdS] = outroSkipThresholdS;
								} else {
									coreSettings[CORE_SETTINGS_MAP.currentOutroSkipThresholdS] =
										advancedSettings[ADVANCED_SETTINGS_MAP.defaultOutroSkipThresholdS];
								}

								this.settingsPane?.refresh();
								this.ignoreMissingFranchiseOnce = false;
							}

							break;
						}

						case TopScopeInterface.messages.FULLSCREEN_STATE: {
							if (IS_SAFARI) break;
							this.isInFullscreen = packet.data.isInFullscreen;
							this.updateFullscreenBtn({
								isInFullscreen: this.isInFullscreen,
							});
							break;
						}

						// Navigate from inside the frame: a self-initiated
						// same-origin navigation carries the user activation
						// over, so the next episode may start unmuted
						case TopScopeInterface.messages.NAVIGATE_TO: {
							if (packet.data?.url) location.href = packet.data.url;
							break;
						}

						default:
							break;
					}
				} catch (e) {
					console.error(e);
				}
			}).bind(this)();
			return {
				status: `${this.constructor.name} received a message`,
			};
		}

		async fetchAniSkipData() {
			// AniSkip is only for anime (aniworld.to), not for series (S.to domains)
			if (
				STO_DOMAINS.includes(this.topScopeDomainId === "sto" ? location.hostname : "") ||
				this.topScopeDomainId === "sto"
			) {
				globalAniSkipData = null;
				return null;
			}

			// Check if AniSkip is enabled
			if (!advancedSettings[ADVANCED_SETTINGS_MAP.useAniSkip]) {
				globalAniSkipData = null;
				return null;
			}

			try {
				// Use instance variables instead of extracting from page
				const title = this.animeTitle;
				const slug = this.animeSlug;
				const episode = this.episodeNumber;
				const season = this.seasonNumber;

				if (!title || !slug || !episode) {
					console.log("[AniSkip] Missing anime info:", { title, slug, episode, season });
					globalAniSkipData = null;
					return null;
				}

				console.log("[AniSkip] Fetching for:", { title, slug, episode, season });

				// Fetch MAL ID (include season for multi-season anime)
				const malId = await AniSkipModule.getMalId(title, slug, season);
				if (!malId) {
					console.log("[AniSkip] Could not find MAL ID");
					if (advancedSettings[ADVANCED_SETTINGS_MAP.showAniSkipNotifications]) {
						Notiflix.Notify.info(i18n.aniSkipFetchFailed, {
							timeout: 2000,
							position: "right-bottom",
						});
					}
					globalAniSkipData = null;
					return null;
				}

				console.log("[AniSkip] Found MAL ID:", malId);

				// Get episode length from the video player if available
				const player = document.querySelector("video");
				const episodeLength = player?.duration && isFinite(player.duration) ? player.duration : 0;
				console.log("[AniSkip] Episode length from player:", episodeLength);

				// Fetch skip times
				const skipTimes = await AniSkipModule.getSkipTimes(malId, episode, episodeLength);
				if (!skipTimes || !skipTimes.length) {
					console.log("[AniSkip] No skip times found");
					globalAniSkipData = null;

					// Show submit notification
					if (advancedSettings[ADVANCED_SETTINGS_MAP.showAniSkipNotifications]) {
						this.showSubmitNotification(malId, episode);
					}

					return null;
				}

				// Parse the times (pass episodeLength so it picks the closest matching result)
				console.log("[AniSkip] Raw results count:", skipTimes.length, "episodeLength:", episodeLength);
				const parsed = AniSkipModule.parseSkipTimes(skipTimes, episodeLength);
				if (parsed && parsed.intro) {
					console.log("[AniSkip] Successfully fetched skip times:", parsed);

					// Don't show notification - removed as requested

					globalAniSkipData = parsed;
					return parsed;
				} else {
					// Skip times found but no intro
					console.log("[AniSkip] No intro timestamp in response");

					// Show submit notification
					if (advancedSettings[ADVANCED_SETTINGS_MAP.showAniSkipNotifications]) {
						this.showSubmitNotification(malId, episode);
					}
				}

				globalAniSkipData = null;
				return null;
			} catch (e) {
				console.error("[AniSkip] Error fetching skip times:", e);
				globalAniSkipData = null;
				return null;
			}
		}

		showSubmitNotification(malId, episode) {
			console.log("[AniSkip] Showing submit button");

			// Helper to convert MM:SS or SS to seconds
			const timeToSeconds = (timeStr) => {
				timeStr = String(timeStr).trim();
				if (timeStr.includes(":")) {
					const parts = timeStr.split(":");
					if (parts.length === 2) {
						const minutes = parseInt(parts[0]) || 0;
						const seconds = parseInt(parts[1]) || 0;
						return minutes * 60 + seconds;
					}
				}
				return parseFloat(timeStr) || 0;
			};

			// Helper to format seconds as MM:SS
			const secondsToTime = (seconds) => {
				const mins = Math.floor(seconds / 60);
				const secs = Math.floor(seconds % 60);
				return `${mins}:${secs.toString().padStart(2, "0")}`;
			};

			// Get theme colors for the button
			const themeVars = getCurrentThemeVars();
			const btnBg1 = themeVars.submitBtnBg1 || themeVars.accentPrimary || "rgba(255,51,102,1)";
			const btnBg2 = themeVars.submitBtnBg2 || themeVars.accentSecondary || "rgba(124,58,237,1)";
			const btnText = themeVars.submitBtnText || "rgba(255,255,255,1)";

			// Create button element
			const button = document.createElement("a");
			button.id = "AniSkipSubmitButton";
			button.className = "notiflix-report-button";
			button.style.cssText = `
                position: absolute;
                bottom: 65px;
                right: 15px;
                font-weight: 600;
                font-size: 14px;
                background: linear-gradient(135deg, ${btnBg1} 0%, ${btnBg2} 100%);
                color: ${btnText};
                padding: 10px 20px;
                border-radius: 5px;
                cursor: pointer;
                z-index: 10000;
                text-decoration: none;
                display: inline-block;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                transition: all 0.3s ease, opacity 0.3s ease;
                border: 2px solid rgba(255,255,255,0.2);
                opacity: 1;
            `;
			button.textContent = "Submit Intro";

			// Auto-hide functionality
			let hideTimeout;
			let isMouseOverButton = false;

			const showButton = () => {
				button.style.opacity = "1";
				button.style.pointerEvents = "auto";
				clearTimeout(hideTimeout);
				hideTimeout = setTimeout(() => {
					if (!isMouseOverButton) {
						button.style.opacity = "0";
						button.style.pointerEvents = "none";
					}
				}, 3000); // Hide after 3 seconds of no mouse movement
			};

			const hideButton = () => {
				if (!isMouseOverButton) {
					button.style.opacity = "0";
					button.style.pointerEvents = "none";
				}
			};

			// Show button on mouse movement
			document.addEventListener("mousemove", showButton);

			// Keep button visible when hovering over it
			button.addEventListener("mouseenter", () => {
				isMouseOverButton = true;
				button.style.opacity = "1";
				button.style.pointerEvents = "auto";
				clearTimeout(hideTimeout);
			});

			button.addEventListener("mouseleave", () => {
				isMouseOverButton = false;
				hideTimeout = setTimeout(hideButton, 2000);
			});

			// Initial hide after 3 seconds
			hideTimeout = setTimeout(hideButton, 3000);

			// Hide the Skip Intro button when Submit button is visible
			const hideSkipIntroButton = () => {
				const skipIntroBtn = document.querySelector(".SkipIntroBtn");
				if (skipIntroBtn) {
					skipIntroBtn.style.display = "none";
					console.log("[AniSkip] Skip Intro button hidden");
				}
			};

			// Try to hide it immediately and keep checking
			hideSkipIntroButton();
			const checkInterval = setInterval(hideSkipIntroButton, 500);

			// Clean up when submit button is removed
			const originalRemove = button.remove.bind(button);
			button.remove = function () {
				clearInterval(checkInterval);
				const skipIntroBtn = document.querySelector(".SkipIntroBtn");
				if (skipIntroBtn) {
					skipIntroBtn.style.display = "";
				}
				originalRemove();
			};

			button.onmouseenter = function () {
				this.style.transform = "translateY(-2px) scale(1.02)";
				this.style.boxShadow = `0 6px 16px ${btnBg1}80`;
				this.style.background = `linear-gradient(135deg, ${btnBg2} 0%, ${btnBg1} 100%)`;
			};

			button.onmouseleave = function () {
				this.style.transform = "";
				this.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)";
				this.style.background = `linear-gradient(135deg, ${btnBg1} 0%, ${btnBg2} 100%)`;
			};

			button.onclick = async (e) => {
				e.preventDefault();
				console.log("[AniSkip] Submit button clicked");

				// Wait for player to be ready
				let player = this.player;
				if (!player) {
					console.log("[AniSkip] Player not in this.player, searching for it...");
					const videoEl = document.querySelector("video");
					if (videoEl) {
						player = videoEl;
						console.log("[AniSkip] Found video element");
					}
				}

				if (!player) {
					Notiflix.Notify.failure("Player not ready", {
						timeout: 3000,
						position: "right-bottom",
					});
					return;
				}

				const currentTime = Math.floor(player.currentTime || 0);

				// Helper to format seconds as MM:SS
				const formatTime = (seconds) => {
					const mins = Math.floor(seconds / 60);
					const secs = Math.floor(seconds % 60);
					return `${mins}:${secs.toString().padStart(2, "0")}`;
				};

				// Use saved values if available, otherwise default to 0:00
				const initialStartValue = submitDialogValues.start || "0:00";
				const initialEndValue = submitDialogValues.end || "0:00";

				console.log("[AniSkip] Creating Submit UI...");

				// Get current theme variables using the shared theme system
				const themeVars = getCurrentThemeVars();

				// Create overlay
				const overlay = document.createElement("div");
				overlay.id = "aw-submit-overlay";
				overlay.style.cssText = `
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.6);
                    backdrop-filter: blur(4px);
                    z-index: 99998;
                `;

				// Create dialog with popup-style design
				const dialog = document.createElement("div");
				dialog.id = "aw-submit-dialog";

				// Use theme variables directly
				const bgPrimary = themeVars.bgPrimary;
				const bgSecondary = themeVars.bgSecondary;
				const bgTertiary = themeVars.bgTertiary;
				const accentPrimary = themeVars.accentPrimary;
				const accentSecondary = themeVars.accentSecondary;
				const textPrimary = themeVars.textPrimary;
				const textSecondary = themeVars.textSecondary;
				const borderColor = themeVars.borderColor;
				const borderRadius = themeVars.borderRadius;
				const fontFamily = themeVars.fontFamily;

				dialog.style.cssText = `
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    width: 340px;
                    z-index: 99999;
                    background: ${bgPrimary};
                    border-radius: ${borderRadius};
                    overflow: hidden;
                    box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
                    font-family: ${fontFamily};
                    color: ${textPrimary};
                `;

				// Inject shimmer animation keyframes if not already present
				if (!document.getElementById("aw-submit-shimmer-style")) {
					const shimmerStyle = document.createElement("style");
					shimmerStyle.id = "aw-submit-shimmer-style";
					shimmerStyle.textContent = `
                        @keyframes aw-submit-shimmer {
                            0%, 100% { background-position: 0% 50%; }
                            50% { background-position: 100% 50%; }
                        }
                    `;
					document.head.appendChild(shimmerStyle);
				}

				dialog.innerHTML = `
                    <div style="
                        background: ${bgSecondary};
                        padding: 16px 18px;
                        border-bottom: 1px solid ${borderColor};
                        display: flex;
                        align-items: center;
                        gap: 14px;
                        position: relative;
                    ">
                        <div style="
                            position: absolute;
                            top: 0;
                            left: 0;
                            right: 0;
                            height: 2px;
                            background: linear-gradient(90deg, ${accentPrimary}, ${accentSecondary}, ${accentPrimary});
                            background-size: 200% 100%;
                            animation: aw-submit-shimmer 3s ease-in-out infinite;
                        "></div>
                        <div style="
                            width: 44px;
                            height: 44px;
                            background: linear-gradient(135deg, ${accentPrimary}, ${accentSecondary});
                            border-radius: 12px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-size: 20px;
                            color: white;
                        "><i class="fas fa-upload" style="font-size: 18px;"></i></div>
                        <div>
                            <h3 style="font-size: 16px; font-weight: 600; margin: 0 0 2px 0;">Submit Intro Times</h3>
                            <p style="font-size: 12px; color: ${textSecondary}; margin: 0;">Help the community!</p>
                        </div>
                        <button id="aw-submit-close" style="
                            margin-left: auto;
                            width: 28px;
                            height: 28px;
                            border: none;
                            background: ${bgTertiary};
                            border-radius: 6px;
                            color: ${textSecondary};
                            cursor: pointer;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-size: 14px;
                        ">×</button>
                    </div>

                    <div style="padding: 20px 18px;">
                        <div style="margin-bottom: 16px;">
                            <label style="display: block; font-size: 12px; color: ${textSecondary}; margin-bottom: 8px;">Intro Start (seconds)</label>
                            <div style="display: flex; gap: 8px;">
                                <input type="text" id="aw-submit-start" value="${initialStartValue}" style="
                                    flex: 1;
                                    padding: 12px 14px;
                                    background: ${bgSecondary};
                                    border: 1px solid ${borderColor};
                                    border-radius: 8px;
                                    color: ${textPrimary};
                                    font-family: inherit;
                                    font-size: 14px;
                                ">
                                <button id="aw-set-start" style="
                                    padding: 12px 16px;
                                    background: ${bgTertiary};
                                    border: 1px solid ${borderColor};
                                    border-radius: 8px;
                                    color: ${textSecondary};
                                    font-family: inherit;
                                    font-size: 12px;
                                    font-weight: 500;
                                    cursor: pointer;
                                ">Set</button>
                            </div>
                        </div>
                        <div style="margin-bottom: 20px;">
                            <label style="display: block; font-size: 12px; color: ${textSecondary}; margin-bottom: 8px;">Intro End (seconds)</label>
                            <div style="display: flex; gap: 8px;">
                                <input type="text" id="aw-submit-end" value="${initialEndValue}" style="
                                    flex: 1;
                                    padding: 12px 14px;
                                    background: ${bgSecondary};
                                    border: 1px solid ${borderColor};
                                    border-radius: 8px;
                                    color: ${textPrimary};
                                    font-family: inherit;
                                    font-size: 14px;
                                ">
                                <button id="aw-set-end" style="
                                    padding: 12px 16px;
                                    background: ${bgTertiary};
                                    border: 1px solid ${borderColor};
                                    border-radius: 8px;
                                    color: ${textSecondary};
                                    font-family: inherit;
                                    font-size: 12px;
                                    font-weight: 500;
                                    cursor: pointer;
                                ">Set</button>
                            </div>
                        </div>

                        <div style="display: flex; gap: 10px;">
                            <button id="aw-submit-cancel" style="
                                flex: 1;
                                padding: 12px;
                                background: ${bgTertiary};
                                border: none;
                                border-radius: 8px;
                                color: ${textSecondary};
                                font-family: inherit;
                                font-size: 13px;
                                font-weight: 500;
                                cursor: pointer;
                            ">Cancel</button>
                            <button id="aw-submit-confirm" style="
                                flex: 1;
                                padding: 12px;
                                background: linear-gradient(135deg, ${accentPrimary}, ${accentSecondary});
                                border: none;
                                border-radius: 8px;
                                color: white;
                                font-family: inherit;
                                font-size: 13px;
                                font-weight: 600;
                                cursor: pointer;
                            ">Submit</button>
                        </div>
                    </div>
                `;

				document.body.appendChild(overlay);
				document.body.appendChild(dialog);

				// Stop keyboard events from leaking
				dialog.querySelectorAll("input").forEach((input) => {
					["keydown", "keyup", "keypress"].forEach((event) => {
						input.addEventListener(event, (e) => e.stopPropagation());
					});
				});

				// Close handlers - save values for this session
				const closeDialog = () => {
					// Save current input values for next time (this session only)
					submitDialogValues.start = dialog.querySelector("#aw-submit-start").value;
					submitDialogValues.end = dialog.querySelector("#aw-submit-end").value;

					overlay.remove();
					dialog.remove();
				};

				// Set button handlers - set current play time
				dialog.querySelector("#aw-set-start").addEventListener("click", () => {
					const currentTime = Math.floor(player.currentTime);
					dialog.querySelector("#aw-submit-start").value = formatTime(currentTime);
				});

				dialog.querySelector("#aw-set-end").addEventListener("click", () => {
					const currentTime = Math.floor(player.currentTime);
					dialog.querySelector("#aw-submit-end").value = formatTime(currentTime);
				});

				overlay.addEventListener("click", closeDialog);
				dialog.querySelector("#aw-submit-close").addEventListener("click", closeDialog);
				dialog.querySelector("#aw-submit-cancel").addEventListener("click", closeDialog);

				// Submit handler
				dialog.querySelector("#aw-submit-confirm").addEventListener("click", async () => {
					const startInput = dialog.querySelector("#aw-submit-start").value;
					const endInput = dialog.querySelector("#aw-submit-end").value;

					const introStart = timeToSeconds(startInput);
					const introEnd = timeToSeconds(endInput);

					console.log("[AniSkip] Intro start:", startInput, "→", introStart, "seconds");
					console.log("[AniSkip] Intro end:", endInput, "→", introEnd, "seconds");

					// Validate
					if (!Number.isFinite(introStart) || !Number.isFinite(introEnd) || introEnd <= introStart) {
						Notiflix.Notify.failure("Invalid times. End must be greater than start.", {
							timeout: 3000,
							position: "right-bottom",
						});
						return;
					}

					const episodeLength = player.duration ? Math.floor(player.duration) : 0;

					console.log("[AniSkip] Submitting:", {
						malId,
						episode,
						episodeLength,
						introStart,
						introEnd,
					});

					// Close dialog
					closeDialog();

					// Submit
					Notiflix.Notify.info("Submitting to AniSkip...", {
						timeout: 3000,
						position: "right-bottom",
					});

					const result = await AniSkipModule.submitSkipTimes(malId, episode, episodeLength, introStart, introEnd);

					if (result.success) {
						Notiflix.Notify.success("Successfully submitted! Thank you for contributing!", {
							timeout: 5000,
							position: "right-bottom",
						});
						// Clear session dialog values after successful submission
						submitDialogValues = { start: null, end: null };
						button.remove();
					} else {
						Notiflix.Notify.failure("Failed to submit. Please try again." + (result.error ? `: ${result.error}` : ""), {
							timeout: 5000,
							position: "right-bottom",
						});
					}
				});
			};

			// Insert button into page
			const insertButton = () => {
				// Remove any existing button first
				const existing = document.getElementById("AniSkipSubmitButton");
				if (existing) existing.remove();

				document.body.appendChild(button);
				console.log("[AniSkip] Submit button inserted into DOM");
			};

			// Wait for page to be ready
			if (document.body) {
				insertButton();
			} else {
				document.addEventListener("DOMContentLoaded", insertButton);
			}

			// Adjust position on fullscreen
			document.addEventListener("fullscreenchange", () => {
				const isFullscreen = !!document.fullscreenElement;
				if (isFullscreen) {
					button.style.bottom = "88px";
				} else {
					button.style.bottom = "65px";
				}
			});
		}

		async init(player) {
			this.messenger.registerConnectionListener(this.handleTopScopeMessages.bind(this));
			this.messenger.sendMessage(IframeMessenger.messages.REQUEST_CURRENT_FRANCHISE_DATA);

			// AniSkip data will be fetched when CURRENT_FRANCHISE_DATA message arrives
			await this.preparePlayer(player);
			this.setupSleepTimerWatch();

			// Celebrate on the start of the fresh episode, not mid-switch
			setTimeout(() => this.maybeCelebrateMilestone(bingeStats.episodesFinished || 0), 4000);
		}

		maybeCelebrateMilestone(count) {
			if (!advancedSettings[ADVANCED_SETTINGS_MAP.showBingeMilestones]) return;
			if (![10, 50, 100, 500, 1000].includes(count)) return;

			const shown = bingeStats.milestonesShown || [];
			if (shown.includes(count)) return;
			bingeStats.milestonesShown = [...shown, count];

			const themeVars = getCurrentThemeVars();
			const cardEl = document.createElement("div");
			cardEl.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(0.9);opacity:0;z-index:999997;padding:26px 34px;text-align:center;background:${themeVars.bgPrimary};border:1px solid ${themeVars.borderLight};border-radius:${themeVars.borderRadius};box-shadow:0 25px 60px rgba(0,0,0,0.65);font-family:${themeVars.fontFamily};color:${themeVars.textPrimary};transition:opacity 0.4s ease, transform 0.4s ease;cursor:pointer;`;
			const hours = Math.floor((bingeStats.watchSecondsTotal || 0) / 3600);
			cardEl.innerHTML = `
                <div style="font-size:40px;">🎉</div>
                <div style="font-size:20px;font-weight:700;margin-top:8px;">${i18n.milestoneReached(count)}</div>
                <div style="font-size:12px;color:${themeVars.textSecondary};margin-top:6px;">${hours > 0 ? `≈ ${hours} h · ` : ""}${i18n.milestoneSub}</div>
            `;
			document.body.appendChild(cardEl);
			requestAnimationFrame(() => {
				cardEl.style.opacity = "1";
				cardEl.style.transform = "translate(-50%,-50%) scale(1)";
			});

			const dismiss = () => {
				cardEl.style.opacity = "0";
				cardEl.style.transform = "translate(-50%,-50%) scale(0.9)";
				setTimeout(() => cardEl.remove(), 450);
			};
			cardEl.addEventListener("click", dismiss);
			setTimeout(dismiss, 8000);
		}

		setupSleepTimerWatch() {
			setInterval(() => {
				const endsAt = coreSettings[CORE_SETTINGS_MAP.sleepTimerEndsAt];
				if (!endsAt || Date.now() < endsAt) return;

				coreSettings[CORE_SETTINGS_MAP.sleepTimerEndsAt] = 0;
				coreSettings[CORE_SETTINGS_MAP.isAutoplayEnabled] = false;
				this.messenger.sendMessage(IframeMessenger.messages.UPDATE_CORE_SETTINGS);

				const autoplayBtn = document.querySelector("button.Autoplay-button[aria-checked]");
				if (autoplayBtn) {
					autoplayBtn.setAttribute("aria-checked", "false");
					autoplayBtn.title = i18n.autoplayDisabled;
					const dot = autoplayBtn.querySelector(".Autoplay-button--toggle-dot");
					if (dot) {
						dot.style.backgroundColor = "#e1e1e1";
						dot.style.transform = "translateX(0px)";
					}
				}

				Notiflix.Notify.info(i18n.sleepTimerExpired, {
					timeout: 4000,
					position: "right-bottom",
				});
			}, 1000);
		}

		createAutoplayButton() {
			const button = document.createElement("button");
			const toggleContainer = document.createElement("div");
			const toggleDot = document.createElement("div");
			const isAutoplayEnabled = coreSettings[CORE_SETTINGS_MAP.isAutoplayEnabled];
			let lastClickTime = 0;
			button.addEventListener("click", () => {
				const now = Date.now();

				// Prevent double-clicks unwanted behavior
				if (now - lastClickTime < 300) return;

				lastClickTime = now;

				if (!GM_getValue("firstRunTextWasShown")) {
					GM_setValue("firstRunTextWasShown", true);

					this.messenger.sendMessage(IframeMessenger.messages.TOP_NOTIFLIX_REPORT_INFO, {
						args: [
							i18n.firstRunInfoTitle,
							i18n.firstRunInfoText(IS_MOBILE, hotkeysSettings[HOTKEYS_SETTINGS_MAP.largeSkip]),
							i18n.ok,
							{
								delayedButton: true,
								plainText: false,
								messageMaxLength: 800,
							},
						],
					});
				}

				const wasEnabled = coreSettings[CORE_SETTINGS_MAP.isAutoplayEnabled];
				coreSettings[CORE_SETTINGS_MAP.isAutoplayEnabled] = !wasEnabled;

				button.setAttribute("aria-checked", (!wasEnabled).toString());
				button.title = !isAutoplayEnabled ? i18n.autoplayDisabled : i18n.autoplayEnabled;
				toggleDot.style.backgroundColor = wasEnabled ? "#e1e1e1" : "#fff";
				toggleDot.style.transform = wasEnabled ? "translateX(0px)" : "translateX(12px)";
			});

			button.type = "button";
			button.title = !isAutoplayEnabled ? i18n.autoplayDisabled : i18n.autoplayEnabled;
			button.appendChild(toggleContainer);
			button.setAttribute("aria-checked", isAutoplayEnabled.toString());
			button.className = "Autoplay-button";

			toggleContainer.className = "Autoplay-button--toggle";
			toggleContainer.appendChild(toggleDot);

			toggleDot.className = "Autoplay-button--toggle-dot";
			toggleDot.style.backgroundColor = !isAutoplayEnabled ? "#e1e1e1" : "#fff";
			toggleDot.style.transform = !isAutoplayEnabled ? "translateX(0px)" : "translateX(12px)";
			GM_addStyle(
				[
					`
    .Autoplay-button {
      width: 36px;
      height: 36px;
      padding: 0;
      border-radius: 50%;
      border: none;
      background: none;
      cursor: pointer;
      top: 0;
      left: 0;
      transition: all 0.2s ease;
      user-select: none;
      -webkit-user-select: none;
    }

    .Autoplay-button[aria-checked="true"] .Autoplay-button--toggle-dot {
      transform: translateX(12px);
    }

    .Autoplay-button--toggle {
      width: 24px;
      height: 12px;
      margin-bottom: 3px;
      background-color: rgba(221, 221, 221, 0.5);
      border-radius: 6px;
      position: relative;
      display: inline-block;
    }

    .Autoplay-button--toggle-dot {
      width: 12px;
      height: 12px;
      background-color: #e1e1e1;
      border-radius: 50%;
      position: absolute;
      top: 0;
      left: 0;
      transition: all 0.2s ease;
    }
  `,
				][0],
			);
			return button;
		}

		createSettingsButton() {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "Autoplay-button AP-settings-button";
			button.title = i18n.preferences;
			button.innerHTML =
				'<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#e1e1e1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
			GM_addStyle(`
    .AP-settings-button svg {
      vertical-align: middle;
      transition: transform 0.25s ease;
    }
    .AP-settings-button:hover svg {
      transform: rotate(45deg);
    }
  `);
			return button;
		}

		createSleepTimerButton() {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "Autoplay-button AP-sleep-button";
			button.title = i18n.sleepTimer;
			button.innerHTML =
				'<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#e1e1e1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
			GM_addStyle(`
    .AP-sleep-button svg {
      vertical-align: middle;
    }
    .AP-sleep-button.active svg {
      stroke: #ffd866;
      filter: drop-shadow(0 0 4px rgba(255, 216, 102, 0.8));
    }
  `);
			const refreshState = () => {
				const endsAt = coreSettings[CORE_SETTINGS_MAP.sleepTimerEndsAt];
				const active = endsAt && endsAt > Date.now();
				button.classList.toggle("active", !!active);
				button.title = active
					? `${i18n.sleepTimer}: ${formatHMS(endsAt - Date.now())} ${i18n.sleepTimerRemaining}`
					: i18n.sleepTimer;
			};
			refreshState();
			setInterval(refreshState, 1000);
			return button;
		}

		createSleepTimerPane() {
			const themeVars = getCurrentThemeVars();
			const overlay = document.createElement("div");
			overlay.style.cssText =
				"display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:999998;";
			const pane = document.createElement("div");
			pane.style.cssText = `display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:300px;z-index:999999;background:${themeVars.bgPrimary};border:1px solid ${themeVars.borderColor};border-radius:${themeVars.borderRadius};box-shadow:0 25px 50px rgba(0,0,0,0.5);font-family:${themeVars.fontFamily};color:${themeVars.textPrimary};overflow:hidden;`;

			const digitInputHtml = (unit) => `
                <input class="ap-sleep-digit" data-unit="${unit}" value="00" maxlength="2" inputmode="numeric" style="
                    width:64px;padding:10px 0;text-align:center;font-size:28px;font-weight:600;
                    font-family:'JetBrains Mono', monospace;background:${themeVars.bgTertiary};
                    color:${themeVars.textPrimary};border:1px solid ${themeVars.borderColor};
                    border-radius:10px;outline:none;">`;

			pane.innerHTML = `
                <div style="padding:14px 16px;background:${themeVars.bgSecondary};border-bottom:1px solid ${themeVars.borderColor};display:flex;align-items:center;gap:10px;">
                    <span style="font-size:15px;font-weight:600;">${i18n.sleepTimer}</span>
                    <button class="ap-sleep-close" style="margin-left:auto;width:26px;height:26px;border:none;background:${themeVars.bgTertiary};border-radius:6px;color:${themeVars.textSecondary};cursor:pointer;font-size:14px;">×</button>
                </div>
                <div style="padding:18px 16px;">
                    <div style="display:flex;justify-content:center;align-items:center;gap:4px;">
                        ${digitInputHtml("h")}
                        <span style="font-size:24px;font-weight:600;">:</span>
                        ${digitInputHtml("m")}
                        <span style="font-size:24px;font-weight:600;">:</span>
                        ${digitInputHtml("s")}
                    </div>
                    <div style="display:flex;justify-content:center;gap:14px;margin-top:6px;">
                        <span style="width:64px;text-align:center;font-size:10px;color:${themeVars.textMuted};">${i18n.sleepTimerHours}</span>
                        <span style="width:64px;text-align:center;font-size:10px;color:${themeVars.textMuted};">${i18n.sleepTimerMinutes}</span>
                        <span style="width:64px;text-align:center;font-size:10px;color:${themeVars.textMuted};">${i18n.sleepTimerSeconds}</span>
                    </div>
                    <div style="display:flex;justify-content:center;gap:8px;margin-top:14px;">
                        <button class="ap-sleep-preset" data-min="30" style="padding:6px 10px;background:${themeVars.bgTertiary};border:1px solid ${themeVars.borderColor};border-radius:8px;color:${themeVars.textSecondary};font-family:inherit;font-size:11px;cursor:pointer;">30m</button>
                        <button class="ap-sleep-preset" data-min="60" style="padding:6px 10px;background:${themeVars.bgTertiary};border:1px solid ${themeVars.borderColor};border-radius:8px;color:${themeVars.textSecondary};font-family:inherit;font-size:11px;cursor:pointer;">60m</button>
                        <button class="ap-sleep-preset" data-min="90" style="padding:6px 10px;background:${themeVars.bgTertiary};border:1px solid ${themeVars.borderColor};border-radius:8px;color:${themeVars.textSecondary};font-family:inherit;font-size:11px;cursor:pointer;">90m</button>
                        <button class="ap-sleep-preset" data-min="120" style="padding:6px 10px;background:${themeVars.bgTertiary};border:1px solid ${themeVars.borderColor};border-radius:8px;color:${themeVars.textSecondary};font-family:inherit;font-size:11px;cursor:pointer;">120m</button>
                    </div>
                    <div class="ap-sleep-status" style="text-align:center;margin-top:12px;font-size:12px;color:${themeVars.accentPrimary};min-height:15px;"></div>
                    <div style="display:flex;gap:10px;margin-top:12px;">
                        <button class="ap-sleep-stop" style="flex:1;padding:10px;background:${themeVars.bgTertiary};border:none;border-radius:8px;color:${themeVars.textSecondary};font-family:inherit;font-size:13px;cursor:pointer;">${i18n.sleepTimerStop}</button>
                        <button class="ap-sleep-start" style="flex:1;padding:10px;background:linear-gradient(135deg, ${themeVars.accentPrimary}, ${themeVars.accentSecondary});border:none;border-radius:8px;color:${themeVars.logoText || "rgba(255,255,255,1)"};font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;">${i18n.sleepTimerStart}</button>
                    </div>
                    <div style="text-align:center;margin-top:10px;font-size:10px;color:${themeVars.textMuted};">${i18n.sleepTimerHint}</div>
                </div>
            `;

			document.body.appendChild(overlay);
			document.body.appendChild(pane);

			const digits = [...pane.querySelectorAll(".ap-sleep-digit")];
			const maxFor = (unit) => (unit === "h" ? 23 : 59);
			const readMs = () => {
				const [h, m, s] = digits.map((d) => parseInt(d.value, 10) || 0);
				return (h * 3600 + m * 60 + s) * 1000;
			};
			const writeDigits = (h, m, s) => {
				[h, m, s].forEach((v, idx) => (digits[idx].value = String(v).padStart(2, "0")));
			};

			digits.forEach((input) => {
				const max = maxFor(input.dataset.unit);
				input.addEventListener(
					"wheel",
					(ev) => {
						ev.preventDefault();
						ev.stopPropagation();
						const next = (parseInt(input.value, 10) || 0) + (ev.deltaY < 0 ? 1 : -1);
						input.value = String(Math.min(max, Math.max(0, next))).padStart(2, "0");
					},
					{ passive: false },
				);
				input.addEventListener("change", () => {
					const v = Math.min(max, Math.max(0, parseInt(input.value, 10) || 0));
					input.value = String(v).padStart(2, "0");
				});
				["keydown", "keyup", "keypress"].forEach((evName) => {
					input.addEventListener(evName, (e) => e.stopPropagation());
				});
			});

			pane.querySelectorAll(".ap-sleep-preset").forEach((btn) => {
				btn.addEventListener("click", () => {
					const min = parseInt(btn.dataset.min, 10);
					writeDigits(Math.floor(min / 60), min % 60, 0);
				});
			});

			const statusEl = pane.querySelector(".ap-sleep-status");
			const refreshStatus = () => {
				const endsAt = coreSettings[CORE_SETTINGS_MAP.sleepTimerEndsAt];
				statusEl.textContent =
					endsAt && endsAt > Date.now() ? `${formatHMS(endsAt - Date.now())} ${i18n.sleepTimerRemaining}` : "";
			};
			refreshStatus();
			setInterval(refreshStatus, 1000);

			const hide = () => {
				overlay.style.display = "none";
				pane.style.display = "none";
			};
			overlay.addEventListener("click", hide);
			pane.querySelector(".ap-sleep-close").addEventListener("click", hide);

			pane.querySelector(".ap-sleep-start").addEventListener("click", () => {
				const ms = readMs();
				if (ms < 1000) return;
				coreSettings[CORE_SETTINGS_MAP.sleepTimerEndsAt] = Date.now() + ms;
				this.messenger.sendMessage(IframeMessenger.messages.UPDATE_CORE_SETTINGS);
				Notiflix.Notify.success(`${i18n.sleepTimerStarted} ${formatHMS(ms)}`, {
					timeout: 2500,
					position: "right-bottom",
				});
				hide();
			});
			pane.querySelector(".ap-sleep-stop").addEventListener("click", () => {
				coreSettings[CORE_SETTINGS_MAP.sleepTimerEndsAt] = 0;
				this.messenger.sendMessage(IframeMessenger.messages.UPDATE_CORE_SETTINGS);
				Notiflix.Notify.info(i18n.sleepTimerStopped, {
					timeout: 2000,
					position: "right-bottom",
				});
				refreshStatus();
			});

			return {
				toggle: () => {
					const visible = pane.style.display !== "none";
					overlay.style.display = visible ? "none" : "block";
					pane.style.display = visible ? "none" : "block";
					if (!visible) refreshStatus();
				},
			};
		}

		createSettingsPane() {
			// ============================================
			// CUSTOM SETTINGS PANEL (Popup-style UI)
			// ============================================

			// Inject Google Fonts
			if (!document.querySelector('link[href*="Space+Grotesk"]')) {
				const fontLink = document.createElement("link");
				fontLink.rel = "stylesheet";
				fontLink.href =
					"https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap";
				document.head.appendChild(fontLink);
			}

			// Inject Font Awesome
			if (!document.querySelector('link[href*="font-awesome"]')) {
				const faLink = document.createElement("link");
				faLink.rel = "stylesheet";
				faLink.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css";
				document.head.appendChild(faLink);
			}

			// Get saved theme or default to 'classic'
			const savedTheme = GM_getValue("uiTheme") || "gsv2";

			// ============================================
			// THEME CSS GENERATION (uses shared theme system)
			// ============================================

			// Generate CSS for a custom theme
			const generateThemeCSS = (themeId, vars, extras = {}) => {
				const shimmer1 = vars.shimmerColor1 || vars.accentPrimary;
				const shimmer2 = vars.shimmerColor2 || vars.accentSecondary;

				// Header color defaults (fallback to appropriate base colors)
				const headerBg = vars.headerBg || vars.bgSecondary;
				const headerText = vars.headerText || vars.textPrimary;
				const headerAccent1 = vars.headerAccent1 || vars.accentPrimary;
				const headerAccent2 = vars.headerAccent2 || "#44adf3";
				const headerTag = vars.headerTag || vars.textMuted;
				const logoBg = vars.logoBg || vars.accentPrimary;
				const logoText = vars.logoText || "rgba(255,255,255,1)";

				let css = `
                    .aw-settings-panel[data-theme="${themeId}"] {
                        --bg-primary: ${vars.bgPrimary};
                        --bg-secondary: ${vars.bgSecondary};
                        --bg-tertiary: ${vars.bgTertiary};
                        --bg-hover: ${vars.bgHover};
                        --accent-primary: ${vars.accentPrimary};
                        --accent-secondary: ${vars.accentSecondary};
                        --accent-glow: ${vars.accentGlow};
                        --accent-green: ${vars.accentGreen};
                        --text-primary: ${vars.textPrimary};
                        --text-secondary: ${vars.textSecondary};
                        --text-muted: ${vars.textMuted};
                        --border-color: ${vars.borderColor};
                        --border-light: ${vars.borderLight};
                        --shimmer-color-1: ${shimmer1};
                        --shimmer-color-2: ${shimmer2};
                        --header-bg: ${headerBg};
                        --header-text: ${headerText};
                        --header-accent-1: ${headerAccent1};
                        --header-accent-2: ${headerAccent2};
                        --header-tag: ${headerTag};
                        --logo-bg: ${logoBg};
                        --logo-text: ${logoText};
                        font-family: ${vars.fontFamily};
                        border-radius: ${vars.borderRadius};
                    }
                    .aw-settings-panel[data-theme="${themeId}"] .aw-settings-header {
                        background: ${headerBg};
                    }
                    .aw-settings-panel[data-theme="${themeId}"] .aw-header-text h1 {
                        color: ${headerText};
                    }
                    .aw-settings-panel[data-theme="${themeId}"] .aw-header-text h1 .aw-brand-world {
                        color: ${headerAccent1};
                    }
                    .aw-settings-panel[data-theme="${themeId}"] .aw-header-text h1 .aw-brand-sto {
                        color: ${headerAccent2};
                    }
                    .aw-settings-panel[data-theme="${themeId}"] .aw-header-text .aw-tagline {
                        color: ${headerTag};
                    }
                    .aw-settings-panel[data-theme="${themeId}"] .aw-logo-icon {
                        background: linear-gradient(135deg, ${logoBg}, ${vars.accentSecondary});
                        color: ${logoText};
                        box-shadow: 0 4px 20px ${vars.accentGlow};
                    }
                    .aw-settings-panel[data-theme="${themeId}"] .aw-settings-header::before {
                        content: '';
                        position: absolute;
                        top: 0;
                        left: 0;
                        right: 0;
                        height: 2px;
                        background: linear-gradient(90deg, ${shimmer1}, ${shimmer2}, ${shimmer1});
                        background-size: 200% 100%;
                        animation: aw-shimmer 3s ease-in-out infinite;
                    }
                `;

				// Add background image if present
				if (extras.backgroundImage && extras.backgroundImage.url) {
					css += `
                    .aw-settings-panel[data-theme="${themeId}"]::after {
                        content: '';
                        position: absolute;
                        top: 0;
                        left: 0;
                        right: 0;
                        bottom: 0;
                        background-image: url(${extras.backgroundImage.url});
                        background-size: ${extras.backgroundImage.size || "cover"};
                        background-position: center;
                        background-repeat: no-repeat;
                        opacity: ${(extras.backgroundImage.opacity || 15) / 100};
                        pointer-events: none;
                        z-index: 0;
                        border-radius: inherit;
                    }
                    .aw-settings-panel[data-theme="${themeId}"] > * {
                        position: relative;
                        z-index: 1;
                    }
                    `;
				}

				return css;
			};

			// Apply all custom theme CSS
			const applyCustomThemeCSS = () => {
				const customThemes = getCustomThemes();
				let css = "";
				for (const [id, theme] of Object.entries(customThemes)) {
					css += generateThemeCSS(id, theme.vars, {
						backgroundImage: theme.backgroundImage,
						settingsLayout: theme.settingsLayout,
					});
				}
				// Also generate CSS for new built-in themes
				for (const [id, theme] of Object.entries(BUILT_IN_THEMES)) {
					if (id !== "classic" && id !== "aniworld") {
						css += generateThemeCSS(id, theme.vars, {});
					}
				}
				let styleEl = document.getElementById("aw-custom-themes-css");
				if (!styleEl) {
					styleEl = document.createElement("style");
					styleEl.id = "aw-custom-themes-css";
					document.head.appendChild(styleEl);
				}
				styleEl.textContent = css;
			};

			// Helper to calculate accent glow from color (handles both hex and rgba)
			const hexToRgba = (color, alpha) => {
				if (!color) return `rgba(255,51,102,${alpha})`;

				// If already rgba, extract RGB and apply new alpha
				const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
				if (rgbaMatch) {
					return `rgba(${rgbaMatch[1]},${rgbaMatch[2]},${rgbaMatch[3]},${alpha})`;
				}

				// Handle hex
				if (color.startsWith("#")) {
					const r = parseInt(color.slice(1, 3), 16);
					const g = parseInt(color.slice(3, 5), 16);
					const b = parseInt(color.slice(5, 7), 16);
					return `rgba(${r},${g},${b},${alpha})`;
				}

				return `rgba(255,51,102,${alpha})`;
			};

			// Theme Import Modal (for importing themes created with the standalone editor)
			const openThemeImport = () => {
				const overlay = document.createElement("div");
				overlay.id = "aw-theme-import-overlay";
				overlay.style.cssText = `
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.7);
                    backdrop-filter: blur(4px);
                    z-index: 9999999;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                `;

				const modal = document.createElement("div");
				modal.style.cssText = `
                    background: #0a0a0f;
                    border-radius: 16px;
                    width: 450px;
                    max-width: 95vw;
                    overflow: hidden;
                    box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
                    font-family: 'Space Grotesk', -apple-system, sans-serif;
                    color: #f0f0f5;
                `;

				modal.innerHTML = `
                    <div style="
                        background: #12121a;
                        padding: 16px 20px;
                        border-bottom: 1px solid rgba(255,255,255,0.06);
                        display: flex;
                        align-items: center;
                        gap: 12px;
                    ">
                        <div style="
                            width: 32px; height: 32px;
                            background: linear-gradient(135deg, #ff3366, #7c3aed);
                            border-radius: 8px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-size: 14px;
                        "><i class="fas fa-file-import"></i></div>
                        <div>
                            <div style="font-weight: 600; font-size: 14px;">Import Theme</div>
                            <div style="font-size: 11px; color: #a0a0b8;">Paste theme JSON from the Theme Editor</div>
                        </div>
                        <button id="aw-import-close" style="
                            margin-left: auto;
                            width: 28px; height: 28px;
                            border: none;
                            background: #1a1a25;
                            border-radius: 6px;
                            color: #a0a0b8;
                            cursor: pointer;
                            font-size: 16px;
                        ">×</button>
                    </div>
                    <div style="padding: 20px;">
                        <p style="font-size: 12px; color: #888; margin-bottom: 12px;">
                            Use the standalone <strong>Theme Editor</strong> (HTML file) to create themes with live preview,
                            custom shimmer colors, background images, and settings layout, then export and paste the JSON here.
                        </p>
                        <textarea id="aw-import-data" placeholder='{"name": "My Theme", "vars": {...}, "animations": {...}, "backgroundImage": {...}, "settingsLayout": {...}}' style="
                            width: 100%;
                            height: 180px;
                            padding: 12px;
                            background: #1a1a25;
                            border: 1px solid rgba(255,255,255,0.08);
                            border-radius: 8px;
                            color: #f0f0f5;
                            font-family: monospace;
                            font-size: 11px;
                            resize: vertical;
                        "></textarea>
                    </div>
                    <div style="
                        padding: 12px 20px;
                        border-top: 1px solid rgba(255,255,255,0.06);
                        display: flex;
                        gap: 10px;
                        justify-content: flex-end;
                        background: #12121a;
                    ">
                        <button id="aw-import-cancel" style="
                            padding: 8px 16px;
                            background: #1a1a25;
                            border: 1px solid rgba(255,255,255,0.1);
                            border-radius: 8px;
                            color: #a0a0b8;
                            cursor: pointer;
                            font-size: 12px;
                            font-family: inherit;
                        ">Cancel</button>
                        <button id="aw-import-save" style="
                            padding: 8px 20px;
                            background: linear-gradient(135deg, #ff3366, #7c3aed);
                            border: none;
                            border-radius: 8px;
                            color: white;
                            cursor: pointer;
                            font-size: 12px;
                            font-weight: 600;
                            font-family: inherit;
                        ">Import Theme</button>
                    </div>
                `;

				overlay.appendChild(modal);
				document.body.appendChild(overlay);

				const closeModal = () => overlay.remove();
				modal.querySelector("#aw-import-close").addEventListener("click", closeModal);
				modal.querySelector("#aw-import-cancel").addEventListener("click", closeModal);
				overlay.addEventListener("click", (e) => {
					if (e.target === overlay) closeModal();
				});

				// Import handler
				modal.querySelector("#aw-import-save").addEventListener("click", () => {
					const input = modal.querySelector("#aw-import-data").value.trim();
					if (!input) {
						alert("Please paste theme JSON data");
						return;
					}

					try {
						const data = JSON.parse(input);
						if (!data.vars) throw new Error("Invalid format: missing vars");

						const name = data.name || "Imported Theme";
						const vars = { ...data.vars };

						// Auto-generate glow if not present
						if (!vars.accentGlow && vars.accentPrimary) {
							vars.accentGlow = hexToRgba(vars.accentPrimary, 0.35);
						}

						// Ensure shimmer colors default to accent colors if not present
						if (!vars.shimmerColor1) vars.shimmerColor1 = vars.accentPrimary;
						if (!vars.shimmerColor2) vars.shimmerColor2 = vars.accentSecondary;

						// Ensure header colors have defaults if not present
						if (!vars.headerBg) vars.headerBg = vars.bgSecondary;
						if (!vars.headerText) vars.headerText = vars.textPrimary;
						if (!vars.headerAccent1) vars.headerAccent1 = vars.accentPrimary;
						if (!vars.headerAccent2) vars.headerAccent2 = "rgba(68,173,243,1)";
						if (!vars.headerTag) vars.headerTag = vars.textMuted;
						if (!vars.logoBg) vars.logoBg = vars.accentPrimary;
						if (!vars.logoText) vars.logoText = "rgba(255,255,255,1)";

						const themeId = "custom_" + Date.now();
						const customThemes = getCustomThemes();
						customThemes[themeId] = {
							name,
							builtIn: false,
							vars,
							animations: data.animations || { shimmer: true, pulse: true, glow: true, sections: true },
							settingsLayout: data.settingsLayout || null,
							backgroundImage: data.backgroundImage || null,
						};
						saveCustomThemes(customThemes);

						applyCustomThemeCSS();

						// Update theme dropdown if it exists
						const themeSelect = document.querySelector("#uiTheme");
						if (themeSelect) {
							themeSelect.innerHTML = "";
							const allThemesNew = getAllThemes();
							Object.entries(allThemesNew).forEach(([id, t]) => {
								const opt = document.createElement("option");
								opt.value = id;
								opt.textContent = t.name + (t.builtIn ? "" : " ⭐");
								if (id === themeId) opt.selected = true;
								themeSelect.appendChild(opt);
							});
							GM_setValue("uiTheme", themeId);
							document.querySelector(".aw-settings-panel")?.setAttribute("data-theme", themeId);
						}

						closeModal();
						Notiflix?.Notify?.success?.('Theme "' + name + '" imported!') || alert('Theme "' + name + '" imported!');

						// Trigger layout update via custom event
						window.dispatchEvent(new CustomEvent("aw-theme-imported", { detail: { themeId } }));
					} catch (e) {
						alert("Invalid theme data: " + e.message);
					}
				});
			};

			// Apply custom theme CSS immediately
			applyCustomThemeCSS();

			// Inject CSS styles
			GM_addStyle(`
                /* ============================================
                   SETTINGS PANEL BASE STYLES
                   ============================================ */
                .aw-settings-overlay {
                    display: none;
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.6);
                    z-index: 999998;
                    backdrop-filter: blur(4px);
                }

                .aw-settings-overlay.active {
                    display: block;
                }

                .aw-settings-panel {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    width: 420px;
                    max-width: 95vw;
                    max-height: 90vh;
                    z-index: 999999;
                    display: none;
                    flex-direction: column;
                    box-sizing: border-box;
                    font-size: 13px;
                    line-height: 1.3;
                }

                .aw-settings-panel.active {
                    display: flex;
                }

                .aw-settings-panel * {
                    box-sizing: border-box;
                    margin: 0;
                    padding: 0;
                }

                /* ============================================
                   CLASSIC THEME (default)
                   ============================================ */
                .aw-settings-panel, .aw-settings-panel[data-theme="classic"] {
                    --bg-primary: #0a0a0f;
                    --bg-secondary: #12121a;
                    --bg-tertiary: #1a1a25;
                    --bg-hover: rgba(255, 255, 255, 0.02);
                    --accent-primary: #ff3366;
                    --accent-secondary: #7c3aed;
                    --accent-glow: rgba(255, 51, 102, 0.4);
                    --accent-green: #22c55e;
                    --text-primary: #f0f0f5;
                    --text-secondary: #a0a0b8;
                    --text-muted: #9090a8;
                    --border-color: rgba(255, 255, 255, 0.06);
                    --border-light: rgba(255, 255, 255, 0.1);
                    --shimmer-color-1: #ff3366;
                    --shimmer-color-2: #7c3aed;
                    --header-bg: #12121a;
                    --header-text: #f0f0f5;
                    --header-accent-1: #ff3366;
                    --header-accent-2: #44adf3;
                    --header-tag: #9090a8;
                    --logo-bg: #ff3366;
                    --logo-text: white;

                    font-family: 'Space Grotesk', -apple-system, sans-serif;
                    background: var(--bg-primary);
                    color: var(--text-primary);
                    border-radius: 16px;
                    overflow: hidden;
                    box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
                }

                .aw-settings-panel[data-theme="classic"]::before {
                    content: '';
                    position: absolute;
                    top: -50%;
                    right: -50%;
                    width: 100%;
                    height: 100%;
                    background: radial-gradient(circle, rgba(255, 51, 102, 0.08) 0%, transparent 60%);
                    pointer-events: none;
                    z-index: 0;
                }

                .aw-settings-panel[data-theme="classic"]::after {
                    content: '';
                    position: absolute;
                    bottom: -30%;
                    left: -30%;
                    width: 80%;
                    height: 80%;
                    background: radial-gradient(circle, rgba(124, 58, 237, 0.06) 0%, transparent 50%);
                    pointer-events: none;
                    z-index: 0;
                }

                /* ============================================
                   ANIWORLD THEME
                   ============================================ */
                .aw-settings-panel[data-theme="aniworld"] {
                    --bg-primary: #121c22;
                    --bg-secondary: #1a2a33;
                    --bg-tertiary: #243743;
                    --bg-hover: #2d444f;
                    --accent-primary: #637cf9;
                    --accent-secondary: #637cf9;
                    --accent-glow: rgba(99, 124, 249, 0.3);
                    --accent-green: #63d02b;
                    --text-primary: #e8e8e8;
                    --text-secondary: #c0d4de;
                    --text-muted: #a8c0cc;
                    --border-color: #2d444f;
                    --border-light: #3a5565;
                    --shimmer-color-1: #637cf9;
                    --shimmer-color-2: #637cf9;
                    --header-bg: #1a2a33;
                    --header-text: #e8e8e8;
                    --header-accent-1: #637cf9;
                    --header-accent-2: #44adf3;
                    --header-tag: #a8c0cc;
                    --logo-bg: #637cf9;
                    --logo-text: white;

                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
                    background: var(--bg-primary);
                    color: var(--text-primary);
                    border-radius: 12px;
                    overflow: hidden;
                    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
                }

                .aw-settings-panel[data-theme="aniworld"]::before,
                .aw-settings-panel[data-theme="aniworld"]::after {
                    display: none;
                }

                /* ============================================
                   HEADER
                   ============================================ */
                .aw-settings-header {
                    position: relative;
                    background: var(--header-bg, var(--bg-secondary));
                    padding: 10px 12px;
                    border-bottom: 1px solid var(--border-color);
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    z-index: 1;
                }

                .aw-settings-panel[data-theme="classic"] .aw-settings-header::before {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    height: 2px;
                    background: linear-gradient(90deg, var(--shimmer-color-1, var(--accent-primary)), var(--shimmer-color-2, var(--accent-secondary)), var(--shimmer-color-1, var(--accent-primary)));
                    background-size: 200% 100%;
                    animation: aw-shimmer 3s ease-in-out infinite;
                }

                @keyframes aw-shimmer {
                    0%, 100% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                }

                .aw-logo-container {
                    position: relative;
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .aw-settings-panel[data-theme="classic"] .aw-logo-ring {
                    position: absolute;
                    inset: 0;
                    border-radius: 12px;
                    background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
                    opacity: 0.2;
                    animation: aw-pulse-ring 2s ease-in-out infinite;
                }

                .aw-settings-panel[data-theme="aniworld"] .aw-logo-ring {
                    display: none;
                }

                @keyframes aw-pulse-ring {
                    0%, 100% { transform: scale(1); opacity: 0.2; }
                    50% { transform: scale(1.05); opacity: 0.3; }
                }

                .aw-logo-icon {
                    position: relative;
                    width: 32px;
                    height: 32px;
                    background: linear-gradient(135deg, var(--logo-bg, var(--accent-primary)), var(--accent-secondary));
                    border-radius: 7px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 12px;
                    font-weight: 700;
                    color: var(--logo-text, white);
                    box-shadow: 0 2px 8px var(--accent-glow);
                }

                .aw-settings-panel[data-theme="aniworld"] .aw-logo-icon {
                    background: linear-gradient(135deg, #637cf9, #8b5cf6);
                    border-radius: 7px;
                    box-shadow: 0 2px 10px rgba(99, 124, 249, 0.4);
                }

                .aw-settings-panel[data-theme="classic"] .aw-logo-icon {
                    background: linear-gradient(135deg, #ff3366, #7c3aed);
                    border-radius: 8px;
                    box-shadow: 0 4px 20px var(--accent-glow);
                }

                .aw-header-text h1 {
                    font-size: 14px;
                    font-weight: 600;
                    margin-bottom: 0px;
                    color: var(--header-text, var(--text-primary));
                }

                .aw-header-text h1 .aw-brand-world {
                    color: var(--header-accent-1, #ff3366);
                }

                .aw-header-text h1 .aw-brand-sto {
                    color: var(--header-accent-2, #44adf3);
                }

                .aw-header-text h1 .aw-brand-ap {
                    color: var(--text-secondary);
                    font-weight: 400;
                    font-size: 12px;
                    margin-left: 2px;
                }

                .aw-header-text .aw-tagline {
                    font-size: 10px;
                    color: var(--header-tag, var(--text-secondary));
                }

                .aw-settings-panel[data-theme="classic"] .aw-header-text .aw-tagline {
                    font-size: 9px;
                    letter-spacing: 0.5px;
                    text-transform: uppercase;
                    color: var(--header-tag, var(--text-muted));
                }

                a.aw-tagline {
                    text-decoration: none;
                    cursor: pointer;
                }

                a.aw-tagline:hover {
                    color: var(--accent-primary) !important;
                }

                .aw-close-btn {
                    margin-left: auto;
                    width: 26px;
                    height: 26px;
                    border: none;
                    background: var(--bg-tertiary);
                    border-radius: 6px;
                    color: var(--text-secondary);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s ease;
                    font-size: 14px;
                }

                .aw-close-btn:hover {
                    background: var(--bg-hover);
                    color: var(--text-primary);
                }

                /* ============================================
                   TABS
                   ============================================ */
                .aw-tabs {
                    display: flex;
                    background: var(--bg-secondary);
                    border-bottom: 1px solid var(--border-color);
                    position: relative;
                    z-index: 1;
                }

                .aw-tab {
                    flex: 1;
                    padding: 8px 12px;
                    background: none;
                    border: none;
                    color: var(--text-secondary);
                    font-family: inherit;
                    font-size: 11px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    position: relative;
                }

                .aw-tab:hover {
                    color: var(--text-primary);
                    background: var(--bg-hover);
                }

                .aw-tab.active {
                    color: var(--accent-primary);
                }

                .aw-tab.active::after {
                    content: '';
                    position: absolute;
                    bottom: 0;
                    left: 20%;
                    right: 20%;
                    height: 2px;
                    background: var(--accent-primary);
                    border-radius: 2px 2px 0 0;
                }

                /* ============================================
                   CONTENT
                   ============================================ */
                .aw-settings-content {
                    padding: 8px 10px;
                    max-height: 520px;
                    overflow-y: auto;
                    position: relative;
                    z-index: 1;
                }

                .aw-settings-panel[data-theme="classic"] .aw-settings-content {
                    padding: 10px 12px;
                }

                .aw-tab-content {
                    display: none;
                }

                .aw-tab-content.active {
                    display: block;
                }

                /* ============================================
                   SECTIONS
                   ============================================ */
                .aw-section {
                    margin-bottom: 8px;
                }

                .aw-settings-panel[data-theme="classic"] .aw-section {
                    margin-bottom: 10px;
                }

                .aw-section:last-child {
                    margin-bottom: 0;
                }

                .aw-section-header {
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    margin-bottom: 4px;
                    padding-left: 2px;
                }

                .aw-settings-panel[data-theme="classic"] .aw-section-header {
                    gap: 6px;
                    margin-bottom: 6px;
                }

                .aw-section-icon {
                    display: flex;
                    width: 20px;
                    height: 20px;
                    border-radius: 5px;
                    background: var(--bg-tertiary);
                    border: 1px solid var(--border-color);
                    align-items: center;
                    justify-content: center;
                }

                .aw-section-icon i {
                    font-size: 10px;
                    color: var(--accent-primary);
                }

                .aw-settings-panel[data-theme="classic"] .aw-section-icon i {
                    font-size: 10px;
                    color: var(--accent-primary);
                }

                .aw-settings-panel[data-theme="aniworld"] .aw-section-icon {
                    display: flex;
                    width: 20px;
                    height: 20px;
                    border-radius: 5px;
                    background: var(--bg-tertiary);
                    border: 1px solid var(--border-color);
                    align-items: center;
                    justify-content: center;
                }

                .aw-settings-panel[data-theme="aniworld"] .aw-section-icon i {
                    font-size: 10px;
                    color: var(--accent-primary);
                }

                .aw-section-header > i {
                    color: var(--accent-primary);
                    font-size: 13px;
                    width: 16px;
                    text-align: center;
                    display: none;
                }

                .aw-settings-panel[data-theme="classic"] .aw-section-header > i,
                .aw-settings-panel[data-theme="aniworld"] .aw-section-header > i {
                    display: none;
                }

                .aw-section-title {
                    font-size: 10px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    color: var(--text-secondary);
                }

                .aw-settings-panel[data-theme="classic"] .aw-section-title {
                    font-size: 10px;
                    letter-spacing: 1px;
                }

                /* ============================================
                   SETTINGS CARD
                   ============================================ */
                .aw-settings-card {
                    background: var(--bg-secondary);
                    border-radius: 8px;
                    border: 1px solid var(--border-color);
                    overflow: hidden;
                }

                .aw-settings-panel[data-theme="classic"] .aw-settings-card {
                    border-radius: 14px;
                    transition: border-color 0.2s ease;
                }

                .aw-settings-panel[data-theme="classic"] .aw-settings-card:hover {
                    border-color: var(--border-light);
                }

                .aw-setting-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 6px 10px;
                    border-bottom: 1px solid var(--border-color);
                    transition: background 0.15s ease;
                }

                .aw-settings-panel[data-theme="classic"] .aw-setting-row {
                    padding: 7px 12px;
                }

                .aw-setting-row:last-child {
                    border-bottom: none;
                }

                .aw-setting-row:hover {
                    background: var(--bg-hover);
                }

                .aw-setting-info {
                    flex: 1;
                    min-width: 0;
                    padding-right: 8px;
                }

                .aw-setting-label {
                    font-size: 11px;
                    font-weight: 500;
                    color: var(--text-primary);
                    margin-bottom: 0px;
                }

                .aw-settings-panel[data-theme="classic"] .aw-setting-label {
                    margin-bottom: 0px;
                }

                .aw-setting-description {
                    font-size: 9px;
                    color: var(--text-muted);
                    line-height: 1.2;
                }

                .aw-settings-panel[data-theme="classic"] .aw-setting-description {
                    line-height: 1.2;
                }

                /* ============================================
                   TOGGLE SWITCH
                   ============================================ */
                .aw-toggle {
                    position: relative;
                    width: 32px;
                    height: 18px;
                    flex-shrink: 0;
                }

                .aw-settings-panel[data-theme="classic"] .aw-toggle {
                    width: 36px;
                    height: 20px;
                }

                .aw-toggle input {
                    opacity: 0;
                    width: 0;
                    height: 0;
                }

                .aw-toggle-track {
                    position: absolute;
                    cursor: pointer;
                    inset: 0;
                    background: var(--bg-tertiary);
                    border: 1px solid var(--border-light);
                    transition: all 0.25s ease;
                    border-radius: 24px;
                }

                .aw-settings-panel[data-theme="classic"] .aw-toggle-track {
                    border-radius: 26px;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }

                .aw-toggle-track::before {
                    position: absolute;
                    content: "";
                    height: 14px;
                    width: 14px;
                    left: 2px;
                    bottom: 1px;
                    background: var(--text-secondary);
                    transition: all 0.25s ease;
                    border-radius: 50%;
                }

                .aw-settings-panel[data-theme="classic"] .aw-toggle-track::before {
                    height: 16px;
                    width: 16px;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }

                .aw-toggle input:checked + .aw-toggle-track {
                    background: var(--accent-primary);
                    border-color: var(--accent-primary);
                }

                .aw-settings-panel[data-theme="classic"] .aw-toggle input:checked + .aw-toggle-track {
                    background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
                    border-color: transparent;
                    box-shadow: 0 2px 12px var(--accent-glow);
                }

                .aw-toggle input:checked + .aw-toggle-track::before {
                    transform: translateX(14px);
                    background: white;
                }

                .aw-settings-panel[data-theme="classic"] .aw-toggle input:checked + .aw-toggle-track::before {
                    transform: translateX(16px);
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
                }

                /* ============================================
                   NUMBER INPUT
                   ============================================ */
                .aw-number-input {
                    width: 55px;
                    padding: 4px 6px;
                    background: var(--bg-tertiary);
                    border: 1px solid var(--border-color);
                    border-radius: 4px;
                    color: var(--text-primary);
                    font-family: 'JetBrains Mono', 'SF Mono', 'Consolas', monospace;
                    font-size: 11px;
                    text-align: center;
                    transition: all 0.2s ease;
                    -moz-appearance: textfield;
                }

                /* Hide spinners by default */
                .aw-number-input::-webkit-outer-spin-button,
                .aw-number-input::-webkit-inner-spin-button {
                    -webkit-appearance: none;
                    margin: 0;
                    opacity: 0;
                    transition: opacity 0.2s ease;
                }

                /* Show spinners on focus */
                .aw-number-input:focus::-webkit-outer-spin-button,
                .aw-number-input:focus::-webkit-inner-spin-button {
                    -webkit-appearance: inner-spin-button;
                    opacity: 1;
                }

                .aw-number-input:focus {
                    -moz-appearance: auto;
                }

                .aw-settings-panel[data-theme="classic"] .aw-number-input {
                    width: 58px;
                    padding: 5px 8px;
                    border-radius: 6px;
                    font-weight: 500;
                }

                .aw-number-input:hover {
                    border-color: var(--border-light);
                }

                .aw-number-input:focus {
                    outline: none;
                    border-color: var(--accent-primary);
                    box-shadow: 0 0 0 2px rgba(99, 124, 249, 0.2);
                }

                .aw-settings-panel[data-theme="classic"] .aw-number-input:focus {
                    box-shadow: 0 0 0 3px rgba(255, 51, 102, 0.15);
                }

                /* ============================================
                   TEXT INPUT
                   ============================================ */
                .aw-text-input {
                    width: 70px;
                    padding: 4px 6px;
                    background: var(--bg-tertiary) !important;
                    background-color: var(--bg-tertiary) !important;
                    border: 1px solid var(--border-color);
                    border-radius: 4px;
                    color: var(--text-primary) !important;
                    font-family: 'JetBrains Mono', 'SF Mono', 'Consolas', monospace;
                    font-size: 9px;
                    text-align: center;
                    transition: all 0.2s ease;
                    -webkit-appearance: none;
                    -moz-appearance: none;
                    appearance: none;
                }

                .aw-settings-panel[data-theme="classic"] .aw-text-input {
                    width: 72px;
                    padding: 5px 8px;
                    border-radius: 6px;
                    font-size: 9px;
                    font-weight: 500;
                }

                .aw-settings-panel[data-theme="aniworld"] .aw-text-input {
                    background: #243743 !important;
                    background-color: #243743 !important;
                    font-size: 9px;
                }

                /* Wide text input for URLs */
                .aw-text-input.aw-text-input-wide {
                    width: 140px;
                    font-size: 9px;
                    text-align: left;
                    padding: 4px 6px;
                }

                .aw-settings-panel[data-theme="classic"] .aw-text-input.aw-text-input-wide {
                    width: 150px;
                    font-size: 9px;
                }

                .aw-text-input:hover {
                    border-color: var(--border-light);
                }

                .aw-text-input:focus {
                    outline: none;
                    border-color: var(--accent-primary);
                    box-shadow: 0 0 0 2px rgba(99, 124, 249, 0.2);
                }

                /* ============================================
                   SELECT INPUT
                   ============================================ */
                .aw-select-input {
                    padding: 4px 8px;
                    background: var(--bg-tertiary);
                    border: 1px solid var(--border-color);
                    border-radius: 4px;
                    color: var(--text-primary);
                    font-family: inherit;
                    font-size: 11px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }

                .aw-settings-panel[data-theme="classic"] .aw-select-input {
                    padding: 5px 10px;
                    border-radius: 6px;
                }

                .aw-select-input:hover {
                    border-color: var(--border-light);
                }

                .aw-select-input:focus {
                    outline: none;
                    border-color: var(--accent-primary);
                    box-shadow: 0 0 0 2px rgba(99, 124, 249, 0.2);
                }

                .aw-select-input option {
                    background: var(--bg-secondary);
                    color: var(--text-primary);
                }

                .aw-color-input {
                    width: 55px;
                    height: 28px;
                    padding: 2px;
                    background: var(--bg-tertiary);
                    border: 1px solid var(--border-color);
                    border-radius: 6px;
                    cursor: pointer;
                }

                /* ============================================
                   FOOTER
                   ============================================ */
                .aw-settings-footer {
                    padding: 8px 12px;
                    background: var(--bg-secondary);
                    border-top: 1px solid var(--border-color);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    position: relative;
                    z-index: 1;
                }

                .aw-settings-panel[data-theme="classic"] .aw-settings-footer {
                    padding: 10px 14px;
                }

                .aw-footer-link {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    color: var(--text-secondary);
                    text-decoration: none;
                    font-size: 12px;
                    transition: color 0.2s ease;
                }

                .aw-footer-link:hover {
                    color: var(--accent-primary);
                }

                .aw-footer-link i {
                    font-size: 14px;
                }

                .aw-footer-right {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }

                .aw-save-indicator {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    font-size: 11px;
                    font-weight: 500;
                    color: var(--accent-green);
                    opacity: 0;
                    transform: translateY(4px);
                    transition: all 0.3s ease;
                }

                .aw-save-indicator.visible {
                    opacity: 1;
                    transform: translateY(0);
                }

                .aw-version {
                    font-family: 'JetBrains Mono', 'SF Mono', 'Consolas', monospace;
                    font-size: 9px;
                    color: var(--text-muted);
                    padding: 3px 6px;
                    background: var(--bg-tertiary);
                    border-radius: 3px;
                }

                .aw-settings-panel[data-theme="classic"] .aw-version {
                    font-size: 9px;
                    border-radius: 4px;
                }

                /* ============================================
                   SCROLLBAR
                   ============================================ */
                .aw-settings-content::-webkit-scrollbar {
                    width: 6px;
                }

                .aw-settings-content::-webkit-scrollbar-track {
                    background: transparent;
                }

                .aw-settings-content::-webkit-scrollbar-thumb {
                    background: var(--border-color);
                    border-radius: 3px;
                }

                .aw-settings-content::-webkit-scrollbar-thumb:hover {
                    background: var(--border-light);
                }

                /* ============================================
                   RESET BUTTON
                   ============================================ */
                .aw-reset-btn {
                    width: 100%;
                    padding: 8px 12px;
                    margin-top: 10px;
                    background: var(--bg-tertiary);
                    border: 1px solid var(--border-color);
                    border-radius: 6px;
                    color: var(--text-secondary);
                    font-family: inherit;
                    font-size: 11px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }

                .aw-reset-btn:hover {
                    background: var(--bg-hover);
                    color: var(--text-primary);
                    border-color: var(--border-light);
                }

                /* ============================================
                   ANIMATIONS
                   ============================================ */
                .aw-settings-panel[data-theme="classic"] .aw-section {
                    animation: aw-fadeSlideIn 0.4s ease forwards;
                    opacity: 0;
                }

                .aw-settings-panel[data-theme="classic"] .aw-section:nth-child(1) { animation-delay: 0.05s; }
                .aw-settings-panel[data-theme="classic"] .aw-section:nth-child(2) { animation-delay: 0.1s; }
                .aw-settings-panel[data-theme="classic"] .aw-section:nth-child(3) { animation-delay: 0.15s; }
                .aw-settings-panel[data-theme="classic"] .aw-section:nth-child(4) { animation-delay: 0.2s; }
                .aw-settings-panel[data-theme="classic"] .aw-section:nth-child(5) { animation-delay: 0.25s; }
                .aw-settings-panel[data-theme="classic"] .aw-section:nth-child(6) { animation-delay: 0.3s; }

                @keyframes aw-fadeSlideIn {
                    from {
                        opacity: 0;
                        transform: translateY(8px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
            `);

			// Create the panel structure
			const overlay = document.createElement("div");
			overlay.className = "aw-settings-overlay";

			const panel = document.createElement("div");
			panel.className = "aw-settings-panel";
			panel.setAttribute("data-theme", savedTheme);

			// Helper function to show save indicator
			const showSaveIndicator = () => {
				const indicator = panel.querySelector(".aw-save-indicator");
				if (indicator) {
					indicator.classList.add("visible");
					setTimeout(() => indicator.classList.remove("visible"), 2000);
				}
			};

			// Helper to create toggle
			const createToggle = (id, checked, onChange) => {
				const label = document.createElement("label");
				label.className = "aw-toggle";
				label.innerHTML = `
                    <input type="checkbox" id="${id}" ${checked ? "checked" : ""}>
                    <span class="aw-toggle-track"></span>
                `;
				const input = label.querySelector("input");
				input.addEventListener("change", (e) => {
					onChange(e.target.checked);
					showSaveIndicator();
					this.messenger.sendMessage(IframeMessenger.messages.UPDATE_CORE_SETTINGS);
				});
				return label;
			};

			// Helper to create number input
			const createNumberInput = (id, value, min, max, step, onChange) => {
				const input = document.createElement("input");
				input.type = "number";
				input.className = "aw-number-input";
				input.id = id;
				input.value = value;
				input.min = min;
				input.max = max;
				input.step = step;
				input.addEventListener("change", (e) => {
					const val = parseFloat(e.target.value);
					if (!isNaN(val)) {
						onChange(val, e.target);
						showSaveIndicator();
						this.messenger.sendMessage(IframeMessenger.messages.UPDATE_CORE_SETTINGS);
					}
				});
				// Stop events from leaking to player
				input.addEventListener("keydown", (e) => e.stopPropagation());
				input.addEventListener("keyup", (e) => e.stopPropagation());
				input.addEventListener("keypress", (e) => e.stopPropagation());
				return input;
			};

			// Helper to create text input
			const createTextInput = (id, value, onChange, wide = false) => {
				const input = document.createElement("input");
				input.type = "text";
				input.className = "aw-text-input" + (wide ? " aw-text-input-wide" : "");
				input.id = id;
				input.value = value;
				input.addEventListener("change", (e) => {
					onChange(e.target.value.trim());
					showSaveIndicator();
					this.messenger.sendMessage(IframeMessenger.messages.UPDATE_CORE_SETTINGS);
				});
				// Stop events from leaking to player
				input.addEventListener("keydown", (e) => e.stopPropagation());
				input.addEventListener("keyup", (e) => e.stopPropagation());
				input.addEventListener("keypress", (e) => e.stopPropagation());
				return input;
			};

			// Helper to create color input
			const createColorInput = (id, value, onChange) => {
				const input = document.createElement("input");
				input.type = "color";
				input.className = "aw-color-input";
				input.id = id;
				input.value = value;
				input.addEventListener("change", (e) => {
					onChange(e.target.value);
					showSaveIndicator();
					this.messenger.sendMessage(IframeMessenger.messages.UPDATE_CORE_SETTINGS);
				});
				return input;
			};

			// Helper to create select input
			const createSelectInput = (id, value, options, onChange) => {
				const select = document.createElement("select");
				select.className = "aw-select-input";
				select.id = id;
				options.forEach((opt) => {
					const option = document.createElement("option");
					option.value = opt.value;
					option.textContent = opt.label;
					if (opt.value === value) option.selected = true;
					select.appendChild(option);
				});
				select.addEventListener("change", (e) => {
					onChange(e.target.value);
					showSaveIndicator();
					this.messenger.sendMessage(IframeMessenger.messages.UPDATE_CORE_SETTINGS);
				});
				return select;
			};

			// Helper to create setting row
			const createSettingRow = (label, description, control) => {
				const row = document.createElement("div");
				row.className = "aw-setting-row";
				row.innerHTML = `
                    <div class="aw-setting-info">
                        <div class="aw-setting-label">${label}</div>
                        <div class="aw-setting-description">${description}</div>
                    </div>
                `;
				row.appendChild(control);
				return row;
			};

			// Helper to create section
			const createSection = (icon, title, sectionId = null) => {
				const section = document.createElement("div");
				section.className = "aw-section";
				if (sectionId) section.dataset.sectionId = sectionId;
				section.innerHTML = `
                    <div class="aw-section-header">
                        <i class="fas fa-${icon}"></i>
                        <div class="aw-section-icon"><i class="fas fa-${icon}"></i></div>
                        <div class="aw-section-title">${title}</div>
                    </div>
                `;
				const card = document.createElement("div");
				card.className = "aw-settings-card";
				section.appendChild(card);
				return { section, card };
			};

			// Function to apply settings layout from theme
			const applySettingsLayout = (themeId) => {
				const themes = getAllThemes();
				const theme = themes[themeId];
				console.log("[AW Theme] Applying layout for theme:", themeId, "has settingsLayout:", !!theme?.settingsLayout);
				if (!theme || !theme.settingsLayout) return;

				const layout = theme.settingsLayout;
				console.log("[AW Theme] Layout:", layout);
				const prefsTab = panel.querySelector("#aw-tab-preferences");
				const advTab = panel.querySelector("#aw-tab-advanced");

				if (!prefsTab || !advTab) {
					console.log("[AW Theme] Tabs not found");
					return;
				}

				// Map section IDs to their elements
				const sectionMap = {};
				panel.querySelectorAll(".aw-section[data-section-id]").forEach((section) => {
					sectionMap[section.dataset.sectionId] = section;
				});
				console.log("[AW Theme] Found sections:", Object.keys(sectionMap));

				// Clear tabs (but keep non-section elements like reset button)
				const prefsNonSections = [...prefsTab.querySelectorAll(":scope > :not(.aw-section)")];
				const advNonSections = [...advTab.querySelectorAll(":scope > :not(.aw-section)")];
				prefsTab.innerHTML = "";
				advTab.innerHTML = "";

				// Add sections to preferences tab in order
				if (layout.prefs) {
					layout.prefs.forEach((id) => {
						if (sectionMap[id]) {
							prefsTab.appendChild(sectionMap[id]);
							delete sectionMap[id];
						}
					});
				}

				// Add sections to advanced tab in order
				if (layout.adv) {
					layout.adv.forEach((id) => {
						if (sectionMap[id]) {
							advTab.appendChild(sectionMap[id]);
							delete sectionMap[id];
						}
					});
				}

				// Add any remaining sections that weren't in the layout
				Object.values(sectionMap).forEach((section) => {
					advTab.appendChild(section);
				});

				// Re-add non-section elements
				prefsNonSections.forEach((el) => prefsTab.appendChild(el));
				advNonSections.forEach((el) => advTab.appendChild(el));

				console.log("[AW Theme] Layout applied successfully");
			};

			// Build the panel HTML
			panel.innerHTML = `
                <div class="aw-settings-header">
                    <div class="aw-logo-container">
                        <div class="aw-logo-ring"></div>
                        <div class="aw-logo-icon" style="font-size: 8px; letter-spacing: 0.2px;">GSv2.0</div>
                    </div>
                    <div class="aw-header-text">
                        <h1>Ani<span class="aw-brand-world">World</span> & <span class="aw-brand-sto">S</span>.to <span class="aw-brand-ap">by GSv2.com</span></h1>
                        <a class="aw-tagline" href="https://gsv2.com" target="_blank" rel="noopener">powered by gsv2.com ↗</a>
                    </div>
                    <button class="aw-close-btn" title="Close">
                        <i class="fas fa-times"></i>
                    </button>
                </div>

                <div class="aw-tabs">
                    <button class="aw-tab active" data-tab="preferences">${i18n.preferences}</button>
                    <button class="aw-tab" data-tab="advanced">${i18n.advanced}</button>
                </div>

                <div class="aw-settings-content">
                    <div class="aw-tab-content active" id="aw-tab-preferences"></div>
                    <div class="aw-tab-content" id="aw-tab-advanced"></div>
                </div>

                <div class="aw-settings-footer">
                    <a class="aw-footer-link" href="https://gsv2.com" target="_blank" rel="noopener">
                        <i class="fas fa-bolt"></i>
                        powered by GSv2.com
                    </a>
                    <div class="aw-footer-right">
                        <span class="aw-save-indicator">
                            <i class="fas fa-check"></i>
                            Saved
                        </span>
                        <span class="aw-version">v${GM_info.script.version}</span>
                    </div>
                </div>
            `;

			// Tab switching logic
			panel.querySelectorAll(".aw-tab").forEach((tab) => {
				tab.addEventListener("click", () => {
					panel.querySelectorAll(".aw-tab").forEach((t) => t.classList.remove("active"));
					panel.querySelectorAll(".aw-tab-content").forEach((c) => c.classList.remove("active"));
					tab.classList.add("active");
					panel.querySelector(`#aw-tab-${tab.dataset.tab}`).classList.add("active");
				});
			});

			// Close button
			panel.querySelector(".aw-close-btn").addEventListener("click", () => {
				panel.classList.remove("active");
				overlay.classList.remove("active");
			});

			// Close on overlay click
			overlay.addEventListener("click", () => {
				panel.classList.remove("active");
				overlay.classList.remove("active");
			});

			// ============================================
			// PREFERENCES TAB
			// ============================================
			const preferencesTab = panel.querySelector("#aw-tab-preferences");

			// Skip Settings Section
			const { section: skipSettingsSection, card: skipSettingsCard } = createSection("clock", "Skip Settings", "skip");
			skipSettingsCard.appendChild(
				createSettingRow(
					i18n.introSkipSize,
					i18n.introSkipSizeTooltip,
					createNumberInput(
						"currentLargeSkipSizeS",
						coreSettings[CORE_SETTINGS_MAP.currentLargeSkipSizeS],
						0,
						300,
						1,
						(v) => {
							coreSettings[CORE_SETTINGS_MAP.currentLargeSkipSizeS] = v;
							// Update franchise settings if available
							if (this.currentFranchiseId) {
								try {
									const gmKey = `${IframeInterface.franchiseSpecificDataGMPrefix}${this.currentFranchiseId}`;
									const existingData = GM_getValue(gmKey) || {};
									existingData.largeSkipSizeS = v;
									GM_setValue(gmKey, existingData);
								} catch (e) {
									console.error("[Settings] Error saving franchise setting:", e);
								}
							}
						},
					),
				),
			);
			skipSettingsCard.appendChild(
				createSettingRow(
					i18n.outroSkipThreshold,
					i18n.outroSkipThresholdTooltip,
					createNumberInput(
						"currentOutroSkipThresholdS",
						coreSettings[CORE_SETTINGS_MAP.currentOutroSkipThresholdS],
						1,
						300,
						1,
						(v, inputEl) => {
							// Enforce minimum of 1
							if (v < 1) {
								v = 1;
								if (inputEl) inputEl.value = v;
							}
							coreSettings[CORE_SETTINGS_MAP.currentOutroSkipThresholdS] = v;
							if (this.currentFranchiseId) {
								try {
									const gmKey = `${IframeInterface.franchiseSpecificDataGMPrefix}${this.currentFranchiseId}`;
									const existingData = GM_getValue(gmKey) || {};
									existingData.outroSkipThresholdS = v;
									GM_setValue(gmKey, existingData);
								} catch (e) {
									console.error("[Settings] Error saving franchise setting:", e);
								}
							}
						},
					),
				),
			);
			preferencesTab.appendChild(skipSettingsSection);

			// Auto Skip Section
			const { section: autoSkipSection, card: autoSkipCard } = createSection("forward", "Auto Skip", "autoSkip");
			autoSkipCard.appendChild(
				createSettingRow(
					i18n.autoSkipAtStart,
					i18n.autoSkipAtStartTooltip,
					createToggle("shouldAutoSkipOnStart", coreSettings[CORE_SETTINGS_MAP.shouldAutoSkipOnStart], (v) => {
						coreSettings[CORE_SETTINGS_MAP.shouldAutoSkipOnStart] = v;
					}),
				),
			);
			// Only show Auto-skip intro on AniWorld (not S.to) since it uses AniSkip
			if (!STO_DOMAINS.includes(location.hostname)) {
				autoSkipCard.appendChild(
					createSettingRow(
						i18n.autoSkipIntro,
						i18n.autoSkipIntroTooltip,
						createToggle("autoSkipIntro", coreSettings[CORE_SETTINGS_MAP.autoSkipIntro], (v) => {
							coreSettings[CORE_SETTINGS_MAP.autoSkipIntro] = v;
						}),
					),
				);
			}
			autoSkipCard.appendChild(
				createSettingRow(
					i18n.skipSecondsOnStart,
					i18n.skipSecondsOnStartTooltip,
					createNumberInput(
						"autoSkipSecondsOnStart",
						coreSettings[CORE_SETTINGS_MAP.autoSkipSecondsOnStart],
						0,
						300,
						1,
						(v) => {
							coreSettings[CORE_SETTINGS_MAP.autoSkipSecondsOnStart] = v;
						},
					),
				),
			);
			autoSkipCard.appendChild(
				createSettingRow(
					i18n.nextEpisodeCountdown,
					i18n.nextEpisodeCountdownTooltip,
					createToggle(
						"showNextEpisodeCountdown",
						advancedSettings[ADVANCED_SETTINGS_MAP.showNextEpisodeCountdown],
						(v) => {
							advancedSettings[ADVANCED_SETTINGS_MAP.showNextEpisodeCountdown] = v;
						},
					),
				),
			);
			autoSkipCard.appendChild(
				createSettingRow(
					i18n.nextEpisodeCountdownS,
					i18n.nextEpisodeCountdownSTooltip,
					createNumberInput(
						"nextEpisodeCountdownS",
						advancedSettings[ADVANCED_SETTINGS_MAP.nextEpisodeCountdownS],
						3,
						30,
						1,
						(v) => {
							advancedSettings[ADVANCED_SETTINGS_MAP.nextEpisodeCountdownS] = v;
						},
					),
				),
			);
			preferencesTab.appendChild(autoSkipSection);

			// Playback Section
			const { section: playbackSection, card: playbackCard } = createSection("play", "Playback", "playback");
			playbackCard.appendChild(
				createSettingRow(
					i18n.persistentMutedAutoplay,
					i18n.persistentMutedAutoplayTooltip,
					createToggle("shouldAutoplayMuted", mainSettings[MAIN_SETTINGS_MAP.shouldAutoplayMuted], (v) => {
						mainSettings[MAIN_SETTINGS_MAP.shouldAutoplayMuted] = v;
					}),
				),
			);
			playbackCard.appendChild(
				createSettingRow(
					i18n.playbackPositionMemory,
					i18n.playbackPositionMemoryTooltip,
					createToggle("playbackPositionMemory", mainSettings[MAIN_SETTINGS_MAP.playbackPositionMemory], (v) => {
						mainSettings[MAIN_SETTINGS_MAP.playbackPositionMemory] = v;
					}),
				),
			);
			preferencesTab.appendChild(playbackSection);

			// Display Section (moved from Advanced)
			const { section: displaySection, card: displayCard } = createSection("tv", "Display", "display");
			displayCard.appendChild(
				createSettingRow(
					i18n.showSkipIntroButton,
					i18n.showSkipIntroButtonTooltip,
					createToggle("showSkipIntroButton", advancedSettings[ADVANCED_SETTINGS_MAP.showSkipIntroButton], (v) => {
						advancedSettings[ADVANCED_SETTINGS_MAP.showSkipIntroButton] = v;
						const skipBtn = document.querySelector(".SkipIntroBtn");
						if (v) {
							if (!skipBtn) {
								const player = document.querySelector("video");
								if (player) {
									setupSkipIntroButton(player);
									addTimelineMarkers(player);
								}
							} else {
								skipBtn.classList.remove("invisible");
							}
						} else {
							if (skipBtn) skipBtn.classList.add("invisible");
						}
					}),
				),
			);
			displayCard.appendChild(
				createSettingRow(
					i18n.showSkipIntroButtonSeconds,
					i18n.showSkipIntroButtonSecondsTooltip,
					createNumberInput(
						"showSkipIntroButtonSeconds",
						advancedSettings[ADVANCED_SETTINGS_MAP.showSkipIntroButtonSeconds],
						5,
						600,
						1,
						(v) => {
							advancedSettings[ADVANCED_SETTINGS_MAP.showSkipIntroButtonSeconds] = v;
						},
					),
				),
			);
			preferencesTab.appendChild(displaySection);

			// Appearance Section - Enhanced Theme System
			const { section: appearanceSection, card: appearanceCard } = createSection(
				"paint-brush",
				"Appearance",
				"appearance",
			);

			// Build theme options from all available themes
			const allThemesOptions = Object.entries(getAllThemes()).map(([id, theme]) => ({
				value: id,
				label: theme.name + (theme.builtIn ? "" : " ⭐"),
			}));

			// Theme dropdown row
			const themeRow = createSettingRow(
				"UI Theme",
				"Choose from built-in or custom themes",
				createSelectInput("uiTheme", savedTheme, allThemesOptions, (value) => {
					GM_setValue("uiTheme", value);
					panel.setAttribute("data-theme", value);
					// Refresh custom theme CSS to ensure all styles are applied
					applyCustomThemeCSS();
					// Apply settings layout if theme has one
					applySettingsLayout(value);
				}),
			);
			appearanceCard.appendChild(themeRow);

			// Theme action buttons container
			const themeButtonsContainer = document.createElement("div");
			themeButtonsContainer.style.cssText = `
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
                padding: 8px 12px;
                margin-top: -4px;
            `;

			// Import Theme button
			const importThemeBtn = document.createElement("button");
			importThemeBtn.innerHTML = '<i class="fas fa-file-import" style="margin-right: 4px;"></i> Import Theme';
			importThemeBtn.style.cssText = `
                padding: 6px 12px;
                background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
                border: none;
                border-radius: 6px;
                color: white;
                cursor: pointer;
                font-size: 11px;
                font-weight: 500;
                font-family: inherit;
                transition: opacity 0.2s, transform 0.1s;
            `;
			importThemeBtn.addEventListener("mouseenter", () => {
				importThemeBtn.style.opacity = "0.9";
			});
			importThemeBtn.addEventListener("mouseleave", () => {
				importThemeBtn.style.opacity = "1";
			});
			importThemeBtn.addEventListener("click", () => openThemeImport());
			themeButtonsContainer.appendChild(importThemeBtn);

			// Export Theme button (for sharing custom themes)
			const exportThemeBtn = document.createElement("button");
			exportThemeBtn.innerHTML = '<i class="fas fa-file-export" style="margin-right: 4px;"></i> Export';
			exportThemeBtn.style.cssText = `
                padding: 6px 12px;
                background: var(--bg-tertiary);
                border: 1px solid var(--border-color);
                border-radius: 6px;
                color: var(--text-secondary);
                cursor: pointer;
                font-size: 11px;
                font-family: inherit;
                transition: all 0.2s;
            `;
			exportThemeBtn.addEventListener("mouseenter", () => {
				exportThemeBtn.style.background = "var(--bg-hover)";
				exportThemeBtn.style.color = "var(--text-primary)";
			});
			exportThemeBtn.addEventListener("mouseleave", () => {
				exportThemeBtn.style.background = "var(--bg-tertiary)";
				exportThemeBtn.style.color = "var(--text-secondary)";
			});
			exportThemeBtn.addEventListener("click", () => {
				const currentTheme = GM_getValue("uiTheme") || "classic";
				const themes = getAllThemes();
				if (themes[currentTheme]) {
					const exportData = {
						name: themes[currentTheme].name,
						vars: themes[currentTheme].vars,
						animations: themes[currentTheme].animations || { shimmer: true, pulse: true, glow: true, sections: true },
					};
					// Include settingsLayout if present
					if (themes[currentTheme].settingsLayout) {
						exportData.settingsLayout = themes[currentTheme].settingsLayout;
					}
					// Include backgroundImage if present
					if (themes[currentTheme].backgroundImage) {
						exportData.backgroundImage = themes[currentTheme].backgroundImage;
					}
					const json = JSON.stringify(exportData, null, 2);
					navigator.clipboard
						.writeText(json)
						.then(() => {
							Notiflix?.Notify?.success?.("Theme JSON copied to clipboard!") ||
								alert("Theme JSON copied to clipboard!");
						})
						.catch(() => {
							prompt("Copy this theme data:", json);
						});
				}
			});
			themeButtonsContainer.appendChild(exportThemeBtn);

			// Delete Theme button
			const deleteThemeBtn = document.createElement("button");
			deleteThemeBtn.innerHTML = '<i class="fas fa-trash" style="margin-right: 4px;"></i> Delete';
			deleteThemeBtn.style.cssText = `
                padding: 6px 12px;
                background: var(--bg-tertiary);
                border: 1px solid var(--border-color);
                border-radius: 6px;
                color: var(--text-secondary);
                cursor: pointer;
                font-size: 11px;
                font-family: inherit;
                transition: all 0.2s;
            `;
			deleteThemeBtn.addEventListener("mouseenter", () => {
				deleteThemeBtn.style.background = "#ff336633";
				deleteThemeBtn.style.color = "#ff6688";
				deleteThemeBtn.style.borderColor = "#ff336666";
			});
			deleteThemeBtn.addEventListener("mouseleave", () => {
				deleteThemeBtn.style.background = "var(--bg-tertiary)";
				deleteThemeBtn.style.color = "var(--text-secondary)";
				deleteThemeBtn.style.borderColor = "var(--border-color)";
			});
			deleteThemeBtn.addEventListener("click", () => {
				const currentTheme = GM_getValue("uiTheme") || "classic";
				const themes = getAllThemes();
				if (themes[currentTheme] && !themes[currentTheme].builtIn) {
					if (confirm(`Delete theme "${themes[currentTheme].name}"?`)) {
						const customThemes = getCustomThemes();
						delete customThemes[currentTheme];
						saveCustomThemes(customThemes);

						// Switch to classic theme
						GM_setValue("uiTheme", "classic");
						panel.setAttribute("data-theme", "classic");

						// Rebuild theme dropdown
						const themeSelect = document.querySelector("#uiTheme");
						if (themeSelect) {
							themeSelect.innerHTML = "";
							Object.entries(getAllThemes()).forEach(([id, t]) => {
								const opt = document.createElement("option");
								opt.value = id;
								opt.textContent = t.name + (t.builtIn ? "" : " ⭐");
								if (id === "classic") opt.selected = true;
								themeSelect.appendChild(opt);
							});
						}

						applyCustomThemeCSS();
						Notiflix?.Notify?.success?.("Theme deleted") || alert("Theme deleted");
					}
				} else {
					Notiflix?.Notify?.warning?.("Cannot delete built-in themes") || alert("Cannot delete built-in themes");
				}
			});
			themeButtonsContainer.appendChild(deleteThemeBtn);

			appearanceCard.appendChild(themeButtonsContainer);
			preferencesTab.appendChild(appearanceSection);

			// Defaults Section (moved from Advanced)
			const { section: defaultsSection, card: defaultsCard } = createSection("sliders-h", "Defaults", "defaults");
			defaultsCard.appendChild(
				createSettingRow(
					i18n.defaultIntroSkipSize,
					i18n.defaultIntroSkipSizeTooltip,
					createNumberInput(
						"defaultLargeSkipSizeS",
						advancedSettings[ADVANCED_SETTINGS_MAP.defaultLargeSkipSizeS],
						0,
						300,
						1,
						(v) => {
							advancedSettings[ADVANCED_SETTINGS_MAP.defaultLargeSkipSizeS] = v;
						},
					),
				),
			);
			defaultsCard.appendChild(
				createSettingRow(
					i18n.defaultOutroSkipThreshold,
					i18n.defaultOutroSkipThresholdTooltip,
					createNumberInput(
						"defaultOutroSkipThresholdS",
						advancedSettings[ADVANCED_SETTINGS_MAP.defaultOutroSkipThresholdS],
						1,
						300,
						1,
						(v, inputEl) => {
							// Enforce minimum of 1
							if (v < 1) {
								v = 1;
								if (inputEl) inputEl.value = v;
							}
							advancedSettings[ADVANCED_SETTINGS_MAP.defaultOutroSkipThresholdS] = v;
						},
					),
				),
			);
			defaultsCard.appendChild(
				createSettingRow(
					i18n.fastForwardSize,
					i18n.fastForwardSizeTooltip,
					createNumberInput(
						"fastForwardSizeS",
						advancedSettings[ADVANCED_SETTINGS_MAP.fastForwardSizeS],
						0,
						60,
						1,
						(v) => {
							advancedSettings[ADVANCED_SETTINGS_MAP.fastForwardSizeS] = v;
						},
					),
				),
			);
			preferencesTab.appendChild(defaultsSection);

			// Binge Stats Section
			const { section: statsSection, card: statsCard } = createSection("chart-line", i18n.bingeStats, "stats");
			const statsValue = document.createElement("span");
			statsValue.style.cssText =
				'font-family: "JetBrains Mono", monospace; font-size: 11px; color: var(--text-primary); white-space: nowrap;';
			const refreshStatsValue = () => {
				const eps = bingeStats.episodesFinished || 0;
				const hours = Math.floor((bingeStats.watchSecondsTotal || 0) / 3600);
				statsValue.textContent = `${eps} · ${hours} h`;
			};
			refreshStatsValue();
			setInterval(refreshStatsValue, 5000);
			statsCard.appendChild(createSettingRow(i18n.bingeStatsWatched, i18n.bingeStatsTooltip, statsValue));
			statsCard.appendChild(
				createSettingRow(
					i18n.showBingeMilestones,
					i18n.showBingeMilestonesTooltip,
					createToggle("showBingeMilestones", advancedSettings[ADVANCED_SETTINGS_MAP.showBingeMilestones], (v) => {
						advancedSettings[ADVANCED_SETTINGS_MAP.showBingeMilestones] = v;
					}),
				),
			);
			preferencesTab.appendChild(statsSection);

			// ============================================
			// ADVANCED TAB
			// ============================================
			const advancedTab = panel.querySelector("#aw-tab-advanced");

			// Hotkeys Section (moved from Preferences, Desktop only)
			if (!IS_MOBILE || advancedSettings[ADVANCED_SETTINGS_MAP.showDeviceSpecificSettings]) {
				const { section: hotkeysSection, card: hotkeysCard } = createSection("keyboard", i18n.hotkeys, "hotkeys");
				hotkeysCard.appendChild(
					createSettingRow(
						i18n.fastBackward,
						i18n.fastBackwardTooltip,
						createTextInput("fastBackward", hotkeysSettings[HOTKEYS_SETTINGS_MAP.fastBackward], (v) => {
							hotkeysSettings[HOTKEYS_SETTINGS_MAP.fastBackward] = v.toLowerCase();
						}),
					),
				);
				hotkeysCard.appendChild(
					createSettingRow(
						i18n.fastForward,
						i18n.fastForwardTooltip,
						createTextInput("fastForward", hotkeysSettings[HOTKEYS_SETTINGS_MAP.fastForward], (v) => {
							hotkeysSettings[HOTKEYS_SETTINGS_MAP.fastForward] = v.toLowerCase();
						}),
					),
				);
				hotkeysCard.appendChild(
					createSettingRow(
						i18n.fullscreen,
						i18n.fullscreenTooltip,
						createTextInput("fullscreen", hotkeysSettings[HOTKEYS_SETTINGS_MAP.fullscreen], (v) => {
							hotkeysSettings[HOTKEYS_SETTINGS_MAP.fullscreen] = v.toLowerCase();
						}),
					),
				);
				hotkeysCard.appendChild(
					createSettingRow(
						i18n.largeSkip,
						i18n.largeSkipTooltip,
						createTextInput("largeSkip", hotkeysSettings[HOTKEYS_SETTINGS_MAP.largeSkip], (v) => {
							hotkeysSettings[HOTKEYS_SETTINGS_MAP.largeSkip] = v.toLowerCase();
						}),
					),
				);

				// Hotkeys Guide Button
				const hotkeysGuideBtn = document.createElement("button");
				hotkeysGuideBtn.className = "aw-reset-btn";
				hotkeysGuideBtn.textContent = i18n.hotkeysGuide;
				hotkeysGuideBtn.addEventListener("click", () => {
					this.messenger.sendMessage(IframeMessenger.messages.OPEN_HOTKEYS_GUIDE);
				});
				hotkeysSection.appendChild(hotkeysGuideBtn);

				advancedTab.appendChild(hotkeysSection);
			}

			// AniSkip Section (only on aniworld.to)
			if (!STO_DOMAINS.includes(location.hostname)) {
				const { section: aniSkipSection, card: aniSkipCard } = createSection("magic", "AniSkip", "aniskip");
				aniSkipCard.appendChild(
					createSettingRow(
						i18n.useAniSkip,
						i18n.useAniSkipTooltip,
						createToggle("useAniSkip", advancedSettings[ADVANCED_SETTINGS_MAP.useAniSkip], (v) => {
							advancedSettings[ADVANCED_SETTINGS_MAP.useAniSkip] = v;
						}),
					),
				);
				aniSkipCard.appendChild(
					createSettingRow(
						i18n.showAniSkipNotifications,
						i18n.showAniSkipNotificationsTooltip,
						createToggle(
							"showAniSkipNotifications",
							advancedSettings[ADVANCED_SETTINGS_MAP.showAniSkipNotifications],
							(v) => {
								advancedSettings[ADVANCED_SETTINGS_MAP.showAniSkipNotifications] = v;
							},
						),
					),
				);
				advancedTab.appendChild(aniSkipSection);
			}

			// Timing Section
			const { section: timingSection, card: timingCard } = createSection("clock", "Timing", "timing");
			timingCard.appendChild(
				createSettingRow(
					i18n.markWatchedAfter,
					i18n.markWatchedAfterTooltip,
					createNumberInput(
						"markWatchedAfterS",
						advancedSettings[ADVANCED_SETTINGS_MAP.markWatchedAfterS],
						0,
						600,
						1,
						(v) => {
							advancedSettings[ADVANCED_SETTINGS_MAP.markWatchedAfterS] = v;
						},
					),
				),
			);
			timingCard.appendChild(
				createSettingRow(
					i18n.playbackPositionExpiration,
					i18n.playbackPositionExpirationTooltip,
					createNumberInput(
						"playbackPositionExpirationDays",
						advancedSettings[ADVANCED_SETTINGS_MAP.playbackPositionExpirationDays],
						1,
						365,
						1,
						(v) => {
							advancedSettings[ADVANCED_SETTINGS_MAP.playbackPositionExpirationDays] = v;
						},
					),
				),
			);
			if (!IS_MOBILE || advancedSettings[ADVANCED_SETTINGS_MAP.showDeviceSpecificSettings]) {
				timingCard.appendChild(
					createSettingRow(
						i18n.introSkipCooldown,
						i18n.introSkipCooldownTooltip,
						createNumberInput(
							"largeSkipCooldownMs",
							advancedSettings[ADVANCED_SETTINGS_MAP.largeSkipCooldownMs],
							0,
							2000,
							10,
							(v) => {
								advancedSettings[ADVANCED_SETTINGS_MAP.largeSkipCooldownMs] = v;
							},
						),
					),
				);
			}
			advancedTab.appendChild(timingSection);

			// Behavior Section
			const { section: behaviorSection, card: behaviorCard } = createSection("cog", "Behavior", "behavior");
			behaviorCard.appendChild(
				createSettingRow(
					i18n.highlightVisitedEpisodes,
					i18n.highlightVisitedEpisodesTooltip,
					createToggle("highlightVisitedEpisodes", mainSettings[MAIN_SETTINGS_MAP.highlightVisitedEpisodes], (v) => {
						mainSettings[MAIN_SETTINGS_MAP.highlightVisitedEpisodes] = v;
					}),
				),
			);
			behaviorCard.appendChild(
				createSettingRow(
					i18n.visitedEpisodesColor,
					i18n.visitedEpisodesColorTooltip,
					createColorInput(
						"visitedEpisodesColor",
						coreSettings[CORE_SETTINGS_MAP.visitedEpisodesColor] || "#ffdd00",
						(v) => {
							coreSettings[CORE_SETTINGS_MAP.visitedEpisodesColor] = v;
						},
					),
				),
			);
			behaviorCard.appendChild(
				createSettingRow(
					i18n.playOnIntroSkip,
					i18n.playOnIntroSkipTooltip,
					createToggle("playOnLargeSkip", advancedSettings[ADVANCED_SETTINGS_MAP.playOnLargeSkip], (v) => {
						advancedSettings[ADVANCED_SETTINGS_MAP.playOnLargeSkip] = v;
					}),
				),
			);
			behaviorCard.appendChild(
				createSettingRow(
					i18n.preloadOtherProviders,
					i18n.preloadOtherProvidersTooltip,
					createToggle("preloadOtherProviders", advancedSettings[ADVANCED_SETTINGS_MAP.preloadOtherProviders], (v) => {
						advancedSettings[ADVANCED_SETTINGS_MAP.preloadOtherProviders] = v;
					}),
				),
			);
			if (IS_MOBILE || advancedSettings[ADVANCED_SETTINGS_MAP.showDeviceSpecificSettings]) {
				behaviorCard.appendChild(
					createSettingRow(
						i18n.overrideDoubletapBehavior,
						i18n.overrideDoubletapBehaviorTooltip,
						createToggle(
							"overrideDoubletapBehavior",
							mainSettings[MAIN_SETTINGS_MAP.overrideDoubletapBehavior],
							(v) => {
								mainSettings[MAIN_SETTINGS_MAP.overrideDoubletapBehavior] = v;
							},
						),
					),
				);
			}
			behaviorCard.appendChild(
				createSettingRow(
					i18n.showDeviceSpecificSettings,
					i18n.showDeviceSpecificSettingsTooltip,
					createToggle(
						"showDeviceSpecificSettings",
						advancedSettings[ADVANCED_SETTINGS_MAP.showDeviceSpecificSettings],
						(v) => {
							advancedSettings[ADVANCED_SETTINGS_MAP.showDeviceSpecificSettings] = v;
						},
					),
				),
			);
			advancedTab.appendChild(behaviorSection);

			// Network Section
			const { section: networkSection, card: networkCard } = createSection("network-wired", "Network", "network");
			networkCard.appendChild(
				createSettingRow(
					i18n.corsProxy,
					i18n.corsProxyTooltip,
					createTextInput(
						"corsProxy",
						advancedSettings[ADVANCED_SETTINGS_MAP.corsProxy],
						(v) => {
							advancedSettings[ADVANCED_SETTINGS_MAP.corsProxy] = v;
						},
						true,
					), // wide = true for URL input
				),
			);
			networkCard.appendChild(
				createSettingRow(
					i18n.commlinkPollingInterval,
					i18n.commlinkPollingIntervalTooltip,
					createNumberInput(
						"commlinkPollingIntervalMs",
						advancedSettings[ADVANCED_SETTINGS_MAP.commlinkPollingIntervalMs],
						10,
						500,
						10,
						(v) => {
							advancedSettings[ADVANCED_SETTINGS_MAP.commlinkPollingIntervalMs] = v;
						},
					),
				),
			);
			advancedTab.appendChild(networkSection);

			// Reset Button
			const resetBtn = document.createElement("button");
			resetBtn.className = "aw-reset-btn";
			resetBtn.innerHTML = '<i class="fas fa-undo"></i> ' + i18n.resetToDefaults;
			resetBtn.addEventListener("click", () => {
				advancedSettings.update(ADVANCED_SETTINGS_DEFAULTS);
				hotkeysSettings.update(HOTKEYS_SETTINGS_DEFAULTS);
				mainSettings.update(MAIN_SETTINGS_DEFAULTS);
				// Refresh panel values
				panel.querySelectorAll('input[type="checkbox"]').forEach((input) => {
					const key = input.id;
					if (ADVANCED_SETTINGS_MAP[key]) input.checked = ADVANCED_SETTINGS_DEFAULTS[key];
					if (MAIN_SETTINGS_MAP[key]) input.checked = MAIN_SETTINGS_DEFAULTS[key];
					if (CORE_SETTINGS_MAP[key]) input.checked = CORE_SETTINGS_DEFAULTS[key];
				});
				panel.querySelectorAll('input[type="number"]').forEach((input) => {
					const key = input.id;
					if (ADVANCED_SETTINGS_DEFAULTS[key] !== undefined) input.value = ADVANCED_SETTINGS_DEFAULTS[key];
					if (CORE_SETTINGS_DEFAULTS[key] !== undefined) input.value = CORE_SETTINGS_DEFAULTS[key];
				});
				panel.querySelectorAll('input[type="text"]').forEach((input) => {
					const key = input.id;
					if (HOTKEYS_SETTINGS_DEFAULTS[key]) input.value = HOTKEYS_SETTINGS_DEFAULTS[key];
					if (ADVANCED_SETTINGS_DEFAULTS[key] !== undefined) input.value = ADVANCED_SETTINGS_DEFAULTS[key];
				});
				showSaveIndicator();
			});
			advancedTab.appendChild(resetBtn);

			// Append to DOM
			document.body.appendChild(overlay);
			document.body.appendChild(panel);

			// Apply settings layout from saved theme
			applySettingsLayout(savedTheme);

			// Listen for theme imports to apply layout
			window.addEventListener("aw-theme-imported", (e) => {
				if (e.detail && e.detail.themeId) {
					applySettingsLayout(e.detail.themeId);
				}
			});

			// Create a pane-like interface for compatibility
			const paneInterface = {
				hidden: true,
				element: panel,
				refresh: () => {
					// Refresh all input values from settings
					panel.querySelectorAll('input[type="checkbox"]').forEach((input) => {
						const key = input.id;
						if (coreSettings[key] !== undefined) input.checked = coreSettings[key];
						if (mainSettings[key] !== undefined) input.checked = mainSettings[key];
						if (advancedSettings[key] !== undefined) input.checked = advancedSettings[key];
					});
					panel.querySelectorAll('input[type="number"]').forEach((input) => {
						const key = input.id;
						if (coreSettings[key] !== undefined) input.value = coreSettings[key];
						if (advancedSettings[key] !== undefined) input.value = advancedSettings[key];
					});
					panel.querySelectorAll('input[type="text"]').forEach((input) => {
						const key = input.id;
						if (hotkeysSettings[key] !== undefined) input.value = hotkeysSettings[key];
						if (advancedSettings[key] !== undefined) input.value = advancedSettings[key];
					});
				},
				dispose: () => {
					panel.remove();
					overlay.remove();
				},
			};

			// Define hidden property getter/setter
			Object.defineProperty(paneInterface, "hidden", {
				get: () => !panel.classList.contains("active"),
				set: (value) => {
					if (value) {
						panel.classList.remove("active");
						overlay.classList.remove("active");
					} else {
						panel.classList.add("active");
						overlay.classList.add("active");
					}
				},
			});

			return paneInterface;
		}

		async handleAutoplay(player) {
			if (!coreSettings[CORE_SETTINGS_MAP.isAutoplayEnabled]) return;
			const playTooSlowErr = "play() was taking too long";
			let muteWasApplied = false;
			// If play fails it tries to fix it but throws the problem error anyway
			const playOrFix = async () => {
				try {
					await Promise.race([
						player.play(), // there is a chance this would hang forever
						new Promise((_, reject) => {
							setTimeout(() => reject(new Error(playTooSlowErr)), 50);
						}),
					]);
				} catch (e) {
					if (e.name === "NotAllowedError") {
						// Muted usually is allowed to play,
						// and if it's not allowed, nothing could be done here
						if (player.muted) {
							console.error("Muted and not allowed");
							throw e;
						}

						if (mainSettings[MAIN_SETTINGS_MAP.shouldAutoplayMuted] && !muteWasApplied) {
							player.muted = true;
							muteWasApplied = true;

							// Restore setting altered by forced mute.
							// See this.setupPersistentVolume()
							setTimeout(() => (coreSettings[CORE_SETTINGS_MAP.isMuted] = false), 250);
							// Should not be awaited
							(async () => {
								await waitForUserInteraction();

								// If interaction was unmute button, try to not overtake it
								// because it might result in mute -> unmute -> mute again.
								// Different players require a different delay
								await sleep(100);

								if (player.muted) player.muted = false;
							})();
						}
					}

					throw e;
				}
			};

			const startTime = Date.now();
			let lastError = null;

			while (Date.now() - startTime < 10 * 1000) {
				try {
					await sleep(200);
					await playOrFix();

					return;
				} catch (e) {
					lastError = e;
				}
			}

			throw lastError;
		}

		setupDoubletapBehavior(player, doubletapTarget = player) {
			if (!mainSettings[MAIN_SETTINGS_MAP.overrideDoubletapBehavior]) return;
			detectDoubletap(
				doubletapTarget,
				(ev) => {
					const xViewport = ev.clientX;
					const rect = ev.target.getBoundingClientRect();

					// Get X relative to the target just in case.
					// It is not really needed since the player takes the whole size of an iframe
					const xTarget = xViewport - rect.left;

					if (xTarget < rect.width * 0.35) {
						if (advancedSettings[ADVANCED_SETTINGS_MAP.fastForwardSizeS]) {
							player.currentTime -= advancedSettings[ADVANCED_SETTINGS_MAP.fastForwardSizeS];
						}
					} else if (xTarget > rect.width - rect.width * 0.35) {
						if (advancedSettings[ADVANCED_SETTINGS_MAP.fastForwardSizeS]) {
							player.currentTime += advancedSettings[ADVANCED_SETTINGS_MAP.fastForwardSizeS];
						}
					} else {
						if (coreSettings[CORE_SETTINGS_MAP.currentLargeSkipSizeS]) {
							player.currentTime += coreSettings[CORE_SETTINGS_MAP.currentLargeSkipSizeS];
							if (advancedSettings[ADVANCED_SETTINGS_MAP.playOnLargeSkip]) {
								player.play();
							}
						}
					}
				},
				{
					maxIntervalMs: advancedSettings[ADVANCED_SETTINGS_MAP.doubletapTimingThresholdMs],
					tapsDistanceThresholdPx: advancedSettings[ADVANCED_SETTINGS_MAP.doubletapDistanceThresholdPx],
				},
			);
		}

		setupHotkeys(player) {
			// Handle space ourselves in the capture phase and swallow it there:
			// prevents double pause/play when the player page (or a second
			// userscript instance) also reacts to the same keypress
			window.addEventListener(
				"keydown",
				(ev) => {
					if (ev.code !== "Space" || ev.repeat) return;
					const t = ev.target;
					if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
					ev.preventDefault();
					ev.stopImmediatePropagation();
					player.paused ? player.play() : player.pause();
				},
				{ capture: true },
			);
			if (hotkeysSettings[HOTKEYS_SETTINGS_MAP.fastForward]) {
				keyboardJS.bind(hotkeysSettings[HOTKEYS_SETTINGS_MAP.fastForward], () => {
					if (advancedSettings[ADVANCED_SETTINGS_MAP.fastForwardSizeS]) {
						player.currentTime += advancedSettings[ADVANCED_SETTINGS_MAP.fastForwardSizeS];
					}
				});
			}

			if (hotkeysSettings[HOTKEYS_SETTINGS_MAP.fastBackward]) {
				keyboardJS.bind(hotkeysSettings[HOTKEYS_SETTINGS_MAP.fastBackward], () => {
					if (advancedSettings[ADVANCED_SETTINGS_MAP.fastForwardSizeS]) {
						player.currentTime -= advancedSettings[ADVANCED_SETTINGS_MAP.fastForwardSizeS];
					}
				});
			}

			if (hotkeysSettings[HOTKEYS_SETTINGS_MAP.fullscreen]) {
				keyboardJS.bind(hotkeysSettings[HOTKEYS_SETTINGS_MAP.fullscreen], (ev) => {
					ev.preventRepeat();
					this.messenger.sendMessage(IframeMessenger.messages.TOGGLE_FULLSCREEN);
				});
			}

			if (hotkeysSettings[HOTKEYS_SETTINGS_MAP.largeSkip]) {
				const cooldownTime = advancedSettings[ADVANCED_SETTINGS_MAP.largeSkipCooldownMs];
				let lastSkipTime = 0;

				keyboardJS.bind(hotkeysSettings[HOTKEYS_SETTINGS_MAP.largeSkip], () => {
					if (coreSettings[CORE_SETTINGS_MAP.currentLargeSkipSizeS]) {
						const now = Date.now();

						if (now - lastSkipTime < cooldownTime) return;

						lastSkipTime = now;

						console.log("[Keyboard Skip] Pressed. globalAniSkipData:", globalAniSkipData);

						// Check if we have AniSkip data for intro
						if (globalAniSkipData && globalAniSkipData.intro) {
							// Use AniSkip intro end time
							console.log("[Keyboard Skip] Using AniSkip time:", globalAniSkipData.intro.end);
							player.currentTime = globalAniSkipData.intro.end;
							if (advancedSettings[ADVANCED_SETTINGS_MAP.showAniSkipNotifications]) {
								Notiflix.Notify.success(i18n.aniSkipIntroDetected, {
									timeout: 1500,
									position: "right-bottom",
								});
							}
						} else {
							// Fallback to manual skip size
							console.log(
								"[Keyboard Skip] Using fallback skip size:",
								coreSettings[CORE_SETTINGS_MAP.currentLargeSkipSizeS],
							);
							player.currentTime += coreSettings[CORE_SETTINGS_MAP.currentLargeSkipSizeS];
							if (
								globalAniSkipData === null &&
								advancedSettings[ADVANCED_SETTINGS_MAP.useAniSkip] &&
								advancedSettings[ADVANCED_SETTINGS_MAP.showAniSkipNotifications]
							) {
								Notiflix.Notify.info(i18n.usingFallbackTimes, {
									timeout: 1500,
									position: "right-bottom",
								});
							}
						}

						const skipBtn = document.querySelector(".SkipIntroBtn");
						if (skipBtn) {
							skipBtn.classList.add("invisible");
							window.__skipIntroButtonDisabled = true;
						}

						if (advancedSettings[ADVANCED_SETTINGS_MAP.playOnLargeSkip]) {
							player.play();
						}
					}
				});
			}
		}

		setupOutroSkipHandling(player) {
			let outroHasBeenReached = false;
			let nextWasSent = false;
			let card = null;
			let countdownIntervalId = null;

			const dismissCard = () => {
				if (countdownIntervalId) clearInterval(countdownIntervalId);
				countdownIntervalId = null;
				card?.remove();
				card = null;
			};

			const sendNext = () => {
				if (nextWasSent) return;
				nextWasSent = true;
				dismissCard();
				bingeStats.episodesFinished = (bingeStats.episodesFinished || 0) + 1;
				this.messenger.sendMessage(IframeMessenger.messages.AUTOPLAY_NEXT);
			};

			const showCountdownCard = () => {
				const themeVars = getCurrentThemeVars();
				const total = Math.min(
					30,
					Math.max(3, Number(advancedSettings[ADVANCED_SETTINGS_MAP.nextEpisodeCountdownS]) || 10),
				);
				let secondsLeft = total;

				card = document.createElement("div");
				card.style.cssText = `position:fixed;bottom:100px;right:16px;z-index:99995;display:flex;flex-direction:column;gap:10px;padding:14px 16px;min-width:210px;background:${themeVars.bgPrimary};border:1px solid ${themeVars.borderLight};border-radius:${themeVars.borderRadius};box-shadow:0 15px 40px rgba(0,0,0,0.6);font-family:${themeVars.fontFamily};color:${themeVars.textPrimary};`;
				card.innerHTML = `
                    <div style="font-size:13px;font-weight:600;">${i18n.nextEpisodeIn} <span class="ap-next-count">${secondsLeft}</span>s</div>
                    <div style="height:3px;background:${themeVars.bgTertiary};border-radius:2px;overflow:hidden;"><div class="ap-next-bar" style="height:100%;width:100%;background:linear-gradient(90deg, ${themeVars.accentPrimary}, ${themeVars.accentSecondary});transition:width ${total}s linear;"></div></div>
                    <div style="display:flex;gap:8px;">
                        <button class="ap-next-cancel" style="flex:1;padding:8px 10px;background:${themeVars.bgTertiary};border:1px solid ${themeVars.borderColor};border-radius:8px;color:${themeVars.textSecondary};font-family:inherit;font-size:12px;cursor:pointer;">${i18n.cancelButton}</button>
                        <button class="ap-next-now" style="flex:1;padding:8px 10px;background:linear-gradient(135deg, ${themeVars.accentPrimary}, ${themeVars.accentSecondary});border:none;border-radius:8px;color:${themeVars.logoText || "rgba(255,255,255,1)"};font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;">${i18n.nextEpisodeNow}</button>
                    </div>
                `;
				document.body.appendChild(card);

				const countEl = card.querySelector(".ap-next-count");
				const barEl = card.querySelector(".ap-next-bar");
				requestAnimationFrame(() => (barEl.style.width = "0%"));

				card.querySelector(".ap-next-now").addEventListener("click", sendNext);
				card.querySelector(".ap-next-cancel").addEventListener("click", dismissCard);

				countdownIntervalId = setInterval(() => {
					secondsLeft -= 1;
					if (countEl) countEl.textContent = String(Math.max(0, secondsLeft));
					if (secondsLeft <= 0) sendNext();
				}, 1000);
			};

			// If the episode ends while the countdown is still running,
			// switch right away instead of showing a frozen last frame
			player.addEventListener("ended", () => {
				if (coreSettings[CORE_SETTINGS_MAP.isAutoplayEnabled] && card) sendNext();
			});

			setInterval(() => {
				if (nextWasSent || !coreSettings[CORE_SETTINGS_MAP.isAutoplayEnabled]) return;

				const timeLeft = player.duration - player.currentTime;

				// Re-arm after a cancel once the user has seeked back
				// out of the outro zone
				if (outroHasBeenReached && !card && timeLeft > coreSettings[CORE_SETTINGS_MAP.currentOutroSkipThresholdS] + 5) {
					outroHasBeenReached = false;
				}

				if (!outroHasBeenReached && timeLeft <= coreSettings[CORE_SETTINGS_MAP.currentOutroSkipThresholdS]) {
					outroHasBeenReached = true;

					if (advancedSettings[ADVANCED_SETTINGS_MAP.showNextEpisodeCountdown]) {
						showCountdownCard();
					} else {
						sendNext();
					}
				}
			}, 250);
		}

		setupAutoIntroSkip(player) {
			if (!coreSettings[CORE_SETTINGS_MAP.autoSkipIntro]) return;

			let introHasBeenSkipped = false;
			let hasStartedPlaying = false;

			const checkInterval = setInterval(() => {
				if (introHasBeenSkipped || !coreSettings[CORE_SETTINGS_MAP.autoSkipIntro]) {
					clearInterval(checkInterval);
					return;
				}

				const currentTime = player.currentTime;

				// Mark as started playing once we get past 0.5 seconds
				if (!hasStartedPlaying && currentTime > 0.5) {
					hasStartedPlaying = true;
				}

				// Don't skip until we've actually started playing
				if (!hasStartedPlaying) return;

				// Only auto-skip if we have AniSkip data
				if (globalAniSkipData && globalAniSkipData.intro) {
					// Skip when we're within the intro timeframe
					if (currentTime >= globalAniSkipData.intro.start && currentTime < globalAniSkipData.intro.end) {
						introHasBeenSkipped = true;
						player.currentTime = globalAniSkipData.intro.end;

						if (advancedSettings[ADVANCED_SETTINGS_MAP.playOnLargeSkip]) {
							player.play();
						}
						clearInterval(checkInterval);
					}
				}
				// No fallback - auto-skip only works with AniSkip data
			}, 250);
		}

		setupPersistentVolume(player) {
			player.muted = coreSettings[CORE_SETTINGS_MAP.isMuted];
			player.volume = coreSettings[CORE_SETTINGS_MAP.persistentVolumeLvl];

			let unmuteEnforcerDone = false;
			player.addEventListener("volumechange", () => {
				// While the enforcer below is probing, don't let a probe-mute
				// get saved as the user's preference
				if (!unmuteEnforcerDone && player.muted) return;
				coreSettings[CORE_SETTINGS_MAP.isMuted] = player.muted;
				coreSettings[CORE_SETTINGS_MAP.persistentVolumeLvl] = player.volume;
			});

			// Some players (VOE) mute themselves again on autostart. Re-apply the
			// saved "not muted" state for a few seconds; back off cleanly if the
			// browser reacts by pausing (audible playback not allowed yet)
			(async () => {
				for (let i = 0; i < 16; i++) {
					await sleep(500);
					if (coreSettings[CORE_SETTINGS_MAP.isMuted]) break;
					if (player.muted && !player.paused) {
						player.muted = false;
						await sleep(300);
						if (player.paused) {
							player.muted = true;
							player.play().catch(() => {});
							break;
						}
					}
				}
				unmuteEnforcerDone = true;
			})();
		}

		setupWatchedStateLabeling(player) {
			const intervalMs = 250;
			let approximatePlayTimeS = 0;
			let currentVideoWasWatched = false;
			let lastPlayerTime = player.currentTime;
			let unsavedWatchS = 0;
			setInterval(() => {
				if (player.currentTime === lastPlayerTime) return;

				lastPlayerTime = player.currentTime;
				approximatePlayTimeS += intervalMs / 1000;
				unsavedWatchS += intervalMs / 1000;

				// Local-only binge stats, flushed in coarse steps
				if (unsavedWatchS >= 30) {
					bingeStats.watchSecondsTotal = (bingeStats.watchSecondsTotal || 0) + Math.round(unsavedWatchS);
					unsavedWatchS = 0;
				}

				if (
					!currentVideoWasWatched &&
					advancedSettings[ADVANCED_SETTINGS_MAP.markWatchedAfterS] &&
					approximatePlayTimeS >= advancedSettings[ADVANCED_SETTINGS_MAP.markWatchedAfterS]
				) {
					currentVideoWasWatched = true;
					this.messenger.sendMessage(IframeMessenger.messages.MARK_CURRENT_VIDEO_WATCHED);
				}
			}, intervalMs);
		}

		async setupVideoPlaybackPositionMemory(player) {
			const self = this;
			await (async function waitForVideoData(start = Date.now()) {
				if (!self.currentVideoId || !self.topScopeDomainId) {
					if (Date.now() - start > 10 * 1000) {
						throw new Error("Video data didn't arrive in time");
					}

					await sleep();

					return waitForVideoData(start);
				}
			})();
			// This has to wait indefinitely because players like VOE do not have the value
			// until the play button has been pressed or an autoplay has been triggered
			await (async function waitForVideoDuration() {
				if (!player.duration) {
					await sleep();
					return waitForVideoDuration();
				}
			})();
			const timestampDataGMKey = IframeInterface.makePlaybackPositionGMKey(this.topScopeDomainId, this.currentVideoId);
			const timestampData = GM_getValue(timestampDataGMKey, {});

			if (timestampData.value) {
				const elapsedTime = Date.now() - timestampData.updateDate;
				const expirationThreshold =
					advancedSettings[ADVANCED_SETTINGS_MAP.playbackPositionExpirationDays] * 24 * 60 * 60 * 1000;
				if (elapsedTime < expirationThreshold) {
					const outroSkipThresholdS = coreSettings[CORE_SETTINGS_MAP.currentOutroSkipThresholdS];
					const potentialTimeLeftToPlay = player.duration - timestampData.value;

					// Skip saved playback position if it's in a range of (outroSkipThresholdS + 20)
					if (potentialTimeLeftToPlay > outroSkipThresholdS + 20) {
						player.currentTime = timestampData.value;
					}
				}
			}

			let lastCheckedTime = player.currentTime;
			setInterval(() => {
				if (!mainSettings[MAIN_SETTINGS_MAP.playbackPositionMemory] || player.currentTime === lastCheckedTime) return;

				lastCheckedTime = player.currentTime;

				GM_setValue(timestampDataGMKey, {
					value: lastCheckedTime,
					updateDate: Date.now(),
				});
			}, 1000);
		}
	}

	class VidozaIframeInterface extends IframeInterface {
		constructor(messenger) {
			super(messenger);
			waitForElement(
				[
					"div[id^=asg-]",
					"div.prevent-first-click",
					"div.vjs-adblock-overlay",
					'iframe[data-asg-handled^="asg-"]',
					'iframe[style*="z-index: 2147483647"]',
				].join(", "),
				{
					existing: true,
				},
				(ads) => ads.remove(),
			);
			(function () {
				const originalAddEventListener = EventTarget.prototype.addEventListener;

				EventTarget.prototype.addEventListener = function (type, listener, options) {
					// Get rid of ads
					if (type === "mousedown" && (this === document || this === unsafeWindow)) {
						return;
					}

					return originalAddEventListener.call(this, type, listener, options);
				};
			})();
		}

		static get queries() {
			return {
				fullscreenBtn: "button.vjs-fullscreen-control",
				player: "video#player_html5_api.vjs-tech",
			};
		}

		async preparePlayer(player) {
			this.setupDoubletapBehavior(player);
			this.setupHotkeys(player);
			if (advancedSettings[ADVANCED_SETTINGS_MAP.showSkipIntroButton]) {
				setupSkipIntroButton(player);
			}

			addTimelineMarkers(player);
			this.setupOutroSkipHandling(player);
			this.setupAutoIntroSkip(player);
			this.setupWatchedStateLabeling(player);
			this.setupVideoPlaybackPositionMemory(player);
			this.restylePlayer(player);

			let hasSkippedInitial = false;
			player.addEventListener("timeupdate", function autoStartSkip() {
				if (!hasSkippedInitial && coreSettings[CORE_SETTINGS_MAP.shouldAutoSkipOnStart]) {
					const skipSeconds = Number(coreSettings[CORE_SETTINGS_MAP.autoSkipSecondsOnStart]) || 0;
					if (player.currentTime < skipSeconds) {
						// Soft fade instead of a hard cut while skipping the start
						const fade = document.createElement("div");
						fade.style.cssText =
							"position:fixed;inset:0;background:#000;z-index:99990;opacity:1;transition:opacity 0.8s ease;pointer-events:none;";
						document.body.appendChild(fade);
						setTimeout(() => (fade.style.opacity = "0"), 50);
						setTimeout(() => fade.remove(), 950);
						player.currentTime = skipSeconds;
					}
					hasSkippedInitial = true;
				}
			});
			this.setupPersistentVolume(player);
			this.handleAutoplay(player); // should go after setupPersistentVolume

			// Attach autoplay button and change fullscreen button behavior...
			waitForElement(
				VidozaIframeInterface.queries.fullscreenBtn,
				{
					existing: true,
					onceOnly: true,
				},
				(fsBtn) => {
					// Prevent focused buttons from being toggled by pressing space/enter
					fsBtn.parentElement.addEventListener("keydown", (ev) => ev.preventDefault());
					fsBtn.parentElement.addEventListener("keyup", (ev) => ev.preventDefault());

					const newFsBtn = fsBtn.cloneNode(true);
					const autoplayBtn = this.createAutoplayButton();
					const settingsBtn = this.createSettingsButton();
					const sleepBtn = this.createSleepTimerButton();
					const sleepTimerPane = this.createSleepTimerPane();
					const settingsPane = (this.settingsPane = this.createSettingsPane());

					autoplayBtn.style.paddingBottom = "1px";

					fsBtn.before(autoplayBtn);
					fsBtn.before(settingsBtn);
					fsBtn.before(sleepBtn);

					IS_SAFARI ? fsBtn.remove() : fsBtn.replaceWith(newFsBtn);

					const toggleSettingsPane = (ev) => {
						ev?.preventDefault();
						ev?.stopImmediatePropagation();

						settingsPane.hidden = !settingsPane.hidden;

						return false;
					};
					// Dedicated gear button: toggle switches autoplay only,
					// the gear opens the settings
					settingsBtn.addEventListener("click", toggleSettingsPane);
					settingsBtn.oncontextmenu = () => false;
					sleepBtn.addEventListener("click", () => sleepTimerPane.toggle());
					sleepBtn.oncontextmenu = () => false;

					if (IS_SAFARI === false) {
						newFsBtn.addEventListener("click", () => {
							this.messenger.sendMessage(IframeMessenger.messages.TOGGLE_FULLSCREEN);
						});
						this.messenger.sendMessage(IframeMessenger.messages.REQUEST_FULLSCREEN_STATE);
					}
				},
			);
		}

		restylePlayer() {
			GM_addStyle(
				[
					`
      div.vjs-resolution-button, button.vjs-disable-ads-button {
        display: none !important;
      }
    `,

					`
      div.video-js div.vjs-control-bar {
        background-color: unset !important;
      }
    `,

					`
      div.video-js .vjs-slider {
        background-color: rgb(112, 112, 112, 0.8) !important;
      }
    `,

					`
      div.video-js .vjs-play-progress {
        background-color: #2979ff !important;
        border-radius: 1em !important;
        height: 0.4em !important;
      }

      div.video-js .vjs-play-progress:before {
        font-size: 0.9em !important;
        top: -.25em !important;
      }
    `,

					`
      div.video-js .vjs-load-progress {
        background-color: #808080 !important;
        height: 0.4em !important;
      }
    `,

					`
      div.video-js .vjs-progress-control .vjs-progress-holder {
        height: 0.4em !important;
      }
    `,

					`
      div.video-js .vjs-time-control, div.vjs-playback-rate .vjs-playback-rate-value, div.vjs-resolution-button .vjs-resolution-button-label {
        line-height: 3em !important;
      }
    `,

					`
      div.video-js .vjs-big-play-button {
        background-color: rgb(0 132 255 / 75%) !important;
      }

      div.video-js .vjs-big-play-button:hover {
        background-color: rgb(40 160 255 / 95%) !important;
      }
    `,

					`
      div.video-js .vjs-progress-control:hover .vjs-mouse-display:after, div.video-js .vjs-progress-control:hover .vjs-play-progress:after, div.video-js .vjs-progress-control:hover .vjs-time-tooltip, div.video-js .vjs-volume-panel .vjs-volume-control.vjs-volume-vertical, div.vjs-menu-button-popup .vjs-menu .vjs-menu-content {
        background-color: rgb(0 132 255 / 75%) !important;
      }
    `,

					`
      #vplayer .video-js .vjs-time-control {
        padding-right: 3.5em !important;
      }
    `,

					`
      div.video-js .vjs-play-control {
        margin-left: 0.5em !important;
      }
    `,

					`
      div.video-js .vjs-progress-control {
        margin-left: 0.8em !important;
      }
    `,

					`
      div.video-js .vjs-fullscreen-control {
        margin-right: 0.5em !important;
      }
    `,
				].join(" "),
			);
			const currentTime = document.querySelector("div.vjs-current-time");
			const remainingTime = document.querySelector("div.vjs-remaining-time");

			remainingTime.replaceWith(currentTime);
		}

		updateFullscreenBtn({ isInFullscreen }) {
			const player = document.querySelector(VidozaIframeInterface.queries.player);
			if (isInFullscreen) {
				player.parentElement.classList.add("vjs-fullscreen");
			} else {
				player.parentElement.classList.remove("vjs-fullscreen");
			}
		}
	}

	class VOEJWPIframeInterface extends IframeInterface {
		constructor(messenger) {
			super(messenger);
			const playbackPositionStorageKey = `skip-forward-${location.pathname.split("/").pop()}`;
			try {
				this.builtinPlaybackPositionMemory = JSON.parse(localStorage.getItem(playbackPositionStorageKey));
			} catch {}

			localStorage.removeItem(playbackPositionStorageKey);
			waitForElement(
				["div.guestMode", 'iframe[style*="z-index: 2147483647"]'].join(", "),
				{
					existing: true,
				},
				(ads) => ads.remove(),
			);
			(function () {
				const originalAddEventListener = EventTarget.prototype.addEventListener;

				EventTarget.prototype.addEventListener = function (type, listener, options) {
					if (
						// Get rid of ads
						(["click", "mousedown"].includes(type) && this === document) ||
						// Intercept original hotkeys to avoid conflicts with the script hotkeys
						(type === "keydown" && this.matches && this.matches("div#vp"))
					) {
						return;
					}

					// Intercept double-tap to fullscreen handler
					if (
						IS_MOBILE &&
						mainSettings[MAIN_SETTINGS_MAP.overrideDoubletapBehavior] &&
						type === "click" &&
						this.matches &&
						this.matches("div#vp > div > div.jw-media")
					) {
						let timerId = null;
						return originalAddEventListener.call(
							this,
							type,
							() => {
								clearTimeout(timerId);

								const playerContainer = document.querySelector("div#vp");

								if (playerContainer.classList.contains("jw-flag-user-inactive")) {
									playerContainer.classList.remove("jw-flag-user-inactive");

									timerId = setTimeout(() => {
										playerContainer.classList.add("jw-flag-user-inactive");
									}, 2000);
								} else {
									playerContainer.classList.add("jw-flag-user-inactive");
								}
							},
							options,
						);
					}

					return originalAddEventListener.call(this, type, listener, options);
				};
			})();
		}

		static get queries() {
			return {
				fullscreenBtn: "div.jw-tooltip-fullscreen",
				player: "video.jw-video",
			};
		}

		async handleAutoplay(player) {
			if (!coreSettings[CORE_SETTINGS_MAP.isAutoplayEnabled]) return;
			const playTooSlowErr = "play() was taking too long";
			let muteWasApplied = false;
			let playBtnWasClicked = false;
			// If play fails it tries to fix it but throws the problem error anyway
			const playOrFix = async () => {
				try {
					// VOE play() either errors immediately
					// or never resolves until a play button click
					await Promise.race([
						player.play(),
						new Promise((_, reject) => {
							setTimeout(() => reject(new Error(playTooSlowErr)), 150);
						}),
					]);
				} catch (e) {
					if (e.message === playTooSlowErr) {
						if (playBtnWasClicked) throw e;
						document.querySelector("div.jw-icon-display").click();
						playBtnWasClicked = true;
					} else if (e.name === "NotAllowedError") {
						// Muted usually is allowed to play,
						// and if it's not allowed, nothing could be done here
						if (player.muted) {
							console.error("Muted and not allowed");
							throw e;
						}

						if (mainSettings[MAIN_SETTINGS_MAP.shouldAutoplayMuted] && !muteWasApplied) {
							player.muted = true;
							muteWasApplied = true;

							// Restore setting altered by forced mute.
							// See this.setupPersistentVolume()
							setTimeout(() => (coreSettings[CORE_SETTINGS_MAP.isMuted] = false), 250);
							// Should not be awaited
							(async () => {
								await waitForUserInteraction();

								// If interaction was unmute button, try to not overtake it
								// because it might result in mute -> unmute -> mute again.
								// Different players require a different delay
								await sleep(100);

								if (player.muted) player.muted = false;
							})();
						}
					}

					throw e;
				}
			};

			const startTime = Date.now();
			let lastError = null;

			while (Date.now() - startTime < 10 * 1000) {
				try {
					await sleep(200);
					await playOrFix();

					return;
				} catch (e) {
					lastError = e;
				}
			}

			throw lastError;
		}

		async preparePlayer(player) {
			this.setupDoubletapBehavior(player);
			this.setupHotkeys(player);
			if (advancedSettings[ADVANCED_SETTINGS_MAP.showSkipIntroButton]) {
				setupSkipIntroButton(player);
			}

			addTimelineMarkers(player);
			this.setupOutroSkipHandling(player);
			this.setupAutoIntroSkip(player);
			this.setupWatchedStateLabeling(player);
			this.setupVideoPlaybackPositionMemory(player);

			let hasSkippedInitial = false;
			player.addEventListener("timeupdate", function autoStartSkip() {
				if (!hasSkippedInitial && coreSettings[CORE_SETTINGS_MAP.shouldAutoSkipOnStart]) {
					const skipSeconds = Number(coreSettings[CORE_SETTINGS_MAP.autoSkipSecondsOnStart]) || 0;
					if (player.currentTime < skipSeconds) {
						// Soft fade instead of a hard cut while skipping the start
						const fade = document.createElement("div");
						fade.style.cssText =
							"position:fixed;inset:0;background:#000;z-index:99990;opacity:1;transition:opacity 0.8s ease;pointer-events:none;";
						document.body.appendChild(fade);
						setTimeout(() => (fade.style.opacity = "0"), 50);
						setTimeout(() => fade.remove(), 950);
						player.currentTime = skipSeconds;
					}
					hasSkippedInitial = true;
				}
			});
			this.setupPersistentVolume(player);
			this.handleAutoplay(player); // should go after setupPersistentVolume

			// Attach autoplay button and change fullscreen button behavior...
			waitForElement(
				VOEJWPIframeInterface.queries.fullscreenBtn,
				{
					existing: true,
					onceOnly: true,
				},
				(fsBtn) => {
					fsBtn = fsBtn.parentElement;

					const newFsBtn = fsBtn.cloneNode(true);
					const autoplayBtn = this.createAutoplayButton();
					const settingsBtn = this.createSettingsButton();
					const sleepBtn = this.createSleepTimerButton();
					const sleepTimerPane = this.createSleepTimerPane();
					const settingsPane = (this.settingsPane = this.createSettingsPane());

					[autoplayBtn, settingsBtn, sleepBtn].forEach((btn) => {
						btn.style.width = "44px";
						btn.style.height = "44px";
						btn.style.paddingTop = "3px";
						btn.style.flex = "0 0 auto";
						btn.style.outline = "none";
					});

					fsBtn.before(autoplayBtn);
					fsBtn.before(settingsBtn);
					fsBtn.before(sleepBtn);

					IS_SAFARI ? fsBtn.remove() : fsBtn.replaceWith(newFsBtn);

					const toggleSettingsPane = (ev) => {
						ev?.preventDefault();
						ev?.stopImmediatePropagation();

						settingsPane.hidden = !settingsPane.hidden;

						return false;
					};

					// Dedicated gear button: toggle switches autoplay only,
					// the gear opens the settings
					settingsBtn.addEventListener("click", toggleSettingsPane);
					settingsBtn.oncontextmenu = () => false;
					sleepBtn.addEventListener("click", () => sleepTimerPane.toggle());
					sleepBtn.oncontextmenu = () => false;

					if (IS_SAFARI === false) {
						newFsBtn.addEventListener("click", () => {
							this.messenger.sendMessage(IframeMessenger.messages.TOGGLE_FULLSCREEN);
						});
						this.messenger.sendMessage(IframeMessenger.messages.REQUEST_FULLSCREEN_STATE);
					}
				},
			);
		}

		async setupVideoPlaybackPositionMemory(player) {
			const self = this;
			await (async function waitForVideoData(start = Date.now()) {
				if (!self.currentVideoId || !self.topScopeDomainId) {
					if (Date.now() - start > 10 * 1000) {
						throw new Error("Video data didn't arrive in time");
					}

					await sleep();

					return waitForVideoData(start);
				}
			})();
			const timestampDataGMKey = IframeInterface.makePlaybackPositionGMKey(this.topScopeDomainId, this.currentVideoId);
			if (this.builtinPlaybackPositionMemory && this.builtinPlaybackPositionMemory.value) {
				const { expire, value } = this.builtinPlaybackPositionMemory;
				let updateDate = Date.now();

				// 10 days is the built in position memory expiration time
				if (expire) {
					updateDate = new Date(new Date(expire).getTime() - 10 * 24 * 60 * 60 * 1000).getTime();
				}

				GM_setValue(timestampDataGMKey, {
					value,
					updateDate,
				});
			}

			// This has to wait indefinitely because players like VOE do not have the value
			// until the play button has been pressed or an autoplay has been triggered
			await (async function waitForVideoDuration() {
				if (!player.duration) {
					await sleep();
					return waitForVideoDuration();
				}
			})();
			const timestampData = GM_getValue(timestampDataGMKey, {});

			if (timestampData.value) {
				const elapsedTime = Date.now() - timestampData.updateDate;
				const expirationThreshold =
					advancedSettings[ADVANCED_SETTINGS_MAP.playbackPositionExpirationDays] * 24 * 60 * 60 * 1000;
				if (elapsedTime < expirationThreshold) {
					const outroSkipThresholdS = coreSettings[CORE_SETTINGS_MAP.currentOutroSkipThresholdS];
					const potentialTimeLeftToPlay = player.duration - timestampData.value;

					// Skip saved playback position if it's in a range of (outroSkipThresholdS + 20)
					if (potentialTimeLeftToPlay > outroSkipThresholdS + 20) {
						player.currentTime = timestampData.value;
					}
				}
			}

			let lastCheckedTime = player.currentTime;
			setInterval(() => {
				if (!mainSettings[MAIN_SETTINGS_MAP.playbackPositionMemory] || player.currentTime === lastCheckedTime) return;

				lastCheckedTime = player.currentTime;

				GM_setValue(timestampDataGMKey, {
					value: lastCheckedTime,
					updateDate: Date.now(),
				});
			}, 1000);
		}

		updateFullscreenBtn({ isInFullscreen }) {
			const fsBtn = document.querySelector(VOEJWPIframeInterface.queries.fullscreenBtn);
			if (isInFullscreen) {
				fsBtn.parentElement.classList.add("jw-off");
			} else {
				fsBtn.parentElement.classList.remove("jw-off");
			}
		}
	}

	class TopScopeInterface {
		constructor() {
			this.commLink = null;
			this.currentIframeId = null;
			this.domainId = TOP_SCOPE_DOMAINS_IDS[location.hostname] || "";
			this.iframeSrcChangesListener = null;
			this.id = makeId();
			this.ignoreIframeSrcChangeOnce = false;
			this.isPendingConnection = false;
			// Ugly shitcode fix for a playback positions. This assigns their value
			// to both the aniworld and s.to at the same time.
			// This is needed because these prefixes were missing before v4.8.3
			// causing saved positions being shared between different websites
			if (!GM_getValue("playbackPositionsMemory482wereFixed", false)) {
				this.applyPlaybackPositionsFix();
				GM_setValue("playbackPositionsMemory482wereFixed", true);
			}
		}

		static get messages() {
			return {
				CURRENT_FRANCHISE_DATA: "CURRENT_FRANCHISE_DATA",
				FULLSCREEN_STATE: "FULLSCREEN_STATE",
				NAVIGATE_TO: "NAVIGATE_TO",
			};
		}

		static get queries() {
			// New S.to layout detection - check all S.to domains
			const newSto = STO_DOMAINS.includes(location.hostname) && !!document.querySelector("#player-iframe");

			if (newSto) {
				// New S.to layout queries
				return {
					animeTitle: "h1.h2.fw-bold, .breadcrumb-item.show-name a",
					episodeDedicatedLink: null, // Not used in new layout
					episodeTitle: "#player-meta", // Contains data-episode-id
					hostersPlayerContainer: ".player-wrap",
					navLinksContainer: "#episode-nav",
					playerIframe: "#player-iframe",
					providerChangeBtn: "#episode-links .link-box",
					providerName: "#episode-links .link-box", // Provider name is in data-provider-name
					providersList: "#episode-links",
					selectedLanguageBtn: "#episode-links .link-box.active",
					// New S.to specific queries
					nextEpisodeLink: 'a.btn-link[href*="episode"]',
					seasonNav: "[data-season-pill]",
					playerMeta: "#player-meta",
				};
			}

			// Old aniworld.to / legacy S.to layout queries
			return {
				animeTitle: "div.hostSeriesTitle",
				episodeDedicatedLink: "div.hosterSiteVideo a.watchEpisode",
				episodeTitle: "div.hosterSiteTitle",
				hostersPlayerContainer: "div.hosterSiteVideo",
				navLinksContainer: "div#stream.hosterSiteDirectNav",
				playerIframe: "div.inSiteWebStream iframe",
				providerChangeBtn: "div.generateInlinePlayer",
				providerName: "div.hosterSiteVideo > ul a > h4",
				providersList: "div.hosterSiteVideo > ul",
				selectedLanguageBtn: "img.selectedLanguage",
			};
		}

		applyPlaybackPositionsFix() {
			const oldPlaybackPositionsGMPrefix = "playbackTimestamp_";
			const oldPlaybackPositionsKeys = GM_listValues().filter(
				(v) => v.startsWith(oldPlaybackPositionsGMPrefix) && v.split("_").length === 2,
			);
			const uniqueTopScopeDomainsIds = [...new Set(Object.values(TOP_SCOPE_DOMAINS_IDS))];

			for (const oldKey of oldPlaybackPositionsKeys) {
				const episodeId = oldKey.slice(oldPlaybackPositionsGMPrefix.length);
				const oldValue = GM_getValue(oldKey);

				for (const domainId of uniqueTopScopeDomainsIds) {
					const newKey = IframeInterface.makePlaybackPositionGMKey(domainId, episodeId);
					GM_setValue(newKey, oldValue);
				}

				GM_deleteValue(oldKey);
			}
		}

		// It is better not to be async
		handleIframeMessages(packet) {
			(async function () {
				try {
					switch (packet.command) {
						case IframeMessenger.messages.AUTOPLAY_NEXT: {
							// This is here because it bugges out the episodes navigation panel
							// if try and use MARK_CURRENT_VIDEO_WATCHED. Watched episode is being
							// marked as non watched
							try {
								await this.markCurrentVideoWatched();
							} catch (e) {
								console.error(e);
							}

							try {
								await this.goToNextVideo();
							} catch (e) {
								console.error(e);

								Notiflixx.notify.warning(`${GM_info.script.name}: ${i18n.autoplayError}`);
							}

							break;
						}

						case IframeMessenger.messages.REQUEST_CURRENT_FRANCHISE_DATA: {
							let episodeId, releaseYear, title, slug, episodeNumber, seasonNumber;

							// Check if we're on the new S.to layout
							const newStoLayout = isNewStoLayout();

							if (newStoLayout) {
								// New S.to layout
								const playerMeta = document.querySelector("#player-meta");
								episodeId = playerMeta?.dataset.episodeId;
								seasonNumber = playerMeta?.dataset.seasonNo;
								episodeNumber = playerMeta?.dataset.episodeNo;

								// Get title from breadcrumb or h1
								const titleEl =
									document.querySelector(".breadcrumb-item.show-name a") || document.querySelector("h1.h2.fw-bold");
								title = titleEl?.textContent?.trim() || null;

								// Get release year from sidebar if available
								const yearEl = document.querySelector('.text-muted a[href*="/jahr/"]');
								releaseYear = yearEl?.textContent?.trim() || "";

								// Extract slug from URL (new format: /serie/slug-name/staffel-X/episode-Y)
								slug = location.pathname.match(/^\/serie\/([^/]+)/)?.[1] || null;
							} else {
								// Old aniworld.to / legacy S.to layout
								episodeId = document.querySelector(TopScopeInterface.queries.episodeTitle)?.dataset?.episodeId;
								releaseYear = document.querySelector('div.series-title span[itemprop="startDate"]')?.innerText || "";
								title = document.querySelector("div.series-title > h1")?.innerText || null;

								// Extract slug, season, and episode number for AniSkip
								slug = location.pathname.match(/^\/anime\/stream\/([^/]+)/)?.[1] || null;
								episodeNumber = location.pathname.match(/\/episode-(\d+)\b/i)?.[1] || null;
								seasonNumber = location.pathname.match(/\/staffel-(\d+)\b/i)?.[1] || null;
							}

							const currentFranchiseId = title ? `${title}${releaseYear ? `::${releaseYear}` : ""}` : null;

							if (currentFranchiseId || episodeId) {
								this.commLink.commands[TopScopeInterface.messages.CURRENT_FRANCHISE_DATA]({
									currentFranchiseId,
									currentVideoId: episodeId || null,
									topScopeDomainId: this.domainId,
									// Add AniSkip-related data
									animeTitle: title || null,
									animeSlug: slug,
									episodeNumber: episodeNumber ? parseInt(episodeNumber, 10) : null,
									seasonNumber: seasonNumber ? parseInt(seasonNumber, 10) : null,
								});
							}

							break;
						}

						// Would not work on Safari
						// but this should not be called on Safari anyway
						case IframeMessenger.messages.REQUEST_FULLSCREEN_STATE: {
							if (IS_SAFARI) break;
							this.commLink.commands[TopScopeInterface.messages.FULLSCREEN_STATE]({
								isInFullscreen: !!document.fullscreenElement,
							});
							break;
						}

						case IframeMessenger.messages.MARK_CURRENT_VIDEO_WATCHED: {
							await this.markCurrentVideoWatched();
							break;
						}

						case IframeMessenger.messages.OPEN_HOTKEYS_GUIDE: {
							let content = [
								"<h5>🔹 Basic hotkeys</h5>",
								"<div><b>Single key: </b><pre>a</pre> → Triggers when <pre>a</pre> is pressed</div>",
								"<div><b>Combo keys: </b><pre>ctrl + shift + a</pre> → Triggers when all keys are held together</div>",
								"<h5>🔹 Sequences (pressing keys in order)</h5>",
								"<div><b>Sequence: </b><pre>a > b</pre> → Press <pre>a</pre>, then <pre>b</pre></div>",
								"<div><b>Chained sequence: </b><pre>ctrl + a > b</pre> → Hold <pre>ctrl</pre>, press <pre>a</pre>, release, then press <pre>b</pre></div>",
								"<h5>🔹 Multiple options</h5>",
								"<div><pre>a + b > c, x + y > z</pre> → Either <pre>a</pre> & <pre>b</pre> then <pre>c</pre> OR <pre>x</pre> & <pre>y</pre> then <pre>z</pre></div>",
								"<h5>🔹 Special keys (most of them)</h5>",
							].join("");
							content += [
								"cancel",
								"backspace",
								"tab",
								"clear",
								"enter",
								"shift",
								"ctrl",
								"alt",
								"menu",
								"pause",
								"break",
								"capslock",
								"pageup",
								"pagedown",
								"space",
								"spacebar",
								"escape",
								"esc",
								"end",
								"home",
								"left",
								"up",
								"right",
								"down",
								"select",
								"printscreen",
								"execute",
								"snapshot",
								"insert",
								"ins",
								"delete",
								"del",
								"help",
								"scrolllock",
								"scroll",
								"comma",
								",",
								"period",
								".",
								"openbracket",
								"[",
								"backslash",
								"\\",
								"slash",
								"forwardslash",
								"/",
								"closebracket",
								"]",
								"apostrophe",
								"'",
								"zero",
								"0",
								"one",
								"1",
								"two",
								"2",
								"three",
								"3",
								"four",
								"4",
								"five",
								"5",
								"six",
								"6",
								"seven",
								"7",
								"eight",
								"8",
								"nine",
								"9",
								"numzero",
								"num0",
								"numone",
								"num1",
								"numtwo",
								"num2",
								"numthree",
								"num3",
								"numfour",
								"num4",
								"numfive",
								"num5",
								"numsix",
								"num6",
								"numseven",
								"num7",
								"numeight",
								"num8",
								"numnine",
								"num9",
								"nummultiply",
								"num*",
								"numadd",
								"num+",
								"numenter",
								"numsubtract",
								"num-",
								"numdecimal",
								"num.",
								"numdivide",
								"num/",
								"numlock",
								"num",
								"f1",
								"f2",
								"f3",
								"f4",
								"f5",
								"f6",
								"f7",
								"f8",
								"f9",
								"f10",
								"f11",
								"f12",
								"f13",
								"f14",
								"f15",
								"f16",
								"f17",
								"f18",
								"f19",
								"f20",
								"f21",
								"f22",
								"f23",
								"f24",
								"tilde",
								"~",
								"exclamation",
								"exclamationpoint",
								"!",
								"at",
								"@",
								"number",
								"#",
								"dollar",
								"dollars",
								"dollarsign",
								"$",
								"percent",
								"%",
								"caret",
								"^",
								"ampersand",
								"and",
								"&",
								"asterisk",
								"*",
								"openparen",
								"(",
								"closeparen",
								")",
								"underscore",
								"_",
								"plus",
								"+",
								"opencurlybrace",
								"opencurlybracket",
								"{",
								"closecurlybrace",
								"closecurlybracket",
								"}",
								"verticalbar",
								"|",
								"colon",
								":",
								"quotationmark",
								"'",
								"openanglebracket",
								"<",
								"closeanglebracket",
								">",
								"questionmark",
								"?",
								"semicolon",
								";",
								"dash",
								"-",
								"equal",
								"equalsign",
								"=",
							]
								.map((s) => `<pre>${s}</pre>`)
								.join(" ");
							const modal = document.createElement("div");

							modal.className = "notiflix-hotkeys-guide-modal";
							modal.innerHTML = content;
							Notiflixx.report.info(i18n.hotkeysGuide, modal.outerHTML, i18n.close, {
								backOverlayClickToClose: true,
								messageMaxLength: Infinity,
								plainText: false,
							});
							break;
						}

						// Would not work on Safari
						// but this should not be called from Safari anyway
						case IframeMessenger.messages.TOGGLE_FULLSCREEN: {
							if (IS_SAFARI) break;
							// Notice how this then triggers a listener from this.init()
							if (document.fullscreenElement) {
								await document.exitFullscreen();
							} else {
								await document.documentElement.requestFullscreen();
							}

							break;
						}

						case IframeMessenger.messages.TOP_NOTIFLIX_REPORT_INFO: {
							Notiflixx.report.info(...packet.data.args);
							break;
						}

						// Not sure if anything except providersPriority needs to be in sync witn an iframe
						case IframeMessenger.messages.UPDATE_CORE_SETTINGS: {
							coreSettings.update();
							if (typeof refreshVisitedStyle === "function") refreshVisitedStyle();
							break;
						}

						default:
							break;
					}
				} catch (e) {
					console.error(e);
				}
			}).bind(this)();
			return {
				status: `${this.constructor.name} received a message`,
			};
		}

		async init(iframe) {
			this.iframeSrcChangesListener = new MutationObserver((mutations) => {
				for (const mutation of mutations) {
					if (mutation.attributeName === "src") {
						if (this.ignoreIframeSrcChangeOnce) {
							this.ignoreIframeSrcChangeOnce = false;

							return;
						}

						this.unregisterCommlinkListener();
						this.initCrossFrameConnection();
					}
				}
			}).observe(iframe, {
				attributes: true,
			});

			await this.initCrossFrameConnection();

			if (IS_SAFARI) {
				this.adaptFakeFullscreen();
				window.addEventListener("orientationchange", () => {
					setTimeout(() => this.adaptFakeFullscreen(), 100);
				});
			} else {
				document.addEventListener("fullscreenchange", () => {
					this.adaptFakeFullscreen();
					this.commLink.commands[TopScopeInterface.messages.FULLSCREEN_STATE]({
						isInFullscreen: !!document.fullscreenElement,
					});
				});
			}
		}

		async initCrossFrameConnection() {
			if (this.isPendingConnection) throw new Error("Connecting already");
			this.isPendingConnection = true;

			// Drop possibly stale announcements from earlier page loads;
			// a live player frame re-announces itself within a second
			GM_deleteValue("unboundIframeId");

			let timeoutId;

			const iframeId = (this.currentIframeId = await new Promise((resolve, reject) => {
				let settled = false;
				const trySettle = (value) => {
					if (settled || !value) return;

					const iframe = document.querySelector(TopScopeInterface.queries.playerIframe);

					// Skip if top scope is a wrong one
					if (!iframe) return;

					settled = true;
					GM_removeValueChangeListener(valueChangeListenerId);
					clearTimeout(timeoutId);
					resolve(value);
				};
				const valueChangeListenerId = GM_addValueChangeListener("unboundIframeId", (_key, _oldValue, newValue) => {
					trySettle(newValue);
				});

				// Poll as well: TM MV3 change events can get lost between frames
				(async () => {
					for (let i = 0; i < 60 && !settled; i++) {
						await sleep(500);
						trySettle(GM_getValue("unboundIframeId"));
					}
				})();

				timeoutId = setTimeout(() => {
					this.isPendingConnection = false;

					GM_removeValueChangeListener(valueChangeListenerId);
					reject(new Error("Iframe connection timeout"));
				}, 30 * 1000);
			}));
			GM_setValue(iframeId, this.id);

			this.commLink = new CommLinkHandler(this.id, {
				silentMode: true,
				statusCheckInterval: advancedSettings[ADVANCED_SETTINGS_MAP.commlinkPollingIntervalMs],
			});
			this.commLink.registerSendCommand(TopScopeInterface.messages.CURRENT_FRANCHISE_DATA);
			this.commLink.registerSendCommand(TopScopeInterface.messages.FULLSCREEN_STATE);
			this.commLink.registerSendCommand(TopScopeInterface.messages.NAVIGATE_TO);

			this.commLink.registerListener(iframeId, this.handleIframeMessages.bind(this));

			this.isPendingConnection = false;
		}

		adaptFakeFullscreen() {
			const Q = TopScopeInterface.queries;
			const hostersPlayerContainer = document.querySelector(Q.hostersPlayerContainer);
			const playerIframe = document.querySelector(Q.playerIframe);

			if (!hostersPlayerContainer || !playerIframe) return;

			const newStoLayout = isNewStoLayout();

			// Consider landscape mode as fullscreen on Safari
			const isInFullscreen = IS_SAFARI ? window.innerWidth > window.innerHeight : !!document.fullscreenElement;
			if (isInFullscreen) {
				document.body.style.overflow = "hidden";

				if (newStoLayout) {
					// Hide the navbar and other fixed elements during fullscreen
					const navbar = document.querySelector("nav.navbar");
					if (navbar) {
						navbar.dataset.prevDisplay = navbar.style.display;
						navbar.style.display = "none";
					}

					// New S.to layout - ensure container and iframe fill the screen
					hostersPlayerContainer.style.cssText =
						"z-index: 2147483647 !important; position: fixed !important; " +
						"top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important; " +
						"width: 100vw !important; height: 100vh !important; " +
						"padding: 0 !important; margin: 0 !important; " +
						"overflow: hidden !important; background: #000 !important;";
					playerIframe.style.cssText =
						"display: block !important; position: absolute !important; " +
						"top: 0 !important; left: 0 !important; " +
						"width: 100vw !important; height: 100vh !important; " +
						"min-height: 100vh !important; min-width: 100vw !important; " +
						"border: 0 !important; border-width: 0 !important;";
					// Hide the loading overlay
					const loadingOverlay = document.querySelector("#player-loading");
					if (loadingOverlay) {
						loadingOverlay.style.display = "none";
					}
				} else {
					// Old layout
					playerIframe.style.setProperty("height", "100vh", "important");
					if (hostersPlayerContainer.firstElementChild) {
						hostersPlayerContainer.firstElementChild.style.display = "none";
					}
					hostersPlayerContainer.style.cssText =
						"z-index: 100; position: fixed; top: 0; left: 0; padding: 0; height: 100vh; overflow-y: scroll; scrollbar-width: none;";
				}
			} else {
				document.body.style.overflow = "";

				if (newStoLayout) {
					// Restore the navbar
					const navbar = document.querySelector("nav.navbar");
					if (navbar) {
						navbar.style.display = navbar.dataset.prevDisplay || "";
						delete navbar.dataset.prevDisplay;
					}

					// Reset new S.to layout styles - restore proper player dimensions
					hostersPlayerContainer.style.cssText = "";
					// Restore iframe to proper embedded size
					playerIframe.style.cssText = "display: inline-block; min-height: 450px;";

					// Restore loading overlay
					const loadingOverlay = document.querySelector("#player-loading");
					if (loadingOverlay) {
						loadingOverlay.style.display = "";
					}
				} else {
					// Reset old layout styles
					playerIframe.style.height = "";
					if (hostersPlayerContainer.firstElementChild) {
						hostersPlayerContainer.firstElementChild.style.display = "";
					}
					hostersPlayerContainer.scrollTop = 0;
					hostersPlayerContainer.style.cssText = "";
				}
			}
		}

		async announceEpisodeWatched(id) {
			if (!id) throw new Error("Episode ID is missing");
			await fetch(`${location.protocol}//${location.hostname}/ajax/lastseen`, {
				method: "POST",
				body: `episode=${id}`,
				headers: {
					"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
				},
			});
		}

		async goToNextVideo() {
			const Q = TopScopeInterface.queries;
			const newStoLayout = isNewStoLayout();

			let nextEpisodeHref = null;

			if (newStoLayout) {
				// New S.to layout - use the next episode link button
				const nextLinks = [...document.querySelectorAll('a.btn-link[href*="episode"]')];
				const nextLink = nextLinks.find((link) => link.textContent.includes("→"));

				if (nextLink) {
					nextEpisodeHref = nextLink.href;
				} else {
					// Try to find next season's first episode
					const seasonPills = [...document.querySelectorAll("[data-season-pill]")];
					const currentSeasonPill = seasonPills.find((el) => el.classList.contains("bg-primary"));
					const currentIndex = seasonPills.indexOf(currentSeasonPill);

					if (currentIndex >= 0 && currentIndex < seasonPills.length - 1) {
						const nextSeasonHref = seasonPills[currentIndex + 1].href;
						const nextSeasonHtml = await (await fetch(nextSeasonHref)).text();
						const nextSeasonDom = new DOMParser().parseFromString(nextSeasonHtml, "text/html");
						const firstEpisodeLink = nextSeasonDom.querySelector("#episode-nav .nav-link");
						if (firstEpisodeLink) {
							nextEpisodeHref = firstEpisodeLink.href;
						}
					}
				}
			} else {
				// Old aniworld.to / legacy S.to layout
				const [seasonsNav, episodesNav] = document.querySelectorAll(`${Q.navLinksContainer} > ul`);
				const episodesNavLinks = [...episodesNav.querySelectorAll("a")];
				const seasonNavLinks = [...seasonsNav.querySelectorAll("a")];
				const currentEpisodeIndex = episodesNavLinks.findIndex((el) => el.classList.contains("active"));
				const currentSeasonIndex = seasonNavLinks.findIndex((el) => el.classList.contains("active"));

				if (currentEpisodeIndex < episodesNavLinks.length - 1) {
					nextEpisodeHref = episodesNavLinks[currentEpisodeIndex + 1].href;
				} else if (currentSeasonIndex < seasonNavLinks.length - 1) {
					// Do not proceed if this is a last movie
					// so it wont hop in to a season from a movie
					if (seasonNavLinks[currentSeasonIndex].href.endsWith("/filme")) return;
					const nextSeasonHref = seasonNavLinks[currentSeasonIndex + 1].href;
					const nextSeasonHtml = await (await fetch(nextSeasonHref)).text();
					const nextSeasonDom = new DOMParser().parseFromString(nextSeasonHtml, "text/html");
					const firstEpisodeLink = nextSeasonDom.querySelector(`${Q.navLinksContainer} > ul a[data-episode-id]`);
					nextEpisodeHref = firstEpisodeLink.href;
				}
			}

			// Seems like the last episode was reached
			if (!nextEpisodeHref) return;
			const nextEpisodeHtml = await (await fetch(nextEpisodeHref)).text();
			const nextEpisodeDom = new DOMParser().parseFromString(nextEpisodeHtml, "text/html");

			if (newStoLayout) {
				// New S.to layout - update DOM elements
				const elementsToUpdate = [
					"#player-meta",
					"#episode-links",
					"#episode-nav",
					"h1.h2.fw-bold",
					"h2.h4.mb-1", // Episode title
					".background-1.border-radius-top-1", // Top navigation bar with prev/next
				];

				elementsToUpdate.forEach((query) => {
					const currentElement = document.querySelector(query);
					const newElement = nextEpisodeDom.querySelector(query);
					if (currentElement && newElement) {
						currentElement.outerHTML = newElement.outerHTML;
					}
				});
			} else {
				// Old layout - Update current DOM from a next episode DOM
				[
					"div#wrapper > div.seriesContentBox > div.container.marginBottom > ul",
					"div#wrapper > div.seriesContentBox > div.container.marginBottom > div.cf",
					"div.changeLanguageBox",
					`${Q.episodeTitle} > ul`,
					Q.animeTitle,
					Q.episodeTitle,
					Q.navLinksContainer,
					Q.providersList,
				].forEach((query) => {
					const currentElement = document.querySelector(query);
					const newElement = nextEpisodeDom.querySelector(query);

					if (currentElement && newElement) {
						currentElement.outerHTML = newElement.outerHTML;
					}
				});
			}

			document.title = nextEpisodeDom.title;
			history.pushState({}, "", nextEpisodeHref);

			try {
				if (newStoLayout) {
					// New S.to layout - setup provider click handlers
					this.setupNewStoProviderHandlers();

					// Get selected language and find preferred provider
					const selectedLanguage = coreSettings[CORE_SETTINGS_MAP.videoLanguagePreferredID];
					const providerButtons = [...document.querySelectorAll("#episode-links .link-box")];

					// Filter by language if specified
					let filteredButtons = providerButtons;
					if (selectedLanguage) {
						filteredButtons = providerButtons.filter((btn) => btn.dataset.languageId === selectedLanguage);
						if (filteredButtons.length === 0) {
							filteredButtons = providerButtons;
						}
					}

					let nextVideoHref = null;
					let nextProviderName = null;

					// Find preferred provider
					for (const id of coreSettings[CORE_SETTINGS_MAP.providersPriority]) {
						const preferredProviderName = VIDEO_PROVIDERS_IDS[id];
						const matchingBtn = filteredButtons.find((btn) => btn.dataset.providerName === preferredProviderName);
						if (matchingBtn) {
							nextVideoHref = matchingBtn.dataset.playUrl;
							nextProviderName = matchingBtn.dataset.providerName;
							break;
						}
					}

					// Fallback to first available
					if (!nextVideoHref && filteredButtons.length > 0) {
						nextVideoHref = filteredButtons[0].dataset.playUrl;
						nextProviderName = filteredButtons[0].dataset.providerName;
					}

					if (!nextVideoHref) throw new Error("Embedded providers are missing or not supported");

					// Resolve the /r redirect to its final provider URL first: a
					// same-origin frame navigation keeps unmuted autoplay working
					try {
						const resolvedUrl = await new Promise((resolve) => {
							GM_xmlhttpRequest({
								method: "GET",
								url: new URL(nextVideoHref, location.origin).href,
								timeout: 8000,
								onload: (res) => resolve(res.finalUrl || null),
								onerror: () => resolve(null),
								ontimeout: () => resolve(null),
							});
						});
						if (resolvedUrl && /^https?:\/\//i.test(resolvedUrl)) {
							nextVideoHref = resolvedUrl;
						}
					} catch (e) {
						console.error("[Autoplay] Could not resolve redirect target:", e);
					}

					// Prefer letting the player frame navigate itself (keeps the
					// activation chain alive → sound); fall back to a src swap
					const navigatedInside = await this.commLink.commands[TopScopeInterface.messages.NAVIGATE_TO]({
						url: nextVideoHref,
					});

					if (navigatedInside) {
						// New document in the frame: drop the old channel and
						// wait for the new script instance to announce itself
						this.unregisterCommlinkListener();
						this.initCrossFrameConnection().catch(console.error);
					} else {
						document.querySelector("#player-iframe").src = nextVideoHref;
					}
					console.log("[Autoplay] Successfully changed episode to:", nextVideoHref);
				} else {
					// Old layout - The website code copypasta to try and restore various buttons functionality
					(function repairWebsiteFeatures() {
						document.querySelectorAll(Q.providerChangeBtn).forEach((btn) => {
							btn.addEventListener("click", (ev) => {
								ev.preventDefault();

								const parent = btn.parentElement;
								const linkTarget = parent.getAttribute("data-link-target");
								const hosterTarget = parent.getAttribute("data-external-embed") === "true";
								const fakePlayer = document.querySelector(".fakePlayer");
								const inSiteWebStream = document.querySelector(".inSiteWebStream");
								const iframe = inSiteWebStream.querySelector("iframe");

								if (hosterTarget) {
									fakePlayer.style.display = "block";
									inSiteWebStream.style.display = "inline-block";
									iframe.style.display = "none";
								} else {
									fakePlayer.style.display = "none";
									inSiteWebStream.style.display = "inline-block";
									iframe.src = linkTarget;
									iframe.style.display = "inline-block";
								}
							});
						});
					})();

					const { selectedLanguage } = this.updateVideoLanguageProcessing();
					const preferredProvidersButtons = [
						...document.querySelectorAll(TopScopeInterface.queries.providerChangeBtn),
					].filter((el) => el.parentElement.dataset.langKey === selectedLanguage);
					let nextProviderName = null;
					let nextVideoLink = null;

					if (preferredProvidersButtons.length) {
						outer: for (const id of coreSettings[CORE_SETTINGS_MAP.providersPriority]) {
							const preferredProviderName = VIDEO_PROVIDERS_IDS[id];
							for (const btn of preferredProvidersButtons) {
								const link = btn.firstElementChild;
								const providerName = link.querySelector(TopScopeInterface.queries.providerName).innerText;
								if (providerName === preferredProviderName) {
									nextProviderName = providerName;
									nextVideoLink = link;

									break outer;
								}
							}
						}
					}

					let nextVideoHref = nextVideoLink?.href;
					// VOE has an additional redirect page,
					// so need to extract the video href from there first
					// in order to keep VOE-to-VOE autoplay unmuted
					if (nextVideoHref && nextProviderName === VIDEO_PROVIDERS_MAP.VOE) {
						const corsProxy = advancedSettings[ADVANCED_SETTINGS_MAP.corsProxy];

						if (corsProxy) {
							nextVideoHref = /location\.href = '(https:\/\/.+)';/.exec(
								await (await fetch(corsProxy + nextVideoLink.href)).text(),
							)[1];
						}
					}

					if (!nextVideoHref) throw new Error("Embedded providers are missing or not supported");

					try {
						document.querySelector(Q.playerIframe).src = nextVideoHref;
						console.log("[Autoplay] Successfully changed iframe src to:", nextVideoHref);
					} catch (iframeError) {
						console.error("[Autoplay] Error setting iframe src:", iframeError);
						throw iframeError;
					}
				}
			} catch (error) {
				console.error("[Autoplay] Autoplay failed:", error);
				GM_setValue("lastAutoplayError", {
					date: Date.now(),
					error: error.message,
				});
				// At that point, refresh should load the next episode if the website even has it.
				// The problem is it is not seamless
				console.log("[Autoplay] Reloading page due to autoplay error");

				// Exit fullscreen before reload to prevent fullscreen errors
				if (document.fullscreenElement) {
					document
						.exitFullscreen()
						.then(() => {
							location.href = location.href;
						})
						.catch(() => {
							// If exit fullscreen fails, reload anyway
							location.href = location.href;
						});
				} else {
					location.href = location.href;
				}
			}
		}

		async markCurrentVideoWatched() {
			let episodeId;

			if (isNewStoLayout()) {
				// New S.to layout - get episode ID from player-meta
				const playerMeta = document.querySelector("#player-meta");
				episodeId = playerMeta?.dataset?.episodeId;

				if (episodeId) {
					// New S.to uses a different API endpoint
					await this.announceEpisodeWatchedNewSto(episodeId);
				}
			} else {
				// Old layout
				episodeId = document.querySelector(TopScopeInterface.queries.episodeTitle)?.dataset?.episodeId;

				if (episodeId) {
					await this.announceEpisodeWatched(episodeId);
				}
			}
		}

		// New S.to API for marking episodes watched
		async announceEpisodeWatchedNewSto(episodeId) {
			if (!episodeId) throw new Error("Episode ID is missing");

			const playerMeta = document.querySelector("#player-meta");
			const seriesId = playerMeta?.dataset?.seriesId;
			const seasonNo = playerMeta?.dataset?.seasonNo;
			const episodeNo = playerMeta?.dataset?.episodeNo;

			try {
				const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || "";
				await fetch("https://s.to/api/episodes/watched", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"X-CSRF-TOKEN": csrfToken,
						"X-Requested-With": "XMLHttpRequest",
					},
					credentials: "same-origin",
					body: JSON.stringify({
						series_id: Number(seriesId || 0),
						season_no: Number(seasonNo || 0),
						episode_no: Number(episodeNo || 0),
						episode_id: Number(episodeId || 0),
					}),
				});
			} catch (e) {
				console.error("[Autoplay] Failed to mark episode as watched:", e);
			}
		}

		// Setup click handlers for new S.to provider buttons
		setupNewStoProviderHandlers() {
			document.querySelectorAll("#episode-links .link-box").forEach((btn) => {
				// Remove existing listeners by cloning
				const newBtn = btn.cloneNode(true);
				btn.parentNode.replaceChild(newBtn, btn);

				newBtn.addEventListener("click", (ev) => {
					ev.preventDefault();

					// Remove active class from all buttons
					document.querySelectorAll("#episode-links .link-box").forEach((b) => {
						b.classList.remove("active");
					});

					// Add active class to clicked button
					newBtn.classList.add("active");

					// Update iframe src
					const playUrl = newBtn.dataset.playUrl;
					if (playUrl) {
						const iframe = document.querySelector("#player-iframe");
						if (iframe) {
							iframe.src = playUrl;
						}
					}

					// Update player meta suffix
					const metaSuffix = document.querySelector("#player-meta-suffix");
					if (metaSuffix) {
						const lang = newBtn.dataset.languageLabel || "";
						const provider = newBtn.dataset.providerName || "";
						metaSuffix.textContent = `${lang} ${provider}`.trim();
					}
				});
			});
		}

		unregisterCommlinkListener() {
			if (!this.currentIframeId) return;
			this.commLink.listeners = this.commLink.listeners.filter((listener) => {
				if (listener.sender === this.currentIframeId) {
					listener.intervalObj.stop();
					return false;
				}

				return true;
			});

			this.currentIframeId = null;
		}

		// Returns true if the series' country of origin is China.
		isChineseOrigin() {
			const countryEl = document.querySelector('[data-content-type="country"] span[itemprop="name"]');
			return !!(countryEl && countryEl.textContent.trim().toLowerCase() === "china");
		}

		// Replaces japanese-german / japanese-english flag imgs with the pre-built China combo SVGs.
		// Must be called AFTER any outerHTML reset so the attribute change isn't lost.
		applyChineseFlagIfNeeded() {
			if (!this.isChineseOrigin()) return;

			const chineseGerman =
				"data:image/svg+xml;charset=utf-8,%3C%3Fxml%20version%3D%221.0%22%20encoding%3D%22UTF-8%22%3F%3E%0A%3Csvg%20version%3D%221.1%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20xmlns%3Axlink%3D%22http%3A//www.w3.org/1999/xlink%22%20x%3D%220px%22%20y%3D%220px%22%20viewBox%3D%220%200%20512%20336.1%22%20style%3D%22enable-background%3Anew%200%200%20512%20336.1%3B%22%20xml%3Aspace%3D%22preserve%22%3E%0A%3Cdefs%3E%0A%20%20%3CclipPath%20id%3D%22card%22%3E%0A%20%20%20%20%3Cpath%20d%3D%22M473.7%2C0H38.3C17.2%2C0%2C0%2C17.2%2C0%2C38.3v259.5c0%2C21.2%2C17.2%2C38.3%2C38.3%2C38.3h435.3c21.2%2C0%2C38.3-17.2%2C38.3-38.3V38.3C512%2C17.2%2C494.8%2C0%2C473.7%2C0z%22/%3E%0A%20%20%3C/clipPath%3E%0A%20%20%3CclipPath%20id%3D%22leftClip%22%3E%0A%20%20%20%20%3Cpolygon%20points%3D%220%2C0%20390%2C0%20122%2C336.1%200%2C336.1%22/%3E%0A%20%20%3C/clipPath%3E%0A%20%20%3CclipPath%20id%3D%22rightClip%22%3E%0A%20%20%20%20%3Cpolygon%20points%3D%22390%2C0%20512%2C0%20512%2C336.1%20122%2C336.1%22/%3E%0A%20%20%3C/clipPath%3E%0A%20%20%3Cfilter%20id%3D%22seamBlur%22%20x%3D%22-10%25%22%20y%3D%22-10%25%22%20width%3D%22120%25%22%20height%3D%22120%25%22%3E%0A%20%20%20%20%3CfeGaussianBlur%20stdDeviation%3D%2210%22/%3E%0A%20%20%3C/filter%3E%0A%20%20%3C%21--%20Red%20gloss%20gradient%20matching%20original%20style%20but%20red%20instead%20of%20white%20--%3E%0A%20%20%3ClinearGradient%20id%3D%22redGloss%22%20gradientUnits%3D%22userSpaceOnUse%22%20x1%3D%2255%22%20y1%3D%22-32%22%20x2%3D%22457%22%20y2%3D%22369%22%3E%0A%20%20%20%20%3Cstop%20offset%3D%220.54%22%20style%3D%22stop-color%3A%23DE2910%22/%3E%0A%20%20%20%20%3Cstop%20offset%3D%220.71%22%20style%3D%22stop-color%3A%23DE2910%3Bstop-opacity%3A0%22/%3E%0A%20%20%3C/linearGradient%3E%0A%3C/defs%3E%0A%0A%3Cg%20clip-path%3D%22url%28%23card%29%22%3E%0A%20%20%3C%21--%20Left%3A%20China%20flag%20--%3E%0A%20%20%3Cg%20clip-path%3D%22url%28%23leftClip%29%22%3E%0A%20%20%20%20%3Crect%20width%3D%22512%22%20height%3D%22336.1%22%20fill%3D%22%23DE2910%22/%3E%0A%20%20%3C/g%3E%0A%0A%20%20%3C%21--%20Right%3A%20target%20country%20flag%20--%3E%0A%20%20%3Cg%20clip-path%3D%22url%28%23rightClip%29%22%3E%0A%20%20%20%20%3Crect%20width%3D%22512%22%20height%3D%22112%22%20fill%3D%22%23000000%22/%3E%0A%20%20%20%20%3Crect%20y%3D%22112%22%20width%3D%22512%22%20height%3D%22112%22%20fill%3D%22%23DD0000%22/%3E%0A%20%20%20%20%3Crect%20y%3D%22224%22%20width%3D%22512%22%20height%3D%22112.1%22%20fill%3D%22%23FFCC00%22/%3E%0A%20%20%3C/g%3E%0A%0A%20%20%3C%21--%20Red%20gloss%20overlay%20%28same%20shape%20as%20original%20white%20one%2C%20but%20red%29%20--%3E%0A%20%20%3Cpath%20fill%3D%22url%28%23redGloss%29%22%20opacity%3D%220.55%22%20d%3D%22M473.7%2C0H38.3C17.2%2C0%2C0%2C17.2%2C0%2C38.3v259.5c0%2C21.2%2C17.2%2C38.3%2C38.3%2C38.3h435.3c21.2%2C0%2C38.3-17.2%2C38.3-38.3V38.3C512%2C17.2%2C494.8%2C0%2C473.7%2C0z%22/%3E%0A%0A%20%20%3C%21--%20Soft%20seam%20bleed%20--%3E%0A%20%20%3Cpolygon%20points%3D%22365%2C0%20415%2C0%20147%2C336.1%2097%2C336.1%22%20fill%3D%22%23DE2910%22%20opacity%3D%220.15%22%20filter%3D%22url%28%23seamBlur%29%22/%3E%0A%0A%20%20%3C%21--%20Stars%20rendered%20ABOVE%20the%20gradient%20--%3E%0A%20%20%3Cg%20clip-path%3D%22url%28%23leftClip%29%22%3E%0A%20%20%20%20%3C%21--%20Large%20star%20--%3E%0A%20%20%20%20%3Cpolygon%20points%3D%22100%2C44%20111.8%2C79.7%20149.3%2C79.7%20119.8%2C101.3%20130.9%2C137%20100%2C115.4%2069.1%2C137%2080.2%2C101.3%2050.7%2C79.7%2088.2%2C79.7%22%20fill%3D%22%23FFD700%22/%3E%0A%20%20%20%20%3C%21--%20Small%20stars%20--%3E%0A%20%20%20%20%3Cpolygon%20points%3D%22196%2C18%20200.8%2C33.1%20216.5%2C33.1%20203.8%2C41.9%20208.6%2C57%20196%2C48.2%20183.4%2C57%20188.2%2C41.9%20175.5%2C33.1%20191.2%2C33.1%22%20fill%3D%22%23FFD700%22%20transform%3D%22rotate%2810%2C196%2C38%29%22/%3E%0A%20%20%20%20%3Cpolygon%20points%3D%22234%2C52%20238.8%2C67.1%20254.5%2C67.1%20241.8%2C75.9%20246.6%2C91%20234%2C82.2%20221.4%2C91%20226.2%2C75.9%20213.5%2C67.1%20229.2%2C67.1%22%20fill%3D%22%23FFD700%22%20transform%3D%22rotate%2820%2C234%2C72%29%22/%3E%0A%20%20%20%20%3Cpolygon%20points%3D%22236%2C108%20240.8%2C123.1%20256.5%2C123.1%20243.8%2C131.9%20248.6%2C147%20236%2C138.2%20223.4%2C147%20228.2%2C131.9%20215.5%2C123.1%20231.2%2C123.1%22%20fill%3D%22%23FFD700%22/%3E%0A%20%20%20%20%3Cpolygon%20points%3D%22196%2C156%20200.8%2C171.1%20216.5%2C171.1%20203.8%2C179.9%20208.6%2C195%20196%2C186.2%20183.4%2C195%20188.2%2C179.9%20175.5%2C171.1%20191.2%2C171.1%22%20fill%3D%22%23FFD700%22%20transform%3D%22rotate%28-10%2C196%2C176%29%22/%3E%0A%20%20%3C/g%3E%0A%3C/g%3E%0A%3C/svg%3E";
			const chineseEnglish =
				"data:image/svg+xml;charset=utf-8,%3C%3Fxml%20version%3D%221.0%22%20encoding%3D%22UTF-8%22%3F%3E%0A%3Csvg%20version%3D%221.1%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20xmlns%3Axlink%3D%22http%3A//www.w3.org/1999/xlink%22%20x%3D%220px%22%20y%3D%220px%22%20viewBox%3D%220%200%20512%20336.1%22%20style%3D%22enable-background%3Anew%200%200%20512%20336.1%3B%22%20xml%3Aspace%3D%22preserve%22%3E%0A%3Cdefs%3E%0A%20%20%3CclipPath%20id%3D%22card%22%3E%0A%20%20%20%20%3Cpath%20d%3D%22M473.7%2C0H38.3C17.2%2C0%2C0%2C17.2%2C0%2C38.3v259.5c0%2C21.2%2C17.2%2C38.3%2C38.3%2C38.3h435.3c21.2%2C0%2C38.3-17.2%2C38.3-38.3V38.3C512%2C17.2%2C494.8%2C0%2C473.7%2C0z%22/%3E%0A%20%20%3C/clipPath%3E%0A%20%20%3CclipPath%20id%3D%22leftClip%22%3E%0A%20%20%20%20%3Cpolygon%20points%3D%220%2C0%20390%2C0%20122%2C336.1%200%2C336.1%22/%3E%0A%20%20%3C/clipPath%3E%0A%20%20%3CclipPath%20id%3D%22rightClip%22%3E%0A%20%20%20%20%3Cpolygon%20points%3D%22390%2C0%20512%2C0%20512%2C336.1%20122%2C336.1%22/%3E%0A%20%20%3C/clipPath%3E%0A%20%20%3Cfilter%20id%3D%22seamBlur%22%20x%3D%22-10%25%22%20y%3D%22-10%25%22%20width%3D%22120%25%22%20height%3D%22120%25%22%3E%0A%20%20%20%20%3CfeGaussianBlur%20stdDeviation%3D%2210%22/%3E%0A%20%20%3C/filter%3E%0A%20%20%3ClinearGradient%20id%3D%22redGloss%22%20gradientUnits%3D%22userSpaceOnUse%22%20x1%3D%2255%22%20y1%3D%22-32%22%20x2%3D%22457%22%20y2%3D%22369%22%3E%0A%20%20%20%20%3Cstop%20offset%3D%220.54%22%20style%3D%22stop-color%3A%23DE2910%22/%3E%0A%20%20%20%20%3Cstop%20offset%3D%220.71%22%20style%3D%22stop-color%3A%23DE2910%3Bstop-opacity%3A0%22/%3E%0A%20%20%3C/linearGradient%3E%0A%3C/defs%3E%0A%0A%3Cg%20clip-path%3D%22url%28%23card%29%22%3E%0A%20%20%3Cg%20clip-path%3D%22url%28%23leftClip%29%22%3E%0A%20%20%20%20%3Crect%20width%3D%22512%22%20height%3D%22336.1%22%20fill%3D%22%23DE2910%22/%3E%0A%20%20%3C/g%3E%0A%20%20%3Cg%20clip-path%3D%22url%28%23rightClip%29%22%3E%0A%20%20%20%20%3Crect%20width%3D%22512%22%20height%3D%22336.1%22%20fill%3D%22%23B22234%22/%3E%0A%20%20%20%20%3C%21--%20White%20stripes%20%286%20of%20them%29%20--%3E%0A%20%20%20%20%3Crect%20y%3D%2225.9%22%20width%3D%22512%22%20height%3D%2225.9%22%20fill%3D%22%23FFFFFF%22/%3E%0A%20%20%20%20%3Crect%20y%3D%2277.7%22%20width%3D%22512%22%20height%3D%2225.9%22%20fill%3D%22%23FFFFFF%22/%3E%0A%20%20%20%20%3Crect%20y%3D%22129.5%22%20width%3D%22512%22%20height%3D%2225.9%22%20fill%3D%22%23FFFFFF%22/%3E%0A%20%20%20%20%3Crect%20y%3D%22181.3%22%20width%3D%22512%22%20height%3D%2225.9%22%20fill%3D%22%23FFFFFF%22/%3E%0A%20%20%20%20%3Crect%20y%3D%22233.1%22%20width%3D%22512%22%20height%3D%2225.9%22%20fill%3D%22%23FFFFFF%22/%3E%0A%20%20%20%20%3Crect%20y%3D%22284.9%22%20width%3D%22512%22%20height%3D%2225.9%22%20fill%3D%22%23FFFFFF%22/%3E%0A%20%20%20%20%3C%21--%20Blue%20canton%20--%3E%0A%20%20%20%20%3Crect%20width%3D%22204.8%22%20height%3D%22181.3%22%20fill%3D%22%233C3B6E%22/%3E%0A%20%20%3C/g%3E%0A%20%20%3Cpath%20fill%3D%22url%28%23redGloss%29%22%20opacity%3D%220.55%22%20d%3D%22M473.7%2C0H38.3C17.2%2C0%2C0%2C17.2%2C0%2C38.3v259.5c0%2C21.2%2C17.2%2C38.3%2C38.3%2C38.3h435.3c21.2%2C0%2C38.3-17.2%2C38.3-38.3V38.3C512%2C17.2%2C494.8%2C0%2C473.7%2C0z%22/%3E%0A%20%20%3Cpolygon%20points%3D%22365%2C0%20415%2C0%20147%2C336.1%2097%2C336.1%22%20fill%3D%22%23DE2910%22%20opacity%3D%220.15%22%20filter%3D%22url%28%23seamBlur%29%22/%3E%0A%20%20%3Cg%20clip-path%3D%22url%28%23leftClip%29%22%3E%0A%20%20%20%20%3Cpolygon%20points%3D%22100%2C44%20111.8%2C79.7%20149.3%2C79.7%20119.8%2C101.3%20130.9%2C137%20100%2C115.4%2069.1%2C137%2080.2%2C101.3%2050.7%2C79.7%2088.2%2C79.7%22%20fill%3D%22%23FFD700%22/%3E%0A%20%20%20%20%3Cpolygon%20points%3D%22196%2C18%20200.8%2C33.1%20216.5%2C33.1%20203.8%2C41.9%20208.6%2C57%20196%2C48.2%20183.4%2C57%20188.2%2C41.9%20175.5%2C33.1%20191.2%2C33.1%22%20fill%3D%22%23FFD700%22%20transform%3D%22rotate%2810%2C196%2C38%29%22/%3E%0A%20%20%20%20%3Cpolygon%20points%3D%22234%2C52%20238.8%2C67.1%20254.5%2C67.1%20241.8%2C75.9%20246.6%2C91%20234%2C82.2%20221.4%2C91%20226.2%2C75.9%20213.5%2C67.1%20229.2%2C67.1%22%20fill%3D%22%23FFD700%22%20transform%3D%22rotate%2820%2C234%2C72%29%22/%3E%0A%20%20%20%20%3Cpolygon%20points%3D%22236%2C108%20240.8%2C123.1%20256.5%2C123.1%20243.8%2C131.9%20248.6%2C147%20236%2C138.2%20223.4%2C147%20228.2%2C131.9%20215.5%2C123.1%20231.2%2C123.1%22%20fill%3D%22%23FFD700%22/%3E%0A%20%20%20%20%3Cpolygon%20points%3D%22196%2C156%20200.8%2C171.1%20216.5%2C171.1%20203.8%2C179.9%20208.6%2C195%20196%2C186.2%20183.4%2C195%20188.2%2C179.9%20175.5%2C171.1%20191.2%2C171.1%22%20fill%3D%22%23FFD700%22%20transform%3D%22rotate%28-10%2C196%2C176%29%22/%3E%0A%20%20%3C/g%3E%0A%3C/g%3E%0A%3C/svg%3E";

			document.querySelectorAll(".changeLanguageBox img").forEach((img) => {
				const src = img.getAttribute("src") || "";
				const langKey = img.dataset.langKey;
				if (!src.includes("japanese-") && !src.includes("chinese-") && !src.startsWith("data:")) return;

				if (src.includes("-german") || langKey === "3") {
					img.setAttribute("src", chineseGerman);
					img.setAttribute("alt", "Ger-Sub, Deutscher Untertitel, Flagge, Sprache");
				} else if (src.includes("-english") || langKey === "2") {
					img.setAttribute("src", chineseEnglish);
					img.setAttribute("alt", "Englische Sprache, English, Flagge, Sprache");
				}
			});

			// Also swap the per-episode .flag icons in the episode/provider list
			document.querySelectorAll("img.flag").forEach((img) => {
				const src = img.getAttribute("src") || "";
				if (!src.includes("japanese-")) return;

				if (src.includes("-german")) {
					img.setAttribute("src", chineseGerman);
					img.setAttribute("alt", "Deutsche Flagge, Untertitel, Flagge");
				} else if (src.includes("-english")) {
					img.setAttribute("src", chineseEnglish);
					img.setAttribute("alt", "Englische Sprache, Flagge");
				}
			});
		}

		// Partly consist of the website code
		updateVideoLanguageProcessing() {
			// New S.to layout has different language handling
			if (isNewStoLayout()) {
				return this.updateVideoLanguageProcessingNewSto();
			}

			// Old layout
			let changeLanguageButtons = [...document.querySelectorAll(".changeLanguageBox img")];
			let selectedLanguage = coreSettings[CORE_SETTINGS_MAP.videoLanguagePreferredID];
			const availableLangIDs = [...new Set(changeLanguageButtons.map((img) => img.dataset.langKey))];
			// Checks preferred language and if it is missing, it takes first available.
			// Returns if found zero buttons with language IDs
			if (!selectedLanguage || !availableLangIDs.includes(selectedLanguage)) {
				if (availableLangIDs.length) {
					selectedLanguage = availableLangIDs[0];
				} else {
					return null;
				}
			}

			// Hides/unhides providers buttons based on language
			document.querySelectorAll(".hosterSiteVideo ul li[data-lang-key]").forEach((el) => {
				el.style.display = el.dataset.langKey === selectedLanguage ? "block" : "none";
			});
			// Highlights/unhighlights change language buttons
			changeLanguageButtons.forEach((btn) => {
				btn.classList.toggle("selectedLanguage", btn.dataset.langKey === selectedLanguage);
				btn.outerHTML = btn.outerHTML;
			});
			// HTML reset removes the nodes from the DOM so need to get them here once again
			changeLanguageButtons = [...document.querySelectorAll(".changeLanguageBox img")];
			// Apply Chinese flag AFTER outerHTML reset, so setAttribute changes aren't lost
			this.applyChineseFlagIfNeeded();
			changeLanguageButtons.forEach((btn) => {
				btn.addEventListener("click", function () {
					const selectedLanguage = (coreSettings[CORE_SETTINGS_MAP.videoLanguagePreferredID] =
						this.getAttribute("data-lang-key"));

					// Highlights/unhighlights change language buttons
					document.querySelectorAll(".changeLanguageBox img").forEach((btn) => {
						btn.classList.toggle("selectedLanguage", btn.dataset.langKey === selectedLanguage);
					});

					// Hides/unhides providers buttons based on language
					document.querySelectorAll(".hosterSiteVideo ul li[data-lang-key]").forEach((el) => {
						el.style.display = el.dataset.langKey === selectedLanguage ? "block" : "none";
					});

					const preferredProvidersButtons = [
						...document.querySelectorAll(TopScopeInterface.queries.providerChangeBtn),
					].filter((el) => el.parentElement.dataset.langKey === selectedLanguage);
					if (preferredProvidersButtons.length) {
						outer: for (const id of coreSettings[CORE_SETTINGS_MAP.providersPriority]) {
							const preferredProviderName = VIDEO_PROVIDERS_IDS[id];
							for (const btn of preferredProvidersButtons) {
								const providerName = btn.firstElementChild.querySelector(
									TopScopeInterface.queries.providerName,
								).innerText;

								if (providerName === preferredProviderName) {
									btn.click();
									break outer;
								}
							}
						}
					} else {
						document.querySelectorAll(".inSiteWebStream").forEach((el) => {
							el.style.display = "none";
						});
						this.unregisterCommlinkListener();

						if (this.iframeSrcChangesListener) this.ignoreIframeSrcChangeOnce = true;

						document.querySelector(TopScopeInterface.queries.playerIframe).src = "about:blank";
					}
				});
			});

			return {
				selectedLanguage,
			};
		}

		// New S.to layout language processing
		updateVideoLanguageProcessingNewSto() {
			// Replace language flags for Chinese-origin series (new layout)
			this.applyChineseFlagIfNeeded();

			const providerButtons = [...document.querySelectorAll("#episode-links .link-box")];
			let selectedLanguage = coreSettings[CORE_SETTINGS_MAP.videoLanguagePreferredID];

			// Get available language IDs from provider buttons
			const availableLangIDs = [...new Set(providerButtons.map((btn) => btn.dataset.languageId))];

			// Checks preferred language and if it is missing, it takes first available
			if (!selectedLanguage || !availableLangIDs.includes(selectedLanguage)) {
				if (availableLangIDs.length) {
					selectedLanguage = availableLangIDs[0];
				} else {
					return { selectedLanguage: null };
				}
			}

			// Setup click handlers for provider buttons
			this.setupNewStoProviderHandlers();

			return {
				selectedLanguage,
			};
		}
	}

	// If context is top scope
	if (!isEmbedded()) {
		if (!TOP_SCOPE_DOMAINS.includes(location.hostname)) return;

		// Attach autoplay delegation before the player frame's first navigation
		// commits — the attribute only affects navigations started after it
		waitForElement(
			"#player-iframe, div.inSiteWebStream iframe",
			{
				existing: true,
				onceOnly: true,
			},
			(playerFrame) => {
				playerFrame.setAttribute("allow", "autoplay; fullscreen");
			},
		);

		// Wait for DOM first: layout detection needs the parsed page,
		// and TM (MV3) can inject at any readyState
		await new Promise((resolve) => {
			if (["interactive", "complete"].includes(document.readyState)) {
				resolve();
			} else {
				document.addEventListener("DOMContentLoaded", resolve, {
					once: true,
				});
			}
		});

		const newStoLayout = isNewStoLayout();

		// Recolor episodes links visited before, excluding the current or watched
		// ones. Color is user-configurable; the text flips black/white by brightness
		const applyVisitedStyle = () => {
			let styleEl = document.getElementById("gsv2-visited-style");
			if (!mainSettings[MAIN_SETTINGS_MAP.highlightVisitedEpisodes]) {
				styleEl?.remove();
				return;
			}
			const stored = coreSettings[CORE_SETTINGS_MAP.visitedEpisodesColor] || "";
			const color = /^#[0-9a-f]{6}$/i.test(stored) ? stored : "#ffdd00";
			const brightness =
				(parseInt(color.slice(1, 3), 16) * 299 +
					parseInt(color.slice(3, 5), 16) * 587 +
					parseInt(color.slice(5, 7), 16) * 114) /
				1000;
			const textColor = brightness >= 128 ? "#000" : "#fff";
			if (!styleEl) {
				styleEl = document.createElement("style");
				styleEl.id = "gsv2-visited-style";
				(document.head || document.documentElement).appendChild(styleEl);
			}
			styleEl.textContent = newStoLayout
				? `
  #episode-nav .nav-link:visited:not(.bg-primary) {
    background: ${color} !important;
    color: ${textColor} !important;
  }
  `
				: `
  div#stream.hosterSiteDirectNav a[data-episode-id]:visited:not([class]) {
    background: ${color};
    color: ${textColor};
  }
  `;
		};
		applyVisitedStyle();
		refreshVisitedStyle = applyVisitedStyle;
		try {
			const lastAutoplayError = GM_getValue("lastAutoplayError");
			if (lastAutoplayError && Date.now() - lastAutoplayError.date <= 60 * 1000) {
				GM_deleteValue("lastAutoplayError");
				Notiflixx.notify.warning(`${GM_info.script.name}: ${i18n.lastAutoplayError}`);
			}
		} catch (e) {
			console.error(e);
		}

		const topScopeInterface = new TopScopeInterface();

		// Swap flag icons on any page (series overview, season page, episode page)
		// waitForElement ensures we catch flags that render after initial DOM load
		waitForElement(
			"img.flag, .changeLanguageBox img",
			{
				existing: true,
				onceOnly: true,
				callbackOnTimeout: true,
				timeout: 5 * 1000,
			},
			() => topScopeInterface.applyChineseFlagIfNeeded(),
		);

		const iframe = document.querySelector(TopScopeInterface.queries.playerIframe);
		// Not a video page?
		if (!iframe) return;

		// Remove the website logic responsible for marking episodes as watched.
		// since the script would handle it instead. Awaiting is unnecessary
		if (!newStoLayout) {
			// Only needed for old layout
			(async function waitForWatchedFunction(start = Date.now()) {
				if (unsafeWindow.markAsWatched) {
					unsafeWindow.markAsWatched = () => {};
				} else {
					if (Date.now() - start > 10 * 1000) {
						throw new Error("Watched function didn't arrive in time");
					}

					await sleep();

					return waitForWatchedFunction(start);
				}
			})();
		}

		let topInitStarted = false;
		const startTopInit = () => {
			if (topInitStarted) return;
			topInitStarted = true;
			// Delegate autoplay permission to the player frame; without this the
			// browser refuses unmuted playback there on automatic episode switch
			iframe.setAttribute("allow", "autoplay; fullscreen");
			topScopeInterface.init(iframe).catch(console.error);
		};
		iframe.addEventListener("load", startTopInit, {
			once: true,
		});
		// The iframe may have finished loading before this script was injected
		setTimeout(startTopInit, 3000);

		if (newStoLayout) {
			// New S.to layout - wait for provider buttons to be available
			await new Promise((resolve) => {
				waitForElement(
					"#episode-links .link-box",
					{
						existing: true,
						onceOnly: true,
						callbackOnTimeout: true,
						timeout: 10 * 1000,
					},
					resolve,
				);
			});
			await sleep();

			const result = topScopeInterface.updateVideoLanguageProcessing();
			const selectedLanguage = result?.selectedLanguage;

			// Find and click preferred provider for selected language
			const providerButtons = [...document.querySelectorAll("#episode-links .link-box")];

			// Filter by language if set
			let filteredButtons = providerButtons;
			if (selectedLanguage) {
				filteredButtons = providerButtons.filter((btn) => btn.dataset.languageId === selectedLanguage);
				if (filteredButtons.length === 0) {
					filteredButtons = providerButtons;
				}
			}

			// Find preferred provider and click it
			for (const id of coreSettings[CORE_SETTINGS_MAP.providersPriority]) {
				const preferredProviderName = VIDEO_PROVIDERS_IDS[id];
				const matchingBtn = filteredButtons.find((btn) => btn.dataset.providerName === preferredProviderName);
				if (matchingBtn) {
					// Check if it's already active (already loaded)
					if (!matchingBtn.classList.contains("active")) {
						matchingBtn.click();
					}
					return;
				}
			}
		} else {
			// Old layout - Wait for the website main code to finish
			await new Promise((resolve) => {
				waitForElement(
					TopScopeInterface.queries.selectedLanguageBtn,
					{
						existing: true,
						onceOnly: true,
						callbackOnTimeout: true,
						timeout: 10 * 1000,
					},
					resolve,
				);
			});
			await sleep();

			const { selectedLanguage } = topScopeInterface.updateVideoLanguageProcessing();
			const preferredProvidersButtons = [
				...document.querySelectorAll(TopScopeInterface.queries.providerChangeBtn),
			].filter((el) => el.parentElement.dataset.langKey === selectedLanguage);
			if (preferredProvidersButtons.length) {
				for (const id of coreSettings[CORE_SETTINGS_MAP.providersPriority]) {
					const preferredProviderName = VIDEO_PROVIDERS_IDS[id];
					for (const btn of preferredProvidersButtons) {
						const providerName = btn.firstElementChild.querySelector(TopScopeInterface.queries.providerName).innerText;
						if (providerName === preferredProviderName) {
							btn.click();
							return;
						}
					}
				}
			}
		}
	}

	// If context is iframe scope
	else {
		// Runs at document-start now: the DOM builds up after us, and VOE pages
		// may even tear themselves down and rewrite — so keep looking for the
		// player markers instead of checking once
		let isItVOEJWP = false;
		let isItVidoza = false;
		for (let i = 0; i < 150; i++) {
			isItVOEJWP = !!document.querySelector('meta[name="keywords"][content^="VOE"]');
			isItVidoza = !!document.querySelector('meta[content*="Vidoza"]');
			if (isItVOEJWP || isItVidoza) break;
			await sleep(100);
		}
		if ([isItVidoza, isItVOEJWP].every((e) => !e)) {
			return;
		}

		const iframeMessenger = new IframeMessenger();
		for (const { condition, interface: Interface } of [
			{
				condition: isItVidoza,
				interface: VidozaIframeInterface,
			},
			{
				condition: isItVOEJWP,
				interface: VOEJWPIframeInterface,
			},
		]) {
			if (!condition) continue;
			// Call early to get rid of ads and intercept listeners
			const iframeInterface = new Interface(iframeMessenger);
			const bootPlayerSide = async () => {
				// Give a little bit of a time for the TopScopeInterface to prepare
				await sleep(4);
				await iframeMessenger.initCrossFrameConnection();

				waitForElement(
					Interface.queries.player,
					{
						existing: true,
						onceOnly: true,
					},
					async (player) => {
						// Prevent fullscreen triggering by a playback start, on Safari
						player.setAttribute("playsinline", "");
						player.setAttribute("webkit-playsinline", "");

						// Attempt to fix a Safari bug when the video controls get duplicated
						GM_addStyle(`
        video::-webkit-media-controls-panel, video::-webkit-media-controls-play-button, video::-webkit-media-controls-start-playback-button {
          display: none !important;
          -webkit-appearance: none;
          opacity: 0;
          visibility: hidden;
        }
      `);

						await iframeInterface.init(player);
					},
				);
			};
			// Poll instead of a 'load' listener: a page self-rewrite via
			// document.open() wipes window event listeners
			(async () => {
				while (document.readyState !== "complete") {
					await sleep(100);
				}
				bootPlayerSide();
			})();
			break;
		}
	}
})();
