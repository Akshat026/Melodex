// background.js — Service Worker
// The background script runs independently of any tab.
// It handles: message routing, API calls, OAuth token management, and feedback submission.
// Content scripts talk to this file via chrome.runtime.sendMessage()

// ─── Config ───────────────────────────────────────────────────────────────────
const CONFIG = {
  backendUrl: "http://localhost:3000",          // ← Update to Railway URL on deploy
  spotifyAuthUrl: "https://accounts.spotify.com/authorize",
  spotifyTokenUrl: "https://accounts.spotify.com/api/token",
  spotifyClientId: "8d5befbb9a38410b866e2ddde68e273d",    // ← Add from Spotify Developer Dashboard
  spotifyScopes: "user-read-currently-playing user-read-playback-state",
};

// ─── Extension Installed ──────────────────────────────────────────────────────
// Runs once when the extension is first installed or updated

chrome.runtime.onInstalled.addListener(() => {
  console.log("melodex installed ✅");

  // Set default settings on fresh install
  chrome.storage.local.set({
    targetLanguage: "en",
    totalTranslations: 0,
    cacheHits: 0,
    extensionEnabled: true,
  });
});

// ─── Message Router ───────────────────────────────────────────────────────────
// All messages from content.js, injector.js, and popup.js come through here.
// This is the central hub — it reads message.type and routes accordingly.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log(`melodex background: received → ${message.type}`);

  switch (message.type) {

    // Sent by translator.js when local cache misses and backend is needed
    case "FETCH_TRANSLATION":
      handleFetchTranslation(message.payload, sendResponse);
      return true; // ← IMPORTANT: keeps message channel open for async response

    // Sent by injector.js when user clicks 👍 or 👎
    case "SUBMIT_FEEDBACK":
      handleFeedback(message.payload, sendResponse);
      return true;

    // Sent by injector.js when user clicks Retry button
    case "RETRY_TRANSLATION":
      handleRetry(sender.tab);
      break;

    // Sent by popup.js when user selects a new language
    case "LANGUAGE_CHANGED":
      handleLanguageChange(message.payload, sender.tab);
      break;

    // Sent by popup.js to get live stats for display
    case "GET_STATS":
      handleGetStats(sendResponse);
      return true;

    // Sent by popup.js when user clicks Login with Spotify
    case "SPOTIFY_LOGIN":
      handleSpotifyLogin(sendResponse);
      return true;

    case "REFRESH_TOKEN":
    handleRefreshToken(sendResponse);
    return true;

    default:
      console.warn(`melodex: Unknown message type → ${message.type}`);
  }
});

async function handleRefreshToken(sendResponse) {
  const token = await refreshSpotifyToken();
  sendResponse({ success: !!token, token });
}

// ─── Handler: Fetch Translation ───────────────────────────────────────────────
// Called when translator.js has a cache miss.
// Makes the actual API call to your backend from here (avoids CORS in content script).

async function handleFetchTranslation(payload, sendResponse) {
  const { songId, title, artist, targetLanguage } = payload;

  try {
    const response = await fetch(`${CONFIG.backendUrl}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ songId, title, artist, targetLanguage }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || `Backend returned ${response.status}`);
    }

    const data = await response.json();

    // Update total translations count in storage for popup stats
    await incrementStat("totalTranslations");

    sendResponse({ success: true, data });

  } catch (error) {
    console.error("melodex: Backend fetch failed →", error.message);
    sendResponse({ success: false, error: error.message });
  }
}

// ─── Handler: Submit Feedback ─────────────────────────────────────────────────
// Called when user clicks 👍 or 👎 in the lyrics panel.
// Sends vote to backend analytics route.

async function handleFeedback(payload, sendResponse) {
  const { vote, songId, targetLanguage } = payload;

  try {
    const response = await fetch(`${CONFIG.backendUrl}/analytics/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vote,         // "up" or "down"
        songId,
        targetLanguage,
        timestamp: Date.now(),
      }),
    });

    if (!response.ok) throw new Error(`Feedback failed: ${response.status}`);

    sendResponse({ success: true });

  } catch (error) {
    console.error("melodex: Feedback submission failed →", error.message);
    sendResponse({ success: false, error: error.message });
  }
}

// ─── Handler: Retry Translation ───────────────────────────────────────────────
// Called when user clicks the Retry button in the error state.
// Sends a message back to the content script in the Spotify tab.

