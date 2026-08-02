// Background script for VOE AniSkip
// Handles API requests and dynamic content script injection

const ANISKIP_API = 'https://api.aniskip.com/v2';
const ANILIST_API = 'https://graphql.anilist.co';

// Track which frames we've injected into
const injectedFrames = new Set();

// Update toolbar icon based on theme
async function updateToolbarIcon(theme) {
  const iconPath = theme === 'aniworld' ? 'icons/icon-aniworld.png' : 'icons/icon-classic.png';
  try {
    await browser.browserAction.setIcon({
      path: {
        48: iconPath,
        96: iconPath
      }
    });
  } catch (error) {
    console.error('Failed to update toolbar icon:', error);
  }
}

// Initialize icon on startup
async function initToolbarIcon() {
  const settings = await browser.storage.local.get({ uiTheme: 'classic' });
  await updateToolbarIcon(settings.uiTheme);
}

// Run on startup
initToolbarIcon();

// Generate a unique user ID for this installation
async function getUserId() {
  const result = await browser.storage.local.get('userId');
  if (result.userId) {
    return result.userId;
  }
  const userId = crypto.randomUUID();
  await browser.storage.local.set({ userId });
  return userId;
}

// Search for anime on MyAnimeList via AniList GraphQL API
async function searchAnime(query) {
  console.log('AniSkip background: Searching MAL/AniList for:', query);
  const anilistResults = await searchAniList(query);
  if (anilistResults && anilistResults.length > 0) {
    console.log('AniSkip background: AniList returned', anilistResults.length, 'results');
    return anilistResults;
  }
  console.log('AniSkip background: AniList returned nothing, falling back to Kitsu');
  return await searchKitsu(query);
}

async function searchAniList(query) {
  try {
    const response = await fetch(ANILIST_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `
          query ($search: String) {
            Page(page: 1, perPage: 10) {
              media(search: $search, type: ANIME) {
                id
                idMal
                title { english romaji }
                format
                episodes
                coverImage { medium }
              }
            }
          }
        `,
        variables: { search: query }
      })
    });
    console.log('AniSkip background: AniList response status:', response.status);
    if (!response.ok) {
      throw new Error(`AniList API error: ${response.status}`);
    }
    const data = await response.json();
    const results = (data.data?.Page?.media || [])
      .filter((anime) => anime.idMal)
      .map((anime) => ({
        mal_id: anime.idMal,
        title: anime.title?.english || anime.title?.romaji || '',
        type: anime.format,
        episodes: anime.episodes,
        images: { jpg: { small_image_url: anime.coverImage?.medium || '' } }
      }));
    console.log('AniSkip background: AniList returned', results.length, 'results');
    return results;
  } catch (error) {
    console.error('Error searching anime on AniList:', error);
    return [];
  }
}

async function searchKitsu(query) {
  try {
    const url = `https://kitsu.io/api/edge/anime?filter%5Btext%5D=${encodeURIComponent(query)}&page%5Blimit%5D=10&include=mappings`;
    const response = await fetch(url, { headers: { 'Accept': 'application/vnd.api+json' } });
    console.log('AniSkip background: Kitsu response status:', response.status);
    if (!response.ok) {
      throw new Error(`Kitsu API error: ${response.status}`);
    }
    const data = await response.json();
    const mappingById = {};
    (data.included || []).forEach((m) => {
      if (m.type === 'mappings') mappingById[m.id] = m.attributes;
    });
    const results = (data.data || [])
      .map((anime) => {
        const malMapping = (anime.relationships?.mappings?.data || [])
          .map((ref) => mappingById[ref.id])
          .find((attrs) => attrs && attrs.externalSite === 'myanimelist/anime');
        if (!malMapping) return null;
        return {
          mal_id: Number(malMapping.externalId),
          title: anime.attributes?.titles?.en || anime.attributes?.canonicalTitle || '',
          type: anime.attributes?.subtype || '',
          episodes: anime.attributes?.episodeCount,
          images: { jpg: { small_image_url: anime.attributes?.posterImage?.small || '' } }
        };
      })
      .filter(Boolean);
    console.log('AniSkip background: Kitsu returned', results.length, 'results with MAL IDs');
    return results;
  } catch (error) {
    console.error('Error searching anime on Kitsu:', error);
    return [];
  }
}

