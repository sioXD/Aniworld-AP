// VOE AniSkip - Skip segments: progress-bar markers, auto-skip, skip button and the save confirmation.
//
// A classic script in the player frame, loaded after shared/ and before
// bootstrap.js. Functions are globals on purpose: content scripts have no
// module system and every cross-file call happens at runtime.
"use strict";

var SKIP_TYPE_LABELS = {
	op: "Opening",
	ed: "Ending",
	"mixed-op": "Mixed Opening",
	"mixed-ed": "Mixed Ending",
	recap: "Recap",
};

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
			action: MSG.createSkipTime,
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
