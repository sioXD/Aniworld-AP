// AniWorld top frame - delegate the autoplay permission to the VOE iframe.
//
// Firefox's autoplay permission policy is evaluated when a frame navigates. The
// site creates the player iframe with src="" and assigns the hoster URL later,
// so this has to run at document_start and set the attribute before that
// navigation. Without the delegation, even a user-allowlisted AniWorld cannot
// autoplay the cross-origin VOE player with sound.
(function () {
	"use strict";

	function isPlayerIframe(iframe) {
		// Only the inline player gets the delegation - the page also embeds
		// Facebook/Twitter widgets that must not receive autoplay rights.
		if (iframe.closest(".inSiteWebStream")) return true;
		const src = iframe.getAttribute("src") || "";
		return src.includes("voe") || src.includes("/redirect/");
	}

	function allowAutoplay(iframe) {
		if (!iframe || iframe.tagName !== "IFRAME" || !isPlayerIframe(iframe)) return;
		const existing = iframe.getAttribute("allow") || "";
		if (/\bautoplay\b/.test(existing)) return;
		iframe.setAttribute("allow", existing ? `${existing}; autoplay *` : "autoplay *");
	}

	function scan(root) {
		if (!root || root.nodeType !== 1) return;
		if (root.tagName === "IFRAME") allowAutoplay(root);
		if (root.querySelectorAll) root.querySelectorAll("iframe").forEach(allowAutoplay);
	}

	const observer = new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			if (mutation.type === "attributes") {
				allowAutoplay(mutation.target);
				continue;
			}
			for (const node of mutation.addedNodes) scan(node);
		}
	});

	observer.observe(document, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ["allow", "src"],
	});
	scan(document.documentElement);
})();
