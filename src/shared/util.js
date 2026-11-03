// Formatting helpers used by the player overlay (and available to the other
// surfaces once content.js is split up).
//
// Everything here is a pure function with no dependency on the state of a
// specific surface, which is why it can live in one place.
//
// `var`/`function` instead of `const`: content.js can be injected into the same
// frame twice, and a repeated `const` would throw (same reason as DEFAULT_SETTINGS).

// "#22C55E" + 0.5 -> "rgba(34, 197, 94, 0.5)". Falls back to a magenta that is
// impossible to miss, so a malformed colour never makes a marker invisible.
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

// 3661 -> "1:01:01", 61 -> "1:01". Hours are omitted below one hour.
function formatTime(seconds) {
	const hrs = Math.floor(seconds / 3600);
	const mins = Math.floor((seconds % 3600) / 60);
	const secs = Math.floor(seconds % 60);
	return hrs > 0
		? `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
		: `${mins}:${secs.toString().padStart(2, "0")}`;
}

// "1:01:01" -> 3661, "1:01" -> 61, "61" -> 61. Returns null for empty or
// non-numeric input so callers can reject the field instead of seeking to NaN.
function parseTime(timeStr) {
	if (!timeStr) return null;
	const parts = timeStr.split(":").map((p) => parseFloat(p.trim()));
	if (parts.some(isNaN)) return null;
	if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
	if (parts.length === 2) return parts[0] * 60 + parts[1];
	if (parts.length === 1) return parts[0];
	return null;
}
