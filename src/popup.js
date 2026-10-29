// Popup script for AniWorld AP settings

// Translations object
const translations = {
  en: {
    settingsTitle: "AniWorld AP [fork] Settings",
    tagline: "Skip Intros & Outros",
    tabGeneral: "General",
    tabStyles: "Styles",
    tabAdvanced: "Advanced",
    sectionAppearance: "Appearance",
    labelLanguage: "Language",
    descLanguage: "Choose your preferred language",
    langEnglish: "English",
    langGerman: "German",
    labelUiTheme: "UI Theme",
    descUiTheme: "Choose your preferred style",
    themeAniworld: "AniWorld",
    themeClassic: "Classic",
    sectionAutoSkip: "Auto Skip",
    labelSkipOpening: "Skip Opening",
    descSkipOpening: "Auto-skip anime intros",
    labelSkipEnding: "Skip Ending",
    descSkipEnding: "Auto-skip anime outros",
    labelSkipRecap: "Skip Recap",
    descSkipRecap: "Auto-skip recap segments",
    sectionDisplay: "Display",
    labelShowButtons: "Show Skip Buttons",
    descShowButtons: "Display manual skip buttons",
    labelAlwaysShowButton: "Always Show Skip Button",
    descAlwaysShowButton: "Skip 90s if no OP/ED is playing",
    labelShowSpeedControl: "Show Speed Control",
    descShowSpeedControl: "Show speed adjustment buttons",
    labelPersistentSpeed: "Persistent Speed",
    descPersistentSpeed: "Remember speed across episodes",
    labelSkipOffset: "Skip Offset",
    descSkipOffset: "Seconds to add after skip",
    sectionPlayback: "Playback",
    labelNextEpisode: "Next Episode",
    descNextEpisode: "Auto navigate to the next episode",
    labelShowNextEpisodeButton: "Next Episode Button",
    descShowNextEpisodeButton: "Show a button in the player to jump to the next episode",
    labelPlayAfterSkip: "Play After Skip",
    descPlayAfterSkip: "Resume playback after skipping",
    labelRememberVolume: "Remember Volume",
    descRememberVolume: "Persist volume across episodes",
    labelRememberPosition: "Remember Position",
    descRememberPosition: "Resume where you left off",
    labelPositionExpiry: "Position Expiry",
    descPositionExpiry: "Days until position resets",
    sectionColors: "Progress Bar Colors",
    labelOpeningMarker: "Opening Marker",
    descOpeningMarker: "Intro segment color",
    labelEndingMarker: "Ending Marker",
    descEndingMarker: "Outro segment color",
    labelRecapMarker: "Recap Marker",
    descRecapMarker: "Recap segment color",
    labelMarkerOpacity: "Marker Opacity",
    descMarkerOpacity: "Transparency (0.1 - 1.0)",
    footerSaved: "Saved",
    colorPickerTitle: "Choose Color",
    colorPickerCancel: "Cancel",
    colorPickerApply: "Apply"
  },
  de: {
    settingsTitle: "AniWorld AP [fork] Einstellungen",
    tagline: "Intros & Outros überspringen",
    tabGeneral: "Allgemein",
    tabStyles: "Design",
    tabAdvanced: "Erweitert",
    sectionAppearance: "Darstellung",
    labelLanguage: "Sprache",
    descLanguage: "Wähle deine bevorzugte Sprache",
    langEnglish: "Englisch",
    langGerman: "Deutsch",
    labelUiTheme: "UI-Design",
    descUiTheme: "Wähle deinen bevorzugten Stil",
    themeAniworld: "AniWorld",
    themeClassic: "Klassisch",
    sectionAutoSkip: "Auto-Skip",
    labelSkipOpening: "Intro überspringen",
    descSkipOpening: "Anime-Intros automatisch überspringen",
    labelSkipEnding: "Outro überspringen",
    descSkipEnding: "Anime-Outros automatisch überspringen",
    labelSkipRecap: "Recap überspringen",
    descSkipRecap: "Zusammenfassungen automatisch überspringen",
    sectionDisplay: "Anzeige",
    labelShowButtons: "Skip-Buttons anzeigen",
    descShowButtons: "Manuelle Skip-Buttons anzeigen",
    labelAlwaysShowButton: "Skip-Button immer anzeigen",
    descAlwaysShowButton: "90s überspringen wenn kein OP/ED läuft",
    labelShowSpeedControl: "Geschwindigkeit anzeigen",
    descShowSpeedControl: "Geschwindigkeitsregler anzeigen",
    labelPersistentSpeed: "Geschwindigkeit merken",
    descPersistentSpeed: "Geschwindigkeit über Episoden merken",
    labelSkipOffset: "Skip-Versatz",
    descSkipOffset: "Sekunden nach dem Skip hinzufügen",
    sectionPlayback: "Wiedergabe",
    labelNextEpisode: "Nächste Folge",
    descNextEpisode: "Automatisch zur nächsten Folge navigieren",
    labelShowNextEpisodeButton: "Nächste-Folge-Button",
    descShowNextEpisodeButton: "Button im Player anzeigen, um zur nächsten Folge zu springen",
    labelPlayAfterSkip: "Nach Skip abspielen",
    descPlayAfterSkip: "Wiedergabe nach dem Überspringen fortsetzen",
    labelRememberVolume: "Lautstärke merken",
    descRememberVolume: "Lautstärke über Episoden beibehalten",
    labelRememberPosition: "Position merken",
    descRememberPosition: "Dort fortsetzen, wo du aufgehört hast",
    labelPositionExpiry: "Position-Ablauf",
    descPositionExpiry: "Tage bis Position zurückgesetzt wird",
    sectionColors: "Fortschrittsbalken-Farben",
    labelOpeningMarker: "Intro-Markierung",
    descOpeningMarker: "Intro-Segment Farbe",
    labelEndingMarker: "Outro-Markierung",
    descEndingMarker: "Outro-Segment Farbe",
    labelRecapMarker: "Recap-Markierung",
    descRecapMarker: "Zusammenfassungs-Segment Farbe",
    labelMarkerOpacity: "Markierungs-Deckkraft",
    descMarkerOpacity: "Transparenz (0.1 - 1.0)",
    footerSaved: "Gespeichert",
    colorPickerTitle: "Farbe wählen",
    colorPickerCancel: "Abbrechen",
    colorPickerApply: "Anwenden"
  }
};

