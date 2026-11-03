// VOE AniSkip - Remembers the playback speed across episodes and providers.
//
// A classic script in the player frame, loaded after shared/ and before
// bootstrap.js. Functions are globals on purpose: content scripts have no
// module system and every cross-file call happens at runtime.
"use strict";

async function loadPersistentSpeed() {
	if (!state.settings.persistentSpeed) return;
	try {
		const result = await browser.storage.local.get(STORAGE.preferredSpeed);
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
		await browser.storage.local.set({ [STORAGE.preferredSpeed]: speed });
	} catch (e) {}
}
