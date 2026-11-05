// AniWorld Content Script
// Extracts anime info from AniWorld page and communicates with VOE iframe
// Enhanced with persistent language memory

(function () {
	"use strict";

	console.log("VOE AniSkip: AniWorld script loaded");

	// ============================================================
	// Persistent Language Memory
	// ============================================================
	async function saveSelectedLanguage(langKey) {
		try {
			await browser.storage.local.set({ [STORAGE.preferredLanguage]: langKey });
			console.log("VOE AniSkip: Saved preferred language:", langKey);
		} catch (e) {
			console.error("VOE AniSkip: Error saving language:", e);
		}
	}

	async function loadPreferredLanguage() {
		try {
			const result = await browser.storage.local.get(STORAGE.preferredLanguage);
			return result.preferredLanguage || null;
		} catch (e) {
			return null;
		}
	}

	async function applyPreferredLanguage() {
		const preferredLang = await loadPreferredLanguage();
		if (!preferredLang) return;

		// Find and click the preferred language button
		const langButtons = document.querySelectorAll(".changemark.changemark-active, .changemark");
		for (const btn of langButtons) {
			const langKey = btn.closest("[data-lang-key]")?.dataset.langKey;
			if (langKey === preferredLang) {
				// Check if it's not already selected
				const currentActive = document.querySelector(".changemark.changemark-active");
				const currentLangKey = currentActive?.closest("[data-lang-key]")?.dataset.langKey;

				if (currentLangKey !== preferredLang) {
					console.log("VOE AniSkip: Applying preferred language:", preferredLang);
					btn.click();
				}
				break;
			}
		}
	}

	// Monitor language changes
	function setupLanguageObserver() {
		// Observe clicks on language buttons
		document.addEventListener("click", async (e) => {
			const langContainer = e.target.closest("[data-lang-key]");
			if (langContainer) {
				const langKey = langContainer.dataset.langKey;
				if (langKey) {
					await saveSelectedLanguage(langKey);
				}
			}
		});

		// Apply preferred language on page load
		setTimeout(applyPreferredLanguage, 1000);
	}

	// Remove any AniSkip UI elements from the main AniWorld page
	// (they should only appear inside the VOE iframe)
	function removeAniSkipUI() {
		const elements = document.querySelectorAll("#aniskip-container, .aniskip-toggle-btn, .aniskip-button");
		elements.forEach((el) => el.remove());
		return elements.length > 0;
	}

	// Try to remove every second until found
	const removalInterval = setInterval(() => {
		if (removeAniSkipUI()) {
			console.log("VOE AniSkip: Removed UI from AniWorld main page");
			clearInterval(removalInterval);
		}
	}, 1000);

	// Also try immediately
	removeAniSkipUI();

	// Get next episode URL from AniWorld page
	function getNextEpisodeUrl() {
		// Find the currently active episode link
		const activeEpisode = document.querySelector("a.active[data-episode-id]");

		if (activeEpisode) {
			// Get the next sibling li's link
			const currentLi = activeEpisode.closest("li");
			if (currentLi) {
				const nextLi = currentLi.nextElementSibling;
				if (nextLi) {
					const nextLink = nextLi.querySelector("a[data-episode-id]");
					if (nextLink) {
						console.log("VOE AniSkip: Found next episode link:", nextLink.href);
						return { url: nextLink.href, isNextSeason: false };
					}
				}
			}
		}

		// No next episode in current season - check for next season
		const nextSeasonUrl = getNextSeasonFirstEpisodeUrl();
		if (nextSeasonUrl) {
			console.log("VOE AniSkip: Found next season first episode:", nextSeasonUrl);
			return { url: nextSeasonUrl, isNextSeason: true };
		}

		return null;
	}

	// Get the first episode URL of the next season
	function getNextSeasonFirstEpisodeUrl() {
		// Find seasons navigation - look for the list containing season links
		const seasonsContainer = document.querySelector(".hosterSiteDirectNav ul");
		if (!seasonsContainer) return null;

		// Find the active season
		const activeSeason = seasonsContainer.querySelector('a.active[href*="staffel"]');
		if (!activeSeason) return null;

		const currentSeasonLi = activeSeason.closest("li");
		if (!currentSeasonLi) return null;

		const nextSeasonLi = currentSeasonLi.nextElementSibling;
		if (!nextSeasonLi) return null;

		const nextSeasonLink = nextSeasonLi.querySelector('a[href*="staffel"]');
		if (!nextSeasonLink) return null;

		// Don't skip from season to "filme" (movies)
		if (nextSeasonLink.href.includes("/filme")) return null;

		// Return the season URL - we'll need to fetch it to get episode 1
		return nextSeasonLink.href;
	}

	// Check if there is a next episode available
	function hasNextEpisode() {
		const activeEpisode = document.querySelector("a.active[data-episode-id]");
		if (activeEpisode) {
			const currentLi = activeEpisode.closest("li");
			if (currentLi) {
				const nextLi = currentLi.nextElementSibling;
				if (nextLi && nextLi.querySelector("a[data-episode-id]")) {
					return true;
				}
			}
		}
		// Also check for next season
		return !!getNextSeasonFirstEpisodeUrl();
	}

	function notifyNextEpisodeAvailability(iframe) {
		if (!iframe || !iframe.contentWindow) return;

		try {
			iframe.contentWindow.postMessage(
				{
					type: POST_MSG.nextEpisodeAvailable,
					available: hasNextEpisode(),
				},
				"*",
			);
		} catch (error) {
			console.log("VOE AniSkip: Could not send next episode status:", error);
		}
	}

	// ============================================================
	// In-place episode switch
	// ============================================================
	// Firefox only allows audible playback while the top-level document still has
	// its sticky user activation, and a full page load always throws that away.
	// Switching only the player iframe keeps the top document alive, so the next
	// episode starts with sound without changing any Firefox setting. Everything
	// the page and the extension read afterwards (URL, breadcrumbs, episode list,
	// episode title) is patched from the fetched page.

	function getPlayerIframe() {
		return document.querySelector(".inSiteWebStream iframe") || document.querySelector('iframe[src*="voe"]');
	}

	// The site shows the streams of exactly one language, and its inline player
	// is the first entry of that language. Mirror that choice instead of keeping
	// a hoster order of our own.
	function pickStreamTarget(doc) {
		const items = Array.from(doc.querySelectorAll(".hosterSiteVideo ul li[data-link-target]")).filter(
			(item) => item.querySelector(".generateInlinePlayer") && item.dataset.externalEmbed !== "true",
		);

		const order = [];
		const preferred = document.querySelector(".changeLanguageBox img.selectedLanguage")?.dataset.langKey;
		if (preferred) order.push(preferred);
		for (const lang of ["1", "3", "2"]) {
			if (!order.includes(lang)) order.push(lang);
		}

		for (const lang of order) {
			const item = items.find((entry) => entry.dataset.langKey === lang);
			if (item) return item.dataset.linkTarget;
		}
		return null;
	}

	// Keep the parts of the page that the extension reads in sync with the
	// episode that is now playing.
	function applyEpisodePage(doc, nextUrl, previousEpisodeId, previousWasSeen) {
		const nextNav = doc.querySelector(".hosterSiteDirectNav");
		const liveNav = document.querySelector(".hosterSiteDirectNav");
		if (nextNav && liveNav) {
			liveNav.innerHTML = nextNav.innerHTML;
			if (previousEpisodeId && previousWasSeen) {
				const previous = liveNav.querySelector(`a[data-episode-id="${previousEpisodeId}"]`);
				if (previous) previous.classList.add("seen");
			}
		}

		const nextTitle = doc.querySelector(".hosterSiteTitle");
		const liveTitle = document.querySelector(".hosterSiteTitle");
		if (nextTitle && liveTitle) {
			for (const attribute of ["data-season", "data-episode", "data-episode-id"]) {
				if (nextTitle.hasAttribute(attribute)) {
					liveTitle.setAttribute(attribute, nextTitle.getAttribute(attribute));
				}
			}
			liveTitle.innerHTML = nextTitle.innerHTML;
		}

		const nextCrumbs = doc.querySelector(".breadCrumbMenu");
		const liveCrumbs = document.querySelector(".breadCrumbMenu");
		if (nextCrumbs && liveCrumbs) liveCrumbs.innerHTML = nextCrumbs.innerHTML;

		if (doc.title) document.title = doc.title;

		// The address bar has to point at the episode that is actually playing,
		// otherwise a reload or a bookmark returns to the previous one.
		try {
			history.pushState(null, "", nextUrl);
		} catch (error) {
			console.log("VOE AniSkip: Could not update the URL:", error);
		}
	}

	async function switchEpisodeInPlace(nextUrl) {
		const iframe = getPlayerIframe();
		if (!iframe) return false;

		let doc;
		try {
			const response = await fetch(nextUrl, { credentials: "same-origin" });
			if (!response.ok) return false;
			doc = new DOMParser().parseFromString(await response.text(), "text/html");
		} catch (error) {
			console.log("VOE AniSkip: Could not load the next episode in place:", error);
			return false;
		}

		const streamTarget = pickStreamTarget(doc);
		const info = parseAniWorldInfo(doc);
		if (!streamTarget || !info) {
			console.log("VOE AniSkip: Next episode has no inline player, falling back to a reload");
			return false;
		}

		const activeLink = document.querySelector("a.active[data-episode-id]");

		// The incoming player reads the request while initializing. The target
		// keeps the outgoing frame from consuming it.
		await browser.storage.local.set({
			[STORAGE.aniWorldInfo]: { ...info, url: nextUrl, timestamp: Date.now() },
			[STORAGE.shouldAutoPlay]: true,
			[STORAGE.autoPlayRequestedAt]: Date.now(),
			[STORAGE.autoPlayTarget]: generateVideoId(info),
		});

		applyEpisodePage(
			doc,
			nextUrl,
			activeLink?.dataset.episodeId || null,
			activeLink?.classList.contains("seen") || false,
		);

		// Resolve like the site does (its iframe gets the same relative
		// data-link-target), so a missing leading slash cannot break the swap.
		const src = new URL(streamTarget, window.location.href).href;
		console.log("VOE AniSkip: Switching to the next episode in place:", src);
		iframe.src = src;
		return true;
	}

	// Navigate to next episode
	async function goToNextEpisode(force = false) {
		// Manual navigation is independent of automatic next-episode navigation.
		const { nextEpisode } = await browser.storage.local.get({ nextEpisode: DEFAULT_SETTINGS.nextEpisode });
		if (!force && nextEpisode === false) {
			console.log("VOE AniSkip: Next episode disabled, not navigating");
			return;
		}

		const nextInfo = getNextEpisodeUrl();
		if (!nextInfo) {
			console.log("VOE AniSkip: No next episode or season found");
			return;
		}

		let nextUrl = nextInfo.url;

		// If it's a next season, we need to fetch the season page first to get episode 1
		if (nextInfo.isNextSeason) {
			try {
				console.log("VOE AniSkip: Fetching next season page:", nextUrl);
				const seasonResponse = await fetch(nextUrl);
				const seasonHtml = await seasonResponse.text();
				const seasonDom = new DOMParser().parseFromString(seasonHtml, "text/html");

				// Find the first episode link in the next season
				const firstEpisodeLink = seasonDom.querySelector("a[data-episode-id]");
				if (firstEpisodeLink) {
					nextUrl = firstEpisodeLink.href;
					// Make sure it's an absolute URL
					if (!nextUrl.startsWith("http")) {
						nextUrl = window.location.origin + nextUrl;
					}
					console.log("VOE AniSkip: Found first episode of next season:", nextUrl);
				} else {
					console.log("VOE AniSkip: Could not find first episode in next season");
					return;
				}
			} catch (error) {
				console.error("VOE AniSkip: Error fetching next season:", error);
				return;
			}
		}

		// Preferred: swap the player without reloading the page.
		if (await switchEpisodeInPlace(nextUrl)) return;

		console.log("VOE AniSkip: Navigating to next episode:", nextUrl);

		await browser.storage.local.set({
			[STORAGE.autoPlayNextFlag]: true,
			[STORAGE.flaggedAt]: Date.now(),
		});

		// Fallback: full page reload. The player shows an actionable notice when
		// Firefox blocks the audible autoplay.
		window.location.href = nextUrl;
	}

	// Track if we're already navigating to prevent duplicates
	let isNavigating = false;

	// Listen for messages from the VOE iframe
	window.addEventListener("message", (event) => {
		if (event.data && event.data.type === POST_MSG.nextEpisode) {
			console.log("VOE AniSkip: Received next episode request from iframe");
			if (!isNavigating) {
				isNavigating = true;
				goToNextEpisode(event.data.force === true).finally(() => {
					setTimeout(() => {
						isNavigating = false;
					}, 2000);
				});
			}
		}

		if (event.data && event.data.type === POST_MSG.requestNextEpisodeStatus) {
			const status = {
				type: POST_MSG.nextEpisodeAvailable,
				available: hasNextEpisode(),
			};
			if (event.source) {
				event.source.postMessage(status, "*");
			}
		}

		if (event.data && event.data.type === POST_MSG.requestFullscreen) {
			console.log("VOE AniSkip: Received fullscreen request from iframe");
			enterFullscreen();
		}

		if (event.data && event.data.type === POST_MSG.markSeen) {
			console.log("VOE AniSkip: Received mark as seen request from iframe");
			markCurrentEpisodeAsSeen();
			if (!isNavigating) {
				isNavigating = true;
				goToNextEpisode().finally(() => {
					setTimeout(() => {
						isNavigating = false;
					}, 2000);
				});
			}
		}
	});

	// Mark the current episode as seen (add 'seen' class)
	function markCurrentEpisodeAsSeen() {
		const activeEpisode = document.querySelector("a.active[data-episode-id]");
		if (activeEpisode) {
			activeEpisode.classList.add("seen");
			console.log("VOE AniSkip: Marked episode as seen:", activeEpisode.getAttribute("data-episode-id"));
			activeEpisode.classList.remove("aniskip-in-progress");
		}
	}

	// Enter fullscreen on the video container
	function enterFullscreen() {
		// Send message to iframe to enter fullscreen using JWPlayer
		const iframe =
			document.querySelector('iframe[src*="voe"]') ||
			document.querySelector(".inSiteWebStream iframe") ||
			document.querySelector("iframe");
		if (iframe) {
			iframe.contentWindow.postMessage({ type: POST_MSG.enterFullscreen }, "*");
		}
	}

	// Check if we should auto-play (came from previous episode)
	async function checkAutoPlay() {
		try {
			const next = await browser.storage.local.get([STORAGE.autoPlayNextFlag, STORAGE.flaggedAt]);
			if (next[STORAGE.autoPlayNextFlag]) {
				const flaggedAt = next[STORAGE.flaggedAt] || 0;
				await browser.storage.local.remove([STORAGE.autoPlayNextFlag, STORAGE.flaggedAt]);

				if (Date.now() - flaggedAt < AUTOPLAY_REQUEST_TTL_MS) {
					console.log("VOE AniSkip: Auto-play enabled from previous episode");

					// The player frame watches this key and starts playback as
					// soon as it is ready. Leaving the request in storage covers
					// the case where the frame is injected after this write.
					await browser.storage.local.set({
						[STORAGE.shouldAutoPlay]: true,
						[STORAGE.autoPlayRequestedAt]: Date.now(),
					});
					return;
				}
			}

			// A request that was never consumed (closed tab, failed player)
			// must not start playback on a later, unrelated episode.
			const pending = await browser.storage.local.get([
				STORAGE.shouldAutoPlay,
				STORAGE.autoPlayRequestedAt,
			]);
			const requestedAt = pending[STORAGE.autoPlayRequestedAt] || 0;
			if (pending[STORAGE.shouldAutoPlay] && Date.now() - requestedAt >= AUTOPLAY_REQUEST_TTL_MS) {
				await browser.storage.local.remove([
					STORAGE.shouldAutoPlay,
					STORAGE.autoPlayRequestedAt,
					STORAGE.autoPlayTarget,
				]);
			}
		} catch (e) {
			console.error("VOE AniSkip: Error checking auto-play:", e);
		}
	}

	// Parse anime info from AniWorld page. `doc` is the live page by default; an
	// in-place episode switch passes the fetched next-episode document so the
	// player gets the new episode number before the iframe navigates.
	function parseAniWorldInfo(doc = document) {
		// Try to get info from breadcrumb
		// Format: Home > Animes > Anime Name > Staffel X > Episode Y
		const breadcrumbs = doc.querySelectorAll(".breadCrumbMenu li");

		let animeName = null;
		let season = 1;
		let episode = null;

		breadcrumbs.forEach((li, index) => {
			const text = li.textContent.trim();
			const link = li.querySelector("a");

			// Anime name is usually the 3rd breadcrumb (index 2)
			if (index === 2 && link) {
				animeName = link.querySelector("span")?.textContent?.trim() || text;
			}

			// Season info - "Staffel X"
			if (text.toLowerCase().includes("staffel")) {
				const match = text.match(/staffel\s*(\d+)/i);
				if (match) {
					season = parseInt(match[1], 10);
				}
			}

			// Episode info - "Episode X"
			if (text.toLowerCase().includes("episode")) {
				const match = text.match(/episode\s*(\d+)/i);
				if (match) {
					episode = parseInt(match[1], 10);
				}
			}
		});

		// Fallback: try to parse from page title
		// Format: "Episode 11 Staffel 1 von A Gatherer's Adventure in Isekai | AniWorld.to"
		if (!animeName || !episode) {
			const title = doc.title || "";
			const titleMatch = title.match(/Episode\s*(\d+)\s*Staffel\s*(\d+)\s*von\s*(.+?)\s*\|/i);
			if (titleMatch) {
				episode = episode || parseInt(titleMatch[1], 10);
				season = parseInt(titleMatch[2], 10);
				animeName = animeName || titleMatch[3].trim();
			}
		}

		// Fallback: try meta tags
		if (!animeName) {
			const ogTitle = doc.querySelector('meta[property="og:title"]')?.content;
			if (ogTitle) {
				const match = ogTitle.match(/Episode\s*(\d+)\s*Staffel\s*(\d+)\s*von\s*(.+)/i);
				if (match) {
					episode = episode || parseInt(match[1], 10);
					season = parseInt(match[2], 10);
					animeName = match[3].trim();
				}
			}
		}

		// Try getting anime name from series title element
		if (!animeName) {
			const seriesTitle = doc.querySelector(".series-title h1 span");
			if (seriesTitle) {
				animeName = seriesTitle.textContent.trim();
			}
		}

		if (animeName && episode) {
			console.log("VOE AniSkip: AniWorld parsed -", { animeName, season, episode });
			return { animeName, season, episode, source: "aniworld" };
		}

		console.log("VOE AniSkip: Could not parse AniWorld info");
		return null;
	}

	// Store the anime info for the iframe to access
	async function storeAnimeInfo() {
		const info = parseAniWorldInfo();
		if (info) {
			try {
				await browser.storage.local.set({
					[STORAGE.aniWorldInfo]: {
						...info,
						url: window.location.href,
						timestamp: Date.now(),
					},
				});
				console.log("VOE AniSkip: Stored AniWorld info", info);

				// Also try to send message to any existing VOE iframes
				notifyIframes(info);
			} catch (e) {
				console.error("VOE AniSkip: Failed to store info", e);
			}
		} else {
			notifyIframes(null);
		}
	}

	// Try to communicate with VOE iframes via postMessage
	function notifyIframes(info) {
		const iframes = document.querySelectorAll("iframe");
		iframes.forEach((iframe) => {
			try {
				if (info) {
					iframe.contentWindow.postMessage(
						{
							type: POST_MSG.animeInfo,
							data: info,
						},
						"*",
					);
					console.log("VOE AniSkip: Sent info to iframe");
				}
				notifyNextEpisodeAvailability(iframe);
			} catch (e) {
				// Cross-origin, can't access directly
			}
		});
	}

	// Watch for new iframes being added (VOE player loads dynamically)
	function watchForIframes() {
		const observer = new MutationObserver((mutations) => {
			mutations.forEach((mutation) => {
				mutation.addedNodes.forEach((node) => {
					if (node.nodeName === "IFRAME") {
						console.log("VOE AniSkip: New iframe detected");
						setTimeout(() => {
							const info = parseAniWorldInfo();
							if (info) {
								try {
									node.contentWindow.postMessage(
										{
											type: POST_MSG.animeInfo,
											data: info,
										},
										"*",
									);
								} catch (e) {}
							}
							notifyNextEpisodeAvailability(node);
						}, 1000);
					}
				});
			});
		});

		observer.observe(document.body, { childList: true, subtree: true });
	}

	// Run when page is ready
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", () => {
			storeAnimeInfo();
			watchForIframes();
			checkAutoPlay();
			setupLanguageObserver();
		});
	} else {
		storeAnimeInfo();
		watchForIframes();
		checkAutoPlay();
		setupLanguageObserver();
	}

	// Also update when URL changes (for SPA navigation)
	let lastUrl = window.location.href;
	setInterval(() => {
		if (window.location.href !== lastUrl) {
			lastUrl = window.location.href;
			setTimeout(storeAnimeInfo, 500);
		}
	}, 1000);

	// The DOM of an in-place switch never matches an older history entry, so a
	// step back has to be served by a real navigation instead of showing the
	// wrong episode under the wrong URL.
	window.addEventListener("popstate", () => window.location.reload());
})();
