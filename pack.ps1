# Remove any existing zip file
if (Test-Path aniworld-ap.zip) {
    Remove-Item aniworld-ap.zip
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

    # Create new zip archive
    Compress-Archive -Path manifest.json, src, icons -DestinationPath aniworld-ap.zip -Force
    
    # Rename-Item -Path aniworld-ap.zip -NewName aniworld-ap.xpi -Force
    Write-Host "Archive created successfully with Version $version ($currentDate)" -ForegroundColor Green
    
}
catch {
    Write-Host "Error creating archive: $_" -ForegroundColor Red
    pause
    exit 1
}