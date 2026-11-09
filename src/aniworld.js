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
			await browser.storage.local.set({ preferredLanguage: langKey });
			console.log("VOE AniSkip: Saved preferred language:", langKey);
		} catch (e) {
			console.error("VOE AniSkip: Error saving language:", e);
		}
	}

	async function loadPreferredLanguage() {
		try {
			const result = await browser.storage.local.get("preferredLanguage");
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
					type: "ANISKIP_NEXT_EPISODE_AVAILABLE",
					available: hasNextEpisode(),
				},
				"*",
			);
		} catch (error) {
			console.log("VOE AniSkip: Could not send next episode status:", error);
		}
	}

	// Resolve the absolute URL of the next episode. For a next-season jump this
	// fetches the season page to find its first episode.
	async function resolveNextEpisodeUrl(nextInfo) {
		let nextUrl = nextInfo.url;

		if (nextInfo.isNextSeason) {
			try {
				console.log("VOE AniSkip: Fetching next season page:", nextUrl);
				const seasonResponse = await fetch(nextUrl, { credentials: "same-origin" });
				const seasonHtml = await seasonResponse.text();
				const seasonDom = new DOMParser().parseFromString(seasonHtml, "text/html");

				const firstEpisodeLink = seasonDom.querySelector("a[data-episode-id]");
				if (firstEpisodeLink) {
					nextUrl = firstEpisodeLink.getAttribute("href");
					if (!nextUrl.startsWith("http")) {
						nextUrl = window.location.origin + nextUrl;
					}
					console.log("VOE AniSkip: Found first episode of next season:", nextUrl);
				} else {
					console.log("VOE AniSkip: Could not find first episode in next season");
					return null;
				}
			} catch (error) {
				console.error("VOE AniSkip: Error fetching next season:", error);
				return null;
			}
		}

		return nextUrl;
	}

	// ============================================================
	// Autoplay intent + in-page episode switch
	// ============================================================
	const AUTOPLAY_INTENT_KEY = "aniskipAutoplayIntent";
	const AUTOPLAY_INTENT_TTL_MS = 90 * 1000;
	const AUTOPLAY_DELIVERY_TIMEOUT_MS = 20 * 1000;
	const AUTOPLAY_DELIVERY_INTERVAL_MS = 500;

	function makeAutoplayId() {
		try {
			return crypto.randomUUID();
		} catch {
			return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
		}
	}

	function normalizePageUrl(url) {
		try {
			const parsed = new URL(url, window.location.origin);
			const path = parsed.pathname.replace(/\/+$/, "") || "/";
			return `${parsed.origin}${path}${parsed.search}`;
		} catch {
			return null;
		}
	}

	function createAutoplayIntent(targetUrl, force) {
		return {
			id: makeAutoplayId(),
			createdAt: Date.now(),
			targetUrl: normalizePageUrl(targetUrl),
			force: force === true,
		};
	}

	// Persist the intent only for the reload fallback (see hardReloadToEpisode).
	function saveAutoplayIntent(targetUrl, intent) {
		const stored = { ...intent, targetUrl: normalizePageUrl(targetUrl) };
		try {
			sessionStorage.setItem(AUTOPLAY_INTENT_KEY, JSON.stringify(stored));
		} catch (error) {
			console.warn("VOE AniSkip: Could not store autoplay intent", error);
		}
	}

	function takeAutoplayIntent() {
		try {
			const raw = sessionStorage.getItem(AUTOPLAY_INTENT_KEY);
			if (!raw) return null;
			sessionStorage.removeItem(AUTOPLAY_INTENT_KEY);

			const intent = JSON.parse(raw);
			if (!intent?.id || !intent?.targetUrl) return null;
			if (Date.now() - intent.createdAt > AUTOPLAY_INTENT_TTL_MS) return null;
			if (intent.targetUrl !== normalizePageUrl(window.location.href)) return null;

			return intent;
		} catch (error) {
			console.warn("VOE AniSkip: Could not read autoplay intent", error);
			return null;
		}
	}

	// Page regions the extension reads from. They must reflect the new episode
	// after an in-page switch. The player container (div.hosterSiteVideo) is left
	// alone so the live iframe reference stays valid.
	const EPISODE_DOM_SELECTORS = [
		".breadCrumbMenu",
		"div#stream.hosterSiteDirectNav",
		".changeLanguageBox",
		"div.hostSeriesTitle",
		"div.hosterSiteTitle",
		"div.hosterSiteVideo > ul",
	];

	let observersInitialized = false;

	async function navigateToEpisodeInPage(targetUrl) {
		const response = await fetch(targetUrl, { credentials: "same-origin" });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);

		const html = await response.text();
		const nextDom = new DOMParser().parseFromString(html, "text/html");

		for (const selector of EPISODE_DOM_SELECTORS) {
			const current = document.querySelector(selector);
			const next = nextDom.querySelector(selector);
			if (current && next) current.outerHTML = next.outerHTML;
		}

		document.title = nextDom.title;
		history.pushState({}, "", targetUrl);

		await storeAnimeInfo();
		applyPreferredLanguage();
		if (!observersInitialized) {
			observersInitialized = true;
			watchForIframes();
		}

		return nextDom;
	}

	// Find the VOE player link inside a parsed episode document.
	function resolvePlayerUrl(nextDom, preferredLanguage) {
		const providers = [...nextDom.querySelectorAll("div.hosterSiteVideo > ul li[data-lang-key]")];
		const languageFiltered = preferredLanguage
			? providers.filter((li) => li.dataset.langKey === preferredLanguage)
			: [];
		const candidates = languageFiltered.length ? languageFiltered : providers;

		for (const li of candidates) {
			for (const btn of li.querySelectorAll("div.generateInlinePlayer")) {
				const link = btn.querySelector("a[href]");
				const name = link?.querySelector("h4")?.textContent?.trim() || "";
				if (/voe/i.test(name) || /voe/i.test(link?.href || "")) {
					return link.href;
				}
			}
		}

		return null;
	}

	// Aniworld player links are /redirect/... URLs. Resolve them to the real VOE
	// URL via the background script so the frame can navigate same-origin (which
	// is what keeps the user activation and allows unmuted playback).
	async function resolveRedirectUrl(url) {
		if (!url) return url;
		if (!/\/redirect\/|\/r\?/.test(url)) return url;

		try {
			const result = await browser.runtime.sendMessage({ action: "resolveRedirectUrl", url });
			return result?.url || url;
		} catch (error) {
			console.warn("VOE AniSkip: Could not resolve provider redirect", error);
			return url;
		}
	}

	function findPlayerIframe() {
		return (
			document.querySelector('iframe[src*="voe"]') ||
			document.querySelector(".inSiteWebStream iframe") ||
			document.querySelector("#player-iframe") ||
			document.querySelector("iframe")
		);
	}

	function navigatePlayerFrame(url) {
		const iframe = findPlayerIframe();
		if (!iframe) return false;

		// Delegate autoplay permission to the player frame; without this Firefox
		// refuses unmuted playback on an automatic episode switch.
		iframe.setAttribute("allow", "autoplay; fullscreen");

		try {
			iframe.contentWindow.postMessage({ type: "ANISKIP_NAVIGATE_TO", url }, "*");
			return true;
		} catch (error) {
			console.warn("VOE AniSkip: Frame self-navigation failed, swapping src", error);
		}

		try {
			iframe.src = url;
			return true;
		} catch (error) {
			return false;
		}
	}

	// Fallback: a full page reload. This loses fullscreen, so it is a last resort.
	async function hardReloadToEpisode(targetUrl, intent) {
		saveAutoplayIntent(targetUrl, intent);

		if (document.fullscreenElement) {
			try {
				await document.exitFullscreen();
			} catch (error) {
				console.warn("VOE AniSkip: exitFullscreen failed", error);
			}
		}

		window.location.href = targetUrl;
	}

	// Collect every plausible player iframe for autoplay delivery.
	function findPlayerIframes() {
		const candidates = new Set();
		const selectors = [
			'iframe[src*="voe"]',
			".inSiteWebStream iframe",
			"#player-iframe",
			".hosterSiteDirectNav iframe",
		];
		selectors.forEach((selector) => {
			document.querySelectorAll(selector).forEach((iframe) => candidates.add(iframe));
		});
		if (candidates.size === 0) {
			const first = findPlayerIframe();
			if (first) candidates.add(first);
		}
		return [...candidates];
	}

	// Repeatedly ask the player frame to start playback until it acknowledges.
	function startAutoplayDelivery(intent) {
		let finished = false;
		let intervalId = null;
		let timeoutId = null;
		let observer = null;
		let observerTimer = null;
		const deliveryDeadline = Date.now() + AUTOPLAY_DELIVERY_TIMEOUT_MS;

		const cleanup = () => {
			if (finished) return;
			finished = true;
			clearInterval(intervalId);
			clearTimeout(timeoutId);
			clearTimeout(observerTimer);
			observer?.disconnect();
			window.removeEventListener("message", onMessage);
		};

		const deliver = () => {
			if (finished || Date.now() > deliveryDeadline) {
				cleanup();
				return;
			}
			findPlayerIframes().forEach((iframe) => {
				try {
					iframe.contentWindow?.postMessage(
						{ type: "ANISKIP_AUTO_PLAY", id: intent.id, force: intent.force },
						"*",
					);
				} catch (error) {
					// iframe may be mid-navigation
				}
			});
		};

		const onMessage = (event) => {
			const data = event.data;
			if (data?.type === "ANISKIP_PLAYER_READY") {
				deliver();
				return;
			}
			if (!data || data.id !== intent.id) return;
			if (data.type === "ANISKIP_AUTOPLAY_ACK") {
				console.log("VOE AniSkip: Autoplay ACK", data.started, data.muted);
				cleanup();
			}
		};

		window.addEventListener("message", onMessage);

		observer = new MutationObserver(() => {
			clearTimeout(observerTimer);
			observerTimer = setTimeout(deliver, 100);
		});
		observer.observe(document.body, { childList: true, subtree: true });

		deliver();
		intervalId = setInterval(deliver, AUTOPLAY_DELIVERY_INTERVAL_MS);
		timeoutId = setTimeout(cleanup, AUTOPLAY_DELIVERY_TIMEOUT_MS);
	}

	// After an in-page switch the OLD player document is still briefly alive, so
	// wait for the new document's ANISKIP_PLAYER_READY before delivering.
	let pendingAutoplay = null;

	function armAutoplayAfterReady(intent) {
		pendingAutoplay = { intent, started: false };

		setTimeout(() => {
			if (pendingAutoplay?.intent.id !== intent.id || pendingAutoplay.started) return;
			pendingAutoplay = null;
			console.warn("VOE AniSkip: Player never became ready, reloading");
			hardReloadToEpisode(intent.targetUrl, intent);
		}, 6000);
	}

	function handlePlayerReady() {
		if (!pendingAutoplay || pendingAutoplay.started) return;
		const { intent } = pendingAutoplay;
		pendingAutoplay.started = true;
		pendingAutoplay = null;
		startAutoplayDelivery(intent);
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

		const targetUrl = await resolveNextEpisodeUrl(nextInfo);
		if (!targetUrl) return;

		const intent = createAutoplayIntent(targetUrl, force);

		console.log("VOE AniSkip: Going to next episode:", targetUrl);

		// Try the in-page navigation first: it keeps fullscreen and the tab's user
		// activation alive, which is what lets the next episode start (with sound).
		let nextDom;
		try {
			nextDom = await navigateToEpisodeInPage(targetUrl);
		} catch (error) {
			console.error("VOE AniSkip: In-page navigation failed, reloading", error);
			await hardReloadToEpisode(targetUrl, intent);
			return;
		}

		const preferredLanguage = await loadPreferredLanguage();
		const rawPlayerUrl = resolvePlayerUrl(nextDom, preferredLanguage);
		const playerUrl = await resolveRedirectUrl(rawPlayerUrl);

		if (!playerUrl || !navigatePlayerFrame(playerUrl)) {
			console.warn("VOE AniSkip: Could not resolve/navigate player, reloading");
			await hardReloadToEpisode(targetUrl, intent);
			return;
		}

		// Wait for the fresh player document to announce readiness before delivering.
		armAutoplayAfterReady(intent);
	}

	// Track if we're already navigating to prevent duplicates
	let isNavigating = false;

	// Listen for messages from the VOE iframe
	window.addEventListener("message", (event) => {
		if (event.data && event.data.type === "ANISKIP_NEXT_EPISODE") {
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

		if (event.data && event.data.type === "ANISKIP_REQUEST_NEXT_EPISODE_STATUS") {
			const status = {
				type: "ANISKIP_NEXT_EPISODE_AVAILABLE",
				available: hasNextEpisode(),
			};
			if (event.source) {
				event.source.postMessage(status, "*");
			}
		}

		if (event.data && event.data.type === "ANISKIP_REQUEST_FULLSCREEN") {
			console.log("VOE AniSkip: Received fullscreen request from iframe");
			enterFullscreen();
		}

		if (event.data?.type === "ANISKIP_PLAYER_READY") handlePlayerReady();

		if (event.data?.type === "ANISKIP_AUTOPLAY_ACK") {
			console.log("VOE AniSkip: Autoplay ACK", event.data.started, event.data.muted);
		}

		if (event.data && event.data.type === "ANISKIP_MARK_SEEN") {
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

	// Enter/exit fullscreen on the top document. Keeping the fullscreen element in
	// the top frame (instead of inside the VOE iframe) means a player src swap on
	// an episode switch no longer drops fullscreen.
	function enterFullscreen() {
		const doc = document.documentElement;

		if (document.fullscreenElement) {
			document.exitFullscreen?.().catch(() => {});
			return;
		}

		const request = doc.requestFullscreen || doc.webkitRequestFullscreen;
		if (request) {
			request.call(doc).catch((error) => {
				console.warn("VOE AniSkip: Top-frame fullscreen failed", error);
			});
		}
	}

	// Stretch the player to fill the screen while the top document is fullscreen.
	function adaptPlayerLayout() {
		const container = document.querySelector(".inSiteWebStream") || findPlayerIframe()?.parentElement;
		const iframe = findPlayerIframe();

		if (document.fullscreenElement) {
			document.body.style.overflow = "hidden";
			if (container) {
				container.style.cssText =
					"position:fixed;inset:0;z-index:2147483647;width:100vw;height:100vh;" +
					"padding:0;margin:0;overflow:hidden;background:#000;";
			}
			if (iframe) {
				iframe.style.cssText = "display:block;position:absolute;inset:0;width:100vw;height:100vh;border:0;";
			}
		} else {
			document.body.style.overflow = "";
			if (container) container.style.cssText = "";
			if (iframe) iframe.style.cssText = "";
		}
	}

	document.addEventListener("fullscreenchange", adaptPlayerLayout);

	// Check if we should auto-play after a fallback reload.
	function checkAutoPlay() {
		const intent = takeAutoplayIntent();
		if (!intent) return;
		console.log("VOE AniSkip: Resuming autoplay after reload");
		startAutoplayDelivery(intent);
	}

	// Parse anime info from AniWorld page
	function parseAniWorldInfo() {
		// Try to get info from breadcrumb
		// Format: Home > Animes > Anime Name > Staffel X > Episode Y
		const breadcrumbs = document.querySelectorAll(".breadCrumbMenu li");

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
			const title = document.title;
			const titleMatch = title.match(/Episode\s*(\d+)\s*Staffel\s*(\d+)\s*von\s*(.+?)\s*\|/i);
			if (titleMatch) {
				episode = episode || parseInt(titleMatch[1], 10);
				season = parseInt(titleMatch[2], 10);
				animeName = animeName || titleMatch[3].trim();
			}
		}

		// Fallback: try meta tags
		if (!animeName) {
			const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
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
			const seriesTitle = document.querySelector(".series-title h1 span");
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
					aniWorldInfo: {
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
							type: "ANISKIP_ANIME_INFO",
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
											type: "ANISKIP_ANIME_INFO",
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

	// Back/forward after an in-page switch: the simplest correct behaviour is a
	// full reload so the parsed state matches the restored URL.
	window.addEventListener("popstate", () => window.location.reload());
})();
