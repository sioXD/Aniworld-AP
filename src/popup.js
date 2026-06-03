// Popup script for AniWorld AP settings

// Translations object
const translations = {
  en: {
    settingsTitle: "AniWorld AP [fork] Settings",
    tagline: "Skip Intros & Outros",
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
    labelSkipOffset: "Skip Offset",
    descSkipOffset: "Seconds to add after skip",
    sectionPlayback: "Playback",
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
    labelSkipOffset: "Skip-Versatz",
    descSkipOffset: "Sekunden nach dem Skip hinzufügen",
    sectionPlayback: "Wiedergabe",
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

const settingIds = [
  'language',
  'autoSkipOp', 
  'autoSkipEd', 
  'autoSkipRecap', 
  'showButtons', 
  'alwaysShowButton',
  'skipOffset',
  'playAfterSkip',
  'persistentVolume',
  'persistentPlaybackPosition',
  'playbackPositionExpirationDays',
  'markerColorOp',
  'markerColorEd',
  'markerColorRecap',
  'markerOpacity',
  'uiTheme'
];

const colorInputIds = ['markerColorOp', 'markerColorEd', 'markerColorRecap'];

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
  colorInputIds.forEach(id => {
    const input = document.getElementById(id);
    const preview = document.getElementById(id + 'Preview');
    if (input && preview) {
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
  const showButtonsChecked = document.getElementById('showButtons').checked;
  const alwaysShowButton = document.getElementById('alwaysShowButton');
  if (alwaysShowButton) {
    const alwaysShowButtonRow = alwaysShowButton.closest('.setting-row');
    if (alwaysShowButtonRow) {
      alwaysShowButton.disabled = !showButtonsChecked;
      alwaysShowButtonRow.style.opacity = showButtonsChecked ? '1' : '0.5';
      alwaysShowButtonRow.style.pointerEvents = showButtonsChecked ? 'auto' : 'none';
    }
  }
}

// Load settings on popup open
async function loadSettings() {
  try {
    const settings = await browser.runtime.sendMessage({ action: 'getSettings' });
    
    document.getElementById('language').value = settings.language || 'en';
    document.getElementById('autoSkipOp').checked = settings.autoSkipOp || false;
    document.getElementById('autoSkipEd').checked = settings.autoSkipEd || false;
    document.getElementById('autoSkipRecap').checked = settings.autoSkipRecap || false;
    document.getElementById('showButtons').checked = settings.showButtons !== false;
    document.getElementById('alwaysShowButton').checked = settings.alwaysShowButton || false;
    document.getElementById('skipOffset').value = settings.skipOffset || 0;
    document.getElementById('playAfterSkip').checked = settings.playAfterSkip === true;
    document.getElementById('persistentVolume').checked = settings.persistentVolume === true;
    document.getElementById('persistentPlaybackPosition').checked = settings.persistentPlaybackPosition === true;
    document.getElementById('playbackPositionExpirationDays').value = settings.playbackPositionExpirationDays || 7;
    document.getElementById('markerColorOp').value = (settings.markerColorOp || '#ff00fb').toUpperCase();
    document.getElementById('markerColorEd').value = (settings.markerColorEd || '#22C55E').toUpperCase();
    document.getElementById('markerColorRecap').value = (settings.markerColorRecap || '#ffdd00').toUpperCase();
    document.getElementById('markerOpacity').value = settings.markerOpacity || 0.5;
    
    // Load theme setting
    const theme = settings.uiTheme || 'classic';
    document.getElementById('uiTheme').value = theme;
    applyTheme(theme);
    
    // Apply language
    const language = settings.language || 'en';
    applyTranslations(language);
    
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
  const settings = {
    language: document.getElementById('language').value,
    autoSkipOp: document.getElementById('autoSkipOp').checked,
    autoSkipEd: document.getElementById('autoSkipEd').checked,
    autoSkipRecap: document.getElementById('autoSkipRecap').checked,
    showButtons: document.getElementById('showButtons').checked,
    alwaysShowButton: document.getElementById('alwaysShowButton').checked,
    skipOffset: parseFloat(document.getElementById('skipOffset').value) || 0,
    playAfterSkip: document.getElementById('playAfterSkip').checked,
    persistentVolume: document.getElementById('persistentVolume').checked,
    persistentPlaybackPosition: document.getElementById('persistentPlaybackPosition').checked,
    playbackPositionExpirationDays: parseInt(document.getElementById('playbackPositionExpirationDays').value) || 7,
    markerColorOp: document.getElementById('markerColorOp').value,
    markerColorEd: document.getElementById('markerColorEd').value,
    markerColorRecap: document.getElementById('markerColorRecap').value,
    markerOpacity: parseFloat(document.getElementById('markerOpacity').value) || 0.5,
    uiTheme: document.getElementById('uiTheme').value
  };

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
  // Load theme immediately to prevent flash
  try {
    const result = await browser.storage.local.get({ uiTheme: 'classic' });
    document.body.setAttribute('data-theme', result.uiTheme);
  } catch (e) {
    document.body.setAttribute('data-theme', 'classic');
  }

  loadSettings();
  initColorPicker();
  
  // Setup dependency listeners
  const showButtonsEl = document.getElementById('showButtons');
  if (showButtonsEl) {
    showButtonsEl.addEventListener('change', updateDependentSettings);
  }
  
  // Add change listeners to all settings
  settingIds.forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      // Skip color inputs - they have special handling
      if (colorInputIds.includes(id)) {
        // Handle direct text input in color fields
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
    }
  });

  // Add click handlers for color buttons
  colorInputIds.forEach(id => {
    const btn = document.getElementById(id + 'Btn');
    if (btn) {
      btn.addEventListener('click', () => openColorPicker(id));
    }
  });
});
