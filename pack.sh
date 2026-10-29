#!/usr/bin/env bash
set -euo pipefail

# Clean previous build artifacts
rm -rf web-ext-artifacts

# Read version from manifest.json
version=$(node -p "require('./manifest.json').version")
current_date=$(date +"%d.%m.%Y")

# Stamp version and date into popup.html (separate spans, see .footer).
# The whole span is rewritten instead of using backreferences: "\1" directly
# followed by a date starting with a digit can be parsed as "\12" by sed.
popup="src/popup.html"
sed -i -E "s|<span id=\"version\"[^>]*>[^<]*</span>|<span id=\"version\" class=\"version\">v$version</span>|" "$popup"
sed -i -E "s|<span id=\"releaseDate\"[^>]*>[^<]*</span>|<span id=\"releaseDate\">$current_date</span>|" "$popup"

# Build with web-ext
if ! command -v web-ext &>/dev/null; then
	echo "web-ext not found"
	echo "Install it with: npm install --global web-ext"
	exit 1
fi

web-ext build --ignore-files docs META-INF CHANGELOG.md CONTRIBUTING.md LICENSE original_README.md pack.ps1 pack.sh README.md SECURITY.md

archive=$(ls -t web-ext-artifacts/*.zip 2>/dev/null | head -1)
if [ -z "$archive" ]; then
	echo "Error: web-ext did not produce a build artifact"
	exit 1
fi

echo "Package created successfully with Version $version ($current_date)"