// Apply translations based on selected language
function applyTranslations(lang) {
  const t = translations[lang] || translations.en;
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    if (t[key]) {
      element.textContent = t[key];
    }
  });
  document.title = t.settingsTitle || 'AniWorld AP [fork] Settings';
}

// Every setting is an <input> or <select> inside a .setting-row, so the
// controls are collected from the DOM instead of a hand-maintained id list.
// Adding a setting = one row in popup.html + one entry in defaults.js.
function getSettingElements() {
  return Array.from(document.querySelectorAll('.setting-row input, .setting-row select'));
}

function getColorInputs() {
  return Array.from(document.querySelectorAll('.color-text-input'));
}

// Read a control's value, keeping the type of its default
function readSettingValue(element) {
  const fallback = DEFAULT_SETTINGS[element.id];

  if (element.type === 'checkbox') {
    return element.checked;
  }

  if (typeof fallback === 'number') {
    const value = parseFloat(element.value);
    return Number.isFinite(value) ? value : fallback;
  }

  return element.value;
}

// Write a stored value into a control
function writeSettingValue(element, value) {
  if (element.type === 'checkbox') {
    element.checked = Boolean(value);
    return;
  }

  if (element.classList.contains('color-text-input')) {
    element.value = String(value).toUpperCase();
    return;
  }

  element.value = value;
}

// Render DEFAULT_SETTINGS immediately so the popup never shows empty controls
// while the stored settings are still being loaded.
function renderDefaultSettings() {
  getSettingElements().forEach(element => {
    const value = DEFAULT_SETTINGS[element.id];
    if (value === undefined) return;
    writeSettingValue(element, value);
  });
  updateColorPreviews();
  updateDependentSettings();
}

// Preset colors for the color picker
const presetColors = [
  '#ff0000', '#ff4444', '#ff8800', '#ffbb00', '#ffff00', '#bbff00', '#88ff00', '#00ff00',
  '#00ff88', '#00ffbb', '#00ffff', '#00bbff', '#0088ff', '#0044ff', '#0000ff', '#4400ff',
  '#8800ff', '#bb00ff', '#ff00ff', '#ff00bb', '#ff0088', '#ff0044', '#ffffff', '#888888',
  '#ff00fb', '#7c3aed', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#000000'
];

