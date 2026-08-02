#!/usr/bin/env bash
set -euo pipefail

# Clean previous build artifacts
rm -rf web-ext-artifacts

# Read version from manifest.json
version=$(node -p "require('./manifest.json').version")
current_date=$(date +"%d.%m.%y")

# Stamp version and date into popup.html
popup="src/popup.html"
sed -i "s|\(<span id=\"version\"[^>]*>\).*\(</span>\)|\1v$version - $current_date\2|" "$popup"

# Build with web-ext
if ! command -v web-ext &>/dev/null; then
	echo "web-ext not found"
	echo "Install it with: npm install --global web-ext"
	exit 1
fi

web-ext build --ignore-files docs META-INF CHANGELOG.md CONTRIBUTING.md LICENSE original_README.md pack.ps1 README.md SECURITY.md

archive=$(ls -t web-ext-artifacts/*.zip 2>/dev/null | head -1)
if [ -z "$archive" ]; then
	echo "Error: web-ext did not produce a build artifact"
	exit 1
fi

echo "Package created successfully with Version $version ($current_date)"
