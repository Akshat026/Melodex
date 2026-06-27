// detector.js — Song Change Detector
// Uses MutationObserver to watch Spotify's DOM for song changes.
// Calls a callback function whenever a new song is detected.

// ─── Spotify DOM Selectors ────────────────────────────────────────────────────
// ⚠️ WARNING: Spotify updates their UI occasionally and these selectors may break.
//             If detection stops working, inspect the Spotify DOM and update these.

const SELECTORS = {
  songTitle:  '[data-testid="context-item-info-title"]',
  artist:     '[data-testid="context-item-info-subtitles"]',
  trackLink:  '[data-testid="context-item-info-title"] a',
  duration:   '[data-testid="playback-duration"]',
};

// ─── State ────────────────────────────────────────────────────────────────────
let lastSongId = null;
let observer   = null;

// ─── Main Function ────────────────────────────────────────────────────────────
// Called from content.js like: startDetecting((song) => { ... })
// `callback` receives: { id, title, artist, durationMs }

function startDetecting(callback) {
  console.log("melodex: Starting song detector...");

  // Step 1: Check immediately in case a song is already playing
  detectSong(callback);

  // Step 2: Watch the entire body for DOM changes
  observer = new MutationObserver(() => {
    detectSong(callback);
  });

  observer.observe(document.body, {
    childList: true,  // watch for elements being added/removed
    subtree:   true,  // watch ALL descendants, not just direct children
  });

  console.log("melodex: Detector running ✅");
}

// ─── Stop Detecting ───────────────────────────────────────────────────────────
function stopDetecting() {
  if (observer) {
    observer.disconnect();
    observer = null;
    console.log("melodex: Detector stopped.");
  }
}

// ─── Core Detection Logic ─────────────────────────────────────────────────────
// Reads the current song from Spotify's DOM.
// Only fires the callback if the song has actually changed.

function detectSong(callback) {
  const titleEl    = document.querySelector(SELECTORS.songTitle);
  const artistEl   = document.querySelector(SELECTORS.artist);
  const linkEl     = document.querySelector(SELECTORS.trackLink);
  const durationEl = document.querySelector(SELECTORS.duration);

  // If elements are missing, Spotify's player isn't visible yet — skip
  if (!titleEl || !artistEl) return;

  const title  = titleEl.innerText.trim();
  const artist = artistEl.innerText.trim().split(",")[0].trim(); // first artist only
  const songId = extractSongId(linkEl) || generateFallbackId(title, artist);

  // Parse duration string to milliseconds
  const durationMs = parseDuration(durationEl?.innerText?.trim());

  // Only fire callback if the song has actually changed
  if (!title || songId === lastSongId) return;

  lastSongId = songId;

  const song = { id: songId, title, artist, durationMs };

  console.log(`melodex: New song → "${title}" by ${artist} (ID: ${songId})`);

  callback(song);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Extracts Spotify's track ID from the href link
// e.g. href="/track/4iV5W9uYEdYUVa79Axb7Rh" → "4iV5W9uYEdYUVa79Axb7Rh"
function extractSongId(linkEl) {
  if (!linkEl) return null;

  const href  = linkEl.getAttribute("href") || "";
  const match = href.match(/\/track\/([a-zA-Z0-9]+)/);

  return match ? match[1] : null;
}

// Fallback if the track link isn't present (e.g. local files, podcasts)
// Creates a simple unique key from title + artist
function generateFallbackId(title, artist) {
  return `${title}-${artist}`
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

// Converts "3:18" → 198000ms, "1:03:45" → 3825000ms
// Defaults to 4 minutes if parsing fails
function parseDuration(str) {
  if (!str) return 240000;

  const parts = str.split(":").map(Number);

  if (parts.length === 2) {
    // mm:ss format
    return (parts[0] * 60 + parts[1]) * 1000;
  }

  if (parts.length === 3) {
    // hh:mm:ss format
    return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  }

  return 240000;
}