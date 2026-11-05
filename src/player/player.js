// VOE AniSkip - Player integration: VOE detection, the JWPlayer/video wrapper, seek, speed and fullscreen.
//
// A classic script in the player frame, loaded after shared/ and before
// bootstrap.js. Functions are globals on purpose: content scripts have no
// module system and every cross-file call happens at runtime.
"use strict";

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

// Autoplay is a one-shot request per episode change. Firefox blocks audible
// playback on a freshly loaded page unless the site is allowlisted, so a
// failed play() is reported with an actionable notice instead of retrying
// forever or silently starting muted.
var autoplayAttemptInProgress = false;
var autoplayBlockedByPolicy = false;

async function clearAutoplayRequest() {
	try {
		await browser.storage.local.remove([
			STORAGE.shouldAutoPlay,
			STORAGE.autoPlayRequestedAt,
			STORAGE.autoPlayTarget,
		]);
	} catch (e) {}
}

async function handleAutoPlay(options = {}) {
	if (autoplayAttemptInProgress) return false;
	if (autoplayBlockedByPolicy && !options.retry) return false;

	autoplayAttemptInProgress = true;
	if (options.retry) autoplayBlockedByPolicy = false;

	try {
		const startedAt = Date.now();
		const deadline = startedAt + 15000;
		let overlayClicked = false;
		// A click on the notice's Retry button is a real user gesture. Use it
		// for the first play() call even if VOE has not reported metadata yet,
		// so a slow player still starts with sound.
		let gestureAvailable = options.userGesture === true;

		while (Date.now() < deadline) {
			const video = document.querySelector("video");

			if (video && !video.paused) {
				await clearAutoplayRequest();
				hideAutoplayNotice();
				return true;
			}

			if (video && (gestureAvailable || video.readyState >= 1)) {
				gestureAvailable = false;
				try {
					const playResult = video.play();
					if (playResult && typeof playResult.then === "function") await playResult;
					if (!video.paused) {
						console.log("VOE AniSkip: Auto-play started");
						await clearAutoplayRequest();
						hideAutoplayNotice();
						return true;
					}
				} catch (error) {
					if (error?.name === "NotAllowedError") {
						console.log("VOE AniSkip: Auto-play blocked by Firefox's autoplay policy");
						autoplayBlockedByPolicy = true;
						await clearAutoplayRequest();
						showAutoplayNotice();
						return false;
					}
					console.log("VOE AniSkip: Auto-play attempt failed:", error?.name || error);
				}
			}

			// Some VOE builds only attach the stream after the site's own
			// overlay is clicked. Click it once, then keep checking the video
			// element so a policy rejection is still caught by play().
			if (!overlayClicked && Date.now() - startedAt > 1500) {
				const overlay =
					document.querySelector("div.spin:not(.spin-hidden)") ||
					document.querySelector(".jw-display-icon-display .jw-icon-display") ||
					document.querySelector(".jw-icon-playback");
				if (overlay) {
					console.log("VOE AniSkip: Clicking the player overlay");
					overlayClicked = true;
					overlay.click();
				}
			}

			await new Promise((resolve) => setTimeout(resolve, 400));
		}

		console.log("VOE AniSkip: Auto-play timed out waiting for the player");
		showAutoplayNotice();
		return false;
	} finally {
		autoplayAttemptInProgress = false;
	}
}

async function checkShouldAutoPlay() {
	try {
		const result = await browser.storage.local.get([
			STORAGE.shouldAutoPlay,
			STORAGE.autoPlayRequestedAt,
			STORAGE.autoPlayTarget,
		]);
		if (!result[STORAGE.shouldAutoPlay]) return;

		// An in-place episode switch names the episode the request belongs to.
		// The outgoing player must not consume it, and the incoming one only
		// once it knows which episode it is showing.
		const target = result[STORAGE.autoPlayTarget];
		if (target && target !== state.currentVideoId) return;

		const requestedAt = result[STORAGE.autoPlayRequestedAt] || 0;
		if (Date.now() - requestedAt >= AUTOPLAY_REQUEST_TTL_MS) {
			console.log("VOE AniSkip: Auto-play request expired");
			await clearAutoplayRequest();
			return;
		}

		console.log("VOE AniSkip: Auto-play flag found");
		await handleAutoPlay();
	} catch (e) {
		console.log("VOE AniSkip: Error checking auto-play:", e);
	}
}

// Mark the current episode as seen (send message to parent AniWorld page)
function markCurrentEpisodeAsSeen() {
	if (markedAsSeen) return;
	markedAsSeen = true;

	if (window.self !== window.top) {
		window.parent.postMessage({ type: POST_MSG.markSeen }, "*");
		console.log("VOE AniSkip: Sent mark as seen request to parent");
	}
}

function requestNextEpisode(force = false) {
	if (window.self !== window.top) {
		window.parent.postMessage({ type: POST_MSG.nextEpisode, force }, "*");
	}
}

function requestNextEpisodeStatus() {
	if (window.self !== window.top) {
		window.parent.postMessage({ type: POST_MSG.requestNextEpisodeStatus }, "*");
	}
}

function requestFullscreen() {
	if (window.self !== window.top) {
		window.parent.postMessage({ type: POST_MSG.requestFullscreen }, "*");
	}
}
