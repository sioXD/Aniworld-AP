# Remove any existing package artifacts
if (Test-Path aniworld-ap.xpi) {
    Remove-Item aniworld-ap.xpi
}

if (Test-Path web-ext-artifacts) {
    Remove-Item web-ext-artifacts -Recurse -Force
}

try {
    # Read version from manifest.json
    $manifest = Get-Content manifest.json | ConvertFrom-Json
    $version = $manifest.version
    $currentDate = Get-Date -Format "dd.MM.yyyy"

    # Stamp version and date into popup.html (separate spans, see .footer).
    # The whole span is rewritten instead of using backreferences: "$1" directly
    # followed by a date starting with a digit would be read as "$12".
    $popupPath = "src/popup.html"
    $popupContent = Get-Content $popupPath -Raw
    $versionSpan = '<span id="version" class="version">v' + $version + "</span>"
    $dateSpan = '<span id="releaseDate">' + $currentDate + "</span>"
    $popupContent = $popupContent -replace '<span id="version"[^>]*>[^<]*</span>', $versionSpan
    $popupContent = $popupContent -replace '<span id="releaseDate"[^>]*>[^<]*</span>', $dateSpan
    Set-Content -Path $popupPath -Value $popupContent -NoNewline

    # Build the extension with web-ext so Firefox-compatible packaging is handled automatically
    # (ignore rules live in .web-ext-config.mjs)
    try {
        web-ext build
    }
    catch {
        Write-Host "web-ext not found" -ForegroundColor Red
        Write-Host "pls run: " -NoNewline -ForegroundColor Red
        Write-Host "npm install --global web-ext" -ForegroundColor Blue
        throw "canceled"
    }

    $builtArchive = Get-ChildItem -Path web-ext-artifacts -Filter *.zip | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $builtArchive) {
        throw "web-ext did not produce a build artifact"
    }

    Write-Host "Package created successfully with Version $version ($currentDate)" -ForegroundColor Green
    
}
catch {
    Write-Host "Error creating archive: $_" -ForegroundColor Red
    pause
    exit 1
}