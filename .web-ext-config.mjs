// Ignore rules for `web-ext lint`, `web-ext build` and `web-ext sign`.
// Keeping them in one place means pack.sh, pack.ps1 and the release workflow
// all package the same files. Directories are listed without a glob so that no
// empty directory entry ends up in the archive.
export default {
	ignoreFiles: [
		// Not part of the add-on
		"docs",
		"dist",
		"META-INF",
		"web-ext-artifacts",
		".github",
		// Repository only
		"*.md",
		"LICENSE",
		"*.sh",
		"*.ps1",
		".prettierrc",
	],
};
