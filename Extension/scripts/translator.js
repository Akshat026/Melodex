// translator.js — Translation Handler
// Checks cache first, calls backend if not cached, returns translated lyrics.
// Called from content.js via getTranslation()

// ─── Config ───────────────────────────────────────────────────────────────────
const CONFIG = {
  backendUrl:   "http://localhost:3000",
  cacheExpiry:  7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
};

// ─── Main Function ────────────────────────────────────────────────────────────
// Called from content.js like:
// const translation = await getTranslation({ songId, title, artist, targetLanguage, lyrics, durationMs })
// Returns: { lyrics, syncedLyrics, language, translatedTitle, fromCache } or null

async function getTranslation({ songId, title, artist, targetLanguage, lyrics, durationMs }) {

  // Step 1: Check local Chrome storage cache first
  const cached = await checkLocalCache(songId, targetLanguage);
  if (cached) {
    console.log(`Melodex: Cache hit ✅ — "${title}"`);
    await trackAnalytics(songId, targetLanguage, true);
    return { ...cached, fromCache: true };
  }

  // Step 2: Not in cache — ask the backend
  console.log(`Melodex: Cache miss — fetching from backend for "${title}"`);

  try {
    const translation = await fetchFromBackend({
      songId,
      title,
      artist,
      targetLanguage,
      lyrics,
      durationMs,
    });

    if (!translation) return null;

    // Step 3: Save to local cache so next time is instant
    await saveToLocalCache(songId, targetLanguage, translation);

    // Step 4: Track analytics
    await trackAnalytics(songId, targetLanguage, false);

    return { ...translation, fromCache: false };

  } catch (error) {
    console.error("Melodex: Translation failed →", error.message);
    return null;
  }
}

// ─── Local Cache (Chrome Storage) ────────────────────────────────────────────
// Saves translations locally so repeat plays are instant — no backend call needed.

async function checkLocalCache(songId, targetLanguage) {
  return new Promise((resolve) => {
    // Check if extension context is still valid
    if (!chrome.runtime?.id) return resolve(null);

    const cacheKey = buildCacheKey(songId, targetLanguage);

    chrome.storage.local.get(cacheKey, (result) => {
      if (chrome.runtime.lastError) return resolve(null);

      const cached = result[cacheKey];

      // No cache entry found
      if (!cached) return resolve(null);

      // Cache found but expired — delete it and return null
      const isExpired = Date.now() - cached.savedAt > CONFIG.cacheExpiry;
      if (isExpired) {
        chrome.storage.local.remove(cacheKey);
        return resolve(null);
      }

      resolve(cached);
    });
  });
}

async function saveToLocalCache(songId, targetLanguage, translation) {
  return new Promise((resolve) => {
    if (!chrome.runtime?.id) return resolve();

    const cacheKey = buildCacheKey(songId, targetLanguage);

    chrome.storage.local.set({
      [cacheKey]: {
        ...translation,
        savedAt: Date.now(),
      },
    }, () => {
      if (chrome.runtime.lastError) {
        console.warn("Melodex: Cache save failed →", chrome.runtime.lastError);
      }
      resolve();
    });
  });
}

// Cache key format: "translation_4iV5W9uYEdYUVa79Axb7Rh_es"
// Unique per song + language combination
function buildCacheKey(songId, targetLanguage) {
  return `translation_${songId}_${targetLanguage}`;
}

// ─── Backend API Call ─────────────────────────────────────────────────────────
// Sends song details to your Node.js backend.
// Backend checks its own DB cache, then fetches lyrics and translates if needed.

async function fetchFromBackend({ songId, title, artist, targetLanguage, lyrics, durationMs }) {
  const response = await fetch(`${CONFIG.backendUrl}/translate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      songId,
      title,
      artist,
      targetLanguage,
      lyrics,        // Spotify page lyrics if available
      durationMs,    // Real song duration for accurate lrclib matching
    }),
  });

  // Handle non-200 responses gracefully
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Backend error: ${response.status}`);
  }

  const data = await response.json();

  // Expected response shape from backend:
  // {
  //   lyrics:          "translated lyrics string",
  //   syncedLyrics:    "[00:01.23] line...",   ← LRC format, may be null
  //   language:        "es",
  //   translatedTitle: "translated title",
  //   fromCache:       false,
  // }
  return data;
}

// ─── Analytics Tracker ────────────────────────────────────────────────────────
// Sends a lightweight event to backend to track usage.
// Never blocks the translation — runs in background silently.

async function trackAnalytics(songId, targetLanguage, fromCache) {
  // Analytics tracking is handled by backend directly on translation
  // Feedback (thumbs up/down) is tracked separately via injector.js
  return;
}