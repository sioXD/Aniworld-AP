// VOE AniSkip - The injected overlay: container, theme, labels and the next-episode control-bar button.
//
// A classic script in the player frame, loaded after shared/ and before
// bootstrap.js. Functions are globals on purpose: content scripts have no
// module system and every cross-file call happens at runtime.
"use strict";

// Get current language from settings
function getCurrentLanguage() {
	return state.settings?.language || DEFAULT_SETTINGS.language;
}

// i18n helper function - uses stored language setting
function getMessage(key, fallback) {
	return translateMessage(getCurrentLanguage(), key, fallback);
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
