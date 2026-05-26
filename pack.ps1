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
    $currentDate = Get-Date -Format "dd.MM.yy"

    # Update popup.html with version and date
    $popupPath = "src/popup.html"
    $popupContent = Get-Content $popupPath -Raw
    $popupContent = $popupContent -replace '(<span id="version"[^>]*>).*?(</span>)', "`$1v$version - $currentDate`$2"
    Set-Content -Path $popupPath -Value $popupContent -NoNewline

    # Build the extension with web-ext so Firefox-compatible packaging is handled automatically
    try {
        web-ext build --ignore-files docs META-INF .\CHANGELOG.md .\CONTRIBUTING.md .\LICENSE .\original_README.md .\pack.ps1 .\README.md .\SECURITY.md
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