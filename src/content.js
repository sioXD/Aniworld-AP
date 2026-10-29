// VOE AniSkip Content Script
// Integrates AniSkip with VOE.sx's JWPlayer
// Enhanced with language selection, speed control and auto-play

(function () {
	"use strict";

	// Don't run on AniWorld main page - only in iframes
	if (window.location.hostname.includes("aniworld.to")) {
		return;
	}

	// Don't run if we're the top window (not in an iframe)
	// unless directly on a VOE domain
	if (window.self === window.top && !window.location.hostname.includes("voe")) {
		return;
	}

	// Check if this is a VOE player page (has JWPlayer)
	function isVOEPage() {
		if (
			document.querySelector(".jw-video") ||
			document.querySelector(".jw-wrapper") ||
			document.querySelector("#jw-loader")
		) {
			return true;
		}
		if (typeof window.jwplayer === "function") {
			return true;
		}
		if (document.querySelector("video")) {
			return true;
		}
		return false;
	}

	// Wait for VOE player to be ready
	function waitForVOE(callback, maxAttempts = 20) {
		let attempts = 0;
		const check = () => {
			attempts++;
			if (isVOEPage()) {
				callback();
				return;
			}
			if (attempts < maxAttempts) {
				setTimeout(check, 500);
			}
		};
		check();
	}

	// Main extension code
	function runExtension() {
		console.log("VOE AniSkip: Content script running on", window.location.href);

		let state = {
			player: null,
			skipTimes: [],
			currentMalId: null,
			currentEpisode: null,
			currentSeason: null,
			currentVideoId: null,
			settings: { ...DEFAULT_SETTINGS },
			ui: { container: null, skipButton: null, panel: null, nextEpisodeButton: null, syncWithPlayerControls: null },
			nextEpisodeAvailable: false,
			skippedSegments: new Set(),
			pendingSkipConfirm: null,
			skipConfirmTimeout: null,
			initialized: false,
		};

		// Translations object for content script
		const translations = {
			en: {
				typeOpening: "Opening",
				typeEnding: "Ending",
				typeMixedOpening: "Mixed Opening",
				typeMixedEnding: "Mixed Ending",
				typeRecap: "Recap",
				skipButtonText: "Skip",
				nextEpisodeButton: "Next episode",
				panelInitializing: "Initializing...",
				panelAnime: "Anime:",
				panelSeason: "Season:",
				panelEpisode: "Episode:",
				panelMalId: "MAL ID:",
				panelChange: "Change",
				panelSkipSegments: "Skip Segments:",
				panelSearchPlaceholder: "Search anime...",
				panelSearchButton: "Search",
				panelSubmitSkipTime: "Submit Skip Time:",
				panelType: "Type:",
				panelStart: "Start:",
				panelEnd: "End:",
				panelSet: "Set",
				panelSubmit: "Submit",
				panelRefresh: "Refresh",
				panelCancel: "Cancel",
				voteUpvote: "Upvote",
				voteDownvote: "Downvote",
				skipConfirmSave: "Save as $1 with AniSkip?",
				skipConfirmSaving: "Saving...",
				skipConfirmSaved: "Saved!",
				skipConfirmFailed: "Save failed",
				skipConfirmYes: "Save segment",
				skipConfirmNo: "Dismiss",
				statusWaitingForPlayer: "Waiting for video player...",
				statusPlayerFound: "Player found, parsing anime info...",
				statusUsingCached: "Using cached anime info",
				statusSearching: "Searching for anime: $1",
				statusNotFound: 'Anime not found. Click "Change" to search manually.',
				statusCouldNotParse: "Could not parse anime info from title",
				statusFetching: "Fetching skip times...",
				statusNoSkipTimes: "No skip times found for this episode",
				statusFoundSegments: "Found $1 skip segment(s)",
				statusMissingInfo: "Missing anime info",
				statusSubmitting: "Submitting skip time...",
				statusSubmitSuccess: "Skip time submitted successfully!",
				statusSubmitFailed: "Submit failed: $1",
				statusCannotSubmit: "Cannot submit: missing anime info",
				statusInvalidTime: "Invalid time format",
				statusStartBeforeEnd: "Start time must be before end time",
				statusFailedToFetch: "Failed to fetch skip times",
				statusSubmitError: "Failed to submit skip time",
				statusFailedToFind: "Failed to find video player: $1",
				searchLoading: "Searching...",
				searchNoResults: "No results found",
				searchFailed: "Search failed",
			},
			de: {
				typeOpening: "Intro",
				typeEnding: "Outro",
				typeMixedOpening: "Gemischtes Intro",
				typeMixedEnding: "Gemischtes Outro",
				typeRecap: "Zusammenfassung",
				skipButtonText: "Skip",
				nextEpisodeButton: "Nächste Folge",
				panelInitializing: "Initialisierung...",
				panelAnime: "Anime:",
				panelSeason: "Staffel:",
				panelEpisode: "Episode:",
				panelMalId: "MAL ID:",
				panelChange: "Ändern",
				panelSkipSegments: "Skip-Segmente:",
				panelSearchPlaceholder: "Anime suchen...",
				panelSearchButton: "Suchen",
				panelSubmitSkipTime: "Skip-Zeit einreichen:",
				panelType: "Typ:",
				panelStart: "Start:",
				panelEnd: "Ende:",
				panelSet: "Setzen",
				panelSubmit: "Einreichen",
				panelRefresh: "Aktualisieren",
				panelCancel: "Abbrechen",
				voteUpvote: "Positiv bewerten",
				voteDownvote: "Negativ bewerten",
				skipConfirmSave: "$1 bei AniSkip speichern?",
				skipConfirmSaving: "Speichern...",
				skipConfirmSaved: "Gespeichert!",
				skipConfirmFailed: "Speichern fehlgeschlagen",
				skipConfirmYes: "Segment speichern",
				skipConfirmNo: "Verwerfen",
				statusWaitingForPlayer: "Warte auf Video-Player...",
				statusPlayerFound: "Player gefunden, analysiere Anime-Info...",
				statusUsingCached: "Verwende zwischengespeicherte Anime-Info",
				statusSearching: "Suche nach Anime: $1",
				statusNotFound: 'Anime nicht gefunden. Klicke "Ändern" um manuell zu suchen.',
				statusCouldNotParse: "Konnte Anime-Info nicht aus Titel ermitteln",
				statusFetching: "Lade Skip-Zeiten...",
				statusNoSkipTimes: "Keine Skip-Zeiten für diese Episode gefunden",
				statusFoundSegments: "$1 Skip-Segment(e) gefunden",
				statusMissingInfo: "Fehlende Anime-Info",
				statusSubmitting: "Reiche Skip-Zeit ein...",
				statusSubmitSuccess: "Skip-Zeit erfolgreich eingereicht!",
				statusSubmitFailed: "Einreichen fehlgeschlagen: $1",
				statusCannotSubmit: "Kann nicht einreichen: Fehlende Anime-Info",
				statusInvalidTime: "Ungültiges Zeitformat",
				statusStartBeforeEnd: "Startzeit muss vor Endzeit liegen",
				statusFailedToFetch: "Skip-Zeiten konnten nicht abgerufen werden",
				statusSubmitError: "Einreichen der Skip-Zeit fehlgeschlagen",
				statusFailedToFind: "Video-Player nicht gefunden: $1",
				searchLoading: "Suche...",
				searchNoResults: "Keine Ergebnisse gefunden",
				searchFailed: "Suche fehlgeschlagen",
			},
		};

		// Get current language from settings
		function getCurrentLanguage() {
			return state.settings?.language || DEFAULT_SETTINGS.language;
		}

		// i18n helper function - uses stored language setting
		function getMessage(key, fallback) {
			const t = translations[getCurrentLanguage()] || translations.en;
			return t[key] || translations.en[key] || fallback || key;
		}

		// Translate the injected UI. `data-i18n` sets the text, `data-i18n-title`
		// and `data-i18n-placeholder` cover attributes. The English text in the
		// markup doubles as the fallback, so a missing key never blanks an element.
		function applyPanelTranslations(root) {
			if (!root) return;
			root.querySelectorAll("[data-i18n]").forEach((el) => {
				el.textContent = getMessage(el.dataset.i18n, el.textContent);
			});
			root.querySelectorAll("[data-i18n-title]").forEach((el) => {
				el.title = getMessage(el.dataset.i18nTitle, el.title);
			});
			root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
				el.placeholder = getMessage(el.dataset.i18nPlaceholder, el.placeholder);
			});
		}

		// Get SKIP_TYPE_LABELS dynamically based on current language
		function getSkipTypeLabels() {
			return {
				op: getMessage("typeOpening"),
				ed: getMessage("typeEnding"),
				"mixed-op": getMessage("typeMixedOpening"),
				"mixed-ed": getMessage("typeMixedEnding"),
				recap: getMessage("typeRecap"),
			};
		}

		const SKIP_TYPE_LABELS = {
			op: "Opening",
			ed: "Ending",
			"mixed-op": "Mixed Opening",
			"mixed-ed": "Mixed Ending",
			recap: "Recap",
		};

		function isInIframe() {
			try {
				return window.self !== window.top;
			} catch (e) {
				return true;
			}
		}

		async function getAniWorldInfo() {
			try {
				const result = await browser.storage.local.get("aniWorldInfo");
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

		function waitForPlayer(timeout = 2000) {
			return new Promise((resolve, reject) => {
				const startTime = Date.now();
				const check = () => {
					try {
						if (typeof window.jwplayer === "function") {
							const player = window.jwplayer();
							if (player && typeof player.getState === "function" && player.getState()) {
								resolve(player);
								return;
							}
						}
						const videoEl = document.querySelector("video");
						if (videoEl && typeof window.jwplayer === "function") {
							const player = window.jwplayer();
							if (player && player.getContainer) {
								resolve(player);
								return;
							}
						}
					} catch (e) {}

					if (Date.now() - startTime > timeout) {
						const videoEl = document.querySelector("video");
						if (videoEl) {
							resolve(createVideoWrapper(videoEl));
							return;
						}
						reject(new Error("Player not found"));
						return;
					}
					setTimeout(check, 200);
				};
				check();
			});
		}

		function createVideoWrapper(videoEl) {
			return {
				_video: videoEl,
				_listeners: {},
				getState() {
					return videoEl.paused ? "paused" : videoEl.ended ? "complete" : "playing";
				},
				getDuration() {
					return videoEl.duration || 0;
				},
				getPosition() {
					return videoEl.currentTime || 0;
				},
				seek(time) {
					videoEl.currentTime = time;
				},
				play() {
					return videoEl.play();
				},
				pause() {
					videoEl.pause();
				},
				on(event, callback) {
					const eventMap = {
						time: "timeupdate",
						seek: "seeked",
						seeked: "seeked",
						meta: "loadedmetadata",
						complete: "ended",
					};
					videoEl.addEventListener(eventMap[event] || event, callback);
				},
				getContainer() {
					return videoEl.parentElement;
				},
				isNativeWrapper: true,
			};
		}

		// Speed Control
		function changeSpeed(delta) {
			const video = document.querySelector("video");
			if (!video) return;
			let newSpeed = video.playbackRate + delta;
			newSpeed = Math.round(newSpeed / 0.25) * 0.25;
			newSpeed = Math.max(0.25, Math.min(5.0, newSpeed));
			video.playbackRate = newSpeed;
			updateSpeedDisplay();
			savePersistentSpeed(newSpeed);
		}

		function resetSpeed() {
			const video = document.querySelector("video");
			if (!video) return;
			video.playbackRate = 1.0;
			updateSpeedDisplay();
			savePersistentSpeed(1.0);
		}

		function updateSpeedDisplay() {
			const video = document.querySelector("video");
			const display = document.querySelector("#aniskip-speed-display");
			if (!display) return;
			const speed = video ? video.playbackRate : 1.0;
			const formatted = Number.isInteger(speed) ? speed.toFixed(1) : (Math.round(speed * 100) / 100).toString();
			display.textContent = formatted + "x";
		}

		async function loadPersistentSpeed() {
			if (!state.settings.persistentSpeed) return;
			try {
				const result = await browser.storage.local.get("preferredSpeed");
				if (result.preferredSpeed) {
					const video = document.querySelector("video");
					if (video) {
						video.playbackRate = result.preferredSpeed;
						updateSpeedDisplay();
					}
				}
			} catch (e) {}
		}

		async function savePersistentSpeed(speed) {
			if (!state.settings.persistentSpeed) return;
			try {
				await browser.storage.local.set({ preferredSpeed: speed });
			} catch (e) {}
		}

		function updateNextEpisodeButtonLabel() {
			const button = state.ui.nextEpisodeButton;
			if (!button) return;

			const label = getMessage("nextEpisodeButton");
			button.setAttribute("aria-label", label);

			const tooltip = button.querySelector(".jw-text");
			if (tooltip) tooltip.textContent = label;
		}

		// The next episode button is a native JWPlayer control: it is mounted into
		// the control bar directly left of the settings icon, so it inherits the
		// player styling (hover, fullscreen, tooltips) and shrinks the timeline.
		function mountNextEpisodeButton() {
			const button = state.ui.nextEpisodeButton;
			if (!button) return;

			// Only touch the player's control bar while the feature is enabled.
			if (state.settings.showNextEpisodeButton === false) {
				if (state.ui.container && button.parentNode !== state.ui.container) {
					state.ui.container.appendChild(button);
				}
				return;
			}

			const settingsButton = document.querySelector(
				'.jw-settings-submenu-button.jw-icon-settings, .jw-icon-settings[aria-label="Settings"]',
			);
			if (!settingsButton || !settingsButton.parentNode) return;

			if (button.parentNode !== settingsButton.parentNode || button.nextElementSibling !== settingsButton) {
				settingsButton.parentNode.insertBefore(button, settingsButton);
			}
		}

		function shouldShowNextEpisodeButton() {
			const button = state.ui.nextEpisodeButton;
			const mounted = button && button.closest(".jw-controlbar");
			return !!mounted && state.nextEpisodeAvailable && state.settings.showNextEpisodeButton !== false;
		}

		function setNextEpisodeAvailability(available) {
			state.nextEpisodeAvailable = available === true;

			const button = state.ui.nextEpisodeButton;
			if (button) {
				const visible = shouldShowNextEpisodeButton();
				button.classList.toggle("aniskip-hidden", !visible);
				button.setAttribute("aria-hidden", String(!visible));
				updateNextEpisodeButtonLabel();
			}

			if (state.ui.syncWithPlayerControls) {
				state.ui.syncWithPlayerControls();
			}
		}

		// Create UI
		function createUI() {
			const existing = document.getElementById("aniskip-container");
			if (existing) existing.remove();

			// The next episode button lives inside the player control bar and is not
			// removed with the container, so clean it up explicitly.
			const existingNextButton = document.getElementById("aniskip-next-episode-btn");
			if (existingNextButton) existingNextButton.remove();

			const container = document.createElement("div");
			container.id = "aniskip-container";

			// Apply theme class based on settings
			const theme = state.settings?.uiTheme || DEFAULT_SETTINGS.uiTheme;
			container.className = `theme-${theme}`;

			container.innerHTML = `
      <div id="aniskip-skip-button" class="aniskip-button aniskip-hidden">
        <span class="aniskip-skip-text" data-i18n="skipButtonText">Skip</span>
        <span class="aniskip-skip-type"></span>
        <span id="aniskip-skip-confirm" class="aniskip-skip-confirm aniskip-hidden">
          <button id="aniskip-confirm-yes" class="aniskip-confirm-btn" title="Save" data-i18n-title="skipConfirmYes">&#10003;</button>
          <span class="aniskip-skip-confirm-text"></span>
          <button id="aniskip-confirm-no" class="aniskip-confirm-btn" title="Dismiss" data-i18n-title="skipConfirmNo">&#10007;</button>
          <span class="aniskip-skip-confirm-bar">
            <span class="aniskip-skip-confirm-bar-fill"></span>
          </span>
        </span>
      </div>
      <div id="aniskip-panel" class="aniskip-hidden">
        <div class="aniskip-panel-header">
          <span class="aniskip-brand"><span class="aniskip-brand-ani">Ani</span><span class="aniskip-brand-world">World</span> <span class="aniskip-brand-ap">AP [fork]</span></span>
          <button id="aniskip-close-panel" class="aniskip-icon-btn">×</button>
        </div>
        <div class="aniskip-panel-content">
          <div id="aniskip-status">Initializing...</div>
          <div id="aniskip-anime-info" class="aniskip-hidden">
            <div class="aniskip-info-row"><span class="aniskip-label" data-i18n="panelAnime">Anime:</span><span id="aniskip-anime-name">-</span></div>
            <div class="aniskip-info-row"><span class="aniskip-label" data-i18n="panelSeason">Season:</span><span id="aniskip-season-num">-</span></div>
            <div class="aniskip-info-row"><span class="aniskip-label" data-i18n="panelEpisode">Episode:</span><span id="aniskip-episode-num">-</span></div>
            <div class="aniskip-info-row"><span class="aniskip-label" data-i18n="panelMalId">MAL ID:</span><span id="aniskip-mal-id">-</span><button id="aniskip-change-anime" class="aniskip-small-btn" data-i18n="panelChange">Change</button></div>
          </div>
          <div id="aniskip-segments" class="aniskip-hidden">
            <div class="aniskip-label" data-i18n="panelSkipSegments">Skip Segments:</div>
            <div id="aniskip-segments-list"></div>
          </div>
          <div id="aniskip-search-panel" class="aniskip-hidden">
            <input type="text" id="aniskip-search-input" placeholder="Search anime..." data-i18n-placeholder="panelSearchPlaceholder">
            <button id="aniskip-search-btn" class="aniskip-btn" data-i18n="panelSearchButton">Search</button>
            <div id="aniskip-search-results"></div>
          </div>
          <div id="aniskip-submit-panel" class="aniskip-hidden">
            <div class="aniskip-label" data-i18n="panelSubmitSkipTime">Submit Skip Time:</div>
            <div class="aniskip-form-row"><label data-i18n="panelType">Type:</label><select id="aniskip-submit-type"><option value="op" data-i18n="typeOpening">Opening</option><option value="ed" data-i18n="typeEnding">Ending</option><option value="recap" data-i18n="typeRecap">Recap</option></select></div>
            <div class="aniskip-form-row"><label data-i18n="panelStart">Start:</label><input type="text" id="aniskip-submit-start" placeholder="0:00"><button id="aniskip-set-start" class="aniskip-small-btn" data-i18n="panelSet">Set</button></div>
            <div class="aniskip-form-row"><label data-i18n="panelEnd">End:</label><input type="text" id="aniskip-submit-end" placeholder="1:30"><button id="aniskip-set-end" class="aniskip-small-btn" data-i18n="panelSet">Set</button></div>
            <button id="aniskip-submit-btn" class="aniskip-btn" data-i18n="panelSubmit">Submit</button>
          </div>
        </div>
        <div class="aniskip-panel-footer">
          <button id="aniskip-toggle-submit" class="aniskip-footer-btn"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> <span data-i18n="panelSubmit">Submit</span></button>
          <button id="aniskip-refresh" class="aniskip-footer-btn"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg> <span data-i18n="panelRefresh">Refresh</span></button>
        </div>
      </div>
      <div id="aniskip-next-episode-btn" class="jw-icon jw-icon-inline jw-button-color jw-reset aniskip-next-episode-btn aniskip-hidden" role="button" tabindex="0" aria-label="Next episode" aria-hidden="true">
        <svg class="jw-svg-icon aniskip-next-episode-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" focusable="false" aria-hidden="true"><path d="M40 45 L160 120 L40 195 Z"></path><rect x="176" y="45" width="28" height="150"></rect></svg>
        <div class="jw-reset-text jw-tooltip aniskip-next-episode-tooltip" dir="auto"><div class="jw-text">Next episode</div></div>
      </div>
      <button id="aniskip-toggle-btn" class="aniskip-toggle-btn" type="button" title="AniSkip">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      </button>
      <div id="aniskip-speed-control" class="aniskip-speed-control aniskip-hidden">
        <button id="aniskip-speed-minus" class="aniskip-speed-btn">−</button>
        <button id="aniskip-speed-display" class="aniskip-speed-display">1.0x</button>
        <button id="aniskip-speed-plus" class="aniskip-speed-btn">+</button>
      </div>
    `;

			applyPanelTranslations(container);
			// The status line is owned by updateStatus(), so it is translated here
			// instead of via data-i18n - otherwise a settings change would wipe it.
			container.querySelector("#aniskip-status").textContent = getMessage("panelInitializing");

			// Try to append to JWPlayer container first (for fullscreen support), fallback to body
			const jwContainer = document.querySelector(".jw-wrapper") || document.querySelector(".jwplayer");
			if (jwContainer) {
				jwContainer.appendChild(container);
			} else {
				document.body.appendChild(container);
			}

			state.ui.container = container;
			state.ui.skipButton = container.querySelector("#aniskip-skip-button");
			state.ui.panel = container.querySelector("#aniskip-panel");
			state.ui.nextEpisodeButton = container.querySelector("#aniskip-next-episode-btn");
			updateNextEpisodeButtonLabel();
			mountNextEpisodeButton();

			// Watch for fullscreen changes and move UI accordingly
			function handleFullscreenChange() {
				const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
				if (fullscreenElement) {
					// Move UI into fullscreen element
					if (!fullscreenElement.contains(container)) {
						fullscreenElement.appendChild(container);
					}
				} else {
					// Move UI back to JWPlayer container or body
					const jwContainer = document.querySelector(".jw-wrapper") || document.querySelector(".jwplayer");
					if (jwContainer && !jwContainer.contains(container)) {
						jwContainer.appendChild(container);
					} else if (!document.body.contains(container)) {
						document.body.appendChild(container);
					}
				}
			}

			document.addEventListener("fullscreenchange", handleFullscreenChange);
			document.addEventListener("webkitfullscreenchange", handleFullscreenChange);

			function syncWithPlayerControls() {
				const toggleBtn = container.querySelector("#aniskip-toggle-btn");
				const skipBtn = state.ui.skipButton;
				const speedControl = container.querySelector("#aniskip-speed-control");
				const nextEpisodeBtn = state.ui.nextEpisodeButton;
				const playerContainer = document.querySelector(".jw-wrapper, .jwplayer");
				const controlsHidden = playerContainer && playerContainer.classList.contains("jw-flag-user-inactive");
				const controlbar = document.querySelector(".jw-controlbar");
				const controlbarHidden = controlbar && window.getComputedStyle(controlbar).opacity === "0";
				const shouldHide = controlsHidden || controlbarHidden;

				mountNextEpisodeButton();

				if (nextEpisodeBtn) {
					const showNext = shouldShowNextEpisodeButton();
					nextEpisodeBtn.classList.toggle("aniskip-hidden", !showNext);
					nextEpisodeBtn.setAttribute("aria-hidden", String(!showNext));
				}

				if (!state.ui.panel.classList.contains("aniskip-hidden")) {
					toggleBtn.classList.remove("aniskip-controls-hidden");
					skipBtn.classList.remove("aniskip-controls-hidden");
					if (speedControl) speedControl.classList.remove("aniskip-controls-hidden");
					return;
				}

				if (shouldHide) {
					toggleBtn.classList.add("aniskip-controls-hidden");
					skipBtn.classList.add("aniskip-controls-hidden");
					if (speedControl) speedControl.classList.add("aniskip-controls-hidden");
				} else {
					toggleBtn.classList.remove("aniskip-controls-hidden");
					skipBtn.classList.remove("aniskip-controls-hidden");
					if (speedControl) speedControl.classList.remove("aniskip-controls-hidden");
				}
			}

			state.ui.syncWithPlayerControls = syncWithPlayerControls;
			syncWithPlayerControls();
			setInterval(syncWithPlayerControls, 200);
			document.addEventListener("mousemove", syncWithPlayerControls);

			container
				.querySelector("#aniskip-toggle-btn")
				.addEventListener("click", () => state.ui.panel.classList.toggle("aniskip-hidden"));
			state.ui.nextEpisodeButton.addEventListener("click", (event) => {
				event.stopPropagation();
				requestNextEpisode(true);
			});
			container
				.querySelector("#aniskip-close-panel")
				.addEventListener("click", () => state.ui.panel.classList.add("aniskip-hidden"));
			container.querySelector("#aniskip-skip-button").addEventListener("click", skipCurrent);
			container.querySelector("#aniskip-confirm-yes").addEventListener("click", (e) => {
				e.stopPropagation();
				handleSkipConfirm(true);
			});
			container.querySelector("#aniskip-confirm-no").addEventListener("click", (e) => {
				e.stopPropagation();
				handleSkipConfirm(false);
			});
			container
				.querySelector("#aniskip-change-anime")
				.addEventListener("click", () =>
					document.querySelector("#aniskip-search-panel").classList.toggle("aniskip-hidden"),
				);
			container.querySelector("#aniskip-search-btn").addEventListener("click", searchAnime);
			container.querySelector("#aniskip-search-input").addEventListener("keypress", (e) => {
				if (e.key === "Enter") searchAnime();
			});

			// Prevent keyboard events on input fields from being hijacked by the video
			// player (JWPlayer uses space to play/pause and number keys 1-9 to seek).
			// A window capture-phase listener runs before the player's document-level
			// handlers and stops propagation for keys typed into our inputs, while the
			// default text insertion (no preventDefault) still works.
			const isInsideContainer = (e) => e.target && container.contains(e.target);
			const isNextEpisodeButton = (e) =>
				e.target &&
				state.ui.nextEpisodeButton &&
				(e.target === state.ui.nextEpisodeButton || state.ui.nextEpisodeButton.contains(e.target));

			window.addEventListener(
				"keydown",
				(e) => {
					if (isNextEpisodeButton(e)) {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							requestNextEpisode(true);
						}
						e.stopPropagation();
						return;
					}
					if (!isInsideContainer(e)) return;
					if (e.key === "Enter" && e.target.id === "aniskip-search-input") searchAnime();
					e.stopPropagation();
				},
				true,
			);
			window.addEventListener(
				"keypress",
				(e) => {
					if (isInsideContainer(e) || isNextEpisodeButton(e)) e.stopPropagation();
				},
				true,
			);
			window.addEventListener(
				"keyup",
				(e) => {
					if (isInsideContainer(e) || isNextEpisodeButton(e)) e.stopPropagation();
				},
				true,
			);
			container.querySelector("#aniskip-toggle-submit").addEventListener("click", () => {
				const submitPanel = document.querySelector("#aniskip-submit-panel");
				const toggleBtn = container.querySelector("#aniskip-toggle-submit");
				const isHidden = submitPanel.classList.contains("aniskip-hidden");
				submitPanel.classList.toggle("aniskip-hidden");

				// Update button text and style
				const cancelText = getMessage("panelCancel");
				const submitText = getMessage("panelSubmit");
				if (isHidden) {
					toggleBtn.textContent = "";
					toggleBtn.insertAdjacentHTML(
						"beforeend",
						'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
					);
					toggleBtn.appendChild(document.createTextNode(" " + cancelText));
					toggleBtn.classList.add("aniskip-toggle-active");
					setTimeout(() => {
						submitPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
					}, 50);
				} else {
					toggleBtn.textContent = "";
					toggleBtn.insertAdjacentHTML(
						"beforeend",
						'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
					);
					toggleBtn.appendChild(document.createTextNode(" " + submitText));
					toggleBtn.classList.remove("aniskip-toggle-active");
				}
			});
			container.querySelector("#aniskip-set-start").addEventListener("click", () => setTimeFromPlayer("start"));
			container.querySelector("#aniskip-set-end").addEventListener("click", () => setTimeFromPlayer("end"));
			container.querySelector("#aniskip-submit-btn").addEventListener("click", submitSkipTime);
			container.querySelector("#aniskip-refresh").addEventListener("click", refreshSkipTimes);
			container.querySelector("#aniskip-speed-minus").addEventListener("click", () => changeSpeed(-0.25));
			container.querySelector("#aniskip-speed-plus").addEventListener("click", () => changeSpeed(0.25));
			container.querySelector("#aniskip-speed-display").addEventListener("click", resetSpeed);

			if (state.settings.showSpeedControl) {
				container.querySelector("#aniskip-speed-control").classList.remove("aniskip-hidden");
			}

			return container;
		}

		function updateStatus(message, isError = false) {
			const statusEl = document.querySelector("#aniskip-status");
			if (statusEl) {
				statusEl.textContent = message;
				statusEl.className = isError ? "aniskip-error" : "";
			}
			console.log("VOE AniSkip:", message);
		}

		async function searchAnime() {
			const input = document.querySelector("#aniskip-search-input");
			const query = input.value.trim();
			if (!query) return;

			const resultsEl = document.querySelector("#aniskip-search-results");
			resultsEl.textContent = "";
			const loadingDiv = document.createElement("div");
			loadingDiv.className = "aniskip-loading";
			loadingDiv.textContent = getMessage("searchLoading");
			resultsEl.appendChild(loadingDiv);

			try {
				const results = await browser.runtime.sendMessage({ action: "searchAnime", query });
				if (!results || results.length === 0) {
					resultsEl.textContent = "";
					const noResultsDiv = document.createElement("div");
					noResultsDiv.className = "aniskip-no-results";
					noResultsDiv.textContent = getMessage("searchNoResults");
					resultsEl.appendChild(noResultsDiv);
					return;
				}

				resultsEl.textContent = "";
				const fragment = document.createDocumentFragment();
				results.slice(0, 5).forEach((anime) => {
					const resultDiv = document.createElement("div");
					resultDiv.className = "aniskip-search-result";
					resultDiv.dataset.malId = String(anime.mal_id);
					resultDiv.dataset.title = anime.title;

					const img = document.createElement("img");
					img.src = anime.images?.jpg?.small_image_url || "";
					img.alt = "";
					resultDiv.appendChild(img);

					const infoDiv = document.createElement("div");
					infoDiv.className = "aniskip-result-info";

					const titleDiv = document.createElement("div");
					titleDiv.className = "aniskip-result-title";
					titleDiv.textContent = anime.title;
					infoDiv.appendChild(titleDiv);

					const metaDiv = document.createElement("div");
					metaDiv.className = "aniskip-result-meta";
					metaDiv.textContent = (anime.type || "") + " • " + (anime.episodes || "?") + " eps";
					infoDiv.appendChild(metaDiv);

					resultDiv.appendChild(infoDiv);
					fragment.appendChild(resultDiv);
				});
				resultsEl.appendChild(fragment);

				resultsEl.querySelectorAll(".aniskip-search-result").forEach((el) => {
					el.addEventListener("click", () => selectAnime(parseInt(el.dataset.malId), el.dataset.title));
				});
			} catch (error) {
				resultsEl.textContent = "";
				const errorDiv = document.createElement("div");
				errorDiv.className = "aniskip-error";
				errorDiv.textContent = getMessage("searchFailed");
				resultsEl.appendChild(errorDiv);
			}
		}

		function escapeHtml(text) {
			const div = document.createElement("div");
			div.textContent = text;
			return div.innerHTML;
		}

		async function selectAnime(malId, title) {
			state.currentMalId = malId;
			document.querySelector("#aniskip-anime-name").textContent = title;
			document.querySelector("#aniskip-mal-id").textContent = malId;
			document.querySelector("#aniskip-search-panel").classList.add("aniskip-hidden");
			document.querySelector("#aniskip-anime-info").classList.remove("aniskip-hidden");

			const animeInfo = parseAnimeInfo();
			if (animeInfo) {
				await browser.runtime.sendMessage({
					action: "setAnimeCache",
					cache: { [animeInfo.animeName.toLowerCase()]: { malId, title } },
				});
			}
			await fetchSkipTimes();
		}

		async function fetchSkipTimes() {
			if (!state.currentMalId || !state.currentEpisode) {
				updateStatus(getMessage("statusMissingInfo"));
				return;
			}

			updateStatus(getMessage("statusFetching"));

			try {
				const response = await browser.runtime.sendMessage({
					action: "getSkipTimes",
					malId: state.currentMalId,
					episodeNumber: state.currentEpisode,
					episodeLength: state.player?.getDuration() || 0,
				});

				if (response.error) {
					updateStatus(`Error: ${response.error}`, true);
					return;
				}

				if (!response.found || !response.results || response.results.length === 0) {
					updateStatus(getMessage("statusNoSkipTimes"));
					state.skipTimes = [];
				} else {
					state.skipTimes = response.results;
					updateStatus(getMessage("statusFoundSegments").replace("$1", state.skipTimes.length));
					renderSegments();
					addProgressBarMarkers();
				}
			} catch (error) {
				updateStatus(getMessage("statusFailedToFetch"), true);
			}
		}

		function renderSegments() {
			const segmentsEl = document.querySelector("#aniskip-segments");
			const listEl = document.querySelector("#aniskip-segments-list");

			if (state.skipTimes.length === 0) {
				segmentsEl.classList.add("aniskip-hidden");
				return;
			}

			segmentsEl.classList.remove("aniskip-hidden");
			const upvoteTitle = getMessage("voteUpvote");
			const downvoteTitle = getMessage("voteDownvote");
			const skipTypeLabels = getSkipTypeLabels();
			listEl.textContent = "";
			const fragment = document.createDocumentFragment();
			state.skipTimes.forEach((segment) => {
				const label = skipTypeLabels[segment.skipType] || segment.skipType;

				const segmentDiv = document.createElement("div");
				segmentDiv.className = "aniskip-segment";
				segmentDiv.dataset.skipId = segment.skipId;

				const typeSpan = document.createElement("span");
				typeSpan.className = "aniskip-segment-type";
				typeSpan.textContent = label;
				segmentDiv.appendChild(typeSpan);

				const timeSpan = document.createElement("span");
				timeSpan.className = "aniskip-segment-time";
				timeSpan.textContent = formatTime(segment.interval.startTime) + " - " + formatTime(segment.interval.endTime);
				segmentDiv.appendChild(timeSpan);

				const voteDiv = document.createElement("div");
				voteDiv.className = "aniskip-vote-btns";

				const upBtn = document.createElement("button");
				upBtn.className = "aniskip-vote-btn aniskip-upvote";
				upBtn.dataset.vote = "upvote";
				upBtn.title = upvoteTitle;
				upBtn.textContent = "👍";
				voteDiv.appendChild(upBtn);

				const downBtn = document.createElement("button");
				downBtn.className = "aniskip-vote-btn aniskip-downvote";
				downBtn.dataset.vote = "downvote";
				downBtn.title = downvoteTitle;
				downBtn.textContent = "👎";
				voteDiv.appendChild(downBtn);

				segmentDiv.appendChild(voteDiv);
				fragment.appendChild(segmentDiv);
			});
			listEl.appendChild(fragment);

			listEl.querySelectorAll(".aniskip-vote-btn").forEach((btn) => {
				btn.addEventListener("click", async (e) => {
					const segment = e.target.closest(".aniskip-segment");
					try {
						await browser.runtime.sendMessage({
							action: "voteSkipTime",
							skipId: segment.dataset.skipId,
							voteType: e.target.dataset.vote,
						});
						e.target.classList.add("aniskip-voted");
					} catch (error) {}
				});
			});
		}

		// Helper function to convert hex color to rgba
		function hexToRgba(hex, opacity) {
			const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
			if (result) {
				const r = parseInt(result[1], 16);
				const g = parseInt(result[2], 16);
				const b = parseInt(result[3], 16);
				return `rgba(${r}, ${g}, ${b}, ${opacity})`;
			}
			return `rgba(255, 0, 251, ${opacity})`; // Default fallback
		}

		// Add CUSTOMIZABLE markers to progress bar
		function addProgressBarMarkers() {
			document.querySelectorAll(".aniskip-marker").forEach((el) => el.remove());
			if (!state.player || state.skipTimes.length === 0) return;

			const duration = state.player.getDuration();
			if (!duration) return;

			const progressBar =
				document.querySelector(".jw-slider-time .jw-slider-container") ||
				document.querySelector(".jw-slider-time") ||
				document.querySelector(".jw-progress");
			if (!progressBar) {
				console.log("VOE AniSkip: Progress bar not found");
				return;
			}

			// Ensure relative positioning
			const computedStyle = window.getComputedStyle(progressBar);
			if (computedStyle.position === "static") {
				progressBar.style.position = "relative";
			}

			// Get colors from settings
			const opacity = state.settings.markerOpacity || DEFAULT_SETTINGS.markerOpacity;
			const colorOp = hexToRgba(state.settings.markerColorOp || DEFAULT_SETTINGS.markerColorOp, opacity);
			const colorEd = hexToRgba(state.settings.markerColorEd || DEFAULT_SETTINGS.markerColorEd, opacity);
			const colorRecap = hexToRgba(state.settings.markerColorRecap || DEFAULT_SETTINGS.markerColorRecap, opacity);

			state.skipTimes.forEach((segment) => {
				const startPercent = (segment.interval.startTime / duration) * 100;
				const width = ((segment.interval.endTime - segment.interval.startTime) / duration) * 100;

				// Determine color based on skip type
				let bgColor;
				if (segment.skipType === "op" || segment.skipType === "mixed-op") {
					bgColor = colorOp;
				} else if (segment.skipType === "ed" || segment.skipType === "mixed-ed") {
					bgColor = colorEd;
				} else if (segment.skipType === "recap") {
					bgColor = colorRecap;
				} else {
					bgColor = colorOp; // Default
				}

				const marker = document.createElement("div");
				marker.className = `aniskip-marker aniskip-marker-${segment.skipType}`;
				marker.style.cssText = `
        position: absolute;
        left: ${startPercent}%;
        width: ${width}%;
        top: 30%;
        height: 40%;
        pointer-events: none;
        z-index: 100;
        border-radius: 2px;
        background-color: ${bgColor};
      `;
				const skipTypeLabels = getSkipTypeLabels();
				marker.title = `${skipTypeLabels[segment.skipType] || segment.skipType}: ${formatTime(segment.interval.startTime)} - ${formatTime(segment.interval.endTime)}`;
				progressBar.appendChild(marker);
			});
		}

		// Seek to a target position without interrupting playback.
		// Pausing before the seek caused a visible freeze after every skip, because
		// playback only resumed once 'seeked' fired (or after the 2s fallback).
		// Instead we seek while the player keeps its play state and only force play
		// as a recovery measure if the player actually dropped out of playback.
		function seekPlayer(time) {
			if (!state.player) return;

			let wasPlaying = false;
			try {
				const playerState = state.player.getState ? state.player.getState() : null;
				wasPlaying = playerState === "playing" || playerState === "buffering";
			} catch (e) {}

			const shouldPlay = wasPlaying;

			let target = time;
			try {
				const duration = state.player.getDuration();
				if (duration && target > duration) target = duration;
				if (target < 0) target = 0;
			} catch (e) {}

			let playbackConfirmed = false;

			const isPlaying = () => {
				try {
					const playerState = state.player && state.player.getState ? state.player.getState() : null;
					return playerState === "playing" || playerState === "buffering";
				} catch (e) {
					return false;
				}
			};

			const ensurePlayback = () => {
				if (!shouldPlay || playbackConfirmed) return;
				if (isPlaying()) {
					playbackConfirmed = true;
					return;
				}

				try {
					const result = state.player && state.player.play ? state.player.play() : null;
					if (result && typeof result.then === "function") {
						result
							.then(() => {
								playbackConfirmed = true;
							})
							.catch(() => {
								console.log("VOE AniSkip: Could not resume playback after skip");
							});
					} else {
						playbackConfirmed = true;
					}
				} catch (e) {
					console.log("VOE AniSkip: Could not resume playback after skip");
				}
			};

			try {
				state.player.seek(target);
			} catch (e) {
				console.log("VOE AniSkip: Seek failed", e);
			}

			if (!shouldPlay) return;

			// If the seek still dropped the player out of playback, resume it.
			// The short delay lets JWPlayer enter its buffering state first, so we do
			// not fight a seek that is already on its way.
			setTimeout(ensurePlayback, 250);
			setTimeout(ensurePlayback, 2000);

			try {
				if (state.player.on) state.player.on("seeked", ensurePlayback);
			} catch (e) {}

			// Watchdog: recover from a player that got stuck buffering after the seek.
			setTimeout(() => {
				try {
					if (!state.player) return;
					const playerState = state.player.getState ? state.player.getState() : null;
					if (playerState === "buffering" || playerState === "loading") {
						console.log("VOE AniSkip: Player stuck buffering after skip, forcing play");
						playbackConfirmed = false;
						ensurePlayback();
					}
				} catch (e) {}
			}, 5000);
		}

		function checkSkipSegments() {
			if (!state.player) return;
			if (state.ui.skipButton && state.ui.skipButton.classList.contains("aniskip-confirm-mode")) return;

			const currentTime = state.player.getPosition();

			if (state.skipTimes && state.skipTimes.length > 0) {
				for (const segment of state.skipTimes) {
					const { startTime, endTime } = segment.interval;
					const segmentId = segment.skipId;

					if (currentTime >= startTime && currentTime < endTime - 1) {
						const shouldAutoSkip =
							((segment.skipType === "op" || segment.skipType === "mixed-op") && state.settings.autoSkipOp) ||
							((segment.skipType === "ed" || segment.skipType === "mixed-ed") && state.settings.autoSkipEd) ||
							(segment.skipType === "recap" && state.settings.autoSkipRecap);

						if (shouldAutoSkip && !state.skippedSegments.has(segmentId)) {
							state.skippedSegments.add(segmentId);

							// Skip to end of segment
							seekPlayer(endTime + state.settings.skipOffset);

							// If it's an ending, mark episode as seen
							if (segment.skipType === "ed" || segment.skipType === "mixed-ed") {
								console.log("VOE AniSkip: Auto-skipped ending, marking as seen");
								markCurrentEpisodeAsSeen();
							}

							state.ui.skipButton.classList.add("aniskip-hidden");
							return;
						}

						if (state.settings.showButtons && !state.skippedSegments.has(segmentId)) {
							showSkipButton(segment);
							return;
						}
					}
				}
			}

			if (state.settings.showButtons && state.settings.alwaysShowButton) {
				const skipButton = state.ui.skipButton;
				if (skipButton) {
					const skipAmount = 90 + (state.settings.skipOffset ?? DEFAULT_SETTINGS.skipOffset);
					const typeEl = skipButton.querySelector(".aniskip-skip-type");
					const expectedText = skipAmount + "s";
					if (typeEl.textContent !== expectedText) {
						typeEl.textContent = "";
						typeEl.textContent = String(skipAmount);
						const unitSpan = document.createElement("span");
						unitSpan.className = "aniskip-skip-unit";
						unitSpan.textContent = "s";
						typeEl.appendChild(unitSpan);
					}
					const duration = state.player.getDuration() || Infinity;
					skipButton.dataset.endTime = Math.min(currentTime + 90, duration);
					skipButton.dataset.skipId = "skip-90";
					skipButton.dataset.skipType = "manual-90";
					skipButton.classList.remove("aniskip-hidden");
				}
			} else if (state.ui.skipButton) {
				state.ui.skipButton.classList.add("aniskip-hidden");
			}
		}

		function showSkipButton(segment) {
			const skipButton = state.ui.skipButton;
			skipButton.querySelector(".aniskip-skip-type").textContent =
				SKIP_TYPE_LABELS[segment.skipType] || segment.skipType;
			skipButton.dataset.endTime = segment.interval.endTime;
			skipButton.dataset.skipId = segment.skipId;
			skipButton.dataset.skipType = segment.skipType;
			skipButton.classList.remove("aniskip-hidden");
		}

		function skipCurrent() {
			const skipButton = state.ui.skipButton;
			if (skipButton.classList.contains("aniskip-confirm-mode")) return;

			const skipStart = state.player ? state.player.getPosition() : 0;
			let endTime = parseFloat(skipButton.dataset.endTime);
			const skipId = skipButton.dataset.skipId;
			const skipType = skipButton.dataset.skipType;

			if (skipType === "manual-90" && state.player) {
				const currentTime = state.player.getPosition();
				const duration = state.player.getDuration() || Infinity;
				endTime = Math.min(currentTime + 90, duration);
			}

			if (endTime && state.player) {
				state.skippedSegments.add(skipId);

				// Skip to end of segment
				seekPlayer(endTime + state.settings.skipOffset);

				// If it's an ending, mark episode as seen
				if (skipType === "ed" || skipType === "mixed-ed") {
					markCurrentEpisodeAsSeen();
				}

				// Only ask to save for manual 90s skips; segments from AniSkip already exist
				if (skipType === "manual-90") {
					showSkipConfirm(skipStart, endTime + state.settings.skipOffset);
				}
				console.log("VOE AniSkip: Skipped to", endTime);
			}
		}

		function showSkipConfirm(startTime, endTime) {
			const skipButton = state.ui.skipButton;
			if (!skipButton || !state.player) return;

			const duration = state.player.getDuration() || 0;
			const isOpening = duration > 0 ? startTime <= duration / 2 : true;
			const typeLabel = isOpening ? "Opening" : "Ending";

			state.pendingSkipConfirm = { startTime, endTime, type: isOpening ? "op" : "ed" };

			const confirm = skipButton.querySelector(".aniskip-skip-confirm");
			const textEl = skipButton.querySelector(".aniskip-skip-confirm-text");
			textEl.textContent = getMessage("skipConfirmSave").replace("$1", typeLabel);
			textEl.classList.remove("aniskip-confirm-success", "aniskip-confirm-error");
			textEl.classList.remove("aniskip-hidden");
			setSkipConfirmBtns(false);

			skipButton.querySelector(".aniskip-skip-text").classList.add("aniskip-hidden");
			skipButton.querySelector(".aniskip-skip-type").classList.add("aniskip-hidden");
			confirm.classList.remove("aniskip-hidden");
			skipButton.classList.add("aniskip-confirm-mode");
			skipButton.classList.remove("aniskip-hidden");
			clearTimeout(state.skipConfirmTimeout);
			state.skipConfirmTimeout = setTimeout(() => {
				showSkipConfirmBtns();
			}, 3000);
		}

		function showSkipConfirmBtns() {
			const skipButton = state.ui.skipButton;
			if (!skipButton || !skipButton.classList.contains("aniskip-confirm-mode")) return;
			const textEl = skipButton.querySelector(".aniskip-skip-confirm-text");
			textEl.classList.add("aniskip-hidden");
			setSkipConfirmBtns(true);
			setSkipConfirmBarVisible(true);
			startSkipConfirmCountdown();
		}

		function setSkipConfirmBarVisible(visible) {
			const skipButton = state.ui.skipButton;
			if (!skipButton) return;
			const bar = skipButton.querySelector(".aniskip-skip-confirm-bar");
			if (bar) bar.classList.toggle("aniskip-hidden", !visible);
		}

		function setSkipConfirmBtns(visible) {
			const skipButton = state.ui.skipButton;
			if (!skipButton) return;
			skipButton.querySelectorAll(".aniskip-confirm-btn").forEach((btn) => {
				btn.classList.toggle("aniskip-hidden", !visible);
			});
		}

		function startSkipConfirmCountdown() {
			const skipButton = state.ui.skipButton;
			const bar = skipButton && skipButton.querySelector(".aniskip-skip-confirm-bar-fill");
			if (bar) {
				bar.style.transition = "none";
				bar.style.width = "100%";
				void bar.offsetWidth;
				bar.style.transition = "width 30s linear";
				bar.style.width = "0%";
			}
			clearTimeout(state.skipConfirmTimeout);
			state.skipConfirmTimeout = setTimeout(() => {
				hideSkipConfirm();
			}, 30000);
		}

		function showSkipFeedback(text, type = "neutral") {
			const skipButton = state.ui.skipButton;
			if (!skipButton) return;

			const confirm = skipButton.querySelector(".aniskip-skip-confirm");
			const textEl = skipButton.querySelector(".aniskip-skip-confirm-text");

			textEl.textContent = text;
			textEl.classList.toggle("aniskip-confirm-success", type === "success");
			textEl.classList.toggle("aniskip-confirm-error", type === "error");
			textEl.classList.remove("aniskip-hidden");
			setSkipConfirmBtns(false);
			setSkipConfirmBarVisible(false);
			confirm.classList.remove("aniskip-hidden");
			skipButton.classList.add("aniskip-confirm-mode");
			skipButton.classList.remove("aniskip-hidden");

			clearTimeout(state.skipConfirmTimeout);
			state.skipConfirmTimeout = setTimeout(() => {
				hideSkipConfirm();
			}, 2000);
		}

		function resetSkipButton() {
			const skipButton = state.ui.skipButton;
			if (!skipButton) return;
			clearTimeout(state.skipConfirmTimeout);
			const bar = skipButton.querySelector(".aniskip-skip-confirm-bar-fill");
			if (bar) {
				bar.style.transition = "none";
				bar.style.width = "100%";
			}
			const confirm = skipButton.querySelector(".aniskip-skip-confirm");
			const textEl = skipButton.querySelector(".aniskip-skip-confirm-text");
			skipButton.querySelector(".aniskip-skip-text").classList.remove("aniskip-hidden");
			skipButton.querySelector(".aniskip-skip-type").classList.remove("aniskip-hidden");
			setSkipConfirmBtns(true);
			textEl.classList.remove("aniskip-confirm-success", "aniskip-confirm-error");
			confirm.classList.add("aniskip-hidden");
			skipButton.classList.remove("aniskip-confirm-mode");
		}

		function hideSkipConfirm() {
			resetSkipButton();
			if (state.ui.skipButton) state.ui.skipButton.classList.add("aniskip-hidden");
		}

		function handleSkipConfirm(approved) {
			const skipButton = state.ui.skipButton;
			if (!skipButton) return;

			const pending = state.pendingSkipConfirm;
			state.pendingSkipConfirm = null;

			if (!approved || !pending) {
				hideSkipConfirm();
				return;
			}

			showSkipFeedback(getMessage("skipConfirmSaving"));
			submitManualSkip(pending.startTime, pending.endTime, pending.type).then((ok) => {
				showSkipFeedback(
					ok ? getMessage("skipConfirmSaved") : getMessage("skipConfirmFailed"),
					ok ? "success" : "error",
				);
			});
		}

		async function submitManualSkip(startTime, endTime, type) {
			if (!state.currentMalId || !state.currentEpisode || !state.player) {
				updateStatus(getMessage("statusCannotSubmit"), true);
				return false;
			}

			updateStatus(getMessage("statusSubmitting"));

			try {
				const response = await browser.runtime.sendMessage({
					action: "createSkipTime",
					malId: state.currentMalId,
					episodeNumber: state.currentEpisode,
					data: {
						skipType: type,
						startTime: Math.round(startTime * 1000) / 1000,
						endTime: Math.round(endTime * 1000) / 1000,
						episodeLength: Math.round(state.player.getDuration() * 1000) / 1000,
					},
				});

				if (response.error) {
					updateStatus(getMessage("statusSubmitFailed").replace("$1", response.error), true);
					return false;
				}

				updateStatus(getMessage("statusSubmitSuccess"));
				await fetchSkipTimes();
				return true;
			} catch (error) {
				updateStatus(getMessage("statusSubmitError"), true);
				return false;
			}
		}

		// Track if we've already marked as seen to prevent duplicates
		let markedAsSeen = false;

		// Mark the current episode as seen (send message to parent AniWorld page)
		function markCurrentEpisodeAsSeen() {
			if (markedAsSeen) return;
			markedAsSeen = true;

			if (window.self !== window.top) {
				window.parent.postMessage({ type: "ANISKIP_MARK_SEEN" }, "*");
				console.log("VOE AniSkip: Sent mark as seen request to parent");
			}
		}

		function requestNextEpisode(force = false) {
			if (window.self !== window.top) {
				window.parent.postMessage({ type: "ANISKIP_NEXT_EPISODE", force }, "*");
			}
		}

		function requestNextEpisodeStatus() {
			if (window.self !== window.top) {
				window.parent.postMessage({ type: "ANISKIP_REQUEST_NEXT_EPISODE_STATUS" }, "*");
			}
		}

		function requestFullscreen() {
			if (window.self !== window.top) {
				window.parent.postMessage({ type: "ANISKIP_REQUEST_FULLSCREEN" }, "*");
			}
		}

		function handleAutoPlay() {
			console.log("VOE AniSkip: Received auto-play request");
			let attempts = 0;
			const maxAttempts = 40;

			// browser policies always block autoplay :(
			const findAndClickPlay = () => {
				attempts++;
				console.log("VOE AniSkip: Auto-play attempt", attempts);

				// Try clicking the VOE spin/play button overlay
				const spinButton = document.querySelector("div.spin");
				if (spinButton) {
					console.log("VOE AniSkip: Found spin button, clicking");
					spinButton.click();
					return;
				}

				// Try clicking VOE logo/icon overlay
				const voeIcon = document.querySelector('img.icon[src*="voe"]') || document.querySelector("img.icon");
				if (voeIcon) {
					console.log("VOE AniSkip: Found VOE icon, clicking");
					(voeIcon.parentElement || voeIcon).click();
					return;
				}

				// Try clicking JWPlayer play button
				const jwPlayButton =
					document.querySelector(".jw-display-icon-display .jw-icon-display") ||
					document.querySelector(".jw-display-icon-container") ||
					document.querySelector(".jw-icon-playback");
				if (jwPlayButton) {
					console.log("VOE AniSkip: Found JW play button, clicking");
					jwPlayButton.click();
					return;
				}

				// Try clicking any large centered play button
				const playOverlay = document.querySelector('[class*="play"]') || document.querySelector('[class*="Play"]');
				if (playOverlay && playOverlay.offsetWidth > 50) {
					console.log("VOE AniSkip: Found play overlay, clicking");
					playOverlay.click();
					return;
				}

				// Try directly playing the video element
				const video = document.querySelector("video");
				if (video) {
					console.log("VOE AniSkip: Found video element, playing directly");
					video.play().catch((e) => console.log("VOE AniSkip: Direct play failed", e));
					return;
				}

				if (attempts < maxAttempts) setTimeout(findAndClickPlay, 300);
			};

			findAndClickPlay();
		}

		window.addEventListener("message", (event) => {
			if (event.data?.type === "ANISKIP_AUTO_PLAY") handleAutoPlay();
			if (event.data?.type === "ANISKIP_ENTER_FULLSCREEN") enterFullscreenFromPlayer();
			if (event.data?.type === "ANISKIP_NEXT_EPISODE_AVAILABLE") {
				setNextEpisodeAvailability(event.data.available);
			}
		});

		// Enter fullscreen using JWPlayer or native video
		function enterFullscreenFromPlayer() {
			console.log("VOE AniSkip: Entering fullscreen from player");

			// Try JWPlayer fullscreen
			if (state.player && state.player.setFullscreen) {
				state.player.setFullscreen(true);
				return;
			}

			// Try clicking JWPlayer fullscreen button
			const jwFullscreenBtn = document.querySelector(".jw-icon-fullscreen");
			if (jwFullscreenBtn) {
				jwFullscreenBtn.click();
				return;
			}

			// Try native fullscreen on video container
			const container =
				document.querySelector(".jw-wrapper") ||
				document.querySelector(".jwplayer") ||
				document.querySelector("video")?.parentElement;
			if (container) {
				const requestFS = container.requestFullscreen || container.webkitRequestFullscreen;
				if (requestFS) {
					requestFS.call(container).catch((e) => console.log("VOE AniSkip: Fullscreen failed", e));
				}
			}
		}

		async function checkShouldAutoPlay() {
			try {
				const result = await browser.storage.local.get(["shouldAutoPlay", "autoPlayTimestamp"]);
				console.log("VOE AniSkip: Checking auto-play flag:", result);
				if (result.shouldAutoPlay && Date.now() - result.autoPlayTimestamp < 30000) {
					console.log("VOE AniSkip: Auto-play flag found, will auto-play");
					await browser.storage.local.remove(["shouldAutoPlay", "autoPlayTimestamp"]);
					// Wait longer for the player to be ready
					setTimeout(handleAutoPlay, 2000);
				}
			} catch (e) {
				console.log("VOE AniSkip: Error checking auto-play:", e);
			}
		}

		function setTimeFromPlayer(field) {
			if (!state.player) return;
			const inputId = field === "start" ? "#aniskip-submit-start" : "#aniskip-submit-end";
			document.querySelector(inputId).value = formatTime(state.player.getPosition());
		}

		async function submitSkipTime() {
			if (!state.currentMalId || !state.currentEpisode || !state.player) {
				updateStatus(getMessage("statusCannotSubmit"), true);
				return;
			}

			const type = document.querySelector("#aniskip-submit-type").value;
			const startTime = parseTime(document.querySelector("#aniskip-submit-start").value);
			const endTime = parseTime(document.querySelector("#aniskip-submit-end").value);

			if (startTime === null || endTime === null) {
				updateStatus(getMessage("statusInvalidTime"), true);
				return;
			}
			if (startTime >= endTime) {
				updateStatus(getMessage("statusStartBeforeEnd"), true);
				return;
			}

			updateStatus(getMessage("statusSubmitting"));

			try {
				const response = await browser.runtime.sendMessage({
					action: "createSkipTime",
					malId: state.currentMalId,
					episodeNumber: state.currentEpisode,
					data: {
						skipType: type,
						startTime: Math.round(startTime * 1000) / 1000,
						endTime: Math.round(endTime * 1000) / 1000,
						episodeLength: Math.round(state.player.getDuration() * 1000) / 1000,
					},
				});

				if (response.error) updateStatus(getMessage("statusSubmitFailed").replace("$1", response.error), true);
				else {
					updateStatus(getMessage("statusSubmitSuccess"));
					document.querySelector("#aniskip-submit-panel").classList.add("aniskip-hidden");
					await fetchSkipTimes();
				}
			} catch (error) {
				updateStatus(getMessage("statusSubmitError"), true);
			}
		}

		async function refreshSkipTimes() {
			state.skippedSegments.clear();
			await fetchSkipTimes();
		}

		function formatTime(seconds) {
			const hrs = Math.floor(seconds / 3600);
			const mins = Math.floor((seconds % 3600) / 60);
			const secs = Math.floor(seconds % 60);
			return hrs > 0
				? `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
				: `${mins}:${secs.toString().padStart(2, "0")}`;
		}

		function parseTime(timeStr) {
			if (!timeStr) return null;
			const parts = timeStr.split(":").map((p) => parseFloat(p.trim()));
			if (parts.some(isNaN)) return null;
			if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
			if (parts.length === 2) return parts[0] * 60 + parts[1];
			if (parts.length === 1) return parts[0];
			return null;
		}

		// Initialize
		async function init() {
			if (state.initialized) return;
			state.initialized = true;

			console.log("VOE AniSkip: Initializing...");

			// Check for auto-play flag early
			checkShouldAutoPlay();

			try {
				state.settings = await browser.runtime.sendMessage({ action: "getSettings" });
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
					state.currentEpisode = animeInfo.episode;
					state.currentSeason = animeInfo.season || 1;
					state.currentVideoId = generateVideoId(animeInfo);

					document.querySelector("#aniskip-episode-num").textContent = animeInfo.episode;
					document.querySelector("#aniskip-season-num").textContent = animeInfo.season || 1;
					document.querySelector("#aniskip-anime-info").classList.remove("aniskip-hidden");

					const cache = await browser.runtime.sendMessage({ action: "getAnimeCache" });
					const cached = cache[animeInfo.animeName.toLowerCase()];

					if (cached) {
						console.log("VOE AniSkip: Cache hit for", animeInfo.animeName, "->", cached.malId);
						state.currentMalId = cached.malId;
						document.querySelector("#aniskip-anime-name").textContent = cached.title;
						document.querySelector("#aniskip-mal-id").textContent = cached.malId;
						updateStatus(getMessage("statusUsingCached"));
						await fetchSkipTimes();
					} else {
						console.log("VOE AniSkip: Cache miss for", animeInfo.animeName);
						document.querySelector("#aniskip-anime-name").textContent = animeInfo.animeName;
						document.querySelector("#aniskip-search-input").value = animeInfo.animeName;
						updateStatus(getMessage("statusSearching").replace("$1", animeInfo.animeName));

						let searchQuery = animeInfo.animeName;
						if (animeInfo.season && animeInfo.season > 1) searchQuery += " season " + animeInfo.season;

						console.log("VOE AniSkip: MAL search query:", searchQuery);
						const results = await browser.runtime.sendMessage({ action: "searchAnime", query: searchQuery });
						console.log("VOE AniSkip: MAL search results:", results && results.length, "hits");
						if (results && results.length > 0) {
							console.log("VOE AniSkip: Selecting first result:", results[0].mal_id, "-", results[0].title);
							await selectAnime(results[0].mal_id, results[0].title);
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

		browser.runtime.onMessage.addListener((message) => {
			if (message.action === "settingsUpdated") {
				state.settings = message.settings;
				console.log("VOE AniSkip: Settings updated", state.settings);
				updateNextEpisodeButtonLabel();
				if (state.ui.syncWithPlayerControls) state.ui.syncWithPlayerControls();

				// Update theme class and labels on container
				const container = document.getElementById("aniskip-container");
				if (container) {
					if (message.settings.uiTheme) container.className = `theme-${message.settings.uiTheme}`;
					applyPanelTranslations(container);
				}

				// Update speed control visibility
				const speedControl = document.getElementById("aniskip-speed-control");
				if (speedControl) {
					if (message.settings.showSpeedControl) {
						speedControl.classList.remove("aniskip-hidden");
					} else {
						speedControl.classList.add("aniskip-hidden");
					}
				}

				// Update skip button visibility
				const skipButton = document.getElementById("aniskip-skip-button");
				if (skipButton) {
					if (!message.settings.showButtons) {
						skipButton.classList.add("aniskip-hidden");
					} else if (!message.settings.alwaysShowButton && skipButton.dataset.skipType === "manual-90") {
						skipButton.classList.add("aniskip-hidden");
					} else {
						checkSkipSegments();
					}
				}
			}
		});

		window.addEventListener("message", (event) => {
			if (event.data?.type === "ANISKIP_ANIME_INFO") {
				browser.storage.local.set({ aniWorldInfo: { ...event.data.data, timestamp: Date.now() } });
			}
		});

		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", () => setTimeout(init, 300));
		} else {
			setTimeout(init, 500);
		}
	} // End of runExtension

	waitForVOE(runExtension);
})();