// Get skip times from AniSkip API
async function getSkipTimes(malId, episodeNumber, episodeLength) {
  try {
    const types = ['op', 'ed', 'mixed-op', 'mixed-ed', 'recap'].join('&types=');
    const url = `${ANISKIP_API}/skip-times/${malId}/${episodeNumber}?types=${types}&episodeLength=${episodeLength}`;
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) {
        return { found: false, results: [] };
      }
      throw new Error(`AniSkip API error: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error getting skip times:', error);
    return { found: false, results: [], error: error.message };
  }
}

// Submit a new skip time
async function createSkipTime(malId, episodeNumber, data) {
  try {
    const userId = await getUserId();
    const url = `${ANISKIP_API}/skip-times/${malId}/${episodeNumber}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ...data,
        submitterId: userId,
        providerName: 'voe'
      })
    });
    if (!response.ok) {
      throw new Error(`AniSkip API error: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error creating skip time:', error);
    return { error: error.message };
  }
}

// Vote on a skip time
async function voteSkipTime(skipId, voteType) {
  try {
    const url = `${ANISKIP_API}/skip-times/vote/${skipId}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ voteType })
    });
    if (!response.ok) {
      throw new Error(`AniSkip API error: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error voting on skip time:', error);
    return { error: error.message };
  }
}

// Inject content script into a frame
async function injectContentScript(tabId, frameId) {
  const frameKey = `${tabId}-${frameId}`;
  if (injectedFrames.has(frameKey)) {
    return;
  }
  
  try {
    // Inject CSS first
    await browser.tabs.insertCSS(tabId, {
      frameId: frameId,
      file: 'src/styles.css'
    });
    
    // Then inject JS
    await browser.tabs.executeScript(tabId, {
      frameId: frameId,
      file: 'src/content.js'
    });
    
    injectedFrames.add(frameKey);
    console.log('VOE AniSkip: Injected content script into frame', frameId);
  } catch (error) {
    console.error('VOE AniSkip: Failed to inject content script:', error);
  }
}

// Listen for iframe navigations from AniWorld
browser.webNavigation.onCompleted.addListener(async (details) => {
  // Only care about subframes (iframes)
  if (details.frameId === 0) return;
  
  // Skip common non-VOE iframes
  const url = details.url.toLowerCase();
  if (url.includes('facebook.com') ||
      url.includes('twitter.com') ||
      url.includes('google.com') ||
      url.includes('youtube.com') ||
      url.includes('ads') ||
      url.includes('analytics') ||
      url.includes('aniworld.to')) {
    return;
  }
  
  // Check if parent is AniWorld
  try {
    const tab = await browser.tabs.get(details.tabId);
    if (!tab.url || !tab.url.includes('aniworld.to')) {
      return;
    }
    
    console.log('VOE AniSkip: Potential VOE iframe detected:', details.url);
    
    // Inject content script into the iframe
    // The content script will check if it's actually a VOE player
    await injectContentScript(details.tabId, details.frameId);
    
  } catch (error) {
    // Tab might have been closed
  }
});

// Clean up injected frames when tab is closed or navigated
browser.tabs.onRemoved.addListener((tabId) => {
  // Remove all frame entries for this tab
  for (const key of injectedFrames) {
    if (key.startsWith(`${tabId}-`)) {
      injectedFrames.delete(key);
    }
  }
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    // Clear frame entries when tab navigates
    for (const key of injectedFrames) {
      if (key.startsWith(`${tabId}-`)) {
        injectedFrames.delete(key);
      }
    }
  }
});

// Message handler
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handleAsync = async () => {
    switch (message.action) {
      case 'searchAnime':
        return await searchAnime(message.query);
      
      case 'getSkipTimes':
        return await getSkipTimes(message.malId, message.episodeNumber, message.episodeLength);
      
      case 'createSkipTime':
        return await createSkipTime(message.malId, message.episodeNumber, message.data);
      
      case 'voteSkipTime':
        return await voteSkipTime(message.skipId, message.voteType);
      
      case 'getSettings':
        const settings = await browser.storage.local.get({
          language: 'en',
          autoSkipOp: false,
          autoSkipEd: false,
          autoSkipRecap: false,
          showButtons: true,
          alwaysShowButton: false,
          showSpeedControl: true,
          persistentSpeed: false,
          skipOffset: -5,
          playAfterSkip: false,
          nextEpisode: true,
          persistentVolume: false,
          persistentPlaybackPosition: false,
          playbackPositionExpirationDays: 7,
          markerColorOp: '#ff00fb',
          markerColorEd: '#22C55E',
          markerColorRecap: '#ffdd00',
          markerOpacity: 0.5,
          uiTheme: 'aniworld'
        });
        return settings;
      
      case 'saveSettings':
        await browser.storage.local.set(message.settings);
        // Update toolbar icon if theme changed
        if (message.settings.uiTheme) {
          await updateToolbarIcon(message.settings.uiTheme);
        }
        return { success: true };
      
      case 'getAnimeCache':
        const cache = await browser.storage.local.get('animeCache');
        return cache.animeCache || {};
      
      case 'setAnimeCache':
        const existingCache = await browser.storage.local.get('animeCache');
        const updatedCache = { ...(existingCache.animeCache || {}), ...message.cache };
        await browser.storage.local.set({ animeCache: updatedCache });
        return { success: true };
      
      case 'injectIntoFrame':
        // Request from AniWorld script to inject into a specific frame
        if (sender.tab) {
          await injectContentScript(sender.tab.id, message.frameId);
        }
        return { success: true };
      
      default:
        return { error: 'Unknown action' };
    }
  };
  
  handleAsync().then(sendResponse);
  return true; // Keep the message channel open for async response
});

console.log('VOE AniSkip background script loaded');