// Color picker state
let currentColorTarget = null;
let currentColorValue = null;

// Update color preview buttons
function updateColorPreviews() {
  getColorInputs().forEach(input => {
    const preview = document.getElementById(input.id + 'Preview');
    if (preview) {
      preview.style.backgroundColor = input.value;
    }
  });
}

// Validate hex color
function isValidHex(hex) {
  return /^#[0-9A-Fa-f]{6}$/.test(hex);
}

// Normalize hex input
function normalizeHex(value) {
  let hex = value.trim();
  if (!hex.startsWith('#')) {
    hex = '#' + hex;
  }
  return hex.toUpperCase();
}

// Initialize color picker modal
function initColorPicker() {
  const modal = document.getElementById('colorPickerModal');
  const presetsContainer = document.getElementById('colorPresets');
  const customInput = document.getElementById('colorPickerCustomInput');
  const customPreview = document.getElementById('colorPickerCustomPreview');
  const closeBtn = document.getElementById('colorPickerClose');
  const cancelBtn = document.getElementById('colorPickerCancel');
  const applyBtn = document.getElementById('colorPickerApply');

  // Generate preset color buttons
  presetColors.forEach(color => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'color-preset';
    btn.style.backgroundColor = color;
    btn.dataset.color = color;
    btn.addEventListener('click', () => selectPresetColor(color));
    presetsContainer.appendChild(btn);
  });

  // Custom input handling
  customInput.addEventListener('input', () => {
    let value = normalizeHex(customInput.value);
    if (isValidHex(value)) {
      currentColorValue = value;
      customPreview.style.backgroundColor = value;
      updatePresetSelection(value);
    }
  });

  customInput.addEventListener('blur', () => {
    if (currentColorValue) {
      customInput.value = currentColorValue;
    }
  });

  // Close handlers
  closeBtn.addEventListener('click', closeColorPicker);
  cancelBtn.addEventListener('click', closeColorPicker);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeColorPicker();
  });

  // Apply handler
  applyBtn.addEventListener('click', applyColor);

  // Keyboard handling
  document.addEventListener('keydown', (e) => {
    if (modal.classList.contains('active')) {
      if (e.key === 'Escape') closeColorPicker();
      if (e.key === 'Enter') applyColor();
    }
  });
}

// Select a preset color
function selectPresetColor(color) {
  currentColorValue = color.toUpperCase();
  document.getElementById('colorPickerCustomInput').value = currentColorValue;
  document.getElementById('colorPickerCustomPreview').style.backgroundColor = color;
  updatePresetSelection(color);
}

// Update preset selection visual
function updatePresetSelection(selectedColor) {
  const presets = document.querySelectorAll('.color-preset');
  presets.forEach(preset => {
    if (preset.dataset.color.toUpperCase() === selectedColor.toUpperCase()) {
      preset.classList.add('selected');
    } else {
      preset.classList.remove('selected');
    }
  });
}

// Open color picker
function openColorPicker(targetId) {
  const input = document.getElementById(targetId);
  if (!input) return;

  currentColorTarget = targetId;
  currentColorValue = input.value.toUpperCase();

  const modal = document.getElementById('colorPickerModal');
  const customInput = document.getElementById('colorPickerCustomInput');
  const customPreview = document.getElementById('colorPickerCustomPreview');

  customInput.value = currentColorValue;
  customPreview.style.backgroundColor = currentColorValue;
  updatePresetSelection(currentColorValue);

  modal.classList.add('active');
  customInput.focus();
}

// Close color picker
function closeColorPicker() {
  const modal = document.getElementById('colorPickerModal');
  modal.classList.remove('active');
  currentColorTarget = null;
  currentColorValue = null;
}

// Apply selected color
function applyColor() {
  if (currentColorTarget && currentColorValue && isValidHex(currentColorValue)) {
    const input = document.getElementById(currentColorTarget);
    if (input) {
      input.value = currentColorValue;
      updateColorPreviews();
      saveSettings();
    }
  }
  closeColorPicker();
}

// Update conditional settings UI states
function updateDependentSettings() {
  document.querySelectorAll('.setting-row[data-depends-on]').forEach(row => {
    const dependsOn = row.dataset.dependsOn;
    const parentInput = document.getElementById(dependsOn);
    const childInput = row.querySelector('input, select');
    const enabled = parentInput && parentInput.checked;

    if (childInput) childInput.disabled = !enabled;
    row.classList.toggle('is-disabled', !enabled);
    row.style.pointerEvents = enabled ? 'auto' : 'none';
  });
}

