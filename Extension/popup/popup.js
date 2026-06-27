// popup.js — Popup UI Logic
// Handles language selection, stats display, login/logout, and cache clearing.
// Communicates with background.js via chrome.runtime.sendMessage()

// ─── DOM References ───────────────────────────────────────────────────────────
const loginSection    = document.getElementById("loginSection");
const mainSection     = document.getElementById("mainSection");
const loginBtn        = document.getElementById("loginBtn");
const logoutBtn       = document.getElementById("logoutBtn");
const extensionToggle = document.getElementById("extensionToggle");
const languageSelect  = document.getElementById("languageSelect");
const clearCacheBtn   = document.getElementById("clearCacheBtn");
const toast           = document.getElementById("toast");

// Stat display elements
const statTranslations = document.getElementById("statTranslations");
const statCacheHits    = document.getElementById("statCacheHits");
const statCacheRate    = document.getElementById("statCacheRate");

// ─── Init ─────────────────────────────────────────────────────────────────────
// Runs as soon as the popup opens

document.addEventListener("DOMContentLoaded", async () => {
  await loadStoredSettings();
  await loadStats();
  setupListeners();
});

// ─── Load Settings ────────────────────────────────────────────────────────────
// Reads saved state from chrome.storage and applies it to the UI

async function loadStoredSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get([
      "targetLanguage",
      "extensionEnabled", 
      "spotifyAccessToken",
    ], (result) => {
      const isLoggedIn = !!result.spotifyAccessToken;
      const isEnabled  = result.extensionEnabled !== false;

      console.log("isLoggedIn:", isLoggedIn); // debug check
      console.log("token:", result.spotifyAccessToken); // debug check

      // Force correct display
      toggleAuthView(isLoggedIn);

      extensionToggle.checked = isEnabled;

      if (result.targetLanguage) {
        languageSelect.value = result.targetLanguage;
      }

      resolve();
    });
  });
}

// ─── Load Stats ───────────────────────────────────────────────────────────────
// Asks background.js for usage stats and renders them

async function loadStats() {
  chrome.runtime.sendMessage({ type: "GET_STATS" }, (response) => {
    if (chrome.runtime.lastError || !response) return;

    statTranslations.textContent = response.totalTranslations ?? 0;
    statCacheHits.textContent    = response.cacheHits ?? 0;
    statCacheRate.textContent    = response.cacheRate ?? "0%";
  });
}

// ─── Setup Listeners ──────────────────────────────────────────────────────────

function setupListeners() {

  // Login button → trigger Spotify OAuth via background.js
  loginBtn.addEventListener("click", handleLogin);

  // Logout button → clear tokens and reset view
  logoutBtn.addEventListener("click", handleLogout);

  // Language dropdown → save + notify content script
  languageSelect.addEventListener("change", handleLanguageChange);

  // Extension toggle → enable/disable translation
  extensionToggle.addEventListener("change", handleToggle);

  // Clear cache button → wipe all stored translations
  clearCacheBtn.addEventListener("click", handleClearCache);
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

// Spotify Login
async function handleLogin() {
  loginBtn.textContent = "Connecting...";
  loginBtn.disabled    = true;

  chrome.runtime.sendMessage({ type: "SPOTIFY_LOGIN" }, (response) => {
    if (response?.success) {
      toggleAuthView(true);
      loadStats();
      showToast("Connected to Spotify ✅");
    } else {
      showToast("Login failed. Try again.", "error");
    }

    loginBtn.textContent = "Login with Spotify";
    loginBtn.disabled    = false;
  });
}

// Logout
async function handleLogout() {
  await chrome.storage.local.remove([
    "spotifyAccessToken",
    "spotifyRefreshToken",
    "spotifyTokenExpiry",
  ]);

  toggleAuthView(false);
  showToast("Logged out.");
}

// Language Change
function handleLanguageChange() {
  const targetLanguage = languageSelect.value;

  // Save to storage
  chrome.storage.local.set({ targetLanguage });

  // Notify background.js → which notifies the Spotify tab
  chrome.runtime.sendMessage({
    type: "LANGUAGE_CHANGED",
    payload: { targetLanguage },
  });

  showToast(`Language set to ${getLanguageLabel(targetLanguage)} ✅`);
}

// Extension Toggle
function handleToggle() {
  const isEnabled = extensionToggle.checked;

  chrome.storage.local.set({ extensionEnabled: isEnabled });

  // Notify active Spotify tab
  chrome.runtime.sendMessage({
    type: "EXTENSION_TOGGLED",
    payload: { isEnabled },
  });

  showToast(isEnabled ? "melodex enabled ✅" : "melodex paused ⏸");
}

// Clear Cache
async function handleClearCache() {
  clearCacheBtn.textContent = "Clearing...";
  clearCacheBtn.disabled    = true;

  // Get all keys in storage and remove only translation cache entries
  chrome.storage.local.get(null, (allItems) => {
    const cacheKeys = Object.keys(allItems).filter(key =>
      key.startsWith("translation_")
    );

    chrome.storage.local.remove(cacheKeys, () => {
      // Reset cache stats
      chrome.storage.local.set({ cacheHits: 0 }, () => {
        loadStats(); // refresh displayed stats
        showToast(`Cleared ${cacheKeys.length} cached translations 🗑`);

        clearCacheBtn.textContent = "🗑 Clear Cache";
        clearCacheBtn.disabled    = false;
      });
    });
  });
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

// Shows login section or main section based on auth state
function toggleAuthView(isLoggedIn) {
  // Remove hidden attribute AND set display
  if (isLoggedIn) {
    loginSection.setAttribute("hidden", "");
    mainSection.removeAttribute("hidden");
    mainSection.style.display = "flex";
  } else {
    mainSection.setAttribute("hidden", "");
    loginSection.removeAttribute("hidden");
    loginSection.style.display = "flex";
  }
}

// Shows a brief status message at the bottom of the popup
// Auto-hides after 2.5 seconds
let toastTimer = null;

function showToast(message, type = "success") {
  toast.textContent = message;
  toast.className   = `popup-toast popup-toast-${type}`;
  toast.hidden      = false;

  // Clear any existing timer so toasts don't stack
  if (toastTimer) clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 2500);
}

// Converts language code to readable name
function getLanguageLabel(code) {
  const labels = {
    en: "English", es: "Spanish",  fr: "French",
    de: "German",  it: "Italian",  pt: "Portuguese",
    ja: "Japanese", ko: "Korean",  zh: "Chinese",
    ar: "Arabic",  hi: "Hindi",    ru: "Russian",
  };
  return labels[code] || code.toUpperCase();
}