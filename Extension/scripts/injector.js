// injector.js — Lyrics DOM Injector
// Creates and manages the lyrics overlay panel on the Spotify page.
// Called from content.js via injectLyrics()

// ─── Constants ────────────────────────────────────────────────────────────────
const PANEL_ID = "melodex-panel";         // ID of our injected lyrics panel
const SPOTIFY_RIGHT_SIDEBAR = '[data-testid="Desktop_RightPanel"]'; // Where we attach

// ─── Main Function ────────────────────────────────────────────────────────────
// Called from content.js like:
// injectLyrics({ lyrics, language, fromCache })   ← normal translation
// injectLyrics({ loading: true })                 ← loading state
// injectLyrics({ error: "message" })              ← error state

function injectLyrics(data) {
  const panel = getOrCreatePanel();

  if (data.loading) {
    renderLoading(panel);
    return;
  }

  if (data.error) {
    renderError(panel, data.error);
    return;
  }

  renderLyrics(panel, data);
}

// ─── Panel Management ─────────────────────────────────────────────────────────
// Gets the existing panel or creates a new one if it doesn't exist yet.

function getOrCreatePanel() {
  const existing = document.getElementById(PANEL_ID);
  if (existing) return existing;

  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.className = "melodex-panel";

  // Force visible fixed position since Spotify's right panel isn't available
  panel.style.cssText = `
    position: fixed !important;
    bottom: 90px !important;
    right: 20px !important;
    width: 320px !important;
    max-height: 500px !important;
    z-index: 9999 !important;
    display: flex !important;
    flex-direction: column !important;
    background: #121212 !important;
    border-radius: 12px !important;
    border: 1px solid rgba(255,255,255,0.1) !important;
    overflow: hidden !important;
    font-family: sans-serif !important;
    color: white !important;
    box-shadow: 0 8px 32px rgba(0,0,0,0.6) !important;
  `;

  document.body.appendChild(panel);
  return panel;
}

// ─── Render States ────────────────────────────────────────────────────────────

// Loading state — shown while waiting for backend
function renderLoading(panel) {
  panel.innerHTML = `
    <div class="melodex-header">
      <span class="melodex-logo">🎵 Melodex</span>
    </div>
    <div class="melodex-loading">
      <div class="melodex-spinner"></div>
      <p>Fetching translation...</p>
    </div>
  `;
}

// Error state — shown when something goes wrong
function renderError(panel, message) {
  panel.innerHTML = `
    <div class="melodex-header">
      <span class="melodex-logo">🎵 Melodex </span>
    </div>
    <div class="melodex-error">
      <span class="melodex-error-icon">⚠️</span>
      <p>${sanitize(message)}</p>
      <button class="melodex-retry-btn" onclick="retryTranslation()">
        Retry
      </button>
    </div>
  `;
}

// Success state — shows translated lyrics with metadata
function renderLyrics(panel, { lyrics, language, translatedTitle, fromCache }) {
  const lines = formatLyrics(lyrics);

  panel.innerHTML = `
    <div class="melodex-header">
      <span class="melodex-logo">🎵 Melodex </span>
      <div class="melodex-meta">
        <span class="melodex-language">${getLanguageLabel(language)}</span>
        ${fromCache
          ? `<span class="melodex-cache-badge" title="Loaded from cache">⚡ Cached</span>`
          : `<span class="melodex-fresh-badge" title="Freshly translated">✨ Translated</span>`
        }
      </div>
    </div>

    ${translatedTitle
      ? `<div class="melodex-title">${sanitize(translatedTitle)}</div>`
      : ""
    }

    <div class="melodex-lyrics">
      ${lines.map(line => `
        <p class="melodex-line ${line.trim() === "" ? "melodex-break" : ""}">
          ${sanitize(line) || "&nbsp;"}
        </p>
      `).join("")}
    </div>

    <div class="melodex-footer">
      <span>Was this translation accurate?</span>
      <div class="melodex-feedback">
        <button class="melodex-thumb" data-vote="up"   onclick="submitFeedback('up')">👍</button>
        <button class="melodex-thumb" data-vote="down" onclick="submitFeedback('down')">👎</button>
      </div>
    </div>
  `;
}

// ─── Feedback ─────────────────────────────────────────────────────────────────
// Thumbs up / down — sends to backend analytics

function submitFeedback(vote) {
  // Visually confirm the vote
  const buttons = document.querySelectorAll(".melodex-thumb");
  buttons.forEach(btn => {
    btn.classList.remove("melodex-thumb-active");
    if (btn.dataset.vote === vote) {
      btn.classList.add("melodex-thumb-active");
    }
  });

  // Send to backend — reuse the trackAnalytics pattern from translator.js
  chrome.runtime.sendMessage({
    type: "SUBMIT_FEEDBACK",
    payload: { vote },
  });
}

// Retry button — tells content.js to try again
function retryTranslation() {
  chrome.runtime.sendMessage({ type: "RETRY_TRANSLATION" });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Splits raw lyrics string into individual lines
function formatLyrics(lyrics) {
  if (!lyrics) return [];
  return lyrics.split("\n");
}

// Converts language code to readable label
// e.g. "es" → "Spanish", "fr" → "French"
function getLanguageLabel(code) {
  const languages = {
    en: "English",
    es: "Spanish",
    fr: "French",
    de: "German",
    it: "Italian",
    pt: "Portuguese",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese",
    ar: "Arabic",
    hi: "Hindi",
    ru: "Russian",
  };

  return languages[code] || code.toUpperCase();
}

// IMPORTANT: Prevents XSS attacks by escaping HTML characters
// Never inject raw user/API data into innerHTML without sanitizing
function sanitize(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}