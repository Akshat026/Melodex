// content.js — Main Orchestrator

// ─── State ────────────────────────────────────────────────────────────────────
let currentSongId      = null;
let isTranslating      = false;
let syncInterval       = null;
let fetchLoopInterval  = null;
let lastKnownProgress  = 0;
let lastFetchTimestamp = 0;
let isCurrentlyPlaying = true;
let syncSessionId      = 0; // incremented on every new sync — cancels stale fetches

// ─── Initialization ───────────────────────────────────────────────────────────
function init() {
  console.log("melodex Pro loaded ✅");

  chrome.storage.local.get("targetLanguage", (result) => {
    const targetLanguage = result.targetLanguage || "en";
    startDetecting((song) => {
      onSongChanged(song, targetLanguage);
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "LANGUAGE_CHANGED") currentSongId = null;
    if (message.type === "RETRY_TRANSLATION") currentSongId = null;
  });
}

// ─── Song Change Handler ──────────────────────────────────────────────────────
async function onSongChanged(song, targetLanguage) {
  if (!song || song.id === currentSongId || isTranslating) return;

  currentSongId = song.id;
  isTranslating = true;

  stopLyricSync();

  try {
    showLoading();

    const spotifyLyrics = getSpotifyLyrics();

    const translation = await getTranslation({
      songId:     song.id,
      title:      song.title,
      artist:     song.artist,
      targetLanguage,
      lyrics:     spotifyLyrics,
      durationMs: song.durationMs || 240000,
    });

    if (translation) {
      injectLyrics(translation);

      if (translation.syncedLyrics) {
        const timestamps = parseLRC(translation.syncedLyrics);
        if (timestamps.length > 0) {
          startTimestampSync(timestamps, song.durationMs || 240000);
        } else {
          startLinearSync(translation.lyrics, song.durationMs || 240000);
        }
      } else if (translation.lyrics) {
        startLinearSync(translation.lyrics, song.durationMs || 240000);
      }
    } else {
      showError("Translation not available for this song.");
    }

  } catch (error) {
    console.error("melodex error:", error);
    showError("Something went wrong. Try again.");
  } finally {
    isTranslating = false;
  }
}

// ─── Spotify Lyrics Reader ────────────────────────────────────────────────────
function getSpotifyLyrics() {
  const containers = document.querySelectorAll('[data-testid="lyrics-container"]');
  if (!containers.length) return null;

  const lines = [];
  containers.forEach(container => {
    container.querySelectorAll("p, span").forEach(el => {
      const text = el.innerText?.trim();
      if (text) lines.push(text);
    });
  });

  return lines.length ? lines.join("\n") : null;
}

// ─── LRC Parser ───────────────────────────────────────────────────────────────
function parseLRC(lrcText) {
  if (!lrcText) return [];

  const result = [];

  for (const line of lrcText.split("\n")) {
    const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/);
    if (!match) continue;

    const minutes = parseInt(match[1]);
    const seconds = parseInt(match[2]);
    const ms      = parseInt(match[3].padEnd(3, "0"));
    const text    = match[4].trim();

    if (!text || text === "♪") continue;

    result.push({
      timeMs: (minutes * 60 + seconds) * 1000 + ms,
      text,
    });
  }

  return result.sort((a, b) => a.timeMs - b.timeMs);
}

// ─── Make Fetch Progress Function ─────────────────────────────────────────────
// Each call creates a fetch function bound to a session ID.
// If the session has changed by the time the fetch completes, result is discarded.
function makeFetchProgress(sessionId, getToken, setToken) {
  return async function fetchProgress() {
    // Session already cancelled — don't run
    if (syncSessionId !== sessionId) return;

    const fetchStart = Date.now();
    let   fetchInFlight = true;

    try {
      const token    = getToken();
      const response = await fetch("https://api.spotify.com/v1/me/player", {
        headers: { "Authorization": `Bearer ${token}` }
      });

      // Session changed while we were waiting — discard result
      if (syncSessionId !== sessionId) return;

      if (response.status === 401) {
        console.log("Melodex: Token expired, refreshing...");
        const refresh = await new Promise(resolve =>
          chrome.runtime.sendMessage({ type: "REFRESH_TOKEN" }, resolve)
        );
        if (syncSessionId !== sessionId) return; // check again after await
        if (refresh?.token) {
          setToken(refresh.token);
        } else {
          stopLyricSync();
        }
        return;
      }

      if (!response.ok) return;

      const data         = await response.json();
      if (syncSessionId !== sessionId) return; // final check

      const networkDelay = Date.now() - fetchStart;

      isCurrentlyPlaying = data?.is_playing ?? true;
      lastKnownProgress  = (data?.progress_ms ?? lastKnownProgress)
                         + Math.floor(networkDelay / 2);
      lastFetchTimestamp = Date.now();

    } catch {
      // Silently ignore network errors
    }
  };
}