function handleRetry(tab) {
  if (!tab?.id) return;

  chrome.tabs.sendMessage(tab.id, { type: "RETRY_TRANSLATION" });
}

// ─── Handler: Language Changed ────────────────────────────────────────────────
// Called when user picks a new language in the popup.
// Saves new language + notifies the active Spotify tab to re-translate.

async function handleLanguageChange(payload, senderTab) {
  const { targetLanguage } = payload;

  // Save new preference
  await chrome.storage.local.set({ targetLanguage });

  // Find the active Spotify tab and tell content.js to re-translate
  const tabs = await chrome.tabs.query({ url: "https://open.spotify.com/*" });
  tabs.forEach(tab => {
    chrome.tabs.sendMessage(tab.id, {
      type: "LANGUAGE_CHANGED",
      payload: { targetLanguage },
    }).catch(() => {
      // Tab might not have content script loaded yet — safe to ignore
    });
  });
}

// ─── Handler: Get Stats ───────────────────────────────────────────────────────
// Called by popup.js to display live usage stats to the user.

async function handleGetStats(sendResponse) {
  chrome.storage.local.get(
    ["totalTranslations", "cacheHits", "targetLanguage"],
    (result) => {
      sendResponse({
        totalTranslations: result.totalTranslations || 0,
        cacheHits: result.cacheHits || 0,
        targetLanguage: result.targetLanguage || "en",
        cacheRate: calculateCacheRate(
          result.totalTranslations,
          result.cacheHits
        ),
      });
    }
  );
}

// ─── Handler: Spotify OAuth Login ────────────────────────────────────────────
// Opens the Spotify login flow using Chrome's identity API.
// Standard browser redirects don't work inside extensions — this is the correct way.

async function handleSpotifyLogin(sendResponse) {
  const redirectUrl = chrome.identity.getRedirectURL();

  const params = new URLSearchParams({
    client_id:             CONFIG.spotifyClientId,
    response_type:         "code",
    redirect_uri:          redirectUrl,
    scope:                 CONFIG.spotifyScopes,
    show_dialog:           "true",
  });

  const authUrl = `${CONFIG.spotifyAuthUrl}?${params.toString()}`;

  try {
    const responseUrl = await chrome.identity.launchWebAuthFlow({
      url:         authUrl,
      interactive: true,
    });

    // Extract code from redirect URL
    const code = new URL(responseUrl).searchParams.get("code");
    if (!code) throw new Error("No auth code returned");

    // Send code to backend to exchange for token
    const response = await fetch(`${CONFIG.backendUrl}/auth/callback`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ code, redirectUrl }),
    });

    if (!response.ok) throw new Error("Token exchange failed");

    const { access_token, refresh_token, expires_in } = await response.json();

    await chrome.storage.local.set({
      spotifyAccessToken:  access_token,
      spotifyRefreshToken: refresh_token,
      spotifyTokenExpiry:  Date.now() + expires_in * 1000,
    });

    console.log("Melodex: Spotify login successful ✅");
    sendResponse({ success: true });

  } catch (error) {
    console.error("Melodex: Spotify login failed →", error.message);
    sendResponse({ success: false, error: error.message });
  }
}

// Sends auth code to backend — backend handles the client_secret securely
async function exchangeCodeForToken(code, redirectUri) {
  const response = await fetch(`${CONFIG.backendUrl}/auth/spotify/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, redirectUri }),
  });

  if (!response.ok) throw new Error("Token exchange failed");

  return response.json();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Increments a numeric stat in chrome.storage.local
async function incrementStat(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      chrome.storage.local.set(
        { [key]: (result[key] || 0) + 1 },
        resolve
      );
    });
  });
}

// Calculates what % of translations were served from cache
function calculateCacheRate(total, hits) {
  if (!total || total === 0) return "0%";
  return `${Math.round((hits / total) * 100)}%`;
}

async function refreshSpotifyToken() {
  const result = await chrome.storage.local.get([
    "spotifyRefreshToken",
  ]);

  if (!result.spotifyRefreshToken) return null;

  try {
    const response = await fetch(`${CONFIG.backendUrl}/auth/refresh`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        refreshToken: result.spotifyRefreshToken,
      }),
    });

    if (!response.ok) return null;

    const { access_token, expires_in } = await response.json();

    await chrome.storage.local.set({
      spotifyAccessToken: access_token,
      spotifyTokenExpiry: Date.now() + expires_in * 1000,
    });

    console.log("Melodex: Token refreshed ✅");
    return access_token;

  } catch {
    return null;
  }
}