// Tab navigation: exactly one panel is visible at a time
function initTabs() {
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const panels = Array.from(document.querySelectorAll('.tab-panel'));
  if (!tabs.length || !panels.length) return;

  function activate(name) {
    // Lets CSS round the panel corners the active tab does not sit on
    document.body.dataset.activeTab = name;

    tabs.forEach(tab => {
      const isActive = tab.dataset.tab === name;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
      tab.tabIndex = isActive ? 0 : -1;
    });

    panels.forEach(panel => {
      panel.classList.toggle('active', panel.dataset.panel === name);
    });
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => activate(tab.dataset.tab));

    // Arrow keys move between tabs
    tab.addEventListener('keydown', event => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const index = tabs.indexOf(tab);
      const next = event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : (index - 1 + tabs.length) % tabs.length;
      tabs[next].focus();
      activate(tabs[next].dataset.tab);
    });
  });

  // Always open on the first tab
  activate(tabs[0].dataset.tab);
}

// Load settings on popup open
async function loadSettings() {
  try {
    const settings = await browser.runtime.sendMessage({ action: 'getSettings' });

    // Fill every control from the settings object — the background already
    // applied DEFAULT_SETTINGS, so no per-field fallbacks are needed here.
    getSettingElements().forEach(element => {
      const value = settings[element.id] !== undefined
        ? settings[element.id]
        : DEFAULT_SETTINGS[element.id];
      writeSettingValue(element, value);
    });

    // Apply theme and language
    applyTheme(settings.uiTheme || DEFAULT_SETTINGS.uiTheme);
    applyTranslations(settings.language || DEFAULT_SETTINGS.language);

    updateColorPreviews();
    updateDependentSettings();
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

// Apply theme to the UI
function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
}

// Save settings
async function saveSettings() {
  const settings = {};
  getSettingElements().forEach(element => {
    settings[element.id] = readSettingValue(element);
  });

  // Apply theme immediately
  applyTheme(settings.uiTheme);
  
  // Apply language immediately
  applyTranslations(settings.language);

  try {
    await browser.runtime.sendMessage({ action: 'saveSettings', settings });
    
    // Show save indicator
    const indicator = document.getElementById('saveIndicator');
    indicator.classList.add('visible');
    setTimeout(() => indicator.classList.remove('visible'), 1500);
    
    // Notify content script of settings change
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      browser.tabs.sendMessage(tabs[0].id, { action: 'settingsUpdated', settings }).catch(() => {});
    }
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

// Add event listeners
document.addEventListener('DOMContentLoaded', async () => {
  // Fill the UI from the defaults first, then overwrite with stored settings
  renderDefaultSettings();
  initTabs();

  // Load theme immediately to prevent flash
  try {
    const result = await browser.storage.local.get({ uiTheme: DEFAULT_SETTINGS.uiTheme });
    document.body.setAttribute('data-theme', result.uiTheme);
  } catch (e) {
    document.body.setAttribute('data-theme', DEFAULT_SETTINGS.uiTheme);
  }

  loadSettings();
  initColorPicker();
  
  // Setup dependency listeners
  const showButtonsEl = document.getElementById('showButtons');
  if (showButtonsEl) {
    showButtonsEl.addEventListener('change', updateDependentSettings);
  }

  const showSpeedControlEl = document.getElementById('showSpeedControl');
  if (showSpeedControlEl) {
    showSpeedControlEl.addEventListener('change', updateDependentSettings);
  }
  
  // Add change listeners to all settings
  getSettingElements().forEach(element => {
    // Color inputs have their own validation path
    if (element.classList.contains('color-text-input')) {
      element.addEventListener('change', () => {
        let value = normalizeHex(element.value);
        if (isValidHex(value)) {
          element.value = value;
          updateColorPreviews();
          saveSettings();
        }
      });
      return;
    }

    element.addEventListener('change', saveSettings);
    if (element.type === 'number') {
      element.addEventListener('input', saveSettings);
    }
  });

  // Add click handlers for color buttons
  getColorInputs().forEach(input => {
    const btn = document.getElementById(input.id + 'Btn');
    if (btn) {
      btn.addEventListener('click', () => openColorPicker(input.id));
    }
  });
});