// ─── Timestamp-Based Sync (Precise) ──────────────────────────────────────────
async function startTimestampSync(timestamps, songDurationMs) {
  stopLyricSync();

  if (!timestamps.length) return;

  // New session — all previous fetches are now stale
  const sessionId = ++syncSessionId;

  const stored = await new Promise(resolve =>
    chrome.storage.local.get("spotifyAccessToken", resolve)
  );

  let token = stored.spotifyAccessToken;
  if (!token) return;

  // Guard: session may have changed while waiting for storage
  if (syncSessionId !== sessionId) return;

  const fetchProgress = makeFetchProgress(
    sessionId,
    ()  => token,
    (t) => { token = t; }
  );

  // Re-sync when tab becomes visible
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      console.log("Melodex: Tab visible — re-syncing...");
      fetchProgress();
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  window._melodexVisibilityHandler = onVisibilityChange;

  // 100ms render loop
  syncInterval = setInterval(() => {
    if (!isCurrentlyPlaying) return;

    // Cap elapsed to 3s — prevents runaway jumps when tab was backgrounded
    const elapsed   = Math.min(Date.now() - lastFetchTimestamp, 3000);
    const currentMs = Math.min(lastKnownProgress + elapsed, songDurationMs);

    // Direct 1:1 timestamp match — no proportional guessing
    let activeIndex = 0;
    for (let i = 0; i < timestamps.length; i++) {
      if (timestamps[i].timeMs <= currentMs) {
        activeIndex = i;
      } else {
        break;
      }
    }

    highlightLine(activeIndex);
  }, 100);

  // Fetch immediately, then every 2s for drift correction
  fetchProgress();
  fetchLoopInterval = setInterval(fetchProgress, 2000);
  window._melodexFetchLoop = fetchLoopInterval;
}

// ─── Linear Sync (Fallback) ───────────────────────────────────────────────────
async function startLinearSync(lyrics, songDurationMs) {
  stopLyricSync();

  const totalLines = lyrics
    .split("\n")
    .filter(l => l.trim().length > 0).length;

  if (!totalLines) return;

  const sessionId = ++syncSessionId;

  const stored = await new Promise(resolve =>
    chrome.storage.local.get("spotifyAccessToken", resolve)
  );

  let token = stored.spotifyAccessToken;
  if (!token) return;

  if (syncSessionId !== sessionId) return;

  const fetchProgress = makeFetchProgress(
    sessionId,
    ()  => token,
    (t) => { token = t; }
  );

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      fetchProgress();
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  window._melodexVisibilityHandler = onVisibilityChange;

  syncInterval = setInterval(() => {
    if (!isCurrentlyPlaying) return;

    const elapsed   = Math.min(Date.now() - lastFetchTimestamp, 3000);
    const progress  = Math.min(lastKnownProgress + elapsed, songDurationMs);
    const lineIndex = Math.min(
      Math.floor((progress / songDurationMs) * totalLines),
      totalLines - 1
    );

    highlightLine(lineIndex);
  }, 100);

  fetchProgress();
  fetchLoopInterval = setInterval(fetchProgress, 2000);
  window._melodexFetchLoop = fetchLoopInterval;
}

// ─── Stop All Sync ────────────────────────────────────────────────────────────
function stopLyricSync() {
  // Increment session ID — marks all in-flight fetches as stale
  syncSessionId++;

  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
  if (window._melodexFetchLoop) {
    clearInterval(window._melodexFetchLoop);
    window._melodexFetchLoop = null;
  }
  if (window._melodexVisibilityHandler) {
    document.removeEventListener("visibilitychange", window._melodexVisibilityHandler);
    window._melodexVisibilityHandler = null;
  }

  lastKnownProgress  = 0;
  lastFetchTimestamp = 0;
  isCurrentlyPlaying = true;
}

// ─── Lyric Highlighter ────────────────────────────────────────────────────────
function highlightLine(index) {
  const lines = document.querySelectorAll(".melodex-line:not(.melodex-break)");
  if (!lines.length) return;

  const clamped = Math.max(0, Math.min(index, lines.length - 1));

  lines.forEach((line, i) => {
    if (i === clamped) {
      if (!line.classList.contains("melodex-line-active")) {
        line.classList.add("melodex-line-active");
        line.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    } else {
      line.classList.remove("melodex-line-active");
    }
  });
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────
function showLoading() {
  injectLyrics({ loading: true });
}

function showError(message) {
  injectLyrics({ error: message });
}

// ─── Start ────────────────────────────────────────────────────────────────────
setTimeout(init, 1500);