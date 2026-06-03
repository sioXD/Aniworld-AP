# Changelog

All notable changes to AniWorld AP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0]

### Added
- Next Episode setting to navigate to the next episode (replaces the non-functional autoplay)

### Changed
- Play After Skip, Remember Volume, and Remember Position now default to disabled (VOE handles these automatically)
- Fixed web-ext lint warnings for cleaner code

## [1.4.7]

### Added
- New extension icon with improved visual clarity
- Enhanced icon design for better recognition

### Changed
- Updated icon appearance across all UI elements
- Improved icon visibility and scalability

## [1.4.6]

### Added
- Enhanced manual skip button functionality
- Improved button styling and responsiveness
- Better visual indicators for skip button states

### Changed
- Refined button placement and sizing
- Improved accessibility for manual skip controls

## [1.4.5]

### Added
- language selection support (German and English)
- Language preference persistence across sessions
- Localized UI elements for both languages

### Changed
- Improved settings UI for language selection

### Fixed
- UI text consistency across languages

## [1.4.4]

### Added
- Dual theme support (Classic and AniWorld themes)
- Theme switcher in settings popup
- Auto-play next episode functionality
- Configurable auto-play delay (0-30 seconds)
- Theme-specific icons and styling
- Improved visual feedback for theme selection

### Changed
- Reorganized settings UI for better clarity
- Enhanced popup interface with smoother animations
- Improved theme consistency across all UI elements
- Updated color schemes for both themes

### Fixed
- Theme persistence across browser sessions
- Settings panel layout in different themes
- Icon colors matching selected theme

## [1.4.2]

### Added
- Enhanced episode detection algorithm
- Better error handling for playback position restoration

### Changed
- Improved episode number parsing from URLs
- Optimized in-progress episode marking system

### Fixed
- Playback position not restoring correctly in some cases
- Episode progress indicators not updating immediately
- Volume settings not persisting across sessions

## [1.4.0]

### Added
- Persistent playback position memory with expiry settings
- In-progress episode visual indicators on AniWorld pages
- Language preference memory (audio/subtitle)
- Position expiry configuration (1-30 days)
- Automatic language selection on page load

### Changed
- Improved settings UI organization
- Enhanced data storage structure
- Better session management

### Fixed
- Volume reset issues between episodes
- Language selection not persisting
- Playback position conflicts

## [1.3.0]

### Added
- Progress bar markers for skip segments
- Customizable marker colors for opening/ending/recap
- Marker opacity slider
- Visual indicators on video timeline
- Color picker for each segment type

### Changed
- Improved skip offset setting (-5 to +5 seconds)
- Enhanced manual skip button styling
- Better integration with VOE player

### Fixed
- Skip buttons overlapping with player controls
- Timeline markers not appearing in some cases

## [1.2.0]

### Added
- Manual skip buttons when auto-skip is disabled
- Skip offset configuration
- Play after skip option
- Enhanced error messages

### Changed
- Improved AniSkip API integration
- Better handling of missing skip times
- Optimized API request caching

### Fixed
- Skip buttons not appearing for some episodes
- API timeout errors
- Volume persistence issues

## [1.1.0]

### Added
- Persistent volume settings across episodes
- Volume memory toggle in settings
- Remember last used volume level

### Changed
- Improved VOE player detection
- Better iframe injection handling
- Enhanced extension popup UI

### Fixed
- Volume reset on episode change
- Player controls not injecting properly
- Settings not saving correctly

## [1.0.0]

### Added
- Initial release
- Auto-skip openings, endings, and recaps
- Integration with AniSkip API
- MyAnimeList ID lookup via Jikan API
- Settings popup interface
- Basic skip configuration options
- Skip time submission feature
- Support for AniWorld.to video player

### Features
- Skip Opening toggle
- Skip Ending toggle
- Skip Recap toggle
- Show Skip Buttons option
- Manual skip functionality
- Community timestamp contribution

---

## Version History

- **v1.5.0** - Next Episode setting, default-disabled redundant features, lint fixes
- **v1.4.7** - Improved icon design
- **v1.4.6** - always show Manual skip button
- **v1.4.5** - Language selection with German and English
- **v1.4.4** - Dual themes and auto-play
- **v1.4.2** - Improved episode detection
- **v1.4.0** - Playback position memory and language preference
- **v1.3.0** - Progress bar markers and custom colors
- **v1.2.0** - Manual skip buttons and offset control
- **v1.1.0** - Persistent volume settings
- **v1.0.0** - Initial release


## Breaking Changes

None currently.

## Migration Guide

### From v1.3.x to v1.4.x
No migration needed. Settings will be preserved automatically.

### From v1.2.x to v1.3.x
Progress bar marker colors will be set to default values. You can customize them in settings.

### From v1.1.x to v1.2.x
No breaking changes. All existing settings preserved.

---

[1.4.4]: https://github.com/Ziegel8171/Aniworld-AP/releases/tag/v1.4.4
[1.4.2]: https://github.com/Ziegel8171/Aniworld-AP/releases/tag/v1.4.2
[1.4.0]: https://github.com/Ziegel8171/Aniworld-AP/releases/tag/v1.4.0
[1.3.0]: https://github.com/Ziegel8171/Aniworld-AP/releases/tag/v1.3.0
[1.2.0]: https://github.com/Ziegel8171/Aniworld-AP/releases/tag/v1.2.0
[1.1.0]: https://github.com/Ziegel8171/Aniworld-AP/releases/tag/v1.1.0
[1.0.0]: https://github.com/Ziegel8171/Aniworld-AP/releases/tag/v1.0.0
