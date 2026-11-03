// VOE AniSkip - The AniSkip panel: anime search, segment list and manual skip-time submission.
//
// A classic script in the player frame, loaded after shared/ and before
// bootstrap.js. Functions are globals on purpose: content scripts have no
// module system and every cross-file call happens at runtime.
"use strict";

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
		const results = await browser.runtime.sendMessage({ action: MSG.searchAnime, query });
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

async function selectAnime(malId, title) {
	state.currentMalId = malId;
	document.querySelector("#aniskip-anime-name").textContent = title;
	document.querySelector("#aniskip-mal-id").textContent = malId;
	document.querySelector("#aniskip-search-panel").classList.add("aniskip-hidden");
	document.querySelector("#aniskip-anime-info").classList.remove("aniskip-hidden");

	// Write with the same info object the lookup used, so the cache key
	// round-trips (and carries the season from the AniWorld page).
	const animeInfo = state.animeInfo || parseAnimeInfo();
	if (animeInfo) {
		await browser.runtime.sendMessage({
			action: MSG.setAnimeCache,
			cache: { [getMalCacheKey(animeInfo)]: { malId, title } },
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
			action: MSG.getSkipTimes,
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
					action: MSG.voteSkipTime,
					skipId: segment.dataset.skipId,
					voteType: e.target.dataset.vote,
				});
				e.target.classList.add("aniskip-voted");
			} catch (error) {}
		});
	});
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

function setTimeFromPlayer(field) {
	if (!state.player) return;
	const inputId = field === "start" ? "#aniskip-submit-start" : "#aniskip-submit-end";
	document.querySelector(inputId).value = formatTime(state.player.getPosition());
}

async function refreshSkipTimes() {
	state.skippedSegments.clear();
	await fetchSkipTimes();
}